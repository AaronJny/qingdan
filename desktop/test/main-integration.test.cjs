'use strict';

// Run: node --test test/main-integration.test.cjs
// The production main module runs in a VM with an in-memory filesystem and
// mocked Electron/backend APIs. No Electron, backend, socket, browser, child
// process, account or credential is created by these tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const root = path.join(__dirname, '..');
const statusUrl = 'qingdan-local://ui/status';
const ownedOrigin = 'http://127.0.0.1:51000';
const nextOwnedOrigin = 'http://127.0.0.1:51001';
const privateUrl = 'https://private.example/';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

async function harness({ platform = 'darwin', runtimePath = path, initialSelection, initialEnsure, hangPrivateLoad = false } = {}) {
  const windows = [], handlers = new Map(), sessions = new Map();
  const externalOpens = [], fetches = [], dialogs = [], exits = [], loadTimers = new Set();
  const files = new Map(), moduleCache = new Map();
  const appData = runtimePath.join(runtimePath.sep, 'mock-app-data');
  const profile = runtimePath.join(appData, 'QingdanDesktop');
  const connectionFile = runtimePath.join(profile, 'connection.json');
  if (initialSelection) files.set(connectionFile, JSON.stringify({ schemaVersion: 3, ...initialSelection }));
  let menu, deferDialogs = false, synchronousChoice = 0, writeFailure = false, probeFailure = false;

  const memoryFs = {
    mkdirSync() {},
    readFileSync(file, encoding) {
      if (files.has(file)) {
        const value = files.get(file);
        return encoding ? value : Buffer.from(value);
      }
      if (file === runtimePath.join(root, 'src', 'defaults.json')) return fs.readFileSync(path.join(root, 'src', 'defaults.json'), encoding);
      throw Object.assign(new Error('Not found in mock filesystem'), { code: 'ENOENT' });
    },
    writeFileSync(file, value) {
      if (writeFailure && file === `${connectionFile}.tmp`) throw Object.assign(new Error('Mock configuration write denied'), { code: 'EACCES' });
      files.set(file, String(value));
    },
    renameSync(from, to) {
      if (!files.has(from)) throw Object.assign(new Error('Missing mock temporary file'), { code: 'ENOENT' });
      files.set(to, files.get(from)); files.delete(from);
    },
  };

  class MockBackend extends EventEmitter {
    constructor() {
      super(); this.status = 'idle'; this.backendOrigin = null;
      this.ensureCalls = 0; this.stopCalls = 0;
      this.nextEnsure = null; this.nextStop = null; this.failEnsure = false;
    }
    async ensureLocal() {
      this.ensureCalls++;
      if (this.failEnsure) { this.status = 'failed'; throw new Error('Mock backend startup failure'); }
      if (this.nextEnsure) {
        const pending = this.nextEnsure; this.nextEnsure = null;
        this.status = 'starting'; this.backendOrigin = null;
        const origin = await pending.promise;
        this.status = 'ready'; this.backendOrigin = origin;
        return origin;
      }
      this.status = 'ready'; this.backendOrigin ||= ownedOrigin;
      return this.backendOrigin;
    }
    async stop() {
      this.stopCalls++; this.status = 'stopping'; this.backendOrigin = null;
      if (this.nextStop) { const pending = this.nextStop; this.nextStop = null; await pending.promise; }
      this.status = 'idle';
    }
    crash() {
      this.status = 'failed'; this.backendOrigin = null;
      this.emit('failure', new Error('Mock owned backend crash'));
    }
  }
  const backend = new MockBackend();
  if (initialEnsure) backend.nextEnsure = initialEnsure;

  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: true, paths: { appData }, quitCalls: 0,
    enableSandbox() { this.sandboxEnabled = true; }, setName() {}, setAppUserModelId() {},
    getPath(key) { return this.paths[key]; }, setPath(key, value) { this.paths[key] = value; },
    requestSingleInstanceLock: () => true, isReady: () => true,
    whenReady: () => Promise.resolve(), setAboutPanelOptions() {}, getVersion: () => '1.0.0',
    quit() { this.quitCalls++; this.emit('before-quit'); },
    exit(code) { exits.push(code); },
  });

  function createSession(partition) {
    const selected = new EventEmitter();
    selected.setPermissionRequestHandler = fn => { selected.permissionRequest = fn; };
    selected.setPermissionCheckHandler = fn => { selected.permissionCheck = fn; };
    selected.setDevicePermissionHandler = () => {};
    selected.webRequest = { onBeforeRequest(fn) { selected.beforeRequest = fn; } };
    selected.protocol = { handle(_scheme, fn) { selected.protocolHandler = fn; } };
    selected.fetch = async (url, options) => {
      fetches.push({ partition, url, options });
      let cancelled = false;
      selected.beforeRequest?.({ url, resourceType: 'xhr' }, result => { cancelled = result.cancel; });
      if (cancelled) throw new Error('Mock request blocked by production service policy');
      if (probeFailure) return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ app: 'qingdan', version: '1.0.0', mode: 'local' }), { headers: { 'content-type': 'application/json' } });
    };
    return selected;
  }
  const session = { fromPartition(partition) {
    if (!sessions.has(partition)) sessions.set(partition, createSession(partition));
    return sessions.get(partition);
  } };

  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false; this.loads = [];
      this.lastUrl = ''; this.closeMode = 'normal';
      this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: '' };
      this.webContents.getURL = () => this.lastUrl;
      this.webContents.stop = () => { this.stopCalls = (this.stopCalls || 0) + 1; };
      this.webContents.getLastWebPreferences = () => options.webPreferences;
      this.webContents.setWindowOpenHandler = fn => { this.webContents.open = fn; };
      windows.push(this);
    }
    loadURL(url) {
      if (this.destroyed) return Promise.reject(new Error('Mock window destroyed'));
      let cancelled = false;
      session.fromPartition(this.options.webPreferences.partition).beforeRequest?.({ url, resourceType: 'mainFrame' }, result => { cancelled = result.cancel; });
      if (cancelled) return Promise.reject(Object.assign(new Error('Mock policy cancellation'), { code: 'ERR_ABORTED' }));
      this.loads.push(url); this.lastUrl = url; this.webContents.mainFrame.url = url;
      if (hangPrivateLoad && url === privateUrl) return new Promise(() => {});
      return Promise.resolve();
    }
    isDestroyed() { return this.destroyed; } isMinimized() { return false; }
    isMaximized() { return false; } maximize() {} restore() {} focus() {}
    show() { this.shown = true; } setMenu() {} setTitle(value) { this.title = value; }
    getNormalBounds() { return { x: 0, y: 0, width: 1200, height: 800 }; }
    close() {
      if (this.destroyed) return;
      this.emit('close');
      if (this.closeMode === 'stay') {
        const event = { forced: false, preventDefault() { this.forced = true; } };
        this.webContents.emit('will-prevent-unload', event);
        if (!event.forced) return;
      }
      this.destroyed = true; this.emit('closed');
      if (platform === 'win32') for (const child of windows) if (!child.destroyed && child.options.parent === this) child.close();
    }
  }

  const electron = {
    app, BrowserWindow: Window, session,
    utilityProcess: { fork() { throw new Error('Real process creation is forbidden in this harness'); } },
    Menu: { buildFromTemplate(value) { menu = value; return value; }, setApplicationMenu() {} },
    dialog: {
      showMessageBox(owner, options) {
        const pending = deferred(); dialogs.push({ owner, options, pending });
        if (!deferDialogs) pending.resolve({ response: 0 });
        return pending.promise;
      },
      showMessageBoxSync: () => synchronousChoice, showErrorBox() {},
    },
    shell: { openExternal: async url => { externalOpens.push(url); } },
    screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1440, height: 900 } }] },
    protocol: { registerSchemesAsPrivileged() {} },
    ipcMain: { handle(name, fn) { handlers.set(name, fn); } },
  };

  function loadModule(file) {
    if (moduleCache.has(file)) return moduleCache.get(file).exports;
    const module = { exports: {} }; moduleCache.set(file, module);
    const code = fs.readFileSync(file, 'utf8');
    const localRequire = name => {
      if (name === 'electron') return electron;
      if (name === 'node:fs') return memoryFs;
      if (name === 'node:path') return runtimePath;
      if (['node:net', 'node:http', 'node:https', 'node:child_process'].includes(name)) throw new Error(`Real IO module forbidden: ${name}`);
      if (name === './backend-manager.cjs') return { createBackendManager: () => backend };
      if (name === '../package.json') return { qingdanReleaseChannel: 'preview' };
      if (name.startsWith('./')) return loadModule(path.resolve(path.dirname(file), name));
      return require(name);
    };
    const run = vm.runInNewContext(`(function(require,module,exports,__dirname){${code}\n})`, {
      process: { platform, env: {} }, console, Response, URL, AbortController,
      Buffer, setTimeout(fn, ms, ...args) { if (ms !== 15000) return setTimeout(fn, ms, ...args); const timer = { fn }; loadTimers.add(timer); return timer; }, clearTimeout(timer) { if (loadTimers.has(timer)) loadTimers.delete(timer); else clearTimeout(timer); },
    }, { filename: file });
    run(localRequire, module, module.exports, path.dirname(file));
    return module.exports;
  }
  loadModule(path.join(root, 'src/main.cjs'));
  await flush();

  const menuItem = label => {
    const item = menu.flatMap(group => group.submenu || []).find(value => value.label === label);
    assert.ok(item, `Missing native menu action ${label}`); return item;
  };
  const event = window => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  return {
    app, backend, windows, sessions, externalOpens, fetches, dialogs, exits, files, connectionFile,
    event, menuItem, liveMain: () => windows.filter(window => !window.destroyed && window.options.webPreferences.preload && runtimePath.basename(window.options.webPreferences.preload) === 'service-preload.cjs'),
    openSettings() { menuItem('服务器连接').click(); return windows.at(-1); },
    get(window) { return handlers.get('qingdan-connection:get')(event(window)); },
    save(window, value) { return handlers.get('qingdan-connection:save')(event(window), value); },
    call(name, senderEvent, ...args) { return handlers.get(name)(senderEvent, ...args); },
    deferDialogs() { deferDialogs = true; },
    answerLastDialog(response) { dialogs.at(-1).pending.resolve({ response }); },
    failWrites() { writeFailure = true; },
    setProbeFailure(value) { probeFailure = value; },
    expirePageLoads() { for (const timer of [...loadTimers]) { loadTimers.delete(timer); timer.fn(); } },
    resolvePrivateLoads() { hangPrivateLoad = false; },
    setUnloadChoice(value) { synchronousChoice = value; },
    willQuit() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; app.emit('will-quit', event); return event; },
  };
}

