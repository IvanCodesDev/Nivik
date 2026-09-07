import type { Cell, Diagram, DiagramIndex, Id, LayoutSpec, Rect, Size } from '@nivik/ir';
import { ELK_SPACING, GROUP_PAD, MIN_CELL_H, MIN_CELL_W } from '../constants';
import { emptyGeometry, type Geometry, rectIn, roundPoint, roundSize } from '../geometry';
import { orthogonalRoute, straightRoute } from '../routing';
import type { SizeMap } from '../types';
import { ancestorPads, createSizer, rangeBox, type Tracks, tilesOf } from './metrics';
import type { GridPlan } from './plan';

const FALLBACK_SIZE: Size = { w: MIN_CELL_W, h: MIN_CELL_H };

/**
 * Spec 03 §7.2 steps 5–8. Groups, lines and spanning nodes fill their (pad-shrunk) range box; 1×1
 * nodes are centred at their measured size; same-cell tiles spread horizontally; stacked children
 * flow inside their group; pinned nodes are left alone but still count as routing obstacles.
 */
export function placeGrid(
  d: Diagram,
  index: DiagramIndex,
  plan: GridPlan,
  tracks: Tracks,
  sizes: SizeMap,
  spec: LayoutSpec,
): Geometry {
  const g = emptyGeometry();
  const sizer = createSizer(index, plan, sizes, tracks.gutter);
  const put = (id: Id, rect: Rect) => {
    g.positions.set(id, roundPoint(rect));
    g.sizes.set(id, roundSize(rect));
  };
  const boxOf = (id: Id, range: Cell): Rect => {
    const box = rangeBox(range, tracks);
    const pads = ancestorPads(index, plan, id, range);
    return {
      x: box.x + pads.left,
      y: box.y + pads.top,
      w: box.w - pads.left - pads.right,
      h: box.h - pads.top - pads.bottom,
    };
  };
  const centred = (box: Rect, size: Size): Rect => ({
    x: box.x + (box.w - size.w) / 2,
    y: box.y + (box.h - size.h) / 2,
    w: size.w,
    h: size.h,
  });

  for (const group of d.groups) {
    const range = plan.ranges.get(group.id);
    if (range) put(group.id, boxOf(group.id, range));
  }

  const tiles = tilesOf(d, plan);
  for (const n of d.nodes) {
    const range = plan.ranges.get(n.id);
    if (!range) continue;
    const box = boxOf(n.id, range);
    const members = tiles.get(n.id) ?? [n.id];
    if (members.length > 1) {
      if (members[0] !== n.id) continue;
      const measured = members.map((id) => sizes.get(id) ?? FALLBACK_SIZE);
      const total =
        measured.reduce((acc, s) => acc + s.w, 0) + tracks.gutter * (members.length - 1);
      let x = box.x + (box.w - total) / 2;
      for (const [i, id] of members.entries()) {
        const s = measured[i] ?? FALLBACK_SIZE;
        put(id, { x, y: box.y + (box.h - s.h) / 2, w: s.w, h: s.h });
        x += s.w + tracks.gutter;
      }
      continue;
    }
    if (n.type === 'line' || range.colSpan > 1 || range.rowSpan > 1) put(n.id, box);
    else put(n.id, centred(box, sizes.get(n.id) ?? FALLBACK_SIZE));
  }

  const placeStack = (groupId: Id, rect: Rect) => {
    const vertical = sizer.isVertical(groupId);
    let x = rect.x + GROUP_PAD.side;
    let y = rect.y + GROUP_PAD.top;
    for (const id of plan.stacked.get(groupId) ?? []) {
      const s = sizer.unitSize(id);
      const unit = { x, y, w: s.w, h: s.h };
      put(id, unit);
      if (index.groups.has(id)) placeStack(id, unit);
      if (vertical) y += s.h + tracks.gutter;
      else x += s.w + tracks.gutter;
    }
  };
  for (const group of d.groups) {
    const rect = rectIn(g, group);
    if (plan.ranges.has(group.id) && rect) placeStack(group.id, rect);
  }

  const nodeRect = (id: Id): Rect | null => {
    const n = index.nodes.get(id);
    return n ? rectIn(g, n) : null;
  };
  const obstacles = d.nodes
    .filter((n) => n.type !== 'line')
    .map((n) => ({ id: n.id, rect: nodeRect(n.id) }));
  const gap = ELK_SPACING[spec.spacing].edgeNode;
  for (const e of d.edges) {
    if (e.source === e.target) continue;
    const a = nodeRect(e.source);
    const b = nodeRect(e.target);
    if (!a || !b) continue;
    if (spec.edgeRouting === 'orthogonal') {
      const others = obstacles.flatMap((o) =>
        o.rect && o.id !== e.source && o.id !== e.target ? [o.rect] : [],
      );
      g.routes.set(e.id, orthogonalRoute(a, b, others, gap).map(roundPoint));
    } else {
      g.routes.set(e.id, straightRoute(a, b).map(roundPoint));
    }
  }
  return g;
}
