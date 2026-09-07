import type { Id, NodeType, Rect, StyleOverride } from '@nivik/ir';
import type { NativePart, NivikTag } from './id-map';

/** What an adapter's `fromNative` reduces every native element to (spec 04 §5.2 step 2). */
export type NativeKind =
  | 'shape'
  | 'text'
  | 'arrow'
  | 'line'
  | 'frame'
  | 'image'
  | 'freedraw'
  | 'other';

export interface NativeElement {
  nativeId: string;
  kind: NativeKind;
  /** `customData.nivik`; null for elements the user drew directly. */
  nivik: NivikTag | null;
  deleted: boolean;
  /** Absolute bounding box in diagram coordinates. */
  bounds: Rect;
  /** For shapes: the IR node type this native shape maps to. */
  shape?: NodeType;
  /** Bound or own text (`originalText`). */
  label?: string;
  /** Arrow endpoints, as native ids; an undefined end is unbound. */
  binding?: { start?: string; end?: string };
  /** Native id of the frame / container holding this element; null = top level; undefined = unknown. */
  frame?: string | null;
  /** Colours the user changed away from the token mapping; null = none; undefined = not reported. */
  override?: StyleOverride | null;
  locked?: boolean;
}

export interface NativeSnapshot {
  elements: NativeElement[];
}

export interface IrEntry {
  main?: NativeElement;
  parts: Map<NativePart, NativeElement>;
}

export interface SnapshotIndex {
  byIr: Map<Id, IrEntry>;
  byNative: Map<string, NativeElement>;
  /** Elements without a nivik tag: candidates for promotion or annotations (spec 04 §5.3). */
  untagged: NativeElement[];
}

export function indexSnapshot(snapshot: NativeSnapshot): SnapshotIndex {
  const byIr = new Map<Id, IrEntry>();
  const byNative = new Map<string, NativeElement>();
  const untagged: NativeElement[] = [];
  for (const el of snapshot.elements) {
    byNative.set(el.nativeId, el);
    if (!el.nivik) {
      untagged.push(el);
      continue;
    }
    const entry = byIr.get(el.nivik.id) ?? { parts: new Map<NativePart, NativeElement>() };
    if (el.nivik.part === 'main') entry.main = el;
    else entry.parts.set(el.nivik.part, el);
    byIr.set(el.nivik.id, entry);
  }
  return { byIr, byNative, untagged };
}
