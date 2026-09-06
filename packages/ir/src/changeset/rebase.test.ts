import { describe, expect, it } from 'vitest';
import { orderPlatform } from '../testing/order-platform';
import { specExampleChangeSet } from '../testing/spec-example';
import type { ActionSchema } from './actions';
import { type ChangeSet, ChangeSetSchema } from './changeset';
import { affectedIds, rebaseChangeSet } from './rebase';

type ActionInput = Parameters<typeof ActionSchema.parse>[0];

const d = orderPlatform();

const cs = (actions: ActionInput[], overrides: Record<string, unknown> = {}): ChangeSet =>
  ChangeSetSchema.parse({
    id: 'cs_x',
    diagramId: d.id,
    baseVersion: d.version,
    origin: 'user',
    createdAt: 1,
    actions,
    ...overrides,
  });

const aiExample = (): ChangeSet =>
  ChangeSetSchema.parse({ ...specExampleChangeSet(), diagramId: d.id, baseVersion: d.version });

describe('affectedIds', () => {
  it('collects the ids an action touches or relies on, per op', () => {
    const cases: [ActionInput, string[]][] = [
      [
        {
          op: 'addNode',
          node: { id: 'n1', type: 'box', label: 'N', parent: 'svc', near: 'orders' },
        },
        ['n1', 'svc', 'orders'],
      ],
      [{ op: 'updateNode', id: 'web', patch: { label: 'W' } }, ['web']],
      [{ op: 'deleteNode', id: 'pg' }, ['pg']],
      [{ op: 'pinNodes', ids: ['a', 'b'], pinned: true }, ['a', 'b']],
      [
        { op: 'addEdge', edge: { id: 'e11', source: 'orders', target: 'pay' } },
        ['e11', 'orders', 'pay'],
      ],
      [{ op: 'updateEdge', id: 'e1', patch: { source: 'gw', label: 'x' } }, ['e1', 'gw']],
      [{ op: 'deleteEdge', id: 'e2' }, ['e2']],
      [
        { op: 'addGroup', group: { id: 'g1', parent: 'svc' }, members: ['users'] },
        ['g1', 'svc', 'users'],
      ],
      [{ op: 'updateGroup', id: 'edge', patch: { label: 'E' } }, ['edge']],
      [{ op: 'deleteGroup', id: 'svc', mode: 'cascade' }, ['svc']],
      [{ op: 'setParent', ids: ['web'], parent: 'svc' }, ['web', 'svc']],
      [{ op: 'setParent', ids: ['web'], parent: null }, ['web']],
      [
        { op: 'setStyle', targets: ['pay', 'stripe'], style: { palette: 'sand' } },
        ['pay', 'stripe'],
      ],
      [{ op: 'relayout', scope: ['orders'], near: { orders: 'mq' } }, ['orders', 'mq']],
      [{ op: 'relayout' }, [d.id]],
      [{ op: 'setDiagram', patch: { name: 'x' } }, [d.id]],
      [{ op: 'moveNode', id: 'web', position: { x: 0, y: 0 } }, ['web']],
      [{ op: 'resizeNode', id: 'gw', size: { w: 1, h: 1 } }, ['gw']],
      [
        {
          op: 'applyLayout',
          positions: { web: { x: 0, y: 0 } },
          sizes: { svc: { w: 1, h: 1 } },
          routes: { e1: null },
        },
        ['web', 'svc', 'e1'],
      ],
    ];
    for (const [action, expected] of cases) {
      expect([...affectedIds(cs([action]))], JSON.stringify(action)).toEqual(expected);
    }
  });

  it('unions across actions without duplicates, in first-appearance order', () => {
    expect([...affectedIds(aiExample())]).toEqual([
      'order-events',
      'svc',
      'orders',
      'e4',
      'e11',
      'e12',
      'pay',
    ]);
  });
});

describe('rebaseChangeSet', () => {
  const current = { ...d, version: 14 };

  it('is clean when the concurrent edits touched other elements', () => {
    const ai = aiExample();
    const since = [
      cs([{ op: 'updateNode', id: 'web', patch: { label: 'Web' } }], { baseVersion: 12 }),
    ];
    const result = rebaseChangeSet(ai, current, since);
    expect(result).toEqual({ kind: 'clean', rebased: { ...ai, baseVersion: 14 } });
  });

  it('reports the exact overlapping ids as conflicts', () => {
    const ai = aiExample();
    const since = [
      cs([{ op: 'moveNode', id: 'pay', position: { x: 1, y: 1 } }], { baseVersion: 12 }),
      cs(
        [
          { op: 'deleteEdge', id: 'e4' },
          { op: 'updateNode', id: 'web', patch: { label: 'W' } },
        ],
        { baseVersion: 13 },
      ),
    ];
    expect(rebaseChangeSet(ai, current, since)).toEqual({
      kind: 'conflict',
      conflicts: ['e4', 'pay'],
    });
  });

  it('treats diagram-wide edits as touching the diagram itself', () => {
    const relayoutAll = cs([{ op: 'relayout' }], { origin: 'ai', runId: 'r' });
    const since = [cs([{ op: 'setDiagram', patch: { type: 'flow' } }])];
    expect(rebaseChangeSet(relayoutAll, current, since)).toEqual({
      kind: 'conflict',
      conflicts: [d.id],
    });
    const sinceLocal = [cs([{ op: 'updateNode', id: 'web', patch: { label: 'W' } }])];
    expect(rebaseChangeSet(relayoutAll, current, sinceLocal).kind).toBe('clean');
  });

  it('never conflicts for user change sets — the user is live', () => {
    const user = cs([{ op: 'updateNode', id: 'pay', patch: { label: 'Payments' } }]);
    const since = [
      cs([{ op: 'setStyle', targets: ['pay'], style: { palette: 'sand' } }], {
        origin: 'ai',
        runId: 'r',
      }),
    ];
    expect(rebaseChangeSet(user, current, since)).toEqual({
      kind: 'clean',
      rebased: { ...user, baseVersion: 14 },
    });
  });

  it('is a no-op rebase when nothing happened in between', () => {
    const ai = aiExample();
    expect(rebaseChangeSet(ai, d, [])).toEqual({ kind: 'clean', rebased: ai });
  });
});
