'use client';

import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';
import { useSettingsStore } from '@/lib/stores/settings-store';
import { type Dictionary, getDictionary } from './dictionaries';
import { LANGUAGE_COOKIE, type Locale, matchLanguages } from './locales';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const LocaleContext = createContext<Locale | null>(null);

interface I18nProviderProps {
  /** Locale the server rendered with; used verbatim until the settings store has rehydrated. */
  initialLocale: Locale;
  children: ReactNode;
}

/**
 * Resolves the interface language from the saved settings and keeps the `nivik.lang` cookie and
 * `<html lang>` in sync so the next server render starts in the same language.
 */
export function I18nProvider({ initialLocale, children }: I18nProviderProps) {
  const hydrated = useSettingsStore((s) => s.hydrated);
  const language = useSettingsStore((s) => s.saved.language);

  const locale = useMemo<Locale>(() => {
    if (!hydrated) return initialLocale;
    if (language !== 'auto') return language;
    return matchLanguages(navigator.languages) ?? initialLocale;
  }, [hydrated, language, initialLocale]);

  useEffect(() => {
    if (!hydrated) return;
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is still missing in some supported browsers.
    document.cookie = `${LANGUAGE_COOKIE}=${encodeURIComponent(language)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  }, [hydrated, language]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  const locale = useContext(LocaleContext);
  if (locale === null) throw new Error('useLocale must be used inside <I18nProvider>.');
  return locale;
}

/** The active dictionary; call as `const t = useT()` and read `t.settings.title`. */
export function useT(): Dictionary {
  return getDictionary(useLocale());
}
