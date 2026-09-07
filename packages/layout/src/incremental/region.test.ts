import { indexDiagram } from '@nivik/ir';
import { diagram, edge, group, node } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import { emptyGeometry } from '../geometry';
import { anchor, desiredPositions, nextTo, regionOf } from './region';

const at = (x: number, y: number) => ({ position: { x, y }, size: { w: 120, h: 56 } });
const layered = {
  algorithm: 'layered',
  direction: 'RIGHT',
  spacing: 'normal',
  edgeRouting: 'orthogonal',
  autoLayout: true,
} as const;

describe('regionOf (spec 03 §6.2 step 1 + decision 6)', () => {
  const d = diagram({
    groups: [group('svc', 'Services')],
    nodes: [
      node('web', 'Web', at(0, 0)),
      node('gw', 'Gateway', at(200, 0)),
      node('orders', 'Orders', { parent: 'svc', ...at(400, 0) }),
      node('users', 'Users', { parent: 'svc', ...at(400, 100) }),
      node('pay', 'Pay', { parent: 'svc', pinned: true, ...at(600, 0) }),
      node('stripe', 'Stripe', at(800, 0)),
      node('topic', 'order-events', { parent: 'svc' }),
    ],
    edges: [
      edge('e1', 'web', 'gw'),
      edge('e2', 'gw', 'orders'),
      edge('e3', 'orders', 'topic'),
      edge('e4', 'topic', 'pay'),
      edge('e5', 'pay', 'stripe'),
    ],
  });
  it('grows one hop plus same-group siblings, drops pinned nodes, and freezes the rest', () => {
    const { region, frozen, movable } = regionOf(d, indexDiagram(d), ['topic', 'e3', 'pay'], {
      topic: 'orders',
    });
    expect([...region].sort()).toEqual(['orders', 'stripe', 'topic', 'users']);
    expect([...frozen].sort()).toEqual(['gw', 'pay', 'web']);
    expect([...movable]).toEqual(['topic']);
  });
  it('makes hinted nodes movable and picks up unplaced nodes outside the region', () => {
    const withLoose = { ...d, nodes: [...d.nodes, node('loose', 'Loose')] };
    const { movable } = regionOf(withLoose, indexDiagram(withLoose), ['topic'], {
      topic: 'orders',
      users: 'gw',
    });
    expect([...movable].sort()).toEqual(['loose', 'topic', 'users']);
  });
  it('expands affected groups to their member nodes', () => {
    const { region } = regionOf(d, indexDiagram(d), ['svc'], {});
    expect(region.has('orders') && region.has('users') && region.has('topic')).toBe(true);
    expect(region.has('pay')).toBe(false);
  });
});

describe('nextTo / desiredPositions (spec 03 §6.2 step 3)', () => {
  const hint = { x: 400, y: 0, w: 120, h: 56 };
  const size = { w: 100, h: 40 };
  it('offsets one slot along the direction', () => {
    expect(nextTo(hint, size, 'RIGHT', 40)).toEqual({ x: 560, y: 0 });
    expect(nextTo(hint, size, 'LEFT', 40)).toEqual({ x: 260, y: 0 });
    expect(nextTo(hint, size, 'DOWN', 40)).toEqual({ x: 400, y: 96 });
    expect(nextTo(hint, size, 'UP', 40)).toEqual({ x: 400, y: -80 });
  });
  it('keeps placed nodes and groups where they are and derives hinted positions', () => {
    const d = diagram({
      groups: [group('g', 'G', { position: { x: 380, y: -60 }, size: { w: 400, h: 200 } })],
      nodes: [
        node('a', 'A', { parent: 'g', ...at(400, 0) }),
        node('n', 'N', { parent: 'g' }),
        node('m', 'M', { parent: 'g' }),
      ],
    });
    const sizes = new Map([
      ['a', { w: 120, h: 56 }],
      ['n', { w: 100, h: 40 }],
      ['m', { w: 100, h: 40 }],
    ]);
    const desired = desiredPositions(
      d,
      indexDiagram(d),
      sizes,
      new Set(['n', 'm']),
      { n: 'a' },
      layered,
    );
    expect(desired.get('g')).toEqual({ x: 380, y: -60 });
    expect(desired.get('a')).toEqual({ x: 400, y: 0 });
    expect(desired.get('n')).toEqual({ x: 560, y: 0 });
    expect(desired.has('m')).toBe(false);
  });
});

describe('anchor (spec 03 §6.2 step 5)', () => {
  it('shifts the movable nodes back by the mean drift of the adjacent fixed nodes', () => {
    const d = diagram({
      nodes: [node('a', 'A', at(0, 0)), node('b', 'B', at(300, 0)), node('n', 'N')],
      edges: [edge('e1', 'a', 'n'), edge('e2', 'b', 'x')],
    });
    const elk = emptyGeometry();
    elk.positions.set('a', { x: 30, y: 10 });
    elk.positions.set('b', { x: 340, y: 10 });
    elk.positions.set('n', { x: 200, y: 110 });
    const original = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 300, y: 0 }],
    ]);
    // only `a` is adjacent to the movable node → Δ = (30, 10)
    expect(anchor(d, new Set(['n']), elk, original).get('n')).toEqual({ x: 170, y: 100 });
  });
  it('falls back to every fixed node when nothing is adjacent', () => {
    const d = diagram({
      nodes: [node('a', 'A', at(0, 0)), node('b', 'B', at(300, 0)), node('n', 'N')],
    });
    const elk = emptyGeometry();
    elk.positions.set('a', { x: 10, y: 0 });
    elk.positions.set('b', { x: 330, y: 0 });
    elk.positions.set('n', { x: 500, y: 0 });
    const original = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 300, y: 0 }],
    ]);
    expect(anchor(d, new Set(['n']), elk, original).get('n')).toEqual({ x: 480, y: 0 });
  });
});
