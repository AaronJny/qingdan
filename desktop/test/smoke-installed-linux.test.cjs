'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const smoke = require('../scripts/smoke-installed-linux.cjs');

test('Linux desktop identity matches the installed entry and strict GUI window class', () => {
  const metadata = require('../package.json');
  assert.equal(metadata.desktopName, 'qingdan.desktop');
  assert.equal(require('../builder.config.cjs').linux.executableName, 'qingdan');
  const entry = fs.readFileSync(path.join(__dirname, '../packaging/linux', metadata.desktopName), 'utf8');
  assert.match(entry, /^StartupWMClass=qingdan$/mu);
  assert.match(entry, /^Exec=\/usr\/lib\/qingdan\/AppRun %U$/mu);
  const properties = `_NET_WM_PID(CARDINAL) = 100\nWM_CLASS(STRING) = "${metadata.desktopName.slice(0, -8)}", "Qingdan"\n`;
  assert(smoke.parseWindow('0x400003', properties, 'Width: 960\nHeight: 760\nMap State: IsViewable\n', 100));
});

test('installed GUI smoke only accepts its fixed product and bounded runtime options', () => {
  assert.equal(smoke.EXECUTABLE, '/usr/lib/qingdan/qingdan');
  assert.equal(smoke.parseArgs([]).timeoutMs, 45000);
  assert.equal(smoke.parseArgs(['--executable', '/usr/bin/qingdan']).executable, '/usr/bin/qingdan');
  assert.equal(smoke.parseArgs(['--timeout-ms', '5000', '--report', 'out.json']).report, path.resolve('out.json'));
  for (const args of [
    ['--executable', '/tmp/product'], ['--no-sandbox'], ['--report'], ['--report', '--report'],
    ['--report', 'a', '--report', 'b'], ['--timeout-ms', '4999'], ['--timeout-ms', '120001'],
    ['--timeout-ms', 'NaN'], ['--timeout-ms', '5000.5'], ['--remote-debugging-port', '9000'],
  ]) assert.throws(() => smoke.parseArgs(args));
});

