import {
  type Diagram,
  type DiagramIndex,
  type Id,
  type LayoutSpec,
  type Point,
  type Rect,
  rectsIntersect,
  unionRects,
} from '@nivik/ir';
import { ELK_SPACING, GROUP_PAD } from '../constants';
import { type Geometry, rectIn, roundPoint } from '../geometry';
import { orthogonalRoute, straightRoute } from '../routing';
import type { LayoutWarning } from '../types';

const MAX_PUSHES = 12;
const centre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const isHorizontal = (spec: LayoutSpec) => spec.direction === 'RIGHT' || spec.direction === 'LEFT';

/**
 * Spec 03 §6.2 step 6: shove each movable node perpendicular to the flow, one `nodeNode` step at a
 * time, until it overlaps nothing already placed; give up after twelve pushes with `W_PIN_OVERLAP`.
 */
export function resolveCollisions(
  order: readonly Id[],
  rects: Map<Id, Rect>,
  fixed: readonly { id: Id; rect: Rect }[],
  spec: LayoutSpec,
  warnings: LayoutWarning[],
): void {
  const placed = [...fixed];
  const step = ELK_SPACING[spec.spacing].nodeNode;
  const horizontal = isHorizontal(spec);
  for (const id of order) {
    let rect = rects.get(id);
    if (!rect) continue;
    const overlapping = (candidate: Rect) => placed.find((p) => rectsIntersect(p.rect, candidate));
    let blocker = overlapping(rect);
    if (!blocker) {
      placed.push({ id, rect });
      continue;
    }
    // Pick the side once, away from the first blocker; re-deciding per blocker oscillates between two.
    const c = centre(rect);
    const b = centre(blocker.rect);
    const sign = (horizontal ? c.y >= b.y : c.x >= b.x) ? 1 : -1;
    for (let i = 0; i < MAX_PUSHES && blocker; i += 1) {
      rect = horizontal
        ? { ...rect, y: rect.y + sign * step }
        : { ...rect, x: rect.x + sign * step };
      blocker = overlapping(rect);
    }
    if (blocker) {
      warnings.push({
        code: 'W_PIN_OVERLAP',
        ids: [id, blocker.id],
        message: `${id} still overlaps ${blocker.id} after ${MAX_PUSHES} pushes`,
      });
    }
    rects.set(id, rect);
    placed.push({ id, rect });
  }
}

