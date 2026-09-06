import { describe, expect, it } from 'vitest';
import type { Diagram } from '../schema';
import { diagram, group, node } from '../testing/builders';
import { orderPlatform, orderPlatformLaidOut } from '../testing/order-platform';
import { specExampleChangeSet } from '../testing/spec-example';
import { validateDiagram } from '../validate';
import type { ActionSchema } from './actions';
import { applyChangeSet } from './apply';
import { type ChangeSet, ChangeSetSchema } from './changeset';

type ActionInput = Parameters<typeof ActionSchema.parse>[0];

const T1 = 1_760_000_000_000;

const changeSet = (
  d: Diagram,
  actions: ActionInput[],
  overrides: Partial<Parameters<typeof ChangeSetSchema.parse>[0] & object> = {},
): ChangeSet =>
  ChangeSetSchema.parse({
    id: 'cs_test0001',
    diagramId: d.id,
    baseVersion: d.version,
    origin: 'user',
    createdAt: T1,
    actions,
    ...overrides,
  });

const aiChangeSet = (d: Diagram, actions: ActionInput[]) =>
  changeSet(d, actions, { origin: 'ai', runId: 'run_test' });

const systemChangeSet = (d: Diagram, actions: ActionInput[]) =>
  changeSet(d, actions, { origin: 'system' });

/** Comparable view: no version / meta, collections order-insensitive. */
const normalize = (d: Diagram) => {
  const strip = <T extends { meta: unknown; id: string }>(list: T[]) =>
    [...list].sort((a, b) => a.id.localeCompare(b.id)).map(({ meta: _meta, ...rest }) => rest);
  const { version: _version, meta: _meta, ...rest } = d;
  return { ...rest, nodes: strip(d.nodes), edges: strip(d.edges), groups: strip(d.groups) };
};

const applyOk = (d: Diagram, cs: ChangeSet) => {
  const result = applyChangeSet(d, cs);
  if (!result.ok) throw new Error(`apply failed: ${JSON.stringify(result.error)}`);
  expect(validateDiagram(result.diagram).errors).toEqual([]);
  return result;
};

/** Applies `cs`, then its inverse, and asserts the diagram is back where it started. */
const roundTrip = (d: Diagram, cs: ChangeSet) => {
  const forward = applyOk(d, cs);
  expect(forward.inverse.baseVersion).toBe(forward.diagram.version);
  expect(forward.inverse.origin).toBe('system');
  const back = applyOk(forward.diagram, forward.inverse);
  expect(normalize(back.diagram)).toEqual(normalize(d));
  return forward;
};

const applyErr = (d: Diagram, cs: ChangeSet) => {
  const result = applyChangeSet(d, cs);
  if (result.ok) throw new Error('expected failure');
  return result.error;
};

const nodeOf = (d: Diagram, id: string) => {
  const found = d.nodes.find((n) => n.id === id);
  if (!found) throw new Error(`node ${id} missing`);
  return found;
};
const edgeOf = (d: Diagram, id: string) => {
  const found = d.edges.find((e) => e.id === id);
  if (!found) throw new Error(`edge ${id} missing`);
  return found;
};
const groupOf = (d: Diagram, id: string) => {
  const found = d.groups.find((g) => g.id === id);
  if (!found) throw new Error(`group ${id} missing`);
  return found;
};

