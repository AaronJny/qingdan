import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {businessStorage,usesNativeBusinessStorage,nativeStorageWritesBlocked,exportNativeUnsavedInput,NATIVE_STORAGE_BLOCKED_MESSAGE,type NativeBusinessStorage} from './business-storage';
import {draftStore} from './client-storage';
import {PendingStore} from './pending-store';
import {AccountTaskQueue,TaskQueueStore} from './account-task-queue';
import {browserCacheBackend,WorkspaceCache} from './workspace-cache';
import {confirmOfflineSession,invalidateOfflineSession,isOfflineBlocked,nativeOfflineSessionKey,offlineOptKey,readOfflineOpt,setOfflineOpt,shellSessionBackend,suspendNativeOfflineSession,validOfflineSession} from './offline-session';
import {languageStorageAvailable,setLanguagePreference} from './i18n';

function storage(){const data=new Map<string,string>();return{data,get length(){return data.size},key:(i:number)=>[...data.keys()][i]??null,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)},removeItem:(key:string)=>{data.delete(key)}}}
function nativeFixture(){
 const saved=new Map<string,PropertyDescriptor|undefined>();
 const replace=(key:string,descriptor:PropertyDescriptor)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,...descriptor})};
 const disk=storage();let failure='',browserCalls=0,indexedDBCalls=0,warnings=0;
 const check=(method:string)=>{if(failure===method)throw new Error('Synthetic native '+method+' failure')};
 const bridge:NativeBusinessStorage=Object.freeze({getItem(key:string){check('get');return disk.getItem(key)},setItem(key:string,value:string){check('set');disk.setItem(key,value)},removeItem(key:string){check('remove');disk.removeItem(key)},keys(){check('keys');return[...disk.data.keys()]}});
 const win=Object.assign(new EventTarget(),{qingdanDesktop:{localBusinessStorageRequired:true},qingdanLocalStorage:bridge,navigator:{languages:['en']}});
 Object.defineProperty(win,'localStorage',{get(){browserCalls++;throw new Error('Native must not use Chromium localStorage')}});
 win.addEventListener('qingdan-draft-volatile',()=>{warnings++});
 replace('window',{value:win});
 for(const key of ['localStorage','sessionStorage'])replace(key,{get(){browserCalls++;throw new Error('Native must not use Chromium '+key)}});
 replace('indexedDB',{get(){indexedDBCalls++;throw new Error('Native must not use Chromium IndexedDB')}});
 return {disk,win,fail:(value:string)=>{failure=value},warnings:()=>warnings,browserCalls:()=>browserCalls,indexedDBCalls:()=>indexedDBCalls,
  close(){for(const[key,descriptor]of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key)}};
}
const boot=(userId:string)=>({user:{userId,displayName:'Synthetic local user',email:'local@example.test',mode:'local'},records:[],history:[],members:[],attachments:[],serverTime:'2026-10-18T09:00:00Z'} as any);

test('native adapter reads synchronously and acknowledges only successful bridge writes/removals',()=>{
 const f=nativeFixture();try{const store=businessStorage();assert.equal(usesNativeBusinessStorage(),true);f.disk.setItem('qingdan:quick-draft:local:test','Restored');assert.equal(store.getItem('qingdan:quick-draft:local:test'),'Restored');assert.equal(store.length,1);assert.equal(store.key(0),'qingdan:quick-draft:local:test');store.setItem('qingdan-language','en');assert.equal(f.disk.getItem('qingdan-language'),'en');f.fail('set');assert.throws(()=>store.setItem('qingdan-language','zh-CN'),/native set failure/);assert.equal(f.disk.getItem('qingdan-language'),'en');f.fail('remove');assert.throws(()=>store.removeItem('qingdan-language'),/native remove failure/);f.fail('get');assert.throws(()=>store.getItem('qingdan-language'),/native get failure/);f.fail('keys');assert.throws(()=>store.length,/native keys failure/);f.fail('');store.removeItem('qingdan-language');assert.equal(f.disk.getItem('qingdan-language'),null);assert.equal(f.browserCalls(),0)}finally{f.close()}
});

