import { desktopBridge, type DesktopBridge } from './desktop-connection';
export type DesktopAlert = { id:string; taskId:string; title:string; scheduledAt:string; kind:'task'|'countdown'; checkId?:string };
export type RuntimeEvent =
 | {type:'quick-add'|'resume'|'session-changed'}
 | {type:'connection-health';connected:boolean}
 | {type:'runtime-status';notificationOwner:boolean}
 | {type:'reminders';accountId:string;alerts:DesktopAlert[]}
 | {type:'open-reminder';accountId:string;taskId:string;kind:'task'|'countdown'};
export type RuntimeSnapshot = { notificationOwner:boolean; alerts:DesktopAlert[]; quickAdd:boolean; shortcutRegistered:boolean; backgroundResident:boolean };
export type RuntimeBridge = DesktopBridge & { runtimeReady(accountId:string):Promise<RuntimeSnapshot>; forgetReminders?(accountId:string,ids:string[]):Promise<{ok:boolean}>; onRuntimeEvent(listener:(event:RuntimeEvent)=>void):()=>void };
export function desktopRuntime(): RuntimeBridge | undefined {
 const bridge=desktopBridge() as Partial<RuntimeBridge>|undefined;
 return bridge&&typeof bridge.runtimeReady==='function'&&typeof bridge.onRuntimeEvent==='function'?bridge as RuntimeBridge:undefined;
}
export function subscribeDesktopRuntime(accountId:string, handlers:{ quickAdd():void; reminders(alerts:DesktopAlert[]):void; openReminder(taskId:string,kind:'task'|'countdown'):void; resume():void; notificationOwner(value:boolean):void; notify(message:string):void }):()=>void {
 const bridge=desktopRuntime();if(!bridge)return()=>{};let active=true;
 const stop=bridge.onRuntimeEvent(event=>{
  if(!active)return;
  if(event.type==='quick-add')handlers.quickAdd();
  else if(event.type==='resume'){window.dispatchEvent(new Event('qingdan-resume'));handlers.resume();}
  else if(event.type==='runtime-status'){handlers.notificationOwner(event.notificationOwner);if(!event.notificationOwner)handlers.notify('系统通知暂不可用，已保留页面内提醒。请检查系统通知设置。');}
  else if(event.type==='reminders'&&event.accountId===accountId)handlers.reminders(event.alerts);
  else if(event.type==='open-reminder'&&event.accountId===accountId)handlers.openReminder(event.taskId,event.kind);
  else if(event.type==='session-changed')handlers.resume();
 });
 void bridge.runtimeReady(accountId).then(result=>{
  if(!active)return;handlers.notificationOwner(result.notificationOwner);handlers.reminders(result.alerts);
  if(result.quickAdd)handlers.quickAdd();
  if(!result.shortcutRegistered)handlers.notify('快速新增快捷键未注册，可能被其他应用占用。仍可使用文件或托盘菜单新增。');
 }).catch(()=>{if(active)handlers.notificationOwner(false)});
 return()=>{active=false;stop();};
}

export function forgetNativeReminder(accountId:string,id:string):void { void desktopRuntime()?.forgetReminders?.(accountId,[id]).catch(()=>{}); }
