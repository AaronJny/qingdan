import{importGraphTodoJSON,type GraphImportedTask}from'@/assets/microsoft-todo-import';
import{operationKey,operationHash,readOperation}from'@/lib/operations';import{database}from'@/lib/storage';
import{identity,secureWrite,apiError,ApiError}from'@/lib/server';
import{ImportFormatError,importTaskCSV,importTodoistCSV,importICS,type ImportedTask,type CalendarDate}from'@/assets/importers';
import{instantToWallTime,wallTimeToInstant}from'@/assets/recurrence';
import{addDays}from'@/lib/types';import{restoreBackup}from'@/app/api/import/route';
export const dynamic='force-dynamic';
type FileTask=GraphImportedTask&{eventStart?:CalendarDate;eventEnd?:CalendarDate;startInstant?:string;endInstant?:string};
export async function POST(request:Request){try{
 secureWrite(request);const u=await identity(request);const b=await request.json()as any;
 if(!['csv','todoist','ics','graph-todo'].includes(b.format)||typeof b.text!=='string'||b.text.length>5e6)throw new ApiError('支持最大5MB的任务CSV、Todoist CSV、ICS或明确Graph任务JSON快照。');
 const zone=b.timeZone||'Asia/Shanghai';try{new Intl.DateTimeFormat('en',{timeZone:zone})}catch{throw new ApiError('时区无效。');}
 const fileHash=await operationHash({format:b.format,text:b.text,zone,listName:b.listName||''});const fileKey=operationKey('import-file',b.operationId||fileHash);const cached=await readOperation<{count:number}>(database(),u.userId,fileKey,fileHash);if(cached)return Response.json({...cached,replayed:true,warnings:[]});let parsed:{items:FileTask[];warnings:any[]};
 if(b.format==='ics'){
  const result=importICS(b.text);const local=(d:CalendarDate):CalendarDate=>d.time?d.utc?instantToWallTime(d.date+'T'+d.time+'Z',zone):d.timeZone?instantToWallTime(wallTimeToInstant({date:d.date,time:d.time,timeZone:d.timeZone},'compatible'),zone):{...d,timeZone:zone}:d;
  parsed={warnings:result.warnings,items:result.items.map((e,i)=>{
   const start=local(e.start),end=e.end?local(e.end):undefined;
   const duration=start.time&&end?.time?Math.round((Date.parse(wallTimeToInstant({...end,timeZone:zone},'compatible'))-Date.parse(wallTimeToInstant({...start,timeZone:zone},'compatible')))/60000):undefined;
   return{id:e.uid||'ics-'+i,title:e.title,description:e.description+(e.location?'\n地点：'+e.location:''),priority:0,tags:e.categories,list:b.listName||'导入的日历',section:'',status:e.status==='CANCELLED'?'wontdo':'open',dueDate:end?end.time?end.date:addDays(end.date,-1):start.date,dueTime:end?.time?.slice(0,5)||start.time?.slice(0,5),timeZone:zone,duration,eventStart:start,eventEnd:end,startInstant:e.start.time?(e.start.utc?e.start.date+'T'+e.start.time+'Z':wallTimeToInstant({date:e.start.date,time:e.start.time,timeZone:e.start.timeZone||zone},'compatible')):undefined,endInstant:e.end?.time?(e.end.utc?e.end.date+'T'+e.end.time+'Z':wallTimeToInstant({date:e.end.date,time:e.end.time,timeZone:e.end.timeZone||zone},'compatible')):undefined};
  })};
 }else if(b.format==='graph-todo')parsed=importGraphTodoJSON(b.text,{timeZone:zone,list:b.listName});else parsed=b.format==='todoist'?importTodoistCSV(b.text,{list:b.listName||'Todoist 导入'}):importTaskCSV(b.text);
 if(parsed.items.length>1000)throw new ApiError('一次最多导入1000条任务。');
 const records:any[]=[],listMap=new Map<string,string>();
 for(const t of parsed.items){const name=t.list||b.listName||'导入的任务';if(!listMap.has(name)){const id=crypto.randomUUID();listMap.set(name,id);records.push({id,kind:'list',deleted:false,data:{title:name,color:'#4878e8',sections:[...new Set(parsed.items.filter(x=>(x.list||b.listName||'导入的任务')===name).map(x=>x.section).filter(Boolean))],order:Date.now()}});}}
 const mapping=new Map(parsed.items.map(t=>[t.id,crypto.randomUUID()]));
 for(const t of parsed.items){const name=t.list||b.listName||'导入的任务',parent=t.parentId?parsed.items.find(x=>x.id===t.parentId):undefined;
  records.push({id:mapping.get(t.id),kind:'task',deleted:false,data:{title:t.title,description:t.description,status:t.status,taskType:'task',priority:t.priority,tags:t.tags,listId:listMap.get(name),section:t.section||'',parentId:parent&&(parent.list||b.listName||'导入的任务')===name?mapping.get(parent.id):'',dueDate:t.deadline||t.dueDate||'',startDate:t.startDate|| (t.eventEnd?t.eventStart?.date||'':t.deadline&&t.dueDate?t.dueDate:''),startTime:t.startTime||(t.eventEnd?t.eventStart?.time?.slice(0,5)||'':''),dueTime:t.dueTime?.slice(0,5)||'',duration:t.duration||0,startInstant:t.startInstant||'',endInstant:t.endInstant||'',timezone:t.timeZone||zone,order:Date.now(),comments:[],checkItems:t.checkItems||[],...(t.completedAt?{completedAt:t.completedAt}:{})}});
 }
 const response=await restoreBackup(u,{format:'qingdan',version:1,records},{key:fileKey,hash:fileHash});const data:any=await response.json();if(!response.ok)return Response.json(data,{status:response.status});return Response.json({...data,warnings:parsed.warnings});
 }catch(e){return apiError(e instanceof ImportFormatError?new ApiError(e.message):e)}}