test('required missing or malformed native bridge never falls back to Chromium',()=>{
 const f=nativeFixture();try{for(const bridge of [undefined,{},null]){(f.win as any).qingdanLocalStorage=bridge;assert.throws(()=>businessStorage().getItem('qingdan-language'),/bridge unavailable/)}assert.equal(f.browserCalls(),0)}finally{f.close()}
});

test('web, Android and remote desktop retain their existing browser storage',()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'window');try{for(const platform of ['web','android','remote']){const browser=storage();Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:browser,...(platform==='remote'?{qingdanDesktop:{localBusinessStorageRequired:false}}:{})}});assert.equal(usesNativeBusinessStorage(),false);assert.equal(businessStorage(),browser);businessStorage().setItem('qingdan-language','en');assert.equal(browser.getItem('qingdan-language'),'en')}}finally{if(old)Object.defineProperty(globalThis,'window',old);else Reflect.deleteProperty(globalThis,'window')}
});

test('durable native drafts do not shadow later changes; failed writes retain volatile input and warn',()=>{
 const f=nativeFixture(),key='qingdan:quick-draft:native-input-test';try{assert.equal(draftStore.setItem(key,'First'),true);f.disk.setItem(key,'Other window');assert.equal(draftStore.getItem(key),'Other window');f.fail('set');assert.equal(draftStore.setItem(key,'Unsaved input'),false);assert.equal(f.disk.getItem(key),'Other window');assert.equal(draftStore.getItem(key),'Unsaved input');assert.equal(f.warnings(),1);f.fail('');assert.equal(draftStore.setItem(key,'Retry'),false);assert.equal(f.disk.getItem(key),'Other window');f.disk.setItem(key,'Latest durable version');assert.equal(draftStore.getItem(key),'Retry');assert.deepEqual(draftStore.keys('qingdan:quick-draft:native-input-test'),[key]);assert.equal(draftStore.removeItem(key),false);assert.equal(draftStore.getItem(key),null);assert.equal(exportNativeUnsavedInput().failedWrites.find(entry=>entry.key===key&&entry.operation==='set')?.value,'Retry');assert.equal(f.browserCalls(),0)}finally{f.fail('');draftStore.removeItem(key);f.close()}
});

test('native pending queues restore operation bytes and report failed persistence',()=>{
 const f=nativeFixture();try{const queue=new PendingStore('write','local:test',businessStorage());assert.equal(queue.save([{id:'one',text:'Original'}]),true);assert.deepEqual(new PendingStore('write','local:test',businessStorage()).load(),[{id:'one',text:'Original'}]);f.fail('set');assert.equal(queue.save([{id:'one',text:'Volatile'}]),false);assert.deepEqual(queue.load(),[{id:'one',text:'Volatile'}]);assert.deepEqual(new PendingStore('write','local:test',businessStorage()).load(),[{id:'one',text:'Original'}]);f.fail('keys');queue.load();assert.ok(f.warnings()>0);assert.equal(f.browserCalls(),0)}finally{f.close()}
});

test('TaskQueue durable storage failure rejects enqueue before projection or network submission',()=>{
 const f=nativeFixture();let changed=0,requested=0;try{const store=new TaskQueueStore('https://example.test','synthetic',businessStorage());const queue=new AccountTaskQueue(store,{active:()=>true,verify:async()=>{},snapshot:async()=>boot('synthetic'),request:async()=>{requested++},change:()=>{changed++},confirmed:()=>{}});const task:any={id:'task',ownerId:'synthetic',kind:'task',data:{title:'Original'},revision:1,updatedAt:'',deleted:false,role:'owner'};f.fail('set');assert.throws(()=>queue.enqueue('edit',task,{title:'Unconfirmed'},false,[task]),/无法持久/);assert.equal(changed,0);assert.equal(requested,0);assert.equal(f.disk.length,0);assert.equal(f.browserCalls(),0)}finally{f.close()}
});

