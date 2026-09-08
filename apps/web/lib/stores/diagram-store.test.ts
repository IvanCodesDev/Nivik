import 'fake-indexeddb/auto';
import { applyChangeSet, type ChangeSet, createDiagram, type Diagram } from '@nivik/ir';
import { DefaultMeasurer } from '@nivik/layout';
import type { HighlightInput, LiveSession, RendererPatch } from '@nivik/renderer-core';
import { DiagramRepository, NivikDB } from '@nivik/storage';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDiagramStore, patchAffected, touchedIds } from './diagram-store';

function fakeSession() {
  const applied: RendererPatch[] = [];
  const highlights: HighlightInput[] = [];
  const session = {
    apply: async (patch: RendererPatch) => {
      applied.push(patch);
    },
    replace: async () => {},
    getSelection: async () => [],
    setSelection: async () => {},
    highlight: (h: HighlightInput) => {
      highlights.push(h);
    },
    clearHighlight: () => {},
    fit: async () => {},
    exportImage: async () => new Blob(),
    measurer: DefaultMeasurer,
    setReadOnly: () => {},
    destroy: () => {},
  } as unknown as LiveSession;
  return { session, applied, highlights };
}

const generate = (d: Diagram, labels: string[], runId = 'run_1'): ChangeSet => ({
  id: `cs_${runId}`,
  diagramId: d.id,
  baseVersion: d.version,
  origin: 'ai',
  runId,
  createdAt: 10,
  summary: `Sketch ${labels.length} steps`,
  actions: [
    {
      op: 'setDiagram',
      patch: { type: 'flow', layout: { algorithm: 'layered', direction: 'RIGHT' } },
    },
    ...labels.map((label, i) => ({
      op: 'addNode' as const,
      node: { id: `n${i}`, type: 'rounded' as const, label, parent: null },
    })),
    ...labels.slice(1).map((_, i) => ({
      op: 'addEdge' as const,
      edge: {
        id: `e${i}`,
        source: `n${i}`,
        target: `n${i + 1}`,
        type: 'flow' as const,
        direction: 'forward' as const,
        sourceSide: 'auto' as const,
        targetSide: 'auto' as const,
      },
    })),
  ],
});

const move = (d: Diagram, id: string, x: number, y: number, csId = 'cs_user'): ChangeSet => ({
  id: csId,
  diagramId: d.id,
  baseVersion: d.version,
  origin: 'user',
  createdAt: 11,
  actions: [{ op: 'moveNode', id, position: { x, y } }],
});

const node = (d: Diagram, id: string) => {
  const found = d.nodes.find((n) => n.id === id);
  if (!found) throw new Error(`missing node ${id}`);
  return found;
};

