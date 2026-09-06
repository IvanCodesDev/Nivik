import { describe, expect, it } from 'vitest';
import { specExampleChangeSet } from '../testing/spec-example';
import { ACTION_OPS, ActionSchema, AGENT_ACTION_OPS, AgentActionSchema } from './actions';
import { ChangeSetSchema } from './changeset';

describe('AgentActionSchema (what the LLM may output)', () => {
  it('parses every action of the spec §9 example', () => {
    for (const action of specExampleChangeSet().actions) {
      expect(AgentActionSchema.safeParse(action).success, JSON.stringify(action)).toBe(true);
    }
  });

  it('rejects coordinates and server-filled fields on addNode via strict input variants', () => {
    const base = { op: 'addNode', node: { id: 'n1', type: 'box', label: 'N' } };
    expect(AgentActionSchema.safeParse(base).success).toBe(true);
    for (const extra of [
      { position: { x: 1, y: 2 } },
      { size: { w: 10, h: 10 } },
      { pinned: true },
      { meta: { createdBy: 'ai', createdAt: 1, updatedAt: 1, rev: 0 } },
    ]) {
      const withExtra = { op: 'addNode', node: { ...base.node, ...extra } };
      expect(AgentActionSchema.safeParse(withExtra).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it('does not accept user-only or system-only ops', () => {
    expect(
      AgentActionSchema.safeParse({ op: 'moveNode', id: 'a', position: { x: 0, y: 0 } }).success,
    ).toBe(false);
    expect(AgentActionSchema.safeParse({ op: 'applyLayout', positions: {} }).success).toBe(false);
  });

  it('exposes the 14 agent ops and the 17 total ops', () => {
    expect(AGENT_ACTION_OPS).toHaveLength(14);
    expect(ACTION_OPS).toHaveLength(17);
    expect(ACTION_OPS).toEqual(
      expect.arrayContaining([...AGENT_ACTION_OPS, 'moveNode', 'resizeNode', 'applyLayout']),
    );
  });
});

describe('ActionSchema (full set)', () => {
  it('accepts user and system ops with defaults', () => {
    expect(ActionSchema.parse({ op: 'moveNode', id: 'a', position: { x: 1, y: 2 } })).toEqual({
      op: 'moveNode',
      id: 'a',
      position: { x: 1, y: 2 },
    });
    expect(ActionSchema.parse({ op: 'applyLayout', positions: { a: { x: 0, y: 0 } } })).toEqual({
      op: 'applyLayout',
      positions: { a: { x: 0, y: 0 } },
      sizes: {},
      routes: {},
    });
  });

  it('fills action-level defaults (relayout scope, addGroup members, deleteGroup mode)', () => {
    expect(ActionSchema.parse({ op: 'relayout' })).toEqual({ op: 'relayout', scope: 'all' });
    expect(ActionSchema.parse({ op: 'addGroup', group: { id: 'g' } })).toEqual({
      op: 'addGroup',
      group: { id: 'g', role: 'cluster', parent: null, collapsed: false },
      members: [],
    });
    expect(ActionSchema.parse({ op: 'deleteGroup', id: 'g' })).toEqual({
      op: 'deleteGroup',
      id: 'g',
      mode: 'ungroup',
    });
  });

  it('lets patches clear optional fields with null and rejects unknown or identity keys', () => {
    expect(
      ActionSchema.safeParse({
        op: 'updateNode',
        id: 'a',
        patch: { description: null, role: null },
      }).success,
    ).toBe(true);
    expect(ActionSchema.safeParse({ op: 'updateNode', id: 'a', patch: { id: 'b' } }).success).toBe(
      false,
    );
    expect(
      ActionSchema.safeParse({ op: 'updateNode', id: 'a', patch: { position: { x: 0, y: 0 } } })
        .success,
    ).toBe(false);
    expect(
      ActionSchema.safeParse({ op: 'updateEdge', id: 'e', patch: { label: null, source: 'b' } })
        .success,
    ).toBe(true);
    expect(
      ActionSchema.safeParse({
        op: 'updateGroup',
        id: 'g',
        patch: { label: null, collapsed: true },
      }).success,
    ).toBe(true);
    expect(
      ActionSchema.safeParse({ op: 'setStyle', targets: ['a'], style: { stroke: null } }).success,
    ).toBe(true);
  });

  it('keeps setDiagram layout/theme patches partial instead of filling defaults', () => {
    const parsed = ActionSchema.parse({
      op: 'setDiagram',
      patch: { layout: { direction: 'DOWN' }, theme: { fontScale: 'l' }, description: null },
    });
    expect(parsed).toEqual({
      op: 'setDiagram',
      patch: { layout: { direction: 'DOWN' }, theme: { fontScale: 'l' }, description: null },
    });
  });

  it('rejects unknown ops', () => {
    expect(ActionSchema.safeParse({ op: 'teleportNode', id: 'a' }).success).toBe(false);
  });
});

describe('ChangeSetSchema', () => {
  it('parses the spec §9 example', () => {
    const parsed = ChangeSetSchema.parse(specExampleChangeSet());
    expect(parsed.actions).toHaveLength(5);
    expect(parsed.origin).toBe('ai');
  });

  it('requires at least one and at most 500 actions', () => {
    const cs = specExampleChangeSet();
    expect(ChangeSetSchema.safeParse({ ...cs, actions: [] }).success).toBe(false);
    const tooMany = Array.from({ length: 501 }, (_, i) => ({ op: 'deleteEdge', id: `e${i}` }));
    expect(ChangeSetSchema.safeParse({ ...cs, actions: tooMany }).success).toBe(false);
  });
});
