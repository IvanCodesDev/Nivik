import { validateDiagram } from '@nivik/ir';
import { describe, expect, it } from 'vitest';
import { capabilities, importDocument } from './adapter';
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
  it('declares Excalidraw as a push-selection, overlay-highlight live renderer', () => {
    expect(capabilities).toMatchObject({
      levels: { export: true, import: true, live: true },
      groups: 'frame',
      nestedGroups: false,
      selection: 'push',
      highlight: 'overlay',
    });
    expect(capabilities.shapes.has('cylinder')).toBe(false);
  });
});