describe('diagramStore', () => {
  let repo: DiagramRepository;
  let fake: ReturnType<typeof fakeSession>;
  let store: ReturnType<typeof createDiagramStore>;
  const current = () => {
    const d = store.getState().diagram;
    if (!d) throw new Error('no diagram');
    return d;
  };

  beforeEach(async () => {
    repo = new DiagramRepository(new NivikDB(`store-${Math.random().toString(36).slice(2)}`), {
      now: () => 100,
    });
    fake = fakeSession();
    store = createDiagramStore({ repo: () => repo, session: () => fake.session, now: () => 100 });
    await repo.create(createDiagram({ id: 'd1', name: 'x', type: 'generic' }));
    await store.getState().load('d1', { name: 'x' });
  });

  it('applies an AI change set, lays it out as a same-group system change set and pushes one patch', async () => {
    const outcome = await store.getState().apply(generate(current(), ['A', 'B', 'C']), {
      group: 'run_1',
      label: 'Sketch',
      snapshot: 'ai-run',
      highlightMs: 8000,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.changeSets.map((cs) => cs.origin)).toEqual(['ai', 'system']);

    const { diagram, history } = store.getState();
    expect(diagram?.version).toBe(3);
    expect(diagram?.type).toBe('flow');
    expect(diagram?.nodes.every((n) => n.position && n.size)).toBe(true);
    expect(history.undo.map((e) => e.group)).toEqual(['run_1', 'run_1']);
    expect(history.undo[1]?.forward.origin).toBe('system');
    expect(history.redo).toEqual([]);

    expect(fake.applied).toHaveLength(1);
    expect([...(fake.applied[0]?.affected.added ?? [])].sort()).toEqual([
      'e0',
      'e1',
      'n0',
      'n1',
      'n2',
    ]);
    expect(fake.applied[0]?.affected.modified).toEqual([]);
    expect(fake.applied[0]?.historyLabel).toBe('Sketch');
    expect(fake.highlights).toHaveLength(1);
    expect(fake.highlights[0]?.added).toHaveLength(5);

    expect((await repo.require('d1')).version).toBe(3);
    expect((await repo.listVersions('d1')).map((v) => v.reason)).toContain('ai-run');
  });

  it('a user move is persisted, pinned, pushed back to the renderer and undoable on its own', async () => {
    await store.getState().apply(generate(current(), ['A', 'B']), { group: 'run_1' });
    const before = current();
    const outcome = await store.getState().apply(move(before, 'n0', 500, 500));
    expect(outcome.ok).toBe(true);

    const moved = node(current(), 'n0');
    expect(moved.position).toEqual({ x: 500, y: 500 });
    expect(moved.pinned).toBe(true);
    expect(fake.applied.at(-1)?.affected).toEqual({ added: [], modified: ['n0'], deleted: [] });
    expect(store.getState().history.undo.at(-1)?.group).toBe('cs_user');

    const undone = await store.getState().undo();
    expect(undone?.ok).toBe(true);
    const restored = node(current(), 'n0');
    expect(restored.position).toEqual(node(before, 'n0').position);
    expect(restored.pinned).toBe(false);
    expect(store.getState().history.undo.map((e) => e.group)).toEqual(['run_1', 'run_1']);
    expect(store.getState().history.redo).toHaveLength(1);
    expect(fake.applied.at(-1)?.affected).toEqual({ added: [], modified: ['n0'], deleted: [] });
    expect((await repo.require('d1')).version).toBe(current().version);
  });

  it('undoGroup removes the AI change set and its layout together; redo brings both back', async () => {
    await store.getState().apply(generate(current(), ['A', 'B']), { group: 'run_1' });
    const edit: ChangeSet = {
      id: 'cs_run_2',
      diagramId: 'd1',
      baseVersion: current().version,
      origin: 'ai',
      runId: 'run_2',
      createdAt: 12,
      actions: [
        { op: 'addNode', node: { id: 'n9', type: 'rounded', label: 'Z', parent: null } },
        {
          op: 'addEdge',
          edge: {
            id: 'e9',
            source: 'n1',
            target: 'n9',
            type: 'flow',
            direction: 'forward',
            sourceSide: 'auto',
            targetSide: 'auto',
          },
        },
      ],
    };
    const applied = await store.getState().apply(edit, { group: 'run_2' });
    expect(applied.ok).toBe(true);
    expect(current().nodes).toHaveLength(3);
    expect(node(current(), 'n9').position).toBeDefined();
    expect(store.getState().history.undo.map((e) => e.group)).toEqual([
      'run_1',
      'run_1',
      'run_2',
      'run_2',
    ]);

    expect(await store.getState().undoGroup('run_1')).toBeNull();

    const undone = await store.getState().undoGroup('run_2');
    expect(undone?.ok).toBe(true);
    expect(current().nodes.map((n) => n.id)).toEqual(['n0', 'n1']);
    expect(current().edges.map((e) => e.id)).toEqual(['e0']);
    expect(store.getState().history.undo).toHaveLength(2);
    expect(store.getState().history.redo.map((e) => e.group)).toEqual(['run_2', 'run_2']);
    expect([...(fake.applied.at(-1)?.affected.deleted ?? [])].sort()).toEqual(['e9', 'n9']);

    expect(await store.getState().undoGroup('run_1')).not.toBeNull();
    expect(current().nodes).toHaveLength(0);
    expect(current().type).toBe('generic');

    const redone = await store.getState().redo();
    expect(redone?.ok).toBe(true);
    expect(current().nodes.map((n) => n.id)).toEqual(['n0', 'n1']);
    expect(current().nodes.every((n) => n.position)).toBe(true);
    expect(store.getState().history.undo.map((e) => e.group)).toEqual(['run_1', 'run_1']);
    expect(store.getState().history.undo.at(-1)?.forward.origin).toBe('system');
    expect(store.getState().history.redo.map((e) => e.group)).toEqual(['run_2', 'run_2']);
    expect(fake.applied.at(-1)?.affected.added.sort()).toEqual(['e0', 'n0', 'n1']);

    const again = await store.getState().redo();
    expect(again?.ok).toBe(true);
    expect(current().nodes.map((n) => n.id)).toEqual(['n0', 'n1', 'n9']);
    expect(store.getState().history.redo).toEqual([]);
  });

  it('rebases a stale AI change set that does not overlap what changed in between', async () => {
    await store.getState().apply(generate(current(), ['A', 'B']), { group: 'run_1' });
    const stale = current();
    const drag = move(stale, 'n0', 1, 1);
    await store.getState().apply(drag);
    const edit: ChangeSet = {
      id: 'cs_run_2',
      diagramId: 'd1',
      baseVersion: stale.version,
      origin: 'ai',
      runId: 'run_2',
      createdAt: 12,
      actions: [{ op: 'addNode', node: { id: 'n9', type: 'rounded', label: 'Z', parent: null } }],
    };
    const outcome = await store.getState().apply(edit, { group: 'run_2', since: [drag] });
    expect(outcome.ok).toBe(true);
    expect(current().nodes.map((n) => n.id)).toContain('n9');
    expect(node(current(), 'n0').position).toEqual({ x: 1, y: 1 });
  });

  it('reports a conflict instead of applying when the stale change set touches edited ids', async () => {
    await store.getState().apply(generate(current(), ['A', 'B']), { group: 'run_1' });
    const stale = current();
    const drag = move(stale, 'n1', 1, 1);
    await store.getState().apply(drag);
    const edit: ChangeSet = {
      id: 'cs_run_2',
      diagramId: 'd1',
      baseVersion: stale.version,
      origin: 'ai',
      runId: 'run_2',
      createdAt: 12,
      actions: [{ op: 'updateNode', id: 'n1', patch: { label: 'B2' } }],
    };
    const outcome = await store.getState().apply(edit, { group: 'run_2', since: [drag] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe('E_BASE_VERSION_MISMATCH');
    expect(outcome.conflicts).toEqual(['n1']);
    expect(current().version).toBe(stale.version + 1);
    expect(node(current(), 'n1').label).toBe('B');
  });

  it('serialises concurrent applies so the second one sees the first', async () => {
    const d = current();
    const first = store.getState().apply(generate(d, ['A', 'B']), { group: 'run_1' });
    const second = store.getState().apply(
      {
        id: 'cs_late',
        diagramId: 'd1',
        baseVersion: d.version + 2,
        origin: 'user',
        createdAt: 13,
        actions: [{ op: 'moveNode', id: 'n1', position: { x: 9, y: 9 } }],
      },
      {},
    );
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(node(current(), 'n1').position).toEqual({ x: 9, y: 9 });
  });
});

describe('patchAffected', () => {
  it('classifies touched ids relative to the scene the renderer is showing', () => {
    const before = applyChangeSet(createDiagram({ id: 'd', name: 'x', type: 'flow' }), {
      id: 'c',
      diagramId: 'd',
      baseVersion: 1,
      origin: 'user',
      createdAt: 1,
      actions: [
        { op: 'addNode', node: { id: 'keep', type: 'box', label: 'k', parent: null } },
        { op: 'addNode', node: { id: 'gone', type: 'box', label: 'g', parent: null } },
      ],
    });
    if (!before.ok) throw new Error(before.error.message);
    const cs: ChangeSet = {
      id: 'c2',
      diagramId: 'd',
      baseVersion: 2,
      origin: 'user',
      createdAt: 2,
      actions: [
        { op: 'deleteNode', id: 'gone' },
        { op: 'addNode', node: { id: 'new', type: 'box', label: 'n', parent: null } },
        { op: 'updateNode', id: 'keep', patch: { label: 'k2' } },
      ],
    };
    const after = applyChangeSet(before.diagram, cs);
    if (!after.ok) throw new Error(after.error.message);
    expect(
      patchAffected(before.diagram, after.diagram, ['gone', 'new', 'keep', 'unknown']),
    ).toEqual({ added: ['new'], modified: ['keep'], deleted: ['gone'] });
    expect([...touchedIds(cs)].sort()).toEqual(['gone', 'keep', 'new']);
  });
});
