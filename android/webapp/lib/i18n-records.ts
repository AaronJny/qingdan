import { t } from './i18n';
import type { AppRecord } from './types';
/** Render only the never-edited built-in Inbox label. Never mutate records or guess from arbitrary titles. */
export function displayRecordTitle(record: AppRecord | undefined): string {
  if (!record) return '';
  if (record.kind === 'list' && record.id.startsWith('inbox:') && record.revision === 1 && record.data.title === '收集箱') return t('common.inbox');
  return record.data.title || '';
}