test('native snapshots bypass IndexedDB and return failure for unacknowledged writes or removals',async()=>{
 const f=nativeFixture();try{const cache=new WorkspaceCache('native-cache',browserCacheBackend());assert.equal(await cache.save(boot('native-cache')),true);const reopened=new WorkspaceCache('native-cache',browserCacheBackend());assert.equal((await reopened.load())?.data.serverTime,'2026-10-18T09:00:00Z');assert.ok(f.disk.getItem(cache.key));f.fail('set');assert.equal(await cache.save(boot('native-cache')),false);f.fail('remove');assert.equal(await cache.clear(),false);f.fail('get');assert.equal(await reopened.load(),null);f.fail('');assert.equal(await cache.clear(),true);assert.equal(await reopened.load(),null);assert.equal(f.indexedDBCalls(),0);assert.equal(f.browserCalls(),0)}finally{f.close()}
});

test('native offline session retains confirmation metadata and requires fresh online reconfirmation',async()=>{
 const f=nativeFixture(),data=boot('native-offline');try{assert.equal(setOfflineOpt(data.user.userId,true),true);assert.equal(await confirmOfflineSession(data),true);const first=await shellSessionBackend().get();assert.equal(first?.confirmedAt,data.serverTime);assert.equal(validOfflineSession(first),true);assert.equal(suspendNativeOfflineSession(),true);const suspended=await shellSessionBackend().get();assert.equal(suspended?.confirmedAt,data.serverTime);assert.equal(suspended?.active,false);assert.equal(suspended?.reason,'online-navigation-awaiting-account-confirmation');assert.equal(readOfflineOpt(data.user.userId),true);assert.equal(await confirmOfflineSession(data),true);assert.equal(validOfflineSession(await shellSessionBackend().get()),true);await invalidateOfflineSession('server-denied',data.user.userId);assert.equal(readOfflineOpt(data.user.userId),false);assert.equal((await shellSessionBackend().get())?.active,false);assert.equal(JSON.parse(f.disk.getItem(nativeOfflineSessionKey)!).confirmedAt,data.serverTime);assert.equal(f.indexedDBCalls(),0);assert.equal(f.browserCalls(),0)}finally{f.close()}
});

test('native offline and language preferences never claim persistence after an error',async()=>{
 const f=nativeFixture(),id='native-failure';try{f.disk.setItem(offlineOptKey(id),'enabled');f.fail('set');assert.equal(setOfflineOpt(id,false),false);assert.equal(await confirmOfflineSession(boot(id)),false);assert.equal(f.disk.getItem(nativeOfflineSessionKey),null);setLanguagePreference('en');assert.equal(languageStorageAvailable(),false);assert.equal(f.disk.getItem('qingdan-language'),null);f.fail('');setLanguagePreference('en');assert.equal(languageStorageAvailable(),true);assert.equal(f.disk.getItem('qingdan-language'),'en');assert.equal(f.browserCalls(),0);assert.equal(f.indexedDBCalls(),0)}finally{f.close()}
});

test('fresh renderer reads native drafts and language before first render without async hydration',()=>{
 const script=`const data=new Map([['qingdan-language','en'],['qingdan:quick-draft:local-test','Restored before render']]);globalThis.window={qingdanDesktop:{localBusinessStorageRequired:true},qingdanLocalStorage:Object.freeze({getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key),keys:()=>[...data.keys()]}),get localStorage(){throw Error('Unexpected Chromium storage')},navigator:{languages:['zh-CN']}};const {draftStore}=await import('./lib/client-storage.ts');const {getLocale}=await import('./lib/i18n.ts');const React=await import('react');const {renderToString}=await import('react-dom/server');const {useDraftInput}=await import('./lib/use-draft-input.ts');function Draft(){return React.createElement('input',{value:useDraftInput('qingdan:quick-draft:local-test')[0],readOnly:true})};console.log(JSON.stringify([draftStore.getItem('qingdan:quick-draft:local-test'),getLocale(),renderToString(React.createElement(Draft))]));`;
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:resolve(import.meta.dirname,'..'),encoding:'utf8'});assert.equal(result.status,0,result.stderr);const [draft,locale,markup]=JSON.parse(result.stdout);assert.deepEqual([draft,locale],['Restored before render','en']);assert.match(markup,/value="Restored before render"/);
});


