import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALES,
  matchAcceptLanguage,
  parseLanguageSetting,
  resolveLocale,
} from './locales';

describe('LOCALES', () => {
  it('ships English and Simplified Chinese only', () => {
    expect(LOCALES).toEqual(['en', 'zh-CN']);
    expect(DEFAULT_LOCALE).toBe('en');
  });
});

describe('matchAcceptLanguage', () => {
  it('picks the highest-weighted supported language', () => {
    expect(matchAcceptLanguage('zh-CN,zh;q=0.9,en;q=0.8')).toBe('zh-CN');
    expect(matchAcceptLanguage('en;q=0.5,zh-CN;q=0.9')).toBe('zh-CN');
    expect(matchAcceptLanguage('en-US,en;q=0.9')).toBe('en');
  });

  it('maps every Chinese variant to Simplified Chinese', () => {
    expect(matchAcceptLanguage('zh-TW')).toBe('zh-CN');
    expect(matchAcceptLanguage('zh-Hans-CN')).toBe('zh-CN');
    expect(matchAcceptLanguage('ZH')).toBe('zh-CN');
  });

  it('returns null when nothing is supported', () => {
    expect(matchAcceptLanguage('fr-FR,fr;q=0.9')).toBeNull();
    expect(matchAcceptLanguage('')).toBeNull();
    expect(matchAcceptLanguage(null)).toBeNull();
  });
});

describe('parseLanguageSetting', () => {
  it('accepts the three stored values and falls back to auto', () => {
    expect(parseLanguageSetting('en')).toBe('en');
    expect(parseLanguageSetting('zh-CN')).toBe('zh-CN');
    expect(parseLanguageSetting('auto')).toBe('auto');
    expect(parseLanguageSetting('ja')).toBe('auto');
    expect(parseLanguageSetting(undefined)).toBe('auto');
  });
});

describe('resolveLocale', () => {
  it('honours an explicit language regardless of the browser', () => {
    expect(resolveLocale({ setting: 'zh-CN', acceptLanguage: 'en-US' })).toBe('zh-CN');
    expect(resolveLocale({ setting: 'en', acceptLanguage: 'zh-CN' })).toBe('en');
  });

  it('follows the browser when set to auto', () => {
    expect(resolveLocale({ setting: 'auto', acceptLanguage: 'zh-CN,en;q=0.8' })).toBe('zh-CN');
    expect(resolveLocale({ setting: 'auto', acceptLanguage: 'de-DE' })).toBe('en');
    expect(resolveLocale({ setting: 'auto', acceptLanguage: null })).toBe('en');
  });
});
