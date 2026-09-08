import {
  type Affected,
  affectedIds,
  type ChangeSet,
  type ChangeSetError,
  type Diagram,
  type Id,
  newChangeSetId,
  rebaseChangeSet,
  rectOf,
} from '@nivik/ir';
import { DefaultMeasurer, type ElkEngine, type LayoutWarning } from '@nivik/layout';
import type { HighlightInput, LiveSession } from '@nivik/renderer-core';
import type { DiagramRepository, PersistOptions } from '@nivik/storage';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { runLayout } from '@/lib/layout-pipeline';
import { getRepository, openDiagram } from '@/lib/repository';
import { useRendererStore } from './renderer-store';

export interface HistoryEntry {
  /** An AI change set and its system layout share the run id; user edits stand alone. */
  group: string;
  label?: string;
  forward: ChangeSet;
  inverse: ChangeSet;
}

export interface ApplyOptions {
  group?: string;
  label?: string;
  snapshot?: 'ai-run' | 'manual';
  /** Change sets applied since the incoming one was built (rebase input, spec 02 §6). */
  since?: readonly ChangeSet[];
  /** Highlight the affected elements in the renderer for this long (spec 07 §3.1). */
  highlightMs?: number;
}

export type ApplyOutcome =
  | {
      ok: true;
      diagram: Diagram;
      affected: Affected;
      changeSets: ChangeSet[];
      warnings: LayoutWarning[];
    }
  | { ok: false; error: ChangeSetError; conflicts?: Id[] };

export interface DiagramStoreDeps {
  repo(): DiagramRepository;
  session(): LiveSession | null;
  engine?: ElkEngine;
  now?(): number;
}

export interface DiagramState {
  id: Id | null;
  diagram: Diagram | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  history: { undo: HistoryEntry[]; redo: HistoryEntry[] };
  load(id: Id, init: { name: string }): Promise<Diagram>;
  apply(cs: ChangeSet, opts?: ApplyOptions): Promise<ApplyOutcome>;
  undo(): Promise<ApplyOutcome | null>;
  redo(): Promise<ApplyOutcome | null>;
  /** Undoes the group only while it is the most recent one (the review bar's "Undo run"). */
  undoGroup(group: string): Promise<ApplyOutcome | null>;
  reset(): void;
}

const elementIds = (d: Diagram) =>
  new Set<Id>([...d.nodes, ...d.edges, ...d.groups].map((e) => e.id));

/** What the renderer must redraw, relative to the scene it currently shows (`before`). */
export function patchAffected(before: Diagram, after: Diagram, touched: Iterable<Id>): Affected {
  const was = elementIds(before);
  const is = elementIds(after);
  const affected: Affected = { added: [], modified: [], deleted: [] };
  for (const id of new Set(touched)) {
    if (is.has(id)) (was.has(id) ? affected.modified : affected.added).push(id);
    else if (was.has(id)) affected.deleted.push(id);
  }
  return affected;
}

export function touchedIds(...changeSets: ChangeSet[]): Set<Id> {
  const ids = new Set<Id>();
  for (const cs of changeSets) for (const id of affectedIds(cs)) ids.add(id);
  return ids;
}

function highlightFor(before: Diagram, affected: Affected): HighlightInput {
  const elements = new Map([...before.nodes, ...before.groups].map((e) => [e.id, e]));
  return {
    added: affected.added,
    modified: affected.modified,
    deleted: affected.deleted.flatMap((id) => {
      const element = elements.get(id);
      const bounds = element ? rectOf(element) : null;
      return bounds ? [{ id, bounds }] : [];
    }),
  };
}

/** The entries at the top of a stack that belong to the same group as the last one. */
function topGroup(stack: HistoryEntry[], group?: string): HistoryEntry[] {
  const last = stack.at(-1);
  if (!last || (group !== undefined && last.group !== group)) return [];
  return stack.slice(stack.findLastIndex((e) => e.group !== last.group) + 1);
}

