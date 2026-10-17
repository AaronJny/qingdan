'use strict';
const fs = require('node:fs'); const path = require('node:path');
const { app, BrowserWindow, Menu, dialog, shell, session, screen, protocol, ipcMain, utilityProcess } = require('electron');
const { SCHEME, UI_ORIGIN, LOCAL_SETTINGS_URL, validateDefaults, endpoint, isServiceUrl, isStatusUrl, isLocalUiUrl, safeExternalUrl, trustedSettingsSender, trustedServiceSender } = require('./policy.cjs');
const { readConnection, saveConnection, validateSelection } = require('./connection-store.cjs');
const { readState, saveState } = require('./window-state.cjs');
const { windowOptions } = require('./window-options.cjs');
const { installServiceSession, installLocalSession, installContentsSecurity, installSettingsContents } = require('./security.cjs');
const { statusPage, settingsPage, css, CSP } = require('./local-pages.cjs');
const { menuTemplate } = require('./menu.cjs');
const { probeServer } = require('./server-info.cjs');
const { createBackendManager } = require('./backend-manager.cjs');
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const defaults = validateDefaults(JSON.parse(fs.readFileSync(path.join(__dirname, 'defaults.json'), 'utf8')));
app.setName(defaults.appName); app.setAppUserModelId(defaults.appId);
// One stable per-user profile across installer/backend upgrades; never in app resources.
const profile = path.join(app.getPath('appData'), 'QingdanDesktop');
fs.mkdirSync(profile, { recursive: true, mode: 0o700 }); app.setPath('userData', profile);
const connectionFile = path.join(profile, 'connection.json');
let stored = readConnection(connectionFile);
let current = endpoint(stored.serverUrl || defaults.serverUrl, stored.mode === 'builtin');
let backend; let openingPromise = null; let openingGeneration = 0; let switchDecision = null; let shutdownPromise = null; let exitAfterShutdown = false;
let mainWindow = null; let settingsWindow = null; let popupWindow = null;
let quitting = false; let switching = false; let externalDialog = false;
const pendingCloses = new Map(); let saveTimer; let status = 'connecting'; let lastWindowClosed = false;
const sessions = new Set(); const connectionAttempts = new WeakMap(); let serverInfo = null; let connectionError = '';
function show(window) { if (!window || window.isDestroyed()) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
function response(body, contentType = 'text/html; charset=utf-8', code = 200) { return new Response(body, { status: code, headers: { 'content-type': contentType, 'content-security-policy': CSP, 'x-content-type-options': 'nosniff' } }); }
function serviceSession(connection) {
  const value = session.fromPartition(connection.partition);
  if (!sessions.has(connection.partition)) {
    installServiceSession(value, connection, () => !connection.builtin || backend?.status === 'ready' && backend.backendOrigin === connection.origin);
    value.protocol.handle(SCHEME, request => {
      if (isLocalUiUrl(request.url, 'status')) return response(statusPage(connection, status, connectionError));
      if (isLocalUiUrl(request.url, 'ui.css')) return response(css, 'text/css; charset=utf-8');
      if (isLocalUiUrl(request.url, 'status.js')) return response(fs.readFileSync(path.join(__dirname, 'status.js')), 'text/javascript; charset=utf-8');
      return response('Not found', 'text/plain', 404);
    });
    sessions.add(connection.partition);
  }
  return value;
}
function loadTrusted(window, connection, url) {
  if (!isServiceUrl(url, connection) && !isStatusUrl(url)) throw new Error('Blocked native loadURL');
  const attempt = connectionAttempts.get(window);
  const active = () => !window.isDestroyed() && !quitting && connection === current && connectionAttempts.get(window) === attempt;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (active()) {
        connectionError = '服务页面加载超时，请重新连接或更换服务器。';
        window.webContents.stop();
      }
      reject(Object.assign(new Error('Service page load timed out'), { code: 'QINGDAN_LOAD_TIMEOUT' }));
    }, 15000);
  });
  return Promise.race([window.loadURL(url), timeout]).then(() => active()).catch(error => {
    const aborted = error.code === 'ERR_ABORTED' || error.code === -3 || error.errno === -3;
    if (active() && (!aborted || connectionError)) showStatus(window);
    return false;
  }).finally(() => clearTimeout(timer));
}
function showStatus(window = mainWindow) {
  status = 'disconnected';
  if (window && !window.isDestroyed()) void window.loadURL(`${UI_ORIGIN}/status`).catch(() => {});
}
async function connectWindow(window, connection) {
  if (!window || window.isDestroyed() || quitting || connection !== current) return;
  const attempt = (connectionAttempts.get(window) || 0) + 1; connectionAttempts.set(window, attempt);
  const active = () => !window.isDestroyed() && !quitting && connection === current && connectionAttempts.get(window) === attempt;
  status = 'connecting'; connectionError = '';
  const statusLoaded = await loadTrusted(window, connection, `${UI_ORIGIN}/status`);
  if (!statusLoaded || !active()) return;
  const selected = serviceSession(connection);
  const result = await probeServer(connection, selected.fetch.bind(selected));
  if (!active()) return;
  if (!result.ok) { serverInfo = null; connectionError = result.error; showStatus(window); return; }
  serverInfo = result.info;
  // Server mode describes UI behavior only; it is not identity/authentication.
  const loaded = await loadTrusted(window, connection, connection.serverUrl);
  if (!active()) return false;
  if (loaded) status = 'connected';
  return loaded;
}
function persistWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try { saveState(path.join(profile, 'window-state.json'), { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() }); }
  catch { console.warn('Window state could not be saved.'); }
}
function ownedLocalAvailable(connection = current) { return !connection.builtin || backend?.status === 'ready' && backend.backendOrigin === connection.origin; }
async function confirmExternal(value, owner = mainWindow) {
  const safe = safeExternalUrl(value); const requestedConnection = current; const requestedOrigin = current.origin;
  const canOpen = () => requestedConnection === current && (!isServiceUrl(safe, requestedConnection) || ownedLocalAvailable(requestedConnection));
  if (!safe || externalDialog || quitting || owner?.isDestroyed() || !canOpen()) return;
  externalDialog = true;
  try {
    const result = await dialog.showMessageBox(owner || undefined, { type: 'question', title: '打开系统浏览器', message: '在默认浏览器中打开此链接？', detail: new URL(safe).origin, buttons: ['打开浏览器', '取消'], defaultId: 1, cancelId: 1, noLink: true });
    if (result.response === 0 && !quitting && canOpen() && requestedOrigin === current.origin && (!owner || !owner.isDestroyed())) await shell.openExternal(safe);
  } catch { if (!quitting && (!owner || !owner.isDestroyed())) void dialog.showMessageBox({ type: 'error', title: '青单', message: '无法打开系统浏览器。' }); }
  finally { externalDialog = false; }
}
function blocked() { if (!quitting) void dialog.showMessageBox(mainWindow || undefined, { type: 'warning', title: '青单', message: '已阻止不安全或未支持的跳转。', buttons: ['知道了'] }); }
function wire(window, connection) {
  installContentsSecurity(window.webContents, connection, {
    popupOptions: () => ({ ...windowOptions({ platform: process.platform, title: connection.builtin ? '青单 · 本机' : `青单 · ${new URL(connection.serverUrl).host}`, state: { width: 960, height: 760 }, partition: connection.partition, packaged: app.isPackaged }), parent: mainWindow || undefined }),
    canOpenPopup: () => !quitting && !switching && (!popupWindow || popupWindow.isDestroyed()),
    onPopupCreated: popup => {
      popupWindow = popup; popup.setMenu(null); wire(popup, connection); popup.show();
      popup.on('closed', () => { if (popupWindow === popup) popupWindow = null; });
    }, confirmExternal: value => confirmExternal(value, window), onBlocked: blocked,
  });
  window.webContents.on('did-navigate', () => window.setTitle(connection.builtin ? '青单 · 本机' : `青单 · ${new URL(connection.serverUrl).host}`));
  window.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => { if (isMainFrame && code !== -3 && !isStatusUrl(url)) showStatus(window); });
  window.webContents.on('will-prevent-unload', event => {
    const answer = dialog.showMessageBoxSync(window, { type: 'question', title: '青单', message: '页面还有未完成操作，确定离开吗？', buttons: ['留在页面', '离开页面'], defaultId: 0, cancelId: 0 });
    if (answer === 1) event.preventDefault();
    else {
      quitting = false;
      const pending = pendingCloses.get(window);
      if (pending) { pendingCloses.delete(window); pending.reject(new Error('已取消切换，原连接保持不变。')); }
    }
  });
  window.webContents.on('render-process-gone', () => { if (!window.isDestroyed() && !quitting) showStatus(window); });
  window.on('closed', () => {
    const pending = pendingCloses.get(window);
    if (pending) { pendingCloses.delete(window); if (quitting) pending.reject(new Error('应用正在退出。')); else pending.resolve(); }
  });
}
function createWindow(fromSwitch = false, connect = true) {
  if (quitting || switching && !fromSwitch) return null;
  lastWindowClosed = false;
  const connection = current; serviceSession(connection);
  const state = readState(path.join(profile, 'window-state.json'), screen.getAllDisplays());
  const options = windowOptions({ platform: process.platform, title: connection.builtin ? '青单 · 本机' : `青单 · ${new URL(connection.serverUrl).host}`, state, partition: connection.partition, packaged: app.isPackaged, icon: path.join(__dirname, '../build/icon.png') });
  options.webPreferences.preload = path.join(__dirname, 'service-preload.cjs');
  const window = new BrowserWindow(options);
  mainWindow = window; if (state.maximized) window.maximize(); wire(window, connection);
  window.once('ready-to-show', () => show(window));
  for (const name of ['move', 'resize', 'maximize', 'unmaximize']) window.on(name, () => { clearTimeout(saveTimer); saveTimer = setTimeout(persistWindow, 250); });
  window.on('close', () => { clearTimeout(saveTimer); persistWindow(); });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
    if (popupWindow && !popupWindow.isDestroyed()) popupWindow.close();
  });
  if (connect) window.connectionReady = connectWindow(window, connection); else showStatus(window);
  return window;
}
function closeForSwitch(window) {
  if (!window || window.isDestroyed()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    pendingCloses.set(window, { resolve, reject });
    try { window.close(); } catch (error) { pendingCloses.delete(window); reject(error); }
  });
}
async function openConfiguredConnection(fromSwitch = false) {
  if (quitting || switching && !fromSwitch) return null;
  if (openingPromise) return openingPromise;
  const selected = stored; const generation = ++openingGeneration;
  const active = () => !quitting && stored === selected && openingGeneration === generation;
  openingPromise = (async () => {
    const url = selected.mode === 'builtin' ? await backend.ensureLocal() : selected.serverUrl;
    if (!fromSwitch && switchDecision) await switchDecision.promise;
    if (!active()) return null;
    const next = endpoint(url, selected.mode === 'builtin');
    if (next.serverUrl === current.serverUrl && next.builtin === current.builtin) {
      const connected = mainWindow ? await connectWindow(mainWindow, current) : await createWindow(fromSwitch)?.connectionReady;
      return connected ? current : null;
    }
    const wasSwitching = switching; switching = true;
    try {
      await closeForSwitch(popupWindow); if (!active()) return null;
      await closeForSwitch(mainWindow); if (!active()) return null;
      current = next; serverInfo = null; connectionError = '';
      const connected = await createWindow(true)?.connectionReady;
      return connected ? next : null;
    } finally { switching = wasSwitching; }
  })().catch(() => {
    if (!active() || switching && !fromSwitch) return null;
    connectionError = selected.mode === 'builtin' ? '本机服务暂时无法启动，请重新连接。已有本机数据保留，也可从连接设置选择私服。' : '无法连接私服，请检查地址及HTTPS证书。';
    if (selected.mode === 'builtin' && !mainWindow) current = endpoint(defaults.serverUrl, true);
    if (!mainWindow) createWindow(fromSwitch, false); else showStatus(mainWindow);
    return null;
  }).finally(() => { openingPromise = null; });
  return openingPromise;
}
async function switchConnection(raw, requester) {
  if (switching || quitting) return { ok: false, error: '连接切换正在进行，请稍候。' };
  let selection; try { selection = validateSelection(raw); } catch (error) { return { ok: false, error: error.message }; }
  if (selection.mode === stored.mode && selection.serverUrl === stored.serverUrl) { const opened = await openConfiguredConnection(); return opened ? { ok: true, ...selection } : { ok: false, error: connectionError || '连接请求未完成，请重新连接。' }; }
  const active = () => !quitting && !!requester && !requester.isDestroyed() && settingsWindow === requester;
  if (!active()) return { ok: false, error: '连接设置窗口已经关闭。' };
  switching = true; const decision = {}; decision.promise = new Promise(resolve => { decision.resolve = resolve; }); switchDecision = decision;
  const releaseDecision = () => { if (switchDecision === decision) switchDecision = null; decision.resolve(); };
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const result = await dialog.showMessageBox(requester, { type: 'question', title: '切换青单使用方式', message: '切换会关闭当前页面，确定继续吗？', detail: `→ ${selection.mode === 'builtin' ? '内置本机模式' : selection.serverUrl}\n本机数据会保留，不会上传或合并到私服；登录信息不会复制到其他模式或服务器。`, buttons: ['切换', '取消'], defaultId: 1, cancelId: 1, noLink: true });
      if (!active()) throw new Error('连接请求已取消，原连接保持不变。');
      if (result.response !== 0) return { ok: false, error: '已取消切换，原连接保持不变。' };
    }
    // A declined or dismissed confirmation must not invalidate an earlier reconnect.
    openingGeneration++; releaseDecision();
    await closeForSwitch(popupWindow); if (!active()) throw new Error('连接请求已取消，原连接保持不变。');
    await closeForSwitch(mainWindow); if (!active()) throw new Error('连接请求已取消，原连接保持不变。');
    if (selection.mode === 'server') await backend.stop();
    if (openingPromise) await openingPromise;
    if (!active()) throw new Error('连接请求已取消，原连接保持不变。');
    saveConnection(connectionFile, selection); stored = { ...selection, warning: '' }; serverInfo = null; connectionError = '';
    const opened = await openConfiguredConnection(true);
    return opened ? { ok: true, ...selection } : { ok: false, error: connectionError || '服务未能启动；连接选择已保留，可重新连接或选择私服。' };
  } catch (error) {
    if (!mainWindow && !quitting && !lastWindowClosed) void openConfiguredConnection(true);
    return { ok: false, error: error.message || '连接保存失败。' };
  } finally {
    switching = false; releaseDecision();
    if (lastWindowClosed && !mainWindow && !settingsWindow && !popupWindow && process.platform !== 'darwin' && !quitting) app.quit();
  }
}

