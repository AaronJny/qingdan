'use strict';
const { t } = require('./language.cjs');
const { parseUrl, isServiceUrl, isStatusUrl, isSettingsResource, safeExternalUrl, safeDownloadFilename } = require('./policy.cjs');
function installPermissions(session) {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  if (session.setDevicePermissionHandler) session.setDevicePermissionHandler(() => false);
}
function installServiceSession(session, connection, canUseService = () => true) {
  installPermissions(session);
  session.webRequest.onBeforeRequest((details, callback) => {
    const url = parseUrl(details.url);
    let permitted = isServiceUrl(details.url, connection) || isStatusUrl(details.url);
    if (url?.protocol === 'blob:') permitted = url.origin === connection.origin && !['mainFrame', 'subFrame'].includes(details.resourceType);
    if (url?.protocol === 'data:') permitted = ['image', 'font', 'media'].includes(details.resourceType);
    // Current server uses same-origin fetch polling, not WebSockets.
    if (url && ['http:', 'https:', 'blob:'].includes(url.protocol) && !canUseService()) permitted = false;
    callback({ cancel: !permitted });
  });
  session.on('will-download', (event, item) => {
    const chain = item.getURLChain();
    const valid = canUseService() && item.getInitiatorOrigin() === connection.origin && chain.length && chain.every(value => {
      const url = parseUrl(value);
      return isServiceUrl(value, connection) || url?.protocol === 'blob:' && url.origin === connection.origin;
    });
    if (!valid) { event.preventDefault(); return; }
    item.setSaveDialogOptions({ title: t("desktop.save.qingdan.export"), defaultPath: safeDownloadFilename(item.getFilename()), buttonLabel: t("desktop.save") });
  });
}
function installLocalSession(session) {
  installPermissions(session);
  session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isSettingsResource(details.url) }));
  session.on('will-download', event => event.preventDefault());
}
function installContentsSecurity(contents, connection, { popupOptions, canOpenPopup, onPopupCreated, confirmExternal, onBlocked }) {
  contents.on('will-attach-webview', event => event.preventDefault());
  const navigation = (event, legacyUrl, _inPlace, legacyMain) => {
    const value = event.url ?? legacyUrl; const main = event.isMainFrame ?? legacyMain;
    if (isServiceUrl(value, connection) || isStatusUrl(value)) return;
    event.preventDefault();
    if (main !== false) {
      const external = safeExternalUrl(value);
      if (external) confirmExternal(external);
      else onBlocked();
    }
  };
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) contents.on(name, navigation);
  contents.setWindowOpenHandler(details => {
    if (isServiceUrl(details.url, connection) && canOpenPopup()) return { action: 'allow', overrideBrowserWindowOptions: popupOptions() };
    const external = safeExternalUrl(details.url);
    if (external) confirmExternal(external); else onBlocked();
    return { action: 'deny' };
  });
  contents.on('did-create-window', onPopupCreated);
  contents.on('page-title-updated', event => event.preventDefault());
}
function installSettingsContents(contents) {
  contents.on('will-attach-webview', event => event.preventDefault());
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) contents.on(name, event => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('page-title-updated', event => event.preventDefault());
}
module.exports = { installPermissions, installServiceSession, installLocalSession, installContentsSecurity, installSettingsContents };
