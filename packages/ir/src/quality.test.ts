import { describe, expect, it } from 'vitest';
import { diagram, edge, group, node } from './testing/builders';
import { orderPlatform } from './testing/order-platform';
import { validateDiagram } from './validate';

const warnings = (d: Parameters<typeof validateDiagram>[0], code?: string) =>
  validateDiagram(d).warnings.filter((issue) => code === undefined || issue.code === code);

const box = (x: number, y: number, w = 100, h = 50) => ({ position: { x, y }, size: { w, h } });

describe('validateDiagram — quality warnings', () => {
  it('reports no warnings for the order platform fixture and keeps ok=true', () => {
    const result = validateDiagram(orderPlatform());
    expect(result.warnings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('W_ORPHAN_NODE for unconnected top-level nodes, except annotations and grouped nodes', () => {
    const d = diagram({
      nodes: [
        node('a', 'A'),
        node('b', 'B'),
        node('lonely', 'Lonely'),
        node('memo', 'Memo', { type: 'note' }),
        node('inside', 'Inside', { parent: 'g' }),
      ],
      edges: [edge('e1', 'a', 'b')],
      groups: [group('g', 'G')],
    });
    expect(warnings(d, 'W_ORPHAN_NODE')).toEqual([
      expect.objectContaining({ severity: 'warning', ids: ['lonely'] }),
    ]);
  });

  it('W_DUPLICATE_EDGE when source, target, type and label all repeat', () => {
    const d = diagram({
      nodes: [node('a', 'A'), node('b', 'B')],
      edges: [
        edge('e1', 'a', 'b', { label: 'call' }),
        edge('e2', 'a', 'b', { label: 'call' }),
        edge('e3', 'a', 'b', { label: 'retry' }),
        edge('e4', 'a', 'b', { label: 'call', type: 'data' }),
      ],
    });
    expect(warnings(d, 'W_DUPLICATE_EDGE')).toEqual([
      expect.objectContaining({ ids: ['e1', 'e2'] }),
    ]);
  });

  it('W_OVERLAP once per intersecting pair of laid-out siblings', () => {
    const d = diagram({
      nodes: [
        node('a', 'A', box(0, 0)),
        node('b', 'B', box(50, 20)),
        node('c', 'C', box(80, 40)),
        node('adjacent', 'Adjacent', box(-100, 0)),
        node('other-group', 'Other', { ...box(10, 10), parent: 'g' }),
        node('unplaced', 'Unplaced'),
      ],
      edges: [
        edge('e1', 'a', 'b'),
        edge('e2', 'b', 'c'),
        edge('e3', 'c', 'adjacent'),
        edge('e4', 'adjacent', 'unplaced'),
      ],
      groups: [group('g', 'G')],
    });
    expect(warnings(d, 'W_OVERLAP').map((issue) => issue.ids)).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });

  it('W_LABEL_TOO_LONG for labels over 60 chars or more than 3 lines', () => {
    const d = diagram({
      nodes: [
        node('long', 'x'.repeat(61)),
        node('tall', 'one\ntwo\nthree\nfour'),
        node('fine', 'three\nlines\nok'),
      ],
      edges: [edge('e1', 'long', 'tall'), edge('e2', 'tall', 'fine')],
    });
    expect(warnings(d, 'W_LABEL_TOO_LONG').map((issue) => issue.ids)).toEqual([['long'], ['tall']]);
  });

  it('W_EMPTY_GROUP for groups without nodes or nested groups', () => {
    const d = diagram({
      nodes: [node('a', 'A', { parent: 'full' }), node('b', 'B')],
      edges: [edge('e1', 'a', 'b')],
      groups: [
        group('full', 'Full'),
        group('outer', 'Outer'),
        group('inner', 'Inner', { parent: 'outer' }),
      ],
    });
    expect(warnings(d, 'W_EMPTY_GROUP')).toEqual([expect.objectContaining({ ids: ['inner'] })]);
  });

  it('W_GROUP_ESCAPE when a node leaves its group bounding box', () => {
    const d = diagram({
      nodes: [
        node('a', 'A', { ...box(10, 10), parent: 'g' }),
        node('b', 'B', { ...box(250, 10), parent: 'g' }),
      ],
      edges: [edge('e1', 'a', 'b')],
      groups: [group('g', 'G', box(0, 0, 200, 100))],
    });
    expect(warnings(d, 'W_GROUP_ESCAPE')).toEqual([expect.objectContaining({ ids: ['b', 'g'] })]);
  });

  it('W_EDGE_CROSS_NODE only for orthogonal routes crossing a non-endpoint node', () => {
    const nodes = [
      node('a', 'A', box(0, 0)),
      node('b', 'B', box(200, 0)),
      node('c', 'C', box(400, 0)),
    ];
    const edges = [
      edge('e1', 'a', 'c', {
        route: {
          points: [
            { x: 100, y: 25 },
            { x: 400, y: 25 },
          ],
        },
      }),
      edge('e2', 'a', 'b'),
      edge('e3', 'b', 'c', {
        route: {
          points: [
            { x: 300, y: 25 },
            { x: 400, y: 25 },
          ],
        },
      }),
    ];
    const orthogonal = diagram({ nodes, edges });
    expect(warnings(orthogonal, 'W_EDGE_CROSS_NODE')).toEqual([
      expect.objectContaining({ ids: ['e1', 'b'] }),
    ]);

    const polyline = diagram({
      nodes,
      edges,
      layout: { ...orthogonal.layout, edgeRouting: 'polyline' },
    });
    expect(warnings(polyline, 'W_EDGE_CROSS_NODE')).toEqual([]);
  });

  it('W_TYPE_MISMATCH when node types do not fit the diagram type', () => {
    const sequence = diagram({
      type: 'sequence',
      nodes: [
        node('u', 'User', { type: 'participant', data: { kind: 'actor' } }),
        node('api', 'API', { type: 'rounded' }),
        node('memo', 'Memo', { type: 'note' }),
      ],
      edges: [edge('m1', 'u', 'api', { type: 'message', data: { order: 1, kind: 'sync' } })],
    });
    expect(warnings(sequence, 'W_TYPE_MISMATCH')).toEqual([
      expect.objectContaining({ ids: ['api'] }),
    ]);

    const erd = diagram({
      type: 'erd',
      nodes: [
        node('users', 'users', { type: 'entity', data: { columns: [{ name: 'id' }] } }),
        node('cache', 'Cache', { type: 'cylinder' }),
      ],
      edges: [edge('r1', 'users', 'cache', { type: 'relation', data: { cardinality: '1-n' } })],
    });
    expect(warnings(erd, 'W_TYPE_MISMATCH')).toEqual([expect.objectContaining({ ids: ['cache'] })]);
  });
});
