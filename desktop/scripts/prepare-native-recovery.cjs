'use strict';
// classic-level uses Node-API prebuilds, so no host/electron rebuild is needed.
// Stage the one target binary BEFORE ASAR creation and its integrity metadata.
// Never prune or thin node_modules in place: a second target may share it.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Arch } = require('builder-util');
const { parseMachO, assertTargetMachO } = require('./macho-architecture.cjs');
const { nativeAsarEntryPath } = require('./asar-entry-path.cjs');
const stages = new WeakMap();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function targetBinding(platform, arch) {
  assert(['x64', 'arm64'].includes(arch), 'Unsupported recovery binding architecture');
  assert(platform === 'darwin' || ['linux', 'win32'].includes(platform) && arch === 'x64', 'Unsupported recovery binding platform/architecture');
  return {
    source: `prebuilds/${platform === 'darwin' ? 'darwin-x64+arm64' : `${platform}-${arch}`}/classic-level.node`,
    relative: `${platform}-${arch}/classic-level.node`,
    entry: `node_modules/classic-level/prebuilds/${platform}-${arch}/classic-level.node`,
    stage: `${{ darwin: 'mac', win32: 'win', linux: 'linux' }[platform]}-${arch}`,
  };
}

function realEntry(root, relative, directory = false) {
  assert(typeof relative === 'string' && relative.length && !/[\\:\0]/.test(relative), 'Unsafe recovery binding path');
  const parts = relative.split('/');
  assert(parts.every(part => part && part !== '.' && part !== '..'), 'Unsafe recovery binding path');
  const rootStat = fs.lstatSync(root);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'Recovery binding root must be a real directory');
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const stat = fs.lstatSync(current);
    assert(!stat.isSymbolicLink(), `Recovery binding symlink is not allowed: ${current}`);
    assert(index < parts.length - 1 || directory ? stat.isDirectory() : stat.isFile(), `Invalid recovery binding entry: ${current}`);
  }
  return current;
}

function inspectBinding(bytes, platform, arch, { universal = false } = {}) {
  targetBinding(platform, arch);
  assert(Buffer.isBuffer(bytes), 'Native binding must be bytes');
  if (platform === 'darwin') {
    const info = parseMachO(bytes, 'classic-level.node');
    if (universal) {
      assert(info && info.format.startsWith('fat'), 'Expected universal classic-level macOS prebuild');
      assert.deepEqual(info.architectures, ['arm64', 'x64'], 'Unexpected universal classic-level architectures');
      assert(info.slices.every(slice => slice.bits === 64), 'Expected 64-bit classic-level slices');
    } else {
      assertTargetMachO(info, arch, 'classic-level.node');
      assert.equal(info.format, 'mach-o64', 'Packaged recovery binding must be thin Mach-O');
    }
    return { format: info.format, architectures: info.architectures };
  }
  if (platform === 'linux') {
    assert(bytes.length >= 64 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), 'Recovery binding is not ELF');
    assert(bytes[4] === 2 && bytes[5] === 1 && bytes[6] === 1 && bytes.readUInt16LE(16) === 3 && bytes.readUInt16LE(18) === 62 && bytes.readUInt16LE(52) === 64, 'Recovery binding must be ELF64 x64 shared library');
    return { format: 'elf64', architectures: ['x64'] };
  }
  assert(bytes.length >= 64 && bytes.toString('ascii', 0, 2) === 'MZ', 'Recovery binding is not PE');
  const offset = bytes.readUInt32LE(60);
  assert(offset >= 64 && offset <= bytes.length - 26 && bytes.toString('hex', offset, offset + 4) === '50450000', 'Invalid recovery binding PE header');
  const optionalSize = bytes.readUInt16LE(offset + 20);
  assert(bytes.readUInt16LE(offset + 4) === 0x8664 && optionalSize >= 112 && optionalSize <= bytes.length - offset - 24 && bytes.readUInt16LE(offset + 24) === 0x20b && (bytes.readUInt16LE(offset + 22) & 0x2000), 'Recovery binding must be PE32+ x64 DLL');
  return { format: 'pe32+', architectures: ['x64'] };
}

function thinMacBinding(file, arch, { command = spawnSync, hostPlatform = process.platform } = {}) {
  assert.equal(hostPlatform, 'darwin', 'Thinning the recovery binding requires native macOS lipo');
  realEntry(path.dirname(file), path.basename(file));
  inspectBinding(fs.readFileSync(file), 'darwin', arch, { universal: true });
  const output = file + '.thin';
  assert(!fs.existsSync(output), 'Refusing native binding output collision');
  // Use the installed Apple tool, never a downloaded binary or a PATH override.
  const result = command('/usr/bin/lipo', [file, '-thin', arch === 'x64' ? 'x86_64' : 'arm64', '-output', output], { encoding: 'utf8' });
  assert(!result.error && result.status === 0, `Could not thin classic-level for ${arch}: ${result.error?.message || result.stderr || result.status}`);
  realEntry(path.dirname(file), path.basename(output));
  inspectBinding(fs.readFileSync(output), 'darwin', arch);
  fs.chmodSync(output, 0o755);
  fs.renameSync(output, file);
}

