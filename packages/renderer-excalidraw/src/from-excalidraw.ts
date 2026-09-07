import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { Diagram, DiagramNode, Id, NodeType, StyleOverride } from '@nivik/ir';
import {
  isNivik,
  type NativeElement,
  type NativeSnapshot,
  type NivikTag,
} from '@nivik/renderer-core';
import { colorsFor } from './palette';

const HEX = /^#[0-9a-f]{6}$/i;

/** Colours the user changed away from the token mapping — only derivable with the IR at hand. */
function overrideFor(
  el: ExcalidrawElement,
  tag: NivikTag | null,
  nodes: ReadonlyMap<Id, DiagramNode> | undefined,
  ir: Diagram | undefined,
): StyleOverride | null | undefined {
  if (!ir || !nodes || !tag || tag.part !== 'main') return undefined;
  const node = nodes.get(tag.id);
  if (!node) return undefined;
  const expected = colorsFor(ir.theme, node.style);
  const override: StyleOverride = {};
  if (el.backgroundColor !== expected.backgroundColor && HEX.test(el.backgroundColor)) {
    override.fill = el.backgroundColor.toLowerCase();
  }
  if (el.strokeColor !== expected.strokeColor && HEX.test(el.strokeColor)) {
    override.stroke = el.strokeColor.toLowerCase();
  }
  return Object.keys(override).length > 0 ? override : null;
}

/**
 * Spec 04 §6.4: reduce an Excalidraw scene to the neutral snapshot. Bound text is folded into its
 * container's label; tagged parts (entity columns, lifelines) carry no label so `reconcile` leaves
 * them alone; colour overrides are only derived when the IR is at hand.
 */
export function fromExcalidraw(
  elements: readonly ExcalidrawElement[],
  ir?: Diagram,
): NativeSnapshot {
  const labelByContainer = new Map<string, string>();
  for (const el of elements) {
    if (el.type === 'text' && el.containerId) labelByContainer.set(el.containerId, el.originalText);
  }
  const nodes = ir ? new Map(ir.nodes.map((n) => [n.id, n])) : undefined;
  const out: NativeElement[] = [];
  for (const el of elements) {
    if (el.type === 'selection' || (el.type === 'text' && el.containerId)) continue;
    const tag = isNivik(el.customData) ? el.customData.nivik : null;
    const base = {
      nativeId: el.id,
      nivik: tag,
      deleted: el.isDeleted,
      bounds: { x: el.x, y: el.y, w: el.width, h: el.height },
      frame: el.frameId,
      locked: el.locked,
    };
    const label = labelByContainer.get(el.id);
    const withLabel = label !== undefined ? { label } : {};
    switch (el.type) {
      case 'rectangle':
      case 'ellipse':
      case 'diamond': {
        const shape: NodeType =
          el.type === 'rectangle' ? (el.roundness ? 'rounded' : 'box') : el.type;
        const override = overrideFor(el, tag, nodes, ir);
        out.push({
          ...base,
          kind: 'shape',
          shape,
          ...withLabel,
          ...(override !== undefined ? { override } : {}),
        });
        break;
      }
      case 'text':
        out.push(
          tag && tag.part !== 'main'
            ? { ...base, kind: 'text' }
            : { ...base, kind: 'text', label: el.originalText },
        );
        break;
      case 'arrow':
        out.push({
          ...base,
          kind: 'arrow',
          binding: { start: el.startBinding?.elementId, end: el.endBinding?.elementId },
          ...withLabel,
        });
        break;
      case 'line':
        out.push({ ...base, kind: 'line' });
        break;
      case 'frame':
      case 'magicframe':
        out.push({ ...base, kind: 'frame', label: el.name ?? '' });
        break;
      case 'image':
        out.push({ ...base, kind: 'image' });
        break;
      case 'freedraw':
        out.push({ ...base, kind: 'freedraw' });
        break;
      default:
        out.push({ ...base, kind: 'other' });
    }
  }
  return { elements: out };
}
