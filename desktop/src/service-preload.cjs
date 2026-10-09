'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// The service page can inspect its own connection and ask to open the bundled
// settings window. It cannot select a server, access files, or mutate settings.
contextBridge.exposeInMainWorld('qingdanDesktop', Object.freeze({
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
