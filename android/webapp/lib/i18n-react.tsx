import { useTranslation } from 'react-i18next';
import React, { useEffect, useSyncExternalStore } from 'react';
import { translation, getLanguagePreference, getLocale, initializeLanguage, isLanguagePreference, languageSnapshot, languageStorageAvailable, languageNativeSaveFailed, reportNativeLanguageSaveFailure, setLanguagePreference, setNativeLanguage, subscribeLanguage, t, type LanguagePreference, type Locale } from './i18n';
type Snapshot = { preference: LanguagePreference; locale: Locale; revision?: number };
type LanguageBridge = { getLanguage?: () => Promise<Snapshot>; setLanguagePreference?: (value: LanguagePreference) => Promise<Snapshot>; onLanguageChanged?: (listener: (snapshot: Snapshot) => void) => () => void };
export function useLanguage() { useTranslation('translation', { i18n: translation, useSuspense: false }); useSyncExternalStore(subscribeLanguage, languageSnapshot, () => 'system:zh-CN:0:true'); return { locale: getLocale(), preference: getLanguagePreference() }; }
export function LanguageSelect() {
  const { preference } = useLanguage();
  return <label className="language-setting">{t('settings.language')}<select aria-label={t('settings.language')} value={preference} onChange={event => { if (isLanguagePreference(event.target.value)) setLanguagePreference(event.target.value); }}>
    <option value="system">{t('settings.languageSystem')}</option><option value="zh-CN">简体中文</option><option value="en">English</option>
  </select>{!languageStorageAvailable() && <small role="status">{t('settings.languageNotSaved')}</small>}{languageNativeSaveFailed() && <small role="alert">{t('settings.languageNativeSaveFailed')}</small>}</label>;
}
/** Hydrate the trusted native preference without remounting the app or discarding unsaved input. */
export function useLanguageRuntime() {
  useLanguage();
  useEffect(() => {
    const stop = initializeLanguage();
    const win = window as any;
    const bridge: LanguageBridge | undefined = win.qingdanDesktop;
    let alive = true;
    let sequence = 0;
    let nativeGeneration = 0;
    let latestNativeRevision = -1;
    let lastNative: Snapshot = { preference: getLanguagePreference(), locale: getLocale() };
    const apply = (snapshot: Snapshot) => {
      if (!alive || !snapshot || !isLanguagePreference(snapshot.preference) || !['zh-CN', 'en'].includes(snapshot.locale)) return;
      if (snapshot.revision !== undefined) {
        if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || snapshot.revision < latestNativeRevision) return;
        latestNativeRevision = snapshot.revision;
      } else if (latestNativeRevision >= 0) return;
      lastNative = snapshot;
      setNativeLanguage(snapshot.preference, snapshot.locale);
    };
    const nativeSetter = (value: unknown) => { if (isLanguagePreference(value)) { nativeGeneration++; setNativeLanguage(value, win.__QINGDAN_NATIVE_LOCALE__); } };
    win.__qingdanSetLanguagePreference = nativeSetter;
    if (isLanguagePreference(win.__QINGDAN_NATIVE_LANGUAGE__)) nativeSetter(win.__QINGDAN_NATIVE_LANGUAGE__);
    const unsubscribe = bridge?.onLanguageChanged?.(snapshot => { nativeGeneration++; apply(snapshot); });
    if (bridge?.getLanguage) void bridge.getLanguage().then(snapshot => { if (sequence === 0 && nativeGeneration === 0) apply(snapshot); }).catch(() => {});
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.source === 'native' || !isLanguagePreference(detail?.preference)) return;
      if (bridge?.setLanguagePreference) {
        const request = ++sequence; const generationAtRequest = nativeGeneration;
        void bridge.setLanguagePreference(detail.preference).then(snapshot => {
          if (!alive || request !== sequence) return;
          if (snapshot.revision !== undefined || nativeGeneration === generationAtRequest) apply(snapshot);
          reportNativeLanguageSaveFailure(false);
        }).catch(async () => {
          if (!alive || request !== sequence) return;
          let snapshot = lastNative;
          try { snapshot = await bridge.getLanguage?.() || lastNative; } catch {}
          if (!alive || request !== sequence) return;
          apply(snapshot); reportNativeLanguageSaveFailure(true);
        });
      }
    };
    window.addEventListener('qingdan-language-changed', changed);
    return () => { alive = false; stop(); unsubscribe?.(); window.removeEventListener('qingdan-language-changed', changed); if (win.__qingdanSetLanguagePreference === nativeSetter) delete win.__qingdanSetLanguagePreference; };
  }, []);
}
