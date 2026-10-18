import{setLanguagePreference}from'../lib/i18n';setLanguagePreference('zh-CN');
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import type { Bootstrap } from '../lib/types';

const window:any=new Window({url:'http://127.0.0.1:4310/'}),g=globalThis as any;
for(const key of ['window','document','navigator','location','history','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Event','CustomEvent','MouseEvent','KeyboardEvent','FocusEvent','MutationObserver','sessionStorage','localStorage'])Object.defineProperty(g,key,{value:window[key],configurable:true,writable:true});
g.requestAnimationFrame=(fn:any)=>setTimeout(()=>fn(Date.now()),0);g.cancelAnimationFrame=clearTimeout;g.IS_REACT_ACT_ENVIRONMENT=true;
window.HTMLElement.prototype.getClientRects=function(){return this.hidden?[]:[{width:100,height:30}]};
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),{default:Workspace}=await import('../app/workspace');
const settle=async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,10))})};
const click=(element:Element|null)=>{assert.ok(element);(element as HTMLElement).click()};
const button=(label:string)=>Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()===label)||null;
let fixtureId=0;
async function setup(mode:'local'|'accounts'='local'){
  localStorage.clear();sessionStorage.clear();
  const user={userId:'synthetic-sync-'+(++fixtureId),displayName:'同步合成用户',email:'fixture@example.test',mode};
  const state:Bootstrap={user,records:[{id:'inbox:'+user.userId,ownerId:user.userId,kind:'list',listId:null,data:{title:'收集箱',sections:[]},revision:1,updatedAt:new Date().toISOString(),deleted:false,role:'owner'}],history:[],attachments:[],members:[],serverTime:new Date().toISOString()};
  const reads:string[]=[],writes:string[]=[];
  let read=async(_path:string)=>Response.json(state);
  g.fetch=async(path:string,init?:RequestInit)=>{
    if(path==='/api/reminders')return Response.json({alerts:[]});
    if(path.startsWith('/api/data')&&init?.method==='GET'){reads.push(path);return read(path)}
    writes.push(path);throw new Error('Synthetic fixture blocks unmocked network: '+path);
  };
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  await act(async()=>root.render(<Workspace user={user}/>));await settle();
  await act(async()=>click(host.querySelector('button[title="设置"]')));await act(async()=>click(button('账号与同步')));
  return {host,state,user,reads,writes,setRead:(fn:(path:string)=>Promise<Response>)=>{read=fn},close:async()=>{await act(async()=>root.unmount());host.remove();window.happyDOM.abort()}};
}

test('manual sync reports progress and actual completion, blocks repeated clicks, and reads only the current service',async()=>{
 const f=await setup();let release!:(response:Response)=>void;
 try{
  const original=f.reads.length;
  f.setRead(()=>new Promise(resolve=>{release=resolve}));
  await act(async()=>{click(button('立即同步'));click(button('立即同步'))});
  const pending=button('正在同步…');assert.ok(pending);assert.equal(pending.disabled,true);assert.equal(pending.getAttribute('aria-busy'),'true');
  assert.equal(f.reads.length,original+1);assert.match(f.host.querySelector('.workspace-sync-panel [role="status"]')?.textContent||'',/正在读取/);
  await act(async()=>release(Response.json(f.state)));await settle();
  assert.match(f.host.querySelector('.workspace-sync-panel [role="status"]')?.textContent||'',/已刷新本机服务数据/);
  assert.ok(f.host.querySelector('[data-last-sync]')?.getAttribute('data-last-sync'));assert.equal(button('立即同步')?.disabled,false);
  assert.equal(f.writes.length,0);
 }finally{await f.close()}
});

test('remote account sync reports server completion without creating an upload or changing account identity',async()=>{
 const f=await setup('accounts');
 try{await act(async()=>click(button('立即同步')));await settle();assert.match(f.host.querySelector('.workspace-sync-panel')?.textContent||'',/已同步当前服务器数据/);assert.match(f.host.querySelector('.account-card')?.textContent||'',/fixture@example.test/);assert.equal(f.writes.length,0);assert.equal(f.host.querySelector('.workspace-name')?.textContent,'我的空间')}finally{await f.close()}
});

test('failed sync with a saved offline copy reports failure inside settings and preserves the last success time',async()=>{
 const f=await setup();
 try{
  const last=f.host.querySelector('[data-last-sync]')?.getAttribute('data-last-sync');
  f.setRead(async()=>Response.json({error:'合成服务暂不可用'},{status:503}));
  await act(async()=>click(button('立即同步')));await settle();
  assert.match(f.host.querySelector('.workspace-sync-panel [role="alert"]')?.textContent||'',/同步未完成.*合成服务暂不可用/);
  assert.match(f.host.querySelector('.sidebar-footer')?.textContent||'',/离线副本/);
  assert.equal(f.host.querySelector('[data-last-sync]')?.getAttribute('data-last-sync'),last);assert.equal(button('立即同步')?.disabled,false);
  f.setRead(async()=>Response.json(f.state));await act(async()=>click(button('立即同步')));await settle();
  assert.equal(f.host.querySelector('.workspace-sync-panel [role="alert"]'),null);assert.match(f.host.querySelector('.workspace-sync-panel')?.textContent||'',/已刷新本机服务数据/);
 }finally{await f.close()}
});

