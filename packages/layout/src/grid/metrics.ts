import type { Cell, Diagram, DiagramIndex, Id, Rect, Size } from '@nivik/ir';
import { GROUP_PAD, MIN_CELL_H, MIN_CELL_W } from '../constants';
import type { SizeMap } from '../types';
import type { GridPlan } from './plan';

export interface Tracks {
  colW: number[];
  rowH: number[];
  gutter: number;
}

/** What one celled element needs from the tracks it covers (content + shared-edge group padding). */
export interface Requirement {
  id: Id;
  range: Cell;
  w: number;
  h: number;
}

const sum = (xs: readonly number[]) => xs.reduce((acc, x) => acc + x, 0);
const FALLBACK_SIZE: Size = { w: MIN_CELL_W, h: MIN_CELL_H };

/**
 * Sizes of stacked units (spec 03 §7.2 step 2, local flow): nodes as measured, cell-less groups as
 * their stack plus GROUP_PAD. Tall-or-square ranges stack vertically, wide ones horizontally.
 */
export function createSizer(index: DiagramIndex, plan: GridPlan, sizes: SizeMap, gutter: number) {
  const isVertical = (groupId: Id): boolean => {
    const range = plan.ranges.get(groupId);
    return !range || range.rowSpan >= range.colSpan;
  };
  const stackSize = (groupId: Id): Size => {
    const vertical = isVertical(groupId);
    let w = 0;
    let h = 0;
    for (const [i, id] of (plan.stacked.get(groupId) ?? []).entries()) {
      const s = unitSize(id);
      if (vertical) {
        w = Math.max(w, s.w);
        h += s.h + (i > 0 ? gutter : 0);
      } else {
        h = Math.max(h, s.h);
        w += s.w + (i > 0 ? gutter : 0);
      }
    }
    return { w: w + 2 * GROUP_PAD.side, h: h + GROUP_PAD.top + GROUP_PAD.bottom };
  };
  const unitSize = (id: Id): Size =>
    index.groups.has(id) ? stackSize(id) : (sizes.get(id) ?? FALLBACK_SIZE);
  return { stackSize, unitSize, isVertical };
}

/** Padding owed to every ancestor group on the edges `range` shares with that group's range. */
export function ancestorPads(
  index: DiagramIndex,
  plan: GridPlan,
  id: Id,
  range: Cell,
): { top: number; right: number; bottom: number; left: number } {
  const pads = { top: 0, right: 0, bottom: 0, left: 0 };
  let parent = (index.nodes.get(id) ?? index.groups.get(id))?.parent ?? null;
  while (parent !== null) {
    const a = plan.ranges.get(parent);
    if (a) {
      if (range.row === a.row) pads.top += GROUP_PAD.top;
      if (range.row + range.rowSpan === a.row + a.rowSpan) pads.bottom += GROUP_PAD.bottom;
      if (range.col === a.col) pads.left += GROUP_PAD.side;
      if (range.col + range.colSpan === a.col + a.colSpan) pads.right += GROUP_PAD.side;
    }
    parent = index.groups.get(parent)?.parent ?? null;
  }
  return pads;
}

/**
 * Same-parent nodes sharing one exact cell tile horizontally (spec 03 §7.2 step 5); every member
 * maps to the whole tile, first member first.
 */
export function tilesOf(d: Diagram, plan: GridPlan): Map<Id, Id[]> {
  const byKey = new Map<string, Id[]>();
  for (const n of d.nodes) {
    const range = plan.ranges.get(n.id);
    if (!range || n.type === 'line') continue;
    const key = `${n.parent ?? ''}|${range.col},${range.row},${range.colSpan},${range.rowSpan}`;
    const list = byKey.get(key);
    if (list) list.push(n.id);
    else byKey.set(key, [n.id]);
  }
  const out = new Map<Id, Id[]>();
  for (const ids of byKey.values()) for (const id of ids) out.set(id, ids);
  return out;
}

