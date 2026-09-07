import { describe, expect, it } from 'vitest';
import { formatInteger, formatRelativePast } from './format';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('formatRelativePast', () => {
  it('speaks English with natural words for the nearest day', () => {
    expect(formatRelativePast(2 * HOUR, 'en')).toBe('2 hours ago');
    expect(formatRelativePast(DAY, 'en')).toBe('yesterday');
    expect(formatRelativePast(3 * DAY, 'en')).toBe('3 days ago');
    expect(formatRelativePast(5 * 60_000, 'en')).toBe('5 minutes ago');
  });

  it('speaks Chinese', () => {
    expect(formatRelativePast(2 * HOUR, 'zh-CN')).toBe('2小时前');
    expect(formatRelativePast(DAY, 'zh-CN')).toBe('昨天');
    expect(formatRelativePast(3 * DAY, 'zh-CN')).toBe('3天前');
  });

  it('returns null for anything under a minute so callers can say "just now"', () => {
    expect(formatRelativePast(0, 'en')).toBeNull();
    expect(formatRelativePast(30_000, 'zh-CN')).toBeNull();
  });
});

describe('formatInteger', () => {
  it('groups digits per locale', () => {
    expect(formatInteger(64_000, 'en')).toBe('64,000');
    expect(formatInteger(64_000, 'zh-CN')).toBe('64,000');
  });
});