test('failed sync without an offline copy keeps an in-dialog error, enables retry and does not claim completion',async()=>{
 const f=await setup();
 try{
  localStorage.removeItem('qingdan:offline:'+encodeURIComponent(f.user.userId));
  const last=f.host.querySelector('[data-last-sync]')?.getAttribute('data-last-sync');
  f.setRead(async()=>{throw new TypeError('Synthetic disconnected network')});
  await act(async()=>click(button('立即同步')));await settle();
  assert.match(f.host.querySelector('.workspace-sync-panel [role="alert"]')?.textContent||'',/同步失败.*连接不可用/);assert.equal(button('立即同步')?.disabled,false);
  assert.equal(f.host.querySelector('[data-last-sync]')?.getAttribute('data-last-sync'),last);assert.match(f.host.querySelector('.sidebar-footer')?.textContent||'',/同步失败/);
 }finally{await f.close()}
});

test('a write during refresh invalidates the read and visibly requests a retry without false success',async()=>{
 const f=await setup();let release!:(response:Response)=>void;
 try{
  const last=f.host.querySelector('[data-last-sync]')?.getAttribute('data-last-sync');
  f.setRead(()=>new Promise(resolve=>{release=resolve}));
  await act(async()=>click(button('立即同步')));
  await act(async()=>window.dispatchEvent(new window.Event('qingdan-mutated')));
  await act(async()=>release(Response.json(f.state)));await settle();
  assert.match(f.host.querySelector('.workspace-sync-panel [role="status"]')?.textContent||'',/新的修改.*重试/);assert.equal(button('立即同步')?.disabled,false);
  assert.equal(f.host.querySelector('[data-last-sync]')?.getAttribute('data-last-sync'),last);assert.match(f.host.querySelector('.sidebar-footer')?.textContent||'',/同步待重试/);
 }finally{await f.close()}
});

test('closing and reopening settings preserves the in-flight sync state and then shows its result',async()=>{
 const f=await setup();let release!:(response:Response)=>void;
 try{
  f.setRead(()=>new Promise(resolve=>{release=resolve}));await act(async()=>click(button('立即同步')));
  await act(async()=>click(f.host.querySelector('.modal button[aria-label="关闭"]')));assert.equal(f.host.querySelector('.settings-content'),null);
  await act(async()=>click(f.host.querySelector('button[title="设置"]')));await act(async()=>click(button('账号与同步')));
  assert.equal(button('正在同步…')?.disabled,true);
  await act(async()=>release(Response.json(f.state)));await settle();assert.match(f.host.querySelector('.workspace-sync-panel')?.textContent||'',/已刷新本机服务数据/);
 }finally{await f.close()}
});

test('polling does not supersede an in-progress manual refresh',async()=>{
 const original=g.setInterval;let poll:(()=>void)|undefined;
 g.setInterval=(callback:()=>void,delay:number,...args:any[])=>{if(delay===20000)poll=callback;return original(callback,delay,...args)};
 let f:Awaited<ReturnType<typeof setup>>|undefined,release!:(response:Response)=>void;
 try{
  f=await setup();f.setRead(()=>new Promise(resolve=>{release=resolve}));await act(async()=>click(button('立即同步')));const count=f.reads.length;
  assert.ok(poll);await act(async()=>poll!());assert.equal(f.reads.length,count);
  await act(async()=>release(Response.json(f!.state)));await settle();assert.match(f.host.querySelector('.workspace-sync-panel')?.textContent||'',/已刷新本机服务数据/);
 }finally{g.setInterval=original;if(f)await f.close()}
});

test('session rejection cannot be shown as successful synchronization or keep the old settings open',async()=>{
 const f=await setup();
 try{f.setRead(async()=>Response.json({error:'合成会话拒绝'},{status:403}));await act(async()=>click(button('立即同步')));await settle();assert.equal(f.host.querySelector('.settings-content'),null);assert.match(f.host.textContent||'',/当前会话需重新验证/);assert.equal(f.host.querySelector('.workspace-sync-panel'),null)}finally{await f.close()}
});

test('single-workspace header is a static local label without a misleading dropdown',async()=>{
 const f=await setup();
 try{const name=f.host.querySelector('.workspace-name');assert.ok(name);assert.equal(name.textContent,'本地空间');assert.equal(name.tagName,'SPAN');assert.equal(name.querySelector('svg'),null);assert.equal(name.getAttribute('role'),null);assert.equal(name.hasAttribute('tabindex'),false)}finally{await f.close()}
});


