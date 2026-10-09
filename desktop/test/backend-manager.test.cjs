'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createBackendManager, buildBackendEnvironment, validPort, reserveLoopbackPort } = require('../src/backend-manager.cjs');

const info = Object.freeze({ app: 'qingdan', version: '1.0.0', mode: 'local' });
const immutableRoot = path.resolve(path.sep, 'immutable');
const backendRoot = path.join(immutableRoot, 'backend');
const bootstrapPath = path.join(immutableRoot, 'src', 'backend-bootstrap.cjs');
const dataDir = path.resolve(path.sep, 'profile', 'local-data');
const tick = () => new Promise(resolve => setImmediate(resolve));

class FakeChild extends EventEmitter {
  constructor(args, options, behaviour = {}) {
    super(); this.args = args; this.options = options; this.behaviour = behaviour;
    this.messages = []; this.kills = 0; this.exited = false;
  }
  ready(changes = {}) {
    this.emit('message', { kind: 'qingdan-backend-ready', launchId: this.args[0],
      address: '127.0.0.1', port: Number(this.options.env.PORT), info, ...changes });
  }
  exit(code = 0) { if (!this.exited) { this.exited = true; this.emit('exit', code); } }
  postMessage(message) {
    this.messages.push(message);
    if (message.kind === 'qingdan-backend-shutdown' && this.behaviour.shutdownExit !== false) {
      setImmediate(() => this.exit(0));
    }
  }
  kill() { this.kills++; if (this.behaviour.killExit !== false) setImmediate(() => this.exit(1)); }
}

function fixture(t, options = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-manager-test-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const children = [], reservations = [], forks = [];
  let nextPort = 51000;
  const manager = createBackendManager({
    userData, backendRoot, bootstrapPath,
    utilityProcess: { fork(file, args, childOptions) {
      forks.push({ file, args, options: childOptions });
      const child = new FakeChild(args, childOptions, options.childBehaviour);
      children.push(child);
      options.onFork?.(child, children.length);
      return child;
    } },
    reservePort: async (preferred, signal) => {
      reservations.push(preferred);
      return options.reservePort ? options.reservePort(preferred, signal) : preferred || nextPort++;
    },
    parentEnv: { HOME: '/home/owner', LANG: 'en_US.UTF-8', API_KEY: 'secret', NODE_OPTIONS: '--inspect', PUBLIC_URL: 'https://foreign.invalid' },
    startupTimeoutMs: 200, shutdownTimeoutMs: 20, killTimeoutMs: 20,
    ...options.manager,
  });
  return { manager, userData, children, reservations, forks };
}

test('closed environment keeps runtime necessities and fixes local configuration', () => {
  const env = buildBackendEnvironment({ HOME: '/owner', SystemRoot: 'C:\\Windows', TEMP: '/tmp', LANG: 'en_US', TZ: 'UTC',
    PATH: '/secret/bin', API_KEY: 'secret', NODE_OPTIONS: '--inspect', NODE_INSPECT_RESUME_ON_START: '1',
    ELECTRON_RUN_AS_NODE: '1', QINGDAN_MODE: 'accounts', APP_MODE: 'accounts', APP_ORIGIN: 'https://bad', PUBLIC_URL: 'https://bad' }, 43210, dataDir);
  assert.deepEqual(env, { HOME: '/owner', SystemRoot: 'C:\\Windows', TEMP: '/tmp', LANG: 'en_US', TZ: 'UTC',
    APP_MODE: 'local', QINGDAN_MODE: 'local', HOST: '127.0.0.1', PORT: '43210',
    APP_ORIGIN: 'http://127.0.0.1:43210', QINGDAN_DATA_DIR: dataDir });
});

test('invalid and zero ports or relative data paths are rejected', () => {
  for (const port of [0, -1, 65536, 1.1, '4310', NaN, Infinity]) {
    assert.equal(validPort(port), false);
    assert.throws(() => buildBackendEnvironment({}, port, dataDir), { code: 'INVALID_PORT' });
  }
  assert.throws(() => buildBackendEnvironment({}, 4310, './data'), { code: 'INVALID_DATA_DIR' });
});

