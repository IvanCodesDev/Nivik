import { diagram, edge, node, orderPlatform } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import { DefaultMeasurer, resolveSizes } from '../measure';
import { fallbackLayered } from './fallback';

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
};

describe('fallbackLayered (spec 03 §5.4)', () => {
  it('columns follow BFS depth along the direction; groups wrap their members', () => {
    const d = orderPlatform();
    const g = fallbackLayered(d, resolveSizes(d, DefaultMeasurer, 'all'), d.layout);
    const x = (id: string) => must(g.positions.get(id)).x;
    expect(x('web')).toBeLessThan(x('gw'));
    expect(x('gw')).toBeLessThan(x('users'));
    expect(x('orders')).toBeLessThan(x('pay'));
    expect(d.nodes.every((n) => g.positions.has(n.id) && g.sizes.has(n.id))).toBe(true);
    expect(g.positions.has('svc')).toBe(true);
    expect(g.routes.size).toBe(10);
  });

  it('still places every node of a cyclic graph and honours DOWN', () => {
    const d = diagram({
      nodes: [node('a', 'A'), node('b', 'B'), node('c', 'C')],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'a'), edge('e3', 'b', 'c')],
      layout: {
        algorithm: 'layered',
        direction: 'DOWN',
        spacing: 'normal',
        edgeRouting: 'orthogonal',
        autoLayout: true,
      },
    });
    const g = fallbackLayered(d, resolveSizes(d, DefaultMeasurer, 'all'), d.layout);
    expect(g.positions.size).toBe(3);
    const y = (id: string) => must(g.positions.get(id)).y;
    expect(new Set([y('a'), y('b'), y('c')]).size).toBe(1);
  });
});