test('default builtin selection ensures owned backend before loading UI and never forks a real process', async () => {
  const h = await harness();
  assert.equal(h.app.getPath('userData'), path.join(h.app.getPath('appData'), 'QingdanDesktop'));
  assert.equal(h.backend.ensureCalls, 1);
  const main = h.liveMain()[0];
  assert.ok(main); assert.equal(main.lastUrl, `${ownedOrigin}/`);
  assert.equal(main.options.webPreferences.preload, path.join(root, 'src/service-preload.cjs'));
  assert.equal(main.options.webPreferences.sandbox, true);
  assert.ok(h.fetches.every(item => item.url === `${ownedOrigin}/api/app-info` && item.options.credentials === 'omit'));
});

test('REGRESSION: Windows path separators preserve profile, stored selection and main-window discovery', async () => {
  const h = await harness({ platform: 'win32', runtimePath: path.win32, initialSelection: { mode: 'server', serverUrl: privateUrl } });
  assert.equal(h.app.getPath('userData'), path.win32.join(path.win32.sep, 'mock-app-data', 'QingdanDesktop'));
  assert.equal(h.connectionFile, path.win32.join(h.app.getPath('userData'), 'connection.json'));
  const original = h.liveMain()[0], settings = h.openSettings();
  assert.ok(original); assert.equal(original.lastUrl, privateUrl);
  assert.equal(original.options.webPreferences.preload, path.win32.join(root, 'src', 'service-preload.cjs'));
  assert.equal(h.backend.ensureCalls, 0);
  assert.equal(h.liveMain().length, 1, 'Settings preload must not be mistaken for the service preload');
  assert.equal((await h.save(settings, { mode: 'builtin' })).ok, true);
  assert.equal(original.destroyed, true); assert.equal(settings.destroyed, false);
  assert.equal(h.liveMain().length, 1); assert.equal(h.liveMain()[0].lastUrl, `${ownedOrigin}/`);
  assert.deepEqual(JSON.parse(h.files.get(h.connectionFile)), { schemaVersion: 3, mode: 'builtin', serverUrl: '' });
});

