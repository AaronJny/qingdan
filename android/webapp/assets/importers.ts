/** File snapshots only. No continuous or two-way synchronization. No network access. */
export type ImportWarning = { row?: number; code: string; message: string };
export type ImportResult<T> = { items: T[]; warnings: ImportWarning[] };
export type ImportedTask = {
  id: string; title: string; description: string; priority: 0|1|2|3; tags: string[];
  list: string; section: string; parentId?: string; dueDate?: string; dueTime?: string;
  timeZone?: string;startDate?:string;startTime?:string;startInstant?:string;endInstant?:string; deadline?: string; duration?: number; status: 'open'|'done'|'wontdo';
};
export class ImportFormatError extends Error { constructor(message: string) { super(message); this.name = 'ImportFormatError'; } }
const LIMIT = 10_000_000;
/** RFC4180 quoted fields, escaped quotes, multiline fields; accepts LF as well as CRLF. */
export function parseCSV(input: string): string[][] {
  if (input.length > LIMIT) throw new ImportFormatError('CSV exceeds 10 MB character limit');
  const text = input.replace(/^\uFEFF/, '');
  if (!text) return [];
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false, started = false;
  const push = () => { row.push(field); field = ''; closed = false; started = false; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += ch;
    } else if (ch === ',') push();
    else if (ch === '\r' || ch === '\n') { if (ch === '\r' && text[i+1] === '\n') i++; push(); rows.push(row); row = []; }
    else if (ch === '"') { if (started || closed) throw new ImportFormatError(`Unexpected quote at character ${i+1}`); quoted = true; started = true; }
    else { if (closed) throw new ImportFormatError(`Unexpected data after quoted field at character ${i+1}`); field += ch; started = true; }
  }
  if (quoted) throw new ImportFormatError('Unterminated quoted CSV field');
  if (row.length || started || closed || field || text.endsWith(',')) { push(); rows.push(row); }
  return rows;
}
/** Raw data-preserving CSV. Spreadsheet formula-safe export is explicitly opt-in. */
export function stringifyCSV(rows: readonly (readonly unknown[])[], options: { spreadsheetSafe?: boolean } = {}): string {
  return rows.map(row => row.map(value => {
    let s = value == null ? '' : String(value);
    if (options.spreadsheetSafe && /^[\s]*[=+\-@]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n') + (rows.length ? '\r\n' : '');
}
export function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s.startsWith('0000')) return false;
  const d = new Date(s + 'T00:00:00Z'); return Number.isFinite(+d) && d.toISOString().slice(0,10) === s;
}
export function validTime(s: string): boolean { return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(s); }
function table(input: string) {
  const rows = parseCSV(input); const headers = (rows.shift() || []).map(h => h.trim().toLowerCase());
  if (new Set(headers).size !== headers.length || headers.includes('')) throw new ImportFormatError('CSV headers must be nonempty and unique');
  return { headers, rows };
}
function warn(warnings: ImportWarning[], row: number|undefined, code: string, message: string) { warnings.push({row,code,message}); }
function dateField(value: string, warnings: ImportWarning[], row: number, name: string): string|undefined {
  if (!value) return undefined;
  if (validDate(value)) return value;
  warn(warnings,row,'UNSUPPORTED_DATE',`${name}: only YYYY-MM-DD is supported; retained in warning: ${value}`); return undefined;
}
function timeField(value: string, warnings: ImportWarning[], row: number): string|undefined {
  if (!value) return undefined;
  if (validTime(value)) return value;
  warn(warnings,row,'INVALID_TIME',`Invalid time: ${value}`); return undefined;
}
/** Generic schema: title, description, date, time, priority(0..3), tags(JSON array or semicolon), list.
 * Roundtrip extensions: id, parent_id, section, timezone, status, deadline, duration. */
export function importTaskCSV(input: string): ImportResult<ImportedTask> {
  const { headers, rows } = table(input); const items: ImportedTask[] = [], warnings: ImportWarning[] = [];
  if (!headers.includes('title')) throw new ImportFormatError('Missing title column');
  const supported = new Set(['title','description','date','time','priority','tags','list','id','parent_id','section','timezone','status','deadline','duration','start_date','start_time','start_instant','end_instant']);
  headers.forEach(h => { if (!supported.has(h)) warn(warnings,1,'UNSUPPORTED_COLUMN',`Column ${h} is not imported`); });
  const seen = new Set<string>();
  rows.forEach((cells,index) => {
    const row = index+2; if (cells.every(c => !c)) return;
    if (cells.length !== headers.length) warn(warnings,row,'COLUMN_COUNT','Row has a different number of columns');
    const get = (name: string) => cells[headers.indexOf(name)] || '';
    if (!get('title').trim()) { warn(warnings,row,'EMPTY_TITLE','Empty-title task skipped'); return; }
    let id = get('id') || `csv-${row}`; if (seen.has(id)) { warn(warnings,row,'DUPLICATE_ID',`Duplicate id ${id}; generated a replacement`); id = `csv-${row}`; while (seen.has(id)) id += '-'; } seen.add(id);
    const p = get('priority'); const priority = /^[0-3]$/.test(p) ? Number(p) as ImportedTask['priority'] : 0;
    if (p && !/^[0-3]$/.test(p)) warn(warnings,row,'INVALID_PRIORITY',`Priority ${p} replaced with 0`);
    let tags: string[] = [];
    if (get('tags').trim().startsWith('[')) { try { const t = JSON.parse(get('tags')); if (!Array.isArray(t) || !t.every(v => typeof v === 'string')) throw Error(); tags = t; } catch { warn(warnings,row,'INVALID_TAGS','Tags JSON must be an array of strings'); } }
    else tags = get('tags').split(';').map(t => t.trim()).filter(Boolean);
    const status = get('status') || 'open';
    if (!['open','done','wontdo'].includes(status)) warn(warnings,row,'INVALID_STATUS',`Status ${status} replaced with open`);
    const dueDate = dateField(get('date'),warnings,row,'date'); const dueTime = timeField(get('time'),warnings,row);
    if (dueTime && !dueDate) warn(warnings,row,'TIME_WITHOUT_DATE','Time omitted because there is no valid date');
    const startDate=dateField(get('start_date'),warnings,row,'start_date');const startTime=timeField(get('start_time'),warnings,row);const instant=(field:string)=>{const v=get(field);if(!v)return undefined;if(/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v)))return v;warn(warnings,row,'INVALID_INSTANT',field+' is not an ISO timestamp');return undefined};const startInstant=instant('start_instant'),endInstant=instant('end_instant');const duration = get('duration');
    if (duration && (!/^\d+$/.test(duration) || Number(duration) > 525600)) warn(warnings,row,'INVALID_DURATION','Duration must be nonnegative minutes up to 525600');
    items.push({...(startDate?{startDate}:{}),...(startTime&&startDate?{startTime}:{}),...(startInstant?{startInstant}:{}),...(endInstant?{endInstant}:{}),id,title:get('title'),description:get('description'),priority,tags:[...new Set(tags)],list:get('list'),section:get('section'),parentId:get('parent_id')||undefined,dueDate,dueTime:dueDate?dueTime:undefined,timeZone:get('timezone')||undefined,deadline:dateField(get('deadline'),warnings,row,'deadline'),duration:duration && /^\d+$/.test(duration) && Number(duration)<=525600 ? Number(duration):undefined,status:['open','done','wontdo'].includes(status)?status as ImportedTask['status']:'open'});
  });
  for (const item of items) if (item.parentId) {
    let current: ImportedTask|undefined = item; const visited = new Set<string>();
    while (current?.parentId) { if (visited.has(current.id)) { warn(warnings,undefined,'PARENT_CYCLE',`Parent cycle for ${item.id}; relationship removed`); item.parentId = undefined; break; } visited.add(current.id); const parent = items.find(t => t.id === current!.parentId); if (!parent) { warn(warnings,undefined,'MISSING_PARENT',`Parent ${current.parentId} not found for ${item.id}`); item.parentId = undefined; break; } current = parent; }
  }
  return {items,warnings};
}
export function exportTaskCSV(tasks: readonly ImportedTask[], options: { spreadsheetSafe?: boolean } = {}): string {
  const headers = ['id','title','description','date','time','priority','tags','list','section','parent_id','timezone','status','deadline','duration','start_date','start_time','start_instant','end_instant'];
  return stringifyCSV([headers,...tasks.map(t => [t.id,t.title,t.description,t.dueDate,t.dueTime,t.priority,JSON.stringify(t.tags),t.list,t.section,t.parentId,t.timeZone,t.status,t.deadline,t.duration,t.startDate,t.startTime,t.startInstant,t.endInstant])],options);
}
/** Todoist documented TYPE/CONTENT/INDENT/PRIORITY dialect, imported as a snapshot.
 * ISO dates only; natural-language/recurring DATE is explicitly warned, never guessed. */
