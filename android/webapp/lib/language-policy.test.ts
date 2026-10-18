import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, LANGUAGE_NAMES, isLocale, isLanguagePreference, resolveLocale } from './language-policy';

test('canonical locale policy accepts only explicit interface preferences', () => {
  assert.equal(LOCALES.length, 9);
  assert.equal(new Set(Object.values(LANGUAGE_NAMES)).size, 9);
  for (const locale of LOCALES) { assert.ok(isLocale(locale)); assert.ok(isLanguagePreference(locale)); }
  assert.equal(isLocale('system'), false); assert.equal(isLanguagePreference('system'), true);
  for (const value of [null, undefined, {}, ['en'], '', 'it', 'pt', 'en-US', 'zh-Hant', 'zh-HK', 'ja\n', 'constructor', '__proto__']) {
    assert.equal(isLocale(value), false); assert.equal(isLanguagePreference(value), false);
  }
});
test('script and region detection preserve Traditional Chinese and supported base languages', () => {
  const cases = { 'zh-Hant': 'zh-TW', 'zh-Hant-CN': 'zh-TW', 'zh-Hant-HK': 'zh-TW', 'zh-TW': 'zh-TW', 'zh-HK': 'zh-TW', 'zh-MO': 'zh-TW', 'zh_HK': 'zh-TW', 'zh-Hans-TW': 'zh-CN', 'zh-SG': 'zh-CN', zh: 'zh-CN', 'en-GB': 'en', 'ja-JP': 'ja', 'ko-KR': 'ko', 'es-MX': 'es', 'fr-CA': 'fr', 'de-AT': 'de', 'pt-PT': 'pt-BR', 'pt-BR': 'pt-BR', pt: 'pt-BR', 'it-IT': 'en', '<script>': 'en' };
  for (const [input, expected] of Object.entries(cases)) assert.equal(resolveLocale([input]), expected, input);
  assert.equal(resolveLocale([]), 'en'); assert.equal(resolveLocale(['', 'ja-JP']), 'ja');
  assert.equal(resolveLocale(['it-IT', 'ja-JP']), 'en'); assert.equal(resolveLocale(['en-GB', 'zh-TW']), 'en');
});