test('duplicate ensure shares one startup, exact owned readiness, immutable fork options, atomic metadata', async t => {
  const f = fixture(t);
  const first = f.manager.ensureLocal();
  assert.equal(first, f.manager.ensureLocal());
  await tick();
  assert.equal(f.children.length, 1);
  assert.equal(f.manager.status, 'starting');
  assert.equal(f.manager.backendOrigin, null);
  const child = f.children[0]; child.ready();
  assert.equal(await first, 'http://127.0.0.1:51000');
  assert.equal(await f.manager.ensureLocal(), 'http://127.0.0.1:51000');
  assert.equal(f.children.length, 1);
  assert.equal(f.forks[0].file, bootstrapPath);
  assert.deepEqual(f.forks[0].args.slice(1), [backendRoot]);
  assert.deepEqual(Object.keys(f.forks[0].options).sort(), ['env', 'serviceName', 'stdio']);
  assert.equal(f.forks[0].options.stdio, 'ignore');
  assert.equal(f.forks[0].options.env.QINGDAN_DATA_DIR, path.join(f.userData, 'local-data'));
  assert.equal(f.forks[0].options.env.HOME, '/home/owner');
  assert.equal(f.forks[0].options.env.API_KEY, undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.userData, 'local-backend.json'))), { version: 1, port: 51000 });
  assert.deepEqual(fs.readdirSync(f.userData).sort(), ['local-backend.json', 'local-data']);
  await f.manager.stop();
});

test('REGRESSION: native absolute Unicode paths remain exact fork filenames and arguments', async t => {
  const expectedRoot = path.join(immutableRoot, '青单 backend #100%');
  const expectedBootstrap = path.join(immutableRoot, '青单 src #100%', 'backend-bootstrap.cjs');
  const f = fixture(t, {
    manager: { backendRoot: expectedRoot, bootstrapPath: expectedBootstrap },
    onFork: child => setImmediate(() => child.ready()),
  });
  await f.manager.ensureLocal();
  assert.equal(path.isAbsolute(f.forks[0].file), true);
  assert.equal(f.forks[0].file, expectedBootstrap);
  assert.deepEqual(f.forks[0].args.slice(1), [expectedRoot]);
  await f.manager.stop();
});

test('wrong launch, wrong address, wrong port and incompatible/foreign info cannot make a child ready', async t => {
  const f = fixture(t); const pending = f.manager.ensureLocal(); await tick();
  const child = f.children[0];
  child.ready({ launchId: 'some-other-launch' });
  child.ready({ address: '0.0.0.0' });
  child.ready({ port: 51001 });
  child.ready({ info: { ...info, mode: 'accounts' } });
  child.ready({ info: { ...info, app: 'foreign' } });
  child.ready({ info: { ...info, version: '2.0.0' } });
  child.ready({ info: { ...info, secret: true } });
  await tick();
  assert.equal(f.manager.status, 'starting'); assert.equal(f.manager.backendOrigin, null);
  child.ready(); await pending; await f.manager.stop();
});

test('preferred stable port is used, corrupt or invalid metadata is ignored', async t => {
  for (const metadata of [{ version: 1, port: 4310 }, { version: 1, port: 0 }, { version: 2, port: 4310 }, 'not-json']) {
    const f = fixture(t, { onFork: child => setImmediate(() => child.ready()) });
    fs.writeFileSync(path.join(f.userData, 'local-backend.json'), typeof metadata === 'string' ? metadata : JSON.stringify(metadata));
    await f.manager.ensureLocal();
    assert.deepEqual(f.reservations, [typeof metadata === 'object' && metadata.version === 1 && metadata.port === 4310 ? 4310 : null]);
    await f.manager.stop();
  }
});

test('occupied preferred port selects a free candidate without probing or adopting occupant', async t => {
  const f = fixture(t, {
    reservePort: async preferred => { if (preferred) throw Object.assign(Error('occupied'), { code: 'EADDRINUSE' }); return 52001; },
    onFork: child => setImmediate(() => child.ready()),
  });
  fs.writeFileSync(path.join(f.userData, 'local-backend.json'), JSON.stringify({ version: 1, port: 4310 }));
  assert.equal(await f.manager.ensureLocal(), 'http://127.0.0.1:52001');
  assert.deepEqual(f.reservations, [4310, null]);
  assert.equal(f.children.length, 1); await f.manager.stop();
});

test('child EADDRINUSE race retries after old child exit; stale child readiness is ignored', async t => {
  const f = fixture(t, { onFork(child, number) {
    setImmediate(() => {
      if (number === 1) child.emit('message', { kind: 'qingdan-backend-error', launchId: child.args[0], code: 'EADDRINUSE' });
      else child.ready();
    });
  } });
  assert.equal(await f.manager.ensureLocal(), 'http://127.0.0.1:51001');
  assert.equal(f.children.length, 2); assert.equal(f.children[0].exited, true);
  f.children[0].ready();
  f.children[1].ready({ launchId: f.children[0].args[0], port: 51000 });
  assert.equal(f.manager.backendOrigin, 'http://127.0.0.1:51001');
  await f.manager.stop();
});

test('port races have bounded retries and never auto-restart indefinitely', async t => {
  const f = fixture(t, { manager: { maxAttempts: 3 }, onFork(child) {
    setImmediate(() => child.emit('message', { kind: 'qingdan-backend-error', launchId: child.args[0], code: 'EADDRINUSE' }));
  } });
  await assert.rejects(f.manager.ensureLocal(), { code: 'EADDRINUSE' });
  assert.equal(f.children.length, 3); assert.ok(f.children.every(child => child.exited));
  assert.equal(f.manager.status, 'failed'); assert.equal(f.manager.backendOrigin, null);
});

