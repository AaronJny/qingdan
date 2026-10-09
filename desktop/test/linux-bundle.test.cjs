'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const hook = require('../scripts/finalize-linux-bundle.cjs');
const launcher = require('../scripts/linux-launcher.cjs');
const { inspectExtracted, tree, verifyElfX64 } = require('../scripts/verify-linux-appimage.cjs');
const linuxTest = (name, fn) => test(name, { skip: process.platform !== 'linux' }, fn);
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '青单 Linux test '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
function elf(appImage = false) {
  const bytes = Buffer.alloc(64); Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(bytes);
  bytes[4] = 2; bytes[5] = 1; bytes.writeUInt16LE(62, 18);
  if (appImage) Buffer.from([0x41, 0x49, 0x02]).copy(bytes, 8);
  return bytes;
}
async function fixture(t) {
  const root = await directory(t), unpacked = path.join(root, 'linux-unpacked'), extracted = path.join(root, 'squashfs-root'), libraries = path.join(root, 'libraries');
  await fs.mkdir(path.join(unpacked, 'resources'), { recursive: true }); await fs.mkdir(libraries);
  for (const name of ['qingdan', 'chrome-sandbox']) await fs.writeFile(path.join(unpacked, name), elf(), { mode: 0o755 });
  for (const name of ['resources/app.asar', 'LICENSE.electron.txt', 'LICENSES.chromium.html']) await fs.writeFile(path.join(unpacked, name), name);
  await hook({ electronPlatformName: 'linux', appOutDir: unpacked });
  await fs.cp(unpacked, extracted, { recursive: true });
  await fs.writeFile(path.join(libraries, 'libfixture.so'), 'verified library');
  await fs.mkdir(path.join(extracted, 'usr/lib'), { recursive: true }); await fs.copyFile(path.join(libraries, 'libfixture.so'), path.join(extracted, 'usr/lib/libfixture.so'));
  const icon = 'usr/share/icons/hicolor/1024x1024/apps/qingdan.png';
  const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(1024, 16); png.writeUInt32BE(1024, 20);
  await fs.mkdir(path.dirname(path.join(extracted, icon)), { recursive: true }); await fs.writeFile(path.join(extracted, icon), png);
  for (const name of ['qingdan.png', '.DirIcon']) await fs.symlink(icon, path.join(extracted, name));
  await fs.writeFile(path.join(extracted, 'qingdan.desktop'), '[Desktop Entry]\nName=青单\nExec=AppRun %U\nIcon=qingdan\nTerminal=false\nType=Application\nX-AppImage-Version=1.1.0\n');
  return { root, unpacked, extracted, libraries, icon };
}
test('Linux release config targets an x64 AppImage with a pinned toolset and no sandbox-disable desktop arguments', () => {
  const config = require('../builder.config.cjs');
  assert.deepEqual(config.linux.target, [{ target: 'AppImage', arch: ['x64'] }]);
  assert.equal(config.toolsets.appimage, '1.0.3'); assert.deepEqual(config.appImage.executableArgs, []);
  assert.equal(config.appImage.artifactName, 'Qingdan-${version}-linux-x64.${ext}');
  assert.equal(config.appId, 'app.qingdan.desktop'); assert.equal(config.electronFuses.runAsNode, false);
  assert.equal(config.electronFuses.onlyLoadAppFromAsar, true); assert.equal(config.electronFuses.enableEmbeddedAsarIntegrityValidation, true);
  assert.equal(require('../package.json').scripts['package:linux:appimage'], 'node scripts/package.cjs linux --appimage --x64');
});
test('packaging rejects cross-platform AppImage and conflicting/unsupported Linux targets before reading backend inputs', () => {
  for (const args of [['win', '--appimage'], ['mac', '--appimage'], ['linux', '--arm64'], ['linux', '--zip'], ['linux', '--dir', '--appimage'], ['linux', '--x64', '--arm64']]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/package.cjs'), ...args], { encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Unsupported target/);
  }
});
linuxTest('Linux hook ignores other platforms and rejects missing executables or launcher collisions', async t => {
  for (const electronPlatformName of ['darwin', 'win32']) await hook({ electronPlatformName });
  const root = await directory(t);
  await assert.rejects(hook({ electronPlatformName: 'linux', appOutDir: root }));
  await fs.writeFile(path.join(root, 'qingdan'), elf(), { mode: 0o644 });
  await assert.rejects(hook({ electronPlatformName: 'linux', appOutDir: root }), /Invalid Linux executable/);
  await fs.chmod(path.join(root, 'qingdan'), 0o755); await hook({ electronPlatformName: 'linux', appOutDir: root });
  await assert.rejects(hook({ electronPlatformName: 'linux', appOutDir: root }), /EEXIST/);
});
linuxTest('locked builder copies the safe launcher over its generated fallback', async t => {
  const { unpacked, root } = await fixture(t), stage = path.join(root, 'builder-stage'); await fs.mkdir(stage);
  const { generateAppRunScript } = require('app-builder-lib/out/targets/appimage/appImageUtil');
  const generated = generateAppRunScript({ ExecutableName: 'qingdan', ProductFilename: 'Qingdan', ProductName: 'Qingdan', DesktopFileName: 'qingdan.desktop', ResourceName: 'appimagekit-qingdan' });
  assert.match(generated, /NO_SANDBOX=\(--no-sandbox\)/);
  await fs.writeFile(path.join(stage, 'AppRun'), generated, { mode: 0o755 });
  await require('builder-util').copyDir(unpacked, stage);
  assert.equal(await fs.readFile(path.join(stage, 'AppRun'), 'utf8'), launcher);
});
test('safe launcher works from a spaced Unicode directory, preserves arguments and refuses sandbox bypasses', async t => {
  if (process.platform !== 'linux') { t.skip('Linux bash launcher.'); return; }
  const root = await directory(t);
  await fs.writeFile(path.join(root, 'qingdan'), '#!/bin/bash\nprintf "%s\\n" "$APPDIR" "$@"\n', { mode: 0o755 });
  await hook({ electronPlatformName: 'linux', appOutDir: root });
  const result = spawnSync(path.join(root, 'AppRun'), ['an argument with spaces', 'https://example.test/路径'], { cwd: '/', env: { ...process.env, APPDIR: '/untrusted' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), [root, 'an argument with spaces', 'https://example.test/路径']);
  for (const option of ['--no-sandbox', '--no-sandbox=true', '--disable-setuid-sandbox', '--disable-seccomp-filter-sandbox']) {
    const blocked = spawnSync(path.join(root, 'AppRun'), [option], { encoding: 'utf8' });
    assert.equal(blocked.status, 1); assert.match(blocked.stderr, /requires the Electron sandbox/); assert.equal(blocked.stdout, '');
  }
});
linuxTest('clean AppImage extraction matches all application/library bytes and safe desktop metadata', async t => {
  const f = await fixture(t), report = inspectExtracted(f.extracted, f.unpacked, f.libraries, '1.1.0');
  assert.equal(report.cleanExtraction, true); assert.equal(report.applicationFilesMatched, 6);
  assert.equal(report.runtimeLibraryFilesMatched, 1); assert.equal(report.sandboxPreservingLauncherVerified, true);
  assert.equal(report.icons[0].size, 1024);
});
for (const change of ['application', 'library', 'launcher', 'desktop', 'extra', 'icon']) {
  linuxTest(`AppImage verification rejects modified ${change}`, async t => {
    const f = await fixture(t);
    const names = { application: 'resources/app.asar', library: 'usr/lib/libfixture.so', launcher: 'AppRun', desktop: 'qingdan.desktop', extra: 'unexpected.txt', icon: f.icon };
    await fs.writeFile(path.join(f.extracted, names[change]), 'tampered');
    assert.throws(() => inspectExtracted(f.extracted, f.unpacked, f.libraries, '1.1.0'));
  });
}
linuxTest('artifact tree rejects escaping/dangling links, user data and unsupported file types', async t => {
  const root = await directory(t); await fs.symlink('/etc/passwd', path.join(root, 'escaping'));
  assert.throws(() => tree(root), /Unsafe symlink/); await fs.unlink(path.join(root, 'escaping'));
  await fs.symlink('missing', path.join(root, 'dangling')); assert.throws(() => tree(root)); await fs.unlink(path.join(root, 'dangling'));
  await fs.mkdir(path.join(root, 'data')); assert.throws(() => tree(root), /User data/);
});
test('ELF verification rejects wrong CPU, encoding and AppImage runtime magic', async t => {
  const root = await directory(t), file = path.join(root, 'app.AppImage'); await fs.writeFile(file, elf(true));
  verifyElfX64(file, true);
  for (const [offset, byte] of [[4, 1], [5, 2], [18, 183], [8, 0]]) {
    const bytes = elf(true); bytes[offset] = byte; await fs.writeFile(file, bytes); assert.throws(() => verifyElfX64(file, true));
  }
});
test('packaged-runtime smoke requires verified version and source-snapshot evidence', async () => {
  const { smokeVerifiedRuntime } = require('../scripts/verify-backend.cjs');
  await assert.rejects(smokeVerifiedRuntime('/missing', {}), /verified runtime version/);
  await assert.rejects(smokeVerifiedRuntime('/missing', { version: '1.1.0', sourceSnapshotSha256: 'bad' }));
});
