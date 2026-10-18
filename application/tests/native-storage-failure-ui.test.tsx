import{test}from'node:test';
import assert from'node:assert/strict';
import{Window}from'happy-dom';
const g=globalThis as any;
function installWindow(){const window:any=new Window({url:'http://127.0.0.1:4340/'});for(const key of['window','document','navigator','location','HTMLElement','Event','CustomEvent','localStorage','sessionStorage'])Object.defineProperty(g,key,{value:window[key],configurable:true,writable:true});return window}
installWindow();g.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
const{default:NativeStorageFailureNotice}=await import('../web/native-storage-failure-notice');
const{businessStorage,nativeStorageWritesBlocked}=await import('../lib/business-storage');
const{draftStore}=await import('../lib/client-storage');
const{PendingStore}=await import('../lib/pending-store');
const{setLanguagePreference}=await import('../lib/i18n');
async function setup(native=true){const window=installWindow(),data=new Map<string,string>();let fail=false;const captured:Blob[]=[];let clicks=0;const create=URL.createObjectURL,revoke=URL.revokeObjectURL;
 if(native){window.qingdanDesktop={localBusinessStorageRequired:true};window.qingdanLocalStorage={getItem:(key:string)=>data.get(key)??null,setItem(key:string,value:string){if(fail)throw Error('Synthetic disk full');data.set(key,value)},removeItem(key:string){if(fail)throw Error('Synthetic disk full');data.delete(key)},keys:()=>[...data.keys()]}}
 URL.createObjectURL=(blob:Blob)=>{captured.push(blob);return'blob:synthetic-input-export'};URL.revokeObjectURL=()=>{};window.HTMLAnchorElement.prototype.click=function(){clicks++};
 setLanguagePreference('en');const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await act(async()=>root.render(<><NativeStorageFailureNotice/><input aria-label="Current input" defaultValue="Untouched current input"/></>));
 return{window,host,data,captured,clicks:()=>clicks,fail:()=>{fail=true},close:async()=>{await act(async()=>root.unmount());host.remove();URL.createObjectURL=create;URL.revokeObjectURL=revoke;window.happyDOM.abort()}};
}

test('native failure notice exports quick drafts and pending creates and keeps the close guard active',async()=>{
 const f=await setup();try{f.data.set('qingdan:draft:ui-native:task','Readable durable draft');f.fail();await act(async()=>{assert.equal(draftStore.setItem('qingdan:quick-draft:ui-native','Unsaved quick text'),false);assert.equal(new PendingStore('create','ui-native',businessStorage()).save([{id:'one',kind:'task',data:{title:'Unsent task creation'}}]),false)});assert.match(f.host.querySelector('[role=alert]')?.textContent||'',/Do not close or reload/);assert.match(f.host.textContent||'',/An in-flight change may already have been saved/);assert.equal((f.host.querySelector('input')as HTMLInputElement).value,'Untouched current input');await act(async()=>f.host.querySelector('button')!.click());assert.equal(f.clicks(),1);const exported=JSON.parse(await f.captured[0].text());assert.equal(exported.failedWrites.find((entry:any)=>entry.key==='qingdan:quick-draft:ui-native').value,'Unsaved quick text');assert.match(exported.failedWrites.find((entry:any)=>entry.key==='qingdan:queue:create:ui-native:one').value,/Unsent task creation/);assert.ok(exported.durableBusinessEntries.some((entry:any)=>entry.value==='Readable durable draft'));assert.match(f.host.textContent||'',/Verify the JSON file was saved before reloading/);assert.equal(nativeStorageWritesBlocked(),true);const unload=new f.window.Event('beforeunload',{cancelable:true});f.window.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);await act(async()=>setLanguagePreference('zh-CN'));assert.match(f.host.textContent||'',/请勿关闭或重新加载此窗口/);assert.equal(f.host.querySelector('button')?.textContent,'导出未保存的输入')}finally{await f.close()}
});

test('export failure keeps input and gives an actionable warning instead of claiming a saved file',async()=>{
 const f=await setup();try{f.fail();await act(async()=>{draftStore.setItem('qingdan:quick-draft:ui-export-fail','Keep this input')});URL.createObjectURL=()=>{throw Error('Synthetic download unavailable')};await act(async()=>f.host.querySelector('button')!.click());assert.match(f.host.textContent||'',/Export could not be started\. Keep this window open/);assert.doesNotMatch(f.host.textContent||'',/Download requested/);assert.equal(draftStore.getItem('qingdan:quick-draft:ui-export-fail'),'Keep this input');assert.equal(nativeStorageWritesBlocked(),true)}finally{await f.close()}
});

test('ordinary browser storage failure does not install the native mutation lock or close guard',async()=>{
 const f=await setup(false);try{const storage=f.window.localStorage;storage.setItem=()=>{throw Error('Synthetic browser quota')};await act(async()=>{draftStore.setItem('qingdan:quick-draft:web-failure','Browser volatile input')});assert.equal(f.host.querySelector('.native-storage-failure-notice'),null);assert.equal(nativeStorageWritesBlocked(),false);const unload=new f.window.Event('beforeunload',{cancelable:true});f.window.dispatchEvent(unload);assert.equal(unload.defaultPrevented,false)}finally{await f.close()}
});
