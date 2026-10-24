'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { thin, fat } = require('./fixtures/macho.cjs');
const { createAsarFixture } = require('./fixtures/asar.cjs');
const { parseMachO, inspectMachOFile, assertTargetMachO } = require('../scripts/macho-architecture.cjs');
const { verifyNativeNodeModules, verifyMacArchitecture } = require('../scripts/verify-mac-architecture.cjs');
const { assertNativeMac } = require('../scripts/assert-native-macos.cjs');
function temporary(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-macho-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory; }
function write(root, name, bytes) { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); return file; }
for (const arch of ['arm64', 'x64']) for (const little of [false, true]) test(`reads ${arch} ${little ? 'little' : 'big'}-endian thin Mach-O and validates load commands`, t => {
  const bytes = thin(arch, { little, commands: [8, 16] }), info = parseMachO(bytes);
  assert.deepEqual(info.architectures, [arch]); assert.equal(info.format, 'mach-o64');
  assert.deepEqual(assertTargetMachO(info, arch, 'binary').architectures, [arch]);
  const file = write(temporary(t), 'binary', bytes); assert.deepEqual(inspectMachOFile(file), info);
  assert.throws(() => assertTargetMachO(info, arch === 'x64' ? 'arm64' : 'x64', 'renamed'), /architecture must be exactly/);
});
for (const bits of [32, 64]) for (const little of [false, true]) test(`reads ${bits}-bit ${little ? 'little' : 'big'}-endian fat headers and rejects universal targets`, () => {
  const universal = parseMachO(fat(['x64', 'arm64'], { bits, little }));
  assert.equal(universal.format, `fat${bits}`); assert.deepEqual(universal.architectures, ['arm64', 'x64']);
  assert.throws(() => assertTargetMachO(universal, 'x64', 'universal'), /architecture must be exactly/);
  assert.deepEqual(assertTargetMachO(parseMachO(fat(['x64'], { bits, little })), 'x64', 'single').architectures, ['x64']);
});
test('rejects truncated, inconsistent, unsupported and malformed Mach-O headers', () => {
  assert.equal(parseMachO(Buffer.from('plain text')), null); assert.equal(parseMachO(Buffer.alloc(2)), null);
  assert.throws(() => assertTargetMachO(null, 'x64', 'addon.node'), /not Mach-O/);
  for (const size of [4, 7, 16, 31]) assert.throws(() => parseMachO(thin().subarray(0, size)), /Truncated/);
  assert.throws(() => assertTargetMachO(parseMachO(thin('ia32', { bits: 32 })), 'x64', '32bit'), /architecture must be exactly/);
  const wrongWidth = thin(); wrongWidth.writeUInt32LE(12, 4); assert.throws(() => parseMachO(wrongWidth), /width mismatch/);
  const tooMany = thin(); tooMany.writeUInt32LE(1, 16); assert.throws(() => parseMachO(tooMany), /load commands/);
  const tooLong = thin(); tooLong.writeUInt32LE(0xffffffff, 20); assert.throws(() => parseMachO(tooLong), /load commands/);
  for (const size of [0, 4, 12, 24]) { const invalid = thin('x64', { commands: [16] }); invalid.writeUInt32LE(size, 36); assert.throws(() => parseMachO(invalid), /command/); }
  const uncovered = thin('x64', { commands: [16] }); uncovered.writeUInt32LE(0, 16); assert.throws(() => parseMachO(uncovered), /coverage/);
  const unknown = thin(); unknown.writeUInt32LE(0x0100ffff, 4); assert.throws(() => assertTargetMachO(parseMachO(unknown), 'arm64', 'unknown'), /architecture must be exactly/);
});
test('rejects malformed fat slice counts, bounds, alignment, overlap, duplicates and inconsistent CPUs', () => {
  for (const count of [0, 65, 0xffffffff]) { const bytes = fat(['x64']); bytes.writeUInt32BE(count, 4); assert.throws(() => parseMachO(bytes), /slice count/); }
  const insideHeader = fat(['x64']); insideHeader.writeUInt32BE(0, 16); assert.throws(() => parseMachO(insideHeader), /slice bounds/);
  const outsideFile = fat(['x64']); outsideFile.writeUInt32BE(0xffffffff, 20); assert.throws(() => parseMachO(outsideFile), /slice bounds/);
  const alignment = fat(['x64']); alignment.writeUInt32BE(31, 24); assert.throws(() => parseMachO(alignment), /alignment/);
  const overlap = fat(['x64', 'arm64']); overlap.writeUInt32BE(overlap.readUInt32BE(16), 36); assert.throws(() => parseMachO(overlap), /Overlapping/);
  assert.throws(() => parseMachO(fat(['x64', 'x64'])), /Duplicate/);
  const wrongCpu = fat(['x64']); wrongCpu.writeUInt32BE(0x0100000c, 8); assert.throws(() => parseMachO(wrongCpu), /CPU type differs/);
  const wrongSubtype = fat(['x64']); wrongSubtype.writeUInt32BE(9, 12); assert.throws(() => parseMachO(wrongSubtype), /CPU subtype differs/);
  const unsafe = fat(['x64'], { bits: 64 }); unsafe.writeBigUInt64BE(2n ** 63n, 16); assert.throws(() => parseMachO(unsafe), /Unsafe/);
  const reserved = fat(['x64'], { bits: 64 }); reserved.writeUInt32BE(1, 36); assert.throws(() => parseMachO(reserved), /reserved/);
  const nested = fat(['x64']); nested.writeUInt32BE(0xcafebabe, nested.readUInt32BE(16)); assert.throws(() => parseMachO(nested), /nested/);
});
test('backend native modules must match the target; JavaScript-only closure has an explicit empty inventory', t => {
  const root = temporary(t); write(root, 'dependency/index.js', Buffer.from('module.exports = true'));
  assert.deepEqual(verifyNativeNodeModules(root, 'x64'), []);
  const file = write(root, 'dependency/addon.node', thin('x64'));
  assert.deepEqual(verifyNativeNodeModules(root, 'x64'), [{ path: 'dependency/addon.node', format: 'mach-o64', architectures: ['x64'] }]);
  assert.throws(() => verifyNativeNodeModules(root, 'arm64'), /architecture must be exactly/);
  fs.writeFileSync(file, Buffer.from('invalid')); assert.throws(() => verifyNativeNodeModules(root, 'x64'), /not Mach-O/);
});
for (const arch of ['x64', 'arm64']) test(`ASAR and unpacked native modules are inspected for ${arch}, not only the main executable`, async t => {
  const root = temporary(t), app = path.join(root, '青单.app');
  const required = ['Contents/MacOS/青单', 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
    ...['', ' (GPU)', ' (Plugin)', ' (Renderer)'].map(suffix => `Contents/Frameworks/Electron Helper${suffix}.app/Contents/MacOS/Electron Helper${suffix}`)];
  for (const name of required) write(app, name, thin(arch));
  const src = path.join(root, 'source'), archive = path.join(app, 'Contents/Resources/app.asar');
  const addon = write(src, 'backend/node_modules/native/addon.node', thin(arch));
  write(src, 'backend/index.js', Buffer.from('export default true'));
  write(src, 'hidden-native', thin(arch));
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  await createAsarFixture(src, archive);
  let result = verifyMacArchitecture(app, arch, archive);
  assert.equal(result.machOFiles.length, required.length + 2); assert.equal(result.nativeNodeModules.length, 1);
  assert.match(result.nativeNodeModules[0], /app\.asar\/backend\/node_modules\/native\/addon.node$/);
  fs.writeFileSync(addon, thin(arch === 'x64' ? 'arm64' : 'x64')); await createAsarFixture(src, archive);
  assert.throws(() => verifyMacArchitecture(app, arch, archive), /architecture must be exactly/);
  fs.writeFileSync(addon, thin(arch)); await createAsarFixture(src, archive, { unpack: '*.node' });
  result = verifyMacArchitecture(app, arch, archive); assert.equal(result.nativeNodeModules.length, 2);
  const unpacked = path.join(archive + '.unpacked', 'backend/node_modules/native/addon.node'); fs.writeFileSync(unpacked, Buffer.from('not a Mach-O'));
  assert.throws(() => verifyMacArchitecture(app, arch, archive), /not Mach-O/);
});
test('native host guard requires matching Node, runner and machine architectures and rejects Rosetta', () => {
  const command = () => ({ status: 0, stdout: '0\n' });
  for (const arch of ['x64', 'arm64']) {
    const host = { platform: 'darwin', arch, machine: arch === 'x64' ? 'x86_64' : 'arm64', runnerArch: arch === 'x64' ? 'X64' : 'ARM64' };
    assert.deepEqual(assertNativeMac(arch, host, command), { ...host, translated: false });
    assert.throws(() => assertNativeMac(arch, { ...host, platform: 'linux' }, command), /native macOS/);
    assert.throws(() => assertNativeMac(arch, { ...host, arch: 'other' }, command), /process.arch/);
    assert.throws(() => assertNativeMac(arch, { ...host, machine: 'other' }, command), /machine architecture/);
    assert.throws(() => assertNativeMac(arch, { ...host, runnerArch: 'other' }, command), /runner architecture/);
    assert.throws(() => assertNativeMac(arch, host, () => ({ status: 0, stdout: '1\n' })), /Rosetta/);
    assert.throws(() => assertNativeMac(arch, host, () => ({ status: null, error: Error('failed'), stdout: '' })), /translation status/);
    assert.equal(assertNativeMac(arch, host, () => ({ status: 1, stdout: '' })).translated, false);
  }
});
