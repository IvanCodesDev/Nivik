import type { Diagram, DiagramGroup, DiagramNode, Id, Point, Size } from '@nivik/ir';
import type { Geometry } from './geometry';

const samePoint = (a?: Point, b?: Point) => a?.x === b?.x && a?.y === b?.y;
const sameSize = (a?: Size, b?: Size) => a?.w === b?.w && a?.h === b?.h;
const samePoints = (a: readonly Point[], b?: readonly Point[]) =>
  b !== undefined && a.length === b.length && a.every((p, i) => samePoint(p, b[i]));

/**
 * Writes a strategy's geometry onto a copy of the diagram (spec 03 §2: only position/size/route
 * change, never `version` or `meta`) and reports the elements whose geometry actually changed.
 */
export function applyGeometry(
  d: Diagram,
  g: Geometry,
): { diagram: Diagram; moved: Id[]; routed: Id[] } {
  const moved: Id[] = [];
  const routed: Id[] = [];
  const place = <T extends DiagramNode | DiagramGroup>(element: T): T => {
    const position = g.positions.get(element.id) ?? element.position;
    const size = g.sizes.get(element.id) ?? element.size;
    if (!samePoint(position, element.position) || !sameSize(size, element.size)) {
      moved.push(element.id);
    }
    return { ...element, ...(position ? { position } : {}), ...(size ? { size } : {}) } as T;
  };
  const nodes = d.nodes.map((n) => place(n));
  const groups = d.groups.map((group) => place(group));
  const edges = d.edges.map((e) => {
    const points = g.routes.get(e.id);
    if (!points) return e;
    if (!samePoints(points, e.route?.points)) routed.push(e.id);
    return { ...e, route: { points } };
  });
  return { diagram: { ...d, nodes, edges, groups }, moved, routed };
}
