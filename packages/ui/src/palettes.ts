/**
 * Semantic palettes — the TypeScript mirror of the `--nv-pal-*` variables in tokens.css.
 * Renderer adapters map IR `StyleTokens.palette` to these hex values so that the UI and
 * the canvas share one color system (spec 07 §5.1).
 */
export const PALETTE_NAMES = [
  'lavender',
  'mint',
  'sky',
  'coral',
  'sand',
  'rose',
  'sage',
  'neutral',
] as const;

export type PaletteName = (typeof PALETTE_NAMES)[number];

export interface PaletteColors {
  fill: string;
  stroke: string;
  text: string;
}

export const PALETTES: Record<PaletteName, PaletteColors> = {
  lavender: { fill: '#ede7f7', stroke: '#b59add', text: '#3b2f5c' },
  mint: { fill: '#eff9f5', stroke: '#91b9a9', text: '#2f4f44' },
  sky: { fill: '#eef4fb', stroke: '#9cbbd9', text: '#2f4360' },
  coral: { fill: '#fdf0ec', stroke: '#dcae9e', text: '#5c3a30' },
  sand: { fill: '#fff9ed', stroke: '#d9c39a', text: '#5a4a2a' },
  rose: { fill: '#fbeef3', stroke: '#d7a3b6', text: '#5a3344' },
  sage: { fill: '#eef5f0', stroke: '#9fb8a6', text: '#34493b' },
  neutral: { fill: '#f4f4f7', stroke: '#cfd1d9', text: '#3a3d48' },
};

export function paletteVar(name: PaletteName, part: keyof PaletteColors): string {
  return `var(--nv-pal-${name}-${part})`;
}

/**
 * Folder tints used by `FolderCard` (Diagram Library). Each tint drives the folder body
 * gradient (top → mid → bottom) and the tab color. Names follow the prototype swatches.
 */
export const FOLDER_TINTS = [
  'yellow',
  'lavender',
  'mint',
  'coral',
  'blue',
  'cyan',
  'cream-yellow',
  'apricot',
  'peach',
  'sakura',
  'sage',
  'apple',
  'sea-salt',
  'glacier',
  'sky',
  'gray-lavender',
  'milk-tea',
  'fog-green',
] as const;

export type FolderTint = (typeof FOLDER_TINTS)[number];

export interface FolderTintColors {
  top: string;
  mid: string;
  bottom: string;
  tab: string;
}

export const FOLDER_TINT_COLORS: Record<FolderTint, FolderTintColors> = {
  yellow: { top: '#f5ecdd', mid: '#f6eee2', bottom: '#faf8f6', tab: '#fbe6c0' },
  lavender: { top: '#ece2f3', mid: '#efe8f5', bottom: '#f8f6f9', tab: '#e8daf7' },
  mint: { top: '#dbf0ee', mid: '#ddf1ef', bottom: '#f8fafa', tab: '#c1ede7' },
  coral: { top: '#fce6df', mid: '#fcebe7', bottom: '#fcf7f5', tab: '#fad6df' },
  blue: { top: '#dfeaf9', mid: '#eaf0fa', bottom: '#f7f8fb', tab: '#d9e5fc' },
  cyan: { top: '#e0f2f3', mid: '#e8f4f4', bottom: '#f8fafa', tab: '#d0f1f3' },
  'cream-yellow': { top: '#f7f0d6', mid: '#f8f3e2', bottom: '#fbfaf5', tab: '#f8e8a9' },
  apricot: { top: '#f8e2d1', mid: '#faeadf', bottom: '#fcf8f5', tab: '#f7cfaf' },
  peach: { top: '#f7e0e4', mid: '#f9e9eb', bottom: '#fcf7f8', tab: '#f5cad2' },
  sakura: { top: '#f3e1ea', mid: '#f7ebf0', bottom: '#fbf7f9', tab: '#edcbdc' },
  sage: { top: '#e2ebdd', mid: '#ebf1e8', bottom: '#f8faf7', tab: '#caddbf' },
  apple: { top: '#e7f0d8', mid: '#eef4e5', bottom: '#f9fbf6', tab: '#d2e6b3' },
  'sea-salt': { top: '#dceff0', mid: '#e8f5f5', bottom: '#f8fbfb', tab: '#bee3e6' },
  glacier: { top: '#ddeef5', mid: '#e8f3f7', bottom: '#f8fafb', tab: '#c4e1ed' },
  sky: { top: '#e0eaf6', mid: '#e9f0f8', bottom: '#f8f9fb', tab: '#c9dcf2' },
  'gray-lavender': { top: '#e9e5ef', mid: '#f0ecf4', bottom: '#f9f8fa', tab: '#ddd5e9' },
  'milk-tea': { top: '#efe5da', mid: '#f4ede5', bottom: '#faf8f5', tab: '#e1cdb8' },
  'fog-green': { top: '#e1ece7', mid: '#ebf2ef', bottom: '#f8faf9', tab: '#c7ddd3' },
};
