// @vitest-environment happy-dom
import { diagram, group, node } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import { highlightShapes, mountHighlightOverlay, toScreen } from './highlight';

const at = (x: number, y: number) => ({ position: { x, y }, size: { w: 120, h: 56 } });
const d = diagram({
  groups: [group('g', 'G', { position: { x: 0, y: 0 }, size: { w: 400, h: 200 } })],
  nodes: [node('a', 'A', at(100, 100)), node('b', 'B', at(300, 100)), node('unplaced', 'U')],
});

describe('highlightShapes (spec 04 §5.4)', () => {
  it('maps IR geometry through the viewport and uses stored bounds for deleted ids', () => {
    const shapes = highlightShapes(
      d,
      {
        added: ['a'],
        modified: ['b', 'g', 'unplaced'],
        deleted: [{ id: 'gone', bounds: { x: 10, y: 10, w: 50, h: 20 } }],
      },
      { x: 10, y: -20, zoom: 2 },
    );
    expect(shapes).toEqual([
      { id: 'a', kind: 'added', rect: { x: 220, y: 160, w: 240, h: 112 } },
      { id: 'b', kind: 'modified', rect: { x: 620, y: 160, w: 240, h: 112 } },
      { id: 'g', kind: 'modified', rect: { x: 20, y: -40, w: 800, h: 400 } },
      { id: 'gone', kind: 'deleted', rect: { x: 40, y: -20, w: 100, h: 40 } },
    ]);
    expect(toScreen({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, zoom: 1 })).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });
  it('an id that is both added and modified is reported once, as added', () => {
    expect(
      highlightShapes(d, { added: ['a'], modified: ['a'], deleted: [] }, { x: 0, y: 0, zoom: 1 }),
    ).toHaveLength(1);
  });
});

describe('mountHighlightOverlay', () => {
  it('draws one rect per shape (plus a badge for additions), clears and unmounts', () => {
    const doc = globalThis.document;
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    const overlay = mountHighlightOverlay(host);
    expect(host.querySelector('svg')).toBe(overlay.element);
    expect(overlay.element.style.pointerEvents).toBe('none');
    overlay.render([
      { id: 'a', kind: 'added', rect: { x: 1, y: 2, w: 30, h: 40 } },
      { id: 'b', kind: 'modified', rect: { x: 5, y: 6, w: 30, h: 40 } },
      { id: 'c', kind: 'deleted', rect: { x: 9, y: 9, w: 30, h: 40 } },
    ]);
    expect(overlay.element.querySelectorAll('rect')).toHaveLength(3);
    expect(overlay.element.querySelectorAll('.nv-hl-added')).toHaveLength(1);
    expect(
      overlay.element.querySelector('.nv-hl-deleted')?.getAttribute('stroke-dasharray'),
    ).toBeTruthy();
    expect(overlay.element.querySelectorAll('text')).toHaveLength(1);
    overlay.clear();
    expect(overlay.element.childNodes).toHaveLength(0);
    overlay.destroy();
    expect(host.querySelector('svg')).toBeNull();
  });
});
