import { describe, expect, it } from 'vitest';
import { DiagramSchema } from './schema';
import { diagram, edge, group, node } from './testing/builders';
import { orderPlatform } from './testing/order-platform';
import { validateDiagram } from './validate';

const errorCodes = (d: Parameters<typeof validateDiagram>[0]) =>
  validateDiagram(d).errors.map((issue) => issue.code);

describe('validateDiagram — structural errors', () => {
  it('passes a well-formed diagram', () => {
    const result = validateDiagram(orderPlatform());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('E_ID_COLLISION when nodes, edges and groups share an id', () => {
    const d = diagram({
      nodes: [node('a', 'A'), node('b', 'B')],
      edges: [edge('a', 'a', 'b')],
      groups: [group('b', 'B group')],
    });
    const result = validateDiagram(d);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'E_ID_COLLISION', severity: 'error', ids: ['a', 'b'] }),
    ]);
  });

  it('E_UNKNOWN_REF for edges, parents and entity foreign keys', () => {
    const d = diagram({
      type: 'generic',
      nodes: [
        node('a', 'A', { parent: 'ghost-group' }),
        node('t', 'T', {
          type: 'entity',
          data: { columns: [{ name: 'org_id', fk: 'ghost-entity' }] },
        }),
      ],
      edges: [edge('e1', 'a', 'ghost-node')],
      groups: [group('g', 'G', { parent: 'ghost-parent' })],
    });
    const result = validateDiagram(d);
    const unknown = result.errors.filter((issue) => issue.code === 'E_UNKNOWN_REF');
    expect(unknown.map((issue) => issue.ids)).toEqual([['a'], ['t'], ['e1'], ['g']]);
    expect(unknown[2]?.message).toContain('ghost-node');
  });

  it('E_REF_KIND when an edge points at a group or a parent is not a group', () => {
    const d = diagram({
      nodes: [node('a', 'A'), node('b', 'B', { parent: 'a' })],
      edges: [edge('e1', 'a', 'g')],
      groups: [group('g', 'G')],
    });
    const result = validateDiagram(d);
    expect(result.errors.filter((issue) => issue.code === 'E_REF_KIND')).toEqual([
      expect.objectContaining({ ids: ['b'] }),
      expect.objectContaining({ ids: ['e1'] }),
    ]);
  });

  it('E_PARENT_CYCLE when group parents form a cycle', () => {
    const d = diagram({
      groups: [group('g1', 'G1', { parent: 'g2' }), group('g2', 'G2', { parent: 'g1' })],
    });
    expect(validateDiagram(d).errors).toEqual([
      expect.objectContaining({ code: 'E_PARENT_CYCLE', ids: ['g1', 'g2'] }),
    ]);
  });

  it('E_SELF_LOOP only for edge types that cannot loop', () => {
    const looping = diagram({
      nodes: [node('a', 'A')],
      edges: [edge('e1', 'a', 'a')],
    });
    expect(errorCodes(looping)).toEqual(['E_SELF_LOOP']);

    const legal = diagram({
      type: 'state',
      nodes: [node('a', 'A', { type: 'state', data: { kind: 'normal' } })],
      edges: [
        edge('e1', 'a', 'a', { type: 'transition' }),
        edge('e2', 'a', 'a', { type: 'message', data: { order: 1, kind: 'sync' } }),
      ],
    });
    expect(errorCodes(legal)).toEqual([]);
  });
});

describe('DiagramSchema enforces the structural rules at parse time', () => {
  it('rejects a diagram with an unknown edge target', () => {
    const d = diagram({ nodes: [node('a', 'A')], edges: [edge('e1', 'a', 'nope')] });
    const result = DiagramSchema.safeParse(d);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        code: 'custom',
        path: ['edges', 0],
        params: expect.objectContaining({ code: 'E_UNKNOWN_REF', ids: ['e1'] }),
      }),
    ]);
  });

  it('accepts the order platform fixture', () => {
    expect(DiagramSchema.safeParse(orderPlatform()).success).toBe(true);
  });
});
