import{setLanguagePreference}from'../lib/i18n';setLanguagePreference('zh-CN');
import{test}from'node:test';import assert from'node:assert/strict';import{Window}from'happy-dom';
import type{AppRecord,Bootstrap}from'../lib/types';
const window:any=new Window({url:'https://qingdan.test/'});const g=globalThis as any;
for(const key of ['window','document','navigator','location','history','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Event','CustomEvent','MouseEvent','KeyboardEvent','FocusEvent','MutationObserver','sessionStorage','localStorage'])Object.defineProperty(g,key,{value:(window as any)[key],configurable:true,writable:true});
g.requestAnimationFrame=(fn:FrameRequestCallback)=>setTimeout(()=>fn(Date.now()),0);g.cancelAnimationFrame=clearTimeout;g.IS_REACT_ACT_ENVIRONMENT=true;
// This DOM simulator has no layout engine. Rects represent visibility only, never visual QA.
(window.HTMLElement.prototype as any).getClientRects=function(){return this.hidden?[]:[{width:100,height:30}]};
const React=await import('react');const{createRoot}=await import('react-dom/client');const{act}=React;const{default:Workspace}=await import('../app/workspace');const{localDate}=await import('../lib/types');const{CHINESE_HOLIDAY_YEARS}=await import('../assets/chinese-calendar');const{draftStore}=await import('../lib/client-storage');
const user={userId:'ui-fixture',displayName:'UI测试',email:'fixture@example.test'};
function fixture(){const records:AppRecord[]=[{id:'inbox:'+user.userId,ownerId:user.userId,kind:'list',listId:null,data:{title:'收集箱',sections:[],color:'#4878e8'},revision:1,updatedAt:new Date().toISOString(),deleted:false,role:'owner'},{id:'task-ui',ownerId:user.userId,kind:'task',listId:'inbox:'+user.userId,data:{title:'明确定义的示例任务',description:'原始描述',status:'open',taskType:'task',listId:'inbox:'+user.userId,priority:2,dueDate:localDate(),checkItems:[{id:'a',title:'第一项',done:false},{id:'b',title:'第二项',done:false}],tags:[]},revision:1,updatedAt:new Date().toISOString(),deleted:false,role:'owner'}];return{records,history:[],attachments:[],members:[],user,serverTime:new Date().toISOString()}as Bootstrap;}
const settle=async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,5))})};
function type(el:HTMLInputElement|HTMLTextAreaElement,value:string){const proto=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));}
function click(el:Element|null){assert.ok(el);(el as HTMLElement).click();}
function btn(text:string){return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()===text)||null;}
function setupApi(state:Bootstrap,calls:any[]=[]){let holidaysEnabled=false;for(const key of Object.keys(localStorage))if(key.startsWith('qingdan:queue:')&&key.includes(':'+user.userId+':'))localStorage.removeItem(key);draftStore.removeItem('qingdan:draft:ui-fixture:task-ui');g.fetch=async(path:string,init?:RequestInit)=>{const body=init?.body?JSON.parse(init.body as string):undefined;if(body)calls.push(body);if(path==='/api/reminders')return Response.json({alerts:[]});if(path.includes('/api/calendar-sources')){if(body?.action==='holidays'){holidaysEnabled=!!body.enabled;return Response.json({sources:[],holidays:{enabled:holidaysEnabled,calendarYears:holidaysEnabled?Object.values(CHINESE_HOLIDAY_YEARS):[]}})}return Response.json({sources:[],events:[],holidays:{enabled:holidaysEnabled,calendarYears:holidaysEnabled?Object.values(CHINESE_HOLIDAY_YEARS):[]}})}if(path==='/api/data'&&!body)return Response.json(state);if(path==='/api/data'&&body?.operation==='upsert'){const existing=state.records.find(r=>r.id===body.id);if(existing&&body.expectedRevision!==existing.revision)return Response.json({error:'记录版本冲突'},{status:409});const record:AppRecord={id:body.id,ownerId:user.userId,kind:body.kind,listId:body.data.listId||null,data:body.data,revision:(existing?.revision||0)+1,updatedAt:new Date().toISOString(),deleted:!!body.deleted,role:'owner'};state.records=[record,...state.records.filter(r=>r.id!==record.id)];return Response.json({record,related:[]})}if(path==='/api/data'&&['complete','undoComplete'].includes(body?.operation)){const existing=state.records.find(r=>r.id===body.id)!;const record={...existing,revision:existing.revision+1,data:{...existing.data,status:body.operation==='undoComplete'?'open':body.status||'done',completionMutation:body.operation==='undoComplete'?'':'ui-mutation'}};state.records=state.records.map(r=>r.id===record.id?record:r);return Response.json({records:[record],record})}throw new Error('Test forbids unmocked network: '+path)};}


