import {
  type Diagram,
  type Id,
  indexDiagram,
  type Point,
  type Rect,
  type Size,
  unionRects,
} from '@nivik/ir';
import { GROUP_PAD } from './constants';

/** What a strategy produces: absolute positions, sizes and routes for the elements it placed. */
export interface Geometry {
  positions: Map<Id, Point>;
  sizes: Map<Id, Size>;
  routes: Map<Id, Point[]>;
}

export const emptyGeometry = (): Geometry => ({
  positions: new Map(),
  sizes: new Map(),
  routes: new Map(),
});

export const roundPoint = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });
export const roundSize = (s: Size): Size => ({
  w: Math.max(1, Math.round(s.w)),
  h: Math.max(1, Math.round(s.h)),
});

/** Rect of an element from `g`, falling back to the geometry already stored on the element. */
export function rectIn(
  g: Geometry,
  element: { id: Id; position?: Point; size?: Size },
): Rect | null {
  const p = g.positions.get(element.id) ?? element.position;
  const s = g.sizes.get(element.id) ?? element.size;
  return p && s ? { x: p.x, y: p.y, w: s.w, h: s.h } : null;
}

/**
 * Post-order bounding boxes for groups the strategy did not place itself: each wraps its placed
 * children plus GROUP_PAD (spec 03 §5.1); groups without a placed child are left untouched.
 */
export function fitGroups(d: Diagram, g: Geometry): void {
  const index = indexDiagram(d);
  const visit = (groupId: Id) => {
    const rects: Rect[] = [];
    for (const childId of index.byParent.get(groupId) ?? []) {
      if (index.groups.has(childId)) visit(childId);
      const element = index.nodes.get(childId) ?? index.groups.get(childId);
      const rect = element ? rectIn(g, element) : null;
      if (rect) rects.push(rect);
    }
    const box = unionRects(rects);
    if (!box) return;
    g.positions.set(groupId, { x: box.x - GROUP_PAD.side, y: box.y - GROUP_PAD.top });
    g.sizes.set(groupId, {
      w: box.w + 2 * GROUP_PAD.side,
      h: box.h + GROUP_PAD.top + GROUP_PAD.bottom,
    });
  };
  for (const group of d.groups) if (group.parent === null) visit(group.id);
}
