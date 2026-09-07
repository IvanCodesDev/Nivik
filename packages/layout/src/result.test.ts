import { diagram, edge, group, node } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import { emptyGeometry, fitGroups } from './geometry';
import { applyGeometry } from './result';

describe('applyGeometry', () => {
  it('writes geometry onto a copy and reports only real changes', () => {
    const d = diagram({
      nodes: [
        node('a', 'A', { position: { x: 0, y: 0 }, size: { w: 120, h: 56 } }),
        node('b', 'B'),
      ],
      edges: [edge('e', 'a', 'b')],
    });
    const g = emptyGeometry();
    g.positions.set('a', { x: 0, y: 0 });
    g.sizes.set('a', { w: 120, h: 56 });
    g.positions.set('b', { x: 200, y: 0 });
    g.sizes.set('b', { w: 120, h: 56 });
    g.routes.set('e', [
      { x: 120, y: 28 },
      { x: 200, y: 28 },
    ]);
    const { diagram: out, moved, routed } = applyGeometry(d, g);
    expect(moved).toEqual(['b']);
    expect(routed).toEqual(['e']);
    expect(out.nodes[1]?.position).toEqual({ x: 200, y: 0 });
    expect(out.edges[0]?.route?.points).toHaveLength(2);
    expect(out.version).toBe(d.version);
    expect(out.nodes[0]?.meta).toEqual(d.nodes[0]?.meta);
    expect(d.nodes[1]?.position).toBeUndefined();
  });
});

describe('fitGroups', () => {
  it('wraps placed children with GROUP_PAD, innermost groups first', () => {
    const d = diagram({
      groups: [group('outer', 'Outer'), group('inner', 'Inner', { parent: 'outer' })],
      nodes: [node('a', 'A', { parent: 'inner' }), node('b', 'B', { parent: 'outer' })],
    });
    const g = emptyGeometry();
    g.positions.set('a', { x: 100, y: 100 });
    g.sizes.set('a', { w: 120, h: 56 });
    g.positions.set('b', { x: 400, y: 100 });
    g.sizes.set('b', { w: 120, h: 56 });
    fitGroups(d, g);
    expect(g.positions.get('inner')).toEqual({ x: 76, y: 52 });
    expect(g.sizes.get('inner')).toEqual({ w: 168, h: 128 });
    expect(g.positions.get('outer')).toEqual({ x: 52, y: 4 });
    expect(g.sizes.get('outer')).toEqual({ w: 492, h: 200 });
  });
});
