import type { Diagram, DiagramNode, EntityData, Id, LineData, Size, ThemeSpec } from '@nivik/ir';
import {
  FONT_PX,
  LABEL_MAX_LINES,
  LABEL_WRAP_CHARS,
  LINE_HEIGHT,
  MIN_NODE_H,
  MIN_NODE_W,
  NODE_PADDING,
} from './constants';
import type { NodeMeasurer } from './types';

/** Width of `text` set in `fontPx` pixels; renderers plug in canvas metrics (spec 03 §4.1). */
export type TextWidth = (text: string, fontPx: number) => number;

const WIDE_GLYPH = /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/u;
const isWide = (ch: string) => WIDE_GLYPH.test(ch);
const glyphs = (text: string) => [...text].length;

/** Spec 03 §4.1 DefaultMeasurer estimate: 0.55 em per Latin glyph, 1 em per CJK glyph. */
export const estimateTextWidth: TextWidth = (text, fontPx) => {
  let units = 0;
  for (const ch of text) units += isWide(ch) ? 1 : 0.55;
  // Two decimals are plenty for pixels and keep 0.55 × 20 × n from drifting past a whole number.
  return Math.round(units * fontPx * 100) / 100;
};

/** Words keep their leading space; CJK glyphs are tokens of their own. */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  for (const ch of text) {
    if (isWide(ch)) {
      if (current) tokens.push(current);
      tokens.push(ch);
      current = '';
    } else if (ch === ' ') {
      if (current) tokens.push(current);
      current = ' ';
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Spec 03 §4.2: labels over `maxChars` glyphs wrap at word boundaries (CJK per glyph), at most
 * `maxLines` lines, the last one ellipsised. Display-only — the IR label is never changed.
 */
export function wrapLabel(
  label: string,
  maxChars = LABEL_WRAP_CHARS,
  maxLines = LABEL_MAX_LINES,
): string[] {
  const lines: string[] = [];
  for (const paragraph of label.split('\n')) {
    let line = '';
    for (const token of tokenize(paragraph)) {
      const candidate = line ? `${line}${token}` : token.trimStart();
      if (line === '' || glyphs(candidate) <= maxChars) {
        line = candidate;
      } else {
        lines.push(line.trimEnd());
        line = token.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1] ?? '';
  const trimmed =
    glyphs(last) >= maxChars
      ? [...last]
          .slice(0, maxChars - 1)
          .join('')
          .trimEnd()
      : last;
  kept[maxLines - 1] = `${trimmed}…`;
  return kept;
}

/** Widest wrapped line × line count, padded on every side. */
function textBlock(label: string, fontPx: number, textWidth: TextWidth, padding: number): Size {
  const lines = wrapLabel(label);
  const widest = Math.max(0, ...lines.map((line) => textWidth(line, fontPx)));
  return {
    w: Math.ceil(widest + 2 * padding),
    h: Math.ceil(lines.length * fontPx * LINE_HEIGHT + 2 * padding),
  };
}

const scaled = (size: Size, fw: number, fh: number): Size => ({
  w: Math.ceil(size.w * fw),
  h: Math.ceil(size.h * fh),
});

/** ELK-family placeholder for a free-standing line (spec 03 §4.2); grid fills the range box instead. */
function lineSize(data: LineData | undefined): Size {
  switch (data?.axis) {
    case 'vertical':
      return { w: 24, h: MIN_NODE_H * 2 };
    case 'diagonal-down':
    case 'diagonal-up':
      return { w: MIN_NODE_W * 2, h: MIN_NODE_H * 2 };
    default:
      return { w: MIN_NODE_W * 2, h: 24 };
  }
}

/**
 * Spec 03 §4.2 size rules on top of any text-width function. Renderer measurers reuse this with
 * their real font metrics; `DefaultMeasurer` uses the 0.55 em estimate.
 */
export function createMeasurer(textWidth: TextWidth): NodeMeasurer {
  return {
    measure(node: DiagramNode, theme: ThemeSpec): Size {
      const fontPx = FONT_PX[theme.fontScale];
      const block = textBlock(node.label, fontPx, textWidth, NODE_PADDING);
      const generic = { w: Math.max(MIN_NODE_W, block.w), h: Math.max(MIN_NODE_H, block.h) };
      switch (node.type) {
        case 'ellipse':
          return scaled(generic, 1.2, 1.3);
        case 'diamond':
          return scaled(generic, 1.4, 1.6);
        case 'entity': {
          const columns = (node.data as EntityData | undefined)?.columns ?? [];
          const texts = [
            node.label,
            ...columns.map((c) => (c.type ? `${c.name}: ${c.type}` : c.name)),
          ];
          const widest = Math.max(0, ...texts.map((text) => textWidth(text, fontPx)));
          return { w: Math.max(160, Math.ceil(widest + 32)), h: 36 + 24 * columns.length };
        }
        case 'participant':
          return { w: 140, h: 48 };
        case 'note':
          return { w: Math.min(240, block.w), h: block.h };
        case 'text': {
          const bare = textBlock(node.label, fontPx, textWidth, 0);
          return { w: Math.max(8, bare.w), h: Math.max(Math.ceil(fontPx * LINE_HEIGHT), bare.h) };
        }
        case 'image':
          return { w: 160, h: 120 };
        case 'line':
          return lineSize(node.data as LineData | undefined);
        default:
          return generic;
      }
    },
  };
}

export const DefaultMeasurer: NodeMeasurer = createMeasurer(estimateTextWidth);

/**
 * One size per node for a layout run: pinned nodes keep a user-given size (spec 03 §4.2); in
 * measure-only mode only `remeasure` ids (and nodes without a size) are measured afresh.
 */
export function resolveSizes(
  d: Diagram,
  measurer: NodeMeasurer,
  remeasure: 'all' | ReadonlySet<Id>,
): Map<Id, Size> {
  const out = new Map<Id, Size>();
  for (const n of d.nodes) {
    if (n.pinned && n.size) {
      out.set(n.id, n.size);
      continue;
    }
    const fresh = remeasure === 'all' || remeasure.has(n.id) || !n.size;
    out.set(n.id, !fresh && n.size ? n.size : measurer.measure(n, d.theme));
  }
  return out;
}
