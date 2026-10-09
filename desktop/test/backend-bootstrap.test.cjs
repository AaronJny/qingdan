'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { EventEmitter } = require('node:events');
const { buildBackendEnvironment } = require('../src/backend-manager.cjs');
const { launchConfiguration, observeStartupListen, probeLocalInfo, startBootstrap } = require('../src/backend-bootstrap.cjs');

const info = { app: 'qingdan', version: '1.0.0', mode: 'local' };
const immutableRoot = path.resolve(path.sep, 'immutable');
const defaultBackendRoot = path.join(immutableRoot, 'backend');
const bootstrapPath = path.join(immutableRoot, 'src', 'backend-bootstrap.cjs');
const dataDir = path.resolve(path.sep, 'profile', 'local-data');
const tick = () => new Promise(resolve => setImmediate(resolve));
function bootstrapFixture({ backendRoot = defaultBackendRoot } = {}) {
  class Server extends EventEmitter {
    listen(port, host) { this.bound = { address: host, port }; setImmediate(() => this.emit('listening')); return this; }
    address() { return this.bound; }
  }
  const process_ = new EventEmitter();
  process_.env = buildBackendEnvironment({ HOME: '/owner' }, 54000, dataDir);
  process_.argv = ['electron', bootstrapPath, 'launch-123', backendRoot];
  process_.exits = []; process_.exit = code => process_.exits.push(code);
  const parentPort = new EventEmitter(); parentPort.messages = [];
  parentPort.postMessage = message => parentPort.messages.push(message);
  return { backendRoot, http: { Server }, process: process_, parentPort, probe: async () => info };
}

test('launch arguments require exact nonzero literal loopback local configuration', () => {
  const env = buildBackendEnvironment({}, 54000, dataDir);
  assert.deepEqual(launchConfiguration(['launch-123', defaultBackendRoot], env), {
    launchId: 'launch-123', backendRoot: defaultBackendRoot, port: 54000, origin: 'http://127.0.0.1:54000',
  });
  for (const patch of [{ PORT: '0' }, { PORT: '054000' }, { PORT: '54000.0' }, { PORT: '65536' },
    { HOST: 'localhost' }, { HOST: '0.0.0.0' }, { APP_MODE: 'accounts' }, { QINGDAN_MODE: 'accounts' },
    { APP_ORIGIN: 'http://127.0.0.1:54000/' }, { QINGDAN_DATA_DIR: 'data' }]) {
    assert.throws(() => launchConfiguration(['launch-123', defaultBackendRoot], { ...env, ...patch }), { code: 'INVALID_CONFIGURATION' });
  }
  for (const args of [['launch-123', 'relative'], ['launch with spaces', defaultBackendRoot], ['launch-123', defaultBackendRoot, 'extra']]) {
    assert.throws(() => launchConfiguration(args, env), { code: 'INVALID_CONFIGURATION' });
  }
});

test('startup observer preserves original callback and restores prototype, without touching requests', async () => {
  const f = bootstrapFixture(); const original = f.http.Server.prototype.listen;
  let observed;
  const restore = observeStartupListen(f.http, { port: 54000 }, { listening: address => { observed = address; }, error: () => assert.fail() });
  const server = new f.http.Server(); assert.equal(server.listen(54000, '127.0.0.1'), server);
  await tick(); assert.deepEqual(observed, { address: '127.0.0.1', port: 54000 });
  restore(); assert.equal(f.http.Server.prototype.listen, original);
  assert.equal(server.listenerCount('request'), 0);
});

test('observer rejects other bindings and a second startup server', () => {
  const f = bootstrapFixture();
  const restore = observeStartupListen(f.http, { port: 54000 }, { listening() {}, error() {} });
  const server = new f.http.Server();
  assert.throws(() => server.listen(0, '127.0.0.1'), { code: 'INVALID_BIND' });
  assert.throws(() => server.listen(54000, '0.0.0.0'), { code: 'INVALID_BIND' });
  server.listen(54000, '127.0.0.1');
  assert.throws(() => new f.http.Server().listen(54000, '127.0.0.1'), { code: 'INVALID_BIND' });
  restore();
});

