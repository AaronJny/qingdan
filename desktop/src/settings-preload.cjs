'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('qingdanConnection', Object.freeze({
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
  get: () => ipcRenderer.invoke('qingdan-connection:get'),
  save: serverUrl => ipcRenderer.invoke('qingdan-connection:save', serverUrl),
}));