test('failed native set/remove intents retain exact input, first/latest reasons and remain guarded after export',()=>{
 const f=nativeFixture();try{const store=businessStorage(),quick='qingdan:quick-draft:failure',create='qingdan:queue:create:failure:one';f.disk.setItem('qingdan:draft:failure:durable','Durable draft');f.disk.setItem(quick,'Old durable input');f.fail('set');assert.throws(()=>store.setItem(quick,'First volatile input'),/native set failure/);f.fail('');assert.throws(()=>store.setItem(quick,'Latest volatile input'),/Export unsaved input/);assert.throws(()=>store.removeItem(quick),/Export unsaved input/);const queue=new PendingStore('create','failure',store);assert.equal(queue.save([{id:'one',kind:'task',data:{title:'Unsent creation'}}]),false);const exported=exportNativeUnsavedInput();assert.equal(exported.firstReason,'Synthetic native set failure');assert.equal(exported.latestReason,NATIVE_STORAGE_BLOCKED_MESSAGE);const input=exported.failedWrites.find(entry=>entry.key===quick&&entry.operation==='set')!;assert.equal(input.firstValue,'First volatile input');assert.equal(input.value,'Latest volatile input');assert.equal(input.firstReason,'Synthetic native set failure');assert.equal(input.attempts,2);assert.equal(exported.failedWrites.find(entry=>entry.key===quick&&entry.operation==='remove')?.value,null);assert.match(exported.failedWrites.find(entry=>entry.key===create)?.value||'',/Unsent creation/);assert.ok(exported.durableBusinessEntries.some(entry=>entry.key==='qingdan:draft:failure:durable'&&entry.value==='Durable draft'));assert.equal(f.disk.getItem(quick),'Old durable input');assert.equal(nativeStorageWritesBlocked(),true);const unload=new Event('beforeunload',{cancelable:true});f.win.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);assert.equal(nativeStorageWritesBlocked(),true)}finally{f.close()}
});

test('missing bridge writes are captured rather than losing the attempted operation identity',()=>{
 const f=nativeFixture();try{(f.win as any).qingdanLocalStorage=undefined;assert.throws(()=>businessStorage().setItem('qingdan:queue:write:missing:one','Exact pending bytes'),/bridge unavailable/);assert.equal(exportNativeUnsavedInput().failedWrites[0].value,'Exact pending bytes');assert.equal(nativeStorageWritesBlocked(),true);assert.equal(f.browserCalls(),0)}finally{f.close()}
});

test('native failure blocks new mutating requests and XHR headers while allowing reads and already-sent results',async()=>{
 const f=nativeFixture(),oldFetch=globalThis.fetch;const{api,mutationHeaders}=await import('./client');let calls=0,release!:(response:Response)=>void;
 try{globalThis.fetch=async(_path,init)=>{calls++;if(init?.method==='POST')return new Promise<Response>(resolve=>{release=resolve});return Response.json({records:[],export:true})};const inFlight=api('/api/data',{operation:'upsert',id:'already-sent'});f.fail('set');assert.throws(()=>businessStorage().setItem('qingdan:quick-draft:guard','Keep me'));release(Response.json({record:{id:'already-sent',persisted:true}}));assert.deepEqual(await inFlight,{record:{id:'already-sent',persisted:true}});await assert.rejects(api('/api/data',{operation:'upsert',id:'blocked'}),(error:any)=>error.code==='NATIVE_STORAGE_UNCONFIRMED');assert.throws(()=>mutationHeaders('local-user'),/Export unsaved input/);assert.deepEqual(await api('/api/backup'),{records:[],export:true});assert.equal(calls,2);assert.equal(exportNativeUnsavedInput().failedWrites[0].value,'Keep me')}finally{globalThis.fetch=oldFetch;f.close()}
});


