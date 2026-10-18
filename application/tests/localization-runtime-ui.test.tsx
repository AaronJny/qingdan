import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
const window:any=new Window({url:'http://127.0.0.1:4332/'}),g=globalThis as any;
for(const key of ['window','document','navigator','location','HTMLElement','Event','CustomEvent','localStorage','sessionStorage'])Object.defineProperty(g,key,{value:window[key],configurable:true,writable:true});
g.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
const {useLanguageRuntime,LanguageSelect}=await import('../lib/i18n-react');
const {setLanguagePreference,getLanguagePreference,getLocale}=await import('../lib/i18n');
const tick=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))});
function View(){useLanguageRuntime();return <><LanguageSelect/><input aria-label="Synthetic unsaved draft" defaultValue="中文草稿 English"/></>}
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
async function mount(bridge:any){window.qingdanDesktop=bridge;setLanguagePreference('en');const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await act(async()=>root.render(<View/>));return{host,root,async close(){await act(async()=>root.unmount());host.remove();delete window.qingdanDesktop;}}}
test('native language broadcast wins over an older initial read without losing draft',async()=>{
 const initial=deferred<any>();let changed!:(s:any)=>void;
 const f=await mount({getLanguage:()=>initial.promise,onLanguageChanged:(fn:any)=>{changed=fn;return()=>{}},setLanguagePreference:async(v:string)=>({preference:v,locale:v})});
 try{await act(async()=>changed({preference:'zh-CN',locale:'zh-CN'}));assert.equal(getLocale(),'zh-CN');await act(async()=>initial.resolve({preference:'en',locale:'en'}));await tick();assert.equal(getLocale(),'zh-CN');assert.equal((f.host.querySelector('input')as HTMLInputElement).value,'中文草稿 English');}finally{await f.close()}
});
test('failed native language save rolls UI and persisted choice back with a visible message',async()=>{
 const snapshot={preference:'zh-CN',locale:'zh-CN'};const f=await mount({getLanguage:async()=>snapshot,onLanguageChanged:()=>()=>{},setLanguagePreference:async()=>{throw Error('Synthetic disk full')}});
 try{await tick();await act(async()=>setLanguagePreference('en'));await tick();assert.equal(getLanguagePreference(),'zh-CN');assert.equal(window.localStorage.getItem('qingdan-language'),'zh-CN');assert.match(f.host.querySelector('[role=alert]')?.textContent||'',/未能保存/);assert.equal((f.host.querySelector('input')as HTMLInputElement).value,'中文草稿 English');}finally{await f.close()}
});
test('rapid web choices ignore an older native save response',async()=>{
 const first=deferred<any>(),second=deferred<any>();let calls=0;
 const f=await mount({getLanguage:async()=>({preference:'en',locale:'en'}),onLanguageChanged:()=>()=>{},setLanguagePreference:()=>++calls===1?first.promise:second.promise});
 try{await tick();await act(async()=>setLanguagePreference('zh-CN'));await act(async()=>setLanguagePreference('en'));await act(async()=>second.resolve({preference:'en',locale:'en'}));await act(async()=>first.resolve({preference:'zh-CN',locale:'zh-CN'}));assert.equal(getLocale(),'en');assert.equal((f.host.querySelector('select')as HTMLSelectElement).value,'en');}finally{await f.close()}
});

test('later native cross-window revision wins over a delayed save acknowledgement',async()=>{
 const save=deferred<any>();let changed!:(s:any)=>void;
 const f=await mount({getLanguage:async()=>({preference:'zh-CN',locale:'zh-CN',revision:0}),onLanguageChanged:(fn:any)=>{changed=fn;return()=>{}},setLanguagePreference:()=>save.promise});
 try{await tick();await act(async()=>setLanguagePreference('en'));await act(async()=>changed({preference:'en',locale:'en',revision:1}));await act(async()=>changed({preference:'zh-CN',locale:'zh-CN',revision:2}));await act(async()=>save.resolve({preference:'en',locale:'en',revision:1}));assert.equal(getLanguagePreference(),'zh-CN');assert.equal(getLocale(),'zh-CN');assert.equal(window.localStorage.getItem('qingdan-language'),'zh-CN');assert.equal((f.host.querySelector('input')as HTMLInputElement).value,'中文草稿 English');}finally{await f.close()}
});
test('invalid native snapshot revisions never override the accepted state',async()=>{
 let changed!:(s:any)=>void;
 const f=await mount({getLanguage:async()=>({preference:'zh-CN',locale:'zh-CN',revision:3}),onLanguageChanged:(fn:any)=>{changed=fn;return()=>{}},setLanguagePreference:async()=>({preference:'en',locale:'en',revision:4})});
 try{await tick();for(const revision of [-1,NaN,2])await act(async()=>changed({preference:'en',locale:'en',revision}));assert.equal(getLocale(),'zh-CN');}finally{await f.close()}
});
