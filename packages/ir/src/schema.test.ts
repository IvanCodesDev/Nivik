import { describe, expect, it } from 'vitest';
import {
  DIAGRAM_FAMILIES,
  DIAGRAM_SCHEMA_VERSION,
  DiagramEdgeSchema,
  DiagramGroupSchema,
  DiagramNodeSchema,
  DiagramSchema,
  DiagramTypeSchema,
  familyOf,
  ROLE_VOCABULARY,
  StyleTokensSchema,
  WELL_KNOWN_DIAGRAM_TYPES,
} from './schema';
import { diagram, edge, meta, node } from './testing/builders';
import { orderPlatform } from './testing/order-platform';

const issuePaths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.success ? [] : (result.error?.issues.map((issue) => issue.path.join('.')) ?? []);

describe('DiagramSchema round trip', () => {
  it('parses its own JSON serialization back to a deep-equal diagram', () => {
    const original = orderPlatform();
    const parsed = DiagramSchema.parse(JSON.parse(JSON.stringify(original)));
    expect(parsed).toEqual(original);
  });

  it('pins the schema literal', () => {
    expect(DIAGRAM_SCHEMA_VERSION).toBe('nivik.diagram/1');
    const result = DiagramSchema.safeParse({ ...orderPlatform(), schema: 'nivik.diagram/2' });
    expect(issuePaths(result)).toEqual(['schema']);
  });
});

describe('defaults', () => {
  it('fills node defaults (parent null, pinned false)', () => {
    const parsed = DiagramNodeSchema.parse({ id: 'a', type: 'box', label: 'A', meta: meta() });
    expect(parsed).toEqual({
      id: 'a',
      type: 'box',
      label: 'A',
      parent: null,
      pinned: false,
      meta: meta(),
    });
  });

  it('fills edge defaults (type flow, forward, auto sides)', () => {
    const parsed = DiagramEdgeSchema.parse({ id: 'e', source: 'a', target: 'b', meta: meta() });
    expect(parsed).toMatchObject({
      type: 'flow',
      direction: 'forward',
      sourceSide: 'auto',
      targetSide: 'auto',
    });
  });

  it('fills group defaults (role cluster, not collapsed, top level)', () => {
    const parsed = DiagramGroupSchema.parse({ id: 'g', meta: meta() });
    expect(parsed).toMatchObject({ role: 'cluster', collapsed: false, parent: null });
  });

  it('fills diagram-level defaults for layout, theme, renderer and sources', () => {
    const minimal = {
      schema: 'nivik.diagram/1',
      id: 'd_min',
      name: 'Minimal',
      type: 'flow',
      version: 1,
      nodes: [],
      edges: [],
      groups: [],
      layout: {},
      theme: {},
      renderer: {},
      meta: { createdAt: 1, updatedAt: 1 },
    };
    const parsed = DiagramSchema.parse(minimal);
    expect(parsed.layout).toEqual({
      algorithm: 'layered',
      direction: 'RIGHT',
      spacing: 'normal',
      edgeRouting: 'orthogonal',
      autoLayout: true,
    });
    expect(parsed.theme).toEqual({ preset: 'nivik-soft', strokeStyle: 'clean', fontScale: 'm' });
    expect(parsed.renderer).toEqual({ preferred: 'excalidraw', state: {} });
    expect(parsed.sources).toEqual([]);
  });

  it('accepts renderer state for a subset of renderers', () => {
    const parsed = DiagramSchema.parse({
      ...diagram(),
      renderer: { preferred: 'excalidraw', state: { excalidraw: { viewport: [0, 0] } } },
    });
    expect(parsed.renderer.state).toEqual({ excalidraw: { viewport: [0, 0] } });
  });
});

