import type { Point, Rect, Size } from './schema/geometry';

/** Bounding rect of a laid-out element, or null when position/size are not both present. */
export function rectOf(element: { position?: Point; size?: Size }): Rect | null {
  if (!element.position || !element.size) return null;
  return { x: element.position.x, y: element.position.y, w: element.size.w, h: element.size.h };
}

/** Strict intersection: rects that merely touch along an edge do not intersect. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function unionRects(rects: readonly Rect[]): Rect | null {
  const first = rects[0];
  if (!first) return null;
  let x0 = first.x;
  let y0 = first.y;
  let x1 = first.x + first.w;
  let y1 = first.y + first.h;
  for (const r of rects.slice(1)) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Liang–Barsky clip: does the segment p→q pass through the interior of `rect`? The rect is shrunk
 * by `eps` so segments that only touch the border (e.g. an edge ending on a node) do not count.
 */
export function segmentIntersectsRect(p: Point, q: Point, rect: Rect, eps = 1e-6): boolean {
  const xMin = rect.x + eps;
  const xMax = rect.x + rect.w - eps;
  const yMin = rect.y + eps;
  const yMax = rect.y + rect.h - eps;
  if (xMin >= xMax || yMin >= yMax) return false;

  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const clips: [number, number][] = [
    [-dx, p.x - xMin],
    [dx, xMax - p.x],
    [-dy, p.y - yMin],
    [dy, yMax - p.y],
  ];
  for (const [pk, qk] of clips) {
    if (pk === 0) {
      if (qk < 0) return false;
      continue;
    }
    const t = qk / pk;
    if (pk < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return t0 < t1;
}