test('explicit server selection does not start builtin backend and settings IPC rejects remote/forged senders', async () => {
  const h = await harness({ initialSelection: { mode: 'server', serverUrl: privateUrl } });
  const main = h.liveMain()[0], settings = h.openSettings();
  assert.equal(h.backend.ensureCalls, 0); assert.equal(main.lastUrl, privateUrl);
  assert.equal(h.get(settings).mode, 'server');
  assert.equal(settings.options.parent, undefined);
  assert.throws(() => h.call('qingdan-connection:get', h.event(main)), /Untrusted/);
  assert.throws(() => h.call('qingdan-connection:save', h.event(main), { mode: 'builtin' }), /Untrusted/);
  assert.throws(() => h.call('qingdan-connection:get', { sender: settings.webContents, senderFrame: { url: 'qingdan-local://ui/settings' } }), /Untrusted/);
  const result = await h.save(settings, { mode: 'server', serverUrl: 'http://192.168.1.1/' });
  assert.equal(result.ok, false); assert.equal(h.backend.ensureCalls, 0);
});

test('normal will-quit waits for owned backend stop before app.exit', async () => {
  const h = await harness(), stop = deferred();
  h.backend.nextStop = stop;
  h.app.emit('before-quit');
  for (const window of h.windows) window.close();
  assert.equal(h.willQuit().prevented, true);
  await flush(); assert.equal(h.backend.stopCalls, 1); assert.deepEqual(h.exits, []);
  stop.resolve(); await flush(); assert.deepEqual(h.exits, [0]);
});

