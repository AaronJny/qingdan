'use strict';
// Run with Node: node scripts/smoke-local-session.cjs --electron /path/to/stock/electron --report report.json
// The launcher copies the official stock runtime and ENABLES cookie encryption
// in that disposable copy. No installed runtime, product, or real profile is used.
// Two real Electron processes exercise the production sandboxed preload and IPC.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const PREFIX = 'qingdan-local-session-smoke-';
const VALUE = 'Synthetic durable draft · 中文 😀 é\n  exact whitespace  ';
const SEED = 'Synthetic draft present before the first page script';
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function parseArgs(args) {
  const out = { timeoutMs: 90000 };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!['--electron', '--report', '--timeout-ms'].includes(key) || !value || Object.hasOwn(out, key)) fail('INVALID_ARGUMENTS', 'Use --electron, --report and optional --timeout-ms only. No Chromium security flags are accepted.');
    out[key] = value;
  }
  if (out['--timeout-ms']) { out.timeoutMs = Number(out['--timeout-ms']); if (!Number.isInteger(out.timeoutMs) || out.timeoutMs < 5000 || out.timeoutMs > 180000) fail('INVALID_TIMEOUT', 'Timeout must be 5000–180000 ms per Electron process.'); }
  out.electron = out['--electron'] ? path.resolve(out['--electron']) : undefined;
  out.report = out['--report'] ? path.resolve(out['--report']) : undefined;
  return out;
}
function childEnvironment(environment) {
  const clean = { ...environment };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_SANDBOX', 'NODE_OPTIONS', 'NODE_PATH']) delete clean[key];
  return clean;
}
function isElectronChildEntrypoint(argv, electronVersion, filename = __filename) {
  // Electron's default app imports the CJS entrypoint through the ESM loader,
  // so require.main is not this module even though it is the selected app.
  return !!electronVersion && argv[2] === '--smoke-child' && typeof argv[1] === 'string' && path.resolve(argv[1]) === filename;
}
function inside(root, file) { const relative = path.relative(root, file); return relative === '' || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); }
function runtimeLayout(executable, platform = process.platform) {
  const real = fs.realpathSync(executable);
  const root = platform === 'darwin' ? path.resolve(real, '../../..') : path.dirname(real);
  if (platform === 'darwin' && (!root.endsWith('.app') || path.basename(path.dirname(real)) !== 'MacOS')) fail('NOT_STOCK_RUNTIME', 'Expected the stock Electron.app/Contents/MacOS/Electron executable.');
  const resources = path.join(root, platform === 'darwin' ? 'Contents/Resources' : 'resources');
  if (!fs.statSync(path.join(resources, 'default_app.asar')).isFile()) fail('NOT_STOCK_RUNTIME', 'A complete extracted stock Electron runtime is required.');
  return { root, executable: real, relativeExecutable: path.relative(root, real) };
}
function validateRuntimeTree(root) {
  let files = 0, bytes = 0;
  function visit(directory) {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (++files > 20000) fail('RUNTIME_LIMIT', 'Runtime copy exceeds the file count limit.');
      if (stat.isSymbolicLink()) {
        // Preserve only relative internal links. An absolute link to the source
        // bundle would otherwise let ad-hoc signing mutate the installed copy.
        if (path.isAbsolute(fs.readlinkSync(file)) || !inside(root, fs.realpathSync(file))) fail('UNSAFE_RUNTIME_LINK', 'A runtime symlink is absolute or escapes the stock runtime.');
      }
      else if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) { bytes += stat.size; if (bytes > 2 * 1024 ** 3) fail('RUNTIME_LIMIT', 'Runtime copy exceeds 2 GiB.'); }
      else fail('UNSAFE_RUNTIME_FILE', 'Runtime contains a non-regular file.');
    }
  }
  visit(root); return { files, bytes };
}
async function prepareRuntime(executable, fixture, platform = process.platform) {
  const { getCurrentFuseWire, flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
  const layout = runtimeLayout(executable, platform);
  if (inside(layout.root, fixture)) fail('UNSAFE_RUNTIME_COPY', 'The test fixture cannot be inside the source runtime.');
  const tree = validateRuntimeTree(layout.root);
  const sourceWire = await getCurrentFuseWire(layout.executable);
  const target = path.join(fixture, platform === 'darwin' ? 'Test Electron.app' : 'test-runtime');
  fs.cpSync(layout.root, target, { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true, force: false, errorOnExist: true });
  const copiedExecutable = path.join(target, layout.relativeExecutable);
  const fuseTarget = platform === 'darwin' ? target : copiedExecutable;
  await flipFuses(fuseTarget, { version: FuseVersion.V1, [FuseV1Options.EnableCookieEncryption]: true, resetAdHocDarwinSignature: platform === 'darwin' });
  const wire = await getCurrentFuseWire(fuseTarget);
  assert.equal(wire[FuseV1Options.EnableCookieEncryption], 49, 'Test runtime must enable cookie encryption.');
  for (const key of Object.keys(sourceWire)) if (key !== String(FuseV1Options.EnableCookieEncryption)) assert.equal(wire[key], sourceWire[key], 'No other fuse may change.');
  assert.deepEqual(await getCurrentFuseWire(layout.executable), sourceWire, 'The installed/source runtime must remain untouched.');
  return { executable: copiedExecutable, report: { sourceCookieEncryption: sourceWire[FuseV1Options.EnableCookieEncryption] === 49, testCookieEncryption: true, onlyCookieEncryptionFuseChanged: true, sourceFuseWireUnchanged: true, macTestCopyAdHocReset: platform === 'darwin', ...tree } };
}
function launchPhase(executable, fixture, phase, timeoutMs, environment = process.env) {
  return new Promise((resolve, reject) => {
    let output = '', done = false;
    const child = spawn(executable, [__filename, '--smoke-child', phase, fixture], { env: childEnvironment(environment), stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = bytes => { output = (output + bytes.toString()).slice(-32768); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    const complete = error => { if (done) return; done = true; clearTimeout(timer); if (error) reject(error); };
    child.once('error', error => complete(Object.assign(error, { output, code: error.code || 'ELECTRON_LAUNCH_FAILED' })));
    child.once('close', (code, signal) => {
      if (done) return;
      let report;
      try { report = JSON.parse(fs.readFileSync(path.join(fixture, phase + '.json'), 'utf8')); } catch {}
      if (code !== 0 || signal || !report?.passed) return complete(Object.assign(new Error(report?.error?.message || `Electron ${phase} did not complete (exit ${code}, signal ${signal || 'none'}). Inspect display/sandbox launch diagnostics; no security bypass was attempted.`), { code: report?.error?.code || (signal === 'SIGKILL' ? 'ELECTRON_TIMEOUT' : 'ELECTRON_PHASE_FAILED'), output, phase, childReport: report }));
      complete(); resolve(report);
    });
  });
}
async function runSmoke(options) {
  const report = { schema: 'qingdan-real-local-session-smoke-v1', passed: false, platform: process.platform, arch: process.arch, packagedAppTested: false, keychainAccessInstrumented: false, realUserProfileAccessed: false, phases: [] };
  let fixture;
  try {
    const executable = options.electron || require('electron');
    if (typeof executable !== 'string') fail('NO_ELECTRON_EXECUTABLE', 'Run the launcher with Node and point --electron to a stock runtime.');
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
    const principalId = 'local:' + crypto.randomUUID();
    fs.writeFileSync(path.join(fixture, 'fixture.json'), JSON.stringify({ schema: report.schema, principalId, seed: SEED, value: VALUE }), { mode: 0o600 });
    const runtime = await prepareRuntime(executable, fixture); report.runtime = runtime.report;
    for (const phase of ['write', 'read']) report.phases.push(await launchPhase(runtime.executable, fixture, phase, options.timeoutMs));
    assert.equal(report.phases[0].origin, report.phases[1].origin, 'Restart must use the same origin and partition, not hide browser persistence behind a port change.');
    assert.notEqual(report.phases[0].pid, report.phases[1].pid, 'The two phases must be different Electron processes.');
    report.passed = true; report.actualProcessRestart = true; report.sameOriginAcrossRestart = true;
    fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); fixture = undefined;
  } catch (error) { report.passed = false; report.error = { code: error.code || 'SMOKE_FAILED', message: error.message, phase: error.phase, output: error.output, childReport: error.childReport }; if (fixture) report.failedSyntheticFixture = fixture; }
  if (options.report) fs.writeFileSync(options.report, JSON.stringify(report, null, 2) + '\n');
  return report;
}
async function electronChild(phase, fixture) {
  const { app, BrowserWindow, session, ipcMain } = require('electron');
  const { endpoint, isServiceUrl } = require('../src/policy.cjs');
  const { windowOptions } = require('../src/window-options.cjs');
  const { installServiceSession, installContentsSecurity } = require('../src/security.cjs');
  const { LocalBusinessStore } = require('../src/local-business-store.cjs');
  const { handleLocalBusiness } = require('../src/local-business-ipc.cjs');
  const { probeLocalPrincipal } = require('../src/server-info.cjs');
  const http = require('node:http');
  const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
  if (!['write', 'read'].includes(phase) || !path.isAbsolute(fixture) || !path.basename(fixture).startsWith(PREFIX) || fs.lstatSync(fixture).isSymbolicLink()) fail('INVALID_CHILD_FIXTURE', 'Expected a launcher-created synthetic fixture.');
  const data = JSON.parse(fs.readFileSync(path.join(fixture, 'fixture.json')));
  assert.equal(data.schema, 'qingdan-real-local-session-smoke-v1');
  for (const flag of ['no-sandbox', 'disable-gpu-sandbox', 'disable-web-security']) assert(!app.commandLine.hasSwitch(flag), `Unsafe switch ${flag} is forbidden.`);
  app.enableSandbox(); app.setName('Qingdan Synthetic Session Smoke');
  for (const [name, directory] of [['userData', 'profile'], ['sessionData', 'browser-data'], ['crashDumps', 'crashes']]) { const target = path.join(fixture, directory); fs.mkdirSync(target, { recursive: true, mode: 0o700 }); app.setPath(name, target); }
  const report = { phase, passed: false, pid: process.pid, electron: process.versions.electron, node: process.versions.node, arch: process.arch, sessions: [], assertions: [], keychainAccessInstrumented: false };
  const createdWindows = [], servers = []; let unexpectedSession = false, credentialRequest = false, blockedRequestHits = 0;
  app.on('session-created', value => { const info = { persistent: value.isPersistent(), storagePathNull: value.storagePath === null }; report.sessions.push(info); if (info.persistent || !info.storagePathNull) unexpectedSession = true; });
  app.on('window-all-closed', () => {});
  let context, owned, sentinel;
  function passed(name) { report.assertions.push(name); }
  function stage(name) { report.stage = name; console.log(`Qingdan synthetic smoke ${phase}: ${name}`); }
  async function server(port = 0) {
    const value = http.createServer((request, response) => {
      if (request.headers.cookie || request.headers.authorization) credentialRequest = true;
      if (request.url?.startsWith('/should-never-reach-backend')) blockedRequestHits++;
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; frame-src 'self'; connect-src 'self' blob:");
      if (request.url === '/api/auth/me') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ mode: 'local', user: { userId: data.principalId } })); return; }
      if (request.url === '/boot.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(`try { window.smokeFirstValue = window.qingdanLocalStorage.getItem(${JSON.stringify('qingdan:quick-draft:' + data.principalId)}); } catch (error) { window.smokeStartupError = error.message; }`); return; }
      response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><meta charset="utf-8"><title>Synthetic local session smoke</title><script src="/boot.js"></script><body>Only synthetic input.</body>');
    });
    servers.push(value); await new Promise((resolve, reject) => { value.once('error', reject); value.listen(port, '127.0.0.1', resolve); });
    return `http://127.0.0.1:${value.address().port}/`;
  }
  function optionsFor(connection, required = true) {
    const options = windowOptions({ platform: process.platform, title: 'Synthetic local session smoke', state: { width: 600, height: 500 }, partition: connection.partition, packaged: false });
    options.show = false; options.webPreferences.preload = path.join(ROOT, 'src/service-preload.cjs'); options.webPreferences.additionalArguments = required ? ['--qingdan-owned-local'] : [];
    return options;
  }
  function assertWindow(window) {
    const preferences = window.webContents.getLastWebPreferences();
    for (const field of ['sandbox', 'contextIsolation', 'webSecurity']) assert.equal(preferences[field], true, field);
    for (const field of ['nodeIntegration', 'nodeIntegrationInSubFrames', 'nodeIntegrationInWorker']) assert.equal(preferences[field], false, field);
    assert.equal(window.webContents.session.storagePath, null); assert.equal(window.webContents.session.isPersistent(), false);
    if (process.platform === 'darwin' || process.platform === 'win32') {
      const metric = app.getAppMetrics().find(item => item.pid === window.webContents.getOSProcessId());
      assert.equal(metric?.sandboxed, true, 'Electron must report the actual renderer OS sandbox enabled.');
    }
  }
  async function create(connection, { trusted = true, required = true } = {}) {
    const options = optionsFor(connection,required);
    const window = new BrowserWindow(options); createdWindows.push(window); if (trusted) context.windows.push(window);
    const preloadErrors = []; window.webContents.on('preload-error', (_event, filename, error) => preloadErrors.push({ filename, message: error.message }));
    await window.loadURL(connection.serverUrl); assert.deepEqual(preloadErrors, [], 'Production preload must load without errors.');
    assertWindow(window);
    return window;
  }
  const evalPage = (window, expression, userGesture = false) => window.webContents.executeJavaScript(expression,userGesture);
  try {
    stage('verifying enabled cookie fuse');
    assert.equal(process.versions.electron, require('../package.json').devDependencies.electron, 'Use the locked Electron version.');
    assert.equal((await getCurrentFuseWire(process.execPath))[FuseV1Options.EnableCookieEncryption], 49);
    stage('waiting for app.ready'); await app.whenReady(); stage('starting synthetic server');
    const prior = phase === 'read' ? JSON.parse(fs.readFileSync(path.join(fixture, 'write.json'))) : null;
    const origin = await server(prior ? Number(new URL(prior.origin).port) : 0);
    const connection = endpoint(origin, true); report.origin = connection.origin; report.partition = connection.partition;
    assert(!connection.partition.startsWith('persist:'));
    const selected = session.fromPartition(connection.partition);
    assert.equal(selected.storagePath, null); assert.equal(selected.isPersistent(), false);
    let rescueGateCalls=0;
    installServiceSession(selected, connection, () => context?.backend.status === 'ready' && context.backend.backendOrigin === connection.origin, id => {
      rescueGateCalls++;
      return !context?.quitting && !context?.switching && context?.connection === connection && context.windows.some(window => !window.isDestroyed() && window.webContents.id === id && window.webContents.session === selected && isServiceUrl(window.webContents.mainFrame?.url,connection));
    });
    const store = new LocalBusinessStore({ profile: path.join(fixture, 'profile'), principalId: data.principalId });
    const key = 'qingdan:quick-draft:' + data.principalId;
    if (phase === 'write') store.write(key, data.seed, 0); else assert.equal(store.read(key).value, data.value);
    context = { connection, expectedSession:selected, backend: { status: 'ready', backendOrigin: connection.origin }, windows: [], store, quitting: false };
    ipcMain.on('qingdan-local-business', (event, request) => {
      const reply = handleLocalBusiness(event, request, context);
      // Synthetic-only diagnostics distinguish an early document identity from
      // omitted Electron preference metadata; never log draft values or tokens.
      if (!reply.ok && (report.deniedIpc?.length || 0) < 16) {
        report.deniedIpc ||= [];
        const owner = context.windows.find(window => !window.isDestroyed() && window.webContents === event.sender);
        report.deniedIpc.push({ operation:request?.operation, code:reply.code, backendReady:context.backend.status === 'ready', ownedWindow:!!owner, mainFrame:!!owner && event.senderFrame === owner.webContents.mainFrame, senderUrl:event.senderFrame?.url, mainFrameUrl:owner?.webContents.mainFrame?.url, preferencePartition:owner?.webContents.getLastWebPreferences().partition ?? null, expectedPartition:context.connection.partition, sessionMatches:owner?.webContents.session === selected });
      }
      event.returnValue = reply;
    });
    stage('probing synthetic local identity'); assert.equal(await probeLocalPrincipal(connection, selected.fetch.bind(selected)), data.principalId);
    // A legacy-shaped directory is only a sentinel. It contains no credentials
    // or database and is never passed to session.fromPartition or any driver.
    sentinel = path.join(fixture, 'profile', 'Partitions', 'qingdan-desktop-local-' + crypto.createHash('sha256').update(connection.origin).digest('hex').slice(0, 20));
    if (phase === 'write') { fs.mkdirSync(sentinel, { recursive: true }); fs.writeFileSync(path.join(sentinel, 'synthetic-sentinel.txt'), 'never activate this legacy session\n'); }
    stage('loading first owned window'); owned = await create(connection); stage('checking initial hydration');
    const initial = await evalPage(owned, `({first:window.smokeFirstValue,error:window.smokeStartupError||null,required:window.qingdanDesktop.localBusinessStorageRequired,node:typeof require,process:typeof process,ephemeral:localStorage.getItem('qingdan-smoke-ephemeral')})`);
    assert.deepEqual(initial, { first: phase === 'write' ? data.seed : data.value, error: null, required: true, node: 'undefined', process: 'undefined', ephemeral: null });
    passed('production sandboxed/context-isolated preload hydrates before first page script; no Node in main world');
    if (phase === 'write') {
      await evalPage(owned, `window.qingdanLocalStorage.setItem(${JSON.stringify(key)},${JSON.stringify(data.value)});localStorage.setItem('qingdan-smoke-ephemeral','first-process-only');true`);
      assert.equal(JSON.parse(fs.readFileSync(store.file)).entries[key].value, data.value);
      passed('synchronous bridge write is durable before returning to the renderer');
      owned.destroy(); context.windows = [];
      context.store = new LocalBusinessStore({ profile: path.join(fixture, 'profile'), principalId: data.principalId });
      owned = await create(connection);
      assert.equal(await evalPage(owned, 'window.smokeFirstValue'), data.value);
      passed('renderer recreation hydrates the production durable store');
    } else passed('same-origin process restart retains native draft while Chromium localStorage is empty');
    stage('checking production window.open popup inheritance');
    let popup, popupResolve, popupReject, externalConfirmations = 0;
    const popupReady = new Promise((resolve,reject) => { popupResolve=resolve;popupReject=reject; });
    popupReady.catch(()=>{}); // Preserve rejection for await without a transient unhandled rejection.
    const popupTimer = setTimeout(()=>popupReject(new Error('Production window.open popup did not finish loading.')),10000);
    const secureContents = window => installContentsSecurity(window.webContents,connection,{
      popupOptions:()=>({...optionsFor(connection),parent:owned}), canOpenPopup:()=>!popup || popup.isDestroyed(),
      onPopupCreated:created=>{
        popup=created;createdWindows.push(created);context.windows.push(created);secureContents(created);
        created.webContents.once('preload-error',(_event,_filename,error)=>popupReject(error));
        created.webContents.once('did-finish-load',()=>popupResolve(created));
      },confirmExternal:()=>externalConfirmations++,onBlocked:()=>{},
    });
    secureContents(owned);
    try { await evalPage(owned, `window.open('/popup','qingdan-synthetic-popup');true`,true); await popupReady; } finally {clearTimeout(popupTimer);}
    assertWindow(popup); assert.equal(popup.webContents.session,selected);
    assert.deepEqual(await evalPage(popup,'({first:window.smokeFirstValue,error:window.smokeStartupError||null,required:window.qingdanDesktop.localBusinessStorageRequired,node:typeof require})'),{first:data.value,error:null,required:true,node:'undefined'});
    passed('production window.open handler creates an owned sandboxed memory-session popup with synchronous native hydration');
    stage('checking rejected window and frame access'); const unowned = await create(connection, { trusted: false });
    assert.equal(await evalPage(unowned, `(()=>{try{window.qingdanLocalStorage.getItem(${JSON.stringify(key)});return false}catch{return true}})()`), true);
    passed('same-origin but unowned window is rejected by production IPC');
    const foreign = endpoint(await server(), true), foreignSession = session.fromPartition(foreign.partition);
    installServiceSession(foreignSession, foreign);
    const offOrigin = await create(foreign);
    assert.equal(await evalPage(offOrigin, `(()=>{try{window.qingdanLocalStorage.getItem(${JSON.stringify(key)});return false}catch{return true}})()`), true);
    passed('foreign-origin frame with a bridge cannot access the owned local store');
    const remoteShape = await create(foreign, { trusted: false, required: false });
    assert.deepEqual(await evalPage(remoteShape, '({required:window.qingdanDesktop.localBusinessStorageRequired,bridge:typeof window.qingdanLocalStorage})'), { required: false, bridge: 'undefined' });
    passed('non-local preload exposes no native business storage');
    const windowCount=createdWindows.length;
    await evalPage(owned,`window.open(${JSON.stringify(foreign.serverUrl)},'denied-external-popup');true`,true);
    assert.equal(externalConfirmations,1);assert.equal(createdWindows.length,windowCount);
    passed('production popup policy denies a foreign origin and requests external confirmation without opening it');
    await evalPage(owned, `new Promise(resolve=>{const frame=document.createElement('iframe');frame.src='/frame';frame.onload=()=>resolve();document.body.append(frame)})`);
    const frame = owned.webContents.mainFrame.frames[0]; assert(frame, 'A real child frame is required.');
    assert.equal(await frame.executeJavaScript('typeof window.qingdanLocalStorage'), 'undefined');
    const deniedFrame = handleLocalBusiness({ sender: owned.webContents, senderFrame: frame }, { operation: 'snapshot' }, context);
    assert.equal(deniedFrame.ok, false); passed('real subframe has no bridge and is rejected by frame identity');
    const blobUrl=await evalPage(owned,`URL.createObjectURL(new Blob([${JSON.stringify(data.value)}],{type:'text/plain;charset=utf-8'}))`);
    const unownedBlob=await evalPage(unowned,`URL.createObjectURL(new Blob(['unowned synthetic input'],{type:'text/plain'}))`);
    context.backend.status = 'failed';
    assert.equal(await evalPage(owned, `(()=>{try{window.qingdanLocalStorage.getItem(${JSON.stringify(key)});return false}catch{return true}})()`), true);
    passed('loss of owned backend revokes storage access');
    stage('checking production Blob rescue with backend unavailable');
    const beforeBlobFetch=rescueGateCalls;
    assert.equal(await evalPage(owned,`fetch(${JSON.stringify(blobUrl)}).then(response=>response.text())`),data.value);
    // Reading the renderer's own Blob is not native storage/export access.
    // Chromium can resolve it locally without entering Electron webRequest.
    report.unownedOwnBlobFetch=await evalPage(unowned,`fetch(${JSON.stringify(unownedBlob)}).then(response=>response.text()).then(value=>value==='unowned synthetic input'?'read-own-renderer-memory':'unexpected',()=> 'blocked')`);
    assert.notEqual(report.unownedOwnBlobFetch,'unexpected');
    report.blobFetchRescueGateCalls=rescueGateCalls-beforeBlobFetch;
    assert.equal(await evalPage(owned,`fetch('/should-never-reach-backend').then(()=>false,()=>true)`),true);
    await assert.rejects(selected.fetch(foreign.origin+'/should-never-reach-backend',{credentials:'omit',redirect:'error'}));
    assert.equal(blockedRequestHits,0,'Backend-loss rescue must not send same-origin or foreign HTTP requests.');
    let rejectedResolve,rejectedReject;
    const rejectedDownload=new Promise((resolve,reject)=>{rejectedResolve=resolve;rejectedReject=reject;});rejectedDownload.catch(()=>{});
    const rejectedTimer=setTimeout(()=>rejectedReject(new Error('Unowned Blob export did not reach the actual download guard.')),10000);
    const onRejectedDownload=(event,_item,contents)=>{
      const preventedByProduction=event.defaultPrevented;
      event.preventDefault(); // Fail safely if the real production guard regresses.
      try {assert.equal(contents,unowned.webContents);assert.equal(preventedByProduction,true,'Production must reject unowned Blob export before the test listener.');rejectedResolve();}catch(error){rejectedReject(error);}
    };
    selected.once('will-download',onRejectedDownload);
    try {
      await evalPage(unowned,`(()=>{const a=document.createElement('a');a.href=${JSON.stringify(unownedBlob)};a.download='must-not-export.txt';document.body.append(a);a.click();a.remove();return true})()`,true);
      await rejectedDownload;
    } finally {clearTimeout(rejectedTimer);selected.removeListener('will-download',onRejectedDownload);}
    const rescuePath=path.join(fixture,phase+'-synthetic-rescue.txt');
    let downloadResolve,downloadReject;
    const downloaded=new Promise((resolve,reject)=>{downloadResolve=resolve;downloadReject=reject;});
    downloaded.catch(()=>{});
    const downloadTimer=setTimeout(()=>downloadReject(new Error('Owned synthetic Blob download did not complete.')),10000);
    const onDownload=(event,item,contents)=>{
      try {
        assert.notEqual(event.defaultPrevented,true,'The production download guard must permit the owned rescue.');
        assert.equal(contents,owned.webContents);assert.equal(item.getInitiatorOrigin(),connection.origin);
        assert.deepEqual(item.getURLChain(),[blobUrl]);
        // Only the test listener selects this synthetic output path. The
        // production guard already ran; no real save dialog or file is used.
        item.setSavePath(rescuePath);
        item.once('done',(_event,state)=>state==='completed'?downloadResolve():downloadReject(new Error('Synthetic rescue download state: '+state)));
      } catch(error) {event.preventDefault();downloadReject(error);}
    };
    selected.once('will-download',onDownload);
    try {
      await evalPage(owned,`(()=>{const a=document.createElement('a');a.href=${JSON.stringify(blobUrl)};a.download='synthetic-rescue.txt';document.body.append(a);a.click();a.remove();return true})()`,true);
      await downloaded;assert.equal(fs.readFileSync(rescuePath,'utf8'),data.value);
    } finally {clearTimeout(downloadTimer);selected.removeListener('will-download',onDownload);}
    passed('production Blob rescue durably exports owned input after backend loss; unowned Blob downloads and all tested HTTP requests stay blocked');
    context.backend.status = 'ready';
    assert.equal(credentialRequest, false); assert.equal(unexpectedSession, false);
    assert(report.sessions.length > 0); assert(report.sessions.every(item => !item.persistent && item.storagePathNull));
    assert.deepEqual(fs.readdirSync(sentinel), ['synthetic-sentinel.txt']);
    assert.equal(fs.readFileSync(path.join(sentinel, 'synthetic-sentinel.txt'), 'utf8'), 'never activate this legacy session\n');
    passed('all observed sessions are nonpersistent; legacy sentinel unchanged; no credential request headers');
    report.passed = true; stage('complete');
  } catch (error) { report.error = { code: error.code || 'ELECTRON_ASSERTION_FAILED', message: error.message, stack: error.stack }; }
  finally {
    for (const window of createdWindows) if (!window.isDestroyed()) window.destroy();
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    fs.writeFileSync(path.join(fixture, phase + '.json'), JSON.stringify(report, null, 2) + '\n');
    app.exit(report.passed ? 0 : 1);
  }
}
module.exports = { parseArgs, childEnvironment, runtimeLayout, validateRuntimeTree, prepareRuntime, launchPhase, runSmoke, inside, isElectronChildEntrypoint };
if (isElectronChildEntrypoint(process.argv, process.versions.electron)) {
  electronChild(process.argv[3], process.argv[4]).catch(error => { console.error(error.stack || error); require('electron').app.exit(1); });
} else if (require.main === module) {
  Promise.resolve().then(() => runSmoke(parseArgs(process.argv.slice(2)))).then(report => { console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
