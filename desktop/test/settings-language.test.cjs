'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const i18next = require('i18next'); const {resources} = require('../src/language.cjs');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function element(value='') {const events={};return {value,disabled:false,required:false,textContent:'',dataset:{},addEventListener(name,fn){events[name]=fn;},dispatch(name){return events[name]?.({preventDefault(){}});}};}
async function harness({initialLanguage,saveLanguage}={}){
 const language=element('system'),input=element(''),mode=element('builtin'),button=element(),message=element(),current=element(),label=element();
 button.dataset.i18n='desktop.save.and.connect';label.dataset.i18n='desktop.language';
 const form=element();form.querySelector=()=>button;
 const elements={'form':form,'#server':input,'#mode':mode,'#message':message,'#current-connection':current,'#language':language};
 const document={documentElement:{lang:'zh-CN',dataset:{languagePreference:'system',languageRevision:'0'}},title:'',querySelector:selector=>elements[selector],querySelectorAll:()=>[label,button]};
 const engine=i18next.createInstance();await engine.init({resources,lng:'zh-CN',fallbackLng:'en',keySeparator:false,initAsync:false,interpolation:{escapeValue:false}});
 let listener,reads=0,reloads=0,languageReads=0;
 const stable={preference:'system',locale:'zh-CN',revision:0};
 const window={i18next:engine,qingdanT:(key,options)=>engine.t(key,options),addEventListener(){},qingdanConnection:{
  get:()=>Promise.resolve({mode:'builtin',serverUrl:'',status:'connected'}),
  getLanguage:()=>++languageReads===1&&initialLanguage?initialLanguage.promise:Promise.resolve(stable),
  setLanguagePreference:saveLanguage||((preference)=>Promise.resolve({preference,locale:preference==='system'?'zh-CN':preference,revision:1})),
  onLanguageChanged:fn=>{listener=fn;},save:()=>Promise.resolve({ok:true,mode:'builtin'}),
 }};
 Object.defineProperty(window,'sessionStorage',{get(){reads++;throw Error('Storage denied');}});
 const context={window,document,setTimeout,clearTimeout,location:{reload(){reloads++;throw Error('Must not reload a draft');}}};
 Object.defineProperty(context,'sessionStorage',{get(){reads++;throw Error('Storage denied');}});
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/settings.js'),'utf8'),context);
 await flush();
 return {language,input,mode,button,message,document,notify:s=>listener(s),reads:()=>reads,reloads:()=>reloads};
}
test('native language changes update static labels in place and preserve drafts with storage denied',async()=>{
 const h=await harness();h.mode.value='server';h.mode.dispatch('change');h.input.value='https://draft.example/?unchanged=青单';h.input.dispatch('input');
 h.notify({preference:'en',locale:'en',revision:1});assert.equal(h.button.textContent,'Save and connect');assert.equal(h.document.documentElement.lang,'en');
 assert.equal(h.input.value,'https://draft.example/?unchanged=青单');assert.equal(h.mode.value,'server');assert.equal(h.reads(),0);assert.equal(h.reloads(),0);
});
test('late initial language hydration cannot replace a newer user selection',async()=>{
 const initial=deferred();const h=await harness({initialLanguage:initial});h.language.value='en';await h.language.dispatch('change');
 initial.resolve({preference:'system',locale:'zh-CN',revision:0});await flush();assert.equal(h.language.value,'en');assert.equal(h.document.documentElement.lang,'en');
});
test('failed native language save rolls back selector and keeps typed server draft',async()=>{
 const h=await harness({saveLanguage:()=>Promise.reject(Error('Disk full'))});h.input.value='https://still-here.example/';h.input.dispatch('input');
 h.language.value='en';await h.language.dispatch('change');assert.equal(h.language.value,'system');assert.equal(h.document.documentElement.lang,'zh-CN');
 assert.match(h.message.textContent,/语言设置保存失败/);assert.equal(h.input.value,'https://still-here.example/');assert.equal(h.reloads(),0);
});
test('older language save responses and notifications cannot override the latest pending choice',async()=>{
 const first=deferred(),second=deferred();let calls=0;const h=await harness({saveLanguage:()=>++calls===1?first.promise:second.promise});
 h.language.value='en';const a=h.language.dispatch('change');h.language.value='zh-CN';const b=h.language.dispatch('change');
 h.notify({preference:'en',locale:'en',revision:1});assert.equal(h.language.value,'en');
 first.resolve({preference:'en',locale:'en',revision:1});await a;assert.equal(h.language.value,'en');
 second.resolve({preference:'zh-CN',locale:'zh-CN',revision:2});await b;assert.equal(h.language.value,'zh-CN');assert.equal(h.document.documentElement.lang,'zh-CN');
});

test('a newer native commit from another window survives a delayed local save acknowledgement',async()=>{
 const pending=deferred();const h=await harness({saveLanguage:()=>pending.promise});
 h.language.value='en';const saving=h.language.dispatch('change');
 h.notify({preference:'en',locale:'en',revision:1});
 h.notify({preference:'zh-CN',locale:'zh-CN',revision:2});
 assert.equal(h.language.value,'zh-CN');assert.equal(h.document.documentElement.lang,'zh-CN');
 pending.resolve({preference:'en',locale:'en',revision:1});await saving;
 assert.equal(h.language.value,'zh-CN');assert.equal(h.document.documentElement.lang,'zh-CN');
 h.notify({preference:'en',locale:'en',revision:1});assert.equal(h.language.value,'zh-CN');
});
