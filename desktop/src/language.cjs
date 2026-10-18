'use strict';
const fs = require('node:fs');
const path = require('node:path');
const translations = require('./translations.cjs');
const i18next = require('i18next').createInstance();
const resources = Object.fromEntries(['zh-CN', 'en'].map(locale => [locale, { translation: Object.fromEntries(Object.entries(translations).map(([key, value]) => [key, value[locale]])) }]));
i18next.init({ lng: 'zh-CN', fallbackLng: 'en', supportedLngs: ['zh-CN', 'en'], resources, initAsync: false, keySeparator: false, interpolation: { escapeValue: false } });
const choices = Object.freeze(['system', 'zh-CN', 'en']);
let preference = 'system';
let revision = 0;
let systemLocale = 'zh-CN';
function validPreference(value) { return typeof value === 'string' && choices.includes(value); }
function resolveLocale(value, system = systemLocale) {
  if (value === 'zh-CN' || value === 'en') return value;
  return /^zh(?:[-_]|$)/i.test(typeof system === 'string' ? system : '') ? 'zh-CN' : 'en';
}
function getLocale() { return resolveLocale(preference); }
function snapshot() { return { preference, locale: getLocale(), revision }; }
function readPreference(file) {
  try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); return validPreference(data.preference) ? data.preference : 'system'; }
  catch { return 'system'; }
}
function initialize(file, system) { systemLocale = system || 'en'; preference = readPreference(file); revision = 0; return snapshot(); }
function savePreference(file, value) {
  if (!validPreference(value)) throw new TypeError('Invalid language preference');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file + '.tmp', JSON.stringify({ preference: value }) + '\n', { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
  preference = value; revision++;
  return snapshot();
}
function t(key, locale = getLocale()) { return i18next.t(key, { lng: locale }); }
function translateNativeError(value) { const key = Object.keys(translations).find(key => key === value || translations[key]['zh-CN'] === value || translations[key].en === value); return key ? t(key) : value; }
module.exports = { resources, translateNativeError, choices, validPreference, resolveLocale, getLocale, snapshot, readPreference, initialize, savePreference, t };
