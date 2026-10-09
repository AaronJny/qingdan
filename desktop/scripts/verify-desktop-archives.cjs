'use strict';
// Native artifact structure/integrity verification. Never sign, modify, or launch
// an application; reports are written outside the original/extracted bundles.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const plist = require('plist');
const root = path.resolve(__dirname, '..');
const APP = '青单.app';
const HELPERS = ['', ' (GPU)', ' (Plugin)', ' (Renderer)'];
const NOTICES = ['LICENSE.electron.txt', 'LICENSES.chromium.html'];

function shaFile(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let length;
    while ((length = fs.readSync(descriptor, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, length));
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}
function realFile(file, executable = false) {
  const value = fs.lstatSync(file);
  assert(value.isFile() && !value.isSymbolicLink() && value.size > 0, `Missing or invalid file: ${file}`);
  if (executable) assert(value.mode & 0o111, `Nonexecutable file: ${file}`);
  return value;
}
function realDirectory(directory) {
  const value = fs.lstatSync(directory);
  assert(value.isDirectory() && !value.isSymbolicLink(), `Missing or invalid directory: ${directory}`);
}
function within(directory, candidate) {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function snapshot(directory, unixModes) {
  realDirectory(directory);
  // macOS /var and /tmp are ancestor aliases for /private/var and
  // /private/tmp. Compare lexical and resolved link targets in one root.
  directory = fs.realpathSync(directory);
  const entries = [];
  const keys = new Set(), links = [];
  const walk = current => {
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name);
      const relative = path.relative(directory, file).split(path.sep).join('/').normalize('NFC');
      const key = relative.toLowerCase();
      assert(!keys.has(key), `Case/Unicode-colliding payload path: ${relative}`); keys.add(key);
      const value = fs.lstatSync(file), entry = { path: relative };
      if (value.isSymbolicLink()) {
        assert(unixModes, `Unexpected Windows symlink: ${relative}`);
        entry.type = 'symlink'; entry.target = fs.readlinkSync(file).normalize('NFC');
        assert(!path.isAbsolute(entry.target) && within(directory, path.resolve(path.dirname(file), entry.target)), `External bundle symlink: ${relative}`);
        links.push({ file, relative });
      } else if (value.isDirectory()) {
        entry.type = 'directory'; if (unixModes) entry.mode = value.mode & 0o777;
        entries.push(entry); walk(file); continue;
      } else {
        assert(value.isFile(), `Unsupported filesystem entry: ${relative}`);
        entry.type = 'file'; entry.bytes = value.size; entry.sha256 = shaFile(file);
        if (unixModes) entry.mode = value.mode & 0o777;
      }
      entries.push(entry);
    }
  };
  walk(directory);
  // Check every lexical target before following any chain. A later external
  // link must not be followed through an earlier, apparently internal link.
  for (const { file, relative } of links) assert(within(directory, fs.realpathSync(file)), `External resolved bundle symlink: ${relative}`);
  return entries.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
function comparePayload(original, extracted, unixModes) {
  const expected = snapshot(original, unixModes), actual = snapshot(extracted, unixModes);
  assert.deepEqual(actual, expected, 'Archive payload differs from the verified unpacked app (paths, bytes, modes, or symlinks)');
  return { entries: expected.length, files: expected.filter(item => item.type === 'file').length,
    symlinks: expected.filter(item => item.type === 'symlink').length,
    allFileBytesMatched: true, allPathsMatched: true, unixModesMatched: unixModes,
    inventorySha256: crypto.createHash('sha256').update(JSON.stringify(expected)).digest('hex') };
}
function verifyMacBundle(bundle, version) {
  realDirectory(bundle); realDirectory(path.join(bundle, 'Contents'));
  const contents = path.join(bundle, 'Contents'), metadata = path.join(contents, 'Info.plist'); realFile(metadata);
  const info = plist.parse(fs.readFileSync(metadata, 'utf8'));
  for (const [key, expected] of Object.entries({ CFBundleName: '青单', CFBundleDisplayName: '青单',
    CFBundleExecutable: '青单', CFBundleIdentifier: 'app.qingdan.desktop',
    CFBundleShortVersionString: version, CFBundleVersion: version })) assert.equal(info[key], expected, `macOS ${key}`);
  const executable = path.join(contents, 'MacOS', '青单'), resources = path.join(contents, 'Resources');
  realDirectory(path.join(contents, 'MacOS')); realDirectory(resources); realFile(executable, true);
  realFile(path.join(resources, 'app.asar'));
  assert.equal(info.LSMinimumSystemVersion, '13.0', 'macOS minimum supported version');
  assert(typeof info.CFBundleIconFile === 'string' && path.basename(info.CFBundleIconFile) === info.CFBundleIconFile, 'Invalid macOS icon metadata');
  const icon = path.join(resources, info.CFBundleIconFile.endsWith('.icns') ? info.CFBundleIconFile : info.CFBundleIconFile + '.icns');
  realFile(icon); assert.equal(shaFile(icon), shaFile(path.join(root, 'build', 'icon.icns')), 'macOS icon differs from source');
  for (const notice of NOTICES) realFile(path.join(resources, notice));
  const frameworks = path.join(contents, 'Frameworks'); realDirectory(frameworks);
  for (const suffix of HELPERS) {
    const name = `Electron Helper${suffix}`, helper = path.join(frameworks, name + '.app');
    realDirectory(helper); realDirectory(path.join(helper, 'Contents')); realDirectory(path.join(helper, 'Contents', 'MacOS'));
    const file = path.join(helper, 'Contents', 'Info.plist'); realFile(file);
    const metadata = plist.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(metadata.CFBundleExecutable, name, 'macOS helper executable metadata');
    assert.equal(metadata.CFBundleName, name, 'macOS helper lookup name');
    assert.equal(metadata.CFBundleIdentifier, 'app.qingdan.desktop.helper' + (suffix ? '.' + suffix.trim().replace(/[()]/g, '') : ''), 'macOS helper identity');
    assert(metadata.CFBundleDisplayName?.startsWith('青单辅助程序'), 'macOS helper display name');
    realFile(path.join(helper, 'Contents', 'MacOS', name), true);
  }
  return { executable, archive: path.join(resources, 'app.asar'), metadata: { bundleIdentifier: info.CFBundleIdentifier,
    executableName: info.CFBundleExecutable, version: info.CFBundleShortVersionString,
    minimumSystemVersion: info.LSMinimumSystemVersion, iconSha256: shaFile(icon), helperNamesVerified: HELPERS.map(suffix => 'Electron Helper' + suffix), runtimeNoticesPresent: NOTICES } };
}
function verifyWindowsPayload(directory) {
  realDirectory(directory); realDirectory(path.join(directory, 'resources')); realDirectory(path.join(directory, 'locales'));
  const executable = path.join(directory, 'Qingdan.exe'), archive = path.join(directory, 'resources', 'app.asar');
  for (const file of ['Qingdan.exe', 'resources/app.asar', 'resources.pak', 'icudtl.dat',
    'chrome_100_percent.pak', 'chrome_200_percent.pak', 'v8_context_snapshot.bin', 'locales/en-US.pak', ...NOTICES]) realFile(path.join(directory, file));
  const descriptor = fs.openSync(executable, 'r');
  const read = (size, offset) => { const bytes = Buffer.alloc(size); assert.equal(fs.readSync(descriptor, bytes, 0, size, offset), size, 'Truncated Windows PE'); return bytes; };
  try {
    const dos = read(64, 0); assert.equal(dos.toString('ascii', 0, 2), 'MZ', 'Windows DOS magic');
    const offset = dos.readUInt32LE(0x3c), pe = read(24 + 160, offset);
    assert(pe.subarray(0, 4).equals(Buffer.from('PE\0\0')), 'Windows PE magic');
    assert.equal(pe.readUInt16LE(4), 0x8664, 'Windows architecture must be amd64');
    assert.equal(pe.readUInt16LE(24), 0x20b, 'Windows executable must be PE32+');
    return { executable, archive, metadata: { peMachine: 'amd64',
      peCertificateTableBytes: pe.readUInt32LE(24 + 112 + 4 * 8 + 4), runtimeNoticesPresent: NOTICES } };
  } finally { fs.closeSync(descriptor); }
}
function run(command, args, options = {}) {
  const { captureStderr, ...spawnOptions } = options;
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000, ...spawnOptions });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout || result.status}`);
  return captureStderr ? result.stderr : result.stdout;
}
function nativeCommands(platform, command = run) {
  const python = process.env.QINGDAN_PYTHON || (platform === 'win' ? 'python' : 'python3');
  return {
    verifyMacSignature: bundle => {
      command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle]);
      const metadata = command('/usr/bin/codesign', ['-d', '--verbose=4', bundle], { captureStderr: true });
      assert(/^Signature=adhoc\r?$/m.test(metadata), 'macOS bundle must have the disclosed ad-hoc integrity seal');
      assert(!/^Authority=/m.test(metadata), 'Unexpected macOS publisher signing authority');
      return { codesignDeepStrictVerified: true, signature: 'adhoc', developerIdSigned: false,
        identifier: metadata.match(/^Identifier=(.+)$/m)?.[1]?.trim(), teamIdentifier: metadata.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() };
    },
    inspectZip: file => JSON.parse(command(python, [path.join(__dirname, 'inspect-desktop-zip.py'), file, '--platform', platform])),
    extractZip: (file, directory) => {
      if (platform === 'mac') command('/usr/bin/ditto', ['-x', '-k', file, directory]);
      else {
        // Base64 avoids shell interpolation of filenames. LiteralPath handles [] and *. No profile runs.
        const quote = value => "'" + value.replace(/'/g, "''") + "'";
        const script = `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${quote(file)} -DestinationPath ${quote(directory)}`;
        command('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
      }
    },
    verifyDmg: file => command('/usr/bin/hdiutil', ['verify', file]),
    mountDmg: (file, directory) => {
      // No writable shadow, license acceptance, codesign, xattr, or security changes.
      command('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', directory, file]);
    },
    checkReadOnly: directory => {
      const result = JSON.parse(command(python, ['-c', "import json,os,sys; s=os.statvfs(sys.argv[1]); print(json.dumps({'readOnly':bool(s.f_flag & os.ST_RDONLY)}))", directory]));
      assert.equal(result.readOnly, true, 'DMG volume must actually be mounted read-only');
    },
    detachDmg: directory => command('/usr/bin/hdiutil', ['detach', directory]),
    verifyPackaged: (payload, report) => {
      command(process.execPath, [path.join(__dirname, 'verify-packaged.cjs'), payload.executable, payload.archive, report]);
      const packaged = JSON.parse(fs.readFileSync(report, 'utf8'));
      const asar = require('@electron/asar');
      assert(asar.extractFile(payload.archive, 'build/icon.png').equals(fs.readFileSync(path.join(root, 'build/icon.png'))), 'Packaged application icon differs from source');
      return { ...packaged, bundledAssetsVerified: ['build/icon.png'] };
    },
  };
}
function assertReportLocation(report, inputs) {
  const parent = fs.realpathSync(path.dirname(report));
  const resolved = path.join(parent, path.basename(report));
  for (const input of inputs) {
    const real = fs.realpathSync(input);
    assert(resolved !== real && (!fs.statSync(real).isDirectory() || !within(real, resolved)), 'Verification report must be outside the payload/artifact');
  }
  try { assert(!fs.lstatSync(report).isSymbolicLink(), 'Refusing a symlink report'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function verifyArchives(options, commands = nativeCommands(options.platform), nativePlatform = process.platform) {
  const { platform, version, arch, unpacked, zip, dmg, report } = options;
  assert(['mac', 'win'].includes(platform), 'Unsupported desktop platform');
  assert.equal(nativePlatform, platform === 'mac' ? 'darwin' : 'win32', 'Archive verification must run on the matching native OS');
  realFile(zip); if (platform === 'mac') realFile(dmg);
  assertReportLocation(report, [unpacked, zip, ...(dmg ? [dmg] : [])]);
  const original = snapshot(unpacked, platform === 'mac');
  const baseline = platform === 'mac' ? verifyMacBundle(unpacked, version) : verifyWindowsPayload(unpacked);
  if (platform === 'mac') baseline.metadata.nativeSignature = commands.verifyMacSignature(unpacked);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-archive-verify-'));
  let mounted = false;
  const mountpoint = path.join(temporary, 'mounted-dmg');
  const result = { schemaVersion: 1, platform, arch, version, nativeArchiveToolsUsed: true,
    nativeGuiTested: false, electronUtilityProcessTested: false, backendApiSmokeTested: false,
    verificationScope: 'Native ZIP extraction and read-only DMG mount; byte-identical payload, metadata, bundled backend snapshot, and Electron fuses. No application launch or backend/API smoke is performed by this verifier.',
    signing: { developerIdConfigured: false, notarizationConfigured: false, note: 'No publisher signing identity is configured. Any ad-hoc integrity seal is not Developer ID signing or Apple notarization.' },
    unpackedPayloadMetadata: baseline.metadata, artifacts: [] };
  try {
    const extracted = path.join(temporary, 'extracted-zip'); fs.mkdirSync(extracted);
    const preflight = commands.inspectZip(zip);
    commands.extractZip(zip, extracted);
    let payloadPath = extracted;
    if (platform === 'mac') {
      assert.deepEqual(fs.readdirSync(extracted), [APP], 'macOS ZIP must contain exactly the application bundle');
      payloadPath = path.join(extracted, APP);
    }
    const matched = comparePayload(unpacked, payloadPath, platform === 'mac');
    const payload = platform === 'mac' ? verifyMacBundle(payloadPath, version) : verifyWindowsPayload(payloadPath);
    if (platform === 'mac') payload.metadata.nativeSignature = commands.verifyMacSignature(payloadPath);
    const packaged = commands.verifyPackaged(payload, path.join(temporary, 'zip-packaged.json'));
    assert.equal(packaged.version, version, 'Extracted ZIP ASAR version');
    assert.equal(packaged.executableSha256, shaFile(baseline.executable), 'Extracted ZIP executable');
    assert.equal(packaged.asarSha256, shaFile(baseline.archive), 'Extracted ZIP ASAR');
    result.artifacts.push({ format: 'zip', filename: path.basename(zip), bytes: fs.statSync(zip).size, sha256: shaFile(zip),
      freshNativeExtractionVerified: true, preflight, payloadMatched: matched, metadata: payload.metadata, packagedVerification: packaged });
    if (platform === 'mac') {
      fs.mkdirSync(mountpoint);
      commands.verifyDmg(dmg);
      mounted = true; // An interrupted/failed attach may still leave a mounted volume.
      commands.mountDmg(dmg, mountpoint);
      commands.checkReadOnly(mountpoint);
      const applications = path.join(mountpoint, 'Applications');
      assert(fs.lstatSync(applications).isSymbolicLink(), 'DMG must contain the Applications installation link');
      assert.equal(fs.readlinkSync(applications), '/Applications', 'DMG Applications link target');
      const mountedBundle = path.join(mountpoint, APP);
      const matched = comparePayload(unpacked, mountedBundle, true), payload = verifyMacBundle(mountedBundle, version);
      payload.metadata.nativeSignature = commands.verifyMacSignature(mountedBundle);
      const packaged = commands.verifyPackaged(payload, path.join(temporary, 'dmg-packaged.json'));
      assert.equal(packaged.version, version, 'Mounted DMG ASAR version');
      assert.equal(packaged.executableSha256, shaFile(baseline.executable), 'Mounted DMG executable');
      assert.equal(packaged.asarSha256, shaFile(baseline.archive), 'Mounted DMG ASAR');
      result.artifacts.push({ format: 'dmg', filename: path.basename(dmg), bytes: fs.statSync(dmg).size, sha256: shaFile(dmg),
        nativeReadOnlyMountVerified: true, applicationsLinkVerified: true, payloadMatched: matched,
        metadata: payload.metadata, packagedVerification: packaged });
      commands.detachDmg(mountpoint); mounted = false;
    }
    assert.deepEqual(snapshot(unpacked, platform === 'mac'), original, 'Verification modified the unpacked app');
    result.originalPayloadUnchanged = true;
    fs.writeFileSync(report, JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally {
    // Never recursively delete a mounted volume, including after a failed check.
    if (mounted) { commands.detachDmg(mountpoint); mounted = false; }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
function parseArgs(args) {
  const platform = args.shift(), values = {};
  const allowed = ['arch', 'unpacked', 'zip', 'dmg', 'report'];
  while (args.length) {
    const key = args.shift();
    assert(key.startsWith('--') && allowed.includes(key.slice(2)), `Unknown option: ${key}`);
    assert(args.length && !args[0].startsWith('--') && !(key.slice(2) in values), `Missing/duplicate option: ${key}`);
    values[key.slice(2)] = args.shift();
  }
  assert(['mac', 'win'].includes(platform), 'Usage: node scripts/verify-desktop-archives.cjs mac|win [--arch arm64|x64] [--unpacked path] [--zip path] [--dmg path] [--report path]');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  const arch = values.arch || (platform === 'mac' ? 'arm64' : 'x64');
  assert(platform === 'mac' ? ['arm64', 'x64'].includes(arch) : arch === 'x64', 'Unsupported desktop architecture');
  assert(platform === 'mac' || !values.dmg, 'Windows verification does not accept a DMG');
  const dist = path.join(root, 'dist');
  const findArtifact = extension => {
    const files = fs.readdirSync(dist).filter(name => name.endsWith('.' + extension) && name.includes(`-${version}-`) && name.includes(`-${arch}.`));
    assert.equal(files.length, 1, `Expected exactly one ${version}/${arch} ${extension} in dist; pass --${extension} explicitly`);
    return path.join(dist, files[0]);
  };
  return { platform, arch, version,
    unpacked: path.resolve(values.unpacked || (platform === 'mac' ? path.join(dist, arch === 'arm64' ? 'mac-arm64' : 'mac', APP) : path.join(dist, 'win-unpacked'))),
    zip: values.zip ? path.resolve(values.zip) : findArtifact('zip'),
    dmg: platform === 'mac' ? (values.dmg ? path.resolve(values.dmg) : findArtifact('dmg')) : undefined,
    report: path.resolve(values.report || path.join(dist, `verified-${platform}-${arch}-archives.json`)) };
}
if (require.main === module) {
  try { const options = parseArgs(process.argv.slice(2)); const report = verifyArchives(options); console.log(JSON.stringify(report, null, 2)); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
module.exports = { shaFile, snapshot, comparePayload, verifyMacBundle, verifyWindowsPayload, nativeCommands, assertReportLocation, verifyArchives, parseArgs };
