import { describe, expect, it } from 'vitest';
import { DICTIONARIES } from './dictionaries';
import { LOCALES } from './locales';

type Leaf = { path: string; value: unknown };

function leaves(value: unknown, path = ''): Leaf[] {
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) =>
      leaves(child, path ? `${path}.${key}` : key),
    );
  }
  return [{ path, value }];
}

describe('DICTIONARIES', () => {
  it('has one dictionary per supported locale', () => {
    expect(Object.keys(DICTIONARIES).sort()).toEqual([...LOCALES].sort());
  });

  it('exposes identical key paths in every locale', () => {
    const [reference, ...others] = LOCALES.map((locale) =>
      leaves(DICTIONARIES[locale]).map((leaf) => leaf.path),
    );
    for (const paths of others) expect(paths).toEqual(reference);
  });

  it('never leaves a string blank or half-translated', () => {
    for (const locale of LOCALES) {
      for (const leaf of leaves(DICTIONARIES[locale])) {
        if (typeof leaf.value === 'function') continue;
        expect(typeof leaf.value, `${locale}:${leaf.path}`).toBe('string');
        expect((leaf.value as string).trim(), `${locale}:${leaf.path}`).not.toBe('');
        expect(leaf.value, `${locale}:${leaf.path}`).not.toMatch(/TODO|TBD/);
      }
    }
  });

  it('formats counted strings in both locales', () => {
    expect(DICTIONARIES.en.canvas.templateLoaded('Login flow')).toContain('Login flow');
    expect(DICTIONARIES['zh-CN'].canvas.templateLoaded('登录流程')).toContain('登录流程');
    expect(DICTIONARIES.en.settings.ai.modelsCount(1)).toBe('1 configured');
    expect(DICTIONARIES.en.settings.ai.modelsCount(3)).toBe('3 configured');
    expect(DICTIONARIES['zh-CN'].settings.ai.modelsCount(3)).toBe('已配置 3 个');
  });
});
