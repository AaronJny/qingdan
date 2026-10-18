import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { formatDate, formatNumber, getLanguagePreference, getLocale, isLanguagePreference, LANGUAGE_STORAGE_KEY, languageStorageAvailable, messages, plural, resolveLocale, setLanguagePreference, setNativeLanguage, t, translation, translateError } from './i18n';
import { displayRecordTitle } from './i18n-records';

test('bundled i18next resources have matching keys and interpolation parameters', () => {
  const keys = Object.keys(messages.en).sort();
  assert.deepEqual(keys, Object.keys(messages['zh-CN']).sort());
  const placeholders = (value: string) => [...new Set(value.match(/\{[a-zA-Z0-9_]+\}/g) || [])].sort();
  for (const key of keys) {
    assert.ok(/^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/.test(key.replace(/_(one|other)$/, '')), key);
    assert.ok(messages.en[key].trim() && messages['zh-CN'][key].trim(), key);
    assert.deepEqual(placeholders(messages.en[key]), placeholders(messages['zh-CN'][key]), key);
  }
  assert.ok(translation.isInitialized);
  assert.deepEqual(translation.options.fallbackLng, ['en']);
  assert.equal(translation.options.interpolation?.escapeValue, false);
});

test('locale selection follows the first system preference and falls back to English', () => {
  assert.equal(resolveLocale(['zh-CN', 'en']), 'zh-CN');
  assert.equal(resolveLocale(['zh-TW']), 'zh-CN');
  assert.equal(resolveLocale(['en-GB', 'zh-CN']), 'en');
  assert.equal(resolveLocale(['fr-FR', 'zh-CN']), 'en');
  assert.equal(resolveLocale([]), 'en');
  assert.equal(isLanguagePreference('en'), true);
  assert.equal(isLanguagePreference('zh'), false);
  assert.equal(isLanguagePreference('<script>'), false);
});

test('manual language persists and blocked storage degrades without discarding the current choice', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const store = new Map<string, string>();
  const fake = Object.assign(new EventTarget(), { navigator: { languages: ['zh-CN'], language: 'zh-CN' }, localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } });
  Object.defineProperty(globalThis, 'window', { value: fake, configurable: true });
  try {
    setLanguagePreference('en');
    assert.equal(getLocale(), 'en');
    assert.equal(store.get(LANGUAGE_STORAGE_KEY), 'en');
    fake.localStorage.setItem = () => { throw Error('Synthetic blocked storage'); };
    setLanguagePreference('zh-CN');
    assert.equal(getLocale(), 'zh-CN');
    assert.equal(languageStorageAvailable(), false);
    assert.throws(() => setLanguagePreference('bad' as any), /Invalid/);
    assert.equal(getLanguagePreference(), 'zh-CN');
  } finally { if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window'); setLanguagePreference('zh-CN'); }
});

test('first render restores persisted choice and unsupported system locale on a fresh process', () => {
  for (const [saved, languages, expected] of [['en', ['zh-CN'], 'en'], ['zh-CN', ['en-US'], 'zh-CN'], [null, ['fr-FR'], 'en'], ['malformed', ['zh-HK'], 'zh-CN']] as const) {
    const script = `globalThis.window={navigator:{languages:${JSON.stringify(languages)}},localStorage:{getItem:()=>${JSON.stringify(saved)}}}; const m=await import('./lib/i18n.ts'); console.log(m.getLocale());`;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expected);
  }
});

test('English and Chinese use correct plurals, interpolation, numbers and local calendar dates', () => {
  try {
    setLanguagePreference('en');
    assert.equal(plural(0, 'task', 'tasks', '条任务'), '0 tasks');
    assert.equal(plural(1, 'task', 'tasks', '条任务'), '1 task');
    assert.equal(plural(2, 'task', 'tasks', '条任务'), '2 tasks');
    assert.equal(plural(1.5, 'hour', 'hours', '小时'), '1.5 hours');
    assert.equal(formatNumber(1200), '1,200');
    assert.match(formatDate('2026-10-18', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), /Sunday, October 18, 2026/);
    const invalidDate = translateError('无效日期：2026-99-99');
    assert.equal(invalidDate, 'Invalid date: 2026-99-99');
    setLanguagePreference('zh-CN');
    assert.equal(translateError(invalidDate), '无效日期：2026-99-99');
    assert.equal(plural(1, 'task', 'tasks', '条任务'), '1条任务');
    assert.equal(plural(2, 'task', 'tasks', '条任务'), '2条任务');
    assert.match(formatDate('2026-10-18', { weekday: 'long' }), /星期日/);
  } finally { setLanguagePreference('zh-CN'); }
});

test('built-in Inbox presentation never changes user-created or edited titles or record bytes', () => {
  const inbox: any = { id: 'inbox:synthetic', kind: 'list', revision: 1, data: { title: '收集箱' } };
  const before = JSON.stringify(inbox);
  try {
    setLanguagePreference('en');
    assert.equal(displayRecordTitle(inbox), 'Inbox');
    assert.equal(displayRecordTitle({ ...inbox, id: 'custom-list' }), '收集箱');
    assert.equal(displayRecordTitle({ ...inbox, revision: 2 }), '收集箱');
    assert.equal(displayRecordTitle({ ...inbox, data: { title: '我的任务 Notes' } }), '我的任务 Notes');
    assert.equal(JSON.stringify(inbox), before);
  } finally { setLanguagePreference('zh-CN'); }
});

test('native preference enum is validated and system locale remains device-local', () => {
  setNativeLanguage('system', 'en');
  assert.equal(getLocale(), 'en');
  setNativeLanguage('bad' as any, 'zh-CN');
  assert.equal(getLocale(), 'en');
  setNativeLanguage('zh-CN', 'en');
  assert.equal(getLocale(), 'zh-CN');
});

test('materialized count statuses retain singular and plural forms after live switching', () => {
  try {
    for (const count of [0, 1, 2, 1200]) {
      setLanguagePreference('zh-CN');
      const chinese = t('workspace.addedValueTasks', { count, value0: formatNumber(count) });
      setLanguagePreference('en');
      const english = translateError(chinese);
      assert.equal(english, `Added ${formatNumber(count)} ${count === 1 ? 'task' : 'tasks'}`);
      setLanguagePreference('zh-CN');
      assert.equal(translateError(english), chinese);
    }
  } finally { setLanguagePreference('zh-CN'); }
});
