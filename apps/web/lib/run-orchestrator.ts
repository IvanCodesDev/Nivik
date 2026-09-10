import { type ChangeSet, type Id, newRunId } from '@nivik/ir';
import type {
  DocumentInfo,
  DoneOutcome,
  RendererId,
  RunBudget,
  RunEvent,
  RunRequestInput,
} from '@nivik/protocol';
import type { DiagramRepository } from '@nivik/storage';
import type { StoreApi } from 'zustand/vanilla';
import { type AgentClient, AgentRuntimeUnavailableError } from '@/lib/agent-client';
import { getRepository } from '@/lib/repository';
import { buildRunRequest } from '@/lib/run-request';
import { sessionForRequest, turnFromRun } from '@/lib/session';
import { persistSideDocument } from '@/lib/side-documents';
import type { DiagramState } from '@/lib/stores/diagram-store';
import type { RunStoreState, RunView } from '@/lib/stores/run-store';
import type { Settings } from '@/lib/stores/settings-store';

export interface RunInput {
  prompt: string;
  renderer: RendererId;
  settings: Pick<Settings, 'defaultModel' | 'providers'>;
  temporaryModel?: string | null;
}

export type RunNotice =
  | { kind: 'offline' }
  | { kind: 'conflict'; ids: Id[] }
  | { kind: 'error'; message: string }
  | { kind: 'aborted' }
  | { kind: 'done'; summary: string }
  /** The run ended by the budget safety net; what was built is on the canvas (D14′). */
  | { kind: 'budget-exhausted'; summary: string; unresolved: string[] }
  /** The agent created / updated other diagrams; they are in the library, not on this canvas. */
  | { kind: 'documents'; documents: { id: Id; name: string }[] };

export interface RunOrchestratorDeps {
  diagram: StoreApi<DiagramState>;
  run: StoreApi<RunStoreState>;
  client(): AgentClient;
  /** Used when `client()` cannot be reached before it produced any event (spec 07 §1.1 local mode). */
  fallback?(): AgentClient;
  /** Session memory and side documents; defaults to the browser singleton. */
  repo?(): DiagramRepository;
  /** Whether the host shows question cards (spec 09 §3.2); default false until the canvas has one. */
  canAsk?: boolean;
  /** Soft budget for each run (spec 05 §12.5); absent = protocol defaults. */
  budget?(): RunBudget | undefined;
  onNotice?(notice: RunNotice): void;
  now?(): number;
  highlightMs?: number;
}

export interface RunOutcome {
  runId: string;
  status: RunView['status'] | 'noop';
  changeSets: ChangeSet[];
  /** Other documents this run wrote (design §5). */
  documents: { id: Id; name: string }[];
}

export interface RunOrchestrator {
  start(input: RunInput): Promise<RunOutcome>;
  abort(): void;
  readonly running: boolean;
}

/** Spec 07 §3.1: how long the AI's changes stay highlighted on the canvas. */
const HIGHLIGHT_TTL_MS = 8_000;

/**
 * Spec 07 §2: the only consumer of `AgentClient.start()`. Turns the event stream into run-store
 * updates, hands every `changeSet` for the open diagram to the diagram store (persist, layout,
 * renderer) and writes change sets for other documents straight to the repository. Reads the
 * session before the run and appends the turn after it. Where the agent runs is the client's
 * business (runtime, page, worker).
 */
