'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const localBusinessStorageRequired = typeof process !== 'undefined' && process.argv?.includes('--qingdan-owned-local') === true;
// The service page can inspect its own connection and ask to open the bundled
// settings window and update the validated interface-language preference. It
// cannot select a server, access files, or mutate other settings.
contextBridge.exposeInMainWorld('qingdanDesktop', Object.freeze({
  localBusinessStorageRequired,
  getLanguage: () => ipcRenderer.invoke('qingdan-desktop:get-language'),
  setLanguagePreference: preference => {
    if (!['system', 'zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR'].includes(preference)) return Promise.reject(new TypeError('Invalid language preference'));
    return ipcRenderer.invoke('qingdan-desktop:set-language', preference);
  },
  onLanguageChanged: listener => {
    if (typeof listener !== 'function') throw new TypeError('A language listener is required');
    const receive = (_event, value) => {
      if (value && ['system', 'zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR'].includes(value.preference) && ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR'].includes(value.locale) && Number.isSafeInteger(value.revision) && value.revision >= 0) listener({ preference: value.preference, locale: value.locale, revision: value.revision });
    };
    ipcRenderer.on('qingdan-desktop:language-changed', receive);
    return () => ipcRenderer.removeListener('qingdan-desktop:language-changed', receive);
  },
  getAgentAccess: accountId => ipcRenderer.invoke('qingdan-desktop:get-agent-access', accountId),
  saveAgentAccess: (accountId, settings) => ipcRenderer.invoke('qingdan-desktop:save-agent-access', accountId, settings),
  getConnection: () => ipcRenderer.invoke('qingdan-desktop:connection'),
  openConnectionSettings: () => ipcRenderer.invoke('qingdan-desktop:open-settings'),
  forgetReminders: (accountId, ids) => ipcRenderer.invoke('qingdan-desktop:forget-reminders', accountId, ids),
  runtimeReady: accountId => ipcRenderer.invoke('qingdan-desktop:runtime-ready', accountId),
  onRuntimeEvent: listener => {
    if (typeof listener !== 'function') throw new TypeError('A runtime listener is required');
    const receive = (_event, value) => {
      if (value && ['quick-add', 'resume', 'reminders', 'open-reminder', 'runtime-status', 'connection-health', 'session-changed'].includes(value.type)) listener(value);
    };
    ipcRenderer.on('qingdan-desktop:runtime-event', receive);
    return () => ipcRenderer.removeListener('qingdan-desktop:runtime-event', receive);
  },
}));

// Explicit synchronous business storage, not an override of browser localStorage.
// Main acknowledges only after atomic replacement and fsync; revisions prevent
// an older window from silently overwriting another window's input.
if (localBusinessStorageRequired) {
  const revisions = new Map();
  let initializationError;
  function call(operation, payload = {}) {
    const reply = ipcRenderer.sendSync('qingdan-local-business', { operation, ...payload });
    if (!reply || reply.ok !== true) {
      const error = new Error(reply?.error || 'Local input storage is unavailable. Keep this window open.');
      error.code = reply?.code || 'LOCAL_STORAGE_UNAVAILABLE'; throw error;
    }
    return reply.result;
  }
  try {
    const state = call('snapshot');
    for (const [key, entry] of Object.entries(state.entries)) revisions.set(key,entry.revision);
  } catch (error) { initializationError = error; }
  function ready() { if (initializationError) throw initializationError; }
  contextBridge.exposeInMainWorld('qingdanLocalStorage', Object.freeze({
    getItem(key) { ready(); return call('get',{key}).value; },
    keys() { ready(); return call('keys'); },
    setItem(key,value) { ready(); const result = call('set',{key,value,expectedRevision:revisions.get(key)||0}); revisions.set(key,result.revision); },
    removeItem(key) { ready(); const result = call('remove',{key,expectedRevision:revisions.get(key)||0}); revisions.set(key,result.revision); },
  }));
  ipcRenderer.on('qingdan-local-business:changed', (_event, change) => {
    if (typeof window === 'undefined' || !change || typeof change.key !== 'string' || !(change.oldValue === null || typeof change.oldValue === 'string') || !(change.newValue === null || typeof change.newValue === 'string')) return;
    // Do not advance write baselines on incidental reads or notifications.
    // A stale editor must preserve/export input and reload before adoption.
    window.dispatchEvent(new StorageEvent('storage', { key:change.key,oldValue:change.oldValue,newValue:change.newValue,url:window.location.href }));
  });
}
