import type {AppRecord, Bootstrap, RecordData} from './types';
import {planPendingWrite} from './pending-writes';

export type TaskAction = 'create'|'edit'|'complete'|'undoComplete'|'trash';
export type TaskOperation = {
  version:1; id:string; accountId:string; server:string; sequence:number;
  action:TaskAction; recordId:string; base:AppRecord; desired:RecordData; deleted:boolean;
  affected:AppRecord[]; status:'pending'|'conflict'; reason?:string;
  request?:{path:string;body:Record<string,unknown>};
};
type StorageLike=Pick<Storage,'length'|'key'|'getItem'|'setItem'|'removeItem'>;
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
const equal=(a:unknown,b:unknown):boolean=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const managedFields=['completedAt','completionMutation','completionParent','trashRoot','trashMutation','trashRevision','trashSize','generationMutation','generationSize','recurrenceSource','recurrenceCompleted','startInstant','endInstant'];
export function taskQueueScope(server:string,accountId:string){return 'qingdan:task-outbox:v1:'+encodeURIComponent(server)+':'+encodeURIComponent(accountId)+':'}
/** Individual immutable operation IDs prevent another window's snapshot from erasing new work.
 * No credentials are stored. A failed durable write is never reported as an accepted edit. */
export class TaskQueueStore {
  readonly prefix:string;
  constructor(readonly server:string,readonly accountId:string,private storage:StorageLike){this.prefix=taskQueueScope(server,accountId)}
  list():TaskOperation[]{const entries:TaskOperation[]=[];for(let i=0;i<this.storage.length;i++){const key=this.storage.key(i);if(!key?.startsWith(this.prefix))continue;const item=JSON.parse(this.storage.getItem(key)||'null') as TaskOperation;if(item?.version===1&&item.accountId===this.accountId&&item.server===this.server&&item.base?.kind==='task'&&item.base.id===item.recordId)entries.push(item)}return entries.sort((a,b)=>a.sequence-b.sequence||a.id.localeCompare(b.id))}
  put(op:TaskOperation){if(op.accountId!==this.accountId||op.server!==this.server)throw new Error('队列身份不匹配，操作未保存。');this.storage.setItem(this.prefix+op.id,JSON.stringify(op))}
  remove(id:string){this.storage.removeItem(this.prefix+id)}
}
function descendants(records:AppRecord[],id:string,restoring=false){const root=records.find(record=>record.id===id);if(restoring&&root?.data.trashMutation)return records.filter(record=>record.id===id||(record.data.trashRoot===id&&record.data.trashMutation===root.data.trashMutation));const found=new Set([id]);for(let depth=0;depth<5;depth++)for(const record of records)if(!record.deleted&&record.data.parentId&&found.has(record.data.parentId))found.add(record.id);return records.filter(record=>found.has(record.id))}
export function projectedTasks(snapshot:Bootstrap,operations:TaskOperation[]):Bootstrap {
  const records=new Map(snapshot.records.map(record=>[record.id,record]));
  for(const op of operations){const prior=records.get(op.recordId)||op.base;
    const changed=Object.keys({...op.base.data,...op.desired}).filter(key=>!equal((op.base.data as any)[key],(op.desired as any)[key]));
    const data={...prior.data};for(const key of changed)(data as any)[key]=(op.desired as any)[key];
    records.set(op.recordId,{...prior,data:op.action==='create'?op.desired:data,deleted:op.deleted,listId:(op.desired.listId||prior.listId)||null});
    if(op.action==='undoComplete')for(const original of op.affected){const child=records.get(original.id);if(child&&child.id!==op.recordId)records.set(child.id,{...child,data:{...child.data,status:original.data.status,completedAt:original.data.completedAt}})}
    if(op.action==='complete'||op.action==='trash')for(const affected of op.affected){const child=records.get(affected.id);if(!child||child.id===op.recordId)continue;records.set(child.id,{...child,deleted:op.action==='trash'?op.deleted:child.deleted,data:op.action==='complete'&&child.data.status==='open'?{...child.data,status:op.desired.status,completedAt:op.desired.completedAt}:child.data})}
  }
  return {...snapshot,records:[...records.values()]};
}
export type QueueDependencies={
  active:()=>boolean; verify:()=>Promise<void>; snapshot:()=>Promise<Bootstrap>;
  request:(path:string,body:unknown)=>Promise<any>; change:()=>void;
  confirmed:(snapshot:Bootstrap)=>void; lock?:<T>(fn:()=>Promise<T>)=>Promise<T>;
};
export class AccountTaskQueue {
  private running:Promise<void>|null=null;private stopped=false;private failures=0;nextAttempt=0;lastError='';
  constructor(readonly store:TaskQueueStore,private deps:QueueDependencies){}
  entries(){return this.store.list()}
  stop(){this.stopped=true}
  private active(){return !this.stopped&&this.deps.active()}
  enqueue(action:TaskAction,base:AppRecord,desired:RecordData,deleted:boolean,records:AppRecord[]):AppRecord{
    if(!this.active())throw new Error('此账号已退出，操作未发出。');
    const entries=this.entries(),sequence=Math.max(Date.now(),...entries.map(op=>op.sequence+1));
    const existingCreate=action==='create'?entries.find(op=>op.action==='create'&&op.recordId===base.id):undefined;if(existingCreate){if(!equal(existingCreate.desired,desired))throw new Error('同一新任务标识已有不同输入，请先核对待同步任务。');return {...base,data:existingCreate.desired,deleted:existingCreate.deleted};}
    // Identical repeated completion/recycle clicks are one intent, without suppressing intentional creates.
    if(action!=='create'&&entries.some(op=>op.recordId===base.id&&op.action===action&&equal(op.desired,desired)&&op.deleted===deleted))return {...base,data:desired,deleted};
    const pendingCompletion=action==='undoComplete'?[...entries].reverse().find(op=>op.recordId===base.id&&op.action==='complete'):undefined;
    const pendingTrash=action==='trash'&&!deleted?[...entries].reverse().find(op=>op.recordId===base.id&&op.action==='trash'&&op.deleted):undefined;
    const affected=pendingCompletion?.affected||(pendingTrash?records.filter(record=>pendingTrash.affected.some(item=>item.id===record.id)):descendants(records,base.id,action==='trash'&&!deleted));
    const op:TaskOperation={version:1,id:crypto.randomUUID(),accountId:this.store.accountId,server:this.store.server,sequence,action,recordId:base.id,base:structuredClone(base),desired:structuredClone(desired),deleted,affected:structuredClone(affected),status:'pending'};
    try{this.store.put(op)}catch{throw new Error('设备无法持久保存待同步任务，输入尚未提交。请释放存储空间或导出后再试。')}
    this.deps.change();void this.drain();return {...base,data:desired,deleted,listId:desired.listId||base.listId};
  }
  /** Keep the same request after an unknown outcome. Never invent a new operation ID on retry. */
  async drain(force=false){if(this.running)return this.running;if(!this.active()||(!force&&Date.now()<this.nextAttempt)||!this.entries().some(op=>op.status==='pending'))return;
    const work=()=>this.flush();this.running=(this.deps.lock?this.deps.lock(work):work()).finally(()=>{this.running=null});return this.running;
  }
  private async flush(){try{
    await this.deps.verify();if(!this.active())return;
    const blocked=new Set<string>();
    for(const saved of this.entries()){
      if(!this.active())return;const op=this.entries().find(entry=>entry.id===saved.id);if(!op)continue;
      if(op.status==='conflict'){blocked.add(op.recordId);continue}if(blocked.has(op.recordId)||blocked.has(op.desired.parentId||''))continue;
      let snapshot:Bootstrap|undefined;
      try{
        if(!op.request){
          snapshot=await this.deps.snapshot();if(!this.active())return;this.assertIdentity(snapshot);this.deps.confirmed(snapshot);
          const latest=snapshot.records.find(record=>record.id===op.recordId);
          if(op.action==='create'){
            if(latest){throw Object.assign(new Error('任务标识已存在，请核对服务器版本与本机输入。'),{status:409})}
            op.request={path:'/api/data',body:{operation:'upsert',id:op.recordId,kind:'task',data:op.desired,expectedRevision:0,clientOperationId:op.id}};
          }else{
            if(!latest)throw Object.assign(new Error('任务不可访问或已被移除，本机修改仍保留。'),{status:409});
            if(op.action==='edit'){
              const plan=planPendingWrite({...op,kind:'task',createdAt:'',reason:'',operation:undefined},latest);
              if(plan.state==='confirmed'){this.store.remove(op.id);this.deps.change();continue}
              if(plan.state!=='ready')throw Object.assign(new Error('同一字段已在服务器修改：'+plan.conflicts.join('、')),{status:409});
              op.request={path:'/api/data',body:{operation:'upsert',id:op.recordId,kind:'task',data:plan.data,deleted:op.deleted,expectedRevision:latest.revision,clientOperationId:op.id}};
            }else{
              if(!equal(latest.data,op.base.data)||latest.deleted!==op.base.deleted)throw Object.assign(new Error('任务在服务器有较新修改，请核对后重新选择完成或回收操作。'),{status:409});
              const nowChildren=descendants(snapshot.records,op.recordId,op.action==='trash'&&!op.deleted).filter(record=>record.id!==op.recordId),oldChildren=op.affected.filter(record=>record.id!==op.recordId);
              if(op.action!=='undoComplete'&&(nowChildren.length!==oldChildren.length||nowChildren.some(record=>{const old=oldChildren.find(item=>item.id===record.id);return !old||!equal(record.data,old.data)||record.deleted!==old.deleted})))throw Object.assign(new Error('子任务已在服务器变化，请核对整组任务后继续。'),{status:409});
              op.request=op.action==='trash'?{path:'/api/task-trash',body:{id:op.recordId,expectedRevision:latest.revision,deleted:op.deleted,clientOperationId:op.id}}:{path:'/api/data',body:{operation:op.action,id:op.recordId,expectedRevision:latest.revision,status:op.desired.status,clientOperationId:op.id}};
            }
          }
          if(!this.active())return;if(!this.entries().some(entry=>entry.id===op.id))continue;this.store.put(op);
        }
        if(!this.active())return;if(!this.entries().some(entry=>entry.id===op.id))continue;
        try{await this.deps.request(op.request.path,op.request.body)}catch(error){if((error as any).status!==409||!this.active()||!this.entries().some(entry=>entry.id===op.id))throw error;/* Another tab may have committed between receipt lookup and the revision guard. */await this.deps.request(op.request.path,op.request.body)}
        if(!this.active())return;
        // A full read before acknowledging keeps related tasks/recurrences authoritative. If it fails,
        // the persisted request is replayed against its server receipt after restart.
        snapshot=await this.deps.snapshot();if(!this.active())return;this.assertIdentity(snapshot);
        this.reconcileDependentMetadata(op,snapshot);this.store.remove(op.id);this.deps.confirmed(snapshot);this.deps.change();this.failures=0;this.nextAttempt=0;this.lastError='';
      }catch(error){
        if(!this.active())return;if(!this.entries().some(entry=>entry.id===op.id))continue;const e=error as any;
        if(e.status===401||e.status===403||e.code==='ACCOUNT_CHANGED'){this.stop();throw error}
        if(e.status>=400&&e.status<500&&e.status!==408&&e.status!==429){
          // Re-read to show both versions; never force a field or transition over a server conflict.
          op.status='conflict';op.reason=e.message||'服务器拒绝此修改，请核对。';this.store.put(op);blocked.add(op.recordId);this.deps.change();
          try{const latest=await this.deps.snapshot();if(this.active()){this.assertIdentity(latest);this.deps.confirmed(latest)}}catch{}
          continue;
        }
        throw error;
      }
    }
  }catch(error){const e=error as any;this.lastError=e.message||'连接中断，任务操作仍保留';if(e.status===401||e.status===403||e.code==='ACCOUNT_CHANGED'){this.stopped=true;this.lastError='登录或权限需要重新核对。此账号任务队列已暂停，输入仍保留。'}this.failures++;this.nextAttempt=Date.now()+Math.min(60000,1000*2**Math.min(this.failures-1,6));this.deps.change()}}
  private reconcileDependentMetadata(done:TaskOperation,snapshot:Bootstrap){
    for(const pending of this.entries()){
      if(pending.id===done.id||pending.sequence<=done.sequence||pending.request)continue;
      let changed=false;
      const reconcile=(base:AppRecord,desired?:RecordData)=>{
        const before=done.affected.find(record=>record.id===base.id);if(base.id!==done.recordId&&!before)return;
        const remote=snapshot.records.find(record=>record.id===base.id);if(!remote)return;
        const expected=base.id===done.recordId?done.desired:done.action==='complete'&&before!.data.status==='open'?{...before!.data,status:done.desired.status,completedAt:done.desired.completedAt}:before!.data;
        for(const key of managedFields)if(equal((base.data as any)[key],(expected as any)[key])){if(desired&&equal((desired as any)[key],(base.data as any)[key]))(desired as any)[key]=(remote.data as any)[key];(base.data as any)[key]=(remote.data as any)[key];changed=true}
        base.revision=remote.revision;
      };
      reconcile(pending.base,pending.desired);for(const affected of pending.affected)reconcile(affected);
      if(changed)this.store.put(pending);
    }
  }
  private assertIdentity(snapshot:Bootstrap){if(snapshot.user.userId!==this.store.accountId||snapshot.user.mode!=='accounts')throw Object.assign(new Error('服务器账号或运行模式已变化，待同步任务未发出。'),{code:'ACCOUNT_CHANGED',status:401})}
  resolve(id:string,latest:AppRecord,records:AppRecord[]){if(!this.active())throw new Error('请重新登录原账号后核对队列。');const op=this.entries().find(entry=>entry.id===id);if(!op||op.status!=='conflict')return;if(latest.id!==op.recordId)throw new Error('待核对任务不匹配。');
    // Replacement retains ordering and is durable before retiring the failed immutable request.
    const replacement:TaskOperation={...op,id:crypto.randomUUID(),action:op.action==='create'?'edit':op.action,base:structuredClone(latest),affected:structuredClone(descendants(records,latest.id,op.action==='trash'&&!op.deleted)),status:'pending',reason:undefined,request:undefined};
    // Keep the user's changed fields, never copy stale server-managed metadata into the new attempt.
    if(op.action==='edit'||op.action==='create'){const desired={...latest.data};for(const key of Object.keys({...op.base.data,...op.desired}))if(!equal((op.base.data as any)[key],(op.desired as any)[key]))(desired as any)[key]=(op.desired as any)[key];replacement.desired=desired}else replacement.desired=op.action==='trash'?{...latest.data}:{...latest.data,status:op.desired.status,completedAt:op.desired.completedAt};
    this.store.put(replacement);this.store.remove(id);this.deps.change();void this.drain(true);
  }
  discardRecord(recordId:string){for(const op of this.entries())if(op.recordId===recordId)this.store.remove(op.id);this.deps.change()}
}