describe('applyChangeSet — preconditions and bookkeeping', () => {
  it('rejects a change set for another diagram', () => {
    const d = orderPlatform();
    const cs = changeSet(d, [{ op: 'deleteEdge', id: 'e1' }], { diagramId: 'd_other' });
    expect(applyErr(d, cs)).toMatchObject({ code: 'E_INVALID_ACTION', actionIndex: null });
  });

  it('rejects a stale base version unless skipVersionCheck is set', () => {
    const d = orderPlatform();
    const cs = changeSet(d, [{ op: 'deleteEdge', id: 'e1' }], { baseVersion: d.version - 1 });
    expect(applyErr(d, cs)).toMatchObject({
      code: 'E_BASE_VERSION_MISMATCH',
      actionIndex: null,
      detail: { expected: d.version, actual: d.version - 1 },
    });
    expect(applyChangeSet(d, cs, { skipVersionCheck: true }).ok).toBe(true);
  });

  it('bumps the version, stamps updatedAt from cs.createdAt and records the AI run id', () => {
    const d = orderPlatform();
    const result = applyOk(d, aiChangeSet(d, [{ op: 'deleteEdge', id: 'e1' }]));
    expect(result.diagram.version).toBe(d.version + 1);
    expect(result.diagram.meta).toEqual({
      createdAt: d.meta.createdAt,
      updatedAt: T1,
      lastRunId: 'run_test',
    });
    expect(d.version).toBe(12);
  });

  it('is transactional: a failing action leaves the input untouched and names its index', () => {
    const d = orderPlatform();
    const snapshot = JSON.stringify(d);
    const cs = changeSet(d, [
      { op: 'deleteEdge', id: 'e1' },
      { op: 'deleteEdge', id: 'nope' },
    ]);
    expect(applyErr(d, cs)).toMatchObject({ code: 'E_UNKNOWN_REF', actionIndex: 1 });
    expect(JSON.stringify(d)).toBe(snapshot);
  });

  it('shares untouched elements with the input instead of cloning everything', () => {
    const d = orderPlatform();
    const result = applyOk(
      d,
      changeSet(d, [{ op: 'updateNode', id: 'web', patch: { label: 'Web' } }]),
    );
    expect(nodeOf(result.diagram, 'pg')).toBe(nodeOf(d, 'pg'));
    expect(nodeOf(result.diagram, 'web')).not.toBe(nodeOf(d, 'web'));
    expect(nodeOf(d, 'web').label).toBe('Web App');
  });
});

