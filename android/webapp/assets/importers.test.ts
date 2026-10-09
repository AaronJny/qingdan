/** Run: node --experimental-strip-types --test assets/importers.test.ts */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV,stringifyCSV,importTaskCSV,exportTaskCSV,importTodoistCSV,importICS,exportICS,validDate } from './importers.ts';
import type { CalendarSnapshot,ImportedTask } from './importers.ts';
test('RFC4180 comma, multiline, quotes, BOM, empty final field and CRLF',()=>{
  const rows=[['姓名','a,b','quote "quoted"','line1\r\nline2',''],['','尾','','','']];
  assert.deepEqual(parseCSV('\uFEFF'+stringifyCSV(rows)),rows);
  assert.deepEqual(parseCSV('a,b,\n'),[['a','b','']]);assert.deepEqual(parseCSV(''),[]);
  assert.deepEqual(parseCSV('""'),[['']]);assert.deepEqual(parseCSV('a\nb'),[['a'],['b']]);
});
test('malformed CSV rejects instead of corrupting data',()=>{
  for(const s of ['a"b,c','"a"x,b','"unclosed'])assert.throws(()=>parseCSV(s));
});
test('CSV formula-safe export is opt-in and explicit',()=>{
  assert.equal(parseCSV(stringifyCSV([['=1+1','hello']],{spreadsheetSafe:true}))[0][0],"'=1+1");
  assert.equal(parseCSV(stringifyCSV([['=1+1']]))[0][0],'=1+1');
});
test('validates actual dates and leap years',()=>{assert.equal(validDate('2024-02-29'),true);assert.equal(validDate('2025-02-29'),false);assert.equal(validDate('0000-01-01'),false);assert.equal(validDate('0099-12-31'),true);});
test('generic CSV maps fields and roundtrips hierarchy/tags/newlines',()=>{
  const task:ImportedTask={id:'p',title:'任务, "一"',description:'备注\n第二行',priority:3,tags:['a;b','中文'],list:'工作',section:'计划',dueDate:'2026-10-07',dueTime:'09:30',timeZone:'Asia/Shanghai',status:'done',deadline:'2026-10-08',duration:30};
  const child={...task,id:'c',title:'子任务',parentId:'p'};
  const result=importTaskCSV(exportTaskCSV([task,child]));assert.equal(result.warnings.length,0);
  assert.equal(result.items[1].parentId,'p');assert.deepEqual(result.items[0].tags,task.tags);assert.equal(result.items[0].description,task.description);assert.equal(result.items[0].duration,30);
});
test('generic CSV reports invalid/unsupported data, missing parent and cycle',()=>{
  const data='id,title,date,time,priority,tags,parent_id,status,extra\r\na,A,2025-02-29,25:00,9,"[1]",b,invalid,x\r\nb,B,,,,,a,,\r\nc,C,,09:00,,,missing,,\r\n';
  const r=importTaskCSV(data);assert.equal(r.items.length,3);
  for(const code of ['UNSUPPORTED_COLUMN','UNSUPPORTED_DATE','INVALID_TIME','INVALID_PRIORITY','INVALID_TAGS','INVALID_STATUS','PARENT_CYCLE','MISSING_PARENT','TIME_WITHOUT_DATE'])assert.ok(r.warnings.some(w=>w.code===code),code);
  assert.throws(()=>importTaskCSV('title,title\na,b'));assert.throws(()=>importTaskCSV('name\na'));
});
test('Todoist sections, documented priority mapping, labels and parent indent',()=>{
  const r=importTodoistCSV(stringifyCSV([['TYPE','CONTENT','DESCRIPTION','PRIORITY','INDENT','DATE','TIMEZONE','DURATION','DURATION_UNIT'],['section','计划','','','','','','',''],['task','父任务 @重要','desc','1','1','2026-10-07 10:30','Asia/Shanghai','30','minute'],['task','子任务','','3','2','','','',''],['task','孙任务','','4','3','','','',''],['section','新组','','','','','','',''],['task','无父','','','2','every day','','',''],['note','comment','','','','','','','']]),{list:'工作'});
  assert.equal(r.items.length,4);assert.equal(r.items[0].priority,3);assert.equal(r.items[1].priority,1);assert.equal(r.items[2].priority,0);assert.equal(r.items[3].priority,3);
  assert.equal(r.items[1].parentId,r.items[0].id);assert.equal(r.items[2].parentId,r.items[1].id);assert.equal(r.items[3].parentId,undefined);
  assert.deepEqual(r.items[0].tags,['重要']);assert.equal(r.items[0].title,'父任务');assert.equal(r.items[0].duration,30);assert.equal(r.items[0].dueTime,'10:30');assert.equal(r.items[0].section,'计划');assert.equal(r.items[0].list,'工作');
  assert.ok(r.warnings.some(w=>w.code==='MISSING_PARENT'));assert.ok(r.warnings.some(w=>w.code==='UNSUPPORTED_DATE'));assert.ok(r.warnings.some(w=>w.code==='COMMENT_AS_SOURCE'));
});
const events:CalendarSnapshot[]=[
  {uid:'全天',title:'多天,活动',description:'第一行\n第二行;反斜线\\',start:{date:'2026-10-07'},end:{date:'2026-10-10'},categories:['甲,乙','中文']},
  {uid:'时区',title:'会议',description:'',location:'上海',start:{date:'2026-10-07',time:'09:00:00',timeZone:'Asia/Shanghai'},end:{date:'2026-10-07',time:'10:00:00',timeZone:'Asia/Shanghai'},categories:[],status:'CONFIRMED'},
  {uid:'utc',title:'UTC',description:'',start:{date:'2026-10-07',time:'01:00:00',utc:true},end:{date:'2026-10-07',time:'02:00:00',utc:true},categories:[]},
  {uid:'float',title:'浮动',description:'',start:{date:'2026-10-07',time:'11:00:00'},categories:[]}
];
test('ICS roundtrips all-day/multiday exclusive end, TZID, UTC, floating, escaping',()=>{
  const out=exportICS(events,{now:new Date('2026-10-07T12:00:00Z')});assert.ok(out.text.includes('DTEND;VALUE=DATE:20261010'));assert.ok(out.text.includes('DTSTAMP:20261007T120000Z'));assert.equal(out.warnings[0].code,'TZID_WITHOUT_VTIMEZONE');
  const back=importICS(out.text);assert.equal(back.warnings.length,0);
  assert.deepEqual(JSON.parse(JSON.stringify(back.items)),JSON.parse(JSON.stringify(events)));
});
test('ICS Unicode folding is <=75 UTF8 bytes and unfolds without loss',()=>{
  const title='中文🙂'.repeat(90);const out=exportICS([{...events[0],title}]).text;
  out.trimEnd().split('\r\n').forEach(line=>assert.ok(Buffer.byteLength(line)<=75));assert.equal(importICS(out).items[0].title,title);
});
test('ICS warns for recurrence, alarms, custom zones, ignored fields; imports only VEVENT',()=>{
  const r=importICS('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:Custom\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART;TZID=Asia/Shanghai:20261007T090000\r\nRRULE:FREQ=DAILY\r\nEXDATE:20261009T090000\r\nATTENDEE:mailto:test@example.invalid\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:alarm text\r\nEND:VALARM\r\nSUMMARY:会\r\n 议\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
  assert.equal(r.items.length,1);assert.equal(r.items[0].title,'会议');assert.equal(r.items[0].description,'');assert.equal(r.warnings.filter(w=>w.code==='UNSUPPORTED_RECURRENCE').length,2);assert.ok(r.warnings.some(w=>w.code==='UNSUPPORTED_COMPONENT'));assert.ok(r.warnings.some(w=>w.code==='UNSUPPORTED_PROPERTY'));
});
test('ICS invalid dates/ranges/duplicates are warned and skipped, broken structure rejects',()=>{
  for(const fields of ['DTSTART;VALUE=DATE:20260230','DTSTART;VALUE=DATE:20261007\r\nDTEND;VALUE=DATE:20261006','DTSTART:20261007T250000','DTSTART:20261007T090000Z\r\nDTEND:20261007T100000','DTSTART;VALUE=DATE:20261007\r\nDTSTART;VALUE=DATE:20261008']){
    const r=importICS(`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:bad\r\n${fields}\r\nEND:VEVENT\r\nEND:VCALENDAR`);assert.equal(r.items.length,0);assert.ok(r.warnings.some(w=>w.code==='INVALID_EVENT'));
  }
  assert.throws(()=>importICS('BEGIN:VCALENDAR\nBEGIN:VEVENT'));assert.throws(()=>importICS('BEGIN:VCALENDAR\nEND:VEVENT'));
  assert.throws(()=>exportICS([{...events[0],end:{date:'2026-10-06'}}]));assert.throws(()=>exportICS([events[0],events[0]]));assert.throws(()=>exportICS([{...events[1],start:{...events[1].start,timeZone:'bad\r\nATTENDEE:evil'}}]));
});
test('ICS duplicate series identifiers warn, detached VEVENT rejects, invalid export status rejects',()=>{
  const raw=exportICS([events[0]]).text;const block=raw.slice(raw.indexOf('BEGIN:VEVENT'),raw.indexOf('END:VEVENT')+'END:VEVENT'.length);
  const r=importICS(`BEGIN:VCALENDAR\r\n${block}\r\n${block}\r\nEND:VCALENDAR`);assert.equal(r.items.length,2);assert.ok(r.warnings.some(w=>w.code==='DUPLICATE_UID'));
  assert.throws(()=>importICS(`${block}\r\nBEGIN:VCALENDAR\r\nEND:VCALENDAR`));assert.throws(()=>exportICS([{...events[0],status:'CONFIRMED\r\nATTENDEE:injected'} as never]));
});

test('generic CSV preserves explicit timed ranges and UTC instants',()=>{const task:any={id:'r',title:'range',description:'',priority:0,tags:[],list:'work',section:'',status:'open',dueDate:'2026-11-01',dueTime:'01:45',startDate:'2026-11-01',startTime:'01:30',timeZone:'America/New_York',startInstant:'2026-11-01T06:30:00Z',endInstant:'2026-11-01T06:45:00Z'};const result=importTaskCSV(exportTaskCSV([task]));assert.equal(result.items[0].startInstant,task.startInstant);assert.equal(result.items[0].endInstant,task.endInstant);assert.equal(result.items[0].startTime,'01:30');assert.equal(result.items[0].dueTime,'01:45');});
test('Todoist documented note rows and unsupported recurring DATE retain source text without forging app identity',()=>{const csv='TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE\ntask,Parent,Body,1,1,Author (123),Person (456),every Monday\nnote,Source comment,,,,Original author (123),,\n';const result=importTodoistCSV(csv);assert.equal(result.items.length,1);assert.match(result.items[0].description,/Source comment/);assert.match(result.items[0].description,/every Monday/);assert.match(result.items[0].description,/Person \(456\)/);assert.ok(result.warnings.some(w=>w.code==='COMMENT_AS_SOURCE'));assert.equal((result.items[0]as any).assignee,undefined)});
