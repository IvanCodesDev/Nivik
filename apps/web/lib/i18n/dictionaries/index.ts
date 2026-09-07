import type { Locale } from '../locales';
import { type Dictionary, en } from './en';
import { zhCN } from './zh-CN';

export type { Dictionary };

export const DICTIONARIES: Record<Locale, Dictionary> = {
  en,
  'zh-CN': zhCN,
};

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}
