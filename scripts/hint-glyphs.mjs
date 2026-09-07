#!/usr/bin/env node
/**
 * Traces the empty-canvas hint copy (`canvas.hintTitle` / `canvas.hintBody` in every dictionary)
 * into SVG outlines → apps/web/features/canvas/hint-glyphs.json, which <SketchHint/> animates.
 *
 *   pnpm hint:glyphs
 *
 * Latin comes from Excalifont and everything it lacks (CJK, full-width punctuation, arrows) from
 * Xiaolai — the hand-drawn pair Excalidraw itself renders with; both are SIL OFL 1.1. The fonts
 * are downloaded once into node_modules/.cache/nivik-fonts and verified against pinned SHA-256
 * digests. GitHub release downloads can crawl from some networks: set NIVIK_GITHUB_PROXY (for
 * example `https://gh-proxy.com/`) to try a mirror first; the built-in fallback is tried anyway.
 *
 * Re-run whenever the hint copy changes — `hint-glyphs.test.ts` fails until you do.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import { createJiti } from 'jiti';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'node_modules/.cache/nivik-fonts');
const OUTPUT = path.join(ROOT, 'apps/web/features/canvas/hint-glyphs.json');
const DICTIONARIES_MODULE = path.join(ROOT, 'apps/web/lib/i18n/dictionaries/index.ts');
const UNITS_PER_EM = 1000;
const GITHUB_FALLBACK_PROXY = 'https://gh-proxy.com/';

/** In preference order: a code point is traced with the first font that has a glyph for it. */
const FONTS = {
  e: {
    name: 'Excalifont',
    license: 'OFL-1.1',
    source: 'https://plus.excalidraw.com/excalifont',
    file: 'Excalifont-Regular.woff2',
    url: 'https://excalidraw.nyc3.cdn.digitaloceanspaces.com/fonts/Excalifont-Regular.woff2',
    sha256: 'ee41ec4c06bfa0728665499de6f4b4019e7953119ab20b5aeb5917f1609c3b2a',
  },
  x: {
    name: 'Xiaolai',
    license: 'OFL-1.1',
    source: 'https://github.com/lxgw/kose-font',
    file: 'Xiaolai-Regular.ttf',
    url: 'https://github.com/lxgw/kose-font/releases/download/v3.126/Xiaolai-Regular.ttf',
    sha256: 'e2f68daf0e72777a8cf58bc83de1b98634b251e537ddbfca24b0ae50d1802da2',
  },
};

