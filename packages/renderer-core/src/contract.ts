import type { Affected, ChangeSet, Diagram, Id, NodeType, Rect, RendererId } from '@nivik/ir';
import type { NodeMeasurer } from '@nivik/layout';

/** Spec 04 §2.3: what an export / import / renderer switch could not carry over. */
export interface FidelityReport {
  lossless: boolean;
  lost: {
    kind: 'node' | 'edge' | 'group' | 'style' | 'geometry' | 'other';
    ids: Id[];
    reason: string;
  }[];
  approximated: { ids: Id[]; from: string; to: string }[];
}

/** Spec 04 §4. */
export interface RendererCapabilities {
  levels: { export: boolean; import: boolean; live: boolean };
  /** File extensions this renderer reads / writes. */
  formats: string[];
  /** Natively supported node types; the rest go through the fallback table. */
  shapes: ReadonlySet<NodeType>;
  groups: 'frame' | 'container' | 'none';
  nestedGroups: boolean;
  edgeRouting: ('orthogonal' | 'straight' | 'polyline')[];
  /** Edges follow a dragged node on their own. */
  liveEdgeRerouting: boolean;
  /** push: selection events are pushed; pull: query on demand. */
  selection: 'push' | 'pull' | 'none';
  highlight: 'overlay' | 'native' | 'none';
  sketchStyle: boolean;
  measure: boolean;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  mime: string;
  fidelity: FidelityReport;
}

export interface ImportResult {
  diagram: Diagram;
  fidelity: FidelityReport;
}

export interface MountOptions {
  theme: 'light' | 'dark';
  readOnly?: boolean;
  locale?: string;
}

/** Scroll offset and zoom; screen = (diagram + {x, y}) × zoom. */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** Spec 04 §4.2: non-fatal degradations the UI shows as toasts. */
export type RendererWarning = {
  code: 'W_RENDERER_DEGRADED' | 'W_FIDELITY_LOSS' | 'W_RESYNC';
  message: string;
  detail?: unknown;
};

export interface LiveHooks {
  /** A reconciled user Change Set (`origin: 'user'`). */
  onChange(cs: ChangeSet): void;
  /** Only when `capabilities.selection === 'push'`. */
  onSelectionChange?(ids: Id[]): void;
  onViewportChange?(v: Viewport): void;
  /** Renderer-private state (annotation layer, …) → `diagram.renderer.state[id]`. */
  onRendererStateChange?(state: unknown): void;
  onWarning?(w: RendererWarning): void;
  onReady?(): void;
  onError?(e: Error): void;
}

export interface RendererPatch {
  /** The full IR after the change set and layout were applied (coordinates included). */
  diagram: Diagram;
  /** From `ApplyResult`, merged with the layout's moved / routed ids. */
  affected: Affected;
  /** History entry name in the renderer, e.g. "AI: add Kafka topic". */
  historyLabel?: string;
}

/** What `LiveSession.highlight` receives (spec 04 §5.4). */
export interface HighlightInput {
  added: Id[];
  modified: Id[];
  deleted: { id: Id; bounds: Rect }[];
}

export interface LiveSession {
  apply(patch: RendererPatch): Promise<void>;
  /** Full re-projection (renderer switch, conflict recovery). */
  replace(d: Diagram): Promise<void>;
  getSelection(): Promise<Id[]>;
  setSelection(ids: Id[]): Promise<void>;
  highlight(h: HighlightInput, opts: { ttlMs: number }): void;
  clearHighlight(): void;
  fit(ids?: Id[], opts?: { animate?: boolean; padding?: number }): Promise<void>;
  exportImage(opts: {
    format: 'png' | 'svg';
    ids?: Id[];
    scale?: number;
    background?: boolean;
  }): Promise<Blob>;
  /** For `@nivik/layout` (spec 03 §4): measures with the renderer's real fonts. */
  measurer: NodeMeasurer;
  /** Lock the canvas while an AI run edits the selection. */
  setReadOnly(v: boolean): void;
  destroy(): void;
}

export interface RendererAdapter {
  readonly id: RendererId;
  readonly capabilities: RendererCapabilities;
  exportDocument(d: Diagram, opts?: { ids?: Id[] }): Promise<ExportResult>;
  importDocument(input: Blob | string, opts?: { name?: string }): Promise<ImportResult>;
  mount?(
    host: HTMLElement,
    d: Diagram,
    hooks: LiveHooks,
    opts?: MountOptions,
  ): Promise<LiveSession>;
}