describe('typed data per node/edge type', () => {
  it('requires entity columns', () => {
    const result = DiagramNodeSchema.safeParse(node('users', 'users', { type: 'entity' }));
    expect(issuePaths(result)).toEqual(['data.columns']);
  });

  it('accepts a valid entity', () => {
    const result = DiagramNodeSchema.safeParse(
      node('users', 'users', {
        type: 'entity',
        data: {
          columns: [
            { name: 'id', type: 'int', pk: true },
            { name: 'org_id', fk: 'orgs' },
          ],
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects unknown keys inside typed data', () => {
    const result = DiagramNodeSchema.safeParse(
      node('u', 'User', { type: 'participant', data: { kind: 'actor', colour: 'red' } }),
    );
    expect(issuePaths(result)).toEqual(['data']);
  });

  it('requires state kind to be one of the known kinds', () => {
    const result = DiagramNodeSchema.safeParse(
      node('s', 'Idle', { type: 'state', data: { kind: 'sleeping' } }),
    );
    expect(issuePaths(result)).toEqual(['data.kind']);
  });

  it('leaves data free-form for untyped node types', () => {
    const result = DiagramNodeSchema.safeParse(
      node('b', 'Box', { type: 'box', data: { anything: { goes: true } } }),
    );
    expect(result.success).toBe(true);
  });

  it('requires message order and kind on message edges', () => {
    const result = DiagramEdgeSchema.safeParse(edge('m1', 'a', 'b', { type: 'message' }));
    expect(issuePaths(result).sort()).toEqual(['data.kind', 'data.order']);
  });

  it('validates relation cardinality', () => {
    const bad = DiagramEdgeSchema.safeParse(
      edge('r1', 'a', 'b', { type: 'relation', data: { cardinality: '2-3' } }),
    );
    expect(issuePaths(bad)).toEqual(['data.cardinality']);
    const good = DiagramEdgeSchema.safeParse(
      edge('r1', 'a', 'b', { type: 'relation', data: { cardinality: '1-n', identifying: true } }),
    );
    expect(good.success).toBe(true);
  });
});

describe('style tokens', () => {
  it('rejects unknown token keys and malformed override colours', () => {
    const unknownKey = StyleTokensSchema.safeParse({ colour: 'red' });
    expect(unknownKey.success).toBe(false);
    expect(unknownKey.error?.issues[0]).toMatchObject({
      code: 'unrecognized_keys',
      keys: ['colour'],
    });
    expect(issuePaths(StyleTokensSchema.safeParse({ override: { fill: 'red' } }))).toEqual([
      'override.fill',
    ]);
    expect(
      StyleTokensSchema.safeParse({ palette: 'mint', override: { fill: '#AABBCC' } }).success,
    ).toBe(true);
  });
});

describe('role vocabulary', () => {
  it('exposes the recommended roles and still accepts roles outside it', () => {
    expect(ROLE_VOCABULARY).toContain('gateway');
    expect(ROLE_VOCABULARY).toContain('database');
    const result = DiagramNodeSchema.safeParse(node('x', 'X', { role: 'toaster' }));
    expect(result.success).toBe(true);
  });
});

describe('diagram type (open label, spec 01 §3.1)', () => {
  it('accepts any lowercase slug, well-known or not', () => {
    for (const type of ['flow', 'customer-journey', 'c4', 'x', 'a'.repeat(40)]) {
      expect(DiagramTypeSchema.safeParse(type).success, type).toBe(true);
    }
  });

  it('rejects malformed labels', () => {
    for (const type of ['', 'Bad Type', 'Flow', '-flow', '1flow', 'flow_chart', 'a'.repeat(41)]) {
      expect(DiagramTypeSchema.safeParse(type).success, type).toBe(false);
    }
  });

  it('maps well-known types to their arrangement family and everything else to null', () => {
    expect(familyOf('architecture')).toBe('graph');
    expect(familyOf('mindmap')).toBe('tree');
    expect(familyOf('sequence')).toBe('time');
    expect(familyOf('swot')).toBe('grid');
    expect(familyOf('venn')).toBe('arrangement');
    expect(familyOf('generic')).toBeNull();
    expect(familyOf('wardley-map')).toBeNull();
    expect(familyOf('x')).toBeNull();
  });

  it('lists every family member plus generic exactly once, all valid slugs', () => {
    const fromFamilies = Object.values(DIAGRAM_FAMILIES).flat();
    expect(WELL_KNOWN_DIAGRAM_TYPES).toEqual([...fromFamilies, 'generic']);
    expect(new Set(WELL_KNOWN_DIAGRAM_TYPES).size).toBe(WELL_KNOWN_DIAGRAM_TYPES.length);
    for (const type of WELL_KNOWN_DIAGRAM_TYPES) {
      expect(DiagramTypeSchema.safeParse(type).success, type).toBe(true);
    }
    expect(fromFamilies).toHaveLength(17 + 5 + 4 + 9 + 5);
  });

  it('accepts a whole diagram whose type is outside the vocabulary', () => {
    expect(DiagramSchema.safeParse({ ...diagram(), type: 'wardley-map' }).success).toBe(true);
    expect(issuePaths(DiagramSchema.safeParse({ ...diagram(), type: 'Wardley Map' }))).toEqual([
      'type',
    ]);
  });
});