test('late startup completion after will-quit cannot create a window or contact a service', async () => {
  const startup = deferred(), h = await harness({ initialEnsure: startup });
  assert.equal(h.backend.status, 'starting'); assert.equal(h.liveMain().length, 0);
  h.app.emit('before-quit'); assert.equal(h.willQuit().prevented, true); await flush();
  assert.equal(h.backend.stopCalls, 1); assert.deepEqual(h.exits, [0]);
  startup.resolve(ownedOrigin); await flush();
  assert.equal(h.liveMain().length, 0); assert.deepEqual(h.fetches, []);
});

test('builtin HTTP/blob request guard blocks a crashed or changed-origin backend while bundled status remains usable', async () => {
  const h = await harness(), main = h.liveMain()[0];
  const selected = h.sessions.get(main.options.webPreferences.partition);
  const allowed = (url, resourceType = 'xhr') => {
    let permitted;
    selected.beforeRequest({ url, resourceType }, result => { permitted = !result.cancel; });
    return permitted;
  };
  assert.equal(allowed(`${ownedOrigin}/api/tasks`), true);
  h.backend.crash(); await flush();
  assert.equal(allowed(`${ownedOrigin}/api/tasks`), false);
  assert.equal(allowed(`blob:${ownedOrigin}/test-export`), false);
  assert.equal(allowed(statusUrl, 'mainFrame'), true);
  h.backend.status = 'ready'; h.backend.backendOrigin = nextOwnedOrigin;
  assert.equal(allowed(`${ownedOrigin}/api/tasks`), false);
});

test('Stay during app quit preserves live window and owned backend until an actual will-quit', async () => {
  const h = await harness(), main = h.liveMain()[0];
  main.closeMode = 'stay'; h.app.emit('before-quit'); main.close();
  assert.equal(main.destroyed, false); assert.equal(h.backend.stopCalls, 0);
  const settings = h.openSettings(); assert.equal(settings.destroyed, false);
  assert.equal(h.backend.status, 'ready');
});

test('successful builtin-to-server switch stops owned backend and persists only schema/mode/origin', async () => {
  const h = await harness(), original = h.liveMain()[0], settings = h.openSettings();
  const result = await h.save(settings, { mode: 'server', serverUrl: privateUrl });
  await flush(); assert.equal(result.ok, true); assert.equal(original.destroyed, true);
  assert.equal(h.backend.stopCalls, 1); assert.equal(h.liveMain()[0].lastUrl, privateUrl);
  assert.notEqual(h.liveMain()[0].options.webPreferences.partition, original.options.webPreferences.partition);
  assert.deepEqual(JSON.parse(h.files.get(h.connectionFile)), { schemaVersion: 3, mode: 'server', serverUrl: privateUrl });
});

