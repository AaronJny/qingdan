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
const {calendarDateAtPoint}=await import('../app/calendar-resize');
const stamp='2026-10-19T00:00:00Z';
const task=(data:any={},role='owner')=>({id:'task',kind:'task',userId:'a',role,data:{title:'Resize me',status:'open',startDate:'2026-10-17',dueDate:'2026-10-19',...data},createdAt:stamp,updatedAt:stamp,version:1})as any;
const settle=async()=>act(async()=>{await new Promise(r=>setTimeout(r,15))});
const rect=(left:number,top:number,width:number,height:number)=>({left,top,right:left+width,bottom:top+height,width,height,x:left,y:top,toJSON:()=>({})});
function geometry(host:HTMLElement){
  const surface=host.querySelector<HTMLElement>('.calendar-surface')!;surface.getBoundingClientRect=()=>rect(0,0,700,600) as DOMRect;
  [...host.querySelectorAll<HTMLElement>('.day-cell')].forEach((cell,i)=>{cell.getBoundingClientRect=()=>rect(i%7*100,Math.floor(i/7)*100,100,100) as DOMRect});
}
function center(host:HTMLElement,date:string){const box=host.querySelector<HTMLElement>(`[data-calendar-date="${date}"]`)!.getBoundingClientRect();return {clientX:box.left+50,clientY:box.top+50};}
function pointer(target:any,type:string,coords:any,id=1,pointerType='mouse'){target.dispatchEvent(new window.PointerEvent(type,{bubbles:true,cancelable:true,button:0,isPrimary:true,pointerId:id,pointerType,...coords}));}
async function mount(initial:any[]){
  let tasks=initial;const saves:any[]=[],opened:string[]=[],errors:string[]=[];const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  g.fetch=async()=>Response.json({sources:[],events:[],holidays:{enabled:false,calendarYears:[],lastAttemptAt:null,nextAttemptAt:null}});
  const actions:any={open:(id:string)=>opened.push(id),notify:(error:string)=>errors.push(error),navigate:()=>{},refresh:async()=>{},save:async(record:any,patch:any)=>{saves.push(patch);tasks=tasks.map(t=>t.id===record.id?{...t,data:{...t.data,...patch}}:t);render();}};
  const render=()=>root.render(<CalendarView userId="a" tasks={tasks} lists={[]} actions={actions} preferences={{timezone:'UTC'}}/>);
  await act(async()=>render());await settle();
  const date=host.querySelector<HTMLInputElement>('.calendar-jump-date')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(date,'2026-10-19');date.dispatchEvent(new window.Event('input',{bubbles:true}));});geometry(host);
  return {host,root,saves,opened,errors,actions,get tasks(){return tasks},close:async()=>{await act(async()=>root.unmount());host.remove();window.happyDOM.abort();}};
}
async function resize(f:any,edge:string,to:string,pointerType='mouse'){
  const handle=f.host.querySelector(`[data-calendar-resize="${edge}"]`);assert.ok(handle);
  const cell=handle.closest('[data-calendar-date]');const from=center(f.host,cell.dataset.calendarDate),dest=center(f.host,to);
  await act(async()=>pointer(handle,'pointerdown',from,1,pointerType));
  await act(async()=>pointer(window,'pointermove',dest,1,pointerType));
  await act(async()=>pointer(window,'pointerup',dest,1,pointerType));await settle();geometry(f.host);
}

test('real endpoints only; body moves still preserve duration, edges cross week rows and persist',async()=>{
  const f=await mount([task()]);try{
    assert.equal(f.host.querySelectorAll('[data-calendar-resize=start]').length,1);assert.equal(f.host.querySelectorAll('[data-calendar-resize=end]').length,1);
    assert.equal(f.host.querySelector('[data-calendar-date="2026-10-18"] .event-resize'),null);
    await resize(f,'end','2026-10-27');assert.equal(f.tasks[0].data.dueDate,'2026-10-27');assert.equal(f.tasks[0].data.startDate,'2026-10-17');assert.equal(f.saves[0].duration,11*1440);assert.equal(f.opened.length,0);
    await resize(f,'start','2026-10-14','touch');assert.equal(f.tasks[0].data.startDate,'2026-10-14');assert.equal(f.tasks[0].data.dueDate,'2026-10-27');
    const event=f.host.querySelector('[data-calendar-task]');let dragged='';const start=new window.Event('dragstart',{bubbles:true,cancelable:true});Object.defineProperty(start,'dataTransfer',{value:{setData:(_key:string,id:string)=>dragged=id}});
    await act(async()=>event.dispatchEvent(start));assert.equal(dragged,'task');
    const drop=new window.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:{getData:()=>dragged}});
    await act(async()=>f.host.querySelector('[data-calendar-date="2026-10-20"]').dispatchEvent(drop));assert.equal(f.tasks[0].data.startDate,'2026-10-20');assert.equal(f.tasks[0].data.dueDate,'2026-11-02');assert.equal(f.tasks[0].data.duration,14*1440);
    await act(async()=>f.host.querySelector('.calendar-event-main').click());assert.deepEqual(f.opened,['task']);
  }finally{await f.close()}
});

