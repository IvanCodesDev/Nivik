import type { LayoutSpec, ThemeSpec } from '@nivik/ir';

export type Spacing = LayoutSpec['spacing'];

/** Spec 03 §5.2 root spacing per `spacing` preset. */
export const ELK_SPACING: Record<
  Spacing,
  { nodeNode: number; betweenLayers: number; edgeNode: number; edgeEdge: number }
> = {
  compact: { nodeNode: 24, betweenLayers: 48, edgeNode: 16, edgeEdge: 12 },
  normal: { nodeNode: 40, betweenLayers: 72, edgeNode: 24, edgeEdge: 16 },
  loose: { nodeNode: 64, betweenLayers: 110, edgeNode: 32, edgeEdge: 24 },
};

/** Spec 03 §7.2 grid constants. */
export const GRID_GUTTER: Record<Spacing, number> = { compact: 16, normal: 24, loose: 40 };
export const MIN_CELL_W = 120;
export const MIN_CELL_H = 56;

/** Room for the group title on top and breathing space around (spec 03 §5.1, §7.2). */
export const GROUP_PAD = { top: 48, side: 24, bottom: 24 } as const;

/** Spec 03 §4.2 size rules. */
export const MIN_NODE_W = 120;
export const MIN_NODE_H = 56;
export const LABEL_WRAP_CHARS = 18;
export const LABEL_MAX_LINES = 3;
export const NODE_PADDING = 16;
/** 1.2 keeps a single `m` line (24 px) plus padding exactly at MIN_NODE_H. */
export const LINE_HEIGHT = 1.2;
export const FONT_PX: Record<ThemeSpec['fontScale'], number> = { s: 16, m: 20, l: 24 };

export const ELK_TIMEOUT_MS = 5000;