describe('node actions', () => {
  it('addNode fills defaults and meta, keeps `near` out of the diagram and reports it as a hint', () => {
    const d = orderPlatform();
    const result = applyOk(
      d,
      aiChangeSet(d, [
        {
          op: 'addNode',
          node: {
            id: 'order-events',
            type: 'hexagon',
            label: 'order-events',
            role: 'topic',
            parent: 'svc',
            near: 'orders',
          },
        },
      ]),
    );
    expect(nodeOf(result.diagram, 'order-events')).toEqual({
      id: 'order-events',
      type: 'hexagon',
      label: 'order-events',
      role: 'topic',
      parent: 'svc',
      pinned: false,
      meta: { createdBy: 'ai', runId: 'run_test', createdAt: T1, updatedAt: T1, rev: 0 },
    });
    expect(result.affected).toEqual({ added: ['order-events'], modified: [], deleted: [] });
    expect(result.layoutRequest).toEqual({
      scope: expect.arrayContaining(['order-events']),
      reason: 'structural',
      hints: { 'order-events': 'orders' },
    });
    expect(result.inverse.actions).toEqual([{ op: 'deleteNode', id: 'order-events' }]);
  });

  it('addNode validates ids, parents and typed data', () => {
    const d = orderPlatform();
    const attempt = (n: Record<string, unknown>) =>
      applyErr(d, changeSet(d, [{ op: 'addNode', node: { type: 'box', label: 'X', ...n } }]));
    expect(attempt({ id: 'web' })).toMatchObject({ code: 'E_ID_COLLISION', actionIndex: 0 });
    expect(attempt({ id: 'x', parent: 'ghost' })).toMatchObject({ code: 'E_UNKNOWN_REF' });
    expect(attempt({ id: 'x', parent: 'web' })).toMatchObject({ code: 'E_REF_KIND' });
    expect(attempt({ id: 'x', near: 'svc' })).toMatchObject({ code: 'E_REF_KIND' });

    // an entity without columns is stopped by the schema (LLM repair loop) and, for callers that
    // bypass parsing, again by applyChangeSet
    const entity = { op: 'addNode', node: { id: 'x', type: 'entity', label: 'X' } } as const;
    expect(() => changeSet(d, [entity])).toThrow();
    const unparsed = {
      ...changeSet(d, [{ op: 'deleteEdge', id: 'e1' }]),
      actions: [entity],
    } as ChangeSet;
    expect(applyErr(d, unparsed)).toMatchObject({ code: 'E_INVALID_ACTION', actionIndex: 0 });
  });

  it('updateNode merges the patch, clears with null, bumps rev and inverts to the old values', () => {
    const d = orderPlatform();
    const withDescription = {
      ...d,
      nodes: d.nodes.map((n) => (n.id === 'web' ? { ...n, description: 'Browser SPA' } : n)),
    };
    const cs = changeSet(withDescription, [
      { op: 'updateNode', id: 'web', patch: { label: 'Web', description: null, role: 'client' } },
    ]);
    const result = roundTrip(withDescription, cs);
    const updated = nodeOf(result.diagram, 'web');
    expect(updated).toMatchObject({ label: 'Web', role: 'client' });
    expect(updated.description).toBeUndefined();
    expect(updated.meta).toMatchObject({ rev: 1, updatedAt: T1 });
    expect(result.affected).toEqual({ added: [], modified: ['web'], deleted: [] });
    expect(result.inverse.actions).toEqual([
      {
        op: 'updateNode',
        id: 'web',
        patch: { label: 'Web App', description: 'Browser SPA', role: 'web' },
      },
    ]);
  });

  it('updateNode reports label/type/data changes as measure-only layout work', () => {
    const d = orderPlatform();
    const result = applyOk(
      d,
      changeSet(d, [{ op: 'updateNode', id: 'web', patch: { label: 'Web' } }]),
    );
    expect(result.layoutRequest).toEqual({ scope: ['web'], reason: 'measure', hints: {} });
  });

  it('updateNode rejects unknown ids, wrong kinds and data that no longer fits the type', () => {
    const d = orderPlatform();
    expect(
      applyErr(d, changeSet(d, [{ op: 'updateNode', id: 'ghost', patch: { label: 'x' } }])),
    ).toMatchObject({
      code: 'E_UNKNOWN_REF',
    });
    expect(
      applyErr(d, changeSet(d, [{ op: 'updateNode', id: 'e1', patch: { label: 'x' } }])),
    ).toMatchObject({
      code: 'E_REF_KIND',
    });
    expect(
      applyErr(d, changeSet(d, [{ op: 'updateNode', id: 'web', patch: { type: 'entity' } }])),
    ).toMatchObject({
      code: 'E_INVALID_ACTION',
      actionIndex: 0,
    });
  });

  it('deleteNode cascades to incident edges and the inverse restores node, edges and geometry', () => {
    const d = orderPlatformLaidOut();
    const cs = changeSet(d, [{ op: 'deleteNode', id: 'orders' }]);
    const result = roundTrip(d, cs);
    expect(result.diagram.nodes.map((n) => n.id)).not.toContain('orders');
    expect(result.diagram.edges.map((e) => e.id)).toEqual(['e1', 'e2', 'e6', 'e8', 'e9', 'e10']);
    expect(result.affected).toEqual({
      added: [],
      modified: [],
      deleted: ['orders', 'e3', 'e4', 'e5', 'e7'],
    });
    expect(result.layoutRequest).toBeNull();
    expect(result.inverse.actions.map((a) => a.op)).toEqual([
      'addNode',
      'addEdge',
      'addEdge',
      'addEdge',
      'addEdge',
      'applyLayout',
    ]);
  });

  it('deleteNode restores pinned state on undo', () => {
    const d = orderPlatformLaidOut();
    const result = roundTrip(d, changeSet(d, [{ op: 'deleteNode', id: 'pay' }]));
    expect(result.inverse.actions.at(-1)).toEqual({ op: 'pinNodes', ids: ['pay'], pinned: true });
  });

  it('moveNode / resizeNode are user-only, pin the node and invert to the old geometry', () => {
    const d = orderPlatformLaidOut();
    expect(
      applyErr(d, aiChangeSet(d, [{ op: 'moveNode', id: 'web', position: { x: 1, y: 1 } }])),
    ).toMatchObject({ code: 'E_INVALID_ACTION', actionIndex: 0 });

    const cs = changeSet(d, [
      { op: 'moveNode', id: 'web', position: { x: 500, y: 500 } },
      { op: 'resizeNode', id: 'web', size: { w: 200, h: 80 } },
    ]);
    const result = roundTrip(d, cs);
    const moved = nodeOf(result.diagram, 'web');
    expect(moved).toMatchObject({
      position: { x: 500, y: 500 },
      size: { w: 200, h: 80 },
      pinned: true,
    });
    expect(moved.meta.rev).toBe(2);
    expect(result.layoutRequest).toBeNull();
    // each inverse restores the state as it was right before its forward action ran
    expect(result.inverse.actions).toEqual([
      { op: 'resizeNode', id: 'web', size: { w: 160, h: 64 } },
      { op: 'pinNodes', ids: ['web'], pinned: true },
      { op: 'moveNode', id: 'web', position: { x: 40, y: 40 } },
      { op: 'pinNodes', ids: ['web'], pinned: false },
    ]);
  });

  it('moveNode on an unplaced node inverts back to "awaiting layout"', () => {
    const d = orderPlatform();
    const result = roundTrip(
      d,
      changeSet(d, [{ op: 'moveNode', id: 'web', position: { x: 10, y: 10 } }]),
    );
    expect(result.inverse.actions).toEqual([
      { op: 'applyLayout', positions: { web: null }, sizes: {}, routes: {} },
      { op: 'pinNodes', ids: ['web'], pinned: false },
    ]);
  });

  it('pinNodes writes the flag and inverts per previous value', () => {
    const d = orderPlatform();
    const result = roundTrip(
      d,
      changeSet(d, [{ op: 'pinNodes', ids: ['web', 'pay'], pinned: true }]),
    );
    expect(nodeOf(result.diagram, 'web').pinned).toBe(true);
    expect(result.affected.modified).toEqual(['web', 'pay']);
    expect(result.inverse.actions).toEqual([
      { op: 'pinNodes', ids: ['web'], pinned: false },
      { op: 'pinNodes', ids: ['pay'], pinned: true },
    ]);
    expect(
      applyErr(d, changeSet(d, [{ op: 'pinNodes', ids: ['svc'], pinned: true }])),
    ).toMatchObject({
      code: 'E_REF_KIND',
    });
  });
});

