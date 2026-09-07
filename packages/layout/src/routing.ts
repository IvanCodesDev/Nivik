import { type Point, type Rect, segmentIntersectsRect } from '@nivik/ir';

const centre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Where the ray from `r`'s centre towards `target` leaves `r`. */
export function borderPoint(r: Rect, target: Point): Point {
  const c = centre(r);
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = dx === 0 ? Number.POSITIVE_INFINITY : r.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Number.POSITIVE_INFINITY : r.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/** Two-point route between the facing borders of `a` and `b` (spec 03 §5.3 straight, §7.2 step 8). */
export function straightRoute(a: Rect, b: Rect): Point[] {
  return [borderPoint(a, centre(b)), borderPoint(b, centre(a))];
}

const dedupe = (points: Point[]): Point[] =>
  points.filter((p, i) => {
    const prev = points[i - 1];
    return prev === undefined || p.x !== prev.x || p.y !== prev.y;
  });

/**
 * Spec 03 §6.3 local orthogonal routing: exit → midline → entry. The midline sits halfway across the
 * gap; when it would cut through a third box it moves to that box's nearer far edge plus `gap`.
 */
export function orthogonalRoute(
  a: Rect,
  b: Rect,
  obstacles: readonly Rect[],
  gap: number,
): Point[] {
  const ca = centre(a);
  const cb = centre(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const exitX = dx >= 0 ? a.x + a.w : a.x;
    const entryX = dx >= 0 ? b.x : b.x + b.w;
    let mid = (exitX + entryX) / 2;
    for (const o of obstacles) {
      if (segmentIntersectsRect({ x: mid, y: ca.y }, { x: mid, y: cb.y }, o)) {
        const left = o.x - gap;
        const right = o.x + o.w + gap;
        mid = Math.abs(left - mid) <= Math.abs(right - mid) ? left : right;
      }
    }
    return dedupe([
      { x: exitX, y: ca.y },
      { x: mid, y: ca.y },
      { x: mid, y: cb.y },
      { x: entryX, y: cb.y },
    ]);
  }
  const exitY = dy >= 0 ? a.y + a.h : a.y;
  const entryY = dy >= 0 ? b.y : b.y + b.h;
  let mid = (exitY + entryY) / 2;
  for (const o of obstacles) {
    if (segmentIntersectsRect({ x: ca.x, y: mid }, { x: cb.x, y: mid }, o)) {
      const top = o.y - gap;
      const bottom = o.y + o.h + gap;
      mid = Math.abs(top - mid) <= Math.abs(bottom - mid) ? top : bottom;
    }
  }
  return dedupe([
    { x: ca.x, y: exitY },
    { x: ca.x, y: mid },
    { x: cb.x, y: mid },
    { x: cb.x, y: entryY },
  ]);
}
