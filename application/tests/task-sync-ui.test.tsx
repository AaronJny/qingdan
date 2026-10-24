import{setLanguagePreference}from'../lib/i18n';setLanguagePreference('zh-CN');
import{test}from'node:test';import assert from'node:assert/strict';import{Window}from'happy-dom';
import type{AppRecord,Bootstrap}from'../lib/types';
const window:any=new Window({url:'https://task-sync.example.test/'}),g=globalThis as any;
for(const key of['window','document','navigator','location','history','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Event','CustomEvent','MouseEvent','KeyboardEvent','FocusEvent','MutationObserver','sessionStorage','localStorage'])Object.defineProperty(g,key,{value:window[key],configurable:true,writable:true});
g.IS_REACT_ACT_ENVIRONMENT=true;g.requestAnimationFrame=(fn:any)=>setTimeout(()=>fn(Date.now()),0);g.cancelAnimationFrame=clearTimeout;
window.HTMLElement.prototype.getClientRects=function(){return this.hidden?[]:[{width:100,height:30}]};
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),{default:Workspace}=await import('../app/workspace'),{localDate}=await import('../lib/types');
const settle=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,15))})};
function type(el:HTMLTextAreaElement,value:string){Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}))}
function click(el:Element|null){assert.ok(el);(el as HTMLElement).click()}
let counter=0;
async function fixture(mode:'accounts'|'local'='accounts'){
 localStorage.clear();sessionStorage.clear();const user={userId:'task-sync-fixture-'+(++counter),displayName:'合成用户',email:'fixture@example.test',mode};
 const state:Bootstrap={user,records:[{id:'inbox:'+user.userId,ownerId:user.userId,kind:'list',listId:null,data:{title:'收集箱'},revision:1,updatedAt:new Date().toISOString(),deleted:false,role:'owner'}],history:[],attachments:[],members:[],serverTime:new Date().toISOString()};
 let online=true,writes=0,verifications=0;const receipts=new Map<string,string>();
 g.fetch=async(path:string,init?:RequestInit)=>{
  if(!online)throw new TypeError('synthetic offline');
  if(path==='/api/auth/me'){verifications++;return Response.json({user,mode,csrfToken:'synthetic-csrf'})}
  if(path==='/api/reminders')return Response.json({alerts:[]});
  if(path==='/api/data'&&init?.method==='GET')return Response.json(state);
  if(path==='/api/data'&&init?.body){assert.equal(new Headers(init.headers).get('x-qingdan-expected-account'),user.userId);const body=JSON.parse(init.body as string);if(receipts.has(body.clientOperationId)){assert.equal(receipts.get(body.clientOperationId),JSON.stringify(body));return Response.json({replayed:true})}
   const existing=state.records.find(record=>record.id===body.id);if(body.expectedRevision!==(existing?.revision||0))return Response.json({error:'版本冲突'},{status:409});
   const record:AppRecord={id:body.id,kind:'task',ownerId:user.userId,listId:body.data?.listId||existing?.listId||null,data:body.operation==='upsert'?body.data:{...existing!.data,status:body.operation==='undoComplete'?'open':body.status,completedAt:'server-time',completionMutation:'synthetic-mutation'},revision:(existing?.revision||0)+1,deleted:false,updatedAt:new Date().toISOString(),role:'owner'};state.records=[record,...state.records.filter(r=>r.id!==record.id)];writes++;receipts.set(body.clientOperationId,JSON.stringify(body));return Response.json({record,records:[record]});
  }
  throw new Error('No unmocked calls: '+path);
 };
 const host=document.createElement('div');document.body.append(host);let root=createRoot(host);await act(async()=>root.render(<Workspace user={user}/>));await settle();
 return{host,state,user,writes:()=>writes,verifications:()=>verifications,offline:()=>{online=false},online:()=>{online=true},remount:async()=>{await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(<Workspace user={user}/>));await settle()},close:async()=>{await act(async()=>root.unmount());host.remove();window.happyDOM.abort()}};
}

