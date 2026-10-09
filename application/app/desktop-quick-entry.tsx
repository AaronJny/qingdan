'use client';
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
  const text=draft.trim();if(saving.current||!text)return;if(!inboxId){setError('收集箱尚未加载，请先恢复连接。草稿已保留。');return;}
  const lines=text.split('\n').filter(line=>line.trim()),submittedEdit=edit.current;let saved=0;saving.current=true;setBusy(true);setError('');
  try{for(const line of lines){const parsed=parseChineseTask(line,{today,timeZone});await create('task',{title:parsed.title||line,description:parsed.unsupported.length?parsed.unsupported.join('；'):'',status:'open',taskType:'task',listId:inboxId,priority:parsed.priority||0,dueDate:parsed.due?.date||'',dueTime:parsed.due?.time||'',tags:parsed.tags||[],order:Date.now(),checkItems:[],comments:[]});saved++;}
   if(edit.current===submittedEdit){setDraft('');close();}else setError('已保存刚才提交的内容，新的输入仍保留。');
  }catch(e){if(edit.current===submittedEdit)setDraft(lines.slice(saved).join('\n'));setError((e as Error).message||'保存尚未确认，草稿已保留。');}
  finally{saving.current=false;setBusy(false)}
 };
 if(!open)return null;
 return <div className="modal-backdrop desktop-quick-backdrop" style={{zIndex:150}}><section className="modal desktop-quick-entry" aria-label="快速新增任务" style={{width:560,maxWidth:'100%'}}>
  <div className="modal-title"><h2>快速新增任务</h2><button className="icon-button" aria-label="关闭" disabled={busy} onClick={close}><X size={18}/></button></div>
  <label>任务内容<textarea ref={input} autoFocus rows={3} aria-label="快捷任务内容" placeholder="明天 10:00 读书 #阅读 !1" value={draft} disabled={busy} onChange={e=>{edit.current++;setDraft(e.target.value)}} onCompositionStart={()=>composing.current=true} onCompositionEnd={()=>composing.current=false} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&!composing.current){e.preventDefault();void save()}}}/></label>
  <p className="form-help">保存到当前账号的收集箱。Enter 保存，Shift + Enter 分行添加。关闭会保留草稿。</p>
  {error&&<p className="inline-error" role="alert">{error}</p>}
  <div className="modal-actions"><button className="subtle-button" disabled={busy} onClick={close}>稍后继续</button><button className="primary" disabled={busy||!draft.trim()||!inboxId} onClick={()=>void save()}>{busy?'正在保存…':'保存任务'}</button></div>
 </section></div>;
}
