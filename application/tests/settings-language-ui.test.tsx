import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import type { AppRecord, Bootstrap } from '../lib/types';

const window: any = new Window({ url: 'https://qingdan.test/' });
const global = globalThis as any;
for (const key of ['window', 'document', 'navigator', 'location', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Event', 'CustomEvent', 'MutationObserver', 'sessionStorage', 'localStorage']) {
  Object.defineProperty(global, key, { value: window[key], configurable: true, writable: true });
}
global.IS_REACT_ACT_ENVIRONMENT = true;
global.fetch = async (path: string) => { throw new Error('Unexpected network request: ' + path); };
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { SettingsDialog } = await import('../app/workspace-dialogs');
const { useLanguageRuntime } = await import('../lib/i18n-react');
const { setLanguagePreference, getLanguagePreference } = await import('../lib/i18n');
const { draftStore } = await import('../lib/client-storage');

const labels = {
  'zh-CN': { settings: '设置', general: '通用', language: '语言', shortcuts: '快捷键', appearance: '外观与偏好', theme: '主题' },
  en: { settings: 'Settings', general: 'General', language: 'Language', shortcuts: 'Keyboard shortcuts', appearance: 'Appearance and preferences', theme: 'Theme' },
};

for (const initialLocale of ['zh-CN', 'en'] as const) {
  test(`${initialLocale}: language belongs only to General; other settings and user data remain separate`, async () => {
    localStorage.clear();
    const user = { userId: 'settings-language-' + initialLocale, displayName: 'Synthetic user', email: 'fixture@example.test', mode: 'local' as const };
    draftStore.removeItem('qingdan:form-draft:' + user.userId + ':settings:preferences');
    const settings: AppRecord = { id: 'settings:' + user.userId, kind: 'settings', ownerId: user.userId, listId: null, data: { theme: 'dark', weekStart: 0, timezone: 'Asia/Shanghai' }, revision: 3, updatedAt: '2026-10-18T00:00:00Z', deleted: false };
    const task: AppRecord = { ...settings, id: 'unchanged-task', kind: 'task', data: { title: '今天 English', description: '草稿', tags: ['English', '中文'] } };
    const state: Bootstrap = { user, records: [settings, task], history: [], attachments: [], members: [], serverTime: '2026-10-18T00:00:00Z' };
    const original = JSON.stringify(state);
    const actions: any = { save: () => assert.fail('Language must not save account preferences'), create: () => assert.fail('Language must not create a preferences row'), refresh: async () => {}, notify: () => {} };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    setLanguagePreference(initialLocale);
    function View() { useLanguageRuntime(); return <SettingsDialog state={state} settingsRecord={settings} actions={actions} onClose={() => {}} />; }
    const navigation = () => host.querySelector('nav')!;
    const panel = () => host.querySelector('.settings-content')!;
    const button = (name: string) => {
      const result = Array.from(navigation().querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent === name);
      assert.ok(result, `Missing settings navigation: ${name}`);
      return result;
    };
    const assertActive = (name: string) => {
      const active = button(name);
      assert.equal(active.getAttribute('aria-current'), 'page');
      assert.equal(navigation().querySelectorAll('[aria-current="page"]').length, 1);
      assert.equal(active.getAttribute('aria-controls'), panel().id);
      assert.equal(panel().getAttribute('aria-labelledby'), active.id);
      assert.equal(document.getElementById(active.id), active);
      assert.equal(active.type, 'button');
      assert.equal(active.tabIndex, 0, 'Settings sections remain reachable with native keyboard navigation');
    };
    const visit = async (name: string) => { await act(async () => { const target = button(name); target.focus(); target.click(); }); assertActive(name); };
    const assertShortcutsOnly = () => {
      assert.equal(panel().querySelector('.language-setting'), null);
      assert.equal(panel().querySelectorAll('input,select,textarea').length, 0);
      assert.deepEqual(Array.from(panel().querySelectorAll('kbd')).map(item => item.textContent), ['N', '/', '⌘ / Ctrl + K', '⌘ / Ctrl + Z', 'Esc', 'Shift + Enter']);
    };
    try {
      await act(async () => root.render(<View />));
      let text = labels[initialLocale];
      assert.equal(navigation().getAttribute('aria-label'), text.settings);
      assertActive(text.general);
      assert.equal(panel().querySelector('h3')?.textContent, text.general);
      assert.equal(host.querySelectorAll('.language-setting').length, 1);
      assert.equal(panel().querySelector('select')?.getAttribute('aria-label'), text.language);
      assert.equal(panel().querySelector<HTMLSelectElement>('select')?.value, initialLocale);
      await visit(text.shortcuts);
      assertShortcutsOnly();
      await visit(text.appearance);
      assert.equal(panel().querySelector('.language-setting'), null);
      assert.equal(panel().querySelector<HTMLSelectElement>(`select[aria-label="${text.theme}"]`)?.value, 'dark');
      await visit(text.general);
      const nextLocale = initialLocale === 'en' ? 'zh-CN' : 'en';
      await act(async () => {
        const select = panel().querySelector<HTMLSelectElement>('select')!;
        select.value = nextLocale;
        select.dispatchEvent(new window.Event('change', { bubbles: true }));
      });
      text = labels[nextLocale];
      assertActive(text.general);
      assert.equal(navigation().getAttribute('aria-label'), text.settings);
      assert.equal(getLanguagePreference(), nextLocale);
      assert.equal(localStorage.getItem('qingdan-language'), nextLocale);
      assert.equal(host.querySelectorAll('.language-setting').length, 1);
      assert.equal(panel().querySelector('select')?.getAttribute('aria-label'), text.language);
      await visit(text.shortcuts);
      assertShortcutsOnly();
      await visit(text.general);
      assert.equal(panel().querySelector<HTMLSelectElement>('select')?.value, nextLocale);
      await visit(text.shortcuts);
      await act(async () => root.render(null));
      await act(async () => root.render(<View />));
      assertActive(text.general);
      assert.equal(panel().querySelector<HTMLSelectElement>('select')?.value, nextLocale, 'Reopening Settings keeps the existing device language');
      await act(async () => {
        const select = panel().querySelector<HTMLSelectElement>('select')!;
        select.value = 'system';
        select.dispatchEvent(new window.Event('change', { bubbles: true }));
      });
      assert.equal(getLanguagePreference(), 'system');
      assert.equal(localStorage.getItem('qingdan-language'), 'system');
      assert.equal(JSON.stringify(state), original, 'Navigation and language changes must leave all user records untouched');
      assert.equal(draftStore.getItem('qingdan:form-draft:' + user.userId + ':settings:preferences'), null, 'Language must not introduce an account preference draft');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      window.happyDOM.abort();
    }
  });
}
