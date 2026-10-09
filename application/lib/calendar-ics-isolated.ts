import { Worker } from 'node:worker_threads';
import type { CalendarOccurrence,CalendarRange } from './calendar-ics';
export function parseCalendarIsolated(text:string,range:CalendarRange):Promise<CalendarOccurrence[]>{
 return new Promise((resolve,reject)=>{
  const packaged=import.meta.url.endsWith('.mjs');
  const worker=new Worker(new URL(packaged?'./calendar-worker.mjs':'./calendar-ics-worker.ts',import.meta.url),{workerData:{text,range},resourceLimits:{maxOldGenerationSizeMb:64},...(packaged?{}:{execArgv:['--import','tsx']})});
  let settled=false;
  const finish=(error?:Error,events?:CalendarOccurrence[])=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();if(error)reject(error);else resolve(events!)};
  const timer=setTimeout(()=>finish(new Error('日历解析超时；上次有效数据仍保留。')),5000);
  worker.on('message',result=>result.error?finish(new Error(result.error)):finish(undefined,result.events));
  worker.on('error',()=>finish(new Error('日历解析失败；上次有效数据仍保留。')));
  worker.on('exit',()=>{if(!settled)finish(new Error('日历解析未完成；上次有效数据仍保留。'))});
 });
}