function stageBinding(sourceRoot, destinationRoot, platform, arch, options) {
  const target = targetBinding(platform, arch);
  const source = realEntry(sourceRoot, target.source);
  const metadata = JSON.parse(fs.readFileSync(realEntry(sourceRoot, 'package.json'), 'utf8'));
  assert(metadata.name === 'classic-level' && metadata.version === '3.0.0', 'Recovery binding must be classic-level@3.0.0');
  const destinationStat = fs.lstatSync(destinationRoot);
  assert(destinationStat.isDirectory() && !destinationStat.isSymbolicLink() && fs.readdirSync(destinationRoot).length === 0, 'Recovery binding stage must be an empty real directory');
  const sourceReal = fs.realpathSync(sourceRoot), destinationReal = fs.realpathSync(destinationRoot);
  const relative = path.relative(sourceReal, destinationReal);
  assert(relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative), 'Recovery stage cannot modify the source dependency');
  const bytes = fs.readFileSync(source);
  inspectBinding(bytes, platform, arch, { universal: platform === 'darwin' });
  const destination = path.join(destinationRoot, ...target.relative.split('/'));
  fs.mkdirSync(path.dirname(destination));
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, 0o755);
  if (platform === 'darwin') thinMacBinding(destination, arch, options);
  const stagedBytes = fs.readFileSync(destination);
  return { ...target, ...inspectBinding(stagedBytes, platform, arch), sha256: hash(stagedBytes), file: destination };
}

async function prepareNativeRecovery(context) {
  const platform = context.electronPlatformName, arch = Arch[context.arch];
  const target = targetBinding(platform, arch), info = context.packager.info;
  const source = realEntry(info.appDir, 'node_modules/classic-level', true);
  // One temporary root per build, with os/arch macros for concurrent targets.
  // electron-builder's manager removes it on build completion or failure.
  if (!stages.has(info)) stages.set(info, (async () => {
    const root = await info.tempDirManager.createTempDir({ prefix: 'qingdan-native-recovery' });
    assert(Array.isArray(info.config.files), 'Recovery packaging requires explicit file patterns');
    info.config.files.push({ from: path.join(root, '${os}-${arch}'), to: 'node_modules/classic-level/prebuilds', filter: ['**/*.node'] });
    return root;
  })());
  const root = await stages.get(info), directory = path.join(root, target.stage);
  fs.mkdirSync(directory);
  return stageBinding(source, directory, platform, arch);
}

// This is a PRE-SIGN check, including the afterPack hook (which runs before
// @electron/fuses resets the Mac ad-hoc signature with codesign --deep).
// Signing can change an unpacked Mach-O's size/hash. Electron deliberately does
// not load ASAR integrity for unpacked files, and dlopen uses their disk path:
// https://github.com/electron/electron/blob/v44.6.0/shell/common/asar/archive.cc
// Final Mac checks instead inspect the actual bytes with verifyMacArchitecture
// and verify-desktop-archives performs codesign --verify --deep --strict. Never
// rewrite app.asar after its header has been embedded/sealed in the app bundle.
function verifyPackagedBindingBeforeSigning(archive, platform, arch) {
  const target = targetBinding(platform, arch), asar = require('@electron/asar');
  const entries = asar.listPackage(archive).map(item => item.split(path.sep).join('/').replace(/^\//, ''));
  const natives = entries.filter(name => name.startsWith('node_modules/classic-level/') && /\.node$/i.test(name));
  assert.deepEqual(natives, [target.entry], 'Package must contain exactly the target classic-level binding');
  const entry = nativeAsarEntryPath(target.entry), metadata = asar.statFile(archive, entry, false);
  assert(metadata.unpacked && !metadata.link, 'Recovery binding must be unpacked and signable');
  const file = realEntry(archive + '.unpacked', target.entry), bytes = fs.readFileSync(file);
  assert.equal(metadata.size, bytes.length, 'Recovery binding ASAR size is stale');
  assert(asar.extractFile(archive, entry).equals(bytes), 'Recovery binding ASAR bytes differ');
  if (metadata.integrity) assert.equal(metadata.integrity.hash, hash(bytes), 'Recovery binding ASAR integrity is stale');
  return { entry: target.entry, unpacked: true, ...inspectBinding(bytes, platform, arch), sha256: hash(bytes) };
}

function verifyNativeRecovery(context) {
  const platform = context.electronPlatformName, arch = Arch[context.arch];
  const resources = platform === 'darwin' ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : path.join(context.appOutDir, 'resources');
  return verifyPackagedBindingBeforeSigning(path.join(resources, 'app.asar'), platform, arch);
}

module.exports = prepareNativeRecovery;
module.exports.default = prepareNativeRecovery;
Object.assign(module.exports, { targetBinding, realEntry, inspectBinding, thinMacBinding, stageBinding, verifyPackagedBindingBeforeSigning, verifyNativeRecovery });