test('REGRESSION: server-to-builtin startup failure reports failure and keeps an actionable status window', async () => {
  const h = await harness({ initialSelection: { mode: 'server', serverUrl: privateUrl } });
  const settings = h.openSettings(); h.backend.failEnsure = true;
  const result = await h.save(settings, { mode: 'builtin' }); await flush();
  assert.equal(result.ok, false, 'Backend startup failure must not be reported as a successful connection');
  const main = h.liveMain()[0];
  assert.ok(main, 'Startup failure must retain a main/status window with native reconnect/settings actions');
  assert.equal(main.lastUrl, statusUrl);
  assert.ok(h.menuItem('重新连接')); assert.ok(h.menuItem('服务器连接'));
});

test('REGRESSION: failed builtin backend cannot open its stale port through system-browser menu', async () => {
  const h = await harness(); h.backend.crash(); await flush();
  assert.equal(h.liveMain()[0].lastUrl, statusUrl);
  h.menuItem('在浏览器中打开').click(); await flush();
  assert.deepEqual(h.externalOpens, [], 'A foreign process may have reclaimed the stale owned port');
});

test('REGRESSION: builtin ownership is rechecked after external-browser confirmation', async () => {
  const h = await harness(); h.deferDialogs();
  h.menuItem('在浏览器中打开').click(); await flush();
  assert.equal(h.dialogs.at(-1).options.title, '打开系统浏览器');
  h.backend.crash(); await flush(); h.answerLastDialog(0); await flush();
  assert.deepEqual(h.externalOpens, [], 'Readiness lost during confirmation must revoke the old-port open');
});

test('REGRESSION: ready backend on a different owned port cannot authorize an old-port browser confirmation', async () => {
  const h = await harness(); h.deferDialogs();
  h.menuItem('在浏览器中打开').click(); await flush();
  h.backend.backendOrigin = nextOwnedOrigin; h.backend.status = 'ready';
  h.answerLastDialog(0); await flush();
  assert.deepEqual(h.externalOpens, [], 'Readiness alone is insufficient without exact matching owned origin');
});

for (const cancellation of ['cancel', 'close-settings']) {
  test(`REGRESSION: ${cancellation} during pending restart preserves original reconnect to new owned origin`, async () => {
    const h = await harness(), settings = h.openSettings(), restart = deferred();
    h.backend.crash(); h.backend.nextEnsure = restart;
    h.menuItem('重新连接').click(); await flush();
    assert.equal(h.backend.status, 'starting'); h.deferDialogs();
    const pendingSwitch = h.save(settings, { mode: 'server', serverUrl: privateUrl }); await flush();
    if (cancellation === 'close-settings') settings.close();
    h.answerLastDialog(cancellation === 'cancel' ? 1 : 0);
    const result = await pendingSwitch;
    assert.equal(result.ok, false); assert.equal(h.backend.stopCalls, 0);
    restart.resolve(nextOwnedOrigin); await flush();
    const main = h.liveMain()[0];
    assert.ok(main, 'Cancelled switch must preserve/recover original mode main window');
    assert.equal(main.lastUrl, `${nextOwnedOrigin}/`, 'Original reconnect must finish after cancelled settings change');
    assert.equal(h.backend.backendOrigin, nextOwnedOrigin);
    assert.ok(!h.fetches.some(item => item.url.startsWith(privateUrl)), 'Cancelled server selection must never be contacted');
  });
}

test('main page Stay cancels mode change without stopping backend or writing configuration', async () => {
  const h = await harness(), main = h.liveMain()[0], settings = h.openSettings();
  main.closeMode = 'stay'; const result = await h.save(settings, { mode: 'server', serverUrl: privateUrl });
  assert.equal(result.ok, false); assert.equal(main.destroyed, false);
  assert.equal(h.backend.stopCalls, 0); assert.equal(h.files.has(h.connectionFile), false);
});

test('failed configuration write restores builtin mode rather than contacting proposed server', async () => {
  const h = await harness(), settings = h.openSettings(); h.failWrites();
  const result = await h.save(settings, { mode: 'server', serverUrl: privateUrl }); await flush();
  assert.equal(result.ok, false); assert.equal(h.get(settings).mode, 'builtin');
  assert.ok(h.liveMain()[0]); assert.equal(h.liveMain()[0].lastUrl, `${ownedOrigin}/`);
  assert.ok(!h.fetches.some(item => item.url.startsWith(privateUrl)));
});


