import { cookies, headers } from 'next/headers';
import { type Dictionary, getDictionary } from './dictionaries';
import { LANGUAGE_COOKIE, type Locale, parseLanguageSetting, resolveLocale } from './locales';

/**
 * Locale for the current request: the saved setting mirrored in the `nivik.lang` cookie, or the
 * browser's `Accept-Language` when the setting is `auto`. Reading request data here makes every
 * route dynamic, which is the price of rendering the first paint in the right language.
 */
export async function getRequestLocale(): Promise<Locale> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return resolveLocale({
    setting: parseLanguageSetting(cookieStore.get(LANGUAGE_COOKIE)?.value),
    acceptLanguage: headerList.get('accept-language'),
  });
}

export async function getRequestDictionary(): Promise<Dictionary> {
  return getDictionary(await getRequestLocale());
}
