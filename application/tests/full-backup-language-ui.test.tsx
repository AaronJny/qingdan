import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
const window: any = new Window({ url: 'https://qingdan.test/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'CustomEvent', 'localStorage', 'sessionStorage']) Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { default: FullBackupPanel } = await import('../app/full-backup-panel');
const { setLanguagePreference, t, plural } = await import('../lib/i18n');

test('exported backup status live-switches all count phrases without re-exporting or changing data', async () => {
  const archive = { format: 'qingdan', version: 2, sourceOwner: 'owner', createdAt: '2026-10-18T00:00:00Z', records: [{ data: { title: 'Trip to Berlin 日本語' } }, { data: { title: '中文' } }], history: [{}, {}, {}], attachments: Array.from({ length: 4 }, (_, i) => ({ id: `file${i}`, recordId: 'record', name: 'Keep to read.txt', mime: 'text/plain', size: 1, sha256: '0'.repeat(64), content: 'YQ==', createdAt: '2026-10-18T00:00:00Z' })) };
  const original = JSON.stringify(archive), originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(JSON.stringify(archive), { status: 200 }); };
  try {
    for (const source of ['en', 'ja', 'es'] as const) {
      setLanguagePreference(source);
      const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
      try {
        await act(async () => root.render(<FullBackupPanel userId="owner" onRefresh={async () => {}} />));
        await act(async () => { host.querySelector<HTMLButtonElement>('.primary')!.click(); });
        const before = host.querySelector('[role="status"]')?.textContent;
        assert.equal(before, t('ui.secondary.fullBackupPanel.fullPackageSentToTheBrowserFor', { v0: plural(2, 'record'), v1: plural(3, 'historyEntry'), v2: plural(4, 'attachment') }));
        const count = requests;
        await act(async () => setLanguagePreference('de'));
        assert.equal(host.querySelector('[role="status"]')?.textContent, t('ui.secondary.fullBackupPanel.fullPackageSentToTheBrowserFor', { v0: plural(2, 'record'), v1: plural(3, 'historyEntry'), v2: plural(4, 'attachment') }));
        assert.equal(requests, count);
        assert.equal(JSON.stringify(archive), original);
      } finally { await act(async () => root.unmount()); host.remove(); }
    }
  } finally { globalThis.fetch = originalFetch; window.happyDOM.abort(); }
});
