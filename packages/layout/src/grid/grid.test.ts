import {
  type Diagram,
  type Rect,
  rectContains,
  rectOf,
  rectsIntersect,
  validateDiagram,
} from '@nivik/ir';
import { diagram, edge, node } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import { DefaultMeasurer, resolveSizes } from '../measure';
import { applyGeometry } from '../result';
import { cellAt as c, gridLayout, kanban, pyramid, swot, timeline, venn } from '../testing';
import { layoutGrid } from './index';

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
};
const run = (d: Diagram) =>
  applyGeometry(d, layoutGrid(d, resolveSizes(d, DefaultMeasurer, 'all'), d.layout, []));
const lay = (d: Diagram) => run(d).diagram;
const rect = (d: Diagram, id: string): Rect =>
  must(rectOf(must([...d.nodes, ...d.groups].find((element) => element.id === id))));
const codes = (d: Diagram) => validateDiagram(d).warnings.map((w) => w.code);
const gridDiagram = (over: Partial<Diagram>): Diagram => diagram({ ...over, layout: gridLayout() });

describe('grid recipes (spec 03 §7.2, §10)', () => {
  it('SWOT: four frames in a 2×2 grid, entries stacked inside', () => {
    const out = lay(swot());
    expect(codes(out)).not.toContain('W_OVERLAP');
    expect(codes(out)).not.toContain('W_GROUP_ESCAPE');
    const [s, w, o, t] = ['s', 'w', 'o', 't'].map((id) => rect(out, id));
    expect(s).toMatchObject({ x: 0, y: 0 });
    expect(must(w)).toMatchObject({ x: must(s).w + 24, y: 0 });
    expect(must(o)).toMatchObject({ x: 0, y: must(s).h + 24 });
    expect(must(t)).toMatchObject({ x: must(w).x, y: must(o).y });
    expect(rectsIntersect(must(s), must(w))).toBe(false);
    const s1 = rect(out, 's1');
    const s2 = rect(out, 's2');
    expect(s1).toMatchObject({ x: 24, y: 48 });
    expect(s2.y).toBe(s1.y + s1.h + 24);
    expect(rectContains(must(s), s1) && rectContains(must(s), s2)).toBe(true);
  });

  it('kanban: lanes span three rows side by side, cards stack top-down', () => {
    const out = lay(kanban());
    expect(codes(out)).not.toContain('W_OVERLAP');
    expect(codes(out)).not.toContain('W_GROUP_ESCAPE');
    const [todo, doing, done] = ['todo', 'doing', 'done'].map((id) => rect(out, id));
    expect([todo, doing, done].map((lane) => must(lane).y)).toEqual([0, 0, 0]);
    expect(must(doing).x).toBe(must(todo).x + must(todo).w + 24);
    expect(new Set([todo, doing, done].map((lane) => must(lane).h)).size).toBe(1);
    const k3 = rect(out, 'k3');
    const k4 = rect(out, 'k4');
    const k5 = rect(out, 'k5');
    expect(k3).toMatchObject({ x: must(doing).x + 24, y: 48 });
    expect(k4.y).toBe(k3.y + k3.h + 24);
    expect(k5.y).toBe(k4.y + k4.h + 24);
    expect(k4.x).toBe(k3.x);
  });

  it('timeline: the axis line fills its row across every column, events alternate above and below', () => {
    const out = lay(timeline());
    const axis = rect(out, 'axis');
    const e0 = rect(out, 'e0');
    const e1 = rect(out, 'e1');
    expect(axis.x).toBe(0);
    expect(axis.w).toBeGreaterThan(4 * 120);
    for (const id of ['e0', 'e1', 'e2', 'e3', 'e4']) {
      const r = rect(out, id);
      expect(r.x + r.w).toBeLessThanOrEqual(axis.x + axis.w);
    }
    expect(e0.y + e0.h).toBeLessThanOrEqual(axis.y);
    expect(e1.y).toBeGreaterThanOrEqual(axis.y + axis.h);
    expect(rectsIntersect(axis, rect(out, 'y0'))).toBe(true);
    expect(codes(out)).not.toContain('W_OVERLAP');
  });

  it('pyramid: layers fill their spans and share one centre line', () => {
    const out = lay(pyramid());
    const layers = ['p0', 'p1', 'p2', 'p3'].map((id) => rect(out, id));
    expect(layers.map((l) => l.w)).toEqual([552, 840, 1128, 1416]);
    expect(layers.map((l) => l.h)).toEqual([56, 56, 56, 56]);
    expect(new Set(layers.map((l) => l.x + l.w / 2)).size).toBe(1);
    expect(must(layers[1]).y).toBe(must(layers[0]).y + 56 + 24);
  });

  it('venn: intersecting ranges overlap on purpose without W_OVERLAP', () => {
    const out = lay(venn());
    const a = rect(out, 'a');
    const b = rect(out, 'b');
    const both = rect(out, 'both');
    expect(a.w).toBe(3 * 120 + 2 * 24);
    expect(rectsIntersect(a, b)).toBe(true);
    expect(rectsIntersect(both, a) && rectsIntersect(both, b)).toBe(true);
    expect(codes(out)).not.toContain('W_OVERLAP');
  });
});

