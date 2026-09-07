import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, parseTheme, THEME_COOKIE, THEMES, themeColorFor } from './themes';

describe('theme settings', () => {
  it('lists the three choices with light as the default', () => {
    expect(THEMES).toEqual(['light', 'system', 'dark']);
    expect(DEFAULT_THEME).toBe('light');
    expect(THEME_COOKIE).toBe('nivik.theme');
  });

  it('parses cookie values defensively', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('system')).toBe('system');
    expect(parseTheme('sepia')).toBe('light');
    expect(parseTheme(undefined)).toBe('light');
    expect(parseTheme(42)).toBe('light');
  });

  it('gives the browser chrome a matching colour, letting the OS decide for system', () => {
    expect(themeColorFor('light')).toEqual([{ color: '#faf9fb' }]);
    expect(themeColorFor('dark')).toEqual([{ color: '#131317' }]);
    expect(themeColorFor('system')).toEqual([
      { media: '(prefers-color-scheme: light)', color: '#faf9fb' },
      { media: '(prefers-color-scheme: dark)', color: '#131317' },
    ]);
  });
});
