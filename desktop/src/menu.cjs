'use strict';
function menuTemplate({ platform, packaged, reconnect, settings, openWeb, explain, quit, quickAdd, showMain }) {
  const mac = platform === 'darwin'; const menu = [];
  if (mac) menu.push({ label: '青单', submenu: [{ role: 'about', label: '关于青单' }, { type: 'separator' }, { role: 'services', label: '服务' }, { type: 'separator' }, { role: 'hide', label: '隐藏青单' }, { role: 'hideOthers', label: '隐藏其他应用' }, { role: 'unhide', label: '显示全部' }, { type: 'separator' }, { role: 'quit', label: '退出青单' }] });
  menu.push({ label: '文件', submenu: [{ label: '快速新增任务', accelerator: 'CmdOrCtrl+Shift+Space', click: quickAdd }, { label: '打开青单', click: showMain }, { type: 'separator' }, { label: '服务器连接', accelerator: 'CmdOrCtrl+,', click: settings }, { label: '重新连接', accelerator: 'CmdOrCtrl+Shift+R', click: reconnect }, { label: '在浏览器中打开', click: openWeb }, { type: 'separator' }, { role: 'close', label: '关闭窗口' }, ...(!mac ? [{ label: '退出', accelerator: 'CmdOrCtrl+Q', click: quit }] : [])] });
  menu.push({ label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] });
  menu.push({ label: '视图', submenu: [{ role: 'reload', label: '重新载入' }, { type: 'separator' }, { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' }, ...(!packaged ? [{ role: 'toggleDevTools', label: '开发者工具（仅开发版）' }] : [])] });
  menu.push({ label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放窗口' }, ...(mac ? [{ role: 'front', label: '前置全部窗口' }] : [])] });
  menu.push({ label: '帮助', submenu: [{ label: '独立服务与数据说明', click: explain }] });
  return menu;
}
module.exports = { menuTemplate };
