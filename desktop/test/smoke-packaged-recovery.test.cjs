'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const { parseArgs, nodeEnvironment, inspectPackage, finalBindingEvidence, runSmoke } = require('../scripts/smoke-packaged-recovery.cjs');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-binding-smoke-unit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function write(root, name, bytes) {
  const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); return file;
}
function elf() {
  const bytes = Buffer.alloc(64); bytes.write('\x7fELF', 0, 'binary'); bytes[4] = 2; bytes[5] = 1; bytes[6] = 1;
  bytes.writeUInt16LE(3, 16); bytes.writeUInt16LE(62, 18); bytes.writeUInt16LE(64, 52); return bytes;
}

test('binding smoke accepts only explicit bounded flags and same-target default Mac layout', () => {
  for (const arch of ['x64', 'arm64']) {
    const options = parseArgs(['--arch', arch, '--report', 'report.json']);
    assert.equal(options.arch, arch); assert.equal(options.report, path.resolve('report.json'));
    assert.match(options.archive, new RegExp(`dist[/\\\\]${arch === 'arm64' ? 'mac-arm64' : 'mac'}[/\\\\]`));
  }
  for (const args of [[], ['--arch', 'ia32', '--report', 'out'], ['--arch', 'x64'],
    ['--arch', 'x64', '--report', 'out', '--archive', 'one'],
    ['--arch', 'x64', '--report', 'out', '--no-sandbox', 'true'],
    ['--arch', 'x64', '--arch', 'arm64', '--report', 'out']]) assert.throws(() => parseArgs(args));
});

test('only stock Node mode is enabled and ASAR/Node/sandbox overrides are removed', () => {
  const source = { ELECTRON_RUN_AS_NODE: '0', ELECTRON_NO_ASAR: '1', ELECTRON_NO_SANDBOX: '1', NODE_OPTIONS: '--require=/tmp/x', NODE_PATH: '/tmp/x', HOME: '/synthetic', PATH: '/usr/bin' };
  assert.deepEqual(nodeEnvironment(source), { ELECTRON_RUN_AS_NODE: '1', HOME: '/synthetic', PATH: '/usr/bin' });
  assert.equal(source.ELECTRON_RUN_AS_NODE, '0');
});

test('final ASAR inspection verifies one unpacked target binary without requiring stale presign size/hash', async t => {
  const directory = temporary(t), source = path.join(directory, 'source'), archive = path.join(directory, 'app.asar');
  const entry = 'node_modules/classic-level/prebuilds/linux-x64/classic-level.node';
  write(source, 'node_modules/classic-level/package.json', JSON.stringify({ name: 'classic-level', version: '3.0.0' }));
  write(source, entry, elf());
  await asar.createPackageWithOptions(source, archive, { unpack: '**/*.node' });
  const first = inspectPackage(archive, 'linux', 'x64');
  const finalBefore = finalBindingEvidence(archive, 'linux', 'x64');
  assert.deepEqual(finalBefore, { entry, sha256: first.bindingSha256, bytes: 64, unpacked: true, finalDiskBytes: true });
  assert.equal(first.bindingEntry, entry); assert.match(first.bindingSha256, /^[a-f0-9]{64}$/);
  assert.equal(first.binding, path.join(archive + '.unpacked', entry));
  // Native Mac signing can change final unpacked bytes after ASAR creation.
  fs.appendFileSync(first.binding, 'synthetic signature change');
  const signed = inspectPackage(archive, 'linux', 'x64');
  const finalAfter = finalBindingEvidence(archive, 'linux', 'x64');
  assert.equal(finalAfter.sha256, signed.bindingSha256);
  assert.notEqual(finalAfter.sha256, finalBefore.sha256);
  assert.equal(finalAfter.bytes, 64 + Buffer.byteLength('synthetic signature change'));
  assert.equal(signed.asarSha256, first.asarSha256); assert.notEqual(signed.bindingSha256, first.bindingSha256);
  fs.writeFileSync(first.binding, 'not a native library');
  assert.throws(() => inspectPackage(archive, 'linux', 'x64'), /not ELF/);
});

test('ASAR inspection rejects packed, foreign, duplicate or symlinked native bindings', async t => {
  const directory = temporary(t), source = path.join(directory, 'source'), archive = path.join(directory, 'app.asar');
  const entry = 'node_modules/classic-level/prebuilds/linux-x64/classic-level.node';
  write(source, 'node_modules/classic-level/package.json', JSON.stringify({ name: 'classic-level', version: '3.0.0' }));
  write(source, entry, elf());
  await asar.createPackage(source, archive);
  assert.throws(() => inspectPackage(archive, 'linux', 'x64'), /unpacked/);
  asar.uncacheAll(); fs.unlinkSync(archive);
  write(source, 'node_modules/classic-level/prebuilds/win32-x64/classic-level.node', elf());
  await asar.createPackageWithOptions(source, archive, { unpack: '**/*.node' });
  assert.throws(() => inspectPackage(archive, 'linux', 'x64'), /Only the target/);
  asar.uncacheAll(); fs.unlinkSync(archive); fs.rmSync(path.join(source, 'node_modules/classic-level/prebuilds/win32-x64'), { recursive: true });
  await asar.createPackageWithOptions(source, archive, { unpack: '**/*.node' });
  assert.throws(() => inspectPackage(archive, 'darwin', 'x64'), /Only the target/);
  if (process.platform !== 'win32') {
    const native = path.join(archive + '.unpacked', entry), outside = write(directory, 'outside.node', elf());
    fs.unlinkSync(native); fs.symlinkSync(outside, native);
    assert.throws(() => inspectPackage(archive, 'linux', 'x64'), /symlink/);
  }
});

test('reports cannot overwrite the product payload even when the launcher fails', async t => {
  const directory = temporary(t), executable = write(directory, 'product/app', 'untouched'), archive = write(directory, 'product/resources/app.asar', 'untouched');
  for (const report of [executable, archive, path.join(path.dirname(executable), 'bad-report.json')]) {
    await assert.rejects(runSmoke({ arch: process.arch, executable, archive, electron: '/missing/electron', report }), /outside the packaged payload/);
  }
  assert.equal(fs.readFileSync(executable, 'utf8'), 'untouched'); assert.equal(fs.readFileSync(archive, 'utf8'), 'untouched');
});
