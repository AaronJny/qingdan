import React,{useEffect,useRef,useState}from'react';
import{t as tr}from'../lib/i18n';
import{useLanguage}from'../lib/i18n-react';
import type{LocalRecoveryStatus}from'../lib/desktop-connection';

/** Imported legacy input is only a review candidate, never a confirmed task. */
export default function LocalRecoveryNotice(){
 useLanguage();
 const bridge=typeof window==='undefined'?undefined:window.qingdanDesktop;
 const supported=bridge?.localBusinessStorageRequired===true&&typeof bridge.getLocalRecovery==='function'&&typeof bridge.openLocalRecovery==='function';
 const[state,setState]=useState<LocalRecoveryStatus|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false);
 const alive=useRef(false),opening=useRef(false);
 useEffect(()=>{
  if(!supported)return;
  alive.current=true;let live=true,sequence=0;
  const refresh=()=>{const request=++sequence;void bridge!.getLocalRecovery!().then(next=>{if(live&&sequence===request){setState(next);setError(false)}}).catch(()=>{if(live&&sequence===request)setError(true)})};
  refresh();window.addEventListener('focus',refresh);window.addEventListener('qingdan-resume',refresh);
  return()=>{live=false;alive.current=false;window.removeEventListener('focus',refresh);window.removeEventListener('qingdan-resume',refresh)};
 },[bridge,supported]);
 if(!supported||(!error&&state?.status!=='pending'))return null;
 const open=async()=>{if(opening.current)return;opening.current=true;setBusy(true);setError(false);try{await bridge!.openLocalRecovery!()}catch{if(alive.current)setError(true)}finally{opening.current=false;if(alive.current)setBusy(false)}};
 return <aside className="pending-banner local-recovery-notice" role="status"><span>{error?tr('core.localRecoveryUnavailable'):state?.requiresReview?tr('core.localRecoveryInputPending'):tr('core.localRecoveryDataPending')}</span><button type="button" disabled={busy} onClick={()=>{void open()}}>{tr('core.localRecoveryReview')}</button></aside>;
}
