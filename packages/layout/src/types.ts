import type { Diagram, DiagramNode, Id, LayoutSpec, Size, ThemeSpec } from '@nivik/ir';
import type { ElkLayoutArguments, ElkNode } from 'elkjs/lib/elk-api';

/** Spec 03 §2. */
export type LayoutMode =
  | { kind: 'full' }
  | { kind: 'incremental'; affected: Id[]; hints: Record<Id, Id> }
  | { kind: 'measure-only'; ids: Id[] };

export interface NodeMeasurer {
  measure(node: DiagramNode, theme: ThemeSpec): { w: number; h: number };
}

/** The slice of elkjs's `ELK` the package needs; apps inject a Worker-backed one (spec 03 §5.4). */
export interface ElkEngine {
  layout(graph: ElkNode, args?: ElkLayoutArguments): Promise<ElkNode>;
  terminate?(): void;
}

export interface LayoutOptions {
  mode: LayoutMode;
  measurer: NodeMeasurer;
  spec?: Partial<LayoutSpec>;
  signal?: AbortSignal;
  /** Defaults to the in-thread bundled engine (`createBundledEngine`). */
  engine?: ElkEngine;
  /** ELK wall-clock budget before the BFS fallback (spec 03 §5.4); defaults to `ELK_TIMEOUT_MS`. */
  timeoutMs?: number;
}

export type LayoutWarningCode = 'W_LAYOUT_FALLBACK' | 'W_UNPLACED' | 'W_PIN_OVERLAP';

export interface LayoutWarning {
  code: LayoutWarningCode;
  ids: Id[];
  message: string;
}

export interface LayoutResult {
  diagram: Diagram;
  moved: Id[];
  routed: Id[];
  durationMs: number;
  warnings: LayoutWarning[];
}

/** Measured (or pinned) size per node, computed once per run and shared by every strategy. */
export type SizeMap = ReadonlyMap<Id, Size>;
