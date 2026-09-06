import { describe, expect, it } from 'vitest';
import { applyChangeSet } from './changeset/apply';
import type { ChangeSet } from './changeset/changeset';
import { diffDiagrams } from './diff';
import type { Diagram } from './schema';
import { diagram, edge, group, node } from './testing/builders';
import { orderPlatform, orderPlatformLaidOut } from './testing/order-platform';
import { randomChangeSets } from './testing/random-changesets';

/** Comparable view: no version / meta / routes, collections order-insensitive. */
const normalize = (d: Diagram) => {
  const strip = <T extends { meta: unknown; id: string }>(list: T[]) =>
    [...list].sort((a, b) => a.id.localeCompare(b.id)).map(({ meta: _meta, ...rest }) => rest);
  const { version: _version, meta: _meta, ...rest } = d;
  return {
    ...rest,
    nodes: strip(d.nodes),
    edges: strip(d.edges).map(({ route: _route, ...e }) => e),
    groups: strip(d.groups),
  };
};

const applied = (a: Diagram, cs: ChangeSet | null) => {
  if (!cs) throw new Error('expected a change set');
  const result = applyChangeSet(a, cs);
  if (!result.ok)
    throw new Error(`diff did not apply: ${JSON.stringify(result.error)}\n${JSON.stringify(cs)}`);
  return result.diagram;
};

const ops = (cs: ChangeSet | null) => cs?.actions.map((a) => a.op) ?? [];

describe('diffDiagrams — shape', () => {
  it('returns null when nothing but meta / routes / version differ', () => {
    const a = orderPlatformLaidOut();
    const b = {
      ...a,
      version: 99,
      meta: { ...a.meta, updatedAt: 5 },
      edges: a.edges.map((e) => ({ ...e, route: undefined })),
    };
    expect(diffDiagrams(a, b)).toBeNull();
  });

  it('fills change-set fields deterministically and lets the caller override them', () => {
    const a = orderPlatform();
    const b = { ...a, name: 'Renamed' };
    expect(diffDiagrams(a, b)).toMatchObject({
      id: 'diff_d_orderplat_12_12',
      diagramId: 'd_orderplat',
      baseVersion: 12,
      origin: 'user',
      createdAt: b.meta.updatedAt,
      summary: 'Changed diagram settings',
    });
    expect(
      diffDiagrams(a, b, { origin: 'import', id: 'cs_x', now: 7, summary: 'Imported' }),
    ).toMatchObject({
      id: 'cs_x',
      origin: 'import',
      createdAt: 7,
      summary: 'Imported',
    });
  });

  it('orders deletions edge → node → group and additions group → node → edge (parents first)', () => {
    const a = diagram({
      groups: [group('old', 'Old')],
      nodes: [
        node('keep', 'Keep', { type: 'box' }),
        node('gone', 'Gone', { type: 'box', parent: 'old' }),
      ],
      edges: [edge('e-gone', 'keep', 'gone')],
    });
    const b = diagram({
      groups: [group('inner', 'Inner', { parent: 'outer' }), group('outer', 'Outer')],
      nodes: [
        node('keep', 'Keep', { type: 'box' }),
        node('fresh', 'Fresh', { type: 'box', parent: 'inner' }),
      ],
      edges: [edge('e-new', 'keep', 'fresh', { label: 'to fresh' })],
    });
    const cs = diffDiagrams(a, b);
    expect(cs?.actions).toEqual([
      { op: 'deleteEdge', id: 'e-gone' },
      { op: 'deleteNode', id: 'gone' },
      { op: 'deleteGroup', id: 'old', mode: 'ungroup' },
      {
        op: 'addGroup',
        group: { id: 'outer', label: 'Outer', role: 'cluster', parent: null, collapsed: false },
        members: [],
      },
      {
        op: 'addGroup',
        group: { id: 'inner', label: 'Inner', role: 'cluster', parent: 'outer', collapsed: false },
        members: [],
      },
      { op: 'addNode', node: { id: 'fresh', label: 'Fresh', type: 'box', parent: 'inner' } },
      {
        op: 'addEdge',
        edge: {
          id: 'e-new',
          source: 'keep',
          target: 'fresh',
          type: 'flow',
          label: 'to fresh',
          direction: 'forward',
          sourceSide: 'auto',
          targetSide: 'auto',
        },
      },
    ]);
    expect(cs?.summary).toBe('Added 2 groups, 1 node, 1 edge; deleted 1 edge, 1 node, 1 group');
    expect(normalize(applied(a, cs))).toEqual(normalize(b));
  });
});

