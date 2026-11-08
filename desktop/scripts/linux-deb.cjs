'use strict';
// Assemble a Debian package from an already verified Electron bundle without
// electron-builder/FPM's SUID fallback or mutation of linux-unpacked.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { tree, verifyElfX64 } = require('./verify-linux-appimage.cjs');
const ROOT = path.resolve(__dirname, '..');
const POLICY = 'etc/apparmor.d/app.qingdan.desktop';
const PACKAGE = 'qingdan';
const APP = 'usr/lib/qingdan';
const dependencies = [
  'apparmor (>= 4.0)', 'libgtk-3-0t64 | libgtk-3-0', 'libnss3', 'libnspr4',
  'libasound2t64 | libasound2', 'libatk1.0-0t64 | libatk1.0-0',
  'libatk-bridge2.0-0t64 | libatk-bridge2.0-0', 'libatspi2.0-0t64 | libatspi2.0-0',
  'libc6 (>= 2.35)', 'libcairo2', 'libcups2t64 | libcups2', 'libdbus-1-3',
  'libdrm2', 'libexpat1', 'libgbm1', 'libglib2.0-0t64 | libglib2.0-0',
  'libpango-1.0-0', 'libx11-6', 'libxcb1', 'libxcomposite1', 'libxdamage1',
  'libxext6', 'libxfixes3', 'libxkbcommon0', 'libxrandr2', 'xdg-utils',
];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw result.error || Error(`${command} failed: ${result.stderr}`);
  return result.stdout;
}
function write(root, relative, contents, mode = 0o644) {
  const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { mode, flag: 'wx' });
}
function normalizeModes(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name), stat = fs.lstatSync(file);
    assert(!(stat.mode & 0o6000), `Refusing privileged mode: ${file}`);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { fs.chmodSync(file, 0o755); normalizeModes(file); }
    else { assert(entry.isFile()); fs.chmodSync(file, stat.mode & 0o111 ? 0o755 : 0o644); }
  }
}
function stageDeb(unpacked, stage, version) {
  assert(/^\d+\.\d+\.\d+$/.test(version), 'Expected a stable numeric version');
  assert(!fs.existsSync(stage), 'DEB staging directory must be new');
  const application = tree(unpacked); // Reject external/dangling links and user data.
  verifyElfX64(path.join(unpacked, 'qingdan'));
  for (const name of ['AppRun', 'chrome-sandbox', 'resources/app.asar', 'LICENSE.electron.txt', 'LICENSES.chromium.html']) assert(application.has(name), `Missing ${name}`);
  assert.equal(fs.readFileSync(path.join(unpacked, 'AppRun'), 'utf8'), require('./linux-launcher.cjs'));
  fs.mkdirSync(path.dirname(path.join(stage, APP)), { recursive: true });
  fs.cpSync(unpacked, path.join(stage, APP), { recursive: true, verbatimSymlinks: true });
  for (const name of ['postinst', 'postrm']) write(stage, `DEBIAN/${name}`, fs.readFileSync(path.join(ROOT, 'packaging/linux', name)), 0o755);
  write(stage, POLICY, fs.readFileSync(path.join(ROOT, 'packaging/linux/app.qingdan.desktop')));
  write(stage, 'DEBIAN/conffiles', `/${POLICY}\n`);
  write(stage, 'usr/share/applications/qingdan.desktop', fs.readFileSync(path.join(ROOT, 'packaging/linux/qingdan.desktop')));
  write(stage, 'usr/share/icons/hicolor/1024x1024/apps/qingdan.png', fs.readFileSync(path.join(ROOT, 'build/icon.png')));
  write(stage, 'usr/share/doc/qingdan/copyright', fs.readFileSync(path.join(ROOT, '../LICENSE')));
  fs.mkdirSync(path.join(stage, 'usr/bin'), { recursive: true });
  fs.symlinkSync('../lib/qingdan/AppRun', path.join(stage, 'usr/bin/qingdan'));
  const installedSize = Math.ceil([...application.values()].reduce((sum, file) => sum + (file.bytes || 0), 0) / 1024);
  write(stage, 'DEBIAN/control', `Package: ${PACKAGE}\nVersion: ${version}\nSection: utils\nPriority: optional\nArchitecture: amd64\nMaintainer: Independent Qingdan project\nHomepage: https://github.com/AaronJny/qingdan\nInstalled-Size: ${installedSize}\nDepends: ${dependencies.join(', ')}\nDescription: Qingdan local-first tasks and calendar\n Sandboxed desktop application with an embedded local backend.\n Ubuntu 24.04 with AppArmor 4.\n`);
  normalizeModes(stage);
  return stage;
}
function verifyDeb(archive, stage, reportFile) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-deb-verify-'));
  try {
    const extracted = path.join(temp, 'root');
    run('dpkg-deb', ['--raw-extract', archive, extracted]);
    assert.deepEqual(tree(extracted), tree(stage), 'DEB payload/control bytes differ from staged inputs');
    const controlTar = run('dpkg-deb', ['--ctrl-tarfile', archive], { encoding: null });
    const headers = run('dpkg-deb', ['--contents', archive]) + run('tar', ['--list', '--verbose', '--file', '-'], { input: controlTar });
    for (const line of headers.trim().split('\n')) {
      assert(/^[dl-][rwx-]{9}\s+root\/root\s/.test(line), `Unexpected ownership, mode or type: ${line}`);
      assert(line[0] === 'l' || !/[w]/.test(line[5] + line[8]), `Group/world writable package path: ${line}`);
    }
    const control = run('dpkg-deb', ['--field', archive]);
    assert.match(control, /^Package: qingdan$/m); assert.match(control, /^Architecture: amd64$/m);
    assert.equal(fs.readlinkSync(path.join(extracted, 'usr/bin/qingdan')), '../lib/qingdan/AppRun');
    const report = {
      schema: 'qingdan-linux-deb-v1', package: PACKAGE, version: /^Version: (.+)$/m.exec(control)?.[1], architecture: 'amd64',
      archiveSha256: hash(archive), applicationPath: '/usr/lib/qingdan/qingdan',
      exactPayloadAndControlVerified: true, rootOwnedNonWritableFiles: true, setuidOrSetgidFiles: false,
      scopedAppArmorPolicy: '/etc/apparmor.d/app.qingdan.desktop',
      installTested: false, upgradeTested: false, uninstallTested: false, nativeGuiTested: false,
    };
    if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    return report;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
function buildDeb(unpacked, output, version, reportFile) {
  assert.equal(process.platform, 'linux');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-deb-build-'));
  try {
    const stage = stageDeb(path.resolve(unpacked), path.join(temp, 'stage'), version);
    run('dpkg-deb', ['--build', '--root-owner-group', '-Zxz', stage, path.resolve(output)]);
    return verifyDeb(output, stage, reportFile);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
module.exports = { stageDeb, buildDeb, verifyDeb, normalizeModes, dependencies };
