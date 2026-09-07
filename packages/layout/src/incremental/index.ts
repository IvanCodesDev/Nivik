import {
  type Diagram,
  type Id,
  indexDiagram,
  type LayoutSpec,
  type Point,
  type Rect,
  unionRects,
} from '@nivik/ir';
import { ELK_SPACING, ELK_TIMEOUT_MS, MIN_NODE_H, MIN_NODE_W } from '../constants';
import { createBundledEngine, LayoutAbortedError, runElk } from '../elk/engine';
import { fromElk } from '../elk/from-elk';
import { toElk } from '../elk/to-elk';
import { emptyGeometry, type Geometry, rectIn } from '../geometry';
import { layoutLayered } from '../layered';
import type { LayoutOptions, LayoutWarning, SizeMap } from '../types';
import { orderByReference, refitGroups, rerouteEdges, resolveCollisions } from './collision';
import { anchor, desiredPositions, regionOf } from './region';

export interface IncrementalInput {
  affected: Id[];
  hints: Record<Id, Id>;
}

/** Movable nodes nobody could place (engine failure, no hint, no coordinates) go past the drawing along the flow. */
function placeLeftovers(
  d: Diagram,
  sizes: SizeMap,
  movable: ReadonlySet<Id>,
  placed: Map<Id, Point>,
  spec: LayoutSpec,
): void {
  const leftovers = d.nodes.filter((n) => movable.has(n.id) && !placed.has(n.id));
  if (leftovers.length === 0) return;
  const rects: Rect[] = [];
  for (const n of d.nodes) {
    const p = placed.get(n.id) ?? (movable.has(n.id) ? undefined : n.position);
    const s = sizes.get(n.id);
    if (p && s) rects.push({ x: p.x, y: p.y, w: s.w, h: s.h });
  }
  const bounds = unionRects(rects) ?? { x: 0, y: 0, w: 0, h: 0 };
  const s = ELK_SPACING[spec.spacing];
  const horizontal = spec.direction === 'RIGHT' || spec.direction === 'LEFT';
  let cross = horizontal ? bounds.y : bounds.x;
  for (const n of leftovers) {
    const size = sizes.get(n.id) ?? { w: MIN_NODE_W, h: MIN_NODE_H };
    placed.set(
      n.id,
      horizontal
        ? { x: bounds.x + bounds.w + s.betweenLayers, y: cross }
        : { x: cross, y: bounds.y + bounds.h + s.betweenLayers },
    );
    cross += (horizontal ? size.h : size.w) + s.nodeNode;
  }
}

/**
 * Spec 03 §6: place what changed, leave everything else exactly where it is. ELK (interactive)
 * proposes positions for the movable nodes in the context of the fixed ones; anchoring cancels its
 * drift, collision pushing keeps the result overlap-free, groups are rewrapped and only edges with
 * a moved endpoint are rerouted. A failing engine degrades to hint placement, not a full relayout.
 */
export async function layoutIncremental(
  d: Diagram,
  sizes: SizeMap,
  spec: LayoutSpec,
  input: IncrementalInput,
  opts: Pick<LayoutOptions, 'engine' | 'timeoutMs' | 'signal'>,
  warnings: LayoutWarning[],
): Promise<Geometry> {
  // First generation: nothing to anchor to (spec 03 §6.2 step 2).
  if (!d.nodes.some((n) => n.position)) return layoutLayered(d, sizes, spec, opts, warnings);
  const index = indexDiagram(d);
  const { movable } = regionOf(d, index, input.affected, input.hints);
  const g = emptyGeometry();
  for (const [id, size] of sizes) g.sizes.set(id, size);

  const original = new Map<Id, Point>();
  for (const n of d.nodes) if (n.position && !movable.has(n.id)) original.set(n.id, n.position);
  const desired = desiredPositions(d, index, sizes, movable, input.hints, spec);
  let placed = new Map<Id, Point>();
  if (movable.size > 0) {
    try {
      const engine = opts.engine ?? (await createBundledEngine());
      const out = await runElk(
        engine,
        toElk(d, sizes, spec, { positions: desired }),
        opts.timeoutMs ?? ELK_TIMEOUT_MS,
        opts.signal,
      );
      placed = anchor(d, movable, fromElk(out, d, true), original);
    } catch (error) {
      if (error instanceof LayoutAbortedError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      warnings.push({
        code: 'W_LAYOUT_FALLBACK',
        ids: [...movable],
        message: `ELK incremental layout failed (${reason}); placed by hints instead`,
      });
    }
    for (const id of movable) {
      const p = desired.get(id);
      if (!placed.has(id) && p) placed.set(id, p);
    }
    placeLeftovers(d, sizes, movable, placed, spec);
  }

  const rects = new Map<Id, Rect>();
  for (const id of movable) {
    const p = placed.get(id);
    const s = sizes.get(id);
    if (p && s) rects.set(id, { x: p.x, y: p.y, w: s.w, h: s.h });
  }
  const fixed = d.nodes.flatMap((n) => {
    if (movable.has(n.id)) return [];
    const r = rectIn(g, n);
    return r ? [{ id: n.id, rect: r }] : [];
  });
  resolveCollisions(
    orderByReference(d, index, movable, input.hints, rects),
    rects,
    fixed,
    spec,
    warnings,
  );
  for (const [id, r] of rects) g.positions.set(id, { x: r.x, y: r.y });
  refitGroups(index, g, movable, spec);
  rerouteEdges(d, index, g, spec);
  return g;
}
