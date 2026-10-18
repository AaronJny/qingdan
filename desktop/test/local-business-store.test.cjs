'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {LocalBusinessStore}=require('../src/local-business-store.cjs');
const {describeKey,validateEntry}=require('../src/local-business-schema.cjs');
const {handleLocalBusiness}=require('../src/local-business-ipc.cjs');
const {endpoint}=require('../src/policy.cjs');
const principal='local:12345678-1234-4234-8234-123456789abc',other='local:aaaaaaaa-1234-4234-8234-123456789abc';
const key='qingdan:quick-draft:'+principal;
function fixture(t,options={}){const profile=fs.mkdtempSync(path.join(os.tmpdir(),'qingdan-native-storage-'));t.after(()=>fs.rmSync(profile,{recursive:true,force:true}));return {profile,store:new LocalBusinessStore({profile,principalId:principal,...options})};}
function bridge(store,connection=endpoint('http://127.0.0.1:45454/',true)){
 const expectedSession={},frame={url:connection.serverUrl},contents={mainFrame:frame,session:expectedSession,getLastWebPreferences:()=>({sandbox:true}),send(){}};
 const window={webContents:contents,isDestroyed:()=>false};const event={sender:contents,senderFrame:frame};
 return {event,window,context:{connection,backend:{status:'ready',backendOrigin:connection.origin},windows:[window],store,quitting:false,expectedSession}};
}
test('local durable store writes exact Unicode immediately and preserves tasks/objects across restart',t=>{
 const {profile,store}=fixture(t);fs.mkdirSync(path.join(profile,'local-data'));fs.writeFileSync(path.join(profile,'local-data','qingdan.sqlite'),'unchanged synthetic database bytes');fs.mkdirSync(path.join(profile,'local-data','objects'));fs.writeFileSync(path.join(profile,'local-data','objects','fixture.qobj'),'unchanged attachment');
 const value='草稿 😀 é \ud800\n exact whitespace  ';const result=store.write(key,value,0);assert.equal(result.revision,1);assert.equal(JSON.parse(fs.readFileSync(store.file)).entries[key].value,value);assert.equal(new LocalBusinessStore({profile,principalId:principal}).read(key).value,value);
 assert.equal(fs.readFileSync(path.join(profile,'local-data','qingdan.sqlite'),'utf8'),'unchanged synthetic database bytes');assert.equal(fs.readFileSync(path.join(profile,'local-data','objects','fixture.qobj'),'utf8'),'unchanged attachment');
});
test('per-key revisions reject concurrent stale writes and removals; tombstones prevent ABA',t=>{
 const {store}=fixture(t);store.write(key,'first',0);store.write(key,'second',1);assert.throws(()=>store.write(key,'stale',1),{code:'LOCAL_WRITE_CONFLICT'});assert.throws(()=>store.write(key,null,1),{code:'LOCAL_WRITE_CONFLICT'});store.write(key,null,2);assert.equal(store.read(key).value,null);assert.equal(store.keys().length,0);assert.throws(()=>store.write(key,'resurrected',0),{code:'LOCAL_WRITE_CONFLICT'});assert.equal(store.write(key,'new',3).revision,4);
});
test('quota failure preserves prior bytes, state and revisions',t=>{const {store}=fixture(t,{maxBytes:400});store.write(key,'saved',0);const bytes=fs.readFileSync(store.file);assert.throws(()=>store.write(key,'x'.repeat(1000),1),{code:'LOCAL_STORAGE_QUOTA'});assert.deepEqual(fs.readFileSync(store.file),bytes);assert.equal(store.read(key).value,'saved');});
test('failure before atomic replacement does not change prior durable value',t=>{let fail=false;const io=new Proxy(fs,{get(target,property){if(property==='fsyncSync')return fd=>{if(fail)throw Error('disk failure');return target.fsyncSync(fd);};return target[property];}});const {store}=fixture(t,{fs:io});store.write(key,'saved',0);const bytes=fs.readFileSync(store.file);fail=true;assert.throws(()=>store.write(key,'not acknowledged',1),{code:'LOCAL_WRITE_FAILED'});assert.deepEqual(fs.readFileSync(store.file),bytes);assert.equal(store.read(key).value,'saved');});
test('uncertain directory flush blocks further writes rather than silently acknowledging',t=>{
 let fail=false,directoryFlushes=0;const directoryHandle=Symbol('simulated POSIX directory handle');
 // Exercise the POSIX acknowledgement boundary on every host without asking
 // Windows CRT to open a real directory. File data still uses real fsync.
 const io=new Proxy(fs,{get(target,property){
  if(property==='openSync')return (file,flags,...rest)=>flags==='r'&&target.statSync(file).isDirectory()?directoryHandle:target.openSync(file,flags,...rest);
  if(property==='fsyncSync')return fd=>{if(fd!==directoryHandle)return target.fsyncSync(fd);directoryFlushes++;if(fail)throw Error('directory flush failure');};
  if(property==='closeSync')return fd=>{if(fd!==directoryHandle)return target.closeSync(fd);};
  return target[property];
 }});
 const {profile,store}=fixture(t,{fs:io,platform:'linux'});store.write(key,'saved',0);assert.equal(directoryFlushes,1);fail=true;
 assert.throws(()=>store.write(key,'possibly committed',1),{code:'LOCAL_WRITE_UNCERTAIN'});assert.equal(directoryFlushes,2);
 assert.throws(()=>store.write(key,'later',2),{code:'LOCAL_WRITE_UNCERTAIN'});assert.equal(new LocalBusinessStore({profile,principalId:principal}).read(key).value,'possibly committed');
});
test('Windows durable replacement flushes file data without opening a CRT directory handle',t=>{
 let flushes=0;const io=new Proxy(fs,{get(target,property){
  if(property==='openSync')return (file,flags,...rest)=>{assert.notEqual(flags,'r','Windows must not open a directory for fsync');return target.openSync(file,flags,...rest);};
  if(property==='fsyncSync')return fd=>{flushes++;return target.fsyncSync(fd);};
  return target[property];
 }});
 const {profile,store}=fixture(t,{fs:io,platform:'win32'});store.write(key,'durable file bytes',0);assert.equal(flushes,1);assert.equal(new LocalBusinessStore({profile,principalId:principal}).read(key).value,'durable file bytes');
});
test('corrupt native store is never reset or rewritten',t=>{const {profile,store}=fixture(t);store.write(key,'saved',0);fs.writeFileSync(store.file,'{broken');assert.throws(()=>new LocalBusinessStore({profile,principalId:principal}),{code:'INVALID_LOCAL_STORE'});assert.equal(fs.readFileSync(store.file,'utf8'),'{broken');});
test('symlink file and directory are refused',t=>{const {profile,store}=fixture(t);const target=path.join(profile,'untouched');fs.writeFileSync(target,'original');fs.symlinkSync(target,store.file);assert.throws(()=>store.write(key,'unsafe',0),{code:'LOCAL_WRITE_FAILED'});assert.equal(fs.readFileSync(target,'utf8'),'original');assert.throws(()=>new LocalBusinessStore({profile,principalId:principal}),{code:'INVALID_LOCAL_STORE'});});
test('different stable local principal uses isolated files and cannot access another principal key',t=>{const {profile,store}=fixture(t);store.write(key,'saved',0);const next=new LocalBusinessStore({profile,principalId:other});assert.notEqual(next.file,store.file);assert.throws(()=>next.read(key),{code:'INVALID_LOCAL_KEY'});assert.equal(next.keys().length,0);});
test('explicit schema accepts known local drafts and rejects credentials, arbitrary prefix, remote identities and invalid payloads',()=>{
 for(const bad of ['password','qingdan:credential:'+principal,'qingdan:quick-draft:remote-account','qingdan:task-outbox:v1:http%3A%2F%2Flocalhost:'+encodeURIComponent(principal)+':id','qingdan:quick-draft:'+other,'../../file','qingdan-language\0'])assert.equal(describeKey(bad,principal),null,bad);
 assert.equal(validateEntry(key,'plain input',principal),true);assert.throws(()=>validateEntry('qingdan-language','secret',principal));assert.throws(()=>validateEntry('qingdan:form-draft:'+encodeURIComponent(principal)+':task:new','{}',principal));
 assert.equal(validateEntry('qingdan:offline-shell-session:v1',JSON.stringify({version:1,accountId:principal,confirmedAt:'2026-10-18T00:00:00Z',active:false,reason:'signed-out'}),principal),true);
 assert.throws(()=>validateEntry('qingdan:offline-shell-session:v1',JSON.stringify({version:1,accountId:other,confirmedAt:'2026-10-18',active:true}),principal));
});
test('IPC validates window identity, main frame, actual Session identity, owned backend and strict operation fields',t=>{
 const {store}=fixture(t),b=bridge(store);assert.equal(handleLocalBusiness(b.event,{operation:'snapshot'},b.context).ok,true);
 for(const event of [{...b.event,sender:{}},{...b.event,senderFrame:{url:b.event.senderFrame.url}}])assert.equal(handleLocalBusiness(event,{operation:'snapshot'},b.context).ok,false);
 for(const context of [{...b.context,expectedSession:undefined},{...b.context,expectedSession:{}},{...b.context,quitting:true},{...b.context,connection:{...b.context.connection,builtin:false}},{...b.context,backend:{status:'failed',backendOrigin:b.context.connection.origin}},{...b.context,backend:{status:'ready',backendOrigin:'http://127.0.0.1:1'}}])assert.equal(handleLocalBusiness(b.event,{operation:'snapshot'},context).ok,false);
 b.event.senderFrame.url='qingdan-local://ui/status';assert.equal(handleLocalBusiness(b.event,{operation:'snapshot'},b.context).ok,false);b.event.senderFrame.url=b.context.connection.serverUrl;
 for(const request of [{operation:'clear'},{operation:'snapshot',path:'/tmp/file'},{operation:'set',key,value:'x',expectedRevision:0,path:'/tmp/file'},{operation:'set',key,value:null,expectedRevision:0}])assert.equal(handleLocalBusiness(b.event,request,b.context).ok,false);
 assert.equal(handleLocalBusiness(b.event,{operation:'set',key,value:'valid',expectedRevision:0},b.context).ok,true);assert.equal(store.read(key).value,'valid');
});
function preload(b){const exposed={},listeners={};const ipcRenderer={invoke(){},on(channel,fn){listeners[channel]=fn;},sendSync(channel,request){assert.equal(channel,'qingdan-local-business');return handleLocalBusiness(b.event,request,b.context);}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/service-preload.cjs'),'utf8'),{require:()=>({ipcRenderer,contextBridge:{exposeInMainWorld:(name,value)=>{exposed[name]=value;}}}),process:{argv:['--qingdan-owned-local']}});return {exposed,listeners};}
test('preload synchronous hydration and writes are durable before returning, survives renderer restart',t=>{const {store}=fixture(t),b=bridge(store),first=preload(b).exposed;assert.equal(first.qingdanDesktop.localBusinessStorageRequired,true);first.qingdanLocalStorage.setItem(key,'before return');assert.equal(JSON.parse(fs.readFileSync(store.file)).entries[key].value,'before return');const second=preload(b).exposed;assert.equal(second.qingdanLocalStorage.getItem(key),'before return');second.qingdanLocalStorage.setItem(key,'newer');assert.throws(()=>first.qingdanLocalStorage.setItem(key,'stale'),{code:'LOCAL_WRITE_CONFLICT'});assert.equal(store.read(key).value,'newer');});
test('preload never falls back to ephemeral storage if initial trusted hydration fails',t=>{const {store}=fixture(t),b=bridge(store);b.context.backend.status='failed';const local=preload(b).exposed.qingdanLocalStorage;assert.throws(()=>local.getItem(key));assert.throws(()=>local.setItem(key,'unsafe'));assert.equal(store.keys().length,0);});
test('remote preload exposes no local business storage and does not invoke sync native storage',()=>{const names=[];vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/service-preload.cjs'),'utf8'),{require:()=>({ipcRenderer:{invoke(){},sendSync(){throw Error('must not access local storage');}},contextBridge:{exposeInMainWorld:(name,value)=>{names.push(name);assert.equal(value.localBusinessStorageRequired,false);}}}),process:{argv:[]}});assert.deepEqual(names,['qingdanDesktop']);});
test('startup-only compaction releases completed-operation tombstones without weakening live-session CAS',t=>{const {profile,store}=fixture(t,{maxKeys:2});const second='qingdan:batch-tag-draft:'+principal;store.write(key,'first',0);store.write(key,null,1);store.write(second,'second',0);store.write(second,null,3);assert.throws(()=>store.write(key,'stale',0),{code:'LOCAL_WRITE_CONFLICT'});const restarted=new LocalBusinessStore({profile,principalId:principal,maxKeys:2,compactOnOpen:true});assert.equal(Object.keys(restarted.snapshot().entries).length,0);assert.equal(restarted.snapshot().revision,4);assert.equal(restarted.write(key,'new session',0).revision,5);assert.equal(JSON.parse(fs.readFileSync(restarted.file)).entries[key].value,'new session');});
test('legacy pending-create tuples retain their original fingerprint and operation identity',()=>{const legacy='qingdan:pending-create:'+principal,value=JSON.stringify([['original-fingerprint',{id:'same-operation-id',kind:'task',data:{title:'Unconfirmed task'}}]]);assert.equal(validateEntry(legacy,value,principal),true);assert.throws(()=>validateEntry(legacy,JSON.stringify([{id:'wrong-legacy-shape',kind:'task',data:{}}]),principal));});
test('incidental reads and export/cleanup cannot adopt another window write baseline',t=>{const {store}=fixture(t),b=bridge(store);store.write(key,'A input',0);const a=preload(b).exposed.qingdanLocalStorage,c=preload(b).exposed.qingdanLocalStorage;c.setItem(key,'B unsaved input');assert.equal(a.getItem(key),'B unsaved input');assert.throws(()=>a.removeItem(key),{code:'LOCAL_WRITE_CONFLICT'});assert.throws(()=>a.setItem(key,'stale A form'),{code:'LOCAL_WRITE_CONFLICT'});assert.equal(store.read(key).value,'B unsaved input');const reloaded=preload(b).exposed.qingdanLocalStorage;reloaded.setItem(key,'explicitly reloaded input');assert.equal(store.read(key).value,'explicitly reloaded input');});
