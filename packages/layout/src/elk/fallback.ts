import {
  type Diagram,
  type DiagramIndex,
  type Id,
  indexDiagram,
  type LayoutSpec,
  type Rect,
} from '@nivik/ir';
import { ELK_SPACING, MIN_NODE_H, MIN_NODE_W } from '../constants';
import { emptyGeometry, fitGroups, type Geometry, rectIn } from '../geometry';
import { straightRoute } from '../routing';
import type { SizeMap } from '../types';

/** Longest-path depth from the sources (Kahn); nodes caught in cycles land one layer past the rest. */
function bfsDepth(d: Diagram, index: DiagramIndex): Map<Id, number> {
  const depth = new Map<Id, number>();
  const indegree = new Map<Id, number>(d.nodes.map((n) => [n.id, 0]));
  for (const e of d.edges) {
    if (e.source === e.target || !indegree.has(e.source) || !indegree.has(e.target)) continue;
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }
  const queue = d.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  for (const id of queue) depth.set(id, 0);
  for (let i = 0; i < queue.length; i += 1) {
    const id = queue[i];
    if (id === undefined) break;
    for (const edgeId of index.edgesByNode.get(id) ?? []) {
      const e = index.edges.get(edgeId);
      if (!e || e.source !== id || e.target === id || !indegree.has(e.target)) continue;
      depth.set(e.target, Math.max(depth.get(e.target) ?? 0, (depth.get(id) ?? 0) + 1));
      const remaining = (indegree.get(e.target) ?? 0) - 1;
      indegree.set(e.target, remaining);
      if (remaining === 0) queue.push(e.target);
    }
  }
  const deepest = Math.max(-1, ...depth.values());
  for (const n of d.nodes) if (!depth.has(n.id)) depth.set(n.id, deepest + 1);
  return depth;
}

/**
 * Spec 03 §5.4 fallback when ELK is unavailable: one column (or row) per BFS depth along the
 * direction, nodes stacked inside it, straight routes, groups wrapped afterwards. Ugly but complete.
 */
export function fallbackLayered(d: Diagram, sizes: SizeMap, spec: LayoutSpec): Geometry {
  const index = indexDiagram(d);
  const depth = bfsDepth(d, index);
  const layers = new Map<number, Id[]>();
  for (const n of d.nodes) {
    const k = depth.get(n.id) ?? 0;
    const list = layers.get(k);
    if (list) list.push(n.id);
    else layers.set(k, [n.id]);
  }
  const s = ELK_SPACING[spec.spacing];
  const horizontal = spec.direction === 'RIGHT' || spec.direction === 'LEFT';
  const order = [...layers.keys()].sort((a, b) => a - b);
  if (spec.direction === 'LEFT' || spec.direction === 'UP') order.reverse();

  const g = emptyGeometry();
  const sizeOf = (id: Id) => sizes.get(id) ?? { w: MIN_NODE_W, h: MIN_NODE_H };
  let main = 0;
  for (const k of order) {
    const ids = layers.get(k) ?? [];
    const thickness = Math.max(0, ...ids.map((id) => (horizontal ? sizeOf(id).w : sizeOf(id).h)));
    let cross = 0;
    for (const id of ids) {
      const size = sizeOf(id);
      g.positions.set(id, horizontal ? { x: main, y: cross } : { x: cross, y: main });
      g.sizes.set(id, size);
      cross += (horizontal ? size.h : size.w) + s.nodeNode;
    }
    main += thickness + s.betweenLayers;
  }
  fitGroups(d, g);

  const rectOfNode = (id: Id): Rect | null => {
    const n = index.nodes.get(id);
    return n ? rectIn(g, n) : null;
  };
  for (const e of d.edges) {
    if (e.source === e.target) continue;
    const a = rectOfNode(e.source);
    const b = rectOfNode(e.target);
    if (a && b) g.routes.set(e.id, straightRoute(a, b));
  }
  return g;
}
