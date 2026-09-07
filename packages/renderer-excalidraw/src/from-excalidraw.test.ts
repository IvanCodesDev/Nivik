import { diagram, node, orderPlatformLaidOut } from '@nivik/ir/testing';
import { reconcile, tagOf } from '@nivik/renderer-core';
import { describe, expect, it } from 'vitest';
import { fromExcalidraw } from './from-excalidraw';
import { colorsFor } from './palette';
import { excalidrawElement as el } from './testing';

const tag = (id: string, part: 'main' | 'label' = 'main') => ({
  customData: { nivik: tagOf(id, part, 0) },
});

describe('fromExcalidraw (spec 04 §6.4)', () => {
  it('reduces containers with bound text, arrows with bindings and frames to the neutral snapshot', () => {
    const elements = [
      el('rectangle', {
        id: 'a',
        x: 10.4,
        y: 20.6,
        width: 160,
        height: 64,
        roundness: { type: 3 },
        frameId: 'g',
        boundElements: [{ id: 't1', type: 'text' }],
        ...tag('a'),
      }),
      el('text', {
        id: 't1',
        x: 0,
        y: 0,
        text: 'Web App',
        originalText: 'Web App',
        containerId: 'a',
      }),
      el('diamond', { id: 'x1', x: 0, y: 0, boundElements: [{ id: 't2', type: 'text' }] }),
      el('text', { id: 't2', x: 0, y: 0, originalText: 'Paid?', containerId: 'x1' }),
      el('arrow', {
        id: 'e1',
        x: 0,
        y: 0,
        startBinding: { elementId: 'a', focus: 0, gap: 0 },
        endBinding: { elementId: 'x1', focus: 0, gap: 0 },
        ...tag('e1'),
      }),
      el('frame', { id: 'g', x: 0, y: 0, name: 'Edge', ...tag('g') }),
      el('text', { id: 'note', x: 5, y: 5, originalText: 'todo' }),
      el('freedraw', { id: 'scribble', x: 1, y: 1 }),
    ];
    const { elements: out } = fromExcalidraw(elements);
    const byId = (id: string) => out.find((e) => e.nativeId === id);
    expect(byId('a')).toMatchObject({
      kind: 'shape',
      shape: 'rounded',
      label: 'Web App',
      frame: 'g',
      bounds: { x: 10.4, y: 20.6, w: 160, h: 64 },
      nivik: { id: 'a', part: 'main' },
    });
    expect(byId('t1')).toBeUndefined();
    expect(byId('x1')).toMatchObject({
      kind: 'shape',
      shape: 'diamond',
      label: 'Paid?',
      nivik: null,
    });
    expect(byId('e1')).toMatchObject({ kind: 'arrow', binding: { start: 'a', end: 'x1' } });
    expect(byId('g')).toMatchObject({ kind: 'frame', label: 'Edge' });
    expect(byId('note')).toMatchObject({ kind: 'text', label: 'todo' });
    expect(byId('scribble')).toMatchObject({ kind: 'freedraw' });
  });

  it('reports colour overrides only against the IR token mapping; tagged parts carry no label', () => {
    const d = diagram({
      nodes: [
        node('a', 'A', {
          style: { palette: 'mint' },
          position: { x: 0, y: 0 },
          size: { w: 120, h: 56 },
        }),
      ],
    });
    const same = el('rectangle', {
      id: 'a',
      x: 0,
      y: 0,
      strokeColor: '#91b9a9',
      backgroundColor: '#eff9f5',
      ...tag('a'),
    });
    const recoloured = el('rectangle', {
      id: 'a',
      x: 0,
      y: 0,
      strokeColor: '#91b9a9',
      backgroundColor: '#ffeeaa',
      ...tag('a'),
    });
    const part = el('text', {
      id: 'a:label',
      x: 0,
      y: 0,
      originalText: 'A\nid: uuid',
      ...tag('a', 'label'),
    });
    expect(fromExcalidraw([same], d).elements[0]?.override).toBeNull();
    expect(fromExcalidraw([recoloured], d).elements[0]?.override).toEqual({ fill: '#ffeeaa' });
    expect(fromExcalidraw([same]).elements[0]?.override).toBeUndefined();
    expect(fromExcalidraw([part], d).elements[0]).toMatchObject({
      kind: 'text',
      nivik: { part: 'label' },
    });
    expect(fromExcalidraw([part], d).elements[0]?.label).toBeUndefined();
  });

  it('round-trips a dragged node through reconcile with integer coordinates', () => {
    const d = orderPlatformLaidOut();
    const elements = d.nodes.map((n) => {
      const style = colorsFor(d.theme, n.style);
      return el('rectangle', {
        id: n.id,
        x: n.position?.x ?? 0,
        y: n.position?.y ?? 0,
        width: 160,
        height: 64,
        strokeColor: style.strokeColor,
        backgroundColor: style.backgroundColor,
        roundness: n.type === 'box' ? null : { type: 3 },
        frameId: n.parent,
        boundElements: [{ id: `${n.id}-t`, type: 'text' }],
        ...tag(n.id),
      });
    });
    const texts = d.nodes.map((n) =>
      el('text', { id: `${n.id}-t`, x: 0, y: 0, originalText: n.label, containerId: n.id }),
    );
    const frames = d.groups.map((g) =>
      el('frame', {
        id: g.id,
        x: g.position?.x ?? 0,
        y: g.position?.y ?? 0,
        width: 660,
        height: 400,
        name: g.label ?? '',
        ...tag(g.id),
      }),
    );
    const arrows = d.edges.map((e) =>
      el('arrow', {
        id: e.id,
        x: 0,
        y: 0,
        startBinding: { elementId: e.source, focus: 0, gap: 0 },
        endBinding: { elementId: e.target, focus: 0, gap: 0 },
        ...tag(e.id),
      }),
    );
    const scene = [...elements, ...texts, ...frames, ...arrows];
    const rules = { newNodeId: () => 'n_x', newEdgeId: () => 'e_x', newGroupId: () => 'g_x' };
    expect(reconcile(d, fromExcalidraw(scene, d), rules)).toBeNull();
    const dragged = scene.map((e) => (e.id === 'web' ? { ...e, x: 300.6, y: 99.4 } : e));
    expect(reconcile(d, fromExcalidraw(dragged, d), rules)?.actions).toEqual([
      { op: 'moveNode', id: 'web', position: { x: 301, y: 99 } },
    ]);
  });
});
