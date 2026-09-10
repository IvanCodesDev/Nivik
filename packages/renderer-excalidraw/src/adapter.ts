import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import {
  applyChangeSet,
  createDiagram,
  type Diagram,
  type Id,
  newEdgeId,
  newGroupId,
  newNodeId,
} from '@nivik/ir';
import {
  type ExportResult,
  emptyFidelity,
  type ImportResult,
  isNivik,
  type NativeElement,
  type NativeSnapshot,
  type RendererAdapter,
  type RendererCapabilities,
  reconcile,
} from '@nivik/renderer-core';
import { RENDERER_ID } from './constants';
import { parseScene, serializeScene } from './file';
import { fromExcalidraw } from './from-excalidraw';
import { mountExcalidraw } from './live';
import { toExcalidraw } from './to-excalidraw';

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
 * A file is a foreign document: tags left by whichever diagram exported it point at ids that mean
 * nothing here. Main parts become plain elements and go through promotion like hand-drawn ones.
 * A free-standing `label` part (how entities carry their text) hands its first line to its main
 * part; other decorative parts (lifelines, icons) are dropped — the main part carries the meaning.
 */
function asForeign(
  snapshot: NativeSnapshot,
  raw: readonly ExcalidrawElement[],
): { snapshot: NativeSnapshot; detailIds: string[] } {
  // The snapshot strips text from tagged parts on purpose; read the entity labels off the scene.
  const labels = new Map<string, string>();
  for (const el of raw) {
    if (el.type !== 'text' || el.containerId || el.isDeleted || !isNivik(el.customData)) continue;
    if (el.customData.nivik.part !== 'label') continue;
    const first = el.originalText.split('\n')[0]?.trim();
    if (first) labels.set(el.customData.nivik.id, first);
  }
  const detailIds: string[] = [];
  const elements: NativeElement[] = [];
  for (const el of snapshot.elements) {
    if (!el.nivik) {
      elements.push(el);
      continue;
    }
    if (el.nivik.part !== 'main') {
      if (el.nivik.part !== 'label' && !el.deleted) detailIds.push(el.nativeId);
      continue;
    }
    const label = labels.get(el.nivik.id);
    elements.push({
      ...el,
      nivik: null,
      ...(label !== undefined && el.label === undefined ? { label } : {}),
    });
  }
  return { snapshot: { ...snapshot, elements }, detailIds };
}

/**
 * Spec 04 §6.5 import: every element goes through the §5.3 promotion rules against an empty
 * diagram; what is not promoted stays an annotation and is reported as lost.
 */
export async function importDocument(
  input: Blob | string,
  opts: { name?: string } = {},
): Promise<ImportResult> {
  const text = typeof input === 'string' ? input : await input.text();
  const { elements } = parseScene(text);
  const { snapshot, detailIds } = asForeign(fromExcalidraw(elements), elements);
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
  if (detailIds.length > 0) {
    fidelity.lost.push({
      kind: 'node',
      ids: detailIds,
      reason: 'detail of a shape exported by Nivik (columns, lifelines); imported as a plain shape',
    });
  }
  fidelity.lossless = fidelity.lost.length === 0;
  return { diagram, fidelity };
}

/** Spec 04 §6.5 export: browser only — the skeletons are expanded by the Excalidraw bundle. */
export async function exportDocument(d: Diagram, opts: { ids?: Id[] } = {}): Promise<ExportResult> {
  const { convertToExcalidrawElements } = await import('@excalidraw/excalidraw');
  const { elements, fidelity } = toExcalidraw(d, opts);
  const text = serializeScene(convertToExcalidrawElements(elements, { regenerateIds: false }));
  return {
    blob: new Blob([text], { type: 'application/json' }),
    filename: `${d.name}.excalidraw`,
    mime: 'application/json',
    fidelity,
  };
}

export const excalidrawAdapter: RendererAdapter = {
  id: RENDERER_ID,
  capabilities,
  exportDocument,
  importDocument,
  mount: mountExcalidraw,
};