export function importTodoistCSV(input: string, options: { list?: string } = {}): ImportResult<ImportedTask> {
  const { headers, rows } = table(input); const items: ImportedTask[] = [], warnings: ImportWarning[] = [];
  if (!headers.includes('type') || !headers.includes('content')) throw new ImportFormatError('Missing Todoist TYPE or CONTENT column');
  const supported = new Set(['type','content','description','priority','indent','date','date_lang','timezone','duration','duration_unit','deadline','deadline_lang','author','responsible']);
  headers.forEach(h => { if (!supported.has(h)) warn(warnings,1,'UNSUPPORTED_COLUMN',`Todoist ${h} is not imported`); });
  let section = ''; const parents: string[] = [];let lastTask:ImportedTask|undefined;
  rows.forEach((cells,index) => {
    const row=index+2, get=(h:string)=>cells[headers.indexOf(h)]||'', type=get('type').toLowerCase();
    if(cells.every(c=>!c)) return;
    if (cells.length !== headers.length) warn(warnings,row,'COLUMN_COUNT','Row has a different number of columns');
    if (type === 'section') { section=get('content'); parents.length=0;lastTask=undefined;if(get('description'))warn(warnings,row,'SECTION_DESCRIPTION_SOURCE','Section description is not mapped to task content; source file retains it'); return; }
    if(type==='note'){if(lastTask){lastTask.description+='\n\nTodoist源评论（保留文本，未绑定青单身份）：\n'+(get('author')?get('author')+'：':'')+get('content');warn(warnings,row,'COMMENT_AS_SOURCE','Comment text retained in task description, not a forged Qingdan comment');}else warn(warnings,row,'ORPHAN_NOTE','Note lacks a preceding task; source file retains it');return;}if (type !== 'task') { lastTask=undefined;warn(warnings,row,'UNSUPPORTED_ROW',`Todoist ${type||'empty'} row skipped (comments/meta are not tasks)`); return; }
    let title=get('content'); const tags: string[]=[];
    title=title.replace(/(?:^|\s)@([^\s@]+)/g,(_,tag)=>{tags.push(tag);return '';}).trim();
    if (!title) {warn(warnings,row,'EMPTY_TITLE','Empty-title task skipped');return;}
    const indent=get('indent')||'1'; let level=/^[1-4]$/.test(indent)?Number(indent):1;
    if (!/^[1-4]$/.test(indent)) warn(warnings,row,'INVALID_INDENT','Todoist indent must be 1..4; imported at top level');
    if(level>1&&!parents[level-2]) {warn(warnings,row,'MISSING_PARENT','Indent jumps without a parent; imported at top level');level=1;}
    const p=get('priority')||'1'; if(!/^[1-4]$/.test(p))warn(warnings,row,'INVALID_PRIORITY','Invalid Todoist priority replaced with none');
    const date=get('date'); let dueDate:string|undefined,dueTime:string|undefined;
    const match=date.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?$/);
    if(match){dueDate=dateField(match[1],warnings,row,'DATE');dueTime=timeField(match[2]||'',warnings,row);}
    else if(date)warn(warnings,row,'UNSUPPORTED_DATE',`Todoist natural-language or recurring DATE is not interpreted: ${date}`);
    const duration=get('duration'),unit=get('duration_unit').toLowerCase(); let durationMinutes:number|undefined;
    if(duration){if(/^\d+$/.test(duration)&&Number(duration)<=525600&&(!unit||unit==='minute'))durationMinutes=Number(duration);else warn(warnings,row,'UNSUPPORTED_DURATION','Only integral duration in minutes is imported');}
    const id=`todoist-${row}`;let description=get('description');if(date&&!match)description+='\n\nTodoist原日期/重复文本（未自动启用）：'+date;for(const field of['author','responsible'])if(get(field))description+='\nTodoist原'+field+'（未绑定青单身份）：'+get(field);
    items.push({id,title,description,priority:/^[1-4]$/.test(p)?(4-Number(p)) as ImportedTask['priority']:0,tags:[...new Set(tags)],list:options.list||'',section,parentId:level>1?parents[level-2]:undefined,dueDate,dueTime:dueDate?dueTime:undefined,timeZone:get('timezone')||undefined,deadline:dateField(get('deadline'),warnings,row,'DEADLINE'),duration:durationMinutes,status:'open'});
    parents.length=level;parents[level-1]=id;lastTask=items.at(-1);
  });
  return {items,warnings};
}
export type CalendarDate = { date: string; time?: string; timeZone?: string; utc?: boolean };
export type CalendarSnapshot = { uid: string; title: string; description: string; location?: string; start: CalendarDate; end?: CalendarDate; categories: string[]; status?: 'TENTATIVE'|'CONFIRMED'|'CANCELLED' };
const escapeICS=(s:string)=>s.replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const unescapeICS=(s:string)=>s.replace(/\\([nN,;\\])/g,(_,c)=>c.toLowerCase()==='n'?'\n':c);
function splitUnescaped(s:string,delimiter:string):string[]{const result:string[]=[];let start=0,escaped=false;for(let i=0;i<s.length;i++){if(escaped){escaped=false;continue;}if(s[i]==='\\'){escaped=true;continue;}if(s[i]===delimiter){result.push(s.slice(start,i));start=i+1;}}result.push(s.slice(start));return result;}
function parseICSDate(value:string,params:Map<string,string>):CalendarDate {
  const m=value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if(!m)throw new ImportFormatError('Unsupported iCalendar date/time');
  const date=`${m[1]}-${m[2]}-${m[3]}`,time=m[4]?`${m[4]}:${m[5]}:${m[6]}`:undefined,timeZone=params.get('TZID');
  if(!validDate(date)||(time&&!validTime(time))||(!time&&params.get('VALUE')&&params.get('VALUE')!=='DATE')||(time&&params.get('VALUE')==='DATE')||(timeZone&&m[7])||(!time&&timeZone))throw new ImportFormatError('Invalid iCalendar date/time');
  return {date,...(time?{time}:{}),...(timeZone?{timeZone}:{}),...(m[7]?{utc:true}:{})};
}
function validateCalendarDate(d:CalendarDate):void {
  if(!validDate(d.date)||(d.time!==undefined&&!validTime(d.time))||(!d.time&&(d.timeZone||d.utc))||(d.utc&&d.timeZone)|| (d.timeZone && /[\r\n:;,"\\]/.test(d.timeZone)))throw new ImportFormatError('Invalid calendar date/time');
}
function validateRange(start:CalendarDate,end?:CalendarDate):void {
  validateCalendarDate(start);if(!end)return;validateCalendarDate(end);
  if(!!start.time!==!!end.time)throw new ImportFormatError('Calendar start/end value types differ');
  if(start.utc!==end.utc||start.timeZone!==end.timeZone)throw new ImportFormatError('Calendar start/end time zones differ; cross-zone ranges unsupported');
  if((end.date+(end.time||''))<=(start.date+(start.time||'')))throw new ImportFormatError('Calendar end must be after start (exclusive)');
}
/** RFC5545 VEVENT snapshot importer. Recurrence, alarms, custom VTIMEZONE and unsupported fields warn.
 * TZID wall times are preserved, not converted or expanded. DTEND remains exclusive. */
export function importICS(input:string):ImportResult<CalendarSnapshot>{
  if(input.length>LIMIT)throw new ImportFormatError('ICS exceeds 10 MB character limit');
  const lines=input.replace(/^\uFEFF/,'').replace(/\r\n[ \t]|\n[ \t]/g,'').split(/\r\n|\n|\r/); const items:CalendarSnapshot[]=[],warnings:ImportWarning[]=[];
  let props:{name:string;params:Map<string,string>;value:string;row:number}[]|null=null;const stack:string[]=[];
  const known=new Set(['UID','SUMMARY','DESCRIPTION','LOCATION','DTSTART','DTEND','CATEGORIES','STATUS','DTSTAMP','CREATED','LAST-MODIFIED','SEQUENCE']);
  for(let i=0;i<lines.length;i++){
    const line=lines[i];if(!line)continue;
    const colon=line.indexOf(':');if(colon<0){warn(warnings,i+1,'INVALID_LINE','Invalid ICS content line');continue;}
    const left=line.slice(0,colon),value=line.slice(colon+1),parts=left.split(';'),name=parts.shift()!.toUpperCase();
    if(name==='BEGIN'){const component=value.toUpperCase();if(component==='VEVENT'&&stack.at(-1)!=='VCALENDAR')throw new ImportFormatError('VEVENT must be inside VCALENDAR');if(component==='VCALENDAR'&&stack.length)throw new ImportFormatError('Nested VCALENDAR');stack.push(component);if(value.toUpperCase()==='VEVENT'){if(props)throw new ImportFormatError('Nested VEVENT');props=[];}else if(value.toUpperCase()!=='VCALENDAR')warn(warnings,i+1,'UNSUPPORTED_COMPONENT',`${value} component not imported; custom timezone definitions and alarms are not applied`);continue;}
    if(name==='END'){
      const component=value.toUpperCase();if(stack.pop()!==component)throw new ImportFormatError('Mismatched ICS component');
      if(component==='VEVENT'&&props){
        try{
          const get=(key:string)=>props!.find(p=>p.name===key),start=get('DTSTART');if(!start)throw new ImportFormatError('VEVENT requires DTSTART');const end=get('DTEND');
          for(const key of ['UID','SUMMARY','DESCRIPTION','LOCATION','DTSTART','DTEND','STATUS'])if(props.filter(p=>p.name===key).length>1)throw new ImportFormatError(`Duplicate ${key}`);
          const uid=get('UID')?.value||`snapshot-${items.length+1}`;if(!get('UID'))warn(warnings,i+1,'MISSING_UID','Generated a snapshot UID');
          const event:CalendarSnapshot={uid:unescapeICS(uid),title:unescapeICS(get('SUMMARY')?.value||''),description:unescapeICS(get('DESCRIPTION')?.value||''),location:get('LOCATION')?unescapeICS(get('LOCATION')!.value):undefined,start:parseICSDate(start.value,start.params),end:end?parseICSDate(end.value,end.params):undefined,categories:props.filter(p=>p.name==='CATEGORIES').flatMap(p=>splitUnescaped(p.value,',').map(unescapeICS))};
          const status=get('STATUS')?.value;if(status&&['TENTATIVE','CONFIRMED','CANCELLED'].includes(status))event.status=status as CalendarSnapshot['status'];else if(status)warn(warnings,i+1,'UNSUPPORTED_STATUS',`Unknown status ${status}`);
          validateRange(event.start,event.end);if(items.some(e=>e.uid===event.uid))warn(warnings,i+1,'DUPLICATE_UID',`Duplicate UID ${event.uid}; recurrence exceptions are not merged`);items.push(event);
        }catch(e){warn(warnings,i+1,'INVALID_EVENT',e instanceof Error?e.message:'Invalid event');}props=null;
      }continue;
    }
    if(props&&stack.at(-1)==='VEVENT'){
      const params=new Map<string,string>();for(const part of parts){const eq=part.indexOf('=');if(eq<0){warn(warnings,i+1,'INVALID_PARAMETER',`Malformed parameter ${part}`);continue;}params.set(part.slice(0,eq).toUpperCase(),part.slice(eq+1).replace(/^"(.*)"$/,'$1'));}
      if(!known.has(name))warn(warnings,i+1,/^(RRULE|RDATE|EXDATE|RECURRENCE-ID)$/.test(name)?'UNSUPPORTED_RECURRENCE':'UNSUPPORTED_PROPERTY',`${name} not applied; event is a single snapshot`);
      for(const key of params.keys())if(!(['DTSTART','DTEND'].includes(name)&&['VALUE','TZID'].includes(key)))warn(warnings,i+1,'UNSUPPORTED_PARAMETER',`${name};${key} parameter not applied`);
      props.push({name,params,value,row:i+1});
    }
  }
  if(stack.length||props)throw new ImportFormatError('Unclosed ICS component');
  if(!lines.some(l=>l.toUpperCase()==='BEGIN:VCALENDAR'))throw new ImportFormatError('Missing VCALENDAR');
  return {items,warnings};
}
function foldICS(line:string):string {let out='',current='',bytes=0;const encoder=new TextEncoder();for(const c of line){const length=encoder.encode(c).length;if(bytes+length>75){out+=current+'\r\n';current=' ';bytes=1;}current+=c;bytes+=length;}return out+current;}
function serializeICSDate(key:string,d:CalendarDate):string {validateCalendarDate(d);return key+(d.time?(d.timeZone?`;TZID=${d.timeZone}`:''):';VALUE=DATE')+':'+d.date.replace(/-/g,'')+(d.time?'T'+(d.time.length===5?d.time+':00':d.time).replace(/:/g,'')+(d.utc?'Z':''):'');}
/** Export snapshots only: callers expand recurrence separately. TZID uses recipient IANA tz database;
 * no VTIMEZONE is synthesized. Warn when interoperable definition is absent. */
export function exportICS(events:readonly CalendarSnapshot[],options:{now?:Date}={}):{text:string;warnings:ImportWarning[]}{
  const warnings:ImportWarning[]=[],now=options.now||new Date();if(!Number.isFinite(+now))throw new ImportFormatError('Invalid export timestamp');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Qingdan//Snapshot Export//ZH-CN','CALSCALE:GREGORIAN'];const seen=new Set<string>();
  for(const e of events){validateRange(e.start,e.end);if(e.status&&!['TENTATIVE','CONFIRMED','CANCELLED'].includes(e.status))throw new ImportFormatError('Invalid event status');if(!e.uid||seen.has(e.uid))throw new ImportFormatError('Snapshot UIDs must be nonempty and unique');seen.add(e.uid);
    if(e.start.timeZone)warn(warnings,undefined,'TZID_WITHOUT_VTIMEZONE',`TZID ${e.start.timeZone} requires the recipient timezone database; no VTIMEZONE definition included`);
    lines.push('BEGIN:VEVENT','UID:'+escapeICS(e.uid),'DTSTAMP:'+now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'),serializeICSDate('DTSTART',e.start));
    if(e.end)lines.push(serializeICSDate('DTEND',e.end));lines.push('SUMMARY:'+escapeICS(e.title),'DESCRIPTION:'+escapeICS(e.description));if(e.location)lines.push('LOCATION:'+escapeICS(e.location));if(e.categories.length)lines.push('CATEGORIES:'+e.categories.map(escapeICS).join(','));if(e.status)lines.push('STATUS:'+e.status);lines.push('END:VEVENT');
  }lines.push('END:VCALENDAR');return {text:lines.map(foldICS).join('\r\n')+'\r\n',warnings};
}
