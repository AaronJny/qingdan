'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('qingdanRecovery',Object.freeze({
  summary:()=>ipcRenderer.invoke('qingdan-recovery:summary'),
  candidates:(offset=0)=>ipcRenderer.invoke('qingdan-recovery:candidates',offset),
  export:()=>ipcRenderer.invoke('qingdan-recovery:export'),
  continue:()=>ipcRenderer.invoke('qingdan-recovery:continue'),
}));
