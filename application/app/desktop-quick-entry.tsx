'use client';
import {t as tr, translateError} from '../lib/i18n';

import React,{useEffect,useRef,useState}from'react';
import{X}from'lucide-react';
import{useDraftInput}from'@/lib/use-draft-input';
import type{AppRecord,Kind,RecordData}from'@/lib/types';
import{parseChineseTask}from'@/assets/recurrence';
type Props={open:boolean;accountId:string;inboxId?:string;today:string;timeZone:string;create:(kind:Kind,data:RecordData)=>Promise<AppRecord>;close:()=>void};
export default function DesktopQuickEntry({open,accountId,inboxId,today,timeZone,create,close}:Props){
 const [draft,setDraft]=useDraftInput('qingdan:desktop-quick-draft:'+encodeURIComponent(accountId));
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const input=useRef<HTMLTextAreaElement>(null),saving=useRef(false),composing=useRef(false),edit=useRef(0);
 useEffect(()=>{if(open){setError('');requestAnimationFrame(()=>input.current?.focus())}},[open]);
 const save=async()=>{
  const text=draft.trim();if(saving.current||!text)return;if(!inboxId){setError(tr("ui.secondary.desktopQuickEntry.theInboxHasNotLoadedRestoreThe"));return;}
  const lines=text.split('\n').filter(line=>line.trim()),submittedEdit=edit.current;let saved=0;saving.current=true;setBusy(true);setError('');
  try{for(const line of lines){const parsed=parseChineseTask(line,{today,timeZone});await create('task',{title:parsed.title||line,description:parsed.unsupported.length?parsed.unsupported.join('；'):'',status:'open',taskType:'task',listId:inboxId,priority:parsed.priority||0,dueDate:parsed.due?.date||'',dueTime:parsed.due?.time||'',tags:parsed.tags||[],order:Date.now(),checkItems:[],comments:[]});saved++;}
   if(edit.current===submittedEdit){setDraft('');close();}else setError(tr("ui.secondary.desktopQuickEntry.yourSubmittedContentWasSavedNewerInput"));
  }catch(e){if(edit.current===submittedEdit)setDraft(lines.slice(saved).join('\n'));setError(translateError((e as Error).message)||tr("ui.secondary.desktopQuickEntry.savingIsNotYetConfirmedYourDraft"));}
  finally{saving.current=false;setBusy(false)}
 };
 if(!open)return null;
 return <div className="modal-backdrop desktop-quick-backdrop" style={{zIndex:150}}><section className="modal desktop-quick-entry" aria-label={tr("ui.secondary.desktopQuickEntry.quickAddTask")} style={{width:560,maxWidth:'100%'}}>
  <div className="modal-title"><h2>{tr("ui.secondary.desktopQuickEntry.quickAddTask")}</h2><button className="icon-button" aria-label={tr("ui.secondary.calendarSources.close")} disabled={busy} onClick={close}><X size={18}/></button></div>
  <label>{tr("ui.secondary.desktopQuickEntry.taskContent")}<textarea ref={input} autoFocus rows={3} aria-label={tr("ui.secondary.desktopQuickEntry.quickTaskContent")} placeholder={tr("ui.secondary.desktopQuickEntry.tomorrowReadReading")} value={draft} disabled={busy} onChange={e=>{edit.current++;setDraft(e.target.value)}} onCompositionStart={()=>composing.current=true} onCompositionEnd={()=>composing.current=false} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&!composing.current){e.preventDefault();void save()}}}/></label>
  <p className="form-help">{tr("ui.secondary.desktopQuickEntry.savedToTheCurrentAccountSInbox")}</p><p className="form-help">{tr("quickInput.supportedLanguages")}</p>
  {error&&<p className="inline-error" role="alert">{translateError(error)}</p>}
  <div className="modal-actions"><button className="subtle-button" disabled={busy} onClick={close}>{tr("ui.secondary.desktopQuickEntry.continueLater")}</button><button className="primary" disabled={busy||!draft.trim()||!inboxId} onClick={()=>void save()}>{busy?tr("ui.secondary.desktopQuickEntry.saving"):tr("ui.secondary.desktopQuickEntry.saveTask")}</button></div>
 </section></div>;
}
