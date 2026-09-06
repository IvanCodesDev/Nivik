import { z } from 'zod';

// Absolute px coordinates, y down, arbitrary origin (renderers own the viewport).
export const PointSchema = z.object({ x: z.number(), y: z.number() });
export const SizeSchema = z.object({ w: z.number().positive(), h: z.number().positive() });
export const RectSchema = PointSchema.extend(SizeSchema.shape);

export type Point = z.infer<typeof PointSchema>;
export type Size = z.infer<typeof SizeSchema>;
export type Rect = z.infer<typeof RectSchema>;