describe('diffDiagrams — field changes', () => {
  it('patches node, edge and group fields, using null for removed ones', () => {
    const a = diagram({
      groups: [group('g', 'Group')],
      nodes: [node('n', 'Old', { type: 'box', description: 'was here', role: 'service' })],
      edges: [edge('e', 'n', 'n', { type: 'transition', label: 'loop' })],
    });
    const b = diagram({
      groups: [group('g', undefined, { collapsed: true, role: 'lane' })],
      nodes: [node('n', 'New', { type: 'ellipse', data: { k: 1 } })],
      edges: [edge('e', 'n', 'n', { type: 'transition', direction: 'both', sourceSide: 'top' })],
    });
    const cs = diffDiagrams(a, b);
    expect(cs?.actions).toEqual([
      { op: 'updateGroup', id: 'g', patch: { label: null, role: 'lane', collapsed: true } },
      {
        op: 'updateNode',
        id: 'n',
        patch: { label: 'New', description: null, role: null, type: 'ellipse', data: { k: 1 } },
      },
      { op: 'updateEdge', id: 'e', patch: { label: null, direction: 'both', sourceSide: 'top' } },
    ]);
    expect(normalize(applied(a, cs))).toEqual(normalize(b));
  });

  it('rewires edges and re-parents nodes/groups, merging identical new parents', () => {
    const a = orderPlatform();
    const b = {
      ...a,
      nodes: a.nodes.map((n) =>
        n.id === 'web' || n.id === 'pg'
          ? { ...n, parent: 'svc' }
          : n.id === 'users'
            ? { ...n, parent: null }
            : n,
      ),
      groups: a.groups.map((g) => (g.id === 'edge' ? { ...g, parent: 'svc' } : g)),
      edges: a.edges.map((e) => (e.id === 'e1' ? { ...e, target: 'users' } : e)),
    };
    const cs = diffDiagrams(a, b);
    // shallower destinations first so no intermediate step can form a group cycle
    expect(cs?.actions).toEqual([
      { op: 'setParent', ids: ['users'], parent: null },
      { op: 'setParent', ids: ['web', 'pg', 'edge'], parent: 'svc' },
      { op: 'updateEdge', id: 'e1', patch: { target: 'users' } },
    ]);
    expect(normalize(applied(a, cs))).toEqual(normalize(b));
  });

  it('recreates an edge whose old endpoint disappears instead of patching it after the cascade', () => {
    const a = diagram({
      nodes: [node('x', 'X', { type: 'box' }), node('y', 'Y', { type: 'box' })],
      edges: [edge('e', 'x', 'y', { label: 'keep me', style: { palette: 'mint' } })],
    });
    const b = diagram({
      nodes: [node('y', 'Y', { type: 'box' }), node('z', 'Z', { type: 'box' })],
      edges: [edge('e', 'z', 'y', { label: 'keep me', style: { palette: 'mint' } })],
    });
    const cs = diffDiagrams(a, b);
    expect(ops(cs)).toEqual(['deleteEdge', 'deleteNode', 'addNode', 'addEdge']);
    expect(cs?.actions[3]).toMatchObject({
      op: 'addEdge',
      edge: { id: 'e', source: 'z', target: 'y', style: { palette: 'mint' } },
    });
    expect(normalize(applied(a, cs))).toEqual(normalize(b));
  });

  it('diffs styles token by token, clearing removed tokens with null', () => {
    const a = orderPlatform();
    const styled = (d: Diagram, id: string, style: Diagram['nodes'][number]['style']) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === id ? { ...n, style } : n)),
    });
    const a2 = styled(
      styled(a, 'pay', {
        palette: 'mint',
        stroke: 'dashed',
        override: { fill: '#112233', text: '#000000' },
      }),
      'web',
      { palette: 'sky' },
    );
    const b = styled(
      styled(a2, 'pay', { palette: 'sand', override: { fill: '#112233' } }),
      'web',
      undefined,
    );
    const cs = diffDiagrams(a2, b);
    expect(cs?.actions).toEqual([
      { op: 'setStyle', targets: ['web'], style: { palette: null } },
      {
        op: 'setStyle',
        targets: ['pay'],
        style: { palette: 'sand', stroke: null, override: { text: null } },
      },
    ]);
    expect(normalize(applied(a2, cs))).toEqual(normalize(b));
  });

  it('diffs diagram-level settings into one setDiagram', () => {
    const a = { ...orderPlatform(), description: 'old' };
    const b = {
      ...a,
      name: 'Orders',
      type: 'dataflow' as const,
      description: undefined,
      layout: { ...a.layout, direction: 'DOWN' as const },
      theme: { ...a.theme, fontScale: 's' as const },
    };
    const cs = diffDiagrams(a, b);
    expect(cs?.actions).toEqual([
      {
        op: 'setDiagram',
        patch: {
          name: 'Orders',
          description: null,
          type: 'dataflow',
          layout: { direction: 'DOWN' },
          theme: { fontScale: 's' },
        },
      },
    ]);
    expect(normalize(applied(a, cs))).toEqual(normalize(b));
  });
});