const SVG_COMMANDS = {
  moveTo: 'M',
  lineTo: 'L',
  quadraticCurveTo: 'Q',
  bezierCurveTo: 'C',
  closePath: 'Z',
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function candidateUrls(url) {
  if (!url.startsWith('https://github.com/')) return [url];
  const proxy = process.env.NIVIK_GITHUB_PROXY;
  return [...(proxy ? [proxy + url] : []), url, GITHUB_FALLBACK_PROXY + url];
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function fontBytes(spec) {
  const target = path.join(CACHE, spec.file);
  if (existsSync(target)) {
    const cached = await readFile(target);
    if (sha256(cached) === spec.sha256) return cached;
    console.warn(`  ${spec.file}: cached copy does not match the pinned digest, downloading again`);
  }
  const failures = [];
  for (const url of candidateUrls(spec.url)) {
    try {
      console.log(`  ${spec.file}: downloading ${url}`);
      const bytes = await download(url);
      const digest = sha256(bytes);
      if (digest !== spec.sha256) {
        throw new Error(`SHA-256 ${digest} does not match the pinned ${spec.sha256}`);
      }
      await mkdir(CACHE, { recursive: true });
      await writeFile(target, bytes);
      return bytes;
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Could not fetch ${spec.name}:\n  ${failures.join('\n  ')}`);
}

const formatNumber = (value) => String(Math.round(value));

/** One SVG path string per contour, y flipped to SVG's downward axis, in 1000-unit em space. */
function contoursOf(glyph, scale) {
  const contours = [];
  let current = null;
  const finish = () => {
    if (current?.drawn) contours.push(`${current.d}Z`);
    current = null;
  };
  for (const { command, args } of glyph.path.commands) {
    if (command === 'moveTo') finish();
    if (command === 'closePath') {
      finish();
      continue;
    }
    const points = args.map((value, index) =>
      formatNumber(index % 2 === 0 ? value * scale : -value * scale),
    );
    if (command === 'moveTo') {
      current = { d: `M${points.join(' ')}`, drawn: false };
      continue;
    }
    if (!current) continue;
    current.d += `${SVG_COMMANDS[command]}${points.join(' ')}`;
    current.drawn = true;
  }
  finish();
  return contours;
}

/** Splits text into maximal runs that share a font so each run can be shaped as a whole. */
function segment(text, fonts) {
  const runs = [];
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    const key = Object.keys(fonts).find((k) => fonts[k].hasGlyphForCodePoint(codePoint));
    if (!key) throw new Error(`No font has a glyph for "${char}" (U+${codePoint.toString(16)})`);
    const last = runs.at(-1);
    if (last && last.font === key) last.text += char;
    else runs.push({ font: key, text: char });
  }
  return runs;
}

function traceLine(text, fonts, glyphTable) {
  const glyphs = [];
  let x = 0;
  for (const run of segment(text, fonts)) {
    const font = fonts[run.font];
    const scale = UNITS_PER_EM / font.unitsPerEm;
    const layout = font.layout(run.text);
    layout.glyphs.forEach((glyph, index) => {
      const position = layout.positions[index];
      const contours = contoursOf(glyph, scale);
      if (contours.length > 0) {
        const key = `${run.font}${glyph.id}`;
        glyphTable.set(key, contours);
        glyphs.push({ g: key, x: Math.round(x + position.xOffset * scale) });
      }
      x += position.xAdvance * scale;
    });
  }
  return { width: Math.round(x), glyphs };
}

async function main() {
  console.log('Fonts');
  const fonts = {};
  const credits = {};
  for (const [key, spec] of Object.entries(FONTS)) {
    const font = fontkit.create(Buffer.from(await fontBytes(spec)));
    fonts[key] = font;
    credits[key] = {
      name: spec.name,
      version: String(font.version).split(';')[0].trim(),
      license: spec.license,
      source: spec.source,
    };
    console.log(`  ${spec.name} ${credits[key].version}: ${font.numGlyphs} glyphs`);
  }

  const jiti = createJiti(import.meta.url);
  const { DICTIONARIES } = await jiti.import(DICTIONARIES_MODULE);

  console.log('Lines');
  const glyphTable = new Map();
  const lines = {};
  for (const [locale, dictionary] of Object.entries(DICTIONARIES)) {
    for (const text of [dictionary.canvas.hintTitle, dictionary.canvas.hintBody]) {
      lines[text] = traceLine(text, fonts, glyphTable);
      console.log(`  ${locale}: "${text}" → ${lines[text].glyphs.length} glyphs`);
    }
  }

  const scale = UNITS_PER_EM;
  const data = {
    $comment:
      'Generated by scripts/hint-glyphs.mjs (pnpm hint:glyphs) — do not edit. Outlines of the canvas hint copy traced from the fonts listed below.',
    unitsPerEm: UNITS_PER_EM,
    ascent: Math.round(
      Math.max(...Object.values(fonts).map((f) => (f.ascent / f.unitsPerEm) * scale)),
    ),
    descent: Math.round(
      Math.min(...Object.values(fonts).map((f) => (f.descent / f.unitsPerEm) * scale)),
    ),
    fonts: credits,
    glyphs: Object.fromEntries([...glyphTable.entries()].sort(([a], [b]) => a.localeCompare(b))),
    lines,
  };
  await writeFile(OUTPUT, `${JSON.stringify(data, null, 1)}\n`);
  const size = Buffer.byteLength(JSON.stringify(data));
  console.log(
    `\nWrote ${path.relative(ROOT, OUTPUT)}: ${glyphTable.size} glyphs, ${(size / 1024).toFixed(1)} KB`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
