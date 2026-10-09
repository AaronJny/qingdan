'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('qingdanConnection', Object.freeze({
  get: () => ipcRenderer.invoke('qingdan-connection:get'),
  save: serverUrl => ipcRenderer.invoke('qingdan-connection:save', serverUrl),
}));
