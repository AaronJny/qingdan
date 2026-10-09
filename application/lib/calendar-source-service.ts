import{wallTimeToInstant,isDateOnly}from'../assets/recurrence';
/** All private feeds live in the current instance's database, isolated by
 * owner. They never enter records, shared lists, exports, or mutation queues. */
import { randomUUID, createHash } from 'node:crypto';
import { database } from './storage';
import { calendarUrl, safeCalendarFetch, type CalendarFetcher } from './safe-calendar-fetch';
import { parseCalendarIsolated } from './calendar-ics-isolated';
import type { CalendarOccurrence, CalendarRange } from './calendar-ics';
import { refreshChineseHolidays, chineseHolidayCalendarYears, validateChineseHolidayCache, installChineseHolidayCache } from './chinese-holiday-source';
export class CalendarSourceError extends Error { constructor(message:string, public status=400){super(message);this.name='CalendarSourceError'} }
const HOUR=3600000,DAY=24*HOUR;
type FeedState={events?:CalendarOccurrence[];from?:string;through?:string;hash?:string;etag?:string;lastModified?:string;lastSuccessAt?:string;error?:string;blocked?:boolean;retryAt?:number};
type FeedRow={id:string;owner_id:string;name:string;url:string;time_zone:string;enabled:number;generation:number;state:string;last_attempt:number;next_attempt:number;lease_until:number};
export type FeedSummary={id:string;name:string;host:string;timeZone:string;enabled:boolean;readOnly:true;lastSuccessAt:string|null;lastAttemptAt:string|null;nextAttemptAt:string|null;error:string|null;blocked:boolean;eventCount:number;from:string|null;through:string|null};
const parse=(text:string):FeedState=>{try{return JSON.parse(text)}catch{return{error:'缓存损坏，请重新刷新来源。'}}};
const iso=(time:number)=>time?new Date(time).toISOString():null;
const flights=new Map<string,Promise<unknown>>(),controllers=new Map<string,AbortController>();
const summary=(row:FeedRow):FeedSummary=>{const s=parse(row.state);return{id:row.id,name:row.name,host:calendarUrl(row.url).hostname,timeZone:row.time_zone,enabled:!!row.enabled,readOnly:true,lastSuccessAt:s.lastSuccessAt||null,lastAttemptAt:iso(row.last_attempt),nextAttemptAt:iso(row.next_attempt),error:s.error||null,blocked:!!s.blocked,eventCount:s.events?.length||0,from:s.from||null,through:s.through||null}};
export function calendarSnapshotRange(now:number,timeZone:string):CalendarRange{const today=new Date(now);return{from:new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-1,1)).toISOString(),through:new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()+11,1)).toISOString(),timeZone}}
function retryAfter(value:string|undefined,now:number,min:number){if(!value)return now+min;const seconds=Number(value);const target=Number.isFinite(seconds)?now+Math.max(0,seconds)*1000:Date.parse(value);return Number.isFinite(target)?Math.max(now+min,target):now+min}
export async function listCalendarSources(owner:string){return(await database().prepare('SELECT * FROM calendar_subscriptions WHERE owner_id=? ORDER BY name,id').bind(owner).all<FeedRow>()).results.map(summary)}
export async function addCalendarSource(owner:string,input:{name:unknown;url:unknown;timeZone:unknown}){
 if(typeof input.name!=='string'||!input.name.trim()||input.name.length>100||typeof input.url!=='string'||typeof input.timeZone!=='string')throw new CalendarSourceError('请填写名称、HTTPS订阅地址和时区。');
 const url=calendarUrl(input.url).href;try{new Intl.DateTimeFormat('en',{timeZone:input.timeZone})}catch{throw new CalendarSourceError('时区无效。')}
 const count=await database().prepare('SELECT COUNT(*) n FROM calendar_subscriptions WHERE owner_id=?').bind(owner).first<{n:number}>();if((count?.n||0)>=10)throw new CalendarSourceError('每个账号最多订阅10个日历。');
 const existing=await database().prepare('SELECT id FROM calendar_subscriptions WHERE owner_id=? AND url=?').bind(owner,url).first<{id:string}>();if(existing)return existing.id;
 const id=randomUUID();const created=await database().prepare('INSERT OR IGNORE INTO calendar_subscriptions(id,owner_id,name,url,time_zone) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM calendar_subscriptions WHERE owner_id=?)<10').bind(id,owner,input.name.trim(),url,input.timeZone,owner).run();
 if(!created.meta.changes){const duplicate=await database().prepare('SELECT id FROM calendar_subscriptions WHERE owner_id=? AND url=?').bind(owner,url).first<{id:string}>();if(duplicate)return duplicate.id;throw new CalendarSourceError('每个账号最多订阅10个日历。');}
 await refreshCalendarSource(owner,id,{manual:true});return id;
}
export async function setCalendarSourceEnabled(owner:string,id:string,enabled:boolean){
 const result=await database().prepare('UPDATE calendar_subscriptions SET enabled=?,generation=generation+1 WHERE id=? AND owner_id=?').bind(enabled?1:0,id,owner).run();if(!result.meta.changes)throw new CalendarSourceError('日历订阅不存在。',404);
 if(!enabled)controllers.get(id)?.abort();
}
export async function removeCalendarSource(owner:string,id:string){await database().prepare('DELETE FROM calendar_subscriptions WHERE id=? AND owner_id=?').bind(id,owner).run();controllers.get(id)?.abort()}
export async function refreshCalendarSource(owner:string,id:string,options:{manual?:boolean;now?:number;fetcher?:CalendarFetcher;parser?:(text:string,range:CalendarRange)=>Promise<CalendarOccurrence[]>}={}){
 const key='feed:'+owner+':'+id;if(flights.has(key))return flights.get(key);
 const work=(async()=>{
  const db=database(),now=options.now??Date.now(),row=await db.prepare('SELECT * FROM calendar_subscriptions WHERE id=? AND owner_id=?').bind(id,owner).first<FeedRow>();
  if(!row)throw new CalendarSourceError('日历订阅不存在。',404);
  if(!row.enabled)return;
  const previous=parse(row.state);if(previous.blocked)return;
  const threshold=Math.max(options.manual?row.last_attempt+5*60000:row.next_attempt,previous.retryAt||0);
  if(threshold>now||row.lease_until>now)return;
  const claimed=await db.prepare('UPDATE calendar_subscriptions SET last_attempt=?,next_attempt=?,lease_until=? WHERE id=? AND owner_id=? AND generation=? AND enabled=1 AND lease_until<=? AND last_attempt=?').bind(now,now+HOUR,now+60000,id,owner,row.generation,now,row.last_attempt).run();if(!claimed.meta.changes)return;
  const controller=new AbortController();controllers.set(id,controller);let next=now+HOUR;
  let state:FeedState={...previous,error:undefined};
  try{
   const fetcher=options.fetcher||((url,init)=>safeCalendarFetch(url,{...init,signal:controller.signal}));
   // Re-fetch full snapshot periodically even with ETag so the rolling event
   // horizon never gets stuck behind a 304 response.
   const range=calendarSnapshotRange(now,row.time_zone),sameRange=range.from===previous.from&&range.through===previous.through;
   const headers:Record<string,string>={};if(sameRange&&previous.etag)headers['If-None-Match']=previous.etag;if(sameRange&&previous.lastModified)headers['If-Modified-Since']=previous.lastModified;
   const response=await fetcher(row.url,{headers,maxBytes:2*1024*1024});
   if(response.status===304){if(!previous.lastSuccessAt)throw new CalendarSourceError('来源返回无效缓存状态。');state={...previous,error:undefined,lastSuccessAt:iso(now)!};}
   else if(response.status===200){const events=await(options.parser||parseCalendarIsolated)(response.text,range);state={events,...range,hash:createHash('sha256').update(response.text).digest('hex'),etag:response.headers.etag,lastModified:response.headers['last-modified'],lastSuccessAt:iso(now)!,error:undefined};}
   else {next=retryAfter(response.headers['retry-after'],now,response.status===429?HOUR:HOUR);state={...previous,error:response.status===401||response.status===403?'来源已拒绝访问，自动刷新已停止；上次有效数据仍保留。':response.status===404||response.status===410?'来源已失效或撤销；上次有效数据仍保留。':response.status===429?'来源请求过多，已遵守其等待时间；上次有效数据仍保留。':'来源暂时不可用；上次有效数据仍保留。',retryAt:response.status===429?next:undefined,blocked:[401,403,404,410].includes(response.status)};}
  }catch{state={...previous,error:'刷新未完成（网络、内容或安全校验失败）；上次有效数据仍保留。'}}
  finally{controllers.delete(id)}
  // Generation prevents removal/disable while in flight from resurrecting or
  // applying a response. A process crash retains the persisted cooldown.
  if(!controller.signal.aborted)await db.prepare('UPDATE calendar_subscriptions SET state=?,next_attempt=?,lease_until=0 WHERE id=? AND owner_id=? AND generation=? AND enabled=1').bind(JSON.stringify(state),next,id,owner,row.generation).run();
  else await db.prepare('UPDATE calendar_subscriptions SET lease_until=0 WHERE id=? AND owner_id=?').bind(id,owner).run();
 })();flights.set(key,work);try{return await work}finally{flights.delete(key)}
}
export async function calendarSourceEvents(owner:string,from:string,through:string,timeZone='UTC'){
 let a:number,b:number;try{a=isDateOnly(from)?Date.parse(wallTimeToInstant({date:from,time:'00:00',timeZone},'compatible')):Date.parse(from);b=isDateOnly(through)?Date.parse(wallTimeToInstant({date:through,time:'00:00',timeZone},'compatible')):Date.parse(through)}catch{throw new CalendarSourceError('查询时区或日期范围无效。');}if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||b-a>370*864e5)throw new CalendarSourceError('查询日期范围无效。');
 const rows=(await database().prepare('SELECT * FROM calendar_subscriptions WHERE owner_id=? AND enabled=1').bind(owner).all<FeedRow>()).results;
 return rows.flatMap(row=>(parse(row.state).events||[]).filter(event=>event.allDay?event.start<through.slice(0,10)&&event.end>from.slice(0,10):Date.parse(event.start)<b&&(Date.parse(event.end)>a||event.end===event.start&&Date.parse(event.start)>=a)).map(event=>({...event,id:row.id+':'+event.id,sourceId:row.id,sourceName:row.name,readOnly:true as const})));
}
export async function holidaysEnabled(owner:string){return!!(await database().prepare('SELECT holidays_enabled FROM calendar_source_preferences WHERE owner_id=?').bind(owner).first<{holidays_enabled:number}>())?.holidays_enabled}
async function anyHolidaysEnabled(){return!!(await database().prepare('SELECT owner_id FROM calendar_source_preferences WHERE holidays_enabled=1 LIMIT 1').first())}
export async function setHolidaysEnabled(owner:string,enabled:boolean){
 await database().prepare("INSERT OR IGNORE INTO calendar_source_cache(name) VALUES('chinese-holidays')").run();
 await database().prepare('INSERT INTO calendar_source_preferences(owner_id,holidays_enabled) VALUES(?,?) ON CONFLICT(owner_id) DO UPDATE SET holidays_enabled=excluded.holidays_enabled').bind(owner,enabled?1:0).run();
 if(!await anyHolidaysEnabled()){controllers.get('holidays')?.abort();await database().prepare("UPDATE calendar_source_cache SET generation=generation+1 WHERE name='chinese-holidays'").run();}
}
export async function holidaySourceStatus(owner:string){
 const enabled=await holidaysEnabled(owner),row=await database().prepare("SELECT * FROM calendar_source_cache WHERE name='chinese-holidays'").first<{value:string;last_attempt:number;next_attempt:number}>();
 let cache:any,results:any[]=[];try{const stored=JSON.parse(row?.value||'{}');cache=validateChineseHolidayCache(stored.cache||stored);results=stored.results||[]}catch{cache=undefined}
 const publicCache=cache?{years:Object.fromEntries(Object.entries(cache.years).map(([year,value]:[string,any])=>[year,{sourceUrl:value.sourceUrl,sourceHash:value.sourceHash,verification:value.verification,lastSuccessAt:value.lastSuccessAt,officialEvidence:value.officialEvidence.map((paper:any)=>({url:paper.url,sha256:paper.sha256,publishedDate:paper.publishedDate,noticeNumber:paper.noticeNumber}))}])),results,pendingYears:Object.keys(cache.pending),origins:cache.origins}:undefined;
 return{enabled,lastAttemptAt:iso(row?.last_attempt||0),nextAttemptAt:iso(row?.next_attempt||0),cache:enabled?publicCache:undefined,calendarYears:enabled&&cache?chineseHolidayCalendarYears(cache):[]};
}
export async function refreshHolidaySource(options:{now?:number;fetcher?:CalendarFetcher}={}){
 const key='holidays';if(flights.has(key))return flights.get(key);
 const work=(async()=>{
  const db=database(),now=options.now??Date.now();if(!await anyHolidaysEnabled())return;
  const row=await db.prepare("SELECT * FROM calendar_source_cache WHERE name='chinese-holidays'").first<{value:string;last_attempt:number;next_attempt:number;lease_until:number;generation:number}>();if(!row||row.next_attempt>now||row.lease_until>now)return;
  const claim=await db.prepare("UPDATE calendar_source_cache SET last_attempt=?,next_attempt=?,lease_until=? WHERE name='chinese-holidays' AND next_attempt<=? AND lease_until<=? AND generation=?").bind(now,now+DAY,now+3*60000,now,now,row.generation).run();if(!claim.meta.changes)return;
  const controller=new AbortController();controllers.set('holidays',controller);
  const fetcher:CalendarFetcher=async(url,init)=>{if(controller.signal.aborted||!await anyHolidaysEnabled())throw new Error('Disabled');return(options.fetcher||((url,init)=>safeCalendarFetch(url,{...init,signal:controller.signal})))(url,init)};
  try{
   let cache:unknown;try{const stored=JSON.parse(row.value);cache=stored.cache||stored;if((cache as any)?.version!==1)cache=undefined}catch{cache=undefined}
   const result=await refreshChineseHolidays({cache,now:new Date(now),fetcher});
   if(!controller.signal.aborted&&await anyHolidaysEnabled()){
    await db.prepare("UPDATE calendar_source_cache SET value=?,lease_until=0 WHERE name='chinese-holidays' AND generation=?").bind(JSON.stringify({cache:result.cache,results:result.results}),row.generation).run();installChineseHolidayCache(result.cache);
   }
  }catch{/* Upstream safe errors remain in cache; do not log URLs or reset cooldown. */}
  finally{controllers.delete('holidays');await db.prepare("UPDATE calendar_source_cache SET lease_until=0 WHERE name='chinese-holidays'").run()}
 })();flights.set(key,work);try{return await work}finally{flights.delete(key)}
}
/** One instance-wide serial worker. Timer ticks query SQLite only. Each enabled
 * feed has a >=1h persisted cooldown; holiday batch has >=24h, including manual.
 * No calendar source is fetched when its persistent opt-in is off. */