test('GUI smoke isolates all writable profile locations and excludes credentials and injection variables', t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-installed-env-test-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const source = { HOME: '/real', DISPLAY: ':77', XAUTHORITY: '/tmp/synthetic-Xauthority', LANG: 'zh_CN.UTF-8',
    QINGDAN_AGENT_TOKEN: 'do-not-copy', NODE_OPTIONS: '--inspect', ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_SANDBOX: '1', CHROME_DEVEL_SANDBOX: '/other', LD_PRELOAD: '/other', LD_LIBRARY_PATH: '/other',
    DBUS_SESSION_BUS_ADDRESS: '/real-bus', XDG_RUNTIME_DIR: '/real-runtime', HTTPS_PROXY: '/proxy', WAYLAND_DISPLAY: 'real-wayland' };
  const env = smoke.fixtureEnvironment(fixture, source);
  assert.equal(env.HOME, fixture); assert.equal(env.USERPROFILE, fixture);
  assert.equal(env.DISPLAY, ':77'); assert.equal(env.XAUTHORITY, source.XAUTHORITY);
  assert.equal(env.PATH, '/usr/bin:/bin'); assert.equal(env.XDG_SESSION_TYPE, 'x11');
  assert.equal(env.DBUS_SESSION_BUS_ADDRESS, `unix:path=${fixture}/no-session-bus`);
  for (const key of ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR', 'TMPDIR']) {
    assert(env[key].startsWith(fixture + path.sep));
    assert(fs.statSync(env[key]).isDirectory());
    // Windows does not implement POSIX chmod bits. Keep all path/environment
    // assertions there and verify owner-only directory modes on Unix hosts.
    if (process.platform !== 'win32') assert.equal(fs.statSync(env[key]).mode & 0o777, 0o700);
  }
  for (const key of ['QINGDAN_AGENT_TOKEN', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_SANDBOX', 'CHROME_DEVEL_SANDBOX', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'HTTPS_PROXY', 'WAYLAND_DISPLAY']) assert.equal(env[key], undefined, key);
  assert.equal(source.HOME, '/real', 'The caller environment is not mutated.');
});

const host = { platform: 'linux', arch: 'x64', uid: 1000, euid: 1000, osRelease: 'ID=ubuntu\nVERSION_ID="24.04"\n', appArmorEnabled: 'Y\n', restrictedUserns: '1\n' };
test('native Ubuntu validation refuses root, other distros, and disabled host restrictions', () => {
  assert.deepEqual(smoke.assertHost(host), { id: 'ubuntu', version: '24.04', arch: 'x64', uid: 1000, appArmorEnabled: true, restrictedUnprivilegedUserns: true });
  for (const change of [
    { platform: 'darwin' }, { arch: 'arm64' }, { uid: 0, euid: 0 }, { euid: 0 },
    { osRelease: 'ID=debian\nVERSION_ID="13"' }, { osRelease: 'ID=ubuntu\nVERSION_ID="22.04"' },
    { appArmorEnabled: 'N' }, { restrictedUserns: '0' },
  ]) assert.throws(() => smoke.assertHost({ ...host, ...change }));
});

function statLine({ pid = 100, name = 'qingdan', ppid = 50, pgrp = 100, session = 100, start = '12345', state = 'S' } = {}) {
  return `${pid} (${name}) ${[state, ppid, pgrp, session, ...Array(15).fill(0), start, 0, 0].join(' ')}\n`;
}
test('/proc stat parsing handles spaces and parentheses without shifting identity fields', () => {
  assert.deepEqual(smoke.parseProcStat(statLine({ name: 'a ( tricky ) name' })), { pid: 100, state: 'S', ppid: 50, pgrp: 100, session: 100, startTime: '12345' });
  assert.throws(() => smoke.parseProcStat('100 (short) S 50'));
  assert.throws(() => smoke.parseProcStat('garbage'));
});
test('process ancestry excludes unrelated renderers and does not loop on malformed cycles', () => {
  const records = [{ pid: 1, ppid: 0 }, { pid: 20, ppid: 1 }, { pid: 30, ppid: 20 }, { pid: 40, ppid: 30 }, { pid: 50, ppid: 1 }, { pid: 60, ppid: 61 }, { pid: 61, ppid: 60 }];
  assert.deepEqual(smoke.descendants(records, 20).map(item => item.pid), [20, 30, 40]);
});
test('status and user namespace mappings are parsed strictly', () => {
  assert.deepEqual(smoke.parseStatus('Name:\tqingdan\nUid:\t1000\t1000\t1000\t1000\nNoNewPrivs:\t1\nSeccomp:\t2\n'), { Name: 'qingdan', Uid: '1000\t1000\t1000\t1000', NoNewPrivs: '1', Seccomp: '2' });
  assert.throws(() => smoke.parseStatus('Seccomp: 2\nSeccomp: 0'));
  assert.deepEqual(smoke.parseUidMap('         0       1000          1\n'), [[0, 1000, 1]]);
  for (const value of ['', '0 0', '0 0 0', '-1 0 1', '0 nope 1', '0 0 9007199254740992']) assert.throws(() => smoke.parseUidMap(value));
});

test('renderer identification accepts Chromium flattened process titles and ordinary argv', () => {
  const binary = smoke.EXECUTABLE;
  for (const command of [
    `${binary}\0--type=renderer\0--lang=en-US\0`,
    `${binary}\0--lang=en-US\0--type=renderer\0\0`,
    `${binary} --type=renderer --lang=en-US\0`,
    `${binary} --lang=en-US --type=renderer`,
    `${binary}  --type=renderer  --user-data-dir=/tmp/synthetic fixture\0\0`,
  ]) assert.equal(smoke.isRendererCommandLine(command), true, JSON.stringify(command));
});
test('renderer identification rejects other binaries, substring lookalikes and conflicting process types', () => {
  const binary = smoke.EXECUTABLE;
  for (const command of [
    '', null, binary, `${binary}\0`,
    `/tmp/qingdan --type=renderer\0`, `${binary}.other --type=renderer\0`,
    `${binary}/other --type=renderer\0`, `prefix ${binary} --type=renderer\0`,
    `${binary} --type=renderer-extra\0`, `${binary}\0--type=renderer-extra\0`,
    `${binary} --type=utility --note=--type=renderer\0`,
    `${binary}\0--note=--type=renderer\0`, `${binary}\0--note=some --type=renderer\0`,
    `${binary} --type=renderer --type=utility\0`, `${binary}\0--type=renderer\0--type=utility\0`,
    `${binary} --type=renderer --type=renderer\0`,
    `${binary}\t--type=renderer\0`, `${binary} --type=renderer\n--lang=en-US\0`,
    `${binary} --type=renderer\0unexpected-second-entry\0`,
  ]) assert.equal(smoke.isRendererCommandLine(command), false, JSON.stringify(command));
});

const baseline = { userNamespace: 'user:[4026531837]', uidMap: [[0, 0, 4294967295]] };
const renderer = { pid: 42, status: { Seccomp: '2', NoNewPrivs: '1', Uid: '1000\t1000\t1000\t1000' }, namespaces: { userNamespace: 'user:[4026533000]', uidMap: [[0, 1000, 1]] } };
test('renderer proof requires kernel-observed filtering, no-new-privileges, identity, and a distinct namespace', () => {
  const proof = smoke.proveRenderer(renderer, baseline, 1000);
  assert.equal(proof.seccomp, 2); assert.equal(proof.noNewPrivs, 1);
  assert.equal(proof.userNamespaceProof, 'distinct namespace identifiers');
  for (const status of [{ Seccomp: '0' }, { Seccomp: '1' }, { NoNewPrivs: '0' }, { Uid: '0 0 0 0' }, { Uid: '1000 1000' }]) {
    assert.throws(() => smoke.proveRenderer({ ...renderer, status: { ...renderer.status, ...status } }, baseline, 1000));
  }
  assert.throws(() => smoke.proveRenderer({ ...renderer, namespaces: baseline }, baseline, 1000), /matches the ordinary launcher/);
});
test('restricted namespace-link access uses explicit UID-map evidence, never a silent pass', () => {
  const namespaces = { userNamespaceUnavailable: 'EACCES', uidMap: [[0, 1000, 1]] };
  assert.match(smoke.proveRenderer({ ...renderer, namespaces }, baseline, 1000).userNamespaceProof, /namespace identifier unavailable/);
  assert.throws(() => smoke.proveRenderer({ ...renderer, namespaces: { userNamespaceUnavailable: 'EACCES', uidMapUnavailable: 'EACCES' } }, baseline, 1000), /evidence is unavailable/);
  assert.throws(() => smoke.proveRenderer({ ...renderer, namespaces: { uidMap: baseline.uidMap } }, baseline, 1000), /UID map matches/);
  assert.throws(() => smoke.proveRenderer({ ...renderer, namespaces: { uidMap: [[1, 1, 4294967295]] } }, baseline, 1000), /unrestricted UID map/);
});

test('pending renderer sandbox initialization resets the full stable-startup period', () => {
  const good = { window: { id: '0x400003' }, renderers: [{ pid: 42 }], rendererErrors: [] };
  let sample = smoke.assessStartupSample(good, 0, 1000);
  assert.equal(sample.stableSince, 1000); assert.equal(sample.ready, false);
  sample = smoke.assessStartupSample(good, sample.stableSince, 2999);
  assert.equal(sample.ready, false);
  const pending = { ...good, rendererErrors: [{ pid: 43, message: 'seccomp filtering was not observed' }] };
  sample = smoke.assessStartupSample(pending, sample.stableSince, 3000);
  assert.equal(sample.ready, false); assert.equal(sample.stableSince, 0);
  assert.match(sample.observation, /43: seccomp filtering was not observed/);
  sample = smoke.assessStartupSample(good, sample.stableSince, 3200);
  assert.equal(sample.ready, false); assert.equal(sample.stableSince, 3200);
  assert.equal(smoke.assessStartupSample(good, sample.stableSince, 5199).ready, false);
  assert.equal(smoke.assessStartupSample(good, sample.stableSince, 5200).ready, true);
});
test('no window, no renderer or any failed renderer can never satisfy startup stability', () => {
  const good = { window: { id: '0x400003' }, renderers: [{ pid: 42 }, { pid: 43 }], rendererErrors: [] };
  for (const sample of [
    { ...good, window: null }, { ...good, renderers: [] },
    { ...good, rendererErrors: [{ pid: 44, message: 'user namespace evidence is unavailable' }] },
    { ...good, rendererErrors: [{ pid: 42, message: 'Seccomp=0' }, { pid: 43, message: 'NoNewPrivs=0' }] },
  ]) {
    const result = smoke.assessStartupSample(sample, 1000, 50000);
    assert.equal(result.ready, false); assert.equal(result.stableSince, 0);
  }
  assert.equal(smoke.assessStartupSample(good, 1000, 50000).ready, true);
});

test('X11 parser only accepts a mapped product-class window owned by this launched PID', () => {
  const properties = '_NET_WM_PID(CARDINAL) = 100\nWM_CLASS(STRING) = "qingdan", "Qingdan"\n';
  const info = '  Width: 960\n  Height: 760\n  Map State: IsViewable\n';
  assert.deepEqual(smoke.parseWindow('0x400003', properties, info, 100), { id: '0x400003', pid: 100, wmClass: '"qingdan", "Qingdan"', mapState: 'IsViewable', width: 960, height: 760 });
  assert.equal(smoke.parseWindow('0x400003', properties, info, 101), null);
  assert.equal(smoke.parseWindow('0x400003', properties.replaceAll('qingdan', 'other').replaceAll('Qingdan', 'Other'), info, 100), null);
  assert.equal(smoke.parseWindow('0x400003', properties, info.replace('IsViewable', 'IsUnMapped'), 100), null);
  assert.equal(smoke.parseWindow('0x400003', properties, info.replace('960', '1'), 100), null);
  assert.equal(smoke.parseWindow('0x400003', 'WM_CLASS(STRING) = "qingdan"', info, 100), null);
  assert.deepEqual(smoke.windowIds('xwininfo: Window id: 0x500\n  0x400003 "Qingdan": (...)\n  0x400004 (has no name): (...)\n  0x400003 duplicate\n'), ['0x400003', '0x400004']);
  assert.throws(() => smoke.windowIds(Array.from({ length: 257 }, (_, i) => `  0x${i.toString(16)} window`).join('\n')), /Too many/);
});

test('cleanup terminates its own detached process without touching a separate process', { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
  const launch = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  const target = launch(), other = launch();
  t.after(() => { for (const child of [target, other]) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await Promise.all([once(target, 'spawn'), once(other, 'spawn')]);
  const identity = smoke.parseProcStat(fs.readFileSync(`/proc/${target.pid}/stat`, 'utf8'));
  const result = await smoke.stopOwnedGroup(target, identity);
  assert.equal(result.completed, true); assert(result.signals.includes('SIGTERM'));
  assert.equal(other.exitCode, null); assert.equal(other.signalCode, null); process.kill(other.pid, 0);
});

test('cleanup refuses a PID whose start time no longer matches the launched identity', { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await once(child, 'spawn');
  const identity = smoke.parseProcStat(fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8'));
  const result = await smoke.stopOwnedGroup(child, { ...identity, startTime: 'not-the-original-start-time' });
  assert.equal(result.completed, false); assert.deepEqual(result.signals, []); assert.deepEqual(result.unverifiedSessionPids, [child.pid]); process.kill(child.pid, 0);
});

test('cleanup includes an observed descendant after the original process exits', { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
  const child = spawn(process.execPath, ['-e', `
    const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    console.log(c.pid); c.unref(); setTimeout(() => process.exit(0), 100);
  `], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  await once(child, 'spawn');
  const identity = smoke.parseProcStat(fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8'));
  const [chunk] = await once(child.stdout, 'data'), descendantPid = Number(chunk.toString().trim());
  t.after(() => { try { process.kill(descendantPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } });
  const descendant = smoke.parseProcStat(fs.readFileSync(`/proc/${descendantPid}/stat`, 'utf8'));
  await once(child, 'exit');
  const result = await smoke.stopOwnedGroup(child, identity, [descendant]);
  assert.equal(result.completed, true); assert(result.signals.includes('SIGTERM'));
});