/**
 * Spec 03 §7.2 step 3 inputs. Lines have no intrinsic size; groups whose children sit in the grid
 * size themselves through those children.
 */
export function collectRequirements(
  d: Diagram,
  index: DiagramIndex,
  plan: GridPlan,
  sizes: SizeMap,
  gutter: number,
): Requirement[] {
  const sizer = createSizer(index, plan, sizes, gutter);
  const out: Requirement[] = [];
  const push = (id: Id, range: Cell, content: Size) => {
    const pads = ancestorPads(index, plan, id, range);
    out.push({
      id,
      range,
      w: content.w + pads.left + pads.right,
      h: content.h + pads.top + pads.bottom,
    });
  };
  const tiles = tilesOf(d, plan);
  for (const n of d.nodes) {
    const range = plan.ranges.get(n.id);
    const members = tiles.get(n.id);
    if (!range || !members || members[0] !== n.id) continue;
    const measured = members.map((id) => sizes.get(id) ?? FALLBACK_SIZE);
    push(n.id, range, {
      w: sum(measured.map((s) => s.w)) + gutter * (members.length - 1),
      h: Math.max(...measured.map((s) => s.h)),
    });
  }
  for (const group of d.groups) {
    const range = plan.ranges.get(group.id);
    if (!range) continue;
    if (plan.stacked.has(group.id)) {
      push(group.id, range, sizer.stackSize(group.id));
    } else if ((index.byParent.get(group.id) ?? []).length === 0) {
      push(group.id, range, {
        w: FALLBACK_SIZE.w + 2 * GROUP_PAD.side,
        h: FALLBACK_SIZE.h + GROUP_PAD.top + GROUP_PAD.bottom,
      });
    }
  }
  return out;
}

/** Spec 03 §7.2 step 3 (single-span maxima) and step 5 (spanning elements stretch their tracks evenly). */
export function measureTracks(
  plan: GridPlan,
  requirements: readonly Requirement[],
  gutter: number,
): Tracks {
  const colW = Array.from({ length: plan.cols }, () => MIN_CELL_W);
  const rowH = Array.from({ length: plan.rows }, () => MIN_CELL_H);
  for (const r of requirements) {
    if (r.range.colSpan === 1) colW[r.range.col] = Math.max(colW[r.range.col] ?? MIN_CELL_W, r.w);
    if (r.range.rowSpan === 1) rowH[r.range.row] = Math.max(rowH[r.range.row] ?? MIN_CELL_H, r.h);
  }
  const stretch = (tracks: number[], start: number, span: number, need: number) => {
    const have = sum(tracks.slice(start, start + span)) + gutter * (span - 1);
    if (need <= have) return;
    const extra = Math.ceil((need - have) / span);
    for (let i = start; i < start + span; i += 1) tracks[i] = (tracks[i] ?? 0) + extra;
  };
  for (const r of requirements) {
    if (r.range.colSpan > 1) stretch(colW, r.range.col, r.range.colSpan, r.w);
    if (r.range.rowSpan > 1) stretch(rowH, r.range.row, r.range.rowSpan, r.h);
  }
  return { colW, rowH, gutter };
}

const offset = (tracks: readonly number[], gutter: number, index: number) =>
  sum(tracks.slice(0, index)) + gutter * index;

/** Spec 03 §7.2 step 4: the pixel box of a range; the trailing gutter is not part of it. */
export function rangeBox(range: Cell, t: Tracks): Rect {
  return {
    x: offset(t.colW, t.gutter, range.col),
    y: offset(t.rowH, t.gutter, range.row),
    w: sum(t.colW.slice(range.col, range.col + range.colSpan)) + t.gutter * (range.colSpan - 1),
    h: sum(t.rowH.slice(range.row, range.row + range.rowSpan)) + t.gutter * (range.rowSpan - 1),
  };
}