test('service UI bridge opens one settings window without writing configuration or transmitting data', async () => {
  const h = await harness(), main = h.liveMain()[0];
  const snapshot = h.call('qingdan-desktop:connection', h.event(main));
  assert.equal(snapshot.mode, 'builtin'); assert.equal(snapshot.status, 'connected');
  assert.equal(snapshot.serverUrl, `${ownedOrigin}/`);
  assert.deepEqual(Object.keys(snapshot).sort(), ['mode', 'serverMode', 'serverUrl', 'status']);
  const calls = h.fetches.length;
  h.call('qingdan-desktop:open-settings', h.event(main));
  const settings = h.windows.at(-1);
  h.call('qingdan-desktop:open-settings', h.event(main));
  assert.equal(h.windows.at(-1), settings); assert.equal(h.fetches.length, calls);
  assert.equal(h.files.has(h.connectionFile), false);
  assert.equal(main.destroyed, false);
});

test('service bridge rejects settings, iframe, forged, old and off-origin callers', async () => {
  const h = await harness(), main = h.liveMain()[0], settings = h.openSettings();
  for (const name of ['qingdan-desktop:connection', 'qingdan-desktop:open-settings']) {
    assert.throws(() => h.call(name, h.event(settings)), /Untrusted/);
    assert.throws(() => h.call(name, { sender: main.webContents, senderFrame: { url: main.lastUrl } }), /Untrusted/);
    assert.throws(() => h.call(name, { sender: {}, senderFrame: main.webContents.mainFrame }), /Untrusted/);
    main.webContents.mainFrame.url = 'https://other.example/';
    assert.throws(() => h.call(name, h.event(main)), /Untrusted/);
    main.webContents.mainFrame.url = main.lastUrl;
  }
  await h.save(settings, { mode: 'server', serverUrl: privateUrl });
  assert.throws(() => h.call('qingdan-desktop:open-settings', h.event(main)), /Untrusted/);
  const next = h.liveMain()[0];
  assert.equal(h.call('qingdan-desktop:connection', h.event(next)).mode, 'server');
});

test('server probe failure is not falsely reported as a successful connection and permits retry', async () => {
  const h = await harness(), settings = h.openSettings(); h.setProbeFailure(true);
  const result = await h.save(settings, { mode: 'server', serverUrl: privateUrl });
  assert.equal(result.ok, false); assert.equal(h.get(settings).status, 'disconnected');
  const main = h.liveMain()[0]; assert.equal(main.lastUrl, statusUrl);
  assert.equal(h.call('qingdan-desktop:open-settings', h.event(main)).ok, true);
  h.setProbeFailure(false);
  const retry = await h.save(settings, { mode: 'server', serverUrl: privateUrl });
  assert.equal(retry.ok, true); assert.equal(h.get(settings).status, 'connected');
  assert.equal(h.liveMain()[0].lastUrl, privateUrl);
});

test('switching to a private server and back restores the local partition without transferring tasks', async () => {
  const h = await harness(), original = h.liveMain()[0], settings = h.openSettings();
  const localPartition = original.options.webPreferences.partition;
  assert.equal((await h.save(settings, { mode: 'server', serverUrl: privateUrl })).ok, true);
  assert.notEqual(h.liveMain()[0].options.webPreferences.partition, localPartition);
  assert.equal((await h.save(settings, { mode: 'builtin' })).ok, true);
  assert.equal(h.liveMain()[0].options.webPreferences.partition, localPartition);
  assert.ok(h.fetches.every(item => item.url.endsWith('/api/app-info') && item.options.credentials === 'omit'));
  assert.ok([...h.files.keys()].every(name => name.endsWith('connection.json') || name.endsWith('window-state.json')));
});


test('hung private page load times out, releases switch lock and permits return to builtin mode', async () => {
  const h = await harness({ hangPrivateLoad: true }), settings = h.openSettings();
  const pending = h.save(settings, { mode: 'server', serverUrl: privateUrl });
  await flush(); const main = h.liveMain()[0]; assert.equal(main.lastUrl, privateUrl);
  h.expirePageLoads(); const result = await pending;
  assert.equal(result.ok, false); assert.match(result.error, /页面加载超时/);
  assert.equal(main.stopCalls, 1); assert.equal(main.lastUrl, statusUrl);
  assert.equal(h.get(settings).status, 'disconnected');
  assert.equal((await h.save(settings, { mode: 'builtin' })).ok, true);
  assert.equal(h.liveMain()[0].lastUrl, `${ownedOrigin}/`);
});
