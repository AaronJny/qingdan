'use strict';
// Fresh FUSE-free extraction, exact application/runtime bytes, ASAR/fuses, then
// ordinary-Node smoke of the archived backend. This does not launch a Linux GUI.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const asar = require('@electron/asar');
const launcher = require('./linux-launcher.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hashFile = file => sha(fs.readFileSync(file));
function within(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function tree(root) {
  root = fs.realpathSync(root);
  const records = new Map();
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      assert(!['data', '.git', 'QingdanDesktop'].includes(name), `User data or repository state: ${name}`);
      const file = path.join(directory, name), relative = path.relative(root, file).split(path.sep).join('/');
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(file);
        assert(!path.isAbsolute(target) && within(root, path.resolve(directory, target)), `Unsafe symlink: ${relative}`);
        assert(within(root, fs.realpathSync(file)), `Escaping symlink: ${relative}`);
        records.set(relative, { path: relative, type: 'symlink', target });
      } else {
        assert(stat.isFile(), `Unexpected file type: ${relative}`);
        records.set(relative, { path: relative, type: 'file', bytes: stat.size, sha256: hashFile(file), executable: !!(stat.mode & 0o111) });
      }
    }
  }
  walk(root);
  return records;
}
function verifyElfX64(file, appImage = false) {
  const descriptor = fs.openSync(file, 'r'), header = Buffer.alloc(64);
  try { assert.equal(fs.readSync(descriptor, header, 0, 64, 0), 64, 'Truncated ELF header.'); }
  finally { fs.closeSync(descriptor); }
  assert(header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), 'Missing ELF header.');
  assert.equal(header[4], 2, 'ELF must be 64-bit.');
  assert.equal(header[5], 1, 'ELF must be little endian.');
  assert.equal(header.readUInt16LE(18), 62, 'ELF must target x86-64.');
  if (appImage) assert(header.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 0x02])), 'Expected type-2 AppImage.');
}
function inspectExtracted(extracted, unpacked, libraries, version) {
  const actual = tree(extracted), application = tree(unpacked), runtimeLibraries = tree(libraries);
  assert(application.get('AppRun')?.executable, 'Missing executable application launcher.');
  assert.equal(fs.readFileSync(path.join(unpacked, 'AppRun'), 'utf8'), launcher, 'Unexpected application launcher.');
  for (const [name, expected] of application) assert.deepEqual(actual.get(name), expected, `AppImage application file differs: ${name}`);
  for (const [name, expected] of runtimeLibraries) {
    const relative = `usr/lib/${name}`;
    assert.deepEqual(actual.get(relative), { ...expected, path: relative }, `AppImage runtime library differs: ${name}`);
  }
  assert.equal(fs.readFileSync(path.join(extracted, 'AppRun'), 'utf8'), launcher, 'Sandbox-preserving launcher was replaced.');
  verifyElfX64(path.join(extracted, 'qingdan'));
  for (const required of ['qingdan', 'AppRun', 'chrome-sandbox', 'resources/app.asar', 'LICENSE.electron.txt', 'LICENSES.chromium.html']) assert(actual.has(required), `Missing Linux resource: ${required}`);
  const metadata = new Map();
  for (const line of fs.readFileSync(path.join(extracted, 'qingdan.desktop'), 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || line === '[Desktop Entry]') continue;
    const equals = line.indexOf('='); assert(equals > 0, 'Invalid desktop entry.');
    const key = line.slice(0, equals); assert(!metadata.has(key), `Duplicate desktop entry: ${key}`);
    metadata.set(key, line.slice(equals + 1));
  }
  assert.equal(metadata.get('Exec'), 'AppRun %U', 'Desktop launcher must not disable the sandbox.');
  assert.equal(metadata.get('Name'), 'Qingdan'); assert.equal(metadata.get('Name[zh_CN]'), '青单'); assert.equal(metadata.get('Name[zh]'), '青单'); assert.equal(metadata.get('Name[zh_TW]'), '青單'); assert.equal(metadata.get('Icon'), 'qingdan');
  assert.equal(metadata.get('Type'), 'Application'); assert.equal(metadata.get('Terminal'), 'false');
  assert.equal(metadata.get('X-AppImage-Version'), version);
  const icons = [];
  for (const [name, record] of actual) {
    if (application.has(name) || name.startsWith('usr/lib/') && runtimeLibraries.has(name.slice('usr/lib/'.length))) continue;
    if (['qingdan.desktop', 'qingdan.png', '.DirIcon'].includes(name)) continue;
    const match = /^usr\/share\/icons\/hicolor\/(\d+)x\1\/apps\/qingdan\.png$/.exec(name);
    assert(match && record.type === 'file', `Unexpected AppImage file: ${name}`);
    const png = fs.readFileSync(path.join(extracted, name)), size = Number(match[1]);
    assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Invalid packaged PNG.');
    assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
    icons.push({ path: name, size, sha256: record.sha256 });
  }
  assert(icons.length, 'No desktop icons.'); icons.sort((a, b) => a.size - b.size);
  for (const name of ['qingdan.png', '.DirIcon']) {
    assert.equal(actual.get(name)?.type, 'symlink', `Missing desktop icon link: ${name}`);
    assert.equal(actual.get(name).target, icons.at(-1).path, `Desktop icon link differs: ${name}`);
  }
  return { cleanExtraction: true, applicationFilesMatched: application.size, runtimeLibraryFilesMatched: runtimeLibraries.size, desktopEntryVerified: true, sandboxPreservingLauncherVerified: true, icons, files: [...actual.values()] };
}
function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
  if (result.error || result.status !== 0) throw result.error || Error(`${command} failed (${result.status}): ${result.stdout}\n${result.stderr}`);
  return result;
}
async function verifyAppImage(appImage, unpacked, reportFile, smoke) {
  assert.equal(process.platform, 'linux', 'AppImage verification must run on Linux.');
  appImage = path.resolve(appImage); unpacked = path.resolve(unpacked); reportFile = path.resolve(reportFile);
  const file = fs.lstatSync(appImage); assert(file.isFile() && !file.isSymbolicLink() && file.mode & 0o111, 'AppImage must be an executable regular file.');
  verifyElfX64(appImage, true);
  const root = path.resolve(__dirname, '..'), configuration = require('../builder.config.cjs');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  assert.equal(configuration.toolsets.appimage, '1.0.3', 'Unexpected AppImage toolset.');
  const { getAppImageTools } = require('app-builder-lib/out/toolsets/linux');
  const { Arch } = require('builder-util');
  const tools = await getAppImageTools(configuration.toolsets.appimage, Arch.x64);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), '青单 AppImage verification '));
  try {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('APPIMAGE')) delete env[key];
    run(appImage, ['--appimage-extract'], temp, env);
    const extracted = path.join(temp, 'squashfs-root');
    const structure = inspectExtracted(extracted, unpacked, tools.runtimeLibraries, version);
    const archive = path.join(extracted, 'resources/app.asar'), packagedReport = path.join(temp, 'packaged.json');
    run(process.execPath, [path.join(__dirname, 'verify-packaged.cjs'), path.join(extracted, 'qingdan'), archive, packagedReport], root);
    const packaged = JSON.parse(fs.readFileSync(packagedReport));
    let backendSmoke = null;
    if (smoke) {
      // Refuse ASAR links/path traversal before the extraction used by Node.
      for (const name of asar.listPackage(archive)) {
        const relative = name.replace(/^\//, '');
        assert(relative && !relative.includes('\\') && relative.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe ASAR path.');
        assert(!asar.statFile(archive, relative).link, 'ASAR symlinks are unsupported.');
      }
      const payload = path.join(temp, 'actual packaged payload');
      asar.extractAll(archive, payload);
      backendSmoke = await require('./verify-backend.cjs').smokeVerifiedRuntime(path.join(payload, 'backend'), {
        version: packaged.backendVersion, sourceSnapshotSha256: packaged.backendSourceSnapshotSha256,
      });
    }
    const report = { version, platform: 'linux', architecture: 'x64', archiveBytes: file.size, archiveSha256: hashFile(appImage), appImageType: 2, appImageToolset: configuration.toolsets.appimage, ...structure, packaged, backendSmoke, electronUtilityProcessTested: false, nativeGuiTested: false };
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ...report, files: undefined }, null, 2));
    return report;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
if (require.main === module) {
  const args = process.argv.slice(2), smoke = args.includes('--smoke'), positional = args.filter(arg => arg !== '--smoke');
  if (positional.length !== 3) throw Error('Usage: node scripts/verify-linux-appimage.cjs app.AppImage linux-unpacked report.json [--smoke]');
  verifyAppImage(...positional, smoke).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { tree, verifyElfX64, inspectExtracted, verifyAppImage };
