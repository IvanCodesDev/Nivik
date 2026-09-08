import {
  type Affected,
  applyChangeSet,
  type ChangeSet,
  ChangeSetSchema,
  createDiagram,
  type Diagram,
  type LayoutRequest,
} from '@nivik/ir';
import { orderPlatform, specExampleChangeSet } from '@nivik/ir/testing';
import { DefaultMeasurer, layoutDiagram } from '@nivik/layout';
import { describe, expect, it } from 'vitest';
import { layoutChangeSet, layoutModeFor, runLayout } from './layout-pipeline';

const NONE: Affected = { added: [], modified: [], deleted: [] };

const applied = (d: Diagram, cs: ChangeSet) => {
  const result = applyChangeSet(d, cs);
  if (!result.ok) throw new Error(result.error.message);
  return result;
};

const generation = (): ChangeSet => ({
  id: 'cs1',
  diagramId: 'd1',
  baseVersion: 1,
  origin: 'ai',
  runId: 'run1',
  createdAt: 1,
  actions: [
    {
      op: 'setDiagram',
      patch: { type: 'flow', layout: { algorithm: 'layered', direction: 'RIGHT' } },
    },
    { op: 'addNode', node: { id: 'a', type: 'rounded', label: 'A', parent: null } },
    { op: 'addNode', node: { id: 'b', type: 'rounded', label: 'B', parent: null } },
    {
      op: 'addEdge',
      edge: {
        id: 'e',
        source: 'a',
        target: 'b',
        type: 'flow',
        direction: 'forward',
        sourceSide: 'auto',
        targetSide: 'auto',
      },
    },
  ],
});

describe('layoutModeFor', () => {
  const hints = { a: 'b' };
  it('maps scope and reason onto LayoutMode (spec 03 §2, §6.1)', () => {
    const all: LayoutRequest = { scope: 'all', reason: 'structural', hints: {} };
    expect(layoutModeFor(all, NONE)).toEqual({ kind: 'full' });

    const measure: LayoutRequest = { scope: ['a'], reason: 'measure', hints: {} };
    expect(layoutModeFor(measure, { ...NONE, modified: ['a'] })).toEqual({
      kind: 'measure-only',
      ids: ['a'],
    });

    const structural: LayoutRequest = { scope: ['a', 'b', 'c'], reason: 'structural', hints };
    expect(
      layoutModeFor(structural, { added: ['a', 'e1'], modified: ['b'], deleted: ['z'] }),
    ).toEqual({ kind: 'incremental', affected: ['a', 'e1', 'b'], hints });
  });
});

describe('runLayout', () => {
  it('turns the full layout of a fresh generation into one system applyLayout change set', async () => {
    const generated = applied(
      createDiagram({ name: 'x', type: 'generic', id: 'd1' }),
      generation(),
    );
    expect(generated.layoutRequest?.scope).toBe('all');

    const { changeSet, result } = await runLayout(generated.diagram, generated.layoutRequest, {
      measurer: DefaultMeasurer,
      runId: 'run1',
      now: () => 2,
    });
    expect([...(result?.moved ?? [])].sort()).toEqual(['a', 'b']);
    expect(changeSet).toMatchObject({
      origin: 'system',
      runId: 'run1',
      baseVersion: 2,
      diagramId: 'd1',
      createdAt: 2,
    });
    const action = changeSet?.actions[0];
    if (action?.op !== 'applyLayout') throw new Error('expected applyLayout');
    expect(Object.keys(action.positions).sort()).toEqual(['a', 'b']);
    expect(Object.keys(action.sizes).sort()).toEqual(['a', 'b']);
    expect(action.routes.e).toHaveLength(2);

    const laid = applied(generated.diagram, changeSet as ChangeSet);
    expect(laid.diagram.nodes.every((n) => n.position && n.size)).toBe(true);
    expect(laid.diagram.edges[0]?.route?.points).toHaveLength(2);
    expect(laid.layoutRequest).toBeNull();
    expect(laid.diagram.nodes.map((n) => n.meta.rev)).toEqual([0, 0]);
    expect(laid.diagram.nodes.map((n) => n.pinned)).toEqual([false, false]);
  });

  it('returns no change set when the layout moved nothing', async () => {
    const d = orderPlatform();
    expect(
      layoutChangeSet(
        d,
        { diagram: d, moved: [], routed: [], durationMs: 0, warnings: [] },
        { now: 1 },
      ),
    ).toBeNull();
    const { changeSet } = await runLayout(d, null, { measurer: DefaultMeasurer, now: () => 1 });
    expect(changeSet).toBeNull();
  });

  it('after an AI edit only the affected neighbourhood is written back; pinned nodes keep their place', async () => {
    const laid = (
      await layoutDiagram(orderPlatform(), { mode: { kind: 'full' }, measurer: DefaultMeasurer })
    ).diagram;
    const edited = applied(
      laid,
      ChangeSetSchema.parse({
        ...specExampleChangeSet(),
        diagramId: laid.id,
        baseVersion: laid.version,
      }),
    );
    expect(edited.layoutRequest?.scope).not.toBe('all');

    const { changeSet, result } = await runLayout(edited.diagram, edited.layoutRequest, {
      measurer: DefaultMeasurer,
      affected: edited.affected,
      now: () => 3,
    });
    expect(result?.warnings).toEqual([]);
    const action = changeSet?.actions[0];
    if (action?.op !== 'applyLayout') throw new Error('expected applyLayout');
    expect(action.positions['order-events']).toBeDefined();
    expect(action.positions.pay).toBeUndefined();
    expect(Object.keys(action.routes)).toEqual(expect.arrayContaining(['e11', 'e12']));
    expect(action.routes.e1).toBeUndefined();

    const pay = laid.nodes.find((n) => n.id === 'pay');
    const next = applied(edited.diagram, changeSet as ChangeSet).diagram;
    expect(next.nodes.find((n) => n.id === 'pay')?.position).toEqual(pay?.position);
    expect(next.nodes.find((n) => n.id === 'order-events')?.position).toBeDefined();
  });
});
