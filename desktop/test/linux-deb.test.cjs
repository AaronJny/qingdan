'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { stageDeb, buildDeb, verifyDeb, normalizeModes } = require('../scripts/linux-deb.cjs');
const ROOT = path.resolve(__dirname, '..');
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-deb-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
}
function bundle(root) {
  const app = path.join(root, 'app'); fs.mkdirSync(path.join(app, 'resources'), { recursive: true });
  const elf = Buffer.alloc(64); Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(elf); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(62, 18);
  for (const name of ['qingdan', 'chrome-sandbox']) fs.writeFileSync(path.join(app, name), elf, { mode: 0o755 });
  for (const name of ['resources/app.asar', 'LICENSE.electron.txt', 'LICENSES.chromium.html']) fs.writeFileSync(path.join(app, name), name);
  fs.writeFileSync(path.join(app, 'AppRun'), require('../scripts/linux-launcher.cjs'), { mode: 0o755 });
  return app;
}
test('DEB is root-owned with exact payload and no privileged files; input bundle is unchanged', { skip: process.platform !== 'linux' }, t => {
  const root = temp(t), app = bundle(root), archive = path.join(root, 'test.deb');
  const before = require('../scripts/verify-linux-appimage.cjs').tree(app);
  const report = buildDeb(app, archive, '1.3.10');
  assert(report.exactPayloadAndControlVerified); assert.equal(report.nativeGuiTested, false); assert.equal(report.installTested, false);
  assert.deepEqual(require('../scripts/verify-linux-appimage.cjs').tree(app), before);
  const stage = stageDeb(app, path.join(root, 'expected'), '1.3.10');
  fs.appendFileSync(path.join(stage, 'etc/apparmor.d/app.qingdan.desktop'), '# modified\n');
  assert.throws(() => verifyDeb(archive, stage), /payload\/control bytes differ/);
});
test('DEB staging refuses unsafe links, privileged modes and invalid versions', t => {
  const root = temp(t), app = bundle(root), stage = path.join(root, 'stage');
  assert.throws(() => stageDeb(app, stage, '1.0\nMalicious: yes'));
  fs.symlinkSync('/etc/passwd', path.join(app, 'outside')); assert.throws(() => stageDeb(app, stage, '1.3.10'), /Unsafe symlink/);
  fs.unlinkSync(path.join(app, 'outside'));
  fs.chmodSync(path.join(app, 'chrome-sandbox'), 0o4755);
  assert.throws(() => normalizeModes(app), /privileged mode/);
});
test('DEB policy grants userns to one fixed executable and preserves administrator policy changes', () => {
  const policy = fs.readFileSync(path.join(ROOT, 'packaging/linux/app.qingdan.desktop'), 'utf8');
  assert.match(policy, /profile app\.qingdan\.desktop \/usr\/lib\/qingdan\/qingdan flags=\(unconfined\)\s*{\s*userns,\s*}/);
  assert(!/[?*]/.test(policy));
  for (const name of ['postinst', 'postrm']) {
    const script = fs.readFileSync(path.join(ROOT, 'packaging/linux', name), 'utf8');
    assert(!/chmod|sysctl|--no-sandbox|\bcp\b|\brm\b|QingdanDesktop/.test(script.replace(/^\s*#.*$/gm, '')));
    assert.equal(spawnSync('/bin/sh', ['-n'], { input: script }).status, 0);
  }
});
function lifecycle(t, name, action, { enabled = 'Y', loaded = true, parserExit = 0, readable = true, owner = 0, mode = '755', symlink = false } = {}) {
  const root = temp(t), bin = path.join(root, 'bin'), log = path.join(root, 'calls'); fs.mkdirSync(bin);
  const installed = path.join(root, 'installed/usr');
  fs.mkdirSync(path.join(installed, 'lib/qingdan'), { recursive: true });
  fs.writeFileSync(path.join(installed, 'lib/qingdan/qingdan'), 'fixture');
  if (symlink) { fs.renameSync(path.join(installed, 'lib/qingdan/qingdan'), path.join(root, 'outside')); fs.symlinkSync(path.join(root, 'outside'), path.join(installed, 'lib/qingdan/qingdan')); }
  fs.writeFileSync(path.join(bin, 'stat'), `#!/bin/sh\ncase "$2" in %u) echo ${owner};; %a) echo ${mode};; *) exit 2;; esac\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'enabled'), enabled);
  if (readable) fs.writeFileSync(path.join(root, 'profiles'), loaded ? 'app.qingdan.desktop (unconfined)\nother-app (enforce)\n' : 'other-app (enforce)\n');
  fs.writeFileSync(path.join(bin, 'apparmor_parser'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncat >> '${log}'\nexit ${parserExit}\n`, { mode: 0o755 });
  const script = fs.readFileSync(path.join(ROOT, 'packaging/linux', name), 'utf8')
    .replaceAll('/usr', installed)
    .replaceAll('/sys/module/apparmor/parameters/enabled', path.join(root, 'enabled'))
    .replaceAll('/sys/kernel/security/apparmor/profiles', path.join(root, 'profiles'));
  const file = path.join(root, name); fs.writeFileSync(file, script);
  const result = spawnSync('/bin/sh', [file, action, '1.3.9'], { encoding: 'utf8', input: '', env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` } });
  return { ...result, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
}
test('install and upgrade configure replace the scoped policy and propagate load failures', t => {
  const configured = lifecycle(t, 'postinst', 'configure'); assert.equal(configured.status, 0);
  assert.match(configured.calls, /^--replace --skip-read-cache \/etc\/apparmor.d\/app.qingdan.desktop/m);
  assert.equal(lifecycle(t, 'postinst', 'configure', { parserExit: 9 }).status, 9);
  assert.equal(lifecycle(t, 'postinst', 'configure', { enabled: 'N' }).calls, '');
});
test('remove and purge unload only our loaded profile, while upgrade/rollback do not unload it', t => {
  for (const action of ['remove', 'purge']) {
    const removed = lifecycle(t, 'postrm', action); assert.equal(removed.status, 0);
    assert.equal(removed.calls, '--remove\nprofile app.qingdan.desktop {}\n');
    assert.equal(lifecycle(t, 'postrm', action, { loaded: false }).calls, '');
    assert.equal(lifecycle(t, 'postrm', action, { parserExit: 7 }).status, 7);
    assert.notEqual(lifecycle(t, 'postrm', action, { readable: false }).status, 0);
  }
  for (const action of ['upgrade', 'failed-upgrade', 'abort-install', 'abort-upgrade', 'disappear']) assert.equal(lifecycle(t, 'postrm', action).calls, '');
});
test('DEB package arguments reject wrong platforms, architecture and conflicting directory target', () => {
  for (const args of [['win', '--deb'], ['mac', '--deb'], ['linux', '--deb', '--dir'], ['linux', '--deb', '--arm64']]) {
    const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/package.cjs'), ...args], { encoding: 'utf8' });
    assert.match(result.stderr, /Unsupported target/);
  }
});

test('configure refuses an unsafe installation before loading the scoped policy', t => {
  for (const options of [{ owner: 1001 }, { mode: '777' }, { mode: '775' }, { mode: '4755' }, { symlink: true }]) {
    const result = lifecycle(t, 'postinst', 'configure', options);
    assert.notEqual(result.status, 0); assert.equal(result.calls, '');
    assert.match(result.stderr, /Unsafe Qingdan installation/);
  }
});
