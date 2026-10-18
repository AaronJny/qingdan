import { t, translateError, plural } from './i18n';

/** Keep semantic data, never rendered count/noun strings, across locale changes. */
export type FullBackupStatus =
  | { kind: 'invalidSelection' }
  | { kind: 'exported'; records: number; history: number; attachments: number }
  | { kind: 'restored'; records: number; history: number; attachments: number; replayed: boolean; notices: string[] }
  | { kind: 'error' | 'restoreError'; error: string };
export function renderFullBackupStatus(status: FullBackupStatus): string {
  switch (status.kind) {
    case 'invalidSelection': return t('ui.secondary.fullBackupPanel.theOriginalImportSelectionHasAnInvalid');
    case 'exported': return t('ui.secondary.fullBackupPanel.fullPackageSentToTheBrowserFor', {
      v0: plural(status.records, 'record'), v1: plural(status.history, 'historyEntry'), v2: plural(status.attachments, 'attachment'),
    });
    case 'restored': return t('ui.secondary.fullBackupPanel.restoredPackageSummary', {
      v0: t(status.replayed ? 'ui.secondary.fullBackupPanel.originalImportVerifiedNoDuplicateCopiesWere' : 'ui.secondary.fullBackupPanel.restoreConfirmed'),
      v1: plural(status.records, 'record'), v2: plural(status.history, 'historyEntry'), v3: plural(status.attachments, 'attachment'),
      // These are server-owned restore notices. Unknown notices are preserved as-is;
      // record bodies, filenames and other user content never enter this path.
      v4: status.notices.map(notice => translateError(notice)).join('；'),
    });
    case 'restoreError': return t('ui.secondary.fullBackupPanel.keepTheOriginalBackupFileSelectThe', { v0: translateError(status.error) });
    case 'error': return translateError(status.error);
  }
}