describe('grid behaviour (spec 03 §7.2 steps 5–8, §10)', () => {
  it('compat: a cell-less diagram becomes a ceil(sqrt(n)) grid', () => {
    const out = lay(gridDiagram({ nodes: ['a', 'b', 'c', 'd', 'e'].map((id) => node(id, id)) }));
    expect(rect(out, 'b').x).toBe(rect(out, 'a').x + 120 + 24);
    expect(rect(out, 'd')).toMatchObject({ x: rect(out, 'a').x, y: rect(out, 'a').y + 56 + 24 });
  });

  it('moving one cell leaves untouched elements where they were; pinned nodes keep their pixels', () => {
    const base = gridDiagram({
      nodes: [
        node('a', 'A', { cell: c(0, 0) }),
        node('b', 'B', { cell: c(1, 0) }),
        node('x', 'X', { cell: c(2, 0) }),
        node('p', 'P', {
          cell: c(0, 0),
          pinned: true,
          position: { x: 900, y: 900 },
          size: { w: 100, h: 40 },
        }),
      ],
    });
    const first = run(base);
    expect(first.moved).toEqual(['a', 'b', 'x']);
    const changed: Diagram = {
      ...first.diagram,
      nodes: first.diagram.nodes.map((n) => (n.id === 'x' ? { ...n, cell: c(2, 2) } : n)),
    };
    const second = run(changed);
    expect(second.moved).toEqual(['x']);
    expect(rect(second.diagram, 'p')).toEqual({ x: 900, y: 900, w: 100, h: 40 });
  });

  it('tiles explicit same-cell nodes horizontally and centres them', () => {
    const out = lay(
      gridDiagram({
        nodes: [node('a', 'A', { cell: c(0, 0) }), node('b', 'B', { cell: c(0, 0) })],
      }),
    );
    const a = rect(out, 'a');
    const b = rect(out, 'b');
    expect(b.x).toBe(a.x + a.w + 24);
    expect(a.y).toBe(b.y);
    expect(rectsIntersect(a, b)).toBe(false);
  });

  it('routes edges orthogonally between placed cells, straight when asked', () => {
    const base = gridDiagram({
      nodes: [node('a', 'A', { cell: c(0, 0) }), node('b', 'B', { cell: c(2, 1) })],
      edges: [edge('e', 'a', 'b')],
    });
    const points = must(lay(base).edges[0]?.route).points;
    expect(points).toEqual([
      { x: 120, y: 28 },
      { x: 204, y: 28 },
      { x: 204, y: 108 },
      { x: 288, y: 108 },
    ]);
    const straight = lay({ ...base, layout: { ...base.layout, edgeRouting: 'straight' } });
    expect(straight.edges[0]?.route?.points).toHaveLength(2);
  });
});
