import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Spec 07 §5.1: every colour in apps/web and packages/ui must come from tokens.css so a theme is
 * a single file. With `light-dark()` in tokens.css, any raw colour elsewhere would be the one spot
 * that ignores the theme — this test keeps that set empty.
 */
const ROOT = join(import.meta.dirname, '../../../..');
const SCAN_DIRS = ['apps/web/app', 'apps/web/components', 'apps/web/features', 'packages/ui/src'];
const TOKENS = join(ROOT, 'packages/ui/src/tokens.css');

const RAW_COLOR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;

/** The paper and what is drawn on it stay light in every theme (see the comment in tokens.css). */
const PAPER_TOKEN = /^\s*--nv-(canvas|node|edge|selection)[-:]/;

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === 'node_modules' || entry.startsWith('.')) return [];
    if (statSync(path).isDirectory()) return cssFiles(path);
    return entry.endsWith('.css') ? [path] : [];
  });
}

describe('design tokens', () => {
  const tokens = readFileSync(TOKENS, 'utf8');

  it('declare every colour token for both colour schemes, except the paper', () => {
    const declarations = tokens.match(/^\s*--nv-[a-z0-9-]+:\s*[^;]+;/gm) ?? [];
    const colourTokens = declarations.filter((line) => RAW_COLOR.test(line));
    expect(colourTokens.length).toBeGreaterThan(40);
    const singleScheme = colourTokens.filter(
      (line) => !line.includes('light-dark(') && !PAPER_TOKEN.test(line),
    );
    expect(singleScheme).toEqual([]);
    const themedPaper = colourTokens.filter(
      (line) => PAPER_TOKEN.test(line) && line.includes('light-dark('),
    );
    expect(themedPaper).toEqual([]);
  });

  it('are the only place with raw colours', () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of cssFiles(join(ROOT, dir))) {
        if (file === TOKENS) continue;
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => {
          if (RAW_COLOR.test(line)) {
            offenders.push(`${relative(ROOT, file)}:${index + 1}  ${line.trim()}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
