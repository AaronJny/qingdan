'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// The service page can inspect its own connection and ask to open the bundled
// settings window and update the validated interface-language preference. It
// cannot select a server, access files, or mutate other settings.
contextBridge.exposeInMainWorld('qingdanDesktop', Object.freeze({
  getLanguage: () => ipcRenderer.invoke('qingdan-desktop:get-language'),
  setLanguagePreference: preference => {
    if (!['system', 'zh-CN', 'en'].includes(preference)) return Promise.reject(new TypeError('Invalid language preference'));
    return ipcRenderer.invoke('qingdan-desktop:set-language', preference);
  },
  onLanguageChanged: listener => {
    if (typeof listener !== 'function') throw new TypeError('A language listener is required');
    const receive = (_event, value) => {
      if (value && ['system', 'zh-CN', 'en'].includes(value.preference) && ['zh-CN', 'en'].includes(value.locale) && Number.isSafeInteger(value.revision) && value.revision >= 0) listener({ preference: value.preference, locale: value.locale, revision: value.revision });
    };
    ipcRenderer.on('qingdan-desktop:language-changed', receive);
    return () => ipcRenderer.removeListener('qingdan-desktop:language-changed', receive);
  },
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
