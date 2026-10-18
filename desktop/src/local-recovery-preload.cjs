'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('qingdanRecovery',Object.freeze({
  onLanguageChanged:listener=>{
    if(typeof listener!=='function')throw new TypeError('A language listener is required');
    const receive=(_event,value)=>{
      const locales=['zh-CN','en','zh-TW','ja','ko','es','fr','de','pt-BR'];
      if(value&&['system',...locales].includes(value.preference)&&locales.includes(value.locale)&&Number.isSafeInteger(value.revision)&&value.revision>=0)listener({preference:value.preference,locale:value.locale,revision:value.revision});
    };
    ipcRenderer.on('qingdan-desktop:language-changed',receive);
    return()=>ipcRenderer.removeListener('qingdan-desktop:language-changed',receive);
  },
  summary:()=>ipcRenderer.invoke('qingdan-recovery:summary'),
  candidates:(offset=0)=>ipcRenderer.invoke('qingdan-recovery:candidates',offset),
  export:()=>ipcRenderer.invoke('qingdan-recovery:export'),
  continue:()=>ipcRenderer.invoke('qingdan-recovery:continue'),
}));
