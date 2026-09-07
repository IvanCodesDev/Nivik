'use client';

import { useEffect } from 'react';
import { useSettingsStore } from '@/lib/stores/settings-store';
import { THEME_COOKIE } from '@/lib/theme/themes';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Mirrors the saved theme onto `<html data-theme>` (which switches `color-scheme`, and with it
 * every `light-dark()` token) and into the `nivik.theme` cookie so the next server render starts
 * in the same scheme. Waits for rehydration: until then the server-rendered attribute is right.
 */
export function ThemeApplier() {
  const hydrated = useSettingsStore((s) => s.hydrated);
  const theme = useSettingsStore((s) => s.saved.theme);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.dataset.theme = theme;
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is still missing in some supported browsers.
    document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  }, [hydrated, theme]);

  return null;
}
