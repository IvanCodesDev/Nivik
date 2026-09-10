import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  childrenOf,
  createDiagram,
  descendantsOf,
  duplicateDiagram,
  indexDiagram,
  neighborhood,
} from './helpers';
import { ID_PATTERN } from './ids';
import { DiagramSchema } from './schema';
import { diagram, edge, group, node } from './testing/builders';
import { orderPlatform } from './testing/order-platform';

describe('createDiagram', () => {
  it('creates an empty, valid diagram at version 1 with defaults filled', () => {
    const d = createDiagram({ name: 'Fresh', type: 'flow', now: 1234 });
    expect(DiagramSchema.safeParse(d).success).toBe(true);
    expect(d).toMatchObject({
      schema: 'nivik.diagram/1',
      name: 'Fresh',
      type: 'flow',
      version: 1,
      nodes: [],
      edges: [],
      groups: [],
      layout: { algorithm: 'layered', direction: 'RIGHT' },
      renderer: { preferred: 'excalidraw', state: {} },
      meta: { createdAt: 1234, updatedAt: 1234 },
    });
    expect(d.id.startsWith('d_')).toBe(true);
    expect(ID_PATTERN.test(d.id)).toBe(true);
  });

  it('honours an explicit id', () => {
    expect(createDiagram({ name: 'X', type: 'generic', id: 'my-diagram' }).id).toBe('my-diagram');
  });

  it('defaults the type to generic until the plan stage classifies the diagram', () => {
    expect(createDiagram({ name: 'Blank' }).type).toBe('generic');
    expect(createDiagram({ name: 'Open', type: 'customer-journey' }).type).toBe('customer-journey');
  });
});

describe('duplicateDiagram', () => {
  it('copies the document under a new id at version 1 and leaves the original alone', () => {
    const source = { ...orderPlatform(), version: 7, meta: { createdAt: 1, updatedAt: 2 } };
    const before = structuredClone(source);
    const copy = duplicateDiagram(source, { now: 99 });

    expect(DiagramSchema.safeParse(copy).success).toBe(true);
    expect(copy.id).not.toBe(source.id);
    expect(copy.id.startsWith('d_')).toBe(true);
    expect(copy.version).toBe(1);
    expect(copy.meta).toEqual({ createdAt: 99, updatedAt: 99 });
    expect(copy.name).toBe(source.name);
    expect(copy.nodes).toEqual(source.nodes);
    expect(copy.nodes).not.toBe(source.nodes);
    expect(source).toEqual(before);
  });

  it('takes an explicit id and name', () => {
    const copy = duplicateDiagram(orderPlatform(), { id: 'd_copy0001', name: 'Copy of Order' });
    expect(copy).toMatchObject({ id: 'd_copy0001', name: 'Copy of Order' });
  });
});

describe('indexDiagram', () => {
  const index = indexDiagram(orderPlatform());

  it('indexes nodes, edges and groups by id', () => {
    expect(index.nodes.size).toBe(9);
    expect(index.edges.size).toBe(10);
    expect(index.groups.size).toBe(2);
    expect(index.nodes.get('pay')?.pinned).toBe(true);
  });

  it('groups children by parent, nodes before groups, top level under null', () => {
    expect(index.byParent.get(null)).toEqual(['web', 'pg', 'redis', 'mq', 'stripe', 'edge', 'svc']);
    expect(index.byParent.get('svc')).toEqual(['users', 'orders', 'pay']);
    expect(index.byParent.get('edge')).toEqual(['gw']);
  });

  it('lists incident edges per node in edge order', () => {
    expect(index.edgesByNode.get('orders')).toEqual(['e3', 'e4', 'e5', 'e7']);
    expect(index.edgesByNode.get('stripe')).toEqual(['e9']);
  });
});

describe('childrenOf / descendantsOf', () => {
  const nested = diagram({
    nodes: [
      node('y', 'Y', { parent: 'outer' }),
      node('x', 'X', { parent: 'inner' }),
      node('z', 'Z'),
    ],
    edges: [edge('e1', 'x', 'y'), edge('e2', 'y', 'z')],
    groups: [group('outer', 'Outer'), group('inner', 'Inner', { parent: 'outer' })],
  });

  it('returns direct children only', () => {
    expect(childrenOf(nested, 'outer')).toEqual(['y', 'inner']);
    expect(childrenOf(nested, 'inner')).toEqual(['x']);
  });

  it('returns all descendants depth-first', () => {
    expect(descendantsOf(nested, 'outer')).toEqual(['y', 'inner', 'x']);
    expect(descendantsOf(nested, 'inner')).toEqual(['x']);
  });
});

describe('boundsOf', () => {
  const placed = diagram({
    nodes: [
      node('a', 'A', { position: { x: 0, y: 0 }, size: { w: 100, h: 50 } }),
      node('b', 'B', { position: { x: 150, y: 100 }, size: { w: 100, h: 50 } }),
      node('c', 'C'),
    ],
    edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    groups: [group('g', 'G', { position: { x: -20, y: -20 }, size: { w: 10, h: 10 } })],
  });

  it('unions the rects of the given elements and ignores unplaced ones', () => {
    expect(boundsOf(placed, ['a', 'b', 'c'])).toEqual({ x: 0, y: 0, w: 250, h: 150 });
    expect(boundsOf(placed, ['a', 'g'])).toEqual({ x: -20, y: -20, w: 120, h: 70 });
  });

  it('returns null when nothing is placed', () => {
    expect(boundsOf(placed, ['c'])).toBeNull();
    expect(boundsOf(placed, [])).toBeNull();
  });
});

describe('neighborhood', () => {
  const d = orderPlatform();

  it('includes the seeds and nodes within N undirected hops', () => {
    expect([...neighborhood(d, ['orders'], 1)].sort()).toEqual(['gw', 'mq', 'orders', 'pay', 'pg']);
    expect([...neighborhood(d, ['orders'], 2)].sort()).toEqual([
      'gw',
      'mq',
      'orders',
      'pay',
      'pg',
      'stripe',
      'users',
      'web',
    ]);
  });

  it('ignores unknown seeds', () => {
    expect(neighborhood(d, ['nope'], 2)).toEqual([]);
  });
});