test('readiness requires own listening event, completed import and compatible app-info probe', async () => {
  const f = bootstrapFixture(); const original = f.http.Server.prototype.listen;
  let imported = false, probes = 0;
  f.importMain = async url => {
    assert.equal(url, pathToFileURL(path.join(f.backendRoot, 'dist', 'server', 'main.mjs')).href);
    const server = new f.http.Server(); server.listen(54000, '127.0.0.1');
    await tick(); assert.equal(f.parentPort.messages.length, 0);
    imported = true; f.process.on('SIGTERM', () => {});
  };
  f.probe = async origin => { assert.equal(imported, true); probes++; assert.equal(origin, 'http://127.0.0.1:54000'); return info; };
  await startBootstrap(f);
  assert.equal(probes, 1); assert.equal(f.http.Server.prototype.listen, original);
  assert.deepEqual(f.parentPort.messages, [{ kind: 'qingdan-backend-ready', address: '127.0.0.1', port: 54000, info, launchId: 'launch-123' }]);
});

test('REGRESSION: native absolute backend paths become escaped file URLs before import', async () => {
  const f = bootstrapFixture({ backendRoot: path.join(immutableRoot, '青单 backend #100%') });
  let importedUrl;
  f.importMain = async url => {
    importedUrl = url;
    assert.equal(fileURLToPath(url), path.join(f.backendRoot, 'dist', 'server', 'main.mjs'));
    assert.ok(url.includes('%20')); assert.ok(url.includes('%23')); assert.ok(url.includes('%25'));
    assert.equal(new URL(url).hash, '');
    f.process.on('SIGTERM', () => {});
    new f.http.Server().listen(54000, '127.0.0.1'); await tick();
  };
  await startBootstrap(f);
  assert.ok(importedUrl);
  assert.equal(f.parentPort.messages[0].kind, 'qingdan-backend-ready');
});

test('finished import or a compatible foreign HTTP response alone cannot produce readiness', async () => {
  const f = bootstrapFixture(); let probes = 0;
  f.importMain = async () => {};
  f.probe = async () => { probes++; return info; };
  await startBootstrap(f); assert.equal(probes, 0); assert.equal(f.parentPort.messages.length, 0);
});

test('shutdown requires exact launch ID, reuses SIGTERM close handler, and acknowledges once', async () => {
  const f = bootstrapFixture(); let closes = 0;
  f.importMain = async () => { f.process.on('SIGTERM', () => { closes++; }); new f.http.Server().listen(54000, '127.0.0.1'); await tick(); };
  await startBootstrap(f);
  f.parentPort.emit('message', { data: { kind: 'qingdan-backend-shutdown', launchId: 'wrong' } });
  assert.equal(closes, 0);
  f.parentPort.emit('message', { data: { kind: 'qingdan-backend-shutdown', launchId: 'launch-123' } });
  f.parentPort.emit('message', { data: { kind: 'qingdan-backend-shutdown', launchId: 'launch-123' } });
  assert.equal(closes, 1); assert.equal(f.process.exits.length, 0);
  assert.deepEqual(f.parentPort.messages[1], { kind: 'qingdan-backend-stopping', launchId: 'launch-123' });
  assert.equal(f.parentPort.messages.length, 2);
});

test('stop during import waits for original handlers, suppresses later ready and does not exit early', async () => {
  const f = bootstrapFixture(); let closes = 0, probes = 0;
  f.importMain = async () => {
    f.parentPort.emit('message', { data: { kind: 'qingdan-backend-shutdown', launchId: 'launch-123' } });
    assert.equal(f.process.exits.length, 0);
    new f.http.Server().listen(54000, '127.0.0.1'); await tick();
    f.process.on('SIGTERM', () => { closes++; });
  };
  f.probe = async () => { probes++; return info; };
  await startBootstrap(f); assert.equal(closes, 1); assert.equal(probes, 0);
  assert.deepEqual(f.parentPort.messages, [{ kind: 'qingdan-backend-stopping', launchId: 'launch-123' }]);
});