export function createDiagramStore(deps: DiagramStoreDeps): StoreApi<DiagramState> {
  const now = deps.now ?? (() => Date.now());
  // Only the most recent load may publish its result (effects replay under StrictMode).
  let loadToken = 0;
  let chain: Promise<unknown> = Promise.resolve();
  // Applies are serialised: a debounced user edit and an AI change set must not interleave.
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const next = chain.then(job, job);
    chain = next.catch(() => undefined);
    return next;
  };

  return createStore<DiagramState>()((set, get) => {
    const requireLoaded = () => {
      const { id, diagram } = get();
      if (!id || !diagram) throw new Error('no diagram loaded');
      return { id, diagram };
    };

    const persist = async (
      id: Id,
      cs: ChangeSet,
      opts: Pick<ApplyOptions, 'snapshot' | 'label' | 'since'>,
    ) => {
      const repo = deps.repo();
      const persistOpts: PersistOptions = {
        ...(opts.snapshot ? { snapshot: opts.snapshot } : {}),
        ...(opts.label ? { label: opts.label } : {}),
        ...(cs.runId ? { runId: cs.runId } : {}),
      };
      let result = await repo.applyAndPersist(id, cs, persistOpts);
      if (!result.ok && result.error.code === 'E_BASE_VERSION_MISMATCH' && cs.origin !== 'system') {
        const current = await repo.require(id);
        const rebase = rebaseChangeSet(cs, current.ir, opts.since ?? []);
        if (rebase.kind === 'conflict') return { result, conflicts: rebase.conflicts };
        result = await repo.applyAndPersist(id, rebase.rebased, persistOpts);
      }
      return { result };
    };

    const push = async (
      before: Diagram,
      latest: Diagram,
      applied: ChangeSet[],
      label?: string,
      highlightMs?: number,
    ): Promise<Affected> => {
      const affected = patchAffected(before, latest, touchedIds(...applied));
      const session = deps.session();
      if (session) {
        await session.apply({
          diagram: latest,
          affected,
          ...(label ? { historyLabel: label } : {}),
        });
        if (highlightMs) session.highlight(highlightFor(before, affected), { ttlMs: highlightMs });
      }
      return affected;
    };

    /**
     * Applies prepared change sets in order (undo: inverses newest-first; redo: forwards
     * oldest-first), each re-based onto the current version with a fresh id. The history stacks
     * change only when every step succeeded.
     */
    const replay = async (
      steps: { apply: ChangeSet; source: HistoryEntry }[],
      target: 'undo' | 'redo',
    ): Promise<ApplyOutcome> => {
      const { id, diagram: before } = requireLoaded();
      const repo = deps.repo();
      const entries: HistoryEntry[] = [];
      const applied: ChangeSet[] = [];
      let latest = before;
      for (const step of steps) {
        const current = await repo.require(id);
        const rebased: ChangeSet = {
          ...step.apply,
          id: newChangeSetId(),
          baseVersion: current.version,
          createdAt: now(),
        };
        const result = await repo.applyAndPersist(
          id,
          rebased,
          rebased.runId ? { runId: rebased.runId } : {},
        );
        if (!result.ok) {
          set({ diagram: (await repo.require(id)).ir });
          return { ok: false, error: result.error };
        }
        latest = result.diagram;
        applied.push(rebased);
        entries.push({
          group: step.source.group,
          ...(step.source.label ? { label: step.source.label } : {}),
          // Undo keeps the original forward so redo replays exactly what was undone.
          forward: target === 'undo' ? step.source.forward : rebased,
          inverse: result.inverse,
        });
      }
      set((s) => ({
        diagram: latest,
        history:
          target === 'undo'
            ? {
                undo: s.history.undo.slice(0, s.history.undo.length - steps.length),
                redo: [...s.history.redo, ...entries],
              }
            : {
                undo: [...s.history.undo, ...entries],
                redo: s.history.redo.slice(0, s.history.redo.length - steps.length),
              },
      }));
      const affected = await push(before, latest, applied);
      return { ok: true, diagram: latest, affected, changeSets: applied, warnings: [] };
    };

    const undoEntries = (entries: HistoryEntry[]) =>
      replay(
        [...entries].reverse().map((source) => ({ apply: source.inverse, source })),
        'undo',
      );

    return {
      id: null,
      diagram: null,
      status: 'idle',
      error: null,
      history: { undo: [], redo: [] },

      async load(id, init) {
        const token = ++loadToken;
        set({ id, diagram: null, status: 'loading', error: null, history: { undo: [], redo: [] } });
        try {
          const record = await openDiagram(deps.repo(), id, init);
          if (token === loadToken) set({ diagram: record.ir, status: 'ready' });
          return record.ir;
        } catch (error) {
          if (token === loadToken) {
            set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
          }
          throw error;
        }
      },

      reset() {
        loadToken += 1;
        set({
          id: null,
          diagram: null,
          status: 'idle',
          error: null,
          history: { undo: [], redo: [] },
        });
      },

      apply(cs, opts = {}) {
        return serial(async () => {
          const { id, diagram: before } = requireLoaded();
          const group = opts.group ?? cs.id;
          const first = await persist(id, cs, opts);
          if (!first.result.ok) {
            return {
              ok: false,
              error: first.result.error,
              ...(first.conflicts ? { conflicts: first.conflicts } : {}),
            };
          }
          const entries: HistoryEntry[] = [
            {
              group,
              ...(opts.label ? { label: opts.label } : {}),
              forward: cs,
              inverse: first.result.inverse,
            },
          ];
          const applied: ChangeSet[] = [cs];
          let latest = first.result.diagram;
          let warnings: LayoutWarning[] = [];

          if (first.result.layoutRequest && cs.origin !== 'system') {
            const session = deps.session();
            const { changeSet, result } = await runLayout(latest, first.result.layoutRequest, {
              measurer: session?.measurer ?? DefaultMeasurer,
              affected: first.result.affected,
              ...(deps.engine ? { engine: deps.engine } : {}),
              ...(cs.runId ? { runId: cs.runId } : {}),
              now,
            });
            warnings = result?.warnings ?? [];
            if (changeSet) {
              const second = await deps
                .repo()
                .applyAndPersist(id, changeSet, cs.runId ? { runId: cs.runId } : {});
              if (second.ok) {
                latest = second.diagram;
                applied.push(changeSet);
                entries.push({ group, forward: changeSet, inverse: second.inverse });
              }
            }
          }

          set((s) => ({
            diagram: latest,
            history: { undo: [...s.history.undo, ...entries], redo: [] },
          }));
          const affected = await push(before, latest, applied, opts.label, opts.highlightMs);
          return { ok: true, diagram: latest, affected, changeSets: applied, warnings };
        });
      },

      undo() {
        return serial(async () => {
          const entries = topGroup(get().history.undo);
          return entries.length > 0 ? undoEntries(entries) : null;
        });
      },

      undoGroup(group) {
        return serial(async () => {
          const entries = topGroup(get().history.undo, group);
          return entries.length > 0 ? undoEntries(entries) : null;
        });
      },

      redo() {
        return serial(async () => {
          const entries = topGroup(get().history.redo);
          if (entries.length === 0) return null;
          return replay(
            [...entries].reverse().map((source) => ({ apply: source.forward, source })),
            'redo',
          );
        });
      },
    };
  });
}

/** Browser instance: the Dexie repository and whichever renderer session is mounted. */
export const diagramStore = createDiagramStore({
  repo: getRepository,
  session: () => useRendererStore.getState().session,
});

export function useDiagramStore<T>(selector: (state: DiagramState) => T): T {
  return useStore(diagramStore, selector);
}
