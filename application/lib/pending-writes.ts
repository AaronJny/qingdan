import type {AppRecord,RecordData} from './types';
export type PendingWrite={operation?:'trash'|'merge'|'mergeUndo'|'habitIncrement'|'comment'|'complete'|'undoComplete'|'skip';opInput?:{targetId?:string;habitId?:string;expectedHabitRevision?:number;date?:string;delta?:number;text?:string;mentions?:string[];status?:string;inputs?:{id:string;revision:number}[];expectedRevision?:number};id:string;recordId:string;kind:AppRecord['kind'];base:AppRecord;desired:RecordData;deleted:boolean;createdAt:string;reason:string};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function changedFields(write:PendingWrite):string[]{return [...new Set([...Object.keys(write.base.data),...Object.keys(write.desired)])].filter(k=>!equal((write.base.data as any)[k],(write.desired as any)[k]));}
/** Three-way field merge. Never overwrite a newer remote field implicitly. */
export function planPendingWrite(write:PendingWrite,latest:AppRecord|undefined){
 if(!latest)return {state:'missing' as const,fields:changedFields(write),conflicts:['record'],data:write.desired};
 if(write.operation==='merge'||write.operation==='mergeUndo'||write.operation==='habitIncrement'||write.operation==='comment'||write.operation==='complete'||write.operation==='undoComplete'||write.operation==='skip')return{state:'ready' as const,fields:[],conflicts:[],data:latest.data};
 const fields=changedFields(write),conflicts=fields.filter(k=>!equal((latest.data as any)[k],(write.base.data as any)[k])&&!equal((latest.data as any)[k],(write.desired as any)[k]));
 if(latest.deleted!==write.base.deleted&&latest.deleted!==write.deleted)conflicts.push('deleted');
 if(write.deleted&&!write.base.deleted&&latest.revision!==write.base.revision&&!equal(latest.data,write.base.data))conflicts.push('delete-newer-record');
 const data={...latest.data};for(const k of fields)(data as any)[k]=(write.desired as any)[k];
 if(fields.every(k=>equal((latest.data as any)[k],(write.desired as any)[k]))&&latest.deleted===write.deleted)return {state:'confirmed' as const,fields,conflicts:[],data};
 return {state:conflicts.length?'conflict' as const:'ready' as const,fields,conflicts,data};
}
