import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';

const window: any = new Window({url:'https://qingdan.test/'});
const global = globalThis as any;
for (const key of ['window','document','navigator','location','HTMLElement','HTMLInputElement','Event','CustomEvent','localStorage','sessionStorage']) {
  Object.defineProperty(global,key,{value:window[key],configurable:true,writable:true});
}
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const {act,useSyncExternalStore} = React;
const {createRoot} = await import('react-dom/client');
const {renderToStaticMarkup} = await import('react-dom/server');
const {setLanguagePreference,subscribeLanguage,languageSnapshot,t,plural} = await import('../lib/i18n');
const {default:HabitEditor} = await import('../app/habit-editor');
const {default:CommentComposer} = await import('../app/comment-composer');
const {default:ActivityView} = await import('../app/activity-view');
const {default:TaskAttachments} = await import('../app/task-attachments');
const {draftStore} = await import('../lib/client-storage');
const {formDraftKey} = await import('../lib/form-drafts');

const actions:any = {notify(){},save:async()=>{},create:async()=>{},refresh:async()=>{}};
const record:any = {id:'preserved-habit',ownerId:'owner',kind:'habit',revision:1,createdAt:'2026-10-01T12:00:00Z',updatedAt:'2026-10-01T12:00:00Z',deleted:false,data:{title:'我的阅读 Reading',unit:'本',habitGroup:'个人',target:2,weekdays:[1,3,5],habitPeriod:'day'}};
function LanguageProbe(){
  useSyncExternalStore(subscribeLanguage,languageSnapshot,languageSnapshot);
  return <HabitEditor userId="owner" record={record} groups={['个人']} actions={actions} onClose={()=>{}}/>;
}

test('secondary editor switches labels and weekdays live without changing existing record data or dirty drafts',async()=>{
  setLanguagePreference('zh-CN');
  const before=JSON.stringify(record),host=document.createElement('div');document.body.append(host);
  const root=createRoot(host),key=formDraftKey('owner','habit',record.id);
  draftStore.removeItem(key);
  try {
    await act(async()=>root.render(<LanguageProbe/>));
    assert.ok(host.querySelector('[aria-label="习惯名称"]'));
    const title=host.querySelector('input[aria-label="习惯名称"]') as HTMLInputElement;
    await act(async()=>{
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(title,'尚未保存 Unsubmitted');
      title.dispatchEvent(new window.Event('input',{bubbles:true}));
    });
    const draft=draftStore.getItem(key);
    assert.ok(draft,'dirty input has a saved recovery draft');
    await act(async()=>setLanguagePreference('en'));
    assert.equal(host.querySelector<HTMLInputElement>('[aria-label="Habit name"]')?.value,'尚未保存 Unsubmitted');
    assert.equal(host.querySelector('.weekday-picker button')?.textContent,'Sun');
    assert.match(host.textContent||'',/Edit habit/);
    assert.ok(Array.from(host.querySelectorAll('input')).some(input=>input.value==='本'));
    assert.equal(draftStore.getItem(key),draft,'language switching must not rewrite the draft');
    assert.equal(JSON.stringify(record),before,'language switching must not mutate record data');
    await act(async()=>setLanguagePreference('zh-CN'));
    assert.equal(host.querySelector<HTMLInputElement>('[aria-label="习惯名称"]')?.value,'尚未保存 Unsubmitted');
  } finally { await act(async()=>root.unmount());host.remove();draftStore.removeItem(key);window.happyDOM.abort(); }
});

test('localized secondary empty states and attachment labels preserve user titles and filenames',()=>{
  setLanguagePreference('en');
  const empty=renderToStaticMarkup(<ActivityView items={[]} onOpen={()=>{}} onReadAll={async()=>{}}/>);
  assert.match(empty,/No activity/);
  const html=renderToStaticMarkup(<TaskAttachments userId="owner" recordId="task" sourceIds={['task']} editable={false} attachments={[{id:'file',recordId:'task',name:'中文文件 我的报告.txt',size:1536,mime:'text/plain',createdAt:'2026-10-01T00:00:00Z'}]} onRefresh={async()=>{}} onNotify={()=>{}}/>);
  assert.match(html,/Attachments/);
  assert.match(html,/中文文件 我的报告.txt/);
  assert.match(html,/1.5.*KB/);
});

