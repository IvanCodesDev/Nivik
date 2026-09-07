import {
  type Diagram,
  type DiagramIndex,
  type Id,
  type LayoutSpec,
  neighborhood,
  type Point,
  type Rect,
  type Size,
} from '@nivik/ir';
import { ELK_SPACING } from '../constants';
import type { Geometry } from '../geometry';
import type { SizeMap } from '../types';

export interface Region {
  /** Spec 03 §6.2 R: the affected neighbourhood (ELK's context). */
  region: Set<Id>;
  /** Spec 03 §6.2 F: pinned nodes and everything outside R. */
  frozen: Set<Id>;
  /** Nodes that actually get new coordinates: unplaced or hinted members of R, plus any unplaced node elsewhere. */
  movable: Set<Id>;
}

function descendantNodes(index: DiagramIndex, groupId: Id): Id[] {
  const out: Id[] = [];
  for (const childId of index.byParent.get(groupId) ?? []) {
    if (index.nodes.has(childId)) out.push(childId);
    else out.push(...descendantNodes(index, childId));
  }
  return out;
}

/**
 * Spec 03 §6.2 step 1. Everything with coordinates stays put (decision 6): only unplaced or
 * hinted nodes move, so a style-only edit that lands a node in `affected` never nudges its
 * neighbours.
 */
export function regionOf(
  d: Diagram,
  index: DiagramIndex,
  affected: readonly Id[],
  hints: Record<Id, Id>,
): Region {
  const seeds: Id[] = [];
  for (const id of affected) {
    if (index.nodes.has(id)) seeds.push(id);
    else if (index.groups.has(id)) seeds.push(...descendantNodes(index, id));
  }
  const region = new Set<Id>(neighborhood(d, seeds, 1));
  for (const id of seeds) {
    const parent = index.nodes.get(id)?.parent ?? null;
    if (parent === null) continue;
    for (const sibling of index.byParent.get(parent) ?? []) {
      if (index.nodes.has(sibling)) region.add(sibling);
    }
  }
  for (const n of d.nodes) if (n.pinned && n.position) region.delete(n.id);

  const frozen = new Set<Id>();
  const movable = new Set<Id>();
  for (const n of d.nodes) {
    if (!region.has(n.id)) frozen.add(n.id);
    const unplaced = n.position === undefined;
    if (region.has(n.id) ? unplaced || hints[n.id] !== undefined : unplaced && !n.pinned) {
      movable.add(n.id);
    }
  }
  return { region, frozen, movable };
}

/** One slot past `hint` along the flow direction (spec 03 §6.2 step 3). */
export function nextTo(
  hint: Rect,
  size: Size,
  direction: LayoutSpec['direction'],
  gap: number,
): Point {
  switch (direction) {
    case 'RIGHT':
      return { x: hint.x + hint.w + gap, y: hint.y };
    case 'LEFT':
      return { x: hint.x - gap - size.w, y: hint.y };
    case 'DOWN':
      return { x: hint.x, y: hint.y + hint.h + gap };
    case 'UP':
      return { x: hint.x, y: hint.y - gap - size.h };
  }
}

/** Fixed nodes and groups at their coordinates, movable nodes at their hint slot; the rest is ELK's call. */
export function desiredPositions(
  d: Diagram,
  index: DiagramIndex,
  sizes: SizeMap,
  movable: ReadonlySet<Id>,
  hints: Record<Id, Id>,
  spec: LayoutSpec,
): Map<Id, Point> {
  const out = new Map<Id, Point>();
  const gap = ELK_SPACING[spec.spacing].nodeNode;
  for (const group of d.groups) if (group.position) out.set(group.id, group.position);
  for (const n of d.nodes) {
    if (!movable.has(n.id)) {
      if (n.position) out.set(n.id, n.position);
      continue;
    }
    const hintId = hints[n.id];
    const hint = hintId === undefined ? undefined : index.nodes.get(hintId);
    const hintSize = hint ? (sizes.get(hint.id) ?? hint.size) : undefined;
    if (hint?.position && hintSize) {
      const hintRect = { x: hint.position.x, y: hint.position.y, w: hintSize.w, h: hintSize.h };
      out.set(n.id, nextTo(hintRect, sizes.get(n.id) ?? hintSize, spec.direction, gap));
    } else if (n.position) {
      out.set(n.id, n.position);
    }
  }
  return out;
}

/**
 * Spec 03 §6.2 step 5: ELK's interactive strategies keep the order but drift the drawing, so
 * movable nodes are shifted back by the mean displacement of the fixed nodes adjacent to them
 * (every fixed node when nothing is adjacent). Fixed nodes never take ELK's coordinates.
 */
export function anchor(
  d: Diagram,
  movable: ReadonlySet<Id>,
  elk: Geometry,
  original: ReadonlyMap<Id, Point>,
): Map<Id, Point> {
  const adjacent = new Set<Id>();
  for (const e of d.edges) {
    if (movable.has(e.source) && original.has(e.target)) adjacent.add(e.target);
    if (movable.has(e.target) && original.has(e.source)) adjacent.add(e.source);
  }
  const anchors = [...(adjacent.size > 0 ? adjacent : original.keys())].filter(
    (id) => elk.positions.has(id) && !movable.has(id),
  );
  let dx = 0;
  let dy = 0;
  for (const id of anchors) {
    const after = elk.positions.get(id);
    const before = original.get(id);
    if (!after || !before) continue;
    dx += (after.x - before.x) / anchors.length;
    dy += (after.y - before.y) / anchors.length;
  }
  const out = new Map<Id, Point>();
  for (const id of movable) {
    const p = elk.positions.get(id);
    if (p) out.set(id, { x: Math.round(p.x - dx), y: Math.round(p.y - dy) });
  }
  return out;
}
