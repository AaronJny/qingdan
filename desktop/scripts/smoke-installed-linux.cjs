'use strict';
// Run inside an Ubuntu 24.04 desktop/VM as an ordinary user, for example under
// xvfb-run. This observes the installed product; it never installs or loads a
// policy, changes a fuse, enables a debug protocol, or injects product code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const EXECUTABLE = '/usr/lib/qingdan/qingdan';
const PREFIX = 'qingdan-installed-linux-smoke-';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function parseArgs(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    assert(['--report', '--timeout-ms', '--executable'].includes(key) && value && !value.startsWith('--') && !Object.hasOwn(values, key), 'Use unique --report, --timeout-ms and fixed --executable options only.');
    values[key] = value;
  }
  const timeoutMs = Number(values['--timeout-ms'] || 45000);
  assert(Number.isInteger(timeoutMs) && timeoutMs >= 5000 && timeoutMs <= 120000, 'Startup timeout must be 5000–120000 ms.');
  const executable = values['--executable'] || EXECUTABLE;
  assert([EXECUTABLE, '/usr/bin/qingdan'].includes(executable), 'Only the fixed installed Qingdan entrypoints are supported.');
  return { executable, timeoutMs, report: values['--report'] ? path.resolve(values['--report']) : undefined };
}

function fixtureEnvironment(fixture, inherited) {
  // An allowlist avoids real account tokens, private backend configuration,
  // DBus/session handles, Node/Electron overrides, and dynamic-loader injection.
  const env = { PATH: '/usr/bin:/bin', LANG: inherited.LANG || 'C.UTF-8' };
  for (const key of ['DISPLAY', 'XAUTHORITY', 'TZ', 'LC_ALL']) if (inherited[key]) env[key] = inherited[key];
  Object.assign(env, { HOME: fixture, USERPROFILE: fixture,
    XDG_CONFIG_HOME: path.join(fixture, 'config'), XDG_CACHE_HOME: path.join(fixture, 'cache'),
    XDG_DATA_HOME: path.join(fixture, 'data'), XDG_STATE_HOME: path.join(fixture, 'state'),
    XDG_RUNTIME_DIR: path.join(fixture, 'runtime'), TMPDIR: path.join(fixture, 'tmp'),
    XDG_SESSION_TYPE: 'x11', DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(fixture, 'no-session-bus')}` });
  for (const key of ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR', 'TMPDIR']) fs.mkdirSync(env[key], { mode: 0o700 });
  return env;
}

function parseOsRelease(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter(line => /^[A-Z_]+=/u.test(line)).map(line => {
    const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/gu, '')];
  }));
}
function assertHost({ platform, arch, uid, euid, osRelease, appArmorEnabled, restrictedUserns }) {
  assert.equal(platform, 'linux', 'This smoke requires Linux.');
  assert.equal(arch, 'x64', 'This package targets x64.');
  assert(Number.isInteger(uid) && uid > 0 && uid === euid, 'Launch as an ordinary user, never root or a changed effective user.');
  const release = parseOsRelease(osRelease);
  assert.equal(release.ID, 'ubuntu', 'Native Ubuntu 24.04 validation is required.');
  assert.equal(release.VERSION_ID, '24.04', 'Native Ubuntu 24.04 validation is required.');
  assert.equal(appArmorEnabled.trim(), 'Y', 'AppArmor must already be enabled. This script does not enable it.');
  assert.equal(restrictedUserns.trim(), '1', 'Ubuntu user-namespace restrictions must already be enabled. This script does not change them.');
  return { id: release.ID, version: release.VERSION_ID, arch, uid, appArmorEnabled: true, restrictedUnprivilegedUserns: true };
}
function assertInstalledFiles(executable) {
  for (const file of ['/usr', '/usr/lib', '/usr/bin', '/usr/lib/qingdan', EXECUTABLE, '/usr/lib/qingdan/AppRun', '/usr/lib/qingdan/chrome-sandbox', '/usr/lib/qingdan/resources', '/usr/lib/qingdan/resources/app.asar']) {
    const stat = fs.lstatSync(file);
    assert(!stat.isSymbolicLink(), `Installed path must not be a symlink: ${file}`);
    assert.equal(stat.uid, 0, `Installed path must be root owned: ${file}`);
    assert.equal(stat.mode & 0o022, 0, `Installed path must not be group/world writable: ${file}`);
    assert.equal(stat.mode & 0o6000, 0, `Installed path must not have setuid/setgid bits: ${file}`);
    assert(file.endsWith('app.asar') || file === EXECUTABLE || file.endsWith('chrome-sandbox') || file.endsWith('AppRun') ? stat.isFile() : stat.isDirectory(), `Unexpected installed path type: ${file}`);
    if (file === EXECUTABLE || file.endsWith('chrome-sandbox')) assert(stat.mode & 0o111, `Installed executable is not executable: ${file}`);
  }
  if (executable === '/usr/bin/qingdan') {
    assert(fs.lstatSync(executable).isSymbolicLink(), 'The packaged command must be its expected symlink.');
    assert.equal(fs.realpathSync(executable), '/usr/lib/qingdan/AppRun', 'The packaged command must resolve to the sandbox-preserving launcher.');
  }
}

function parseProcStat(text) {
  const match = /^(\d+) \((.*)\) (.+)$/su.exec(text.trim());
  assert(match, 'Invalid /proc stat.');
  const fields = match[3].split(/\s+/u);
  assert(fields.length >= 20 && /^\d+$/u.test(fields[19]), 'Truncated /proc stat.');
  const record = { pid: Number(match[1]), state: fields[0], ppid: Number(fields[1]), pgrp: Number(fields[2]), session: Number(fields[3]), startTime: fields[19] };
  for (const key of ['pid', 'ppid', 'pgrp', 'session']) assert(Number.isSafeInteger(record[key]) && record[key] >= 0, 'Invalid /proc process identifier.');
  return record;
}
function parseStatus(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z_]+):\s*(.*)$/u.exec(line);
    if (match) { assert(!Object.hasOwn(result, match[1]), 'Duplicate /proc status field.'); result[match[1]] = match[2].trim(); }
  }
  return result;
}
function parseUidMap(text) {
  const lines = text.trim().split('\n');
  assert(text.trim() && lines.length <= 340, 'Missing or oversized user namespace mapping.');
  return lines.map(line => {
    assert(/^\s*\d+\s+\d+\s+\d+\s*$/u.test(line), 'Invalid user namespace mapping.');
    const row = line.trim().split(/\s+/u).map(Number);
    assert(row.every(value => Number.isSafeInteger(value) && value >= 0) && row[2] > 0, 'Invalid user namespace extent.');
    return row;
  });
}
function isRendererCommandLine(text) {
  if (typeof text !== 'string' || !text || text.length > 128 * 1024) return false;
  // Chromium's SetProcessTitleFromCommandLine flattens Linux argv into one
  // space-separated title. Accept that kernel-visible form as well as ordinary
  // NUL-separated argv. Identification still requires ancestry from our child;
  // the separate /proc checks, not this title, establish sandbox evidence.
  // https://chromium.googlesource.com/chromium/src/+/HEAD/base/process/set_process_title.cc
  const entries = text.replace(/\0+$/u, '').split('\0');
  let args;
  if (entries[0] === EXECUTABLE) args = entries.slice(1);
  else if (entries.length === 1 && entries[0].startsWith(`${EXECUTABLE} `)) args = entries[0].slice(EXECUTABLE.length + 1).split(' ').filter(Boolean);
  else return false;
  const types = args.filter(arg => arg.startsWith('--type='));
  return types.length === 1 && types[0] === '--type=renderer';
}
function descendants(records, rootPid) {
  const selected = new Set([rootPid]); let changed = true;
  while (changed) {
    changed = false;
    for (const item of records) if (selected.has(item.ppid) && !selected.has(item.pid)) { selected.add(item.pid); changed = true; }
  }
  return records.filter(item => selected.has(item.pid));
}
function processSnapshot() {
  const result = [];
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/u.test(name)) continue;
    try { result.push(parseProcStat(fs.readFileSync(`/proc/${name}/stat`, 'utf8'))); }
    catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) throw error; }
  }
  return result;
}
function namespaceEvidence(pid) {
  const result = {};
  for (const [key, operation] of [
    ['userNamespace', () => fs.readlinkSync(`/proc/${pid}/ns/user`)],
    ['uidMap', () => parseUidMap(fs.readFileSync(`/proc/${pid}/uid_map`, 'utf8'))],
  ]) {
    try { result[key] = operation(); }
    catch (error) { result[`${key}Unavailable`] = error.code || error.message; }
  }
  return result;
}
function proveRenderer({ pid, status, namespaces }, baseline, uid) {
  assert.equal(status.Seccomp, '2', `Renderer ${pid}: seccomp filtering was not observed.`);
  assert.equal(status.NoNewPrivs, '1', `Renderer ${pid}: no-new-privileges was not observed.`);
  const uids = (status.Uid || '').split(/\s+/u).map(Number);
  assert(uids.length === 4 && uids.every(value => value === uid), `Renderer ${pid}: unexpected host user identity.`);
  let userNamespaceProof;
  if (namespaces.userNamespace && baseline.userNamespace) {
    assert.notEqual(namespaces.userNamespace, baseline.userNamespace, `Renderer ${pid}: user namespace matches the ordinary launcher.`);
    userNamespaceProof = 'distinct namespace identifiers';
  } else if (namespaces.uidMap && baseline.uidMap) {
    assert.notDeepEqual(namespaces.uidMap, baseline.uidMap, `Renderer ${pid}: UID map matches the ordinary launcher.`);
    assert(namespaces.uidMap.every(row => row[2] < 4294967295), `Renderer ${pid}: unrestricted UID map.`);
    userNamespaceProof = 'distinct readable UID maps (namespace identifier unavailable)';
  } else {
    throw Error(`Renderer ${pid}: user namespace evidence is unavailable (${JSON.stringify(namespaces)}). No sandbox pass can be claimed.`);
  }
  return { pid, seccomp: 2, noNewPrivs: 1, hostUids: uids, userNamespaceProof, ...namespaces };
}
function assessStartupSample({ window, renderers, rendererErrors }, stableSince, now) {
  // A renderer's process title can appear before sandbox initialization finishes.
  // Any incomplete/failed proof resets stability; it can never be counted as a
  // pass alongside a different, already sandboxed renderer.
  const complete = Boolean(window) && renderers.length > 0 && rendererErrors.length === 0;
  const since = complete ? stableSince || now : 0;
  return { stableSince: since, ready: complete && now - since >= 2000,
    observation: `viewable product window=${Boolean(window)}, proven renderers=${renderers.length}, pending renderer proofs=${rendererErrors.length}${rendererErrors.length ? `: ${rendererErrors.map(item => `${item.pid}: ${item.message}`).join('; ').slice(0, 2000)}` : ''}` };
}

function windowIds(tree) {
  const ids = [...new Set([...tree.matchAll(/^\s*(0x[0-9a-f]+)\s+/gimu)].map(match => match[1]))];
  assert(ids.length <= 256, 'Too many X11 windows to inspect within the bounded smoke.');
  return ids;
}
function parseWindow(id, properties, info, pid) {
  const owner = /(?:^|\n)_NET_WM_PID\(CARDINAL\)\s*=\s*(\d+)\s*(?:\n|$)/u.exec(properties);
  const classes = /(?:^|\n)WM_CLASS\(STRING\)\s*=\s*(.*)/u.exec(properties)?.[1];
  if (Number(owner?.[1]) !== pid || !classes || !/"qingdan"/iu.test(classes)) return null;
  if (!/^\s*Map State:\s*IsViewable\s*$/mu.test(info)) return null;
  const width = Number(/^\s*Width:\s*(\d+)\s*$/mu.exec(info)?.[1]);
  const height = Number(/^\s*Height:\s*(\d+)\s*$/mu.exec(info)?.[1]);
  if (!(width >= 100 && height >= 100)) return null;
  return { id, pid, wmClass: classes, mapState: 'IsViewable', width, height };
}
function x11(command, args, env, deadline) {
  const timeout = Math.min(1500, deadline - Date.now());
  assert(timeout > 0, 'GUI startup deadline expired.');
  const result = spawnSync(command, args, { env: { ...env, LC_ALL: 'C' }, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${path.basename(command)} failed: ${(result.stderr || '').slice(-1000)}`);
  return result.stdout;
}
function visibleWindow(pid, env, deadline) {
  const ids = windowIds(x11('/usr/bin/xwininfo', ['-root', '-tree'], env, deadline));
  for (const id of ids) {
    let properties;
    try { properties = x11('/usr/bin/xprop', ['-id', id, '_NET_WM_PID', 'WM_CLASS'], env, deadline); }
    catch (error) { if (/BadWindow|No such window/u.test(error.message)) continue; throw error; }
    if (!new RegExp(`_NET_WM_PID\\(CARDINAL\\)\\s*=\\s*${pid}(?:\\s|$)`, 'u').test(properties)) continue;
    let info;
    try { info = x11('/usr/bin/xwininfo', ['-id', id], env, deadline); }
    catch (error) { if (/BadWindow|No such window/u.test(error.message)) continue; throw error; }
    const evidence = parseWindow(id, properties, info, pid);
    if (evidence) return evidence;
  }
  return null;
}

