'use strict';
document.querySelector('#connection-settings').addEventListener('click', async () => {
  const message = document.querySelector('#message');
  try { await window.qingdanDesktop.openConnectionSettings(); message.textContent = '连接设置已打开。'; }
  catch { message.textContent = '无法打开连接设置，请使用菜单“文件 → 服务器连接”。'; }
});
