import type { Diagram, DiagramPatch, LayoutPatch } from '@nivik/ir';
import type { Plan } from '@nivik/protocol';

/**
 * The part of a plan that code, not the model, writes into the IR (spec 05 §4.5, 03 §3): the
 * diagram type the plan classified and the layout it chose. Only fields that differ from the
 * current document are included, so an edit that keeps the type and layout yields `null` and no
 * `setDiagram` action is prepended to the change set.
 */
export function diagramPatchFromPlan(plan: Plan, diagram: Diagram): DiagramPatch | null {
  const patch: DiagramPatch = {};

  if (plan.diagramType !== diagram.type) patch.type = plan.diagramType;

  const layout: LayoutPatch = {};
  if (plan.layout.algorithm !== undefined && plan.layout.algorithm !== diagram.layout.algorithm) {
    layout.algorithm = plan.layout.algorithm;
  }
  if (plan.layout.direction !== undefined && plan.layout.direction !== diagram.layout.direction) {
    layout.direction = plan.layout.direction;
  }
  if (Object.keys(layout).length > 0) patch.layout = layout;

  return Object.keys(patch).length > 0 ? patch : null;
}
