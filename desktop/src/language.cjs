'use strict';
const fs = require('node:fs');
const path = require('node:path');
const translations = require('./translations.cjs');
const i18next = require('i18next').createInstance();
const { locales, choices, names, validLocale, validPreference, systemLocale: detectLocale } = require('./language-policy.cjs');
const resources = Object.fromEntries(locales.map(locale => [locale, { translation: ['zh-CN', 'en'].includes(locale) ? Object.fromEntries(Object.entries(translations).map(([key, value]) => [key, value[locale]])) : require(`./locales/${locale}.json`) }]));
i18next.init({ lng: 'zh-CN', fallbackLng: 'en', supportedLngs: locales, load: 'currentOnly', resources, initAsync: false, keySeparator: false, returnEmptyString: false, interpolation: { escapeValue: false } });
let preference = 'system';
let revision = 0;
let systemLocale = 'zh-CN';
function resolveLocale(value, system = systemLocale) {
  if (validLocale(value)) return value;
  return detectLocale(system);
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
function translateNativeError(value) { const key = Object.keys(translations).find(key => key === value || locales.some(locale => resources[locale].translation[key] === value)); return key ? t(key) : value; }
module.exports = { locales, names, resources, translateNativeError, choices, validPreference, resolveLocale, getLocale, snapshot, readPreference, initialize, savePreference, t };
