'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const plist = require('plist');
const verifier = require('../scripts/verify-desktop-archives.cjs');
const root = path.resolve(__dirname, '..');
const helpers = ['', ' (GPU)', ' (Plugin)', ' (Renderer)'];
const windows = process.platform === 'win32';
if (windows) {
  // Windows cannot express POSIX execute modes. Simulate that one metadata
  // field on MacOS fixture executables so real byte/identity tests still run.
  const originalLstat = fs.lstatSync;
  test.mock.method(fs, 'lstatSync', function(file, ...args) {
    const value = originalLstat.call(fs, file, ...args);
    if ((String(file).includes('qingdan-artifact-unit-') || String(file).includes('qingdan-archive-verify-')) && String(file).includes(path.sep + 'MacOS' + path.sep) && value.isFile()) value.mode |= 0o111;
    return value;
  });
}
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-artifact-unit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function put(directory, name, data = 'fixture', mode = 0o644) {
  const file = path.join(directory, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data, { mode }); return file;
}
function macFixture(directory) {
  const app = path.join(directory, '青单.app'), version = '1.2.3';
  put(app, 'Contents/Info.plist', plist.build({ CFBundleName: '青单', CFBundleDisplayName: '青单',
    CFBundleExecutable: '青单', CFBundleIdentifier: 'app.qingdan.desktop', CFBundleVersion: version,
    CFBundleShortVersionString: version, LSMinimumSystemVersion: '13.0', CFBundleIconFile: 'icon.icns' }));
  put(app, 'Contents/MacOS/青单', 'main executable', 0o755);
  put(app, 'Contents/Resources/app.asar');
  put(app, 'Contents/Resources/icon.icns', fs.readFileSync(path.join(root, 'build/icon.icns')));
  for (const notice of ['LICENSE.electron.txt', 'LICENSES.chromium.html']) put(app, 'Contents/Resources/' + notice);
  for (const suffix of helpers) {
    const name = 'Electron Helper' + suffix, base = 'Contents/Frameworks/' + name + '.app/Contents/';
    put(app, base + 'Info.plist', plist.build({ CFBundleName: name, CFBundleDisplayName: '青单辅助程序',
      CFBundleExecutable: name, CFBundleIdentifier: 'app.qingdan.desktop.helper' + (suffix ? '.' + suffix.trim().replace(/[()]/g, '') : '') }));
    put(app, base + 'MacOS/' + name, 'helper executable', 0o755);
  }
  put(app, 'Contents/Frameworks/Runtime.framework/Versions/A/Runtime');
  if (!windows) {
    fs.symlinkSync('A', path.join(app, 'Contents/Frameworks/Runtime.framework/Versions/Current'));
    fs.symlinkSync('Versions/Current/Runtime', path.join(app, 'Contents/Frameworks/Runtime.framework/Runtime'));
  }
  return app;
}
function windowsFixture(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const exe = Buffer.alloc(512); exe.write('MZ'); exe.writeUInt32LE(64, 0x3c); exe.write('PE\0\0', 64, 'binary');
  exe.writeUInt16LE(0x8664, 68); exe.writeUInt16LE(0x20b, 88);
  put(directory, 'Qingdan.exe', exe);
  for (const name of ['resources/app.asar', 'resources.pak', 'icudtl.dat', 'chrome_100_percent.pak',
    'chrome_200_percent.pak', 'v8_context_snapshot.bin', 'locales/en-US.pak', 'LICENSE.electron.txt', 'LICENSES.chromium.html']) put(directory, name);
  return directory;
}
function fakePackaged(payload, version = '1.2.3') {
  return { version, executableSha256: verifier.shaFile(payload.executable), asarSha256: verifier.shaFile(payload.archive), nativeGuiTested: false, fusesVerified: { OnlyLoadAppFromAsar: true } };
}
function copy(source, target) { fs.cpSync(source, target, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true }); }