test('account task add, edit and completion are optimistic, durable after remount, and sync automatically on reconnect',async()=>{
 const f=await fixture();try{
  f.offline();const input=f.host.querySelector<HTMLTextAreaElement>('.quick-add textarea')!;
  await act(async()=>type(input,'离线保留的新任务'));await act(async()=>click(f.host.querySelector('.quick-submit')));await settle();
  assert.equal(input.value,'');assert.match(f.host.querySelector('.task-row')?.textContent||'',/离线保留的新任务/);assert.equal(f.writes(),0);assert.match(f.host.querySelector('.account-task-sync')?.textContent||'',/已在此设备保存\s*1\s*条/);
  await act(async()=>click(f.host.querySelector('.task-body')));const title=f.host.querySelector<HTMLTextAreaElement>('.detail-title')!;await act(async()=>type(title,'离线编辑后的新任务'));await act(async()=>title.dispatchEvent(new window.FocusEvent('focusout',{bubbles:true})));await settle();assert.match(f.host.querySelector('.task-row')?.textContent||'',/离线编辑后的新任务/);
  await act(async()=>click(f.host.querySelector('.complete-check')));await settle();assert.match(f.host.querySelector('.account-task-sync')?.textContent||'',/已在此设备保存\s*3\s*条/);
  await f.remount();assert.match(f.host.querySelector('.account-task-sync')?.textContent||'',/已在此设备保存\s*3\s*条/);assert.equal(f.writes(),0);
  f.online();await act(async()=>window.dispatchEvent(new window.Event('online')));await settle();await settle();
  assert.equal(f.writes(),3);assert.equal(f.state.records.find(record=>record.kind==='task')?.data.title,'离线编辑后的新任务');assert.equal(f.host.querySelector('.account-task-sync'),null);assert.equal(f.state.records.find(record=>record.kind==='task')?.data.status,'done');assert.ok(f.verifications()>=1);
 }finally{await f.close()}
});

test('local mode never creates an account outbox or performs account replay verification',async()=>{
 const f=await fixture('local');try{const input=f.host.querySelector<HTMLTextAreaElement>('.quick-add textarea')!;await act(async()=>type(input,'本地模式任务'));await act(async()=>click(f.host.querySelector('.quick-submit')));await settle();assert.equal(f.writes(),1);assert.equal(f.verifications(),0);assert.equal(f.host.querySelector('.account-task-sync'),null);assert.ok(!Object.keys(localStorage).some(key=>key.startsWith('qingdan:task-outbox:')))}finally{await f.close()}
});

test('account switch hides old projected tasks while leaving their persisted partition intact',async()=>{
 const f=await fixture();try{f.offline();await act(async()=>type(f.host.querySelector<HTMLTextAreaElement>('.quick-add textarea')!,'原账号离线任务'));await act(async()=>click(f.host.querySelector('.quick-submit')));await settle();await act(async()=>window.dispatchEvent(new window.Event('qingdan-account-changed')));assert.match(f.host.textContent||'',/账号会话已变化/);assert.doesNotMatch(f.host.textContent||'',/原账号离线任务/);assert.ok(Object.keys(localStorage).some(key=>key.startsWith('qingdan:task-outbox:')&&localStorage.getItem(key)?.includes('原账号离线任务')));f.online();await act(async()=>window.dispatchEvent(new window.Event('online')));await settle();assert.equal(f.writes(),0)}finally{await f.close()}
});

test('quick entry surface focuses input while helper and controls stay separate',async()=>{
 const f=await fixture('local');try{
  const input=f.host.querySelector<HTMLTextAreaElement>('.quick-add textarea')!;
  const surface=f.host.querySelector<HTMLElement>('.quick-add-line')!;
  const help=f.host.querySelector<HTMLElement>('.quick-language-help')!;
  assert.ok(input.getAttribute('aria-label'));
  assert.equal(input.getAttribute('aria-describedby'),help.id);
  assert.equal(surface.contains(help),false,'language help is outside the input surface');
  assert.ok(surface.compareDocumentPosition(help)&4,'help follows the input, not above it');
  input.blur();await act(async()=>click(surface));assert.equal(document.activeElement,input);
  input.blur();await act(async()=>surface.querySelector('svg')!.dispatchEvent(new window.MouseEvent('click',{bubbles:true})));assert.equal(document.activeElement,input);
  await act(async()=>type(input,'明天 10:00 测试快速输入'));await settle();
  const date=f.host.querySelector<HTMLInputElement>('.quick-options input[type="date"]')!;
  date.focus();await act(async()=>click(date));assert.equal(document.activeElement,date);
  const priority=f.host.querySelector<HTMLSelectElement>('.quick-options select')!;
  priority.focus();await act(async()=>click(priority));assert.equal(document.activeElement,priority);
  const submit=surface.querySelector<HTMLButtonElement>('.quick-submit')!;
  assert.ok(submit.getAttribute('aria-label'));assert.equal(submit.disabled,false);
  await act(async()=>{input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))});await settle();
  assert.equal(f.writes(),0,'IME confirmation must not submit');
  await act(async()=>{input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true}))});await settle();
  assert.equal(f.writes(),0,'Shift+Enter must not submit');
  await act(async()=>click(submit));await settle();
  assert.equal(f.writes(),1,'submit button creates exactly one task');
  const task=f.state.records.find(r=>r.kind==='task')!;
  assert.equal(task.data.title,'测试快速输入');assert.ok(task.data.dueDate);
  assert.equal(input.value,'');
 }finally{await f.close()}
});