test('stop during compatibility probe suppresses late ready', async () => {
  const f = bootstrapFixture(); let release, closes = 0;
  f.importMain = async () => { f.process.on('SIGTERM', () => { closes++; }); new f.http.Server().listen(54000, '127.0.0.1'); await tick(); };
  f.probe = () => new Promise(resolve => { release = resolve; });
  const pending = startBootstrap(f); await tick(); await tick();
  f.parentPort.emit('message', { kind: 'qingdan-backend-shutdown', launchId: 'launch-123' });
  release(info); await pending;
  assert.equal(closes, 1); assert.equal(f.parentPort.messages.some(message => message.kind === 'qingdan-backend-ready'), false);
});

test('bind EADDRINUSE is reported from owned startup and prototype is restored', async () => {
  const f = bootstrapFixture(); const original = f.http.Server.prototype.listen;
  f.importMain = async () => {
    f.process.on('SIGTERM', () => f.process.exit(0));
    const server = new f.http.Server(); server.listen(54000, '127.0.0.1');
    server.emit('error', Object.assign(Error('private path'), { code: 'EADDRINUSE' }));
  };
  await startBootstrap(f);
  assert.deepEqual(f.parentPort.messages[0], { kind: 'qingdan-backend-error', code: 'EADDRINUSE', launchId: 'launch-123' });
  assert.equal(f.http.Server.prototype.listen, original); assert.deepEqual(f.process.exits, [0]);
});

test('incompatible probe and import errors never announce ready and sanitize errors', async () => {
  for (const variant of ['incompatible', 'import-error']) {
    const f = bootstrapFixture(); const original = f.http.Server.prototype.listen;
    f.importMain = async () => {
      if (variant === 'import-error') throw Error('secret/path');
      f.process.on('SIGTERM', () => f.process.exit(0)); new f.http.Server().listen(54000, '127.0.0.1'); await tick();
    };
    f.probe = async () => ({ ...info, mode: 'accounts' });
    await startBootstrap(f);
    assert.deepEqual(f.parentPort.messages[0], { kind: 'qingdan-backend-error', code: 'BACKEND_STARTUP', launchId: 'launch-123' });
    assert.equal(f.parentPort.messages.some(message => message.kind === 'qingdan-backend-ready'), false);
    assert.equal(f.http.Server.prototype.listen, original);
  }
});

test('parent-port close invokes original graceful shutdown', async () => {
  const f = bootstrapFixture(); let closes = 0;
  f.importMain = async () => { f.process.on('SIGTERM', () => { closes++; }); };
  await startBootstrap(f); f.parentPort.emit('close'); assert.equal(closes, 1);
});

test('app-info probe is exact, bounded and rejects redirects, wrong mode, bad MIME and oversized streams', async () => {
  const response = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  let called;
  assert.deepEqual(await probeLocalInfo('http://127.0.0.1:54000', async (url, options) => { called = { url, options }; return response(info); }), info);
  assert.equal(called.url, 'http://127.0.0.1:54000/api/app-info');
  assert.equal(called.options.redirect, 'error'); assert.equal(called.options.credentials, 'omit');
  for (const value of [response({ ...info, mode: 'accounts' }), new Response('{}', { headers: { 'content-type': 'text/html' } }),
    new Response('a'.repeat(8193), { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { status: 302, headers: { 'content-type': 'application/json' } }),
    { ...response(info), ok: true, redirected: true }]) {
    await assert.rejects(probeLocalInfo('http://127.0.0.1:54000', async () => value));
  }
});

test('app-info probe times out and aborts its request', async () => {
  await assert.rejects(probeLocalInfo('http://127.0.0.1:54000', (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(Error('timeout'), { name: 'AbortError' })), { once: true });
  }), 5), { name: 'AbortError' });
});

test('listening event with unexpected actual address fails even if requested address was correct', async () => {
  const f = bootstrapFixture();
  f.http.Server.prototype.address = () => ({ address: '0.0.0.0', port: 54000 });
  f.importMain = async () => { f.process.on('SIGTERM', () => {}); new f.http.Server().listen(54000, '127.0.0.1'); await tick(); };
  await startBootstrap(f);
  assert.equal(f.parentPort.messages[0].kind, 'qingdan-backend-error');
  assert.equal(f.parentPort.messages.some(message => message.kind === 'qingdan-backend-ready'), false);
});
