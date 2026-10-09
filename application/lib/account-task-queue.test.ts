import {test}from'node:test';import assert from'node:assert/strict';
import{AccountTaskQueue,TaskQueueStore,projectedTasks,type TaskOperation}from'./account-task-queue';
import type{AppRecord,Bootstrap}from'./types';
class Storage {items=new Map<string,string>();get length(){return this.items.size}key(i:number){return [...this.items.keys()][i]||null}getItem(k:string){return this.items.get(k)||null}setItem(k:string,v:string){this.items.set(k,v)}removeItem(k:string){this.items.delete(k)}}
const task=(id='task-1'):AppRecord=>({id,kind:'task',ownerId:'synthetic-a',listId:'inbox:synthetic-a',data:{title:'原任务',status:'open',listId:'inbox:synthetic-a'},revision:1,deleted:false,updatedAt:'2026-10-09T00:00:00.000Z',role:'owner'});
function fixture(storage=new Storage()){
 let online=false,active=true,failAfterWrite=false,verified=0,writes=0,confirmations=0;
 let snapshot:Bootstrap={user:{userId:'synthetic-a',displayName:'fixture',email:'fixture@example.test',mode:'accounts'},records:[task()],history:[],attachments:[],members:[],serverTime:'2026-10-09T00:00:00Z'};
 const receipts=new Map<string,string>();const bodies:any[]=[];
 const store=new TaskQueueStore('https://synthetic.example.test','synthetic-a',storage);
 const deps={active:()=>active,verify:async()=>{verified++;if(!online)throw new Error('offline')},snapshot:async()=>structuredClone(snapshot),request:async(_path:string,body:any)=>{bodies.push(structuredClone(body));const key=body.clientOperationId,text=JSON.stringify(body);if(receipts.has(key)){assert.equal(receipts.get(key),text);return {replayed:true}}
  const old=snapshot.records.find(record=>record.id===body.id);if(body.expectedRevision!==(old?.revision||0))throw Object.assign(new Error('revision conflict'),{status:409});writes++;
  const record={...(old||task(body.id)),data:body.operation==='upsert'?body.data:{...old!.data,status:body.operation==='undoComplete'?'open':body.status||old!.data.status,...(body.operation==='complete'?{completedAt:'server-time',completionMutation:'server-mutation'}:{})},deleted:body.deleted??old?.deleted??false,revision:(old?.revision||0)+1};snapshot={...snapshot,records:[record,...snapshot.records.filter(r=>r.id!==record.id)]};receipts.set(key,text);if(failAfterWrite){failAfterWrite=false;throw new Error('response lost')}return {record}},change:()=>{},confirmed:(_s:Bootstrap)=>{confirmations++}};
 const queue=new AccountTaskQueue(store,deps);
 return{queue,store,deps,storage,bodies,online:()=>{online=true},offline:()=>{online=false},switchAccount:()=>{active=false},loseResponse:()=>{failAfterWrite=true},snapshot:()=>snapshot,setSnapshot:(s:Bootstrap)=>{snapshot=s},writes:()=>writes,verified:()=>verified,confirmations:()=>confirmations};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

test('offline create/edit/complete survive restart, remain visible, and automatically drain in order',async()=>{
 const f=fixture();const base={...task('new-task'),revision:0,data:{}};f.queue.enqueue('create',base,{title:'新任务',status:'open',listId:base.listId!},false,[]);await settle();
 let projected=projectedTasks(f.snapshot(),f.queue.entries());let record=projected.records.find(r=>r.id===base.id)!;f.queue.enqueue('edit',record,{...record.data,title:'编辑后的新任务'},false,projected.records);
 projected=projectedTasks(f.snapshot(),f.queue.entries());record=projected.records.find(r=>r.id===base.id)!;f.queue.enqueue('complete',record,{...record.data,status:'done',completedAt:'device-time'},false,projected.records);await settle();
 assert.equal(f.writes(),0);assert.equal(projectedTasks(f.snapshot(),f.queue.entries()).records.find(r=>r.id===base.id)?.data.status,'done');assert.equal(f.queue.entries().length,3);
 f.queue.stop();const restarted=new AccountTaskQueue(f.store,f.deps);f.online();await restarted.drain(true);assert.equal(f.writes(),3);assert.equal(restarted.entries().length,0);assert.equal(f.snapshot().records.find(r=>r.id===base.id)?.data.title,'编辑后的新任务');assert.equal(f.snapshot().records.find(r=>r.id===base.id)?.data.status,'done');
});

test('lost response replays the identical durable request without duplicate server effects',async()=>{
 const f=fixture();f.online();f.loseResponse();f.queue.enqueue('edit',task(),{...task().data,title:'保留修改'},false,[task()]);await settle();await f.queue.drain();assert.equal(f.writes(),1);assert.ok(f.queue.entries()[0].request);
 f.queue.stop();const restarted=new AccountTaskQueue(f.store,f.deps);await restarted.drain(true);assert.equal(f.writes(),1);assert.equal(restarted.entries().length,0);assert.deepEqual(f.bodies[0],f.bodies[1]);
});

test('same-field conflict preserves both sides and blocks dependent operations until explicit resolution',async()=>{
 const f=fixture();f.queue.enqueue('edit',task(),{...task().data,title:'本机标题'},false,[task()]);await settle();const projected=projectedTasks(f.snapshot(),f.queue.entries()).records[0];f.queue.enqueue('complete',projected,{...projected.data,status:'done'},false,[projected]);
 const remote={...task(),data:{...task().data,title:'服务器标题'},revision:2};f.setSnapshot({...f.snapshot(),records:[remote]});f.online();await f.queue.drain(true);
 assert.equal(f.writes(),0);assert.equal(f.queue.entries()[0].status,'conflict');assert.equal(f.queue.entries().length,2);assert.equal(f.snapshot().records[0].data.title,'服务器标题');assert.equal(projectedTasks(f.snapshot(),f.queue.entries()).records[0].data.title,'本机标题');
 f.queue.resolve(f.queue.entries()[0].id,remote,[remote]);await settle();await f.queue.drain(true);assert.equal(f.queue.entries().length,0);assert.equal(f.writes(),2);
});

test('non-overlapping server fields merge without overwriting them',async()=>{
 const f=fixture();f.queue.enqueue('edit',task(),{...task().data,title:'本机标题'},false,[task()]);await settle();f.setSnapshot({...f.snapshot(),records:[{...task(),revision:2,data:{...task().data,priority:3}}]});f.online();await f.queue.drain(true);assert.equal(f.snapshot().records[0].data.priority,3);assert.equal(f.snapshot().records[0].data.title,'本机标题');assert.equal(f.queue.entries().length,0);
});

test('server and account partitions cannot see or replay each other, local mode is rejected',async()=>{
 const f=fixture();f.queue.enqueue('edit',task(),{...task().data,title:'A'},false,[task()]);await settle();assert.equal(new TaskQueueStore('https://other.example.test','synthetic-a',f.storage).list().length,0);assert.equal(new TaskQueueStore(f.store.server,'synthetic-b',f.storage).list().length,0);
 f.online();f.setSnapshot({...f.snapshot(),user:{...f.snapshot().user,mode:'local'}});await f.queue.drain(true);assert.equal(f.writes(),0);assert.equal(f.queue.entries().length,1);
});

test('account switch while preflight is pending prevents the write and keeps the old queue',async()=>{
 const f=fixture();let release!:()=>void;f.deps.verify=()=>new Promise<void>(resolve=>{release=resolve});f.queue.enqueue('edit',task(),{...task().data,title:'A'},false,[task()]);f.switchAccount();release();await settle();assert.equal(f.writes(),0);assert.equal(f.queue.entries().length,1);
});

test('permission denial pauses retries and retains the exact operation',async()=>{
 const f=fixture();f.online();let attempts=0;f.deps.request=async()=>{attempts++;throw Object.assign(new Error('denied'),{status:403})};f.queue.enqueue('edit',task(),{...task().data,title:'A'},false,[task()]);await settle();await f.queue.drain(true);assert.equal(attempts,1);assert.equal(f.queue.entries().length,1);
});

test('repeated completion intent and parallel drain calls do not duplicate work',async()=>{
 const f=fixture();f.queue.enqueue('complete',task(),{...task().data,status:'done'},false,[task()]);f.queue.enqueue('complete',task(),{...task().data,status:'done'},false,[task()]);await settle();assert.equal(f.queue.entries().length,1);f.online();await Promise.all([f.queue.drain(true),f.queue.drain(true),f.queue.drain(true)]);assert.equal(f.writes(),1);
});

test('two windows with one durable operation converge through server idempotency',async()=>{
 const f=fixture();f.queue.enqueue('edit',task(),{...task().data,title:'once'},false,[task()]);await settle();const other=new AccountTaskQueue(f.store,f.deps);f.online();await Promise.all([f.queue.drain(true),other.drain(true)]);assert.equal(f.writes(),1);assert.equal(f.queue.entries().length,0);
});

test('storage failure never acknowledges an unpersisted task',()=>{
 const f=fixture();f.storage.setItem=()=>{throw new Error('quota')};assert.throws(()=>f.queue.enqueue('edit',task(),{...task().data,title:'A'},false,[task()]),/无法持久保存/);assert.equal(f.queue.entries().length,0);assert.equal(f.writes(),0);
});

test('retry backoff applies to repeated failures but explicit reconnect may try immediately',async()=>{
 const f=fixture();f.queue.enqueue('edit',task(),{...task().data,title:'A'},false,[task()]);await settle();const attempts=f.verified();await f.queue.drain();assert.equal(f.verified(),attempts);assert.ok(f.queue.nextAttempt>Date.now());f.online();await f.queue.drain(true);assert.equal(f.queue.entries().length,0);
});

test('subtree conflicts are preserved instead of completing changed children',async()=>{
 const f=fixture();const child={...task('child'),data:{...task('child').data,parentId:'task-1'}};f.setSnapshot({...f.snapshot(),records:[task(),child]});f.queue.enqueue('complete',task(),{...task().data,status:'done'},false,[task(),child]);await settle();f.setSnapshot({...f.snapshot(),records:[task(),{...child,revision:2,data:{...child.data,title:'较新子任务'}}]});f.online();await f.queue.drain(true);assert.equal(f.writes(),0);assert.equal(f.queue.entries()[0].status,'conflict');
});

test('offline completion followed by reopen reconciles server-generated completion metadata',async()=>{
 const f=fixture();f.queue.enqueue('complete',task(),{...task().data,status:'done',completedAt:'device-time'},false,[task()]);await settle();const projected=projectedTasks(f.snapshot(),f.queue.entries()).records[0];f.queue.enqueue('undoComplete',projected,{...projected.data,status:'open',completedAt:''},false,[projected]);f.online();await f.queue.drain(true);assert.equal(f.queue.entries().length,0);assert.equal(f.writes(),2);assert.equal(f.snapshot().records[0].data.status,'open');
});

test('authorization rejection during initial identity verification pauses all automatic attempts',async()=>{
 const f=fixture();let checks=0;f.deps.verify=async()=>{checks++;throw Object.assign(new Error('expired'),{status:401})};f.queue.enqueue('edit',task(),{...task().data,title:'A'},false,[task()]);await settle();await f.queue.drain(true);assert.equal(checks,1);assert.match(f.queue.lastError,/已暂停/);assert.equal(f.queue.entries().length,1);
});

test('response loss during the final authoritative read leaves replayable durable work',async()=>{
 const f=fixture();const original=f.deps.snapshot;let reads=0;f.deps.snapshot=async()=>{if(++reads===2)throw new Error('read response lost');return original()};f.online();f.queue.enqueue('edit',task(),{...task().data,title:'A'},false,[task()]);await settle();assert.equal(f.writes(),1);assert.equal(f.queue.entries().length,1);await f.queue.drain(true);assert.equal(f.writes(),1);assert.equal(f.queue.entries().length,0);
});

test('clearing another window operation during preflight prevents sending or resurrecting it',async()=>{
 const f=fixture();f.online();let release!:(snapshot:Bootstrap)=>void;f.deps.snapshot=()=>new Promise(resolve=>{release=resolve});f.queue.enqueue('edit',task(),{...task().data,title:'A'},false,[task()]);await settle();const id=f.queue.entries()[0].id;f.store.remove(id);release(f.snapshot());await settle();assert.equal(f.writes(),0);assert.equal(f.queue.entries().length,0);
});

test('clearing an in-flight operation cannot undo the server but prevents conflict requeue and retry',async()=>{
 const f=fixture();f.online();let reject!:(error:Error)=>void,attempts=0;f.deps.request=async()=>{attempts++;return new Promise((_resolve,r)=>{reject=r})};f.queue.enqueue('edit',task(),{...task().data,title:'A'},false,[task()]);await settle();f.store.remove(f.queue.entries()[0].id);reject(Object.assign(new Error('late conflict'),{status:409}));await settle();assert.equal(attempts,1);assert.equal(f.queue.entries().length,0);
});

test('a stable new task ID deduplicates repeated submission without suppressing equal-title distinct tasks',async()=>{
 const f=fixture(),base={...task('new-stable-id'),revision:0,data:{}};f.queue.enqueue('create',base,{title:'任务',status:'open'},false,[]);f.queue.enqueue('create',base,{title:'任务',status:'open'},false,[]);f.queue.enqueue('create',{...base,id:'other-new-id'},{title:'任务',status:'open'},false,[]);await settle();assert.equal(f.queue.entries().length,2);
});
