import type { LayoutSpec } from '@nivik/ir';
import { diagram, edge, group, node, orderPlatform } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import { rootOptions, toElk } from './to-elk';

const layered = (over: Partial<LayoutSpec> = {}): LayoutSpec => ({
  algorithm: 'layered',
  direction: 'RIGHT',
  spacing: 'normal',
  edgeRouting: 'orthogonal',
  autoLayout: true,
  ...over,
});

describe('rootOptions (spec 03 §5.2)', () => {
  it('maps the compact preset', () => {
    expect(
      rootOptions(layered({ direction: 'DOWN', spacing: 'compact', edgeRouting: 'polyline' })),
    ).toMatchObject({
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'POLYLINE',
      'elk.spacing.nodeNode': '24',
      'elk.layered.spacing.nodeNodeBetweenLayers': '48',
      'elk.spacing.edgeNode': '16',
      'elk.layered.spacing.edgeNodeBetweenLayers': '16',
      'elk.spacing.edgeEdge': '12',
      'elk.spacing.componentComponent': '48',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.mergeEdges': 'false',
      'elk.separateConnectedComponents': 'true',
    });
  });
  it('uses ORTHOGONAL for the default routing and UNDEFINED for straight', () => {
    expect(rootOptions(layered())['elk.edgeRouting']).toBe('ORTHOGONAL');
    expect(rootOptions(layered({ spacing: 'loose', edgeRouting: 'straight' }))).toMatchObject({
      'elk.edgeRouting': 'UNDEFINED',
      'elk.spacing.nodeNode': '64',
      'elk.layered.spacing.nodeNodeBetweenLayers': '110',
      'elk.spacing.componentComponent': '128',
    });
  });
});

describe('toElk (spec 03 §5.1)', () => {
  it('nests groups as padded compound nodes and sizes the leaves', () => {
    const d = orderPlatform();
    const sizes = new Map(d.nodes.map((n) => [n.id, { w: 100, h: 40 }]));
    const root = toElk(d, sizes, d.layout);
    expect(root.children?.map((c) => c.id)).toEqual([
      'web',
      'pg',
      'redis',
      'mq',
      'stripe',
      'edge',
      'svc',
    ]);
    expect(root.children?.[0]).toMatchObject({ id: 'web', width: 100, height: 40 });
    const svc = root.children?.find((c) => c.id === 'svc');
    expect(svc?.layoutOptions?.['elk.padding']).toBe('[top=48,left=24,bottom=24,right=24]');
    expect(svc?.children?.map((c) => c.id)).toEqual(['users', 'orders', 'pay']);
    expect(root.edges).toHaveLength(10);
    expect(root.edges?.[0]).toMatchObject({ id: 'e1', sources: ['web'], targets: ['gw'] });
  });
  it('turns fixed sides into FIXED_SIDE ports', () => {
    const d = diagram({
      nodes: [node('a', 'A'), node('b', 'B')],
      edges: [edge('e', 'a', 'b', { sourceSide: 'bottom', targetSide: 'top' })],
    });
    const root = toElk(
      d,
      new Map([
        ['a', { w: 1, h: 1 }],
        ['b', { w: 1, h: 1 }],
      ]),
      d.layout,
    );
    const a = root.children?.find((c) => c.id === 'a');
    expect(a?.layoutOptions?.['elk.portConstraints']).toBe('FIXED_SIDE');
    expect(a?.ports?.[0]).toMatchObject({
      id: 'e__source',
      layoutOptions: { 'elk.port.side': 'SOUTH' },
    });
    expect(root.edges?.[0]).toMatchObject({ sources: ['e__source'], targets: ['e__target'] });
  });
  it('gives empty groups a body of their own', () => {
    const d = diagram({ groups: [group('g', 'G')] });
    expect(toElk(d, new Map(), d.layout).children?.[0]).toMatchObject({
      id: 'g',
      width: 168,
      height: 128,
    });
  });
});