describe('edge actions', () => {
  it('addEdge fills defaults and validates endpoints and self loops', () => {
    const d = orderPlatform();
    const result = roundTrip(
      d,
      aiChangeSet(d, [{ op: 'addEdge', edge: { id: 'e11', source: 'web', target: 'pg' } }]),
    );
    expect(edgeOf(result.diagram, 'e11')).toEqual({
      id: 'e11',
      source: 'web',
      target: 'pg',
      type: 'flow',
      direction: 'forward',
      sourceSide: 'auto',
      targetSide: 'auto',
      meta: { createdBy: 'ai', runId: 'run_test', createdAt: T1, updatedAt: T1, rev: 0 },
    });
    expect(result.layoutRequest).toEqual({
      scope: expect.arrayContaining(['web', 'pg']),
      reason: 'structural',
      hints: {},
    });

    const attempt = (e: Record<string, unknown>) =>
      applyErr(
        d,
        changeSet(d, [{ op: 'addEdge', edge: { id: 'x', source: 'web', target: 'pg', ...e } }]),
      );
    expect(attempt({ id: 'e1' })).toMatchObject({ code: 'E_ID_COLLISION' });
    expect(attempt({ target: 'ghost' })).toMatchObject({ code: 'E_UNKNOWN_REF' });
    expect(attempt({ target: 'svc' })).toMatchObject({ code: 'E_REF_KIND' });
    expect(attempt({ target: 'web' })).toMatchObject({ code: 'E_SELF_LOOP' });
    expect(() => attempt({ type: 'message' })).toThrow(); // message edges need data.kind/order (schema)
    expect(
      applyChangeSet(
        d,
        changeSet(d, [
          { op: 'addEdge', edge: { id: 'x', source: 'web', target: 'web', type: 'transition' } },
        ]),
      ).ok,
    ).toBe(true);
  });

  it('updateEdge keeps the route for cosmetic patches but clears it when endpoints move', () => {
    const d = orderPlatformLaidOut();
    const cosmetic = roundTrip(
      d,
      changeSet(d, [{ op: 'updateEdge', id: 'e1', patch: { label: null, type: 'data' } }]),
    );
    expect(edgeOf(cosmetic.diagram, 'e1').route).toEqual(edgeOf(d, 'e1').route);
    expect(edgeOf(cosmetic.diagram, 'e1').label).toBeUndefined();
    expect(cosmetic.layoutRequest).toBeNull();
    expect(cosmetic.inverse.actions).toEqual([
      { op: 'updateEdge', id: 'e1', patch: { label: 'HTTPS', type: 'flow' } },
    ]);

    const rewired = roundTrip(
      d,
      changeSet(d, [{ op: 'updateEdge', id: 'e1', patch: { target: 'users' } }]),
    );
    expect(edgeOf(rewired.diagram, 'e1')).toMatchObject({ target: 'users' });
    expect(edgeOf(rewired.diagram, 'e1').route).toBeUndefined();
    expect(rewired.layoutRequest).toMatchObject({ reason: 'structural' });
    expect(rewired.inverse.actions.map((a) => a.op)).toEqual(['updateEdge', 'applyLayout']);

    expect(
      applyErr(d, changeSet(d, [{ op: 'updateEdge', id: 'e1', patch: { target: 'svc' } }])),
    ).toMatchObject({
      code: 'E_REF_KIND',
    });
    expect(
      applyErr(d, changeSet(d, [{ op: 'updateEdge', id: 'e1', patch: { target: 'web' } }])),
    ).toMatchObject({
      code: 'E_SELF_LOOP',
    });
  });

  it('deleteEdge inverts to addEdge plus route restoration', () => {
    const d = orderPlatformLaidOut();
    const result = roundTrip(d, changeSet(d, [{ op: 'deleteEdge', id: 'e5' }]));
    expect(result.affected).toEqual({ added: [], modified: [], deleted: ['e5'] });
    expect(result.inverse.actions.map((a) => a.op)).toEqual(['addEdge', 'applyLayout']);
  });
});