test('full payload comparison checks nested resources, permissions and framework symlinks without mutation', t => {
  const directory = fixture(t), app = macFixture(path.join(directory, 'original')), extracted = path.join(directory, 'extracted.app'); copy(app, extracted);
  const before = verifier.snapshot(app, true);
  const result = verifier.comparePayload(app, extracted, true); assert.equal(result.symlinks, windows ? 0 : 2); assert.equal(result.unixModesMatched, true);
  const resource = path.join(extracted, 'Contents/Resources/LICENSE.electron.txt'); fs.writeFileSync(resource, 'tampered');
  assert.throws(() => verifier.comparePayload(app, extracted, true), /Archive payload differs/);
  fs.copyFileSync(path.join(app, 'Contents/Resources/LICENSE.electron.txt'), resource);
  if (!windows) {
  fs.chmodSync(path.join(extracted, 'Contents/MacOS/青单'), 0o644);
  assert.throws(() => verifier.comparePayload(app, extracted, true), /Archive payload differs/);
  fs.chmodSync(path.join(extracted, 'Contents/MacOS/青单'), 0o755);
  const link = path.join(extracted, 'Contents/Frameworks/Runtime.framework/Versions/Current'); fs.unlinkSync(link); fs.symlinkSync('/tmp', link);
  assert.throws(() => verifier.snapshot(extracted, true), /External bundle symlink/);
  }
  assert.deepEqual(verifier.snapshot(app, true), before);
});
test('payload inventory rejects collisions, unsupported files and unexpected Windows links', t => {
  const directory = fixture(t); put(directory, 'First');
  // A case-insensitive filesystem cannot physically retain both names.
  // Inject enumeration to exercise collision rejection on macOS and NTFS too.
  const canonical = fs.realpathSync(directory), readDirectory = fs.readdirSync;
  const listing = t.mock.method(fs, 'readdirSync', function(current, ...args) {
    return String(current) === canonical ? ['First', 'first'] : readDirectory.call(fs, current, ...args);
  });
  assert.throws(() => verifier.snapshot(directory, false), /colliding payload/);
  listing.mock.restore();
  if (!windows) {
    fs.symlinkSync('First', path.join(directory, 'link'));
    assert.throws(() => verifier.snapshot(directory, false), /Unexpected Windows symlink/);
  }
});

