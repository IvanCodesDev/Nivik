import { applyChangeSet } from '@nivik/ir';
import { orderPlatformLaidOut } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import type { NativeElement, NativeSnapshot } from './native';
import { reconcile, summarize } from './reconcile';
import { snapshotFromDiagram, withElement } from './testing';

const rules = () => {
  let n = 0;
  return {
    newNodeId: () => `n_new${++n}`,
    newEdgeId: () => `e_new${++n}`,
    newGroupId: () => `g_new${++n}`,
    now: 1_800_000_000_000,
    changeSetId: 'cs_test',
  };
};
const d = orderPlatformLaidOut();
const base = snapshotFromDiagram(d);
const actionsOf = (snapshot: NativeSnapshot) => reconcile(d, snapshot, rules())?.actions ?? null;

describe('reconcile (spec 04 §5.2, §11)', () => {
  it('loop guard: a snapshot mirroring the IR yields no change set', () => {
    expect(reconcile(d, base, rules())).toBeNull();
  });

  it('move → moveNode with rounded coordinates', () => {
    const moved = withElement(base, 'web', { bounds: { x: 300.4, y: 99.6, w: 160, h: 64 } });
    expect(actionsOf(moved)).toEqual([{ op: 'moveNode', id: 'web', position: { x: 300, y: 100 } }]);
  });

  it('resize → resizeNode', () => {
    const resized = withElement(base, 'web', { bounds: { x: 40, y: 40, w: 200, h: 80 } });
    expect(actionsOf(resized)).toEqual([{ op: 'resizeNode', id: 'web', size: { w: 200, h: 80 } }]);
  });

  it('rename → updateNode{label}', () => {
    expect(actionsOf(withElement(base, 'web', { label: 'Web Portal' }))).toEqual([
      { op: 'updateNode', id: 'web', patch: { label: 'Web Portal' } },
    ]);
  });

  it('delete → deleteNode only; the cascaded edges are not deleted twice', () => {
    let s = withElement(base, 'orders', { deleted: true });
    for (const id of ['e3', 'e4', 'e5', 'e7']) s = withElement(s, id, { deleted: true });
    expect(actionsOf(s)).toEqual([{ op: 'deleteNode', id: 'orders' }]);
  });

  it('rebinding an arrow end → updateEdge{target}', () => {
    expect(actionsOf(withElement(base, 'e1', { binding: { start: 'web', end: 'users' } }))).toEqual(
      [{ op: 'updateEdge', id: 'e1', patch: { target: 'users' } }],
    );
  });

  it('unbinding an arrow end demotes the edge to an annotation → deleteEdge', () => {
    expect(actionsOf(withElement(base, 'e1', { binding: { start: 'web' } }))).toEqual([
      { op: 'deleteEdge', id: 'e1' },
    ]);
  });

  it('dragging a node into an existing frame → setParent', () => {
    expect(actionsOf(withElement(base, 'web', { frame: 'edge' }))).toEqual([
      { op: 'setParent', ids: ['web'], parent: 'edge' },
    ]);
  });

  it('recolouring → setStyle{override}', () => {
    expect(actionsOf(withElement(base, 'web', { override: { fill: '#ffeeaa' } }))).toEqual([
      { op: 'setStyle', targets: ['web'], style: { override: { fill: '#ffeeaa' } } },
    ]);
  });

  it('a new labelled rectangle wired to an IR node is promoted to addNode + geometry + addEdge', () => {
    const rect: NativeElement = {
      nativeId: 'x1',
      kind: 'shape',
      nivik: null,
      deleted: false,
      bounds: { x: 700, y: 40.4, w: 120, h: 56 },
      shape: 'box',
      label: 'Audit log',
      frame: null,
    };
    const arrow: NativeElement = {
      nativeId: 'x2',
      kind: 'arrow',
      nivik: null,
      deleted: false,
      bounds: { x: 0, y: 0, w: 1, h: 1 },
      label: 'writes',
      binding: { start: 'users', end: 'x1' },
    };
    const cs = reconcile(d, { elements: [...base.elements, rect, arrow] }, rules());
    expect(cs?.actions).toEqual([
      { op: 'addNode', node: { id: 'n_new1', type: 'box', label: 'Audit log', parent: null } },
      { op: 'moveNode', id: 'n_new1', position: { x: 700, y: 40 } },
      { op: 'resizeNode', id: 'n_new1', size: { w: 120, h: 56 } },
      {
        op: 'addEdge',
        edge: {
          id: 'e_new2',
          source: 'users',
          target: 'n_new1',
          type: 'flow',
          direction: 'forward',
          sourceSide: 'auto',
          targetSide: 'auto',
          label: 'writes',
        },
      },
    ]);
    expect(cs).toMatchObject({
      id: 'cs_test',
      diagramId: d.id,
      baseVersion: d.version,
      origin: 'user',
      createdAt: 1_800_000_000_000,
    });
    if (!cs) throw new Error('expected a change set');
    expect(applyChangeSet(d, cs).ok).toBe(true);
  });

  it('a frame around IR nodes is promoted to addGroup{members}; loose sketches stay annotations', () => {
    const frame: NativeElement = {
      nativeId: 'f1',
      kind: 'frame',
      nivik: null,
      deleted: false,
      bounds: { x: 0, y: 0, w: 500, h: 300 },
      label: 'Data',
    };
    let s: NativeSnapshot = { elements: [...base.elements, frame] };
    s = withElement(s, 'pg', { frame: 'f1' });
    s = withElement(s, 'redis', { frame: 'f1' });
    const scribble: NativeElement = {
      nativeId: 'x9',
      kind: 'freedraw',
      nivik: null,
      deleted: false,
      bounds: { x: 1, y: 1, w: 9, h: 9 },
    };
    const note: NativeElement = {
      nativeId: 'x10',
      kind: 'text',
      nivik: null,
      deleted: false,
      bounds: { x: 1, y: 1, w: 9, h: 9 },
      label: 'todo',
    };
    const cs = reconcile(d, { elements: [...s.elements, scribble, note] }, rules());
    expect(cs?.actions).toEqual([
      {
        op: 'addGroup',
        group: { id: 'g_new1', label: 'Data', role: 'cluster', parent: null, collapsed: false },
        members: ['pg', 'redis'],
      },
    ]);
  });

  it('honours promote: false', () => {
    const rect: NativeElement = {
      nativeId: 'x1',
      kind: 'shape',
      nivik: null,
      deleted: false,
      bounds: { x: 0, y: 0, w: 10, h: 10 },
      shape: 'box',
      label: 'X',
    };
    expect(
      reconcile(d, { elements: [...base.elements, rect] }, { ...rules(), promote: false }),
    ).toBeNull();
  });

  it('summarises what happened', () => {
    expect(
      summarize([
        { op: 'moveNode', id: 'a', position: { x: 0, y: 0 } },
        { op: 'moveNode', id: 'b', position: { x: 0, y: 0 } },
        { op: 'updateNode', id: 'a', patch: { label: 'x' } },
        { op: 'deleteEdge', id: 'e' },
      ]),
    ).toBe('moved 2 nodes, renamed 1 node, deleted 1 edge');
  });
});
