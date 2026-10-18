'use strict';
const locales = Object.freeze(['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR']);
const choices = Object.freeze(['system', ...locales]);
const names = Object.freeze({ 'zh-CN': '简体中文', en: 'English', 'zh-TW': '繁體中文', ja: '日本語', ko: '한국어', es: 'Español', fr: 'Français', de: 'Deutsch', 'pt-BR': 'Português (Brasil)' });
function validLocale(value) { return typeof value === 'string' && locales.includes(value); }
function validPreference(value) { return value === 'system' || validLocale(value); }
function systemLocale(value) {
  let tag;
  try { tag = new Intl.Locale(typeof value === 'string' ? value.trim().replaceAll('_', '-') : 'en'); } catch { return 'en'; }
  if (tag.language === 'zh') return tag.script === 'Hans' ? 'zh-CN' : tag.script === 'Hant' || ['TW', 'HK', 'MO'].includes(tag.region || '') ? 'zh-TW' : 'zh-CN';
  if (tag.language === 'pt') return 'pt-BR';
  return validLocale(tag.language) ? tag.language : 'en';
}
module.exports = { locales, choices, names, validLocale, validPreference, systemLocale };
