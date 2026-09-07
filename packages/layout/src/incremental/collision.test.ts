import { indexDiagram, type Rect, rectsIntersect } from '@nivik/ir';
import { diagram, edge, group, node } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import { emptyGeometry, rectIn } from '../geometry';
import type { LayoutWarning } from '../types';
import { orderByReference, refitGroups, rerouteEdges, resolveCollisions } from './collision';

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
};
const layered = {
  algorithm: 'layered',
  direction: 'RIGHT',
  spacing: 'normal',
  edgeRouting: 'orthogonal',
  autoLayout: true,
} as const;
const r = (x: number, y: number, w = 120, h = 56): Rect => ({ x, y, w, h });

describe('resolveCollisions (spec 03 §6.2 step 6)', () => {
  it('pushes a colliding node perpendicular to the flow until it is free', () => {
    const rects = new Map([['n', r(360, 200)]]);
    const fixed = [
      { id: 'b1', rect: r(360, 200) },
      { id: 'b2', rect: r(360, 296) },
    ];
    const warnings: LayoutWarning[] = [];
    resolveCollisions(['n'], rects, fixed, layered, warnings);
    expect(rects.get('n')).toEqual(r(360, 360));
    expect(fixed.every((f) => !rectsIntersect(f.rect, r(360, 360)))).toBe(true);
    expect(warnings).toEqual([]);
  });
  it('pushes horizontally when the flow is vertical', () => {
    const rects = new Map([['n', r(100, 300)]]);
    resolveCollisions(
      ['n'],
      rects,
      [{ id: 'b', rect: r(100, 300) }],
      { ...layered, direction: 'DOWN' },
      [],
    );
    expect(rects.get('n')?.x).toBe(100 + 3 * 40);
  });
  it('reports W_PIN_OVERLAP after twelve steps against a wall', () => {
    const rects = new Map([['n', r(360, 200)]]);
    const warnings: LayoutWarning[] = [];
    resolveCollisions(
      ['n'],
      rects,
      [{ id: 'wall', rect: r(360, -2000, 120, 4000) }],
      layered,
      warnings,
    );
    expect(warnings).toEqual([
      { code: 'W_PIN_OVERLAP', ids: ['n', 'wall'], message: expect.any(String) },
    ]);
    expect(rects.get('n')?.y).toBe(200 + 12 * 40);
  });
  it('places later nodes against earlier ones too', () => {
    const rects = new Map([
      ['n1', r(0, 0)],
      ['n2', r(0, 0)],
    ]);
    resolveCollisions(['n1', 'n2'], rects, [], layered, []);
    expect(rectsIntersect(r(0, 0), rects.get('n2') ?? r(0, 0))).toBe(false);
  });
});

describe('orderByReference', () => {
  it('sorts by distance to the hint (or first neighbour), unreferenced nodes last', () => {
    const d = diagram({
      nodes: [
        node('h', 'H', { position: { x: 0, y: 0 }, size: { w: 120, h: 56 } }),
        node('far', 'F'),
        node('near', 'N'),
        node('lonely', 'L'),
      ],
      edges: [edge('e', 'h', 'far')],
    });
    const rects = new Map([
      ['far', r(1000, 0)],
      ['near', r(200, 0)],
      ['lonely', r(50, 50)],
    ]);
    expect(
      orderByReference(
        d,
        indexDiagram(d),
        new Set(['far', 'near', 'lonely']),
        { near: 'h' },
        rects,
      ),
    ).toEqual(['near', 'far', 'lonely']);
  });
});

describe('refitGroups (spec 03 §6.2 step 7)', () => {
  it('rewraps the groups above moved nodes and shoves an overlapped sibling group aside with its children', () => {
    const d = diagram({
      groups: [
        group('top', 'Top', { position: { x: 0, y: 0 }, size: { w: 400, h: 200 } }),
        group('bottom', 'Bottom', { position: { x: 0, y: 224 }, size: { w: 400, h: 200 } }),
      ],
      nodes: [
        node('a', 'A', { parent: 'top', position: { x: 24, y: 48 }, size: { w: 120, h: 56 } }),
        node('n', 'N', { parent: 'top' }),
        node('b', 'B', { parent: 'bottom', position: { x: 24, y: 272 }, size: { w: 120, h: 56 } }),
      ],
    });
    const g = emptyGeometry();
    g.positions.set('n', { x: 24, y: 300 });
    g.sizes.set('n', { w: 120, h: 56 });
    refitGroups(indexDiagram(d), g, new Set(['n']), layered);
    // a(24,48,120,56) ∪ n(24,300,120,56) = (24,48,120,308) → plus GROUP_PAD → (0,0,168,380)
    expect(rectIn(g, must(d.groups[0]))).toEqual({ x: 0, y: 0, w: 168, h: 380 });
    // bottom overlapped the grown top → moved below it by the overlap plus nodeNode spacing
    const bottom = rectIn(g, must(d.groups[1]));
    expect(bottom?.y).toBe(380 + 40);
    expect(g.positions.get('b')).toEqual({ x: 24, y: 272 + (420 - 224) });
  });
});

describe('rerouteEdges (spec 03 §6.2 step 8 + decision 2)', () => {
  it('re-routes only edges touching a moved endpoint or lacking a route', () => {
    const d = diagram({
      nodes: [
        node('a', 'A', { position: { x: 0, y: 0 }, size: { w: 120, h: 56 } }),
        node('b', 'B', { position: { x: 300, y: 0 }, size: { w: 120, h: 56 } }),
        node('n', 'N', { position: { x: 600, y: 0 }, size: { w: 120, h: 56 } }),
      ],
      edges: [
        edge('e1', 'a', 'b', {
          route: {
            points: [
              { x: 1, y: 1 },
              { x: 2, y: 2 },
            ],
          },
        }),
        edge('e2', 'b', 'n', {
          route: {
            points: [
              { x: 1, y: 1 },
              { x: 2, y: 2 },
            ],
          },
        }),
        edge('e3', 'a', 'n'),
      ],
    });
    const g = emptyGeometry();
    g.positions.set('n', { x: 600, y: 200 });
    rerouteEdges(d, indexDiagram(d), g, layered);
    expect(g.routes.has('e1')).toBe(false);
    expect(g.routes.get('e2')?.[0]).toEqual({ x: 420, y: 28 });
    expect(g.routes.has('e3')).toBe(true);
  });
});
