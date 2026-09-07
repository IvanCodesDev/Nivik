/** Interface languages the app ships dictionaries for. */
export const LOCALES = ['en', 'zh-CN'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** What the user can pick in Settings: a fixed locale, or follow the browser. */
export const LANGUAGE_SETTINGS = ['auto', ...LOCALES] as const;
export type LanguageSetting = (typeof LANGUAGE_SETTINGS)[number];

/**
 * Cookie mirroring the saved language setting so the server can render the first paint in the
 * right language instead of flashing English until the store rehydrates.
 */
export const LANGUAGE_COOKIE = 'nivik.lang';

export function isLocale(value: unknown): value is Locale {
  return (LOCALES as readonly unknown[]).includes(value);
}

export function parseLanguageSetting(value: unknown): LanguageSetting {
  return (LANGUAGE_SETTINGS as readonly unknown[]).includes(value)
    ? (value as LanguageSetting)
    : 'auto';
}

/** Maps one BCP 47 tag to a supported locale; every Chinese variant lands on Simplified Chinese. */
export function localeForTag(tag: string): Locale | null {
  const primary = tag.trim().toLowerCase().split('-')[0];
  if (primary === 'zh') return 'zh-CN';
  if (primary === 'en') return 'en';
  return null;
}

/** Picks the best supported locale from an `Accept-Language` header, honouring q-weights. */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith('q='))
        ?.slice(2);
      const weight = q === undefined ? 1 : Number(q);
      return { tag, weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.tag && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const entry of ranked) {
    const locale = localeForTag(entry.tag);
    if (locale) return locale;
  }
  return null;
}

/** Same as {@link matchAcceptLanguage} for `navigator.languages`, which is already ordered. */
export function matchLanguages(languages: readonly string[]): Locale | null {
  for (const tag of languages) {
    const locale = localeForTag(tag);
    if (locale) return locale;
  }
  return null;
}

export interface ResolveLocaleInput {
  setting: LanguageSetting;
  acceptLanguage: string | null | undefined;
}

/** An explicit setting wins; `auto` follows the browser and falls back to English. */
export function resolveLocale({ setting, acceptLanguage }: ResolveLocaleInput): Locale {
  if (setting !== 'auto') return setting;
  return matchAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
