import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
const window: any = new Window({url:'http://127.0.0.1:4310/'}), g = globalThis as any;
for (const key of ['window','document','navigator','location','HTMLElement','Event','MouseEvent','MutationObserver']) Object.defineProperty(g,key,{value:window[key],configurable:true,writable:true});
g.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const {createRoot} = await import('react-dom/client'), {act} = React;
const {default: DesktopConnectionPanel} = await import('../app/desktop-connection');
const connected = {mode:'builtin',serverUrl:'http://127.0.0.1:4310/',status:'connected',serverMode:'local'};
async function mount(mode:'local'|'accounts'='local',compact=false) {
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  await act(async()=>root.render(<DesktopConnectionPanel mode={mode} compact={compact}/>));
  return {host,close:async()=>{await act(async()=>root.unmount());host.remove();window.happyDOM.abort()}};
}

test('desktop mode and exact service URL are visible and opening settings never writes data or connects a server',async()=>{
  let opened=0,requests=0;g.fetch=async()=>{requests++;throw Error('Unexpected network write')};
  window.qingdanDesktop={getConnection:async()=>connected,openConnectionSettings:async()=>{opened++;return{ok:true}}};
  const view=await mount();try{
    assert.match(view.host.textContent||'',/本机模式 · 免登录/);assert.match(view.host.textContent||'',/http:\/\/127.0.0.1:4310\//);assert.match(view.host.textContent||'',/不会自动上传或合并/);
    await act(async()=>view.host.querySelector('button')!.click());
    assert.equal(opened,1);assert.equal(requests,0);assert.match(view.host.querySelector('[role=status]')?.textContent||'',/已打开连接设置/);
  }finally{await view.close();delete window.qingdanDesktop}
});

test('private-server login panel exposes a return-to-settings action before login',async()=>{
  window.qingdanDesktop={getConnection:async()=>({...connected,mode:'server',serverUrl:'https://tasks.example.test/',serverMode:'accounts'}),openConnectionSettings:async()=>({ok:true})};
  const view=await mount('accounts',true);try{assert.match(view.host.textContent||'',/私服模式/);assert.match(view.host.textContent||'',/https:\/\/tasks.example.test\//);assert.equal(view.host.querySelector('button')?.type,'button');assert.match(view.host.textContent||'',/服务器的账号登录/)}finally{await view.close();delete window.qingdanDesktop}
});

test('repeated opening is locked until its first result and errors appear beside the action',async()=>{
  let opened=0,fail:((e:Error)=>void)|undefined;
  window.qingdanDesktop={getConnection:async()=>connected,openConnectionSettings:()=>{opened++;return new Promise((_resolve,reject)=>{fail=reject})}};
  const view=await mount();try{
    const button=view.host.querySelector('button')!;
    await act(async()=>{button.click();button.click()});assert.equal(opened,1);assert.equal(button.disabled,true);
    await act(async()=>fail!(new Error('Synthetic failure')));assert.equal(button.disabled,false);assert.match(view.host.querySelector('[role=alert]')?.textContent||'',/连接设置未能打开/);
  }finally{await view.close();delete window.qingdanDesktop}
});

test('failed state read still allows opening native settings and browser mode does not show a dead action',async()=>{
  window.qingdanDesktop={getConnection:async()=>{throw Error('Synthetic failure')},openConnectionSettings:async()=>({ok:true})};
  const view=await mount();try{assert.match(view.host.querySelector('[role=alert]')?.textContent||'',/无法读取/);assert.equal(view.host.querySelector('button')?.disabled,false)}finally{await view.close();delete window.qingdanDesktop}
  const browser=await mount();try{assert.equal(browser.host.querySelector('button'),null);assert.match(browser.host.textContent||'',/网页版/);assert.match(browser.host.textContent||'',/浏览器打开它的地址/)}finally{await browser.close()}
});


test('a connection that completes after the initial read is refreshed when the window regains focus',async()=>{
  let status='connecting',reads=0;
  window.qingdanDesktop={getConnection:async()=>{reads++;return{...connected,status}},openConnectionSettings:async()=>({ok:true})};
  const view=await mount();try{
    assert.match(view.host.textContent||'',/正在连接服务/);
    status='connected';await act(async()=>window.dispatchEvent(new window.Event('focus')));
    assert.ok(reads>=2);assert.match(view.host.textContent||'',/服务已连接/);assert.ok(!view.host.textContent?.includes('正在连接服务'));
  }finally{await view.close();delete window.qingdanDesktop}
});
