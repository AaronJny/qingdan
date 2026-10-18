'use strict';
const { t } = require('./language.cjs');
function menuTemplate({ platform, packaged, reconnect, settings, openWeb, explain, quit, quickAdd, showMain, recovery }) {
  const mac = platform === 'darwin'; const menu = [];
  if (mac) menu.push({ label: t("desktop.qingdan"), submenu: [{ role: 'about', label: t("desktop.about.qingdan") }, { type: 'separator' }, { role: 'services', label: t("desktop.services") }, { type: 'separator' }, { role: 'hide', label: t("desktop.hide.qingdan") }, { role: 'hideOthers', label: t("desktop.hide.others") }, { role: 'unhide', label: t("desktop.show.all") }, { type: 'separator' }, { role: 'quit', label: t("desktop.quit.qingdan") }] });
  menu.push({ label: t("desktop.file"), submenu: [{ label: t("desktop.quick.add.task"), accelerator: 'CmdOrCtrl+Shift+Space', click: quickAdd }, { label: t("desktop.open.qingdan"), click: showMain }, { type: 'separator' }, { label: t("desktop.connection.settings"), accelerator: 'CmdOrCtrl+,', click: settings }, { label: t("desktop.reconnect"), accelerator: 'CmdOrCtrl+Shift+R', click: reconnect }, { label: t("desktop.open.in.browser"), click: openWeb }, { type: 'separator' }, { role: 'close', label: t("desktop.close.window") }, ...(!mac ? [{ label: t("desktop.quit"), accelerator: 'CmdOrCtrl+Q', click: quit }] : [])] });
  menu.push({ label: t("desktop.edit"), submenu: [{ role: 'undo', label: t("desktop.undo") }, { role: 'redo', label: t("desktop.redo") }, { type: 'separator' }, { role: 'cut', label: t("desktop.cut") }, { role: 'copy', label: t("desktop.copy") }, { role: 'paste', label: t("desktop.paste") }, { role: 'selectAll', label: t("desktop.select.all") }] });
  menu.push({ label: t("desktop.view"), submenu: [{ role: 'reload', label: t("desktop.reload") }, { type: 'separator' }, { role: 'resetZoom', label: t("desktop.actual.size") }, { role: 'zoomIn', label: t("desktop.zoom.in") }, { role: 'zoomOut', label: t("desktop.zoom.out") }, { type: 'separator' }, { role: 'togglefullscreen', label: t("desktop.toggle.full.screen") }, ...(!packaged ? [{ role: 'toggleDevTools', label: t("desktop.developer.tools.development.only") }] : [])] });
  menu.push({ label: t("desktop.window"), submenu: [{ role: 'minimize', label: t("desktop.minimize") }, { role: 'zoom', label: t("desktop.zoom.window") }, ...(mac ? [{ role: 'front', label: t("desktop.bring.all.to.front") }] : [])] });
  menu.push({ label: t("desktop.help"), submenu: [{ label: t("desktop.modes.and.your.data"), click: explain }, {label:t('desktop.recovery.title'),click:recovery}] });
  return menu;
}
module.exports = { menuTemplate };