test('early child exit fails startup without port retry', async t => {
  const f = fixture(t, { onFork: child => setImmediate(() => child.exit(1)) });
  const failures = []; f.manager.on('failure', error => failures.push(error));
  await assert.rejects(f.manager.ensureLocal(), { code: 'BACKEND_STARTUP' });
  assert.equal(f.children.length, 1); assert.equal(failures.length, 1);
  f.children[0].ready(); assert.equal(f.manager.backendOrigin, null);
});

test('runtime crash clears origin, emits failure and does not restart', async t => {
  const f = fixture(t, { onFork: child => setImmediate(() => child.ready()) });
  await f.manager.ensureLocal(); const failures = []; f.manager.on('failure', error => failures.push(error));
  f.children[0].exit(2); await tick();
  assert.equal(f.manager.status, 'failed'); assert.equal(f.manager.backendOrigin, null);
  assert.equal(failures[0].code, 'BACKEND_CRASHED'); assert.equal(f.children.length, 1);
});

test('startup timeout shuts down child and rejects once without late readiness', async t => {
  const f = fixture(t, { manager: { startupTimeoutMs: 15 } });
  await assert.rejects(f.manager.ensureLocal(), { code: 'BACKEND_TIMEOUT' });
  assert.equal(f.children[0].exited, true);
  assert.equal(f.children[0].messages[0].launchId, f.children[0].args[0]);
  f.children[0].ready(); assert.equal(f.manager.status, 'failed');
});

test('stop during startup cancels, blocks reopen while stopping, and ignores late ready', async t => {
  const f = fixture(t, { childBehaviour: { shutdownExit: false } });
  const pending = f.manager.ensureLocal(); const rejection = assert.rejects(pending, { code: 'BACKEND_CANCELLED' });
  await tick();
  const stopping = f.manager.stop(); assert.equal(stopping, f.manager.stop());
  await assert.rejects(f.manager.ensureLocal(), { code: 'BACKEND_STOPPING' });
  f.children[0].ready(); f.children[0].exit();
  await stopping; await rejection;
  assert.equal(f.manager.status, 'idle'); assert.equal(f.manager.backendOrigin, null);
  assert.equal(f.children.length, 1);
});

test('stop while reservation is pending cannot fork or reopen later', async t => {
  let release;
  const f = fixture(t, { reservePort: () => new Promise(resolve => { release = resolve; }) });
  const pending = f.manager.ensureLocal(); const rejection = assert.rejects(pending, { code: 'BACKEND_CANCELLED' });
  await tick();
  const stopping = f.manager.stop(); release(53000);
  await stopping; await rejection; assert.equal(f.children.length, 0); assert.equal(f.manager.status, 'idle');
});

test('graceful stop waits for actual exit, an acknowledgement is insufficient', async t => {
  const f = fixture(t, { childBehaviour: { shutdownExit: false }, manager: { shutdownTimeoutMs: 100 } });
  const ready = f.manager.ensureLocal(); await tick(); f.children[0].ready(); await ready;
  const child = f.children[0]; let resolved = false;
  const stopping = f.manager.stop().then(() => { resolved = true; });
  await tick();
  assert.deepEqual(child.messages, [{ kind: 'qingdan-backend-shutdown', launchId: child.args[0] }]);
  child.emit('message', { kind: 'qingdan-backend-stopping', launchId: child.args[0] });
  await tick(); assert.equal(resolved, false); assert.equal(child.kills, 0);
  child.exit(); await stopping;
  assert.equal(child.kills, 0); assert.equal(f.manager.status, 'idle');
});

test('unresponsive owned child gets bounded kill fallback, preserving local data', async t => {
  const f = fixture(t, { childBehaviour: { shutdownExit: false }, onFork: child => setImmediate(() => child.ready()) });
  await f.manager.ensureLocal();
  const sentinel = path.join(f.userData, 'local-data', 'sentinel'); fs.writeFileSync(sentinel, 'keep');
  await f.manager.stop();
  assert.equal(f.children[0].kills, 1); assert.equal(f.children[0].exited, true);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
});

test('failed kill blocks a second child until owned process has exited', async t => {
  const f = fixture(t, { childBehaviour: { shutdownExit: false, killExit: false }, onFork: child => setImmediate(() => child.ready()) });
  await f.manager.ensureLocal();
  await assert.rejects(f.manager.stop(), { code: 'BACKEND_SHUTDOWN_TIMEOUT' });
  await assert.rejects(f.manager.ensureLocal(), { code: 'BACKEND_BUSY' });
  assert.equal(f.children.length, 1); assert.equal(f.children[0].kills, 1);
  f.children[0].exit();
});

