import { type Diagram, indexDiagram } from '@nivik/ir';
import { diagram, group, node } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import { DefaultMeasurer, resolveSizes } from '../measure';
import { collectRequirements, measureTracks, rangeBox } from './metrics';
import { cellAt as c, planCells } from './plan';

const gridDiagram = (over: Partial<Diagram>): Diagram =>
  diagram({
    ...over,
    layout: {
      algorithm: 'grid',
      direction: 'RIGHT',
      spacing: 'normal',
      edgeRouting: 'orthogonal',
      autoLayout: true,
    },
  });

const tracks = (d: Diagram) => {
  const index = indexDiagram(d);
  const plan = planCells(d, index, new Set(), []);
  const sizes = resolveSizes(d, DefaultMeasurer, 'all');
  return measureTracks(plan, collectRequirements(d, index, plan, sizes, 24), 24);
};

describe('measureTracks (spec 03 §7.2 steps 3–5)', () => {
  it('widens a column to its widest single-span node and leaves the others at minCellW', () => {
    const d = gridDiagram({
      nodes: [
        node('a', 'A', { cell: c(0, 0) }),
        node('b', 'Payment Service Gateway Cluster', { cell: c(1, 0) }),
        node('x', 'X', { cell: c(2, 0) }),
      ],
    });
    const t = tracks(d);
    expect(t.colW).toEqual([120, 197, 120]);
    expect(t.rowH).toEqual([80]);
    expect(rangeBox(c(2, 0), t)).toEqual({ x: 120 + 24 + 197 + 24, y: 0, w: 120, h: 80 });
    expect(rangeBox(c(0, 0, 2, 1), t)).toEqual({ x: 0, y: 0, w: 120 + 24 + 197, h: 80 });
  });

  it('lets a spanning node stretch its columns evenly only when it does not fit', () => {
    const fits = gridDiagram({
      nodes: [
        node('a', 'A', { cell: c(0, 0) }),
        node('b', 'B', { cell: c(1, 0) }),
        node('s', 'Payment Service', { cell: c(0, 1, 2, 1) }),
      ],
    });
    expect(tracks(fits).colW).toEqual([120, 120]); // 197 ≤ 120 + 24 + 120
    const wide = gridDiagram({
      nodes: [
        node('a', 'A', { cell: c(0, 0) }),
        node('b', 'B', { cell: c(1, 0) }),
        node('s', 'X'.repeat(40), { cell: c(0, 1, 2, 1) }),
      ],
    });
    expect(tracks(wide).colW).toEqual([224, 224]); // 40 × 11 + 32 = 472 → shortfall 208 → +104 each
  });

  it('adds group padding on the edges a child shares with its group', () => {
    const d = gridDiagram({
      groups: [group('g', 'G', { cell: c(0, 0, 1, 2) })],
      nodes: [
        node('a', 'A', { parent: 'g', cell: c(0, 0) }),
        node('b', 'B', { parent: 'g', cell: c(0, 1) }),
      ],
    });
    const t = tracks(d);
    expect(t.colW).toEqual([120 + 24 + 24]);
    expect(t.rowH).toEqual([56 + 48, 56 + 24]);
  });

  it('sizes a stacked group from its children plus padding', () => {
    const d = gridDiagram({
      groups: [group('s', 'S', { cell: c(0, 0) })],
      nodes: [
        node('s1', 'Strong brand', { type: 'text', parent: 's' }),
        node('s2', 'Low churn', { type: 'text', parent: 's' }),
      ],
    });
    const t = tracks(d);
    expect(t.colW).toEqual([132 + 48]);
    expect(t.rowH).toEqual([24 + 24 + 24 + 48 + 24]);
  });

  it('tiles same-cell nodes horizontally when measuring', () => {
    const d = gridDiagram({
      nodes: [node('a', 'A', { cell: c(0, 0) }), node('b', 'B', { cell: c(0, 0) })],
    });
    expect(tracks(d).colW).toEqual([120 + 24 + 120]);
  });
});
