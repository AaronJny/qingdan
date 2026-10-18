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

test('all nine native preferences update labels and persistent WebView storage without touching a draft', async () => {
 const {LOCALES,LANGUAGE_NAMES}=await import('../lib/i18n');let changed!:(snapshot:any)=>void;
 const manifest=document.createElement('link');manifest.rel='manifest';document.head.append(manifest);
 const f=await mount({localBusinessStorageRequired:true,getLanguage:async()=>({preference:'en',locale:'en',revision:0}),onLanguageChanged:(fn:any)=>{changed=fn;return()=>{}},setLanguagePreference:async(preference:string)=>({preference,locale:preference,revision:100})});
 try{
  await tick();let revision=0;
  for(const locale of LOCALES){await act(async()=>changed({preference:locale,locale,revision:++revision}));assert.equal(getLocale(),locale);assert.equal(document.documentElement.lang,locale);assert.equal(new URL(manifest.href).pathname,locale==='zh-CN'?'/manifest.webmanifest':`/manifest.${locale}.webmanifest`);assert.equal(window.localStorage.getItem('qingdan-language'),locale);assert.equal((f.host.querySelector('select')as HTMLSelectElement).value,locale);assert.equal((f.host.querySelector(`option[value="${locale}"]`)as HTMLOptionElement).textContent,LANGUAGE_NAMES[locale]);assert.equal((f.host.querySelector('input')as HTMLInputElement).value,'中文草稿 English');}
  for(const locale of ['it','zh-Hant','pt','<script>'])await act(async()=>changed({preference:'en',locale,revision:++revision}));
  assert.equal(getLocale(),'pt-BR');
 }finally{await f.close();manifest.remove();}
});

test('malformed native save acknowledgements roll back instead of claiming a durable save',async()=>{
 for(const invalid of [null,{preference:'ja',locale:'it',revision:2},{preference:'ja',locale:'ja',revision:-1},{preference:'ja',locale:'ja'}]){
  const confirmed={preference:'en',locale:'en',revision:1};
  const f=await mount({getLanguage:async()=>confirmed,onLanguageChanged:()=>()=>{},setLanguagePreference:async()=>invalid});
  try{await tick();await act(async()=>setLanguagePreference('ja'));await tick();assert.equal(getLanguagePreference(),'en');assert.equal(window.localStorage.getItem('qingdan-language'),'en');assert.ok(f.host.querySelector('[role=alert]'));assert.equal((f.host.querySelector('input')as HTMLInputElement).value,'中文草稿 English');}finally{await f.close()}
 }
});

test('stale valid save acknowledgement cannot clear a newer native failure state',async()=>{
 const {reportNativeLanguageSaveFailure,languageNativeSaveFailed}=await import('../lib/i18n');const pending=deferred<any>();let changed!:(snapshot:any)=>void;
 const f=await mount({getLanguage:async()=>({preference:'en',locale:'en',revision:0}),onLanguageChanged:(fn:any)=>{changed=fn;return()=>{}},setLanguagePreference:()=>pending.promise});
 try{await tick();await act(async()=>setLanguagePreference('ja'));await act(async()=>{changed({preference:'ko',locale:'ko',revision:2});reportNativeLanguageSaveFailure(true)});await act(async()=>pending.resolve({preference:'ja',locale:'ja',revision:1}));assert.equal(getLocale(),'ko');assert.equal(languageNativeSaveFailed(),true);assert.ok(f.host.querySelector('[role=alert]'));}finally{await f.close()}
});

test('invalid recovery snapshot cannot prevent rollback after invalid save acknowledgement',async()=>{
 let reads=0;const f=await mount({getLanguage:async()=>++reads===1?{preference:'en',locale:'en',revision:0}:{preference:'ja',locale:'it',revision:99},onLanguageChanged:()=>()=>{},setLanguagePreference:async()=>({preference:'ja',locale:'it',revision:1})});
 try{await tick();await act(async()=>setLanguagePreference('ja'));await tick();assert.equal(getLocale(),'en');assert.equal(window.localStorage.getItem('qingdan-language'),'en');assert.ok(f.host.querySelector('[role=alert]'));}finally{await f.close()}
});

test('unsuperseded stale native acknowledgement restores revision 3 and reports failure',async()=>{
 const snapshot={preference:'en',locale:'en',revision:3};
 const f=await mount({getLanguage:async()=>snapshot,onLanguageChanged:()=>()=>{},setLanguagePreference:async()=>({preference:'en',locale:'en',revision:2})});
 try{await tick();await act(async()=>setLanguagePreference('ja'));await tick();assert.equal(getLocale(),'en');assert.equal(getLanguagePreference(),'en');assert.equal(window.localStorage.getItem('qingdan-language'),'en');assert.ok(f.host.querySelector('[role=alert]'));assert.equal((f.host.querySelector('input')as HTMLInputElement).value,'中文草稿 English');}finally{await f.close()}
});

test('matching preference in an old revision is still not a durable acknowledgement',async()=>{
 for(const revision of [2,3]){
  const snapshot={preference:'en',locale:'en',revision:3};const f=await mount({getLanguage:async()=>snapshot,onLanguageChanged:()=>()=>{},setLanguagePreference:async()=>({preference:'ja',locale:'ja',revision})});
  try{await tick();await act(async()=>setLanguagePreference('ja'));await tick();assert.equal(getLocale(),'en');assert.ok(f.host.querySelector('[role=alert]'));}finally{await f.close()}
 }
});
