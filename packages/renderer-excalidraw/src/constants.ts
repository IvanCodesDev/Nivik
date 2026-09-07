import type { ThemeSpec } from '@nivik/ir';

export const RENDERER_ID = 'excalidraw' as const;

/**
 * Same values as `FONT_FAMILY` / `ROUNDNESS` in @excalidraw/excalidraw — the runtime bundle is
 * browser-only, so the pure mapping layer carries its own copies.
 */
export const FONT_FAMILY = { Excalifont: 5, Nunito: 6 } as const;
export type FontFamilyValue = (typeof FONT_FAMILY)[keyof typeof FONT_FAMILY];
export const ROUNDNESS = { ADAPTIVE_RADIUS: 3 } as const;

export const FONT_PX: Record<ThemeSpec['fontScale'], number> = { s: 16, m: 20, l: 24 };

/** CSS font stacks matching Excalidraw's bundled fonts, for canvas measurement (spec 03 §4.1). */
export const FONT_CSS = {
  clean: 'Nunito, sans-serif',
  sketch: 'Excalifont, Virgil, sans-serif',
} as const;
