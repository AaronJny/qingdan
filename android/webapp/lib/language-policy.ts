/** UI locale identifiers are a closed enum; never use them to rewrite record data. */
export const LOCALES = ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR'] as const;
export type Locale = typeof LOCALES[number];
export type LanguagePreference = 'system' | Locale;
export const LANGUAGE_NAMES: Readonly<Record<Locale, string>> = Object.freeze({
  'zh-CN': '简体中文', en: 'English', 'zh-TW': '繁體中文', ja: '日本語', ko: '한국어',
  es: 'Español', fr: 'Français', de: 'Deutsch', 'pt-BR': 'Português (Brasil)',
});
export function isLocale(value: unknown): value is Locale { return typeof value === 'string' && (LOCALES as readonly string[]).includes(value); }
export function isLanguagePreference(value: unknown): value is LanguagePreference { return value === 'system' || isLocale(value); }
export function resolveLocale(languages: readonly string[]): Locale {
  // Honor the first system preference. Unsupported languages fall back to English.
  const first = languages.find(value => typeof value === 'string' && value.trim()) || 'en';
  let tag: Intl.Locale;
  try { tag = new Intl.Locale(first.trim().replaceAll('_', '-')); } catch { return 'en'; }
  if (tag.language === 'zh') {
    // Explicit scripts win; otherwise Traditional-Chinese regions stay Traditional.
    return tag.script === 'Hans' ? 'zh-CN' : tag.script === 'Hant' || ['TW', 'HK', 'MO'].includes(tag.region || '') ? 'zh-TW' : 'zh-CN';
  }
  if (tag.language === 'pt') return 'pt-BR';
  return isLocale(tag.language) ? tag.language : 'en';
}
