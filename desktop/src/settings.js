'use strict';
const form = document.querySelector('form'); const input = document.querySelector('#server'); const mode = document.querySelector('#mode'); const submit = document.querySelector('button'); const message = document.querySelector('#message'); const currentConnection = document.querySelector('#current-connection');
let saving = false; let connectionPoll; let closed = false;
function reflectMode() { mode.disabled = saving; input.disabled = saving || mode.value !== 'server'; input.required = mode.value === 'server'; }
mode.addEventListener('change', reflectMode);
function showConnection(result) { const name = result.mode === 'builtin' ? '本机模式 · 免登录' : '私服 · ' + result.serverUrl; const state = result.status === 'connected' ? '已连接' : result.status === 'connecting' ? '连接中' : '未连接'; currentConnection.textContent = `当前：${name}（${state}）`; clearTimeout(connectionPoll); if (!closed && result.status === 'connecting') connectionPoll = setTimeout(readCurrentConnection, 800); }
async function readCurrentConnection() { if (closed) return; try { showConnection(await window.qingdanConnection.get()); } catch {} }
window.addEventListener('focus', readCurrentConnection);
window.addEventListener('unload', () => { closed = true; clearTimeout(connectionPoll); });
window.qingdanConnection.get().then(result => { mode.value = result.mode; input.value = result.serverUrl || ''; reflectMode(); showConnection(result); message.textContent = result.warning || result.error || ''; }).catch(() => { message.textContent = '无法读取连接配置。'; submit.disabled = true; });
form.addEventListener('submit', async event => {
  event.preventDefault(); if (saving) return; saving = true; reflectMode(); submit.disabled = true; message.textContent = '正在切换连接…';
  try { const result = await window.qingdanConnection.save({ mode: mode.value, serverUrl: mode.value === 'server' ? input.value.trim() : '' }); message.textContent = result.ok ? result.mode === 'builtin' ? '已连接本机服务，可以关闭此窗口。' : '已连接私服。请在主窗口使用该服务器的账号登录；已有会话可直接进入。' : result.error; try { showConnection(await window.qingdanConnection.get()); } catch {} }
  catch { message.textContent = '连接配置保存失败。'; } finally { saving = false; reflectMode(); submit.disabled = false; }
});
reflectMode();