describe('diffDiagrams — geometry', () => {
  it('user origin: moves/resizes via moveNode/resizeNode and reconciles pinned afterwards', () => {
    const a = orderPlatformLaidOut();
    const b = {
      ...a,
      nodes: a.nodes.map((n) =>
        n.id === 'web'
          ? { ...n, position: { x: 1, y: 2 }, size: { w: 9, h: 9 } }
          : n.id === 'gw'
            ? { ...n, position: { x: 5, y: 5 }, pinned: true }
            : n.id === 'pay'
              ? { ...n, pinned: false }
              : n,
      ),
    };
    const cs = diffDiagrams(a, b);
    expect(cs?.actions).toEqual([
      { op: 'moveNode', id: 'web', position: { x: 1, y: 2 } },
      { op: 'resizeNode', id: 'web', size: { w: 9, h: 9 } },
      { op: 'moveNode', id: 'gw', position: { x: 5, y: 5 } },
      { op: 'pinNodes', ids: ['web', 'pay'], pinned: false },
    ]);
    expect(cs?.summary).toBe('Moved 2 nodes; resized 1 node; unpinned 2 nodes');
    expect(normalize(applied(a, cs))).toEqual(normalize(b));
  });

  it('system origin: writes geometry (including clears) with one applyLayout and never touches pinned', () => {
    const a = orderPlatformLaidOut();
    const b = {
      ...a,
      nodes: a.nodes.map((n) =>
        n.id === 'web'
          ? { ...n, position: undefined }
          : n.id === 'gw'
            ? { ...n, size: { w: 1, h: 1 } }
            : n,
      ),
      groups: a.groups.map((g) =>
        g.id === 'svc' ? { ...g, position: { x: 0, y: 0 }, size: undefined } : g,
      ),
    };
    const cs = diffDiagrams(a, b, { origin: 'system' });
    expect(cs?.actions).toEqual([
      {
        op: 'applyLayout',
        positions: { web: null, svc: { x: 0, y: 0 } },
        sizes: { gw: { w: 1, h: 1 }, svc: null },
        routes: {},
      },
    ]);
    expect(normalize(applied(a, cs))).toEqual(normalize(b));
  });

  it('gives freshly added nodes their geometry and pinned state too', () => {
    const a = orderPlatform();
    const b = {
      ...a,
      nodes: [
        ...a.nodes,
        node('new', 'New', {
          type: 'box',
          position: { x: 3, y: 4 },
          size: { w: 10, h: 10 },
          pinned: true,
        }),
      ],
    };
    expect(ops(diffDiagrams(a, b))).toEqual(['addNode', 'moveNode', 'resizeNode']);
    expect(normalize(applied(a, diffDiagrams(a, b)))).toEqual(normalize(b));
    expect(ops(diffDiagrams(a, b, { origin: 'system' }))).toEqual([
      'addNode',
      'applyLayout',
      'pinNodes',
    ]);
    expect(normalize(applied(a, diffDiagrams(a, b, { origin: 'system' })))).toEqual(normalize(b));
  });
});

describe.each([1, 20260905, 424242])('diffDiagrams — property (seed %i)', (seed) => {
  it('diff(a, apply(a, cs)) applied to a reproduces the target for random change sets', () => {
    const generator = randomChangeSets(seed);
    let a = orderPlatformLaidOut();
    for (let i = 0; i < 120; i += 1) {
      const cs = generator.next(a);
      const result = applyChangeSet(a, cs);
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      const b = result.diagram;
      const diff = diffDiagrams(a, b, { origin: 'system' });
      const reproduced = diff ? applied(a, diff) : a;
      expect(normalize(reproduced), `step ${i} (${cs.actions.map((x) => x.op).join(',')})`).toEqual(
        normalize(b),
      );
      a = b;
    }
  });
});