export function createRunOrchestrator(deps: RunOrchestratorDeps): RunOrchestrator {
  const now = deps.now ?? (() => Date.now());
  const highlightMs = deps.highlightMs ?? HIGHLIGHT_TTL_MS;
  const repo = deps.repo ?? getRepository;
  let controller: AbortController | null = null;

  async function* events(request: RunRequestInput, signal: AbortSignal): AsyncGenerator<RunEvent> {
    let received = 0;
    try {
      for await (const event of deps.client().start(request, { signal })) {
        received += 1;
        yield event;
      }
    } catch (error) {
      const fallback = deps.fallback;
      if (!(error instanceof AgentRuntimeUnavailableError) || received > 0 || !fallback)
        throw error;
      deps.onNotice?.({ kind: 'offline' });
      yield* fallback().start(request, { signal });
    }
  }

  const loadSession = async (diagramId: Id) => {
    try {
      return sessionForRequest(await repo().getSession(diagramId));
    } catch {
      return sessionForRequest(null);
    }
  };

  return {
    get running() {
      return controller !== null;
    },

    abort() {
      controller?.abort();
    },

    async start(input) {
      const diagram = deps.diagram.getState().diagram;
      if (!diagram) throw new Error('no diagram loaded');
      if (controller) return { runId: '', status: 'noop', changeSets: [], documents: [] };
      controller = new AbortController();
      const { signal } = controller;
      const runId = newRunId();
      const session = await loadSession(diagram.id);
      const request: RunRequestInput = {
        ...buildRunRequest({
          diagram,
          ...input,
          session,
          canAsk: deps.canAsk ?? false,
          ...(deps.budget ? { budget: deps.budget() } : {}),
        }),
        runId,
      };
      const depthAtStart = deps.diagram.getState().history.undo.length;
      const startedAt = now();
      deps.run.getState().begin(runId, startedAt);
      const changeSets: ChangeSet[] = [];
      const seen: RunEvent[] = [];
      const created = new Map<Id, DocumentInfo>();
      const documents: { id: Id; name: string }[] = [];
      let status: Exclude<RunView['status'], 'running'> = 'done';
      let summary = '';
      let outcome: DoneOutcome | null = null;
      let unresolved: string[] = [];

      try {
        for await (const event of events(request, signal)) {
          seen.push(event);
          deps.run.getState().event(event);
          if (event.type === 'document') {
            if (event.op === 'create') created.set(event.document.id, event.document);
          } else if (event.type === 'changeSet' && event.changeSet.diagramId !== diagram.id) {
            const side = await persistSideDocument(
              { repo: repo(), now, renderer: input.renderer },
              event.changeSet,
              created.get(event.changeSet.diagramId),
            );
            if (side.ok) {
              changeSets.push(...side.changeSets);
              documents.push({ id: side.id, name: side.diagram.name });
            } else {
              deps.onNotice?.({ kind: 'error', message: side.error });
            }
          } else if (event.type === 'changeSet') {
            // Whatever landed since the request was built (user drags) is what the AI must rebase over.
            const since = deps.diagram
              .getState()
              .history.undo.slice(depthAtStart)
              .map((entry) => entry.forward);
            const result = await deps.diagram.getState().apply(event.changeSet, {
              group: runId,
              ...(event.changeSet.summary ? { label: event.changeSet.summary } : {}),
              snapshot: 'ai-run',
              since,
              highlightMs,
            });
            if (!result.ok) {
              status = 'failed';
              deps.onNotice?.(
                result.conflicts
                  ? { kind: 'conflict', ids: result.conflicts }
                  : { kind: 'error', message: result.error.message },
              );
              continue;
            }
            changeSets.push(...result.changeSets);
            summary = event.changeSet.summary ?? '';
            deps.run.getState().setReview({ runId, summary, affected: result.affected, at: now() });
          } else if (event.type === 'done') {
            outcome = event.outcome ?? 'finished';
            if (event.summary) summary = event.summary;
            unresolved = event.unresolved ?? [];
          } else if (event.type === 'error' && !event.recoverable) {
            if (event.code === 'E_ABORTED' || signal.aborted) {
              status = 'aborted';
            } else {
              status = 'failed';
              deps.onNotice?.({ kind: 'error', message: event.message });
            }
          }
        }
      } catch (error) {
        if (signal.aborted) {
          status = 'aborted';
        } else {
          status = 'failed';
          deps.onNotice?.({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        controller = null;
        deps.run.getState().finish(status, now());
      }

      if (status === 'aborted') {
        deps.onNotice?.({ kind: 'aborted' });
      } else if (status === 'done') {
        if (outcome === 'budget-exhausted') {
          deps.onNotice?.({ kind: 'budget-exhausted', summary, unresolved });
        } else if (changeSets.some((cs) => cs.diagramId === diagram.id)) {
          deps.onNotice?.({ kind: 'done', summary });
        }
        if (documents.length) deps.onNotice?.({ kind: 'documents', documents });
      }

      // Memory of the exchange for the next run; a missing diagram (deleted meanwhile) leaves none.
      try {
        await repo().appendSessionTurn(
          diagram.id,
          turnFromRun({
            runId,
            prompt: input.prompt,
            events: seen,
            applied: changeSets,
            status,
            at: startedAt,
          }),
        );
      } catch {
        // Memory is best effort; the run itself already succeeded or failed on its own terms.
      }
      return { runId, status, changeSets, documents };
    },
  };
}
