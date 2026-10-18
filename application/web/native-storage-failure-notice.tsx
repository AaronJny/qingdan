import React,{useState,useSyncExternalStore}from'react';
import{t as tr}from'../lib/i18n';
import{useLanguage}from'../lib/i18n-react';
import{exportNativeUnsavedInput,nativeStorageFailureVersion,subscribeNativeStorageFailure}from'../lib/business-storage';
import{download}from'../lib/client';

export default function NativeStorageFailureNotice(){
 useLanguage();
 const version=useSyncExternalStore(subscribeNativeStorageFailure,nativeStorageFailureVersion,()=>0);
 const[exportState,setExportState]=useState<'idle'|'requested'|'failed'>('idle');
 if(!version)return null;
 const exportInput=()=>{try{download('qingdan-unsaved-input-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',JSON.stringify(exportNativeUnsavedInput(),null,2));setExportState('requested')}catch{setExportState('failed')}};
 return <aside className="error-banner native-storage-failure-notice" role="alert"><div><p>{tr('core.localStorageFailureWarning')}</p>{exportState==='requested'&&<p role="status">{tr('core.localStorageExportRequested')}</p>}{exportState==='failed'&&<p>{tr('core.localStorageExportFailed')}</p>}</div><button type="button" className="subtle-button" onClick={exportInput}>{tr('core.localStorageExportUnsaved')}</button></aside>;
}