describe('group actions', () => {
  it('addGroup re-parents its members and inverts to ungroup + old parents', () => {
    const d = orderPlatform();
    const cs = aiChangeSet(d, [
      {
        op: 'addGroup',
        group: { id: 'data', label: 'Data', role: 'layer' },
        members: ['pg', 'redis', 'users'],
      },
    ]);
    const result = roundTrip(d, cs);
    expect(groupOf(result.diagram, 'data')).toMatchObject({
      label: 'Data',
      role: 'layer',
      parent: null,
      collapsed: false,
    });
    expect(nodeOf(result.diagram, 'pg').parent).toBe('data');
    expect(nodeOf(result.diagram, 'users').parent).toBe('data');
    expect(result.affected).toEqual({
      added: ['data'],
      modified: ['pg', 'redis', 'users'],
      deleted: [],
    });
    expect(result.inverse.actions).toEqual([
      { op: 'deleteGroup', id: 'data', mode: 'ungroup' },
      { op: 'setParent', ids: ['pg', 'redis'], parent: null },
      { op: 'setParent', ids: ['users'], parent: 'svc' },
    ]);
  });

  it('addGroup refuses to make one of its own ancestors a member', () => {
    const d = diagram({
      groups: [group('outer', 'Outer')],
      nodes: [node('a', 'A', { parent: 'outer' })],
    });
    const cs = changeSet(d, [
      { op: 'addGroup', group: { id: 'inner', parent: 'outer' }, members: ['outer'] },
    ]);
    expect(applyErr(d, cs)).toMatchObject({ code: 'E_PARENT_CYCLE', actionIndex: 0 });
  });

  it('updateGroup merges and clears', () => {
    const d = orderPlatform();
    const result = roundTrip(
      d,
      changeSet(d, [{ op: 'updateGroup', id: 'svc', patch: { label: null, collapsed: true } }]),
    );
    expect(groupOf(result.diagram, 'svc')).toMatchObject({ collapsed: true });
    expect(groupOf(result.diagram, 'svc').label).toBeUndefined();
    expect(result.inverse.actions).toEqual([
      { op: 'updateGroup', id: 'svc', patch: { label: 'Services', collapsed: false } },
    ]);
  });

  it('deleteGroup{ungroup} lifts children to the parent and inverts to addGroup with members', () => {
    const d = orderPlatformLaidOut();
    const result = roundTrip(d, changeSet(d, [{ op: 'deleteGroup', id: 'svc' }]));
    expect(result.diagram.groups.map((g) => g.id)).toEqual(['edge']);
    expect(nodeOf(result.diagram, 'users').parent).toBeNull();
    expect(result.affected).toEqual({
      added: [],
      modified: ['users', 'orders', 'pay'],
      deleted: ['svc'],
    });
    expect(result.inverse.actions[0]).toEqual({
      op: 'addGroup',
      group: { id: 'svc', label: 'Services', role: 'layer', parent: null, collapsed: false },
      members: ['users', 'orders', 'pay'],
    });
  });

  it('deleteGroup{cascade} removes every descendant and its edges, and the inverse rebuilds them', () => {
    const d = orderPlatformLaidOut();
    const nested = {
      ...d,
      groups: [
        ...d.groups,
        group('inner', 'Inner', {
          parent: 'svc',
          position: { x: 0, y: 0 },
          size: { w: 10, h: 10 },
        }),
      ],
      nodes: d.nodes.map((n) => (n.id === 'pay' ? { ...n, parent: 'inner' } : n)),
    };
    const result = roundTrip(
      nested,
      changeSet(nested, [{ op: 'deleteGroup', id: 'svc', mode: 'cascade' }]),
    );
    expect(result.diagram.groups.map((g) => g.id)).toEqual(['edge']);
    expect(result.diagram.nodes.map((n) => n.id)).toEqual([
      'web',
      'gw',
      'pg',
      'redis',
      'mq',
      'stripe',
    ]);
    expect(result.diagram.edges.map((e) => e.id)).toEqual(['e1']);
    expect(result.affected.deleted).toEqual(
      expect.arrayContaining([
        'svc',
        'inner',
        'users',
        'orders',
        'pay',
        'e2',
        'e3',
        'e4',
        'e5',
        'e6',
        'e7',
        'e8',
        'e9',
        'e10',
      ]),
    );
    const ops = result.inverse.actions.map((a) => a.op);
    expect(ops.slice(0, 2)).toEqual(['addGroup', 'addGroup']);
    expect(ops.at(-2)).toBe('applyLayout');
    expect(ops.at(-1)).toBe('pinNodes');
  });

  it('setParent moves nodes and groups, detects cycles and inverts per old parent', () => {
    const d = orderPlatform();
    const result = roundTrip(
      d,
      aiChangeSet(d, [{ op: 'setParent', ids: ['web', 'gw', 'edge'], parent: 'svc' }]),
    );
    expect(nodeOf(result.diagram, 'web').parent).toBe('svc');
    expect(groupOf(result.diagram, 'edge').parent).toBe('svc');
    expect(result.layoutRequest).toMatchObject({ reason: 'structural' });
    expect(result.inverse.actions).toEqual([
      { op: 'setParent', ids: ['web', 'edge'], parent: null },
      { op: 'setParent', ids: ['gw'], parent: 'edge' },
    ]);

    const nested = {
      ...d,
      groups: d.groups.map((g) => (g.id === 'edge' ? { ...g, parent: 'svc' } : g)),
    };
    expect(
      applyErr(nested, changeSet(nested, [{ op: 'setParent', ids: ['svc'], parent: 'edge' }])),
    ).toMatchObject({
      code: 'E_PARENT_CYCLE',
    });
    expect(
      applyErr(d, changeSet(d, [{ op: 'setParent', ids: ['svc'], parent: 'svc' }])),
    ).toMatchObject({
      code: 'E_PARENT_CYCLE',
    });
    expect(
      applyErr(d, changeSet(d, [{ op: 'setParent', ids: ['web'], parent: 'pg' }])),
    ).toMatchObject({
      code: 'E_REF_KIND',
    });
    expect(
      applyErr(d, changeSet(d, [{ op: 'setParent', ids: ['e1'], parent: 'svc' }])),
    ).toMatchObject({
      code: 'E_REF_KIND',
    });
  });
});

