import ICAL from 'ical.js';
import { Temporal } from '@js-temporal/polyfill';
import { createHash } from 'node:crypto';
export type CalendarOccurrence = { id:string; title:string; description:string; location:string; start:string; end:string; allDay:boolean; timeZone:string; readOnly:true };
export type CalendarRange = { from:string; through:string; timeZone:string };
export class CalendarParseError extends Error { constructor(message='日历内容格式无效；上次有效日程仍保留。'){super(message);this.name='CalendarParseError'} }
const safeText=(value:unknown,max:number)=>String(value||'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').slice(0,max);
function validZone(zone:string){try{new Intl.DateTimeFormat('en',{timeZone:zone});return true}catch{return false}}
/** Expands a bounded snapshot. No tasks, reminders, attachments, participants,
 * alarms or links are imported or executed. DTEND is exclusive. */
export function parseCalendarIcs(text:string, range:CalendarRange): CalendarOccurrence[] {
 try {
  if(Buffer.byteLength(text)>2*1024*1024||text.split('\n').length>50000)throw new CalendarParseError('日历过大，无法安全展开。');
  if(!/^BEGIN:VCALENDAR\r?\n/i.test(text.trim())||!/END:VCALENDAR\s*$/i.test(text))throw new CalendarParseError();
  const from=Date.parse(range.from),through=Date.parse(range.through);
  if(!Number.isFinite(from)||!Number.isFinite(through)||through<=from||through-from>370*864e5||!validZone(range.timeZone))throw new CalendarParseError('日历查询范围或时区无效。');
  let depth=0;for(const line of text.split(/\r?\n/)){if(/^BEGIN:/i.test(line)&&++depth>30)throw new CalendarParseError();if(/^END:/i.test(line)&&--depth<0)throw new CalendarParseError()}if(depth)throw new CalendarParseError();
  const calendar=new ICAL.Component(ICAL.parse(text));
  if(calendar.name!=='vcalendar'||calendar.getFirstPropertyValue('version')!=='2.0')throw new CalendarParseError();
  const components=calendar.getAllSubcomponents('vevent');if(components.length>4000)throw new CalendarParseError('日历事件超过安全上限。');
  const selected=new Map<string,ICAL.Component>();
  for(const component of components){
    for(const name of ['dtstart','dtend','recurrence-id','exdate','rdate'])for(const property of component.getAllProperties(name))for(const raw of property.toJSON().slice(3)){if(typeof raw!=='string')throw new CalendarParseError('日历日期格式不受支持。');if(property.type==='date')Temporal.PlainDate.from(raw,{overflow:'reject'});else if(property.type==='date-time'){if(raw.endsWith('Z'))Temporal.Instant.from(raw);else Temporal.PlainDateTime.from(raw,{overflow:'reject'});}else throw new CalendarParseError('日历日期格式不受支持。');}
    const uid=component.getFirstPropertyValue('uid');if(typeof uid!=='string'||!uid||uid.length>2048)throw new CalendarParseError();
    const rid=component.getFirstPropertyValue('recurrence-id')?.toString()||'';
    const key=uid+'\u0000'+rid, previous=selected.get(key);
    if(previous){
      const rank=(c:ICAL.Component)=>[Number(c.getFirstPropertyValue('sequence')||0),String(c.getFirstPropertyValue('dtstamp')||'')];
      const a=rank(previous),b=rank(component);const compare=Number(b[0])-Number(a[0])||String(b[1]).localeCompare(String(a[1]));
      if(compare<0)continue;
      if(compare===0){if(previous.toString()!==component.toString())throw new CalendarParseError('来源中有版本相同但内容冲突的重复事件。');continue;}
    }
    selected.set(key,component);
  }
  const output:CalendarOccurrence[]=[];let steps=0;
  const canceled=(c:ICAL.Component)=>c.getFirstPropertyValue('status')==='CANCELLED';
  const tzOf=(c:ICAL.Component,property:string,fallback:string)=>{
    const p=c.getFirstProperty(property),date=p?.getFirstValue() as ICAL.Time|undefined;
    if(date?.zone?.tzid&&date.zone.tzid!=='floating')return date.zone.tzid;
    return String(p?.getParameter('tzid')||fallback);
  };
  const stamp=(t:ICAL.Time,c:ICAL.Component,property:string,fallback:string)=>{
    if(t.isDate)return t.toString();
    const zone=tzOf(c,property,fallback);
    if(t.zone&&t.zone.tzid!=='floating')return new Date(t.toUnixTime()*1000).toISOString();
    if(!validZone(zone))throw new CalendarParseError('日历包含缺少定义的时区；请在来源中导出时区定义。');
    return Temporal.PlainDateTime.from(t.toString()).toZonedDateTime(zone,{disambiguation:'compatible'}).toInstant().toString();
  };
  const append=(event:ICAL.Event,start:ICAL.Time,end:ICAL.Time,original:ICAL.Time)=>{
    const component=event.component;if(canceled(component))return;
    const zone=tzOf(component,'dtstart',range.timeZone),startValue=stamp(start,component,'dtstart',zone),endValue=stamp(end,component,'dtend',zone);
    if(start.isDate!==end.isDate||endValue<startValue)throw new CalendarParseError();
    const startMs=Date.parse(startValue),endMs=Date.parse(endValue);
    if(endMs<from||startMs>=through||endMs===from&&endMs!==startMs)return;
    if(output.length>=10000)throw new CalendarParseError('日历展开事件超过上限，请缩小日历来源。');
    output.push({id:createHash('sha256').update(event.uid+'\u0000'+original.toString()).digest('hex'),title:safeText(event.summary,1000)||'未命名日程',description:safeText(event.description,10000),location:safeText(event.location,1000),start:startValue,end:endValue,allDay:start.isDate,timeZone:zone,readOnly:true});
  };
  for(const component of selected.values()){
    if(component.hasProperty('recurrence-id'))continue;
    if(canceled(component))continue;
    if(!component.hasProperty('dtstart'))throw new CalendarParseError();
    const event=new ICAL.Event(component,{exceptions:[],strictExceptions:true});
    const exceptions=[...selected.values()].filter(c=>c.getFirstPropertyValue('uid')===event.uid&&c.hasProperty('recurrence-id'));
    for(const exception of exceptions){if(!exception.hasProperty('dtstart')){if(!canceled(exception))throw new CalendarParseError();exception.addPropertyWithValue('dtstart',exception.getFirstPropertyValue('recurrence-id')!)}event.relateException(exception)}
    const rules=component.getAllProperties('rrule');
    if(rules.length>1||component.hasProperty('exrule'))throw new CalendarParseError('来源使用了暂不支持的重复规则；未覆盖旧日程。');
    for(const property of rules){const rule=property.getFirstValue() as ICAL.Recur;
      if(!['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(rule.freq)||rule.interval<1||rule.interval>10000||rule.count!==null&&rule.count<1)throw new CalendarParseError('日历只支持按日、周、月、年的重复规则。');
      // Keep hostile combinatorial rules bounded; outer worker also has a hard
      // wall-clock timeout to contain parser/recurrence worst cases.
      if(property.toString().length>2048)throw new CalendarParseError();
    }
    if(!event.isRecurring()){append(event,event.startDate,event.endDate,event.startDate);continue;}
    const iterator=event.iterator();
    while(true){if(++steps>60000)throw new CalendarParseError('重复日程跨度过大，无法安全展开。');const occurrence=iterator.next();if(!occurrence)break;
      if(Date.parse(stamp(occurrence,component,'dtstart',range.timeZone))>=through)break;
      const details=event.getOccurrenceDetails(occurrence);append(details.item,details.startDate,details.endDate,occurrence);
    }
    // A moved exception may cross the requested boundary even when the original
    // occurrence lies outside it. Include it explicitly, then deduplicate.
    for(const exception of exceptions){const ex=new ICAL.Event(exception,{exceptions:[]});if(!canceled(exception))append(ex,ex.startDate,ex.endDate,ex.recurrenceId)}
  }
  // An orphan exception is not silently interpreted as a whole series.
  for(const component of selected.values())if(component.hasProperty('recurrence-id')&&!selected.has(String(component.getFirstPropertyValue('uid'))+'\u0000'))throw new CalendarParseError('日历重复例外缺少原始事件。');
  return [...new Map(output.map(event=>[event.id,event])).values()].sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
 } catch(error){if(error instanceof CalendarParseError)throw error;throw new CalendarParseError();}
}
