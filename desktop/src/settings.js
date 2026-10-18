'use strict';
const t = (key, options) => window.qingdanT(key, options);
const form = document.querySelector('form');
const input = document.querySelector('#server');
const mode = document.querySelector('#mode');
const submit = form.querySelector('button');
const message = document.querySelector('#message');
const currentConnection = document.querySelector('#current-connection');
const language = document.querySelector('#language');
let saving = false, closed = false, edited = false, changingLanguage = false;
let connectionPoll, connectionRequest = 0, languageRequest = 0;
let currentResult = null, messageState = null;
let confirmedLanguage = { preference: document.documentElement.dataset.languagePreference, locale: document.documentElement.lang, revision: Number(document.documentElement.dataset.languageRevision) };
if (!validLanguage(confirmedLanguage)) confirmedLanguage = null;
else language.value = confirmedLanguage.preference;
function reflectMode() {
  language.disabled = saving;
  mode.disabled = saving;
  input.disabled = saving || mode.value !== 'server';
  input.required = mode.value === 'server';
}
function nativeMessage(value) {
  // Only an explicit native error/status message is matched against known resources.
  // Never called for the server field, account data, or other user-provided text.
  for (const locale of ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR']) {
    const dictionary = window.i18next.getResourceBundle(locale, 'translation');
    const key = Object.keys(dictionary).find(key => dictionary[key] === value);
    if (key) return t(key);
  }
  return value;
}
function renderMessage() {
  message.textContent = !messageState ? '' : messageState.key ? t(messageState.key) : nativeMessage(messageState.raw);
}
function showMessage(key, raw) { messageState = key ? { key } : raw ? { raw } : null; renderMessage(); }
function showConnection(result) {
  currentResult = result;
  const name = result.mode === 'builtin' ? t('desktop.local.mode.no.sign.in') : t('desktop.private.server') + result.serverUrl;
  const state = result.status === 'connected' ? t('desktop.connected') : result.status === 'connecting' ? t('desktop.connecting') : t('desktop.disconnected');
  currentConnection.textContent = t('desktop.connection.current', { name, state });
  clearTimeout(connectionPoll);
  if (!closed && result.status === 'connecting') connectionPoll = setTimeout(readCurrentConnection, 800);
}
function receiveConnection(result) {
  if (!currentResult) {
    if (!edited) { mode.value = result.mode; input.value = result.serverUrl || ''; }
    reflectMode();
    if (!messageState) showMessage(null, result.warning || result.error || '');
  }
  showConnection(result);
}
async function readCurrentConnection() {
  if (closed) return;
  const request = ++connectionRequest;
  try { const result = await window.qingdanConnection.get(); if (!closed && request === connectionRequest) receiveConnection(result); } catch {}
}
function validLanguage(value) {
  return value && ['system', 'zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR'].includes(value.preference) && ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR'].includes(value.locale) && Number.isSafeInteger(value.revision) && value.revision >= 0;
}
function applyLanguage(value) {
  if (closed || !validLanguage(value) || confirmedLanguage && value.revision < confirmedLanguage.revision) return false;
  confirmedLanguage = value;
  void window.i18next.changeLanguage(value.locale);
  document.documentElement.lang = value.locale;
  document.title = t('desktop.qingdan.connection.settings');
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  language.value = value.preference;
  if (currentResult) showConnection(currentResult);
  renderMessage();
  return true;
}
mode.addEventListener('change', () => { edited = true; reflectMode(); });
input.addEventListener('input', () => { edited = true; });
window.addEventListener('focus', readCurrentConnection);
window.addEventListener('unload', () => { closed = true; clearTimeout(connectionPoll); });
const initialConnection = ++connectionRequest;
window.qingdanConnection.get().then(result => {
  if (closed || initialConnection !== connectionRequest) return;
  receiveConnection(result);
}).catch(() => { showMessage('desktop.could.not.read.connection.settings'); submit.disabled = true; });
const initialLanguage = languageRequest;
window.qingdanConnection.getLanguage().then(value => {
  if (initialLanguage === languageRequest && !changingLanguage) applyLanguage(value);
}).catch(() => {});
window.qingdanConnection.onLanguageChanged(value => {
  if (!validLanguage(value)) return;
  // Revisions order commits across all windows, including changes during a pending write.
  if (confirmedLanguage && value.revision < confirmedLanguage.revision) return;
  if (!changingLanguage) languageRequest++;
  applyLanguage(value);
});
language.addEventListener('change', async () => {
  const preference = language.value;
  if (!['system', 'zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR'].includes(preference)) return;
  const request = ++languageRequest;
  const revisionAtRequest = confirmedLanguage?.revision ?? -1;
  const superseded = () => confirmedLanguage && confirmedLanguage.revision > revisionAtRequest;
  changingLanguage = true;
  try {
    const value = await window.qingdanConnection.setLanguagePreference(preference);
    if (closed || request !== languageRequest) return;
    if (!validLanguage(value) || value.preference !== preference) throw new TypeError('Invalid native language acknowledgement');
    if (value.revision <= revisionAtRequest) throw new TypeError('Stale native language acknowledgement');
    changingLanguage = false;
    if (applyLanguage(value)) { if (messageState?.key === 'desktop.could.not.save.the.language.preference') showMessage(null); }
    else if (!superseded()) throw new TypeError('Unaccepted native language acknowledgement');
  } catch {
    if (closed || request !== languageRequest) return;
    changingLanguage = false;
    if (superseded()) return;
    if (confirmedLanguage) applyLanguage(confirmedLanguage);
    showMessage('desktop.could.not.save.the.language.preference');
    try {
      const value = await window.qingdanConnection.getLanguage();
      if (!closed && request === languageRequest && !changingLanguage) applyLanguage(value);
    } catch {}
  }
});
form.addEventListener('submit', async event => {
  event.preventDefault(); if (saving) return;
  saving = true; reflectMode(); submit.disabled = true; showMessage('desktop.switching.connections');
  try {
    const result = await window.qingdanConnection.save({ mode: mode.value, serverUrl: mode.value === 'server' ? input.value.trim() : '' });
    if (closed) return;
    if (result.ok) showMessage(result.mode === 'builtin' ? 'desktop.connected.to.the.local.service.you.can' : 'desktop.connected.to.your.private.server.sign.in');
    else showMessage(null, result.error);
    await readCurrentConnection();
  } catch { showMessage('desktop.could.not.save.connection.settings'); }
  finally { saving = false; reflectMode(); submit.disabled = false; }
});
reflectMode();
