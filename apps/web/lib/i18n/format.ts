import type { Locale } from './locales';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "2 hours ago" / "yesterday" / "3天前" for something that happened `elapsedMs` ago. Returns null
 * under one minute so the caller can substitute its own "just now" wording.
 */
export function formatRelativePast(elapsedMs: number, locale: Locale): string | null {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (elapsedMs < MINUTE) return null;
  if (elapsedMs < HOUR) return rtf.format(-Math.round(elapsedMs / MINUTE), 'minute');
  if (elapsedMs < DAY) return rtf.format(-Math.round(elapsedMs / HOUR), 'hour');
  return rtf.format(-Math.round(elapsedMs / DAY), 'day');
}

export function formatInteger(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}
