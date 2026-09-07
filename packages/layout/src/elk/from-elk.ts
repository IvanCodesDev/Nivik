import type { Diagram, Id, Point, Rect } from '@nivik/ir';
import type { ElkNode } from 'elkjs/lib/elk-api';
import { emptyGeometry, type Geometry, roundPoint, roundSize } from '../geometry';
import { straightRoute } from '../routing';

/**
 * Spec 03 §5.3: ELK child coordinates are relative to their parent and edge sections to the edge's
 * `container`; both become absolute here. Edges without sections (or `straight` routing) get a
 * border-to-border straight route.
 */
export function fromElk(root: ElkNode, d: Diagram, straight: boolean): Geometry {
  const g = emptyGeometry();
  const origins = new Map<string, Point>([[root.id, { x: 0, y: 0 }]]);
  const walk = (parent: ElkNode, origin: Point) => {
    for (const child of parent.children ?? []) {
      const abs = { x: origin.x + (child.x ?? 0), y: origin.y + (child.y ?? 0) };
      g.positions.set(child.id, roundPoint(abs));
      g.sizes.set(child.id, roundSize({ w: child.width ?? 0, h: child.height ?? 0 }));
      origins.set(child.id, abs);
      walk(child, abs);
    }
  };
  walk(root, { x: 0, y: 0 });

  const rectOf = (id: Id): Rect | null => {
    const p = g.positions.get(id);
    const s = g.sizes.get(id);
    return p && s ? { x: p.x, y: p.y, w: s.w, h: s.h } : null;
  };
  const elkEdges = new Map((root.edges ?? []).map((e) => [e.id, e]));
  for (const e of d.edges) {
    const a = rectOf(e.source);
    const b = rectOf(e.target);
    if (!a || !b) continue;
    const elkEdge = elkEdges.get(e.id);
    const section = elkEdge?.sections?.[0];
    if (straight || !elkEdge || !section) {
      if (e.source !== e.target) g.routes.set(e.id, straightRoute(a, b).map(roundPoint));
      continue;
    }
    const origin = origins.get(elkEdge.container ?? root.id) ?? { x: 0, y: 0 };
    const shift = (p: Point): Point => roundPoint({ x: origin.x + p.x, y: origin.y + p.y });
    g.routes.set(
      e.id,
      [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(shift),
    );
  }
  return g;
}