describe('style, layout and diagram-level actions', () => {
  it('setStyle merges tokens (override too) and inverts with nulls for fields it introduced', () => {
    const d = orderPlatform();
    const styled = {
      ...d,
      nodes: d.nodes.map((n) =>
        n.id === 'pay'
          ? { ...n, style: { palette: 'mint' as const, override: { fill: '#112233' } } }
          : n,
      ),
    };
    const cs = aiChangeSet(styled, [
      {
        op: 'setStyle',
        targets: ['pay', 'stripe'],
        style: { palette: 'sand', emphasis: 'muted', override: { text: '#000000' } },
      },
    ]);
    const result = roundTrip(styled, cs);
    expect(nodeOf(result.diagram, 'pay').style).toEqual({
      palette: 'sand',
      emphasis: 'muted',
      override: { fill: '#112233', text: '#000000' },
    });
    expect(nodeOf(result.diagram, 'stripe').style).toEqual({
      palette: 'sand',
      emphasis: 'muted',
      override: { text: '#000000' },
    });
    expect(result.layoutRequest).toBeNull();
    expect(result.inverse.actions).toEqual([
      {
        op: 'setStyle',
        targets: ['pay'],
        style: { palette: 'mint', emphasis: null, override: { text: null } },
      },
      {
        op: 'setStyle',
        targets: ['stripe'],
        style: { palette: null, emphasis: null, override: null },
      },
    ]);
    expect(
      applyErr(d, changeSet(d, [{ op: 'setStyle', targets: ['ghost'], style: {} }])),
    ).toMatchObject({
      code: 'E_UNKNOWN_REF',
    });
  });

  it('relayout clears positions of unpinned scope nodes and incident routes, keeps pinned ones, and inverts via applyLayout', () => {
    const d = orderPlatformLaidOut();
    const cs = aiChangeSet(d, [
      {
        op: 'relayout',
        scope: ['orders', 'pay', 'svc'],
        near: { orders: 'mq' },
        layout: { direction: 'DOWN' },
      },
    ]);
    const result = roundTrip(d, cs);
    expect(nodeOf(result.diagram, 'orders').position).toBeUndefined();
    expect(nodeOf(result.diagram, 'users').position).toBeUndefined();
    expect(nodeOf(result.diagram, 'pay').position).toEqual(nodeOf(d, 'pay').position);
    expect(nodeOf(result.diagram, 'web').position).toEqual(nodeOf(d, 'web').position);
    expect(edgeOf(result.diagram, 'e3').route).toBeUndefined();
    expect(edgeOf(result.diagram, 'e1').route).toBeDefined();
    expect(result.diagram.layout).toEqual({ ...d.layout, direction: 'DOWN' });
    expect(result.layoutRequest).toEqual({
      scope: ['orders', 'pay', 'svc'],
      reason: 'relayout',
      hints: { orders: 'mq' },
    });
    expect(result.inverse.actions.map((a) => a.op)).toEqual(['setDiagram', 'applyLayout']);
  });

  it('relayout{all} reports scope all', () => {
    const d = orderPlatformLaidOut();
    const result = roundTrip(d, aiChangeSet(d, [{ op: 'relayout' }]));
    expect(result.layoutRequest).toEqual({ scope: 'all', reason: 'relayout', hints: {} });
    expect(result.diagram.nodes.filter((n) => n.position).map((n) => n.id)).toEqual(['pay']);
  });

  it('applyLayout is system-only, writes geometry without touching rev/pinned and inverts to the old geometry', () => {
    const d = orderPlatform();
    const layout = {
      op: 'applyLayout',
      positions: { web: { x: 1, y: 2 }, svc: { x: 0, y: 0 } },
      sizes: { web: { w: 10, h: 10 } },
      routes: {
        e1: [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
      },
    } satisfies ActionInput;
    expect(applyErr(d, changeSet(d, [layout]))).toMatchObject({ code: 'E_INVALID_ACTION' });

    const result = roundTrip(d, systemChangeSet(d, [layout]));
    expect(nodeOf(result.diagram, 'web')).toMatchObject({
      position: { x: 1, y: 2 },
      size: { w: 10, h: 10 },
      pinned: false,
    });
    expect(nodeOf(result.diagram, 'web').meta.rev).toBe(0);
    expect(groupOf(result.diagram, 'svc').position).toEqual({ x: 0, y: 0 });
    expect(edgeOf(result.diagram, 'e1').route).toEqual({
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
    });
    expect(result.affected).toEqual({ added: [], modified: ['web', 'svc', 'e1'], deleted: [] });
    expect(result.layoutRequest).toBeNull();

    const relaid = roundTrip(
      orderPlatformLaidOut(),
      systemChangeSet(orderPlatformLaidOut(), [layout]),
    );
    expect(relaid.inverse.actions).toEqual([
      {
        op: 'applyLayout',
        positions: { web: { x: 40, y: 40 }, svc: { x: 720, y: 20 } },
        sizes: { web: { w: 160, h: 64 } },
        routes: {
          e1: [
            { x: 100, y: 72 },
            { x: 260, y: 72 },
          ],
        },
      },
    ]);

    expect(
      applyErr(
        d,
        systemChangeSet(d, [{ op: 'applyLayout', positions: { ghost: { x: 0, y: 0 } } }]),
      ),
    ).toMatchObject({ code: 'E_UNKNOWN_REF' });
    expect(
      applyErr(d, systemChangeSet(d, [{ op: 'applyLayout', positions: { e1: { x: 0, y: 0 } } }])),
    ).toMatchObject({ code: 'E_REF_KIND' });
  });

  it('setDiagram merges diagram fields; a type change asks for a full relayout', () => {
    const d = orderPlatform();
    const cs = aiChangeSet(d, [
      {
        op: 'setDiagram',
        patch: {
          name: 'Orders',
          description: 'Order platform overview',
          type: 'dataflow',
          layout: { spacing: 'loose' },
          theme: { fontScale: 'l' },
        },
      },
    ]);
    const result = roundTrip(d, cs);
    expect(result.diagram).toMatchObject({
      name: 'Orders',
      description: 'Order platform overview',
      type: 'dataflow',
      layout: { ...d.layout, spacing: 'loose' },
      theme: { ...d.theme, fontScale: 'l' },
    });
    expect(result.diagramChanged).toBe(true);
    expect(result.affected).toEqual({ added: [], modified: [], deleted: [] });
    expect(result.layoutRequest).toEqual({ scope: 'all', reason: 'structural', hints: {} });
    expect(result.inverse.actions).toEqual([
      {
        op: 'setDiagram',
        patch: {
          name: 'Order Platform',
          description: null,
          type: 'architecture',
          layout: { spacing: 'normal' },
          theme: { fontScale: 'm' },
        },
      },
    ]);
  });

  it('a cosmetic setDiagram does not request layout', () => {
    const d = orderPlatform();
    const result = applyOk(d, changeSet(d, [{ op: 'setDiagram', patch: { name: 'Renamed' } }]));
    expect(result.layoutRequest).toBeNull();
    expect(result.diagramChanged).toBe(true);
  });
});

describe('spec §9 example', () => {
  it('applies to the order platform with the documented affected set and layout request', () => {
    const d = orderPlatform();
    const cs = ChangeSetSchema.parse({
      ...specExampleChangeSet(),
      diagramId: d.id,
      baseVersion: d.version,
    });
    const result = roundTrip(d, cs);
    expect(result.affected).toEqual({
      added: ['order-events', 'e11', 'e12'],
      modified: ['pay'],
      deleted: ['e4'],
    });
    expect(result.layoutRequest).toEqual({
      scope: expect.arrayContaining(['order-events', 'orders', 'pay']),
      reason: 'structural',
      hints: { 'order-events': 'orders' },
    });
    expect(nodeOf(result.diagram, 'pay').pinned).toBe(true);
    expect(result.diagram.version).toBe(13);
  });
});
