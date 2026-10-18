import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFullBackupStatus, type FullBackupStatus } from './full-backup-status';
import { setLanguagePreference, t, plural, translateError } from './i18n';

test('backup export and restore retain raw counts and render entirely in the current language', () => {
  const statuses: Extract<FullBackupStatus, { kind: 'exported' | 'restored' }>[] = [
    { kind: 'exported', records: 2, history: 3, attachments: 4 },
    { kind: 'restored', records: 2, history: 3, attachments: 4, replayed: false, notices: ['Unknown notice: trip to Berlin'] },
    { kind: 'restored', records: 1, history: 1200, attachments: 0, replayed: true, notices: [] },
  ];
  try {
    for (const source of ['en', 'ja', 'es'] as const) for (const status of statuses) {
      const bytes = JSON.stringify(status);
      setLanguagePreference(source);
      const before = renderFullBackupStatus(status);
      setLanguagePreference('de');
      const after = renderFullBackupStatus(status);
      assert.notEqual(after, before);
      assert.ok(after.includes(plural(status.records, 'record')));
      assert.ok(after.includes(plural(status.history, 'historyEntry')));
      assert.ok(after.includes(plural(status.attachments, 'attachment')));
      if (status.kind === 'exported') assert.equal(after, t('ui.secondary.fullBackupPanel.fullPackageSentToTheBrowserFor', { v0: plural(2, 'record'), v1: plural(3, 'historyEntry'), v2: plural(4, 'attachment') }));
      if (status.kind === 'restored' && status.notices.length) assert.ok(after.includes(status.notices[0]));
      assert.equal(JSON.stringify(status), bytes, 'Rendering must not mutate semantic status data');
    }
  } finally { setLanguagePreference('zh-CN'); }
});

test('compatibility patterns cannot reinterpret generic ranges, units, or unknown user strings', () => {
  setLanguagePreference('en');
  const materialized = t('ui.secondary.fullBackupPanel.fullPackageSentToTheBrowserFor', { v0: plural(2, 'record'), v1: plural(3, 'historyEntry'), v2: plural(4, 'attachment') });
  setLanguagePreference('de');
  try {
    for (const unknown of ['Trip to Berlin', 'A to B', 'Remember to save this note', '1 task', materialized]) assert.equal(translateError(unknown), unknown);
    assert.equal(translateError('Invalid date: 2026-99-99'), t('core.invalidDateValue', { p0: '2026-99-99' }));
    assert.equal(translateError('Storage path must not be a symbolic link: /tmp/user to keep'), t('errors.storagePathMustNotBeASymbolicLinkValue', { p0: '/tmp/user to keep' }));
    assert.equal(translateError('Invalid local date: 2026-99-99'), t('errors.invalidLocalDateValue', { p0: '2026-99-99' }));
  } finally { setLanguagePreference('zh-CN'); }
});
