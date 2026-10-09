'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const os = require('node:os');
const net = require('node:net');
const { fork } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { validateLocalInfo, buildBackendEnvironment } = require('../src/backend-manager.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function files(root, prefix = '') {
  return fs.readdirSync(root).sort().flatMap(name => {
    const relative = `${prefix}${name}`, file = path.join(root, name), stat = fs.lstatSync(file);
    assert(!stat.isSymbolicLink(), `Runtime symlink is not allowed: ${relative}`);
    assert(!['data', '.git'].includes(name), `User data is not allowed: ${relative}`);
    return stat.isDirectory() ? files(file, `${relative}/`) : [relative];
  });
}
function safeFile(root, relative) {
  assert(typeof relative === 'string' && !relative.includes('\\') && relative.split('/').every(part => part && part !== '.' && part !== '..') && !path.isAbsolute(relative), `Unsafe manifest path: ${relative}`);
  return path.join(root, relative);
}
function verifyBackend(root, expectedVersion) {
  root = path.resolve(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'RUNTIME-MANIFEST.json')));
  const dependencies = JSON.parse(fs.readFileSync(path.join(root, 'dependency-manifest.json')));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
  assert.equal(pkg.version, expectedVersion || manifest.version);
  assert.equal(manifest.version, pkg.version); assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version);
  assert(validateLocalInfo({ app: 'qingdan', version: pkg.version, mode: 'local' }), 'Backend is outside the desktop 1.x compatibility range.');
  assert.match(manifest.source_snapshot_sha256, /^[a-f0-9]{64}$/);
  assert.equal(dependencies.source_snapshot_sha256, manifest.source_snapshot_sha256);
  for (const key of ['test', 'test:ui', 'test:server', 'typecheck', 'build']) assert(manifest.checks?.[key], `Missing source check: ${key}`);
  for (const required of ['dist/server/main.mjs', 'dist/server/users.mjs', 'dist/server/calendar-worker.mjs', 'dist/client/index.html', 'dist/client/offline-shell.html', 'dist/client/offline-shell-manifest.json', 'dist/client/qingdan-offline-worker.js', 'drizzle/meta/_journal.json']) assert(fs.statSync(path.join(root, required)).isFile(), `Missing runtime input: ${required}`);
  assert(files(path.join(root, 'drizzle')).some(name => name.endsWith('.sql')), 'No migrations.');
  const actual = files(root).filter(name => !name.startsWith('node_modules/') && name !== 'RUNTIME-MANIFEST.json');
  assert.deepEqual(Object.keys(manifest.files_sha256).sort(), actual.sort(), 'Runtime manifest file coverage differs.');
  for (const [name, hash] of Object.entries(manifest.files_sha256)) assert.equal(sha(fs.readFileSync(safeFile(root, name))), hash, `Runtime hash: ${name}`);
  const expectedDependencyFiles = [];
  for (const item of dependencies.packages) {
    assert.equal(lock.packages[item.location]?.version, item.version, `Locked version: ${item.name}`);
    assert.equal(lock.packages[item.location]?.integrity, item.integrity);
    const directory = safeFile(root, item.location);
    const installed = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
    assert.equal(installed.name, item.name); assert.equal(installed.version, item.version);
    for (const [name, hash] of Object.entries(item.files_sha256)) {
      assert.equal(sha(fs.readFileSync(safeFile(directory, name))), hash, `Dependency hash: ${item.name}/${name}`);
      expectedDependencyFiles.push(`${item.location}/${name}`);
    }
  }
  const actualDependencyFiles = files(path.join(root, 'node_modules'), 'node_modules/').filter(name => name !== 'node_modules/.package-lock.json');
  assert.deepEqual(expectedDependencyFiles.sort(), actualDependencyFiles.sort(), 'Dependency manifest file coverage differs.');
  assert.deepEqual(dependencies.packages.map(item => item.location).sort(), Object.keys(lock.packages).filter(Boolean).sort(), 'Runtime lock closure differs.');
  return { version: pkg.version, sourceSnapshotSha256: manifest.source_snapshot_sha256, runtimeFiles: actual.length, dependencyPackages: dependencies.packages.map(item => ({ name: item.name, version: item.version })), dependencyFiles: actualDependencyFiles.length };
}
async function verifyCalendarWorker(root) {
  const text = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Synthetic package smoke//EN\r\nBEGIN:VEVENT\r\nUID:package-smoke@example.test\r\nDTSTAMP:20261001T000000Z\r\nDTSTART:20261009T090000Z\r\nDTEND:20261009T100000Z\r\nSUMMARY:Synthetic calendar worker test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const worker = new Worker(path.join(path.resolve(root), 'dist/server/calendar-worker.mjs'), { workerData: { text, range: { from: '2026-10-01T00:00:00Z', through: '2026-11-01T00:00:00Z', timeZone: 'UTC' } }, execArgv: [] });
  let timeout;
  try {
    const message = await new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(Error('Calendar worker smoke timed out.')), 10000);
      worker.once('message', resolve); worker.once('error', reject);
      worker.once('exit', code => { if (code) reject(Error(`Calendar worker exited ${code}.`)); });
    });
    assert(!message.error, message.error); assert.equal(message.events?.length, 1);
    assert.equal(message.events[0].title, 'Synthetic calendar worker test');
  } finally { clearTimeout(timeout); await worker.terminate(); }
}
async function smokeBackend(root, expectedVersion) {
  return smokeVerifiedRuntime(root, verifyBackend(root, expectedVersion));
}
// For already byte-verified packaged payloads, whose development metadata is
// intentionally stripped by electron-builder. The caller must verify the
// archive before extraction; this exercises the actual extracted runtime.
async function smokeVerifiedRuntime(root, structural) {
  assert(validateLocalInfo({ app: 'qingdan', version: structural?.version, mode: 'local' }), 'A verified runtime version is required.');
  assert.match(structural.sourceSnapshotSha256, /^[a-f0-9]{64}$/);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), '青单 backend smoke '));
  const port = await new Promise((resolve, reject) => {
    const socket = net.createServer(); socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => { const value = socket.address().port; socket.close(error => error ? reject(error) : resolve(value)); });
  });
  const origin = `http://127.0.0.1:${port}`;
  const environment = buildBackendEnvironment(process.env, port, path.join(temp, 'synthetic-data'));
  let child, exited, output = '';
  async function start() {
    output = '';
    child = fork(path.join(__dirname, 'backend-smoke-worker.cjs'), [path.resolve(root)], { cwd: root, env: environment, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.on('data', bytes => { output = (output + bytes).slice(-32768); });
    child.stderr.on('data', bytes => { output = (output + bytes).slice(-32768); });
    exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw Error(`Backend exited during startup: ${output}`);
      try {
        const response = await fetch(`${origin}/api/app-info`, { signal: AbortSignal.timeout(1000), headers: { connection: 'close' } });
        const info = await response.json();
        assert(response.ok && validateLocalInfo(info)); assert.equal(info.version, structural.version);
        return;
      } catch (error) { if (error.code === 'ERR_ASSERTION') throw error; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(`Backend startup timeout: ${output}`);
  }
  async function stop() {
    if (!child) return;
    const processToStop = child; child = null;
    if (processToStop.connected) processToStop.send({ kind: 'qingdan-smoke-shutdown' });
    let timer;
    try {
      const result = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => { processToStop.kill('SIGKILL'); reject(Error('Backend did not stop gracefully.')); }, 15000); })]);
      assert.equal(result.code, 0, `Backend shutdown failed: ${output}`);
    } finally { clearTimeout(timer); }
  }
  async function json(url, init = {}) {
    const response = await fetch(`${origin}${url}`, { ...init, headers: { connection: 'close', ...(init.headers || {}) }, signal: AbortSignal.timeout(5000) });
    const body = await response.json(); assert(response.ok, `${response.status}: ${JSON.stringify(body)}`); return body;
  }
  try {
    await verifyCalendarWorker(root);
    await start();
    const html = await fetch(origin, { signal: AbortSignal.timeout(5000), headers: { connection: 'close' } }); assert(html.ok); assert((await html.text()).includes('<html'));
    const offline = await json('/offline-shell-manifest.json');
    assert.equal(offline.schema, 'qingdan-offline-shell'); assert(Array.isArray(offline.resources) && offline.resources.length > 0);
    for (const resource of offline.resources) {
      const url = new URL(resource.url, origin); assert.equal(url.origin, origin, 'Offline resource must be same-origin.');
      const response = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { connection: 'close' } });
      assert(response.ok); assert.equal(sha(Buffer.from(await response.arrayBuffer())), resource.sha256, `Served offline asset: ${resource.url}`);
    }
    const workerResponse = await fetch(`${origin}/qingdan-offline-worker.js`, { signal: AbortSignal.timeout(5000), headers: { connection: 'close' } });
    assert(workerResponse.ok); assert((await workerResponse.text()).includes('SHELL_MANIFEST'));
    const session = await json('/api/auth/me'); assert.equal(session.mode, 'local');
    const data = await json('/api/data'); const inbox = data.records.find(item => item.kind === 'list'); assert(inbox);
    const title = 'Synthetic packaging persistence test';
    await json('/api/data', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-qingdan': '1', 'x-qingdan-csrf': session.csrfToken, 'x-qingdan-expected-account': session.user.userId }, body: JSON.stringify({ operation: 'upsert', kind: 'task', id: 'package-smoke-task', expectedRevision: 0, clientOperationId: 'package-smoke-create', data: { title, status: 'open', listId: inbox.id } }) });
    await stop(); await start();
    const restored = await json('/api/data'); assert.equal(restored.records.find(item => item.id === 'package-smoke-task')?.data.title, title);
    await stop();
    return { ...structural, smoke: { nodeVersion: process.version, loopbackStartup: true, currentVersionHandshake: true, frontend: true, offlineShellAssets: true, migrations: true, calendarWorker: true, syntheticTask: true, gracefulRestartPersistence: true }, electronUtilityProcessTested: false, nativeGuiTested: false };
  } finally { try { await stop(); } finally { fs.rmSync(temp, { recursive: true, force: true }); } }
}
if (require.main === module) {
  const args = process.argv.slice(2), smoke = args.includes('--smoke'), positional = args.filter(item => item !== '--smoke');
  if (positional.length > 2) throw Error('Usage: node scripts/verify-backend.cjs [backend-directory] [report.json] [--smoke]');
  const root = positional[0] || path.join(__dirname, '../backend');
  Promise.resolve(smoke ? smokeBackend(root) : verifyBackend(root)).then(report => { if (positional[1]) fs.writeFileSync(positional[1], JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2)); }).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { verifyBackend, smokeBackend, smokeVerifiedRuntime, verifyCalendarWorker };
