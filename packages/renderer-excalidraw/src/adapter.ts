import { applyChangeSet, createDiagram, newEdgeId, newGroupId, newNodeId } from '@nivik/ir';
import {
  emptyFidelity,
  type ImportResult,
  type RendererCapabilities,
  reconcile,
} from '@nivik/renderer-core';
import { parseScene } from './file';
import { fromExcalidraw } from './from-excalidraw';

/** Spec 04 §2.2 / §4: what the Excalidraw adapter can do. */
export const capabilities: RendererCapabilities = {
  levels: { export: true, import: true, live: true },
  formats: ['.excalidraw'],
  shapes: new Set([
    'box',
    'rounded',
    'ellipse',
    'diamond',
    'text',
    'line',
    'entity',
    'participant',
  ]),
  groups: 'frame',
  nestedGroups: false,
  edgeRouting: ['orthogonal', 'straight', 'polyline'],
  liveEdgeRerouting: true,
  selection: 'push',
  highlight: 'overlay',
  sketchStyle: true,
  measure: true,
};

/**
 * Spec 04 §6.5 import: every user-drawn element goes through the §5.3 promotion rules against an
 * empty diagram; what is not promoted stays an annotation and is reported as lost.
 */
export async function importDocument(
  input: Blob | string,
  opts: { name?: string } = {},
): Promise<ImportResult> {
  const text = typeof input === 'string' ? input : await input.text();
  const { elements } = parseScene(text);
  const snapshot = fromExcalidraw(elements);
  const empty = createDiagram({ name: opts.name ?? 'Imported diagram' });
  const cs = reconcile(empty, snapshot, { newNodeId, newEdgeId, newGroupId });
  let diagram = empty;
  if (cs) {
    const applied = applyChangeSet(empty, cs);
    if (!applied.ok) throw new Error(`import failed: ${applied.error.message}`);
    diagram = applied.diagram;
  }

  const consumed = new Set<string>();
  const live = snapshot.elements.filter((el) => !el.deleted);
  const labelled = (id: string) =>
    live.some((m) => m.nativeId === id && m.kind === 'shape' && (m.label ?? '').trim() !== '');
  for (const el of live) {
    const promotedShape = el.kind === 'shape' && (el.label ?? '').trim() !== '';
    const boundArrow =
      el.kind === 'arrow' &&
      el.binding?.start !== undefined &&
      el.binding.end !== undefined &&
      labelled(el.binding.start) &&
      labelled(el.binding.end);
    const frame =
      el.kind === 'frame' && live.some((m) => m.frame === el.nativeId && labelled(m.nativeId));
    if (promotedShape || boundArrow || frame) consumed.add(el.nativeId);
  }
  const fidelity = emptyFidelity();
  const lost = live.filter((el) => !consumed.has(el.nativeId)).map((el) => el.nativeId);
  if (lost.length > 0) {
    fidelity.lost.push({
      kind: 'other',
      ids: lost,
      reason: 'kept as an annotation, not part of the diagram structure',
    });
  }
  fidelity.lossless = fidelity.lost.length === 0;
  return { diagram, fidelity };
}