const {useLanguageRuntime}=await import('../lib/i18n-react');
function BilingualRoot(){useLanguageRuntime();return <Workspace user={user}/>;}
test('primary surfaces switch language live while preserving records and unsaved input',async()=>{
 const state=fixture();state.records[1].data.title='今天';state.records[1].data.description='任务';state.records[1].data.tags=['今天'];const calls:any[]=[];setupApi(state,calls);setLanguagePreference('en');const host=document.createElement('div');document.body.append(host);const root=createRoot(host as any);
 try{await act(async()=>root.render(<BilingualRoot/>));await settle();
 assert.equal(host.querySelector('.workspace-header h1')?.textContent,'Today');
 assert.match(host.querySelector('.task-title')?.textContent||'',/^今天$/);
 await act(async()=>type(host.querySelector<HTMLTextAreaElement>('.quick-add textarea')!,'未提交的中英文 draft'));
 await act(async()=>click(host.querySelector('.rail-bottom button[title="Settings"]')));
 assert.ok(host.querySelector('select[aria-label="Language"]'));
 const callsBeforeLanguage=calls.length;const language=host.querySelector<HTMLSelectElement>('select[aria-label="Language"]')!;
 await act(async()=>{language.value='zh-CN';language.dispatchEvent(new window.Event('change',{bubbles:true}))});
 assert.ok(host.querySelector('select[aria-label="语言"]'));
 assert.equal(calls.length,callsBeforeLanguage,'language choice must never write user settings to the server');
 await act(async()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 await act(async()=>setLanguagePreference('zh-CN'));await settle();
 assert.equal(host.querySelector('.workspace-header h1')?.textContent,'今天');
 assert.equal(host.querySelector<HTMLTextAreaElement>('.quick-add textarea')?.value,'未提交的中英文 draft');
 assert.equal(state.records[0].data.title,'收集箱');assert.equal(state.records[1].data.description,'任务');assert.deepEqual(state.records[1].data.tags,['今天']);assert.equal(state.records[1].data.title,'今天');
 await act(async()=>setLanguagePreference('en'));await settle();
 assert.equal(host.querySelector('.workspace-header h1')?.textContent,'Today');
 await act(async()=>click(host.querySelector('.task-body')));
 const title=host.querySelector<HTMLTextAreaElement>('[aria-label="Task title"]')!;
 await act(async()=>type(title,'今天: unsaved title'));
 await act(async()=>setLanguagePreference('zh-CN'));await settle();
 assert.equal(host.querySelector<HTMLTextAreaElement>('[aria-label="任务标题"]')?.value,'今天: unsaved title');
 assert.equal(state.records[1].data.title,'今天');
 await act(async()=>setLanguagePreference('en'));await settle();
 assert.equal(host.querySelector<HTMLTextAreaElement>('[aria-label="Task title"]')?.value,'今天: unsaved title');
 await act(async()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 await act(async()=>click(host.querySelector('button[aria-label="Calendar"]')));await settle();
 assert.match(host.querySelector('.calendar-controls h2')?.textContent||'',/[A-Za-z]/);
 assert.match(host.querySelector('.weekday-head')?.textContent||'',/Mon/);
 await act(async()=>click(host.querySelector('button[aria-label="Statistics"]')));await settle();
 assert.match(host.querySelector('.stats-wrapper')?.textContent||'',/Last 7 days/);
 }finally{await act(async()=>root.unmount());host.remove();window.happyDOM.abort();}
});

test('visible calendar focus overlays retranslate with stable records when language changes',async()=>{
 const {CalendarView}=await import('../app/workspace-views');
 const state=fixture();const day=localDate();
 const focus:AppRecord={...state.records[1],id:'finished-focus-localization',kind:'focus',listId:null,data:{seconds:60,focusStatus:'finished',mode:'pomodoro',startedAt:day+'T12:00:00Z',endedAt:day+'T12:01:00Z'}};
 const records=[state.records[0],focus];const tasks:AppRecord[]=[];const lists=[state.records[0]];const preferences={timezone:'Etc/UTC'};
 const actions={notify:()=>{},open:()=>{},refresh:async()=>{},save:async(r:AppRecord)=>r,create:async()=>focus,navigate:()=>{},complete:async()=>{},incrementHabit:async()=>{},comment:async()=>{},skip:async()=>{}};
 setupApi(state);setLanguagePreference('zh-CN');
 function CalendarRoot(){useLanguageRuntime();return <CalendarView userId={user.userId} records={records} tasks={tasks} lists={lists} preferences={preferences} actions={actions}/>;}
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host as any);
 try{await act(async()=>root.render(<CalendarRoot/>));await settle();
 const focusToggle=Array.from(host.querySelectorAll('.calendar-layer-menu label')).find(label=>label.textContent==='专注记录')?.querySelector('input')||null;
 await act(async()=>click(focusToggle));
 assert.match(host.querySelector('.calendar-event')?.textContent||'',/◷ 1分钟 专注/);
 await act(async()=>setLanguagePreference('en'));await settle();
 assert.match(host.querySelector('.calendar-event')?.textContent||'',/◷ 1 minute Focus/);
 assert.doesNotMatch(host.querySelector('.calendar-event')?.textContent||'',/分钟|专注/);
 await act(async()=>setLanguagePreference('zh-CN'));await settle();
 assert.match(host.querySelector('.calendar-event')?.textContent||'',/◷ 1分钟 专注/);
 assert.equal(focus.data.title,undefined,'overlay localization must not write a synthetic title into the stored session');
 }finally{await act(async()=>root.unmount());host.remove();window.happyDOM.abort();}
});

test('primary count messages select complete singular and plural sentences for zero, one and two',async()=>{
 const {t,formatNumber}=await import('../lib/i18n');setLanguagePreference('en');
 for(const count of [0,1,2]){
  const amount=formatNumber(count),params={count,amount,value0:amount,shown:amount,total:amount,error:'test error'};
  const suffix=count===1?'':'s';
  assert.equal(t('workspace.addedValueTasks',params),`Added ${amount} task${suffix}`);
  assert.equal(t('workspace.importCompleteValueRecords',params),`Import complete: ${amount} record${suffix}.`);
  assert.equal(t('workspace.loadedValueRecordsLoadingMore',params),`Loaded ${amount} record${suffix}. Loading more…`);
  assert.equal(t('workspace.createdValueTasksAndSubtasks',params),count===1?'Created 1 task':`Created ${amount} tasks and subtasks`);
  assert.equal(t('workspace.exportIncludesValueFormatNotices',params),`Export includes ${amount} format notice${suffix}`);
  assert.equal(t('workspace.showingValueOfValueRows',params),`Showing ${amount} of ${amount} row${suffix}`);
  assert.equal(t('workspace.processedValueTasksBatchChangesAreSavedIndividually',params),`Processed ${amount} task${suffix}. Batch changes are saved individually and can be restored separately.`);
  assert.equal(t('workspace.processedValueItemsRemainingSelectionsAndInputAre',params),`Processed ${amount} item${suffix}. Remaining selections and input are preserved: test error`);
  assert.equal(t('workspace.valueChangesAreUnconfirmedOrHaveConflictsYour',params),count===1?'1 change is unconfirmed or has conflicts. Your input is preserved.':`${amount} changes are unconfirmed or have conflicts. Your input is preserved.`);
  assert.equal(t('workspace.valueSavesAreUnconfirmedTheOriginalOperationIds',params),count===1?'1 save is unconfirmed. The original operation ID is preserved.':`${amount} saves are unconfirmed. The original operation IDs are preserved.`);
 }
 assert.equal(t('workspace.loadedValueRecordsLoadingMore',{count:1234,amount:formatNumber(1234)}),'Loaded 1,234 records. Loading more…');
 setLanguagePreference('zh-CN');
 assert.equal(t('workspace.loadedValueRecordsLoadingMore',{count:1,amount:formatNumber(1)}),'已载入 1 条记录，继续读取…');
});
