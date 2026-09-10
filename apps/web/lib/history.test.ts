import { applyChangeSet, type ChangeSet } from '@nivik/ir';
import { orderPlatformLaidOut } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import { compareVersions, countChanges, describeChangeSet, totalChanges } from './history';

describe('countChanges', () => {
  it('counts touched elements per group', () => {
    const counts = countChanges([
      { op: 'addNode', node: { type: 'box', label: 'A' } as never },
      { op: 'addEdge', edge: { type: 'flow', source: 'a', target: 'b' } as never },
      { op: 'setStyle', targets: ['a', 'b', 'c'], style: { palette: 'sky' } },
      { op: 'setParent', ids: ['a', 'b'], parent: null },
      { op: 'deleteNode', id: 'z' },
      { op: 'moveNode', id: 'a', position: { x: 1, y: 2 } },
      {
        op: 'applyLayout',
        positions: { a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
        sizes: {},
        routes: {},
      },
      { op: 'relayout', scope: 'all' },
      { op: 'setDiagram', patch: { name: 'X' } },
    ]);
    expect(counts).toEqual({ added: 2, updated: 5, deleted: 1, layout: 4, diagram: 1 });
    expect(totalChanges(counts)).toBe(13);
  });
});

describe('describeChangeSet', () => {
  it('keeps origin, run and the first added labels', () => {
    const cs: ChangeSet = {
      id: 'cs_1',
      diagramId: 'd_1',
      baseVersion: 1,
      origin: 'ai',
      runId: 'run_1',
      summary: 'Added the checkout path',
      createdAt: 5,
      actions: [
        { op: 'addNode', node: { type: 'box', label: 'Cart' } as never },
        { op: 'addNode', node: { type: 'box', label: 'Pay' } as never },
        { op: 'addNode', node: { type: 'box', label: 'Done' } as never },
        { op: 'addNode', node: { type: 'box', label: 'Extra' } as never },
        { op: 'deleteNode', id: 'old' },
      ],
    };
    expect(describeChangeSet(cs)).toEqual({
      origin: 'ai',
      runId: 'run_1',
      counts: { added: 4, updated: 0, deleted: 1, layout: 0, diagram: 0 },
      highlights: ['Cart', 'Pay', 'Done'],
      summary: 'Added the checkout path',
    });
  });
});

describe('compareVersions (spec 06 §3.4)', () => {
  it('reports identical snapshots and counts the way back otherwise', () => {
    const a = orderPlatformLaidOut();
    expect(compareVersions(a, a)).toMatchObject({ identical: true, changeSet: null });

    const removed = a.nodes[0];
    if (!removed) throw new Error('fixture');
    const applied = applyChangeSet(a, {
      id: 'cs_x',
      diagramId: a.id,
      baseVersion: a.version,
      origin: 'user',
      actions: [
        { op: 'deleteNode', id: removed.id },
        { op: 'setDiagram', patch: { name: 'Renamed' } },
      ],
      createdAt: 9,
    });
    if (!applied.ok) throw new Error(applied.error.message);
    const comparison = compareVersions(a, applied.diagram);
    expect(comparison.identical).toBe(false);
    expect(comparison.counts.deleted).toBeGreaterThanOrEqual(1);
    expect(comparison.counts.diagram).toBe(1);
    expect(comparison.changeSet?.origin).toBe('system');
  });
});
