/**
 * UI colour scheme. `system` follows the OS through `color-scheme: light dark`; tokens.css writes
 * every colour with `light-dark()`, so the theme needs no JavaScript beyond setting `data-theme`.
 */
export const THEMES = ['light', 'system', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'light';

/** Mirrors the saved theme so the server renders the first paint in the right scheme. */
export const THEME_COOKIE = 'nivik.theme';

export function parseTheme(value: unknown): Theme {
  return (THEMES as readonly unknown[]).includes(value) ? (value as Theme) : DEFAULT_THEME;
}

/** Page background per scheme; keep in sync with `--nv-page` in tokens.css. */
const PAGE_COLOR = { light: '#faf9fb', dark: '#131317' } as const;

/** `themeColor` metadata for the browser chrome (Next.js `Viewport.themeColor`). */
export function themeColorFor(theme: Theme): { media?: string; color: string }[] {
  switch (theme) {
    case 'light':
      return [{ color: PAGE_COLOR.light }];
    case 'dark':
      return [{ color: PAGE_COLOR.dark }];
    case 'system':
      return [
        { media: '(prefers-color-scheme: light)', color: PAGE_COLOR.light },
        { media: '(prefers-color-scheme: dark)', color: PAGE_COLOR.dark },
      ];
  }
}