test('two fixed-baseline renderers tolerate routine cache/preferences conflicts but lock conflicting draft input',async()=>{
 const shared=new Map<string,string>(),revisions=new Map<string,number>();
 const bridge=():NativeBusinessStorage=>{const observed=new Map(revisions);const write=(key:string,value:string|null)=>{if((observed.get(key)||0)!==(revisions.get(key)||0))throw new Error('STALE_LOCAL_WRITE');const revision=(revisions.get(key)||0)+1;revisions.set(key,revision);observed.set(key,revision);if(value===null)shared.delete(key);else shared.set(key,value)};return{getItem:key=>shared.get(key)??null,keys:()=>[...shared.keys()],setItem:(key,value)=>write(key,value),removeItem:key=>write(key,null)}};
 const a=nativeFixture();a.win.qingdanLocalStorage=bridge();const b=nativeFixture();b.win.qingdanLocalStorage=bridge();const activate=(f:typeof a)=>Object.defineProperty(globalThis,'window',{configurable:true,value:f.win});
 try{
  activate(a);const cacheA=new WorkspaceCache('two-window',browserCacheBackend()),storeA=businessStorage();activate(b);const cacheB=new WorkspaceCache('two-window',browserCacheBackend()),storeB=businessStorage();assert.equal(await cacheB.save(boot('two-window')),true);
  activate(a);assert.equal(await cacheA.save(boot('two-window')),false);assert.equal(nativeStorageWritesBlocked(),false);assert.ok(await cacheA.load());
  for(const key of ['qingdan-language',nativeOfflineSessionKey,'qingdan:offline-shell-opt:two-window','qingdan:view:two-window:today']){activate(b);storeB.setItem(key,'Other window');activate(a);assert.equal(storeA.getItem(key),'Other window');assert.throws(()=>storeA.setItem(key,'Stale preference'),/STALE_LOCAL_WRITE/);assert.equal(nativeStorageWritesBlocked(),false);assert.equal(exportNativeUnsavedInput().failedWrites.length,0)}
  const key='qingdan:quick-draft:two-window';activate(b);storeB.setItem(key,'Other window draft');activate(a);assert.equal(storeA.getItem(key),'Other window draft');assert.throws(()=>storeA.setItem(key,'My conflicting input'),/STALE_LOCAL_WRITE/);assert.equal(nativeStorageWritesBlocked(),true);assert.equal(exportNativeUnsavedInput().failedWrites.find(entry=>entry.key===key)?.value,'My conflicting input');assert.equal(shared.get(key),'Other window draft');assert.throws(()=>storeA.setItem(key,'Retry without reload'),/Export unsaved input/);assert.equal(shared.get(key),'Other window draft');
 }finally{b.close();a.close()}
});

test('failed native session invalidation remains inactive locally until a durable online reconfirmation succeeds',async()=>{
 const f=nativeFixture(),id='native-session-denial-failure';try{f.disk.setItem(offlineOptKey(id),'enabled');f.disk.setItem(nativeOfflineSessionKey,JSON.stringify({version:1,accountId:id,confirmedAt:'2026-10-18T09:00:00Z',active:true}));f.fail('set');assert.equal(await invalidateOfflineSession('server-denied',id),false);assert.equal(isOfflineBlocked(id),true);assert.equal(validOfflineSession(await shellSessionBackend().get()),false);assert.equal(await confirmOfflineSession(boot(id)),false);assert.equal(isOfflineBlocked(id),true);assert.equal(validOfflineSession(await shellSessionBackend().get()),false);assert.equal(nativeStorageWritesBlocked(),false);f.fail('');assert.equal(await confirmOfflineSession(boot(id)),true);assert.equal(isOfflineBlocked(id),false);assert.equal(validOfflineSession(await shellSessionBackend().get()),true)}finally{f.close()}
});