test('archive snapshots canonicalize ancestor aliases without allowing lexical or resolved bundle escapes', t => {
  const directory = fixture(t), original = path.join(directory, 'original');
  const app = macFixture(original), alias = path.join(directory, 'alias');
  fs.symlinkSync(original, alias, windows ? 'junction' : 'dir');
  const aliasedApp = path.join(alias, '青单.app');
  assert.deepEqual(verifier.snapshot(aliasedApp, true), verifier.snapshot(app, true));
  assert.equal(verifier.comparePayload(app, aliasedApp, true).allFileBytesMatched, true);
  if (!windows) {
    const resources = path.join(app, 'Contents', 'Resources');
    const outside = path.join(directory, 'outside'); put(outside, 'secret', 'fixture secret');
    fs.symlinkSync(outside, path.join(resources, 'outside'));
    assert.throws(() => verifier.snapshot(aliasedApp, true), /External bundle symlink/);
    fs.unlinkSync(path.join(resources, 'outside'));
    // Ancestor alias resolves outside although the link text is inside the app.
    fs.symlinkSync(outside, path.join(resources, 'chain'));
    fs.symlinkSync('chain/secret', path.join(resources, 'first-chain'));
    assert.throws(() => verifier.snapshot(aliasedApp, true), /External bundle symlink/);
  }
});
test('macOS verifies Chinese identity, helpers, icon, version, executable permissions and runtime notices', t => {
  const app = macFixture(fixture(t)); assert.equal(verifier.verifyMacBundle(app, '1.2.3').metadata.helperNamesVerified.length, 4);
  assert.throws(() => verifier.verifyMacBundle(app, '9.9.9'), /CFBundleShortVersionString/);
  const helper = path.join(app, 'Contents/Frameworks/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer)');
  if (!windows) {
    fs.chmodSync(helper, 0o644); assert.throws(() => verifier.verifyMacBundle(app, '1.2.3'), /Nonexecutable/); fs.chmodSync(helper, 0o755);
  }
  fs.unlinkSync(path.join(app, 'Contents/Resources/LICENSES.chromium.html'));
  assert.throws(() => verifier.verifyMacBundle(app, '1.2.3'), /ENOENT/);
});
test('Windows verifies x64 PE and required extraction-and-run runtime assets/notices', t => {
  const directory = windowsFixture(path.join(fixture(t), 'win')); assert.equal(verifier.verifyWindowsPayload(directory).metadata.peMachine, 'amd64');
  const exe = fs.readFileSync(path.join(directory, 'Qingdan.exe')); exe.writeUInt16LE(0x14c, 68); fs.writeFileSync(path.join(directory, 'Qingdan.exe'), exe);
  assert.throws(() => verifier.verifyWindowsPayload(directory), /amd64/); exe.writeUInt16LE(0x8664, 68); fs.writeFileSync(path.join(directory, 'Qingdan.exe'), exe);
  fs.unlinkSync(path.join(directory, 'icudtl.dat')); assert.throws(() => verifier.verifyWindowsPayload(directory), /ENOENT/);
});
test('native command plans use read-only mounts, ditto and literal-path Expand-Archive without security bypasses', () => {
  const calls = [], command = (executable, args) => { calls.push({ executable, args }); return ''; };
  const mac = verifier.nativeCommands('mac', command); mac.extractZip('/a b.zip', '/tmp/new'); mac.verifyDmg('/a.dmg'); mac.mountDmg('/a.dmg', '/tmp/mounted'); mac.detachDmg('/tmp/mounted');
  assert.deepEqual(calls[0], { executable: '/usr/bin/ditto', args: ['-x', '-k', '/a b.zip', '/tmp/new'] });
  assert.deepEqual(calls[2].args, ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', '/tmp/mounted', '/a.dmg']);
  const win = verifier.nativeCommands('win', command); win.extractZip("C:\\weird ['x']\\app.zip", "C:\\new ['y']");
  const call = calls.at(-1), script = Buffer.from(call.args.at(-1), 'base64').toString('utf16le');
  assert.equal(call.executable, 'powershell.exe'); assert.match(script, /Expand-Archive -LiteralPath/); assert.match(script, /''x''/);
  assert(!JSON.stringify(calls).match(/no-sandbox|xattr|spctl|ExecutionPolicy|shadow|force/i));
  const signatureCalls = [];
  const signed = verifier.nativeCommands('mac', (executable, args, options) => { signatureCalls.push({ executable, args, options }); return 'Identifier=app.qingdan.desktop\nSignature=adhoc\nTeamIdentifier=not set\n'; });
  assert.equal(signed.verifyMacSignature('/a.app').signature, 'adhoc');
  assert.deepEqual(signatureCalls[0].args, ['--verify', '--deep', '--strict', '--verbose=2', '/a.app']);
  assert.equal(signatureCalls[1].options.captureStderr, true);
  assert.throws(() => verifier.nativeCommands('mac', () => 'Signature=Developer ID\nAuthority=Someone').verifyMacSignature('/a.app'), /ad-hoc integrity seal/);
});
test('complete macOS pipeline compares each format and detaches before cleanup; fixture commands are not native evidence', { skip: windows }, t => {
  const directory = fixture(t), unpacked = macFixture(path.join(directory, 'original'));
  const zip = put(directory, 'app.zip'), dmg = put(directory, 'app.dmg'), report = path.join(directory, 'report.json');
  const actions = [];
  const commands = {
    verifyMacSignature: () => ({ signature: 'adhoc', codesignDeepStrictVerified: true }),
    inspectZip: () => ({ allEntryCrcsVerified: true }),
    extractZip: (_, target) => { actions.push('extract'); copy(unpacked, path.join(target, '青单.app')); },
    verifyDmg: () => actions.push('verify'),
    mountDmg: (_, target) => { actions.push('mount'); copy(unpacked, path.join(target, '青单.app')); fs.symlinkSync(windows ? 'C:\\Applications' : '/Applications', path.join(target, 'Applications'), windows ? 'junction' : undefined); },
    checkReadOnly: () => actions.push('readonly'),
    detachDmg: target => { actions.push('detach'); assert(fs.existsSync(path.join(target, '青单.app'))); },
    verifyPackaged: payload => { actions.push('packaged'); return fakePackaged(payload); },
  };
  const result = verifier.verifyArchives({ platform: 'mac', arch: 'arm64', version: '1.2.3', unpacked, zip, dmg, report }, commands, 'darwin');
  assert.deepEqual(actions, ['extract', 'packaged', 'verify', 'mount', 'readonly', 'packaged', 'detach']);
  assert.deepEqual(result.artifacts.map(item => item.format), ['zip', 'dmg']);
  assert.equal(result.nativeGuiTested, false); assert.equal(result.electronUtilityProcessTested, false); assert.equal(result.backendApiSmokeTested, false);
  assert.equal(result.originalPayloadUnchanged, true); assert.equal(result.artifacts[1].applicationsLinkVerified, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(report, 'utf8')), result);
});
test('failed mounted payload checks detach; partial attach failures never recursively delete a possibly mounted volume', t => {
  const directory = fixture(t), unpacked = macFixture(path.join(directory, 'original')), zip = put(directory, 'app.zip'), dmg = put(directory, 'app.dmg');
  let detached = false;
  const commands = { verifyMacSignature: () => ({ signature: 'adhoc', codesignDeepStrictVerified: true }), inspectZip: () => ({}), extractZip: (_, target) => copy(unpacked, path.join(target, '青单.app')),
    verifyPackaged: payload => fakePackaged(payload), verifyDmg: () => {},
    mountDmg: (_, target) => copy(unpacked, path.join(target, '青单.app')), checkReadOnly: () => {},
    detachDmg: () => { detached = true; } };
  const options = { platform: 'mac', arch: 'arm64', version: '1.2.3', unpacked, zip, dmg, report: path.join(directory, 'report.json') };
  assert.throws(() => verifier.verifyArchives(options, commands, 'darwin'), /ENOENT/); assert.equal(detached, true); assert(!fs.existsSync(options.report));
  let mountpoint;
  commands.mountDmg = (_, target) => { mountpoint = target; put(target, 'sentinel'); throw Error('interrupted attach'); };
  commands.detachDmg = () => { throw Error('detach blocked'); };
  assert.throws(() => verifier.verifyArchives(options, commands, 'darwin'), /detach blocked/);
  assert(fs.existsSync(path.join(mountpoint, 'sentinel')), 'must retain potentially mounted directory');
  fs.rmSync(path.dirname(mountpoint), { recursive: true, force: true }); // Fixture was never mounted.
});
test('native platform and external report location are enforced before extraction', t => {
  const directory = fixture(t), unpacked = windowsFixture(path.join(directory, 'win')), zip = put(directory, 'app.zip');
  const options = { platform: 'win', arch: 'x64', version: '1.2.3', unpacked, zip, report: path.join(directory, 'report.json') };
  assert.throws(() => verifier.verifyArchives(options, {}, 'linux'), /matching native OS/);
  options.report = path.join(unpacked, 'report.json'); assert.throws(() => verifier.verifyArchives(options, {}, 'win32'), /outside the payload/);
  if (process.platform !== 'win32') {
    options.report = path.join(directory, 'report.json'); fs.symlinkSync(zip, options.report);
    assert.throws(() => verifier.verifyArchives(options, {}, 'win32'), /symlink report/);
  }
});
test('complete Windows extraction pipeline compares the exact tree and rechecks the extracted executable/ASAR', t => {
  const directory = fixture(t), unpacked = windowsFixture(path.join(directory, 'win')), zip = put(directory, 'app.zip');
  let extractions = 0, payloadChecks = 0;
  const commands = { inspectZip: () => ({ allEntryCrcsVerified: true }), extractZip: (_, target) => { extractions++; copy(unpacked, target); },
    verifyPackaged: payload => { payloadChecks++; assert(payload.executable !== path.join(unpacked, 'Qingdan.exe')); return fakePackaged(payload); } };
  const report = verifier.verifyArchives({ platform: 'win', arch: 'x64', version: '1.2.3', unpacked, zip, report: path.join(directory, 'report.json') }, commands, 'win32');
  assert.equal(extractions, 1); assert.equal(payloadChecks, 1); assert.equal(report.artifacts[0].freshNativeExtractionVerified, true); assert.equal(report.nativeGuiTested, false);
});

