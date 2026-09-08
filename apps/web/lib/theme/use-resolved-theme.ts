'use client';

import { useEffect, useState } from 'react';
import type { Theme } from '@/lib/theme/themes';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Renderers take a concrete theme; `system` follows the OS and updates live. */
export function useResolvedTheme(theme: Theme): 'light' | 'dark' {
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia(DARK_QUERY);
    setSystemDark(media.matches);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  if (theme === 'system') return systemDark ? 'dark' : 'light';
  return theme;
}
