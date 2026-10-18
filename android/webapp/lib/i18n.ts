/** Device-local interface language. Record data and wire/storage formats never pass through this module. */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { businessStorage } from './business-storage';
import domainEn from './locales/domain.en.json';
import domainZh from './locales/domain.zh.json';
import coreEn from './locales/core.en.json';
import coreZh from './locales/core.zh.json';
import primaryEn from './locales/ui-primary.en.json';
import primaryZh from './locales/ui-primary.zh.json';
import secondaryEn from './locales/ui-secondary.en.json';
import secondaryZh from './locales/ui-secondary.zh.json';

export type Locale = 'zh-CN' | 'en';
export type LanguagePreference = 'system' | Locale;
export type MessageParameters = Record<string, string | number>;
export const LANGUAGE_STORAGE_KEY = 'qingdan-language';
export const LANGUAGE_EVENT = 'qingdan-language-changed';
export type MessageKey = keyof typeof coreZh | keyof typeof primaryZh | keyof typeof secondaryZh | keyof typeof domainZh;
export const messages: Record<Locale, Record<string, string>> = {
  en: { ...coreEn, ...primaryEn, ...secondaryEn, ...domainEn },
  'zh-CN': { ...coreZh, ...primaryZh, ...secondaryZh, ...domainZh },
};
export const translation = i18next.createInstance();
translation.use(initReactI18next);
const listeners = new Set<() => void>();
let preference: LanguagePreference | undefined;
let nativeSystemLocale: Locale | undefined;
let storageAvailable = true;
let nativeSaveFailed = false;
let version = 0;
export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'system' || value === 'zh-CN' || value === 'en';
}
export function resolveLocale(languages: readonly string[]): Locale {
  // Match the first language the user actually prefers; unsupported languages use English.
  const first = languages.find(value => typeof value === 'string' && value.trim()) || 'en';
  return /^zh(?:-|_|$)/i.test(first) ? 'zh-CN' : 'en';
}
export function getLanguagePreference(): LanguagePreference {
  if (preference) return preference;
  try {
    const saved = typeof window === 'undefined' ? null : businessStorage().getItem(LANGUAGE_STORAGE_KEY);
    preference = isLanguagePreference(saved) ? saved : 'system';
  } catch { preference = 'system'; storageAvailable = false; }
  return preference;
}
export function getLocale(): Locale {
  const selected = getLanguagePreference();
  if (selected !== 'system') return selected;
  if (nativeSystemLocale) return nativeSystemLocale;
  // Server responses retain canonical Chinese messages; the requesting client localizes them.
  if (typeof window === 'undefined') return 'zh-CN';
  return resolveLocale(window.navigator?.languages?.length ? window.navigator.languages : [window.navigator?.language || 'en']);
}
export function languageStorageAvailable() { return storageAvailable; }
export function languageNativeSaveFailed() { return nativeSaveFailed; }
export function reportNativeLanguageSaveFailure(failed: boolean) { nativeSaveFailed = failed; publish('native'); }
export function languageSnapshot() { return `${getLanguagePreference()}:${getLocale()}:${version}:${storageAvailable}:${nativeSaveFailed}`; }
export function subscribeLanguage(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(source: 'web' | 'native' | 'system' | 'storage') {
  version++;
  void translation.changeLanguage(getLocale());
  if (typeof document !== 'undefined') {
    document.documentElement.lang = getLocale();
    document.title = t('app.documentTitle');
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (manifest) manifest.href = getLocale() === 'en' ? '/manifest.en.webmanifest' : '/manifest.webmanifest';
  }
  for (const listener of listeners) listener();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: { preference: getLanguagePreference(), locale: getLocale(), source } }));
}
export function setLanguagePreference(value: LanguagePreference, source: 'web' | 'native' | 'storage' = 'web'): void {
  if (!isLanguagePreference(value)) throw new TypeError('Invalid interface language');
  preference = value;
  if (source === 'web') nativeSaveFailed = false;
  if (source !== 'storage' && typeof window !== 'undefined') {
    try { businessStorage().setItem(LANGUAGE_STORAGE_KEY, value); storageAvailable = true; }
    catch { storageAvailable = false; }
  }
  publish(source);
}
export function setNativeLanguage(value: LanguagePreference, locale?: Locale) {
  if (!isLanguagePreference(value)) return;
  if (locale === 'zh-CN' || locale === 'en') nativeSystemLocale = locale;
  setLanguagePreference(value, 'native');
}
export function initializeLanguage() {
  if (typeof window === 'undefined') return () => {};
  const storage = (event: StorageEvent) => {
    if (event.key !== LANGUAGE_STORAGE_KEY && event.key !== null) return;
    setLanguagePreference(isLanguagePreference(event.newValue) ? event.newValue : 'system', 'storage');
  };
  const system = () => { if (getLanguagePreference() === 'system') { nativeSystemLocale = undefined; publish('system'); } };
  window.addEventListener('storage', storage);
  window.addEventListener('languagechange', system);
  publish('system');
  return () => { window.removeEventListener('storage', storage); window.removeEventListener('languagechange', system); };
}
// Only canonical application error/toast strings use this compatibility index.
// No DOM text or user record content is scanned or rewritten.
const sourceKeys = new Map<string, string>();
const patterns: { key: string; names: string[]; pattern: RegExp }[] = [];
for (const dictionary of [messages['zh-CN'], messages.en]) for (const [key, value] of Object.entries(dictionary)) {
  if (!sourceKeys.has(value)) sourceKeys.set(value, key);
  const names: string[] = [];
  const parts = value.split(/(\{[a-zA-Z0-9_]+\})/g);
  if (parts.length > 1) {
    const expression = parts.map(part => {
      if (/^\{[a-zA-Z0-9_]+\}$/.test(part)) { names.push(part.slice(1, -1)); return '([\\s\\S]*?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    // A literal anchor prevents matching arbitrary content against a lone parameter.
    if (parts.some(part => !/^\{/.test(part) && part.trim().length > 1)) patterns.push({ key, names, pattern: new RegExp(`^${expression}$`) });
  }
}
// Count fields for app-owned materialized status messages. i18next still selects all
// plural forms; this only restores their original numeric option after a locale switch.
const statusCountFields = {
  'workspace.addedValueTasks': 'value0',
  'workspace.importCompleteValueRecords': 'value0',
  'workspace.valueChangesAreUnconfirmedOrHaveConflictsYour': 'amount',
  'workspace.valueSavesAreUnconfirmedTheOriginalOperationIds': 'amount',
  'workspace.loadedValueRecordsLoadingMore': 'amount',
  'workspace.showingValueOfValueRows': 'total',
  'workspace.createdValueTasksAndSubtasks': 'amount',
  'workspace.exportIncludesValueFormatNotices': 'amount',
  'workspace.processedValueTasksBatchChangesAreSavedIndividually': 'amount',
  'workspace.processedValueItemsRemainingSelectionsAndInputAre': 'amount',
  'ui.secondary.accountTaskSync.savedOnThisDevicePendingTaskOperations': 'v0',
  'ui.secondary.calendarBatch.pendingSelectionCount': 'v0',
  'ui.secondary.calendarEditor.scheduleRangeSummary': 'v4',
  'ui.secondary.calendarSources.lastSuccessfulRefresh': 'v1',
  'ui.secondary.commentComposer.selectedMemberCount': 'v0',
  'ui.secondary.commentComposer.previouslySelectedMembersAreNoLongerIn': 'v0',
  'ui.secondary.countdownBackground.unconfirmed': 'v1',
  'ui.secondary.countdownEditor.keepExisting': 'v0',
  'ui.secondary.habitGroupManager.confirmedYouCanNowSaveTheGroup': 'v0',
  'ui.secondary.listTransfer.completedTransferSummary': 'v1',
  'ui.secondary.taskAttachments.unconfirmedTheOriginalFileIsRetainedOnly': 'v1',
} satisfies Partial<Record<MessageKey, string>>;
/** Re-localize known, app-owned error and status strings received over existing APIs. */
function translateKnownMessage(keyOrMessage: string, params: MessageParameters = {}): string {
  const locale = getLocale();
  let key = Object.hasOwn(messages[locale], keyOrMessage) || Object.hasOwn(messages['zh-CN'], keyOrMessage) ? keyOrMessage : sourceKeys.get(keyOrMessage);
  if (!key) for (const item of patterns) {
    const match = item.pattern.exec(keyOrMessage);
    if (match) { key = item.key; params = { ...Object.fromEntries(item.names.map((name, i) => [name, match[i + 1]])), ...params }; break; }
  }
  if (!key) return keyOrMessage;
  const baseKey = key.replace(/_(one|other)$/, '');
  const countField = statusCountFields[baseKey as keyof typeof statusCountFields];
  if (countField) {
    key = baseKey;
    const rawCount = params.count ?? params[countField];
    if (typeof rawCount === 'number') params = { ...params, count: rawCount };
    else if (typeof rawCount === 'string' && /^\d+(?:,\d{3})*(?:\.\d+)?$/.test(rawCount)) params = { ...params, count: Number(rawCount.replaceAll(',', '')) };
  }
  return String(translation.t(key as MessageKey, { lng: locale, ...params }));
}
export function t(key: MessageKey, params: MessageParameters = {}): string {
  return String(translation.t(key, { lng: getLocale(), ...params }));
}
export const translateError = translateKnownMessage;
function dateValue(value: Date | string | number): Date {
  // ISO calendar dates are local days, never midnight UTC.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + 'T12:00:00');
  return value instanceof Date ? value : new Date(value);
}
export function formatDate(value: Date | string | number, options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }) {
  const date = dateValue(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(getLocale(), options).format(date);
}
export function formatTime(value: Date | string | number, options: Intl.DateTimeFormatOptions = {}) {
  return formatDate(value, { hour: 'numeric', minute: '2-digit', ...options });
}
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}) { return new Intl.NumberFormat(getLocale(), options).format(value); }
export function plural(count: number, singularEnglish: string, pluralEnglish: string, chineseUnit: string) {
  return String(translation.t('common.countedUnit', { lng: getLocale(), count, amount: formatNumber(count), one: getLocale() === 'zh-CN' ? chineseUnit : singularEnglish, other: getLocale() === 'zh-CN' ? chineseUnit : pluralEnglish }));
}
export function weekdayNames(width: 'long' | 'short' | 'narrow' = 'short', weekStart = 0) {
  return Array.from({ length: 7 }, (_, index) => formatDate(new Date(2024, 0, 7 + (index + weekStart) % 7, 12), { weekday: width }));
}

// Resources are bundled; initialization is synchronous and never performs network requests.
void translation.init({
  lng: getLocale(), fallbackLng: 'en', supportedLngs: ['zh-CN', 'en'], load: 'currentOnly',
  resources: { en: { translation: messages.en }, 'zh-CN': { translation: messages['zh-CN'] } },
  keySeparator: false, nsSeparator: false, initAsync: false,
  interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
  returnNull: false, returnEmptyString: false, react: { useSuspense: false },
});
