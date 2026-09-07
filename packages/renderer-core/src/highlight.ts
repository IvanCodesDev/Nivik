import { type Diagram, type Id, type Rect, rectOf } from '@nivik/ir';
import type { HighlightInput, Viewport } from './contract';

export type HighlightKind = 'added' | 'modified' | 'deleted';

export interface HighlightShape {
  id: Id;
  kind: HighlightKind;
  /** Screen-space rectangle. */
  rect: Rect;
}

/** Diagram → screen: scroll offset first, then zoom (Excalidraw's convention). */
export const toScreen = (r: Rect, v: Viewport): Rect => ({
  x: (r.x + v.x) * v.zoom,
  y: (r.y + v.y) * v.zoom,
  w: r.w * v.zoom,
  h: r.h * v.zoom,
});

/**
 * Spec 04 §5.4: the review overlay's geometry from IR + viewport. Deleted ids carry their own
 * bounds (the element is gone from the IR); an id both added and modified counts as added.
 */
export function highlightShapes(
  d: Diagram,
  h: HighlightInput,
  viewport: Viewport,
): HighlightShape[] {
  const rects = new Map<Id, Rect>();
  for (const el of [...d.nodes, ...d.groups]) {
    const r = rectOf(el);
    if (r) rects.set(el.id, r);
  }
  const out: HighlightShape[] = [];
  const seen = new Set<Id>();
  const push = (id: Id, kind: HighlightKind, rect: Rect | undefined) => {
    if (!rect || seen.has(id)) return;
    seen.add(id);
    out.push({ id, kind, rect: toScreen(rect, viewport) });
  };
  for (const id of h.added) push(id, 'added', rects.get(id));
  for (const id of h.modified) push(id, 'modified', rects.get(id));
  for (const { id, bounds } of h.deleted) push(id, 'deleted', bounds);
  return out;
}

export interface HighlightOverlay {
  readonly element: SVGSVGElement;
  render(shapes: readonly HighlightShape[]): void;
  clear(): void;
  destroy(): void;
}

const SVG = 'http://www.w3.org/2000/svg';
/** Palette strokes from @nivik/ui/tokens.css, with fallbacks so the overlay works without the tokens. */
const STROKE: Record<HighlightKind, string> = {
  added: 'var(--nv-pal-mint-stroke, #91b9a9)',
  modified: 'var(--nv-pal-lavender-stroke, #b59add)',
  deleted: 'var(--nv-pal-coral-stroke, #dcae9e)',
};
const PAD = 3;

const attr = (el: Element, values: Record<string, string | number>) => {
  for (const [k, v] of Object.entries(values)) el.setAttribute(k, String(v));
};

/**
 * Spec 04 §5.4 `overlay`: a pointer-transparent SVG layer over the renderer host. The adapter
 * calls `render` with fresh shapes whenever the viewport moves and `clear` on ttl / accept.
 */
export function mountHighlightOverlay(host: HTMLElement): HighlightOverlay {
  const doc = host.ownerDocument;
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('data-nivik-highlight', '');
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    overflow: 'visible',
  });
  host.appendChild(svg);

  const clear = () => {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  };
  return {
    element: svg,
    render(shapes) {
      clear();
      for (const s of shapes) {
        const rect = doc.createElementNS(SVG, 'rect');
        rect.setAttribute('class', `nv-hl nv-hl-${s.kind}`);
        attr(rect, {
          x: s.rect.x - PAD,
          y: s.rect.y - PAD,
          width: s.rect.w + 2 * PAD,
          height: s.rect.h + 2 * PAD,
          rx: 8,
          fill: 'none',
          stroke: STROKE[s.kind],
          'stroke-width': 2,
        });
        if (s.kind === 'deleted') rect.setAttribute('stroke-dasharray', '6 4');
        svg.appendChild(rect);
        if (s.kind === 'added') {
          const cx = s.rect.x + s.rect.w + PAD;
          const cy = s.rect.y - PAD;
          const badge = doc.createElementNS(SVG, 'circle');
          attr(badge, { cx, cy, r: 9, fill: STROKE.added });
          const plus = doc.createElementNS(SVG, 'text');
          attr(plus, {
            x: cx,
            y: cy + 4,
            'text-anchor': 'middle',
            'font-size': 12,
            'font-weight': 700,
            fill: '#fff',
          });
          plus.textContent = '+';
          svg.append(badge, plus);
        }
      }
    },
    clear,
    destroy() {
      svg.remove();
    },
  };
}