test('no-motion, outside release, Escape, pointer cancellation and unrelated pointers never save',async()=>{
  const f=await mount([task()]);try{
    const from=center(f.host,'2026-10-19'),dest=center(f.host,'2026-10-27');
    for(const cancel of ['click','outside','Escape','pointercancel','blur']){
      const handle=f.host.querySelector('[data-calendar-resize=end]');await act(async()=>pointer(handle,'pointerdown',from));
      if(cancel!=='click')await act(async()=>pointer(window,'pointermove',dest));
      if(cancel==='Escape')await act(async()=>window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape'})));
      if(cancel==='pointercancel')await act(async()=>pointer(window,'pointercancel',dest));
      if(cancel==='blur')await act(async()=>window.dispatchEvent(new window.Event('blur')));
      await act(async()=>pointer(window,'pointerup',cancel==='outside'?{clientX:800,clientY:50}:cancel==='click'?from:dest));
      assert.equal(f.saves.length,0,cancel);assert.equal(f.host.querySelector('.calendar-event.resizing'),null);
    }
    await act(async()=>pointer(f.host.querySelector('[data-calendar-resize=end]'),'pointerdown',from));
    await act(async()=>pointer(window,'pointerup',dest,2));assert.equal(f.saves.length,0);
    await act(async()=>pointer(window,'pointercancel',dest));
  }finally{await f.close()}
});

test('keyboard endpoint changes retain focus for repeated arrows and clamp crossing',async()=>{
  const f=await mount([task()]);try{
    let handle=f.host.querySelector<HTMLElement>('[data-calendar-resize=end]')!;handle.focus();
    for(let i=0;i<2;i++){
      await act(async()=>document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true})));await settle();
      assert.equal((document.activeElement as HTMLElement).dataset.calendarResize,'end');
    }
    assert.equal(f.tasks[0].data.dueDate,'2026-10-21');
    await resize(f,'start','2026-10-28');assert.equal(f.tasks[0].data.startDate,'2026-10-21');assert.equal(f.tasks[0].data.duration,1440);
  }finally{await f.close()}
});

test('read-only tasks have no handles; clipping and exclusive midnight suppress false endpoints',async()=>{
  const f=await mount([task({startDate:'2026-09-01',dueDate:'2026-12-01'}),{...task({},'viewer'),id:'readonly'},{...task({startDate:'2026-10-19',startTime:'09:00',dueDate:'2026-10-21',dueTime:'00:00'}),id:'midnight'}]);try{
    assert.equal(f.host.querySelector('[data-calendar-task="task"] .event-resize'),null);
    assert.equal(f.host.querySelector('[data-calendar-task="readonly"] .event-resize'),null);
    assert.equal(f.host.querySelector('[data-calendar-date="2026-10-21"] [data-calendar-task="midnight"]'),null);
    assert.ok(f.host.querySelector('[data-calendar-date="2026-10-20"] [data-calendar-task="midnight"] [data-calendar-resize=end]'));
    const surface=f.host.querySelector<HTMLElement>('.calendar-surface')!;surface.getBoundingClientRect=()=>rect(0,0,700,200) as DOMRect;
    assert.equal(calendarDateAtPoint(surface,50,250),null);
  }finally{await f.close()}
});