test('secondary complete-message plural forms cover zero, one and two',()=>{
  const cases = [
    ['ui.secondary.accountTaskSync.savedOnThisDevicePendingTaskOperations','pending task operation','pending task operations'],
    ['ui.secondary.calendarBatch.pendingSelectionCount','task','tasks'],
    ['ui.secondary.calendarEditor.scheduleRangeSummary','minute','minutes'],
    ['ui.secondary.calendarSources.lastSuccessfulRefresh','expanded event','expanded events'],
    ['ui.secondary.commentComposer.selectedMemberCount','member','members'],
    ['ui.secondary.countdownBackground.unconfirmed','byte','bytes'],
    ['ui.secondary.countdownEditor.keepExisting','offset','offsets'],
    ['ui.secondary.habitGroupManager.confirmedYouCanNowSaveTheGroup','rename','renames'],
    ['ui.secondary.listTransfer.completedTransferSummary','task','tasks'],
    ['ui.secondary.taskAttachments.unconfirmedTheOriginalFileIsRetainedOnly','byte','bytes'],
  ] as const;
  for(const count of [0,1,2]){
    setLanguagePreference('en');
    for(const[key,one,other]of cases){
      const text=t(key,{count,v0:count,v1:key==='ui.secondary.accountTaskSync.savedOnThisDevicePendingTaskOperations'?'':count,v2:count,v3:count,v4:count});
      assert.match(text,new RegExp(`\\b${count} ${count===1?one:other}\\b`),key);
      if(count===1)assert.doesNotMatch(text,new RegExp(`\\b1 ${other}\\b`),key);
      assert.doesNotMatch(text,/\{[^}]+\}|ui\.secondary\./,key);
    }
    const missing=t('ui.secondary.commentComposer.previouslySelectedMembersAreNoLongerIn',{count,v0:count});
    assert.equal(missing,`${count} previously selected ${count===1?'member is':'members are'} no longer in this list. Your selection is retained.`);
    setLanguagePreference('zh-CN');
    assert.equal(t('ui.secondary.commentComposer.previouslySelectedMembersAreNoLongerIn',{count,v0:count}),`${count}位原选择成员当前不在此清单，原选择保留。`);
    assert.equal(t('ui.secondary.commentComposer.selectedMemberCount',{count,v0:count}),` · ${count} 人`);
  }
});

test('multi-count backup and merge summaries pluralize each quantity independently',()=>{
  setLanguagePreference('en');
  for(const count of [0,1,2]){
    const records=plural(count,"record");
    const history=plural(count,"historyEntry");
    const attachments=plural(count,"attachment");
    const checks=plural(count,"checklistItem");
    const exported=t('ui.secondary.fullBackupPanel.fullPackageSentToTheBrowserFor',{v0:records,v1:history,v2:attachments});
    assert.ok(exported.includes(`${count} ${count===1?'record':'records'} / ${count} ${count===1?'history entry':'history entries'} / ${count} ${count===1?'attachment':'attachments'}.`));
    const merged=t('ui.secondary.mergeDialog.affectedRecordsAndChecklistItems',{v0:records,v1:checks});
    assert.equal(merged,`Affects ${count} ${count===1?'record':'records'} · ${count} ${count===1?'checklist item':'checklist items'}`);
  }
});

test('comment composer passes a real count for unavailable and selected members without editing mention drafts',async()=>{
  const state:any={user:{userId:'plural-owner',displayName:'Owner'},members:[]};
  const task:any={...record,id:'plural-task',ownerId:state.user.userId,listId:'list',kind:'task'};
  const key='qingdan:comment-mentions:'+state.user.userId+':'+task.id;
  for(const count of [0,1,2]){
    const draft=JSON.stringify(Array.from({length:count},(_,i)=>'missing-'+i));
    draftStore.setItem(key,draft);setLanguagePreference('en');
    const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
    try{
      await act(async()=>root.render(<CommentComposer record={task} state={state} actions={actions}/>));
      const text=host.textContent||'';
      if(count){
        assert.ok(text.includes(`${count} previously selected ${count===1?'member is':'members are'} no longer in this list.`));
        assert.ok(host.querySelector('summary')?.textContent?.includes(` · ${count} ${count===1?'member':'members'}`));
      }else assert.doesNotMatch(text,/previously selected/);
      assert.equal(draftStore.getItem(key),draft);
    }finally{await act(async()=>root.unmount());host.remove();draftStore.removeItem(key);window.happyDOM.abort();}
  }
});
