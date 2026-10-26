import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {setLanguagePreference} from '../lib/i18n';
setLanguagePreference('en');
const window:any=new Window({url:'https://qingdan.test/'}),g=globalThis as any;
for(const key of ['window','document','navigator','location','HTMLElement','HTMLInputElement','Event','CustomEvent','MouseEvent','KeyboardEvent','PointerEvent'])Object.defineProperty(g,key,{value:window[key],configurable:true,writable:true});
g.IS_REACT_ACT_ENVIRONMENT=true;g.requestAnimationFrame=(fn:any)=>setTimeout(fn,5);g.cancelAnimationFrame=clearTimeout;
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
const {CalendarView}=await import('../app/workspace-views');
const stamp='2026-10-19T00:00:00Z';
const task=(id:string,data:any={})=>({id,kind:'task',userId:'a',role:'owner',data:{title:'Synthetic '+id,status:'open',dueDate:'2026-10-19',...data},createdAt:stamp,updatedAt:stamp,version:1}) as any;
const daily={start:{date:'2026-10-19'},rule:{frequency:'daily'},end:{count:4}};
const settle=async()=>act(async()=>{await new Promise(r=>setTimeout(r,15))});
async function mount(tasks:any[],initialView='month'){
  const original=JSON.stringify(tasks),saves:any[]=[],opened:string[]=[],errors:string[]=[];
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  g.fetch=async()=>Response.json({sources:[],events:[],holidays:{enabled:false,calendarYears:[],lastAttemptAt:null,nextAttemptAt:null}});
  const actions:any={open:(id:string)=>opened.push(id),notify:(error:string)=>errors.push(error),navigate:()=>{},refresh:async()=>{},save:async(...args:any[])=>{saves.push(args)}};
  await act(async()=>root.render(<CalendarView userId="a" tasks={tasks} lists={[]} actions={actions} preferences={{timezone:'America/New_York'}}/>));await settle();
  const jump=host.querySelector<HTMLInputElement>('.calendar-jump-date')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(jump,'2026-10-19');jump.dispatchEvent(new window.Event('input',{bubbles:true}));});
  const view=async(value:string)=>{const select=host.querySelector<HTMLSelectElement>('[aria-label="Calendar view"]')!;await act(async()=>{select.value=value;select.dispatchEvent(new window.Event('change',{bubbles:true}));});};
  await view(initialView);
  const toggle=async()=>{const checkbox=host.querySelector<HTMLInputElement>('.calendar-options > label input[type="checkbox"]')!;await act(async()=>checkbox.click());};
  return {host,tasks,saves,opened,errors,view,toggle,close:async()=>{assert.equal(JSON.stringify(tasks),original,'preview interactions must not mutate source tasks');assert.deepEqual(saves,[],'preview interactions must not persist task changes');await act(async()=>root.unmount());host.remove();window.happyDOM.abort();}};
}
function events(host:HTMLElement,id:string){return [...host.querySelectorAll<HTMLElement>(`[data-calendar-task="${id}"]`)];}
function assertReadOnly(event:HTMLElement){assert.equal(event.getAttribute('draggable'),'false');assert.equal(event.querySelector('[data-calendar-resize]'),null);assert.ok(event.classList.contains('virtual'));}
function segments(host:HTMLElement,id:string){return [...host.querySelectorAll<HTMLElement>(`[data-calendar-segment-task="${id}"]`)].map(el=>[el.dataset.calendarSegmentStart,el.dataset.calendarSegmentEnd]);}

test('timeline repeat previews toggle repeatedly while original and ordinary tasks stay visible',async()=>{
  const f=await mount([task('repeating',{recurrence:daily}),task('ordinary',{dueDate:'2026-10-20'})],'timeline');
  try{
    const previewId='repeating@2026-10-20';
    assert.equal(events(f.host,'repeating').length,1);
    assert.equal(events(f.host,'ordinary').length,1);
    assert.equal(events(f.host,previewId).length,1,'next occurrence belongs in the original task timeline row');
    const preview=events(f.host,previewId)[0];assertReadOnly(preview);
    assert.equal(preview.closest('.timeline-row'),events(f.host,'repeating')[0].closest('.timeline-row'));
    await act(async()=>preview.querySelector<HTMLButtonElement>('.calendar-event-main')!.click());assert.deepEqual(f.opened,['repeating']);
    for(let i=0;i<2;i++){
      await f.toggle();assert.equal(f.host.querySelectorAll('.calendar-event.virtual').length,0);
      assert.equal(events(f.host,'repeating').length,1);assert.equal(events(f.host,'ordinary').length,1);
      await f.toggle();assert.equal(events(f.host,previewId).length,1);assert.equal(f.host.querySelectorAll('.calendar-event.virtual').length,3);
    }
    await f.view('month');assert.equal(events(f.host,previewId).length,1);
    await f.view('timeline');assert.equal(events(f.host,previewId).length,1,'view changes preserve the enabled option');
    assert.deepEqual(f.errors,[]);
  }finally{await f.close()}
});