async function stopOwnedGroup(child, identity, observed = []) {
  if (!child?.pid || !identity) return { completed: true, launchedProcess: false };
  const owned = new Map([[identity.pid, identity.startTime], ...observed.map(item => [item.pid, item.startTime])]); const signals = [];
  function completion() {
    const unverified = processSnapshot().filter(item => item.session === child.pid && !['Z', 'X'].includes(item.state));
    return unverified.length ? { completed: false, signals, unverifiedSessionPids: unverified.map(item => item.pid) } : { completed: true, signals };
  }
  function alive() {
    const snapshot = processSnapshot();
    // A surviving known member anchors the detached session. Never signal a
    // recycled process group after all of our observed members have vanished.
    const anchor = snapshot.some(item => owned.get(item.pid) === item.startTime && item.session === child.pid);
    if (anchor) for (const item of snapshot) if (item.session === child.pid) owned.set(item.pid, item.startTime);
    for (const item of snapshot) if (owned.get(item.pid) === item.startTime) {
      for (const descendant of descendants(snapshot, item.pid)) owned.set(descendant.pid, descendant.startTime);
    }
    return snapshot.filter(item => owned.get(item.pid) === item.startTime && !['Z', 'X'].includes(item.state));
  }
  for (const [signal, duration] of [['SIGTERM', 3500], ['SIGKILL', 2000]]) {
    const members = alive();
    if (!members.length) return completion();
    // Individual identities also cover children that formed another process
    // group within this smoke's session, without touching another application.
    for (const item of members) {
      try {
        const current = parseProcStat(fs.readFileSync(`/proc/${item.pid}/stat`, 'utf8'));
        if (current.startTime === item.startTime) process.kill(item.pid, signal);
      } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
    }
    signals.push(signal);
    const deadline = Date.now() + duration;
    while (Date.now() < deadline) { if (!alive().length) return completion(); await delay(100); }
  }
  return { completed: false, signals, remainingPids: alive().map(item => item.pid) };
}

