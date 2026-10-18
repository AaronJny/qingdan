'use strict';
const t = key => window.qingdanT(key);
const message = document.querySelector('#message');
let messageKey = null;
let revision = Number(document.documentElement.dataset.languageRevision);
function applyLanguage(value) {
  if (!value || !['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR'].includes(value.locale) || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision < revision) return;
  revision = value.revision;
  void window.i18next.changeLanguage(value.locale);
  document.documentElement.lang = value.locale;
  document.title = t('desktop.qingdan');
  for (const element of document.querySelectorAll('[data-i18n]')) if (element.dataset.i18n) element.textContent = t(element.dataset.i18n);
  const detail = document.querySelector('#connection-detail');
  const error = detail.dataset.nativeError;
  if (error) {
    let key;
    for (const locale of ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR']) {
      const dictionary = window.i18next.getResourceBundle(locale, 'translation');
      key = Object.keys(dictionary).find(candidate => dictionary[candidate] === error);
      if (key) break;
    }
    detail.textContent = key ? t(key) : error;
  }
  if (messageKey) message.textContent = t(messageKey);
}
window.qingdanDesktop.onLanguageChanged(applyLanguage);
window.qingdanDesktop.getLanguage().then(applyLanguage).catch(() => {});
document.querySelector('#connection-settings').addEventListener('click', async () => {
  try { await window.qingdanDesktop.openConnectionSettings(); messageKey = 'desktop.connection.settings.are.open'; }
  catch { messageKey = 'desktop.could.not.open.connection.settings.use.file'; }
  message.textContent = t(messageKey);
});
