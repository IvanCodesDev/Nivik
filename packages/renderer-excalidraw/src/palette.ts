import type { Palette, StyleTokens, ThemeSpec } from '@nivik/ir';
import { PALETTES } from '@nivik/ui/palettes';
import { FONT_FAMILY, type FontFamilyValue } from './constants';

export interface ExcalidrawStyle {
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  opacity: number;
  roughness: number;
  fontFamily: FontFamilyValue;
  fillStyle: 'solid';
}

const channel = (hex: string, i: number) => Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);

/** Per-channel midpoint of two #rrggbb colours. */
export const mixHex = (a: string, b: string): string =>
  `#${[0, 1, 2]
    .map((i) =>
      Math.round((channel(a, i) + channel(b, i)) / 2)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

const paletteOf = (theme: ThemeSpec, style: StyleTokens | undefined): Palette =>
  theme.preset === 'mono' ? 'neutral' : (style?.palette ?? 'neutral');

/** Spec 04 §6.2: semantic tokens → Excalidraw element style (light values; dark mode is Excalidraw's filter). */
export function colorsFor(theme: ThemeSpec, style: StyleTokens | undefined): ExcalidrawStyle {
  const colors = PALETTES[paletteOf(theme, style)];
  const emphasis = style?.emphasis ?? 'default';
  let strokeColor = colors.stroke;
  if (emphasis === 'muted') strokeColor = mixHex(colors.fill, colors.stroke);
  if (emphasis === 'strong' || theme.preset === 'nivik-contrast') strokeColor = colors.text;
  const sketch = theme.strokeStyle === 'sketch';
  return {
    strokeColor: style?.override?.stroke ?? strokeColor,
    backgroundColor:
      style?.override?.fill ?? (style?.fill === 'none' ? 'transparent' : colors.fill),
    strokeWidth: emphasis === 'strong' ? 2 : 1,
    strokeStyle: style?.stroke ?? 'solid',
    opacity: style?.fill === 'translucent' ? 50 : 100,
    roughness: sketch ? 1 : 0,
    fontFamily: sketch ? FONT_FAMILY.Excalifont : FONT_FAMILY.Nunito,
    fillStyle: 'solid',
  };
}

export const textColorFor = (theme: ThemeSpec, style: StyleTokens | undefined): string =>
  style?.override?.text ?? PALETTES[paletteOf(theme, style)].text;
