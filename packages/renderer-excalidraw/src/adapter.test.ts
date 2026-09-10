import { validateDiagram } from '@nivik/ir';
import { type NativePart, tagOf } from '@nivik/renderer-core';
import { describe, expect, it } from 'vitest';
import { capabilities, excalidrawAdapter, importDocument } from './adapter';
import { serializeScene } from './file';
import { excalidrawElement as el } from './testing';

describe('importDocument (spec 04 §6.5 import → §5.3 promotion)', () => {
  it('promotes labelled shapes, bound arrows and frames; the rest is reported as lost', async () => {
    const text = serializeScene([
      el('rectangle', {
        id: 'r1',
        x: 0,
        y: 0,
        roundness: { type: 3 },
        boundElements: [{ id: 't1', type: 'text' }],
        frameId: 'f1',
      }),
      el('text', { id: 't1', x: 0, y: 0, originalText: 'Web', containerId: 'r1' }),
      el('ellipse', {
        id: 'r2',
        x: 300,
        y: 0,
        boundElements: [{ id: 't2', type: 'text' }],
        frameId: 'f1',
      }),
      el('text', { id: 't2', x: 0, y: 0, originalText: 'API', containerId: 'r2' }),
      el('arrow', {
        id: 'ar',
        x: 120,
        y: 28,
        startBinding: { elementId: 'r1', focus: 0, gap: 0 },
        endBinding: { elementId: 'r2', focus: 0, gap: 0 },
      }),
      el('frame', { id: 'f1', x: -20, y: -60, width: 500, height: 200, name: 'Edge' }),
      el('freedraw', { id: 'doodle', x: 900, y: 900 }),
    ]);
    const { diagram, fidelity } = await importDocument(text, { name: 'Imported' });
    expect(diagram.name).toBe('Imported');
    expect(diagram.nodes.map((n) => [n.type, n.label])).toEqual([
      ['rounded', 'Web'],
      ['ellipse', 'API'],
    ]);
    expect(diagram.nodes[0]).toMatchObject({ position: { x: 0, y: 0 }, size: { w: 120, h: 56 } });
    expect(diagram.edges).toHaveLength(1);
    expect(diagram.groups.map((g) => g.label)).toEqual(['Edge']);
    expect(diagram.nodes.every((n) => n.parent === diagram.groups[0]?.id)).toBe(true);
    expect(validateDiagram(diagram).ok).toBe(true);
    expect(fidelity.lossless).toBe(false);
    expect(fidelity.lost).toEqual([
      {
        kind: 'other',
        ids: ['doodle'],
        reason: 'kept as an annotation, not part of the diagram structure',
      },
    ]);
  });

  it('treats a scene exported by Nivik as a foreign document: tags are hints, structure comes back', async () => {
    // What `toExcalidraw` + the browser bundle write: tagged main parts, bound labels, a frame, an
    // entity with tagged column texts.
    const tag = (id: string, part: NativePart = 'main') => ({
      customData: { nivik: tagOf(id, part, 0) },
    });
    const text = serializeScene([
      el('rectangle', {
        id: 'x1',
        x: 0,
        y: 0,
        boundElements: [{ id: 'x1t', type: 'text' }],
        frameId: 'xf',
        ...tag('n_web'),
      }),
      el('text', {
        id: 'x1t',
        x: 0,
        y: 0,
        originalText: 'Web',
        containerId: 'x1',
        ...tag('n_web', 'label'),
      }),
      el('rectangle', {
        id: 'x2',
        x: 300,
        y: 0,
        boundElements: [{ id: 'x2t', type: 'text' }],
        frameId: 'xf',
        ...tag('n_api'),
      }),
      el('text', {
        id: 'x2t',
        x: 300,
        y: 0,
        originalText: 'API',
        containerId: 'x2',
        ...tag('n_api', 'label'),
      }),
      el('arrow', {
        id: 'xa',
        x: 120,
        y: 28,
        startBinding: { elementId: 'x1', focus: 0, gap: 0 },
        endBinding: { elementId: 'x2', focus: 0, gap: 0 },
        ...tag('e_1'),
      }),
      el('frame', {
        id: 'xf',
        x: -20,
        y: -60,
        width: 500,
        height: 200,
        name: 'Edge',
        ...tag('g_edge'),
      }),
      // An entity: plain rectangle plus a free-standing label text with one line per column.
      el('rectangle', { id: 'x3', x: 0, y: 300, ...tag('n_users') }),
      el('text', {
        id: 'x3l',
        x: 12,
        y: 308,
        originalText: 'users\nid: uuid\nemail',
        ...tag('n_users', 'label'),
      }),
      // A participant: rounded box with a bound label plus a dashed lifeline.
      el('rectangle', {
        id: 'x4',
        x: 600,
        y: 0,
        roundness: { type: 3 },
        boundElements: [{ id: 'x4t', type: 'text' }],
        ...tag('n_svc'),
      }),
      el('text', {
        id: 'x4t',
        x: 600,
        y: 0,
        originalText: 'Service',
        containerId: 'x4',
        ...tag('n_svc', 'label'),
      }),
      el('line', { id: 'x4l', x: 660, y: 56, locked: true, ...tag('n_svc', 'lifeline') }),
    ]);
    const { diagram, fidelity } = await importDocument(text, { name: 'Round trip' });
    expect(diagram.nodes.map((n) => n.label).sort()).toEqual(['API', 'Service', 'Web', 'users']);
    expect(diagram.nodes.every((n) => n.id.startsWith('n_'))).toBe(true);
    expect(diagram.edges).toHaveLength(1);
    expect(diagram.groups.map((g) => g.label)).toEqual(['Edge']);
    expect(fidelity.lossless).toBe(false);
    expect(fidelity.lost).toEqual([
      {
        kind: 'node',
        ids: ['x4l'],
        reason:
          'detail of a shape exported by Nivik (columns, lifelines); imported as a plain shape',
      },
    ]);
  });

  it('declares Excalidraw as a push-selection, overlay-highlight live renderer', () => {
    expect(capabilities).toMatchObject({
      levels: { export: true, import: true, live: true },
      groups: 'frame',
      nestedGroups: false,
      selection: 'push',
      highlight: 'overlay',
    });
    expect(capabilities.shapes.has('cylinder')).toBe(false);
    expect(excalidrawAdapter).toMatchObject({ id: 'excalidraw' });
    expect(typeof excalidrawAdapter.mount).toBe('function');
  });
});
