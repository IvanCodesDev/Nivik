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

const HexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, 'Expected #rrggbb');

/** Semantic style tokens. Concrete colours live in the theme / renderer, never in the IR (except `override`). */
export const StyleTokensSchema = z
  .object({
    palette: PaletteSchema.optional(),
    emphasis: z.enum(['muted', 'default', 'strong']).optional(),
    stroke: z.enum(['solid', 'dashed', 'dotted']).optional(),
    icon: z.string().max(48).optional(),
    override: z
      .object({
        fill: HexColorSchema.optional(),
        stroke: HexColorSchema.optional(),
        text: HexColorSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type StyleTokens = z.infer<typeof StyleTokensSchema>;
