'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseArgs, childEnvironment, runtimeLayout, validateRuntimeTree, prepareRuntime, launchPhase, runSmoke, inside, isElectronChildEntrypoint } = require('../scripts/smoke-local-session.cjs');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-smoke-launcher-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function syntheticRuntime(directory, platform = 'linux') {
  const root = path.join(directory, platform === 'darwin' ? 'Electron.app' : 'stock');
  const executable = path.join(root, platform === 'darwin' ? 'Contents/MacOS/Electron' : 'electron');
  const resources = path.join(root, platform === 'darwin' ? 'Contents/Resources' : 'resources');
  fs.mkdirSync(path.dirname(executable), { recursive: true }); fs.mkdirSync(resources, { recursive: true });
  // This is deliberately NOT an executable. It only exercises the real fuse
  // parser/copy code; real renderer proof comes from the separate smoke run.
  const wire = Buffer.concat([Buffer.from('synthetic-test-only:dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'), Buffer.from([1, 8]), Buffer.from('10110010')]);
  fs.writeFileSync(executable, wire); fs.writeFileSync(path.join(resources, 'default_app.asar'), 'synthetic fixture');
  return { root, executable, resources };
}

test('launcher accepts only documented paths and bounded per-process timeout', () => {
  const value = parseArgs(['--electron', './electron', '--report', './report.json', '--timeout-ms', '60000']);
  assert.equal(value.electron, path.resolve('electron')); assert.equal(value.report, path.resolve('report.json')); assert.equal(value.timeoutMs, 60000);
  assert.equal(parseArgs([]).timeoutMs, 90000);
  for (const args of [['--no-sandbox'], ['--electron'], ['--electron','one','--electron','two'], ['--timeout-ms','0'], ['--timeout-ms','180001'], ['--timeout-ms','NaN'], ['--timeout-ms','5000.5']]) assert.throws(() => parseArgs(args));
});
test('launcher strips Node and sandbox override environment without removing display configuration', () => {
  const original = { ELECTRON_RUN_AS_NODE:'1', ELECTRON_NO_SANDBOX:'1', NODE_OPTIONS:'--require=/tmp/anything', NODE_PATH:'/tmp/custom', DISPLAY:':0', PATH:'/usr/bin', LANG:'en_US.UTF-8' };
  assert.deepEqual(childEnvironment(original), { DISPLAY:':0', PATH:'/usr/bin', LANG:'en_US.UTF-8' });
  assert.equal(original.ELECTRON_RUN_AS_NODE, '1');
});
test('stock Electron ESM app loader dispatches the selected CJS child without require.main', () => {
  const file = path.resolve('smoke-local-session.cjs'), argv = ['/stock/electron',file,'--smoke-child','write','/synthetic-fixture'];
  assert.equal(isElectronChildEntrypoint(argv,'44.6.0',file),true);
  assert.equal(isElectronChildEntrypoint(argv,undefined,file),false);
  assert.equal(isElectronChildEntrypoint(argv,'44.6.0',path.resolve('other.cjs')),false);
  assert.equal(isElectronChildEntrypoint(['/electron',file,'--report'],'44.6.0',file),false);
});
test('runtime layout accepts complete stock tree and native Mac bundle paths', t => {
  const directory = fixture(t), linux = syntheticRuntime(directory), mac = syntheticRuntime(directory, 'darwin');
  assert.equal(runtimeLayout(linux.executable, 'linux').root, fs.realpathSync(linux.root));
  assert.equal(runtimeLayout(mac.executable, 'darwin').root, fs.realpathSync(mac.root));
  assert.throws(() => runtimeLayout(linux.executable, 'darwin'), { code:'NOT_STOCK_RUNTIME' });
  fs.unlinkSync(path.join(linux.resources, 'default_app.asar'));
  assert.throws(() => runtimeLayout(linux.executable, 'linux'));
});
test('runtime links must be relative, internally contained, and remain inside the copied bundle', { skip: process.platform === 'win32' }, t => {
  const directory = fixture(t), stock = syntheticRuntime(directory);
  fs.symlinkSync('resources/default_app.asar', path.join(stock.root, 'internal'));
  assert.equal(validateRuntimeTree(stock.root).files, 4);
  fs.symlinkSync(stock.executable, path.join(stock.root, 'absolute-internal'));
  assert.throws(() => validateRuntimeTree(stock.root), { code:'UNSAFE_RUNTIME_LINK' });
  fs.unlinkSync(path.join(stock.root, 'absolute-internal'));
  fs.writeFileSync(path.join(directory, 'outside'), 'outside'); fs.symlinkSync('../outside', path.join(stock.root, 'escape'));
  assert.throws(() => validateRuntimeTree(stock.root), { code:'UNSAFE_RUNTIME_LINK' });
});
test('runtime copy enables only CookieEncryption and cannot mutate the source binary', async t => {
  const directory = fixture(t), stock = syntheticRuntime(directory), destination = path.join(directory, 'fixture'); fs.mkdirSync(destination);
  const before = fs.readFileSync(stock.executable), originalWire = await getCurrentFuseWire(stock.executable);
  const result = await prepareRuntime(stock.executable, destination, 'linux');
  assert.equal(result.report.testCookieEncryption, true); assert.equal(result.report.sourceCookieEncryption, false);
  assert.equal(result.report.onlyCookieEncryptionFuseChanged, true); assert.equal(result.report.sourceFuseWireUnchanged, true); assert.equal(result.report.macTestCopyAdHocReset, false);
  assert.deepEqual(fs.readFileSync(stock.executable), before);
  const after = await getCurrentFuseWire(result.executable);
  assert.equal(after[FuseV1Options.EnableCookieEncryption], 49);
  for (const key of Object.keys(originalWire)) if (key !== String(FuseV1Options.EnableCookieEncryption)) assert.equal(after[key], originalWire[key]);
  assert.notDeepEqual(fs.readFileSync(result.executable), before);
  assert.notEqual(crypto.createHash('sha256').update(fs.readFileSync(result.executable)).digest('hex'), crypto.createHash('sha256').update(before).digest('hex'));
  await assert.rejects(prepareRuntime(stock.executable, stock.root, 'linux'), { code:'UNSAFE_RUNTIME_COPY' });
});
test('existing ancestor aliases are canonicalized without weakening source-copy or symlink guards', async t => {
  const directory = fixture(t), parent = path.join(directory, 'real-parent'), alias = path.join(directory, 'ancestor-alias');
  fs.mkdirSync(parent);
  // A junction exercises the same ancestor-alias case on Windows without
  // requiring permission to create file symlinks.
  fs.symlinkSync(fs.realpathSync(parent), alias, process.platform === 'win32' ? 'junction' : 'dir');
  const stock = syntheticRuntime(parent), aliasedRoot = path.join(alias, 'stock'), aliasedExecutable = path.join(aliasedRoot, 'electron');
  assert.equal(runtimeLayout(aliasedExecutable, 'linux').root, fs.realpathSync(stock.root));
  if (process.platform !== 'win32') {
    fs.symlinkSync('resources/default_app.asar', path.join(stock.root, 'internal'));
    assert.equal(validateRuntimeTree(aliasedRoot).files, 4);
    fs.writeFileSync(path.join(directory, 'outside'), 'outside');
    fs.symlinkSync('../../outside', path.join(stock.root, 'escape'));
    assert.throws(() => validateRuntimeTree(aliasedRoot), { code:'UNSAFE_RUNTIME_LINK' });
    fs.unlinkSync(path.join(stock.root, 'escape'));
  }
  assert.deepEqual(validateRuntimeTree(aliasedRoot), validateRuntimeTree(stock.root));
  const destination = path.join(parent, 'fixture'); fs.mkdirSync(destination);
  const before = fs.readFileSync(stock.executable), originalWire = await getCurrentFuseWire(stock.executable);
  const result = await prepareRuntime(aliasedExecutable, path.join(alias, 'fixture'), 'linux');
  assert.equal(result.executable, path.join(fs.realpathSync(destination), 'test-runtime', 'electron'));
  assert.equal(result.report.testCookieEncryption, true);
  assert.equal(result.report.onlyCookieEncryptionFuseChanged, true);
  assert.equal(result.report.sourceFuseWireUnchanged, true);
  assert.deepEqual(fs.readFileSync(stock.executable), before);
  assert.deepEqual(await getCurrentFuseWire(stock.executable), originalWire);
  await assert.rejects(prepareRuntime(stock.executable, aliasedRoot, 'linux'), { code:'UNSAFE_RUNTIME_COPY' });
  await assert.rejects(prepareRuntime(aliasedExecutable, stock.root, 'linux'), { code:'UNSAFE_RUNTIME_COPY' });
  await assert.rejects(prepareRuntime(aliasedExecutable, path.join(alias, 'not-created'), 'linux'), { code:'ENOENT' });
  assert.deepEqual(fs.readFileSync(stock.executable), before);
});
test('path containment does not confuse sibling names or parent traversal', () => {
  const root = path.resolve('runtime');
  assert(inside(root, root)); assert(inside(root, path.join(root, 'child')));
  assert(!inside(root, root + '-other')); assert(!inside(root, path.dirname(root)));
});
test('missing Electron fails explicitly rather than passing a mocked renderer check', async t => {
  const directory = fixture(t);
  await assert.rejects(launchPhase(path.join(directory, 'missing-electron'), directory, 'write', 5000), { code:'ENOENT' });
  const output = path.join(directory, 'failure-report.json');
  const report = await runSmoke({ electron:path.join(directory, 'missing-electron'), report:output, timeoutMs:5000 });
  t.after(() => fs.rmSync(report.failedSyntheticFixture, { recursive:true, force:true }));
  assert.equal(report.passed, false); assert.equal(report.packagedAppTested, false); assert.equal(report.keychainAccessInstrumented, false); assert.equal(report.realUserProfileAccessed, false);
  assert.deepEqual(report.phases, []); assert.equal(report.error.code, 'ENOENT');
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), JSON.parse(JSON.stringify(report)));
  assert(path.basename(report.failedSyntheticFixture).startsWith('qingdan-local-session-smoke-'));
});
