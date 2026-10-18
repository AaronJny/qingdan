import {test}from'node:test';
import assert from'node:assert/strict';
import{Window}from'happy-dom';
const window:any=new Window({url:'http://127.0.0.1:4339/'}),g=globalThis as any;
for(const key of['window','document','navigator','location','HTMLElement','Event','CustomEvent','localStorage','sessionStorage'])Object.defineProperty(g,key,{value:window[key],configurable:true,writable:true});
g.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
const{default:LocalRecoveryNotice}=await import('../web/local-recovery-notice');
const{setLanguagePreference}=await import('../lib/i18n');
const pending={status:'pending',requiresReview:true,acknowledgedContinue:true,candidateCount:2,conflictCount:1};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))});
async function mount(bridge:any){const data=new Map<string,string>();window.qingdanLocalStorage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>data.delete(key),keys:()=>[...data.keys()]};window.qingdanDesktop=bridge;setLanguagePreference('en');const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await act(async()=>root.render(<><LocalRecoveryNotice/><input aria-label="Unsaved input" defaultValue="Preserved draft"/></>));await settle();return{host,async close(){await act(async()=>root.unmount());host.remove();delete window.qingdanLocalStorage;delete window.qingdanDesktop;window.happyDOM.abort()}}}

test('pending recovery stays visible after explicit continue, preserving current input and avoiding duplicate open requests',async()=>{
 let opened=0;const opening=deferred<{ok:true}>();const f=await mount({localBusinessStorageRequired:true,getLocalRecovery:async()=>pending,openLocalRecovery:()=>{opened++;return opening.promise}});try{assert.match(f.host.textContent||'',/Previous input is kept for review\. Saved tasks remain available\./);assert.equal(f.host.querySelector('[role=dialog]'),null);const button=f.host.querySelector('button')!;await act(async()=>{button.click();button.click()});assert.equal(opened,1);assert.equal(button.disabled,true);assert.equal((f.host.querySelector('input')as HTMLInputElement).value,'Preserved draft');await act(async()=>opening.resolve({ok:true}));assert.equal(button.disabled,false);assert.ok(f.host.querySelector('.local-recovery-notice'));assert.doesNotMatch(f.host.textContent||'',/fully recovered|recovery complete/i)}finally{opening.resolve({ok:true});await f.close()}
});

test('nonblocking review uses broad preserved-data wording and updates live in Chinese',async()=>{
 const f=await mount({localBusinessStorageRequired:true,getLocalRecovery:async()=>({...pending,requiresReview:false}),openLocalRecovery:async()=>({ok:true})});try{assert.match(f.host.textContent||'',/Previous data is kept for review\./);assert.doesNotMatch(f.host.textContent||'',/Saved tasks/);await act(async()=>setLanguagePreference('zh-CN'));assert.match(f.host.textContent||'',/旧版数据已保留，等待核对/);assert.equal(f.host.querySelector('button')?.textContent,'核对旧版输入')}finally{await f.close()}
});

test('remote desktop and ordinary web never request native recovery',async()=>{
 for(const localBusinessStorageRequired of [false,undefined]){let calls=0;const f=await mount({localBusinessStorageRequired,getLocalRecovery:async()=>{calls++;return pending},openLocalRecovery:async()=>({ok:true})});try{assert.equal(calls,0);assert.equal(f.host.querySelector('.local-recovery-notice'),null)}finally{await f.close()}}
});

test('review failure remains actionable and returning after successful review clears the notice',async()=>{
 let unavailable=true,opened=0;const f=await mount({localBusinessStorageRequired:true,getLocalRecovery:async()=>{if(unavailable)throw Error('Synthetic blocked read');return{...pending,status:'none'}},openLocalRecovery:async()=>{opened++;throw Error('Synthetic open failure')}});try{assert.match(f.host.textContent||'',/Previous input could not be opened/);await act(async()=>f.host.querySelector('button')!.click());assert.equal(opened,1);assert.match(f.host.textContent||'',/Previous input could not be opened/);unavailable=false;await act(async()=>window.dispatchEvent(new window.Event('focus')));await settle();assert.equal(f.host.querySelector('.local-recovery-notice'),null)}finally{await f.close()}
});

test('older focus status cannot revive a cleared recovery notice',async()=>{
 const old=deferred<any>(),latest=deferred<any>();let reads=0;const f=await mount({localBusinessStorageRequired:true,getLocalRecovery:()=>++reads===1?Promise.resolve(pending):reads===2?old.promise:latest.promise,openLocalRecovery:async()=>({ok:true})});try{await act(async()=>{window.dispatchEvent(new window.Event('focus'));window.dispatchEvent(new window.Event('focus'))});await act(async()=>latest.resolve({...pending,status:'none'}));assert.equal(f.host.querySelector('.local-recovery-notice'),null);await act(async()=>old.resolve(pending));assert.equal(f.host.querySelector('.local-recovery-notice'),null)}finally{await f.close()}
});