test('explicit restart after completed stop creates a fresh launch with saved port', async t => {
  const f = fixture(t, { onFork: child => setImmediate(() => child.ready()) });
  await f.manager.ensureLocal(); await f.manager.stop(); await f.manager.ensureLocal();
  assert.equal(f.children.length, 2); assert.notEqual(f.children[0].args[0], f.children[1].args[0]);
  assert.deepEqual(f.reservations, [null, 51000]); await f.manager.stop();
});

test('preference save failure is warning-only and exposes no contents of error', async t => {
  const f = fixture(t, { onFork: child => setImmediate(() => child.ready()) });
  const fs_ = Object.create(fs); fs_.writeFileSync = () => { throw Error('secret/path'); }; f.manager.fs = fs_;
  const warnings = []; f.manager.on('warning', warning => warnings.push(warning));
  await f.manager.ensureLocal(); assert.equal(warnings.length, 1); assert.ok(!warnings[0].message.includes('secret'));
  await f.manager.stop();
});

test('mock loopback reservation closes before returning candidate, uses literal address and exclusive bind', async () => {
  const server = new EventEmitter(); let closed = false; let options;
  server.listen = (value, callback) => { options = value; setImmediate(callback); };
  server.address = () => ({ address: '127.0.0.1', port: 54000 });
  server.close = callback => { closed = true; callback(); };
  assert.equal(await reserveLoopbackPort({ createServer: () => server }, null, new AbortController().signal), 54000);
  assert.equal(closed, true); assert.deepEqual(options, { host: '127.0.0.1', port: 0, exclusive: true });
});

test('mock reservation abort closes socket and rejects, without binding a backend', async () => {
  const server = new EventEmitter(); let closed = false;
  server.listen = () => {}; server.close = callback => { closed = true; callback(); };
  const controller = new AbortController();
  const pending = reserveLoopbackPort({ createServer: () => server }, 4310, controller.signal);
  const error = Error('cancelled'); controller.abort(error);
  await assert.rejects(pending, error); assert.equal(closed, true);
});

test('process-fork failures are sanitized and do not create a child', async t => {
  const f = fixture(t); f.manager.utilityProcess.fork = () => { throw Error('private/credential'); };
  await assert.rejects(f.manager.ensureLocal(), { code: 'BACKEND_STARTUP', message: 'The local backend could not start.' });
  assert.equal(f.children.length, 0);
});

test('reentrant starting listeners still share one promise and one child', async t => {
  const f = fixture(t, { onFork: child => setImmediate(() => child.ready()) });
  let fromListener;
  f.manager.on('status', state => { if (state.status === 'starting') fromListener = f.manager.ensureLocal(); });
  const pending = f.manager.ensureLocal();
  assert.equal(pending, fromListener); await pending;
  assert.equal(f.children.length, 1); await f.manager.stop();
});

test('immediate stop before asynchronous startup creates no child', async t => {
  const f = fixture(t);
  const pending = f.manager.ensureLocal(); const rejected = assert.rejects(pending, { code: 'BACKEND_CANCELLED' });
  await f.manager.stop(); await rejected;
  assert.equal(f.children.length, 0); assert.equal(f.manager.status, 'idle');
});

test('reentrant ready listener can stop startup without returning a stale/null origin', async t => {
  const f = fixture(t, { onFork: child => setImmediate(() => child.ready()) });
  let stopping;
  f.manager.on('status', state => { if (state.status === 'ready') stopping = f.manager.stop(); });
  await assert.rejects(f.manager.ensureLocal(), { code: 'BACKEND_CANCELLED' });
  await stopping; assert.equal(f.manager.backendOrigin, null); assert.equal(f.children[0].exited, true);
});

test('reentrant stopping listeners cannot reopen an idle backend', async t => {
  const f = fixture(t); let attempt;
  f.manager.on('status', state => {
    if (state.status === 'stopping') attempt = assert.rejects(f.manager.ensureLocal(), { code: 'BACKEND_STOPPING' });
  });
  await f.manager.stop(); await attempt;
  assert.equal(f.children.length, 0); assert.equal(f.manager.status, 'idle');
});

test('exit at readiness publication fails startup once rather than publishing an owned origin', async t => {
  const f = fixture(t, { onFork: child => setImmediate(() => child.ready()) });
  const failures = [];
  f.manager.on('failure', error => failures.push(error));
  f.manager.on('status', state => { if (state.status === 'ready') f.children[0].exit(1); });
  await assert.rejects(f.manager.ensureLocal(), { code: 'BACKEND_STARTUP' });
  assert.equal(failures.length, 1); assert.equal(f.manager.backendOrigin, null);
});