test('a manual paginated refresh stays pending until all pages commit and never exposes a failed partial collection',async()=>{
 const f=await setup();let release!:(response:Response)=>void;
 try{
  const last=f.host.querySelector('[data-last-sync]')?.getAttribute('data-last-sync');
  const partial={...f.state,records:[...f.state.records,{...f.state.records[0],id:'synthetic-partial-list',data:{title:'尚未完成的分页清单'}}],nextCursor:'synthetic-second'};
  f.setRead(async path=>path==='/api/data'?Response.json(partial):new Promise(resolve=>{release=resolve}));
  await act(async()=>click(button('立即同步')));await settle();
  assert.equal(button('正在同步…')?.disabled,true);assert.equal(f.host.textContent?.includes('尚未完成的分页清单'),false);
  assert.ok(f.reads.includes('/api/data?cursor=synthetic-second'));
  await act(async()=>release(Response.json({error:'合成第二页失败'},{status:503})));await settle();
  assert.match(f.host.querySelector('.workspace-sync-panel [role="alert"]')?.textContent||'',/合成第二页失败/);assert.equal(f.host.textContent?.includes('尚未完成的分页清单'),false);
  assert.equal(f.host.querySelector('[data-last-sync]')?.getAttribute('data-last-sync'),last);
  f.setRead(async path=>path==='/api/data'?Response.json(partial):Response.json({...f.state,records:[],nextCursor:null}));
  await act(async()=>click(button('立即同步')));await settle();
  assert.ok(f.host.textContent?.includes('尚未完成的分页清单'));assert.match(f.host.querySelector('.workspace-sync-panel [role="status"]')?.textContent||'',/已刷新本机服务数据/);
 }finally{await f.close()}
});


test('stalled refresh times out visibly, permits retry, and cannot commit a late expired response',async()=>{
 const f=await setup();const original=g.setTimeout;let expire:(()=>void)|undefined,release!:(response:Response)=>void;
 g.setTimeout=(callback:()=>void,delay:number,...args:any[])=>{if(delay===30000)expire=callback;return original(callback,delay,...args)};
 try{
  const last=f.host.querySelector('[data-last-sync]')?.getAttribute('data-last-sync');
  f.setRead(()=>new Promise(resolve=>{release=resolve}));await act(async()=>click(button('立即同步')));assert.ok(expire);
  await act(async()=>expire!());await settle();
  assert.match(f.host.querySelector('.workspace-sync-panel [role="alert"]')?.textContent||'',/超过30秒/);assert.equal(button('立即同步')?.disabled,false);
  assert.equal(f.host.querySelector('[data-last-sync]')?.getAttribute('data-last-sync'),last);
  f.setRead(async()=>Response.json(f.state));await act(async()=>click(button('立即同步')));await settle();
  const late={...f.state,records:[...f.state.records,{...f.state.records[0],id:'expired-late-list',data:{title:'过期结果不应提交'}}]};
  await act(async()=>release(Response.json(late)));await settle();
  assert.equal(f.host.textContent?.includes('过期结果不应提交'),false);assert.match(f.host.querySelector('.workspace-sync-panel [role="status"]')?.textContent||'',/已刷新本机服务数据/);
 }finally{g.setTimeout=original;await f.close()}
});


test('account sync and reminder descriptions match optional offline recovery and visible-page checks',async()=>{
 for(const mode of ['local','accounts']as const){
  const f=await setup(mode);
  try{
   await act(async()=>click(button('账号与同步')));
   const account=f.host.querySelector('.settings-content')?.textContent||'';
   assert.match(account,/启用前请先联网同步/);assert.match(account,/首次登录仍需联网/);
   assert.match(account,/不缓存附件字节/);assert.match(account,/保持应用打开且可见，连接恢复后会自动同步/);
   assert.match(account,/离线时无法获知共享权限变化，联网后由服务器重新核对/);
   assert.match(account,/本机数据不会自动上传到私服/);
   assert.doesNotMatch(account,/已认证会话完整离线应用壳及后台自动同步/);assert.doesNotMatch(account,/假同步|虚构集成/);
   if(mode==='local')assert.match(account,/本地单人模式，数据保存在此服务的本地目录。无需账号密码/);
   else assert.match(account,/账号模式，使用此部署实例的青单账号登录，服务器数据按账号隔离/);
   await act(async()=>click(button('提醒与专注')));
   const reminders=f.host.querySelector('.settings-content')?.textContent||'';
   assert.match(reminders,/应用页面打开且可见/);assert.match(reminders,/切到后台、隐藏或关闭后会暂停检查/);
   assert.match(reminders,/重新打开时，计时器会恢复进度/);
  }finally{await f.close()}
 }
});
