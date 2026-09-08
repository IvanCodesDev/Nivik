import { type ChangeSet, type Id, newRunId } from '@nivik/ir';
import type { RendererId, RunEvent, RunRequestInput } from '@nivik/protocol';
import type { StoreApi } from 'zustand/vanilla';
import { type AgentClient, AgentRuntimeUnavailableError } from '@/lib/agent-client';
import { buildRunRequest } from '@/lib/run-request';
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
  | { kind: 'done'; summary: string };

export interface RunOrchestratorDeps {
  diagram: StoreApi<DiagramState>;
  run: StoreApi<RunStoreState>;
  client(): AgentClient;
  /** Used when `client()` cannot be reached before it produced any event (spec 07 §1.1 local mode). */
  fallback?(): AgentClient;
  onNotice?(notice: RunNotice): void;
  now?(): number;
  highlightMs?: number;
}

export interface RunOutcome {
  runId: string;
  status: RunView['status'] | 'noop';
  changeSets: ChangeSet[];
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
 * updates and hands every `changeSet` to the diagram store, which persists, lays out and pushes it
 * to the renderer. Where the agent runs is the client's business (runtime, page, worker).
 */
export function createRunOrchestrator(deps: RunOrchestratorDeps): RunOrchestrator {
  const now = deps.now ?? (() => Date.now());
  const highlightMs = deps.highlightMs ?? HIGHLIGHT_TTL_MS;
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
      if (controller) return { runId: '', status: 'noop', changeSets: [] };
      controller = new AbortController();
      const { signal } = controller;
      const runId = newRunId();
      const request: RunRequestInput = { ...buildRunRequest({ diagram, ...input }), runId };
      const depthAtStart = deps.diagram.getState().history.undo.length;
      deps.run.getState().begin(runId, now());
      const changeSets: ChangeSet[] = [];
      let status: Exclude<RunView['status'], 'running'> = 'done';
      let summary = '';

      try {
        for await (const event of events(request, signal)) {
          deps.run.getState().event(event);
          if (event.type === 'changeSet') {
            // Whatever landed since the request was built (user drags) is what the AI must rebase over.
            const since = deps.diagram
              .getState()
              .history.undo.slice(depthAtStart)
              .map((entry) => entry.forward);
            const outcome = await deps.diagram.getState().apply(event.changeSet, {
              group: runId,
              ...(event.changeSet.summary ? { label: event.changeSet.summary } : {}),
              snapshot: 'ai-run',
              since,
              highlightMs,
            });
            if (!outcome.ok) {
              status = 'failed';
              deps.onNotice?.(
                outcome.conflicts
                  ? { kind: 'conflict', ids: outcome.conflicts }
                  : { kind: 'error', message: outcome.error.message },
              );
              continue;
            }
            changeSets.push(...outcome.changeSets);
            summary = event.changeSet.summary ?? '';
            deps.run
              .getState()
              .setReview({ runId, summary, affected: outcome.affected, at: now() });
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
      if (status === 'aborted') deps.onNotice?.({ kind: 'aborted' });
      else if (status === 'done' && changeSets.length > 0)
        deps.onNotice?.({ kind: 'done', summary });
      return { runId, status, changeSets };
    },
  };
}
