import { diagram, node } from '@nivik/ir/testing';
import { describe, expect, it } from 'vitest';
import {
  createMeasurer,
  DefaultMeasurer,
  estimateTextWidth,
  resolveSizes,
  wrapLabel,
} from './measure';

const theme = { preset: 'nivik-soft', strokeStyle: 'clean', fontScale: 'm' } as const;

describe('estimateTextWidth (spec 03 §4.1)', () => {
  it('counts 0.55 em per Latin glyph and 1 em per CJK glyph', () => {
    expect(estimateTextWidth('abcd', 20)).toBeCloseTo(44);
    expect(estimateTextWidth('订单服务', 20)).toBe(80);
    expect(estimateTextWidth('订单 API', 20)).toBeCloseTo(40 + 4 * 11);
  });
});

describe('wrapLabel (spec 03 §4.2)', () => {
  it('keeps short labels on one line', () => {
    expect(wrapLabel('Order Service')).toEqual(['Order Service']);
  });
  it('wraps at word boundaries after 18 glyphs', () => {
    expect(wrapLabel('Payment Service Gateway Cluster')).toEqual([
      'Payment Service',
      'Gateway Cluster',
    ]);
  });
  it('wraps CJK per glyph', () => {
    expect(wrapLabel('一二三四五六七八九十一二三四五六七八九十')).toEqual([
      '一二三四五六七八九十一二三四五六七八',
      '九十',
    ]);
  });
  it('caps at three lines with an ellipsis', () => {
    const lines = wrapLabel(
      'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi',
    );
    expect(lines).toHaveLength(3);
    expect(lines[2]?.endsWith('…')).toBe(true);
  });
  it('respects explicit newlines', () => {
    expect(wrapLabel('User\nService')).toEqual(['User', 'Service']);
  });
});

describe('DefaultMeasurer size rules (spec 03 §4.2)', () => {
  const m = DefaultMeasurer;
  it('applies the 120×56 minimum to boxes', () => {
    expect(m.measure(node('a', 'API'), theme)).toEqual({ w: 120, h: 56 });
  });
  it('grows with wrapped text', () => {
    // widest line "Payment Service" = 15 glyphs × 0.55 × 20 = 165, plus 2 × 16 padding; 2 lines × 24 + 32
    expect(m.measure(node('a', 'Payment Service Gateway Cluster'), theme)).toEqual({
      w: 197,
      h: 80,
    });
  });
  it('scales ellipses and diamonds', () => {
    expect(m.measure(node('a', 'Start', { type: 'ellipse' }), theme)).toEqual({ w: 144, h: 73 });
    expect(m.measure(node('a', 'Paid?', { type: 'diamond' }), theme)).toEqual({ w: 168, h: 90 });
  });
  it('sizes entities by their widest column', () => {
    const size = m.measure(
      node('u', 'User', {
        type: 'entity',
        data: {
          columns: [
            { name: 'id', type: 'uuid', pk: true },
            { name: 'email', type: 'varchar(320)' },
          ],
        },
      }),
      theme,
    );
    expect(size).toEqual({
      w: Math.ceil(estimateTextWidth('email: varchar(320)', 20) + 32),
      h: 36 + 24 * 2,
    });
  });
  it('uses fixed participant headers, unpadded text and line placeholders', () => {
    expect(
      m.measure(node('p', 'User', { type: 'participant', data: { kind: 'actor' } }), theme),
    ).toEqual({ w: 140, h: 48 });
    expect(m.measure(node('t', 'Both', { type: 'text' }), theme)).toEqual({ w: 44, h: 24 });
    expect(m.measure(node('l', '', { type: 'line' }), theme)).toEqual({ w: 240, h: 24 });
    expect(m.measure(node('l', '', { type: 'line', data: { axis: 'vertical' } }), theme)).toEqual({
      w: 24,
      h: 112,
    });
  });
  it('follows fontScale', () => {
    expect(
      m.measure(node('a', 'Payment Service Gateway Cluster'), { ...theme, fontScale: 's' }).w,
    ).toBe(164);
  });
  it('createMeasurer applies the same rules to renderer text metrics', () => {
    const wide = createMeasurer((text, fontPx) => text.length * fontPx);
    expect(wide.measure(node('a', 'Order Service'), theme).w).toBe(13 * 20 + 32);
  });
});

describe('resolveSizes', () => {
  it('keeps the size of pinned nodes and re-measures the rest', () => {
    const d = diagram({
      nodes: [
        node('a', 'A', { pinned: true, size: { w: 300, h: 80 } }),
        node('b', 'B', { size: { w: 1, h: 1 } }),
      ],
    });
    const sizes = resolveSizes(d, DefaultMeasurer, 'all');
    expect(sizes.get('a')).toEqual({ w: 300, h: 80 });
    expect(sizes.get('b')).toEqual({ w: 120, h: 56 });
  });
  it('re-measures only the requested ids in measure-only mode, plus anything unsized', () => {
    const d = diagram({
      nodes: [
        node('a', 'A', { size: { w: 1, h: 1 } }),
        node('b', 'B', { size: { w: 2, h: 2 } }),
        node('c', 'C'),
      ],
    });
    const sizes = resolveSizes(d, DefaultMeasurer, new Set(['a']));
    expect(sizes.get('a')).toEqual({ w: 120, h: 56 });
    expect(sizes.get('b')).toEqual({ w: 2, h: 2 });
    expect(sizes.get('c')).toEqual({ w: 120, h: 56 });
  });
});