function openSettings() {
  if (quitting) return;
  if (settingsWindow && !settingsWindow.isDestroyed()) { show(settingsWindow); return; }
  settingsWindow = new BrowserWindow({
    ...windowOptions({ platform: process.platform, title: '青单服务器连接', state: { width: 700, height: 720 }, partition: 'qingdan-standalone-local-ui', packaged: app.isPackaged }),
    minWidth: 620, minHeight: 600,
    // Top-level settings must survive endpoint-window closure on Windows too.
    webPreferences: { ...windowOptions({ platform: process.platform, title: '', state: { width: 700, height: 720 }, partition: 'qingdan-standalone-local-ui', packaged: app.isPackaged }).webPreferences, preload: path.join(__dirname, 'settings-preload.cjs') },
  });
  const window = settingsWindow; installSettingsContents(window.webContents); window.setMenu(null);
  window.once('ready-to-show', () => show(window)); window.on('closed', () => { if (settingsWindow === window) settingsWindow = null; });
  void window.loadURL(LOCAL_SETTINGS_URL).catch(() => window.close());
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (quitting || switching) return; if (mainWindow) show(mainWindow); else if (app.isReady()) void openConfiguredConnection(); });
  app.on('activate', () => { if (quitting || switching) return; if (mainWindow) show(mainWindow); else void openConfiguredConnection(); });
  app.on('window-all-closed', () => { lastWindowClosed = true; if (process.platform !== 'darwin' && !switching) app.quit(); });
  app.on('before-quit', () => {
    quitting = true; clearTimeout(saveTimer); persistWindow();
    for (const pending of pendingCloses.values()) pending.reject(new Error('应用正在退出。'));
    pendingCloses.clear();
  });
  app.on('will-quit', event => {
    if (exitAfterShutdown || !backend) return;
    event.preventDefault(); quitting = true; openingGeneration++;
    if (!shutdownPromise) shutdownPromise = backend.stop().catch(() => {}).finally(() => { exitAfterShutdown = true; app.exit(0); });
  });
  app.on('certificate-error', (event, _contents, _url, _error, _cert, callback) => { event.preventDefault(); callback(false); });
  app.on('select-client-certificate', (event, _contents, _url, _certs, callback) => { event.preventDefault(); callback(); });
  app.on('login', (event, _contents, _details, _auth, callback) => { event.preventDefault(); callback(); });
  void app.whenReady().then(() => {
    backend = createBackendManager({ utilityProcess, userData: profile, backendRoot: path.join(__dirname, '../backend'), bootstrapPath: path.join(__dirname, 'backend-bootstrap.cjs') });
    backend.on('failure', () => { if (stored.mode === 'builtin' && !quitting && !switching) { connectionError = '本机服务已停止。请重新连接；已有本机数据保留。'; if (mainWindow) showStatus(mainWindow); } });
    const local = session.fromPartition('qingdan-standalone-local-ui'); installLocalSession(local);
    local.protocol.handle(SCHEME, request => {
      if (isLocalUiUrl(request.url, 'settings')) return response(settingsPage());
      if (isLocalUiUrl(request.url, 'ui.css')) return response(css, 'text/css; charset=utf-8');
      if (isLocalUiUrl(request.url, 'settings.js')) return response(fs.readFileSync(path.join(__dirname, 'settings.js')), 'text/javascript; charset=utf-8');
      return response('Not found', 'text/plain', 404);
    });
    ipcMain.handle('qingdan-desktop:connection', event => {
      if (!trustedServiceSender(event, mainWindow?.webContents, current) || quitting) throw new Error('Untrusted service sender');
      return { mode: current.builtin ? 'builtin' : 'server', serverUrl: current.serverUrl, status, serverMode: serverInfo?.mode || null };
    });
    ipcMain.handle('qingdan-desktop:open-settings', event => {
      if (!trustedServiceSender(event, mainWindow?.webContents, current) || quitting) throw new Error('Untrusted service sender');
      openSettings(); return { ok: true };
    });
    ipcMain.handle('qingdan-connection:get', event => {
      if (!trustedSettingsSender(event, settingsWindow?.webContents)) throw new Error('Untrusted settings sender');
      return { mode: stored.mode, serverUrl: stored.serverUrl, warning: stored.warning, serverInfo, status, error: connectionError };
    });
    ipcMain.handle('qingdan-connection:save', (event, serverUrl) => {
      if (!trustedSettingsSender(event, settingsWindow?.webContents)) throw new Error('Untrusted settings sender');
      return switchConnection(serverUrl, settingsWindow);
    });
    app.setAboutPanelOptions({ applicationName: '青单', applicationVersion: app.getVersion(), copyright: '独立开发的清单工作台。' });
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate({
      platform: process.platform, packaged: app.isPackaged, settings: openSettings,
      reconnect: () => { if (!quitting && !switching) void openConfiguredConnection(); },
      openWeb: () => confirmExternal(current.serverUrl), quit: () => app.quit(),
      explain: () => dialog.showMessageBox(mainWindow || undefined, { type: 'info', title: '使用方式与数据', message: '青单可在本机使用，也可连接自建服务器。', detail: '本机模式会自动启动内置服务，任务和附件保存在本机用户资料目录，升级应用会保留数据。连接自建服务器时，数据保存在该服务器；是否需要登录由服务器设置决定。切换使用方式不会搬移或合并数据，各服务器的登录状态相互独立。退出应用会停止内置服务；macOS 关闭窗口后可从 Dock 重新打开。' }),
    })));
    void openConfiguredConnection();
  }).catch(error => { console.error('Standalone desktop startup failed:', error.message); dialog.showErrorBox('青单无法启动', '请检查应用文件与连接配置。'); app.quit(); });
}