async function runSmoke(options) {
  const report = { schema: 'qingdan-installed-linux-gui-smoke-v1', passed: false, executable: options.executable || EXECUTABLE, productExecutable: EXECUTABLE,
    nativeGuiStartupPassed: false, fullFunctionalUiTested: false, windowContentInspected: false,
    mcpTested: false, productInstrumentationUsed: false, debuggingProtocolUsed: false,
    hostSecurityChanged: false, realUserProfileAccessed: false,
    limitations: ['A mapped X11 product window is startup evidence, not proof of the workbench contents or task editing.',
      'Observed seccomp, no-new-privileges and user namespace isolation do not audit every Chromium sandbox rule.',
      'MCP and real desktop compositor/GPU behavior need separate validation.'] };
  let fixture, child, identity, spawnError, output = '', startupError;
  const observed = new Map();
  try {
    report.host = assertHost({ platform: process.platform, arch: process.arch, uid: process.getuid?.(), euid: process.geteuid?.(),
      osRelease: fs.readFileSync('/etc/os-release', 'utf8'), appArmorEnabled: fs.readFileSync('/sys/module/apparmor/parameters/enabled', 'utf8'),
      restrictedUserns: fs.readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8') });
    report.host.kernel = os.release();
    assert(process.env.DISPLAY, 'Provide an X11 DISPLAY, for example with xvfb-run.');
    assertInstalledFiles(report.executable);
    for (const file of ['/usr/bin/xwininfo', '/usr/bin/xprop']) fs.accessSync(file, fs.constants.X_OK);
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
    const env = fixtureEnvironment(fixture, process.env);
    const baseline = namespaceEvidence('self'); report.launcherNamespaces = baseline;
    const args = [`--user-data-dir=${path.join(fixture, 'electron-user-data')}`, '--ozone-platform=x11'];
    child = spawn(report.executable, args, { cwd: fixture, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', error => { spawnError = error; });
    const collect = bytes => { output = (output + bytes.toString()).slice(-16384); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    identity = parseProcStat(fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8'));
    assert.equal(identity.session, child.pid, 'The launched product must have its own cleanup session.');
    report.productPid = child.pid;
    const deadline = Date.now() + options.timeoutMs; let stableSince = 0, lastObservation = 'No product window observed.';
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      assert(child.exitCode === null && child.signalCode === null, `Product exited during startup (exit=${child.exitCode}, signal=${child.signalCode}).`);
      const window = visibleWindow(child.pid, env, deadline);
      const snapshot = processSnapshot();
      const records = descendants(snapshot, child.pid);
      for (const item of snapshot) if (item.session === child.pid || records.includes(item)) observed.set(item.pid, item);
      const renderers = [], rendererErrors = [];
      for (const item of records) {
        let rendererIdentified = false;
        try {
          const cmdline = fs.readFileSync(`/proc/${item.pid}/cmdline`, 'utf8');
          if (!isRendererCommandLine(cmdline)) continue;
          rendererIdentified = true;
          const status = parseStatus(fs.readFileSync(`/proc/${item.pid}/status`, 'utf8'));
          renderers.push(proveRenderer({ pid: item.pid, status, namespaces: namespaceEvidence(item.pid) }, baseline, report.host.uid));
        } catch (error) {
          if (['ENOENT', 'ESRCH'].includes(error.code)) continue;
          if (!rendererIdentified) throw error;
          rendererErrors.push({ pid: item.pid, code: error.code || 'RENDERER_PROOF_PENDING', message: error.message });
        }
      }
      const sample = assessStartupSample({ window, renderers, rendererErrors }, stableSince, Date.now());
      stableSince = sample.stableSince; lastObservation = sample.observation;
      report.lastStartupObservation = { window, provenRendererPids: renderers.map(item => item.pid), rendererErrors };
      if (sample.ready) {
        report.window = window; report.renderers = renderers;
        report.nativeGuiStartupPassed = true; break;
      }
      await delay(200);
    }
    assert(report.nativeGuiStartupPassed, `GUI startup timed out: ${lastObservation}`);
  } catch (error) { startupError = error; report.error = { code: error.code || 'INSTALLED_GUI_SMOKE_FAILED', message: error.message }; }
  finally {
    try {
      // A failed /proc identity read after spawn must not leak the direct child.
      if (child?.pid && !identity) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        const deadline = Date.now() + 2000;
        while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await delay(50);
        // Without a verified session identity, descendant cleanup is uncertain.
        report.cleanup = { completed: false, directChildExited: child.exitCode !== null || child.signalCode !== null, error: 'Could not establish a process identity for complete descendant cleanup.' };
      } else report.cleanup = await stopOwnedGroup(child, identity, [...observed.values()]);
      if (fixture && report.cleanup.completed) { fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); report.cleanup.syntheticDirectoriesRemoved = true; }
      else if (fixture) report.cleanup.retainedSyntheticDirectory = fixture;
    } catch (error) { report.cleanup = { completed: false, error: error.message, retainedSyntheticDirectory: fixture }; }
    // An uncertain descendant cleanup must be reported, not keep this verifier
    // alive indefinitely through inherited output pipes.
    child?.stdout?.destroy(); child?.stderr?.destroy(); child?.unref();
  }
  report.passed = !startupError && report.nativeGuiStartupPassed && report.cleanup.completed;
  if (!report.passed) report.productOutputTail = output;
  if (options.report) fs.writeFileSync(options.report, JSON.stringify(report, null, 2) + '\n');
  return report;
}

module.exports = { EXECUTABLE, parseArgs, fixtureEnvironment, parseOsRelease, assertHost, parseProcStat, parseStatus, parseUidMap, isRendererCommandLine, descendants, namespaceEvidence, proveRenderer, assessStartupSample, windowIds, parseWindow, stopOwnedGroup, runSmoke };
if (require.main === module) {
  Promise.resolve().then(() => runSmoke(parseArgs(process.argv.slice(2)))).then(report => {
    console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1;
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