test('unmount and view change cancel pending resize; save errors are reported',async()=>{
  const f=await mount([task()]);try{
    await act(async()=>pointer(f.host.querySelector('[data-calendar-resize=end]'),'pointerdown',center(f.host,'2026-10-19')));
    await act(async()=>pointer(window,'pointermove',center(f.host,'2026-10-27')));
    const select=f.host.querySelector<HTMLSelectElement>('[aria-label="Calendar view"]')!;
    await act(async()=>{select.value='week';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
    await act(async()=>pointer(window,'pointerup',{clientX:650,clientY:400}));assert.equal(f.saves.length,0);
    await act(async()=>{select.value='month';select.dispatchEvent(new window.Event('change',{bubbles:true}));});geometry(f.host);
    f.actions.save=async()=>{throw Error('Synthetic save failed')};
    // Rerender via navigation so the controller receives the changed action.
    await act(async()=>{select.value='multiweek';select.dispatchEvent(new window.Event('change',{bubbles:true}));});geometry(f.host);
    await resize(f,'end','2026-10-22');assert.deepEqual(f.errors,['Synthetic save failed']);assert.equal(f.tasks[0].data.dueDate,'2026-10-19');
    await act(async()=>pointer(f.host.querySelector('[data-calendar-resize=end]'),'pointerdown',center(f.host,'2026-10-19')));
  }finally{await f.close();pointer(window,'pointerup',{clientX:500,clientY:100});assert.equal(f.saves.length,0)}
});

test('timed top and bottom handles preserve opposite endpoints across midnight and retain arrow focus through remounts',async()=>{
  const f=await mount([task({startDate:'2026-10-19',startTime:'23:45',dueDate:'2026-10-20',dueTime:'00:30',duration:45})]);try{
    const view=f.host.querySelector<HTMLSelectElement>('[aria-label="Calendar view"]')!;
    await act(async()=>{view.value='week';view.dispatchEvent(new window.Event('change',{bubbles:true}));});
    assert.equal(f.host.querySelectorAll('.event-resize.timed.start').length,1);
    assert.equal(f.host.querySelectorAll('.event-resize.timed.end').length,1);
    const drag=async(edge:string,delta:number)=>{
      const handle=f.host.querySelector(`[data-calendar-resize="${edge}"]`)!;
      await act(async()=>pointer(handle,'pointerdown',{clientX:100,clientY:300}));
      await act(async()=>pointer(window,'pointermove',{clientX:100,clientY:300+delta}));
      await act(async()=>pointer(window,'pointerup',{clientX:100,clientY:300+delta}));await settle();
    };
    await drag('start',-13);
    assert.equal(f.tasks[0].data.startTime,'23:30');assert.equal(f.tasks[0].data.dueDate,'2026-10-20');assert.equal(f.tasks[0].data.dueTime,'00:30');assert.equal(f.tasks[0].data.duration,60);
    await drag('end',13);
    assert.equal(f.tasks[0].data.startDate,'2026-10-19');assert.equal(f.tasks[0].data.startTime,'23:30');assert.equal(f.tasks[0].data.dueTime,'00:45');assert.equal(f.tasks[0].data.duration,75);
    f.host.querySelector<HTMLElement>('[data-calendar-resize=start]')!.focus();
    for(const expected of ['23:45','00:00']){
      const previous=document.activeElement;
      await act(async()=>previous!.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})));await settle();
      assert.equal(f.tasks[0].data.startTime,expected);assert.equal(f.tasks[0].data.dueTime,'00:45');
      assert.equal((document.activeElement as HTMLElement).dataset.calendarResize,'start');
      if(expected==='00:00')assert.equal(previous!.isConnected,false,'crossing midnight removes the old day/hour handle');
    }
    assert.equal(f.tasks[0].data.startDate,'2026-10-20');
    assert.equal(document.activeElement!.closest('.time-row'),f.host.querySelector('.time-row'));
    f.host.querySelector<HTMLElement>('[data-calendar-resize=end]')!.focus();
    for(const expected of ['00:30','00:15']){
      await act(async()=>document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true})));await settle();
      assert.equal(f.tasks[0].data.dueTime,expected);assert.equal(f.tasks[0].data.startTime,'00:00');
      assert.equal((document.activeElement as HTMLElement).dataset.calendarResize,'end');
    }
    const saved=f.saves.length;
    await act(async()=>document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true})));await settle();
    assert.equal(f.tasks[0].data.duration,15);assert.equal(f.saves.length,saved,'minimum-span no-op does not save');assert.equal(f.opened.length,0);
  }finally{await f.close()}
});

