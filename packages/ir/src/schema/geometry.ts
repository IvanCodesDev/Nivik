import { z } from 'zod';

// Absolute px coordinates, y down, arbitrary origin (renderers own the viewport).
export const PointSchema = z.object({ x: z.number(), y: z.number() });
export const SizeSchema = z.object({ w: z.number().positive(), h: z.number().positive() });
export const RectSchema = PointSchema.extend(SizeSchema.shape);

export type Point = z.infer<typeof PointSchema>;
export type Size = z.infer<typeof SizeSchema>;
export type Rect = z.infer<typeof RectSchema>;

/**
 * Coarse grid placement (spec 01 §3.4, D16). Not pixels: under the `grid` layout strategy the model
 * may say "column 1, row 0, two columns wide" and the layout engine derives position and size.
 * Stored but ignored under ELK-family strategies.
 */
export const CellSchema = z.object({
  col: z.number().int().min(0).max(63),
  row: z.number().int().min(0).max(63),
  colSpan: z.number().int().min(1).max(64).default(1),
  rowSpan: z.number().int().min(1).max(64).default(1),
});
export type Cell = z.infer<typeof CellSchema>;
export type CellInput = z.input<typeof CellSchema>;