export function startCalendarSourceJobs(){
 let stopped=false,busy=false,timer:ReturnType<typeof setTimeout>;
 const tick=async()=>{if(stopped||busy)return;busy=true;try{
  const cache=await database().prepare("SELECT value FROM calendar_source_cache WHERE name='chinese-holidays'").first<{value:string}>();if(cache){try{const stored=JSON.parse(cache.value);installChineseHolidayCache(validateChineseHolidayCache(stored.cache||stored))}catch{}}
  const rows=(await database().prepare('SELECT id,owner_id FROM calendar_subscriptions WHERE enabled=1 AND next_attempt<=? AND lease_until<=? ORDER BY next_attempt LIMIT 10').bind(Date.now(),Date.now()).all<{id:string;owner_id:string}>()).results;
  for(const row of rows){if(stopped)break;await refreshCalendarSource(row.owner_id,row.id)}
  if(!stopped)await refreshHolidaySource();
 }catch{/* No secret-bearing native exceptions go to logs. */}finally{busy=false;if(!stopped){timer=setTimeout(tick,60000+Math.floor(Math.random()*60000));timer.unref()}}};
 timer=setTimeout(tick,30000+Math.floor(Math.random()*270000));timer.unref();
 return()=>{stopped=true;clearTimeout(timer);for(const controller of controllers.values())controller.abort()};
}