test('Python ZIP preflight validates CRCs and rejects traversal, collisions, external/ancestor links and Windows device paths', t => {
  const directory = fixture(t), python = process.env.QINGDAN_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const create = entries => {
    const zip = path.join(directory, 'fixture.zip');
    const script = "import json,sys,zipfile; es=json.loads(sys.argv[2]); z=zipfile.ZipFile(sys.argv[1],'w');\nfor name,data,mode in es:\n i=zipfile.ZipInfo(name); i.create_system=3; i.external_attr=mode<<16; z.writestr(i,data.encode());\nz.close()";
    const built = spawnSync(python, ['-c', script, zip, JSON.stringify(entries)], { encoding: 'utf8' }); assert.equal(built.status, 0, built.stderr);
    return spawnSync(python, [path.join(root, 'scripts/inspect-desktop-zip.py'), zip, '--platform', 'mac'], { encoding: 'utf8' });
  };
  const valid = create([['青单.app/Contents/file', 'valid', 0o100644], ['青单.app/Contents/link', 'file', 0o120777]]);
  assert.equal(valid.status, 0, valid.stderr); assert.equal(JSON.parse(valid.stdout).symlinks, 1); assert.equal(JSON.parse(valid.stdout).allEntryCrcsVerified, true);
  for (const entries of [
    [['../outside', 'bad', 0o100644]], [['app/file', 'a', 0o100644], ['app/FILE', 'b', 0o100644]],
    [['青单.app/link', '/Applications', 0o120777]], [['青单.app/link', 'Contents', 0o120777], ['青单.app/link/overwritten', 'bad', 0o100644]],
    [['青单.app/Contents/file', 'a', 0o100644], ['青单.app/Contents/file/child', 'b', 0o100644]],
  ]) assert.notEqual(create(entries).status, 0);
  create([['CON.txt', 'bad', 0o100644]]);
  const devices = spawnSync(python, [path.join(root, 'scripts/inspect-desktop-zip.py'), path.join(directory, 'fixture.zip'), '--platform', 'win'], { encoding: 'utf8' });
  assert.notEqual(devices.status, 0); assert.match(devices.stderr, /Unsafe Windows ZIP path/);
  // Change stored content without updating the CRC.
  create([['app/file', 'valid', 0o100644]]); const zip = path.join(directory, 'fixture.zip'), data = fs.readFileSync(zip);
  const offset = data.indexOf(Buffer.from('valid')); assert(offset >= 0); data[offset] ^= 1; fs.writeFileSync(zip, data);
  const corrupt = spawnSync(python, [path.join(root, 'scripts/inspect-desktop-zip.py'), zip, '--platform', 'mac'], { encoding: 'utf8' });
  assert.notEqual(corrupt.status, 0); assert.match(corrupt.stderr, /Bad CRC/);
});