test('an in-flight timed resize blocks duplicate pointer and keyboard saves and permits a fresh gesture after completion',async()=>{
  const f=await mount([task({startDate:'2026-10-19',startTime:'09:00',dueDate:'2026-10-19',dueTime:'10:00',duration:60})]);
  let release=()=>{};try{
    const originalSave=f.actions.save;let attempts=0;
    const gate=new Promise<void>(resolve=>{release=resolve});
    f.actions.save=async(record:any,patch:any)=>{attempts++;await gate;return originalSave(record,patch)};
    const view=f.host.querySelector<HTMLSelectElement>('[aria-label="Calendar view"]')!;
    await act(async()=>{view.value='week';view.dispatchEvent(new window.Event('change',{bubbles:true}));});
    const drag=async(edge:string,delta:number)=>{
      const handle=f.host.querySelector(`[data-calendar-resize="${edge}"]`)!;
      await act(async()=>pointer(handle,'pointerdown',{clientX:100,clientY:300}));
      await act(async()=>pointer(window,'pointermove',{clientX:100,clientY:300+delta}));
      await act(async()=>pointer(window,'pointerup',{clientX:100,clientY:300+delta}));
    };
    await drag('start',-13);assert.equal(attempts,1);assert.equal(f.saves.length,0);
    await drag('end',26);
    const end=f.host.querySelector<HTMLElement>('[data-calendar-resize=end]')!;end.focus();
    await act(async()=>end.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})));await settle();
    assert.equal(attempts,1);assert.equal(f.saves.length,0);assert.equal(f.host.querySelector('.calendar-event.resizing'),null);
    await act(async()=>release());await settle();
    assert.equal(f.saves.length,1);assert.equal(f.tasks[0].data.startTime,'08:45');assert.equal(f.tasks[0].data.dueTime,'10:00');
    await drag('end',26);await settle();
    assert.equal(attempts,2);assert.equal(f.saves.length,2);assert.equal(f.tasks[0].data.startTime,'08:45');assert.equal(f.tasks[0].data.dueTime,'10:30');assert.equal(f.tasks[0].data.duration,105);
  }finally{release();await settle();await f.close()}
});

test('timed resize previews and commits follow scroll displacement from the gesture starting viewport',async()=>{
  const f=await mount([task({startDate:'2026-10-19',startTime:'09:00',dueDate:'2026-10-19',dueTime:'12:00',duration:180})]);try{
    const view=f.host.querySelector<HTMLSelectElement>('[aria-label="Calendar view"]')!;
    await act(async()=>{view.value='week';view.dispatchEvent(new window.Event('change',{bubbles:true}));});
    const surface=f.host.querySelector<HTMLElement>('.calendar-surface')!;surface.scrollTop=104;
    await act(async()=>pointer(f.host.querySelector('[data-calendar-resize=end]'),'pointerdown',{clientX:100,clientY:300}));
    await act(async()=>pointer(window,'pointermove',{clientX:100,clientY:313}));
    assert.match(f.host.querySelector('.calendar-drag-preview')?.textContent||'',/12:15/);
    await act(async()=>{surface.scrollTop=156;surface.dispatchEvent(new window.Event('scroll'));});
    assert.match(f.host.querySelector('.calendar-drag-preview')?.textContent||'',/13:15/,'scroll updates the preview without another pointer move');
    await act(async()=>pointer(window,'pointerup',{clientX:100,clientY:313}));await settle();
    assert.equal(f.tasks[0].data.startTime,'09:00');assert.equal(f.tasks[0].data.dueTime,'13:15');assert.equal(f.tasks[0].data.duration,255);
    await act(async()=>pointer(f.host.querySelector('[data-calendar-resize=start]'),'pointerdown',{clientX:100,clientY:300}));
    await act(async()=>pointer(window,'pointermove',{clientX:100,clientY:287}));
    await act(async()=>{surface.scrollTop=104;surface.dispatchEvent(new window.Event('scroll'));});
    assert.match(f.host.querySelector('.calendar-drag-preview')?.textContent||'',/07:45/);
    await act(async()=>pointer(window,'pointerup',{clientX:100,clientY:287}));await settle();
    assert.equal(f.tasks[0].data.startTime,'07:45');assert.equal(f.tasks[0].data.dueTime,'13:15');assert.equal(f.tasks[0].data.duration,330);
    await act(async()=>{surface.scrollTop=208;surface.dispatchEvent(new window.Event('scroll'));});
    assert.equal(f.host.querySelector('.calendar-drag-preview'),null);assert.equal(f.saves.length,2,'scroll listener is removed after committing');
  }finally{await f.close()}
});
