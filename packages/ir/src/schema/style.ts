import { z } from 'zod';

export const PaletteSchema = z.enum([
  'neutral',
  'lavender',
  'mint',
  'sky',
  'coral',
  'sand',
  'rose',
  'sage',
]);
export type Palette = z.infer<typeof PaletteSchema>;

export const HexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, 'Expected #rrggbb');
export const EmphasisSchema = z.enum(['muted', 'default', 'strong']);
export const StrokeStyleSchema = z.enum(['solid', 'dashed', 'dotted']);
export const FillStyleSchema = z.enum(['solid', 'translucent', 'none']);
export type FillStyle = z.infer<typeof FillStyleSchema>;
export const IconNameSchema = z.string().max(48);

export const StyleOverrideSchema = z
  .object({
    fill: HexColorSchema.optional(),
    stroke: HexColorSchema.optional(),
    text: HexColorSchema.optional(),
  })
  .strict();
export type StyleOverride = z.infer<typeof StyleOverrideSchema>;

/** Semantic style tokens. Concrete colours live in the theme / renderer, never in the IR (except `override`). */
export const StyleTokensSchema = z
  .object({
    palette: PaletteSchema.optional(),
    emphasis: EmphasisSchema.optional(),
    stroke: StrokeStyleSchema.optional(),
    fill: FillStyleSchema.optional(),
    icon: IconNameSchema.optional(),
    override: StyleOverrideSchema.optional(),
  })
  .strict();
export type StyleTokens = z.infer<typeof StyleTokensSchema>;
