import { type Diagram, type NodeType, type Rect, rectOf } from '@nivik/ir';
import { tagOf } from '../id-map';
import type { NativeElement, NativeKind, NativeSnapshot } from '../native';

const kindOf = (type: NodeType): NativeKind => {
  switch (type) {
    case 'text':
      return 'text';
    case 'image':
      return 'image';
    case 'line':
      return 'line';
    default:
      return 'shape';
  }
};
const FALLBACK: Rect = { x: 0, y: 0, w: 120, h: 56 };

/** A snapshot that mirrors the IR exactly — reconciling it must yield nothing (spec 04 §5.2 loop guard). */
export function snapshotFromDiagram(d: Diagram): NativeSnapshot {
  const elements: NativeElement[] = [];
  for (const n of d.nodes) {
    elements.push({
      nativeId: n.id,
      kind: kindOf(n.type),
      nivik: tagOf(n.id, 'main', n.meta.rev),
      deleted: false,
      bounds: rectOf(n) ?? FALLBACK,
      shape: n.type,
      label: n.label,
      frame: n.parent,
      override: n.style?.override ?? null,
    });
  }
  for (const g of d.groups) {
    elements.push({
      nativeId: g.id,
      kind: 'frame',
      nivik: tagOf(g.id, 'main', g.meta.rev),
      deleted: false,
      bounds: rectOf(g) ?? FALLBACK,
      label: g.label ?? '',
      frame: g.parent,
    });
  }
  for (const e of d.edges) {
    elements.push({
      nativeId: e.id,
      kind: 'arrow',
      nivik: tagOf(e.id, 'main', e.meta.rev),
      deleted: false,
      bounds: FALLBACK,
      label: e.label ?? '',
      binding: { start: e.source, end: e.target },
      frame: null,
    });
  }
  return { elements };
}

/** Copy of `snapshot` with one element patched. */
export function withElement(
  snapshot: NativeSnapshot,
  nativeId: string,
  patch: Partial<NativeElement>,
): NativeSnapshot {
  return {
    elements: snapshot.elements.map((el) => (el.nativeId === nativeId ? { ...el, ...patch } : el)),
  };
}