/** Movable nodes closest to their reference (hint, else first placed neighbour) go first; unreferenced ones last. */
export function orderByReference(
  d: Diagram,
  index: DiagramIndex,
  movable: ReadonlySet<Id>,
  hints: Record<Id, Id>,
  rects: ReadonlyMap<Id, Rect>,
): Id[] {
  const referenceOf = (id: Id): Rect | null => {
    const hinted = hints[id];
    const candidates =
      hinted !== undefined
        ? [hinted]
        : (index.edgesByNode.get(id) ?? []).flatMap((edgeId) => {
            const e = index.edges.get(edgeId);
            return e ? [e.source === id ? e.target : e.source] : [];
          });
    for (const other of candidates) {
      const n = index.nodes.get(other);
      if (n?.position && n.size && !movable.has(other)) {
        return { x: n.position.x, y: n.position.y, w: n.size.w, h: n.size.h };
      }
    }
    return null;
  };
  const distance = (id: Id): number => {
    const rect = rects.get(id);
    const ref = referenceOf(id);
    if (!rect || !ref) return Number.POSITIVE_INFINITY;
    const a = centre(rect);
    const b = centre(ref);
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  return d.nodes
    .filter((n) => movable.has(n.id))
    .map((n) => n.id)
    .sort((a, b) => distance(a) - distance(b));
}

function translateSubtree(
  index: DiagramIndex,
  g: Geometry,
  rootId: Id,
  shift: { dx: number; dy: number },
): void {
  const visit = (id: Id) => {
    const element = index.nodes.get(id) ?? index.groups.get(id);
    const rect = element ? rectIn(g, element) : null;
    if (rect) g.positions.set(id, { x: rect.x + shift.dx, y: rect.y + shift.dy });
    for (const childId of index.byParent.get(id) ?? []) visit(childId);
  };
  visit(rootId);
}

/**
 * Spec 03 §6.2 step 7: every group above a touched node is rewrapped (innermost first); a sibling
 * group the grown box now overlaps is moved out of the way as a whole, perpendicular to the flow.
 */
export function refitGroups(
  index: DiagramIndex,
  g: Geometry,
  touched: ReadonlySet<Id>,
  spec: LayoutSpec,
): void {
  const hops = new Map<Id, number>();
  for (const id of touched) {
    let parent = index.nodes.get(id)?.parent ?? index.groups.get(id)?.parent ?? null;
    let hop = 0;
    while (parent !== null) {
      hops.set(parent, Math.max(hops.get(parent) ?? 0, hop));
      hop += 1;
      parent = index.groups.get(parent)?.parent ?? null;
    }
  }
  const affected = new Set(hops.keys());
  const ordered = [...affected].sort((a, b) => (hops.get(a) ?? 0) - (hops.get(b) ?? 0));
  const gap = ELK_SPACING[spec.spacing].nodeNode;
  for (const groupId of ordered) {
    const rects: Rect[] = [];
    for (const childId of index.byParent.get(groupId) ?? []) {
      const element = index.nodes.get(childId) ?? index.groups.get(childId);
      const rect = element ? rectIn(g, element) : null;
      if (rect) rects.push(rect);
    }
    const box = unionRects(rects);
    if (!box) continue;
    const next: Rect = {
      x: box.x - GROUP_PAD.side,
      y: box.y - GROUP_PAD.top,
      w: box.w + 2 * GROUP_PAD.side,
      h: box.h + GROUP_PAD.top + GROUP_PAD.bottom,
    };
    g.positions.set(groupId, { x: next.x, y: next.y });
    g.sizes.set(groupId, { w: next.w, h: next.h });

    const parent = index.groups.get(groupId)?.parent ?? null;
    for (const siblingId of index.byParent.get(parent) ?? []) {
      if (siblingId === groupId || !index.groups.has(siblingId) || affected.has(siblingId))
        continue;
      const sibling = index.groups.get(siblingId);
      const sr = sibling ? rectIn(g, sibling) : null;
      if (!sr || !rectsIntersect(next, sr)) continue;
      const shift = isHorizontal(spec)
        ? {
            dx: 0,
            dy:
              centre(sr).y >= centre(next).y
                ? next.y + next.h - sr.y + gap
                : -(sr.y + sr.h - next.y + gap),
          }
        : {
            dx:
              centre(sr).x >= centre(next).x
                ? next.x + next.w - sr.x + gap
                : -(sr.x + sr.w - next.x + gap),
            dy: 0,
          };
      translateSubtree(index, g, siblingId, shift);
    }
  }
}

/** Spec 03 §6.2 step 8 (decision 2): only edges with a moved endpoint or no route get a new one. */
export function rerouteEdges(d: Diagram, index: DiagramIndex, g: Geometry, spec: LayoutSpec): void {
  const moved = new Set<Id>();
  for (const [id, p] of g.positions) {
    const n = index.nodes.get(id);
    if (n && (n.position?.x !== p.x || n.position?.y !== p.y)) moved.add(id);
  }
  const rectOfNode = (id: Id): Rect | null => {
    const n = index.nodes.get(id);
    return n ? rectIn(g, n) : null;
  };
  const obstacles = d.nodes
    .filter((n) => n.type !== 'line')
    .map((n) => ({ id: n.id, rect: rectOfNode(n.id) }));
  const gap = ELK_SPACING[spec.spacing].edgeNode;
  for (const e of d.edges) {
    if (e.source === e.target) continue;
    if (e.route && !moved.has(e.source) && !moved.has(e.target)) continue;
    const a = rectOfNode(e.source);
    const b = rectOfNode(e.target);
    if (!a || !b) continue;
    const route =
      spec.edgeRouting === 'orthogonal'
        ? orthogonalRoute(
            a,
            b,
            obstacles.flatMap((o) =>
              o.rect && o.id !== e.source && o.id !== e.target ? [o.rect] : [],
            ),
            gap,
          )
        : straightRoute(a, b);
    g.routes.set(e.id, route.map(roundPoint));
  }
}
