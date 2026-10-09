import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';
import{dispatchApi}from'./routes';import{initializeStorage,closeStorage,database}from'../lib/storage';import{createLocalUser}from'../lib/auth';
import{AccountTaskQueue,TaskQueueStore,projectedTasks}from'../lib/account-task-queue';import type{AppRecord,Bootstrap}from'../lib/types';
class MemoryStorage {items=new Map<string,string>();get length(){return this.items.size}key(i:number){return [...this.items.keys()][i]||null}getItem(k:string){return this.items.get(k)||null}setItem(k:string,v:string){this.items.set(k,v)}removeItem(k:string){this.items.delete(k)}}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
test('account outbox uses real authenticated routes for CRUD, completion, subtree undo/recycle, receipt restart and cross-account rejection',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'qingdan-task-sync-'));const origin='https://synthetic-account.example.test';process.env.APP_MODE='accounts';process.env.APP_ORIGIN=origin;initializeStorage({dataDir:dir,mode:'accounts',migrationsDir:resolve('drizzle')});
 try{
  await createLocalUser({email:'sync@example.test',password:'Synthetic test only password 2026!',displayName:'合成同步用户'},{firstAdmin:true});
  const login=await dispatchApi(new Request(origin+'/api/auth/login',{method:'POST',headers:{origin,'x-qingdan':'1','content-type':'application/json'},body:JSON.stringify({email:'sync@example.test',password:'Synthetic test only password 2026!'})}));assert.equal(login.status,200,await login.clone().text());const session=await login.json(),cookie=login.headers.get('set-cookie')!.split(';')[0];
  const headers={origin,cookie,'x-qingdan':'1','x-qingdan-csrf':session.csrfToken,'x-qingdan-expected-account':session.user.userId,'content-type':'application/json'};
  const raw=async(path:string,body?:unknown)=>dispatchApi(new Request(origin+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)}));
  const call=async(path:string,body?:unknown)=>{const response=await raw(path,body);const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error),{status:response.status,code:value.code});return value};
  const snapshot=async()=>await call('/api/data')as Bootstrap;let current=await snapshot();const inbox=current.records.find(r=>r.kind==='list')!;
  const parent=(await call('/api/data',{operation:'upsert',id:'sync-parent',kind:'task',data:{title:'父任务',listId:inbox.id,status:'open'},expectedRevision:0,clientOperationId:'initial-parent'})).record as AppRecord;
  const child=(await call('/api/data',{operation:'upsert',id:'sync-child',kind:'task',data:{title:'子任务',listId:inbox.id,parentId:parent.id,status:'open'},expectedRevision:0,clientOperationId:'initial-child'})).record as AppRecord;
  current=await snapshot();let online=false,lose=false,requests=0;
  const store=new TaskQueueStore(origin,session.user.userId,new MemoryStorage());
  const deps={active:()=>true,verify:async()=>{if(!online)throw new Error('offline');const me=await call('/api/auth/me');assert.equal(me.user.userId,session.user.userId)},snapshot,request:async(path:string,body:unknown)=>{requests++;const result=await call(path,body);if(lose){lose=false;throw new Error('response lost after transaction')}return result},change:()=>{},confirmed:(data:Bootstrap)=>{current=data}};
  const queue=new AccountTaskQueue(store,deps);
  const stage=(action:Parameters<AccountTaskQueue['enqueue']>[0],patch:any,deleted=false)=>{const projected=projectedTasks(current,queue.entries()),record=projected.records.find(r=>r.id===parent.id)!;queue.enqueue(action,record,{...record.data,...patch},deleted,projected.records)};
  stage('edit',{title:'离线编辑父任务'});stage('complete',{status:'done',completedAt:'device-time'});stage('undoComplete',{status:'open',completedAt:''});stage('trash',{},true);stage('trash',{},false);await settle();assert.equal(queue.entries().length,5);assert.equal(requests,0);online=true;await queue.drain(true);assert.deepEqual(queue.entries().map(op=>({action:op.action,reason:op.reason})),[]);
  current=await snapshot();assert.equal(current.records.find(r=>r.id===parent.id)?.data.title,'离线编辑父任务');assert.equal(current.records.find(r=>r.id===parent.id)?.data.status,'open');assert.equal(current.records.find(r=>r.id===child.id)?.data.status,'open');assert.equal(current.records.find(r=>r.id===child.id)?.deleted,false);
  // Lost edit response followed by server restart must reuse one stored receipt/history row.
  lose=true;const before=current.records.find(r=>r.id===parent.id)!;queue.enqueue('edit',before,{...before.data,title:'响应丢失仍保留'},false,current.records);await settle();await queue.drain();assert.equal(queue.entries().length,1);const operation=queue.entries()[0];assert.ok(operation.request);queue.stop();closeStorage();initializeStorage({dataDir:dir,mode:'accounts',migrationsDir:resolve('drizzle')});
  const restarted=new AccountTaskQueue(store,deps);await restarted.drain(true);assert.equal(restarted.entries().length,0);const after=(await snapshot()).records.find(r=>r.id===parent.id)!;assert.equal(after.revision,before.revision+1);assert.equal(after.data.title,'响应丢失仍保留');
  const receipt=await database().prepare('SELECT COUNT(*) n FROM operation_receipts WHERE user_id=? AND id=?').bind(session.user.userId,'update:'+operation.id).first<{n:number}>();assert.equal(receipt?.n,1);
  const changedPayload=await raw(operation.request!.path,{...operation.request!.body,data:{...after.data,title:'同标识不同输入'}});assert.equal(changedPayload.status,409);
  // Server verifies expected account independently of queue namespace.
  const rejected=await dispatchApi(new Request(origin+'/api/data',{method:'POST',headers:{...headers,'x-qingdan-expected-account':'another-synthetic-account'},body:JSON.stringify(operation.request!.body)}));assert.equal(rejected.status,409);assert.equal((await rejected.json()).code,'ACCOUNT_CHANGED');
 }finally{closeStorage();await rm(dir,{recursive:true,force:true})}
});