test('all-day repeated spans shift both dates and keep week-row continuity without stretching',async()=>{
  const recurrence={start:{date:'2026-10-19'},rule:{frequency:'weekly'},end:{count:2}};
  const f=await mount([task('span',{startDate:'2026-10-17',dueDate:'2026-10-19',recurrence}),task('ordinary',{startDate:'2026-10-20',dueDate:'2026-10-21'})]);
  try{
    assert.deepEqual(segments(f.host,'span'),[['2026-10-17','2026-10-18'],['2026-10-19','2026-10-19']]);
    assert.deepEqual(segments(f.host,'span@2026-10-26'),[['2026-10-24','2026-10-25'],['2026-10-26','2026-10-26']]);
    const ordinary=segments(f.host,'ordinary');
    for(const preview of events(f.host,'span@2026-10-26'))assertReadOnly(preview);
    await act(async()=>events(f.host,'span@2026-10-26')[0].querySelector<HTMLButtonElement>('.calendar-event-main')!.click());assert.deepEqual(f.opened,['span']);
    await f.toggle();assert.equal(events(f.host,'span@2026-10-26').length,0);assert.deepEqual(segments(f.host,'ordinary'),ordinary);
    assert.equal(events(f.host,'span').length,2);
    await f.toggle();assert.deepEqual(segments(f.host,'span@2026-10-26'),[['2026-10-24','2026-10-25'],['2026-10-26','2026-10-26']]);
  }finally{await f.close()}
});

test('timed overnight previews preserve two-hour wall duration and remain read-only in week view',async()=>{
  const recurrence={start:{date:'2026-10-20',time:'01:00',timeZone:'America/New_York'},rule:{frequency:'daily'},end:{count:2}};
  const f=await mount([task('overnight',{startDate:'2026-10-19',startTime:'23:00',dueDate:'2026-10-20',dueTime:'01:00',duration:120,recurrence})],'week');
  try{
    const preview=events(f.host,'overnight@2026-10-21');
    assert.equal(preview.length,2,'only the two occupied dates should have a segment');
    assert.deepEqual(preview.map(el=>el.style.height).sort(),['52px','52px']);
    for(const event of preview)assertReadOnly(event);
    assert.equal(events(f.host,'overnight').length,2);
    await f.toggle();assert.equal(events(f.host,'overnight@2026-10-21').length,0);assert.equal(events(f.host,'overnight').length,2);
    await f.toggle();assert.deepEqual(events(f.host,'overnight@2026-10-21').map(el=>el.style.height).sort(),['52px','52px']);
  }finally{await f.close()}
});

test('completed, exhausted, excluded and out-of-window repeats do not acquire fake previews',async()=>{
  const f=await mount([
    task('completed',{status:'done',recurrence:daily}),
    task('exhausted',{recurrence:{...daily,end:{count:1}}}),
    task('excluded',{recurrence:{...daily,end:{count:2},exclusions:['2026-10-20']}}),
    task('later',{recurrence:{start:{date:'2026-10-19'},rule:{frequency:'yearly'}}}),
    task('ordinary'),
  ]);
  try{
    assert.equal(f.host.querySelectorAll('.calendar-event.virtual').length,0);
    const before=f.host.querySelectorAll('[data-calendar-task]').length;
    await f.toggle();assert.equal(f.host.querySelectorAll('[data-calendar-task]').length,before);
    await f.toggle();assert.equal(f.host.querySelectorAll('[data-calendar-task]').length,before);
  }finally{await f.close()}
});

test('an overnight repeat starting on the last visible day is shown even when its due date is outside the week',async()=>{
  const recurrence={start:{date:'2026-10-19',time:'01:00',timeZone:'America/New_York'},rule:{frequency:'weekly'},end:{count:2}};
  const f=await mount([task('window-edge',{startDate:'2026-10-18',startTime:'23:00',dueDate:'2026-10-19',dueTime:'01:00',duration:120,recurrence})],'week');
  try{
    const preview=events(f.host,'window-edge@2026-10-26');
    assert.equal(preview.length,1,'October 25 23:00 is inside the October 19–25 week');
    assert.equal(preview[0].style.height,'52px');assertReadOnly(preview[0]);
    const rows=[...f.host.querySelectorAll('.time-row')];
    assert.equal(preview[0].closest('.time-row'),rows[23]);
    assert.equal(events(f.host,'window-edge').length,1,'the original midnight ending segment remains visible');
    await f.toggle();assert.equal(events(f.host,'window-edge@2026-10-26').length,0);
    await f.toggle();assert.equal(events(f.host,'window-edge@2026-10-26').length,1);
  }finally{await f.close()}
});
