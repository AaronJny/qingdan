'use strict';
// Execute only the official stock Electron runtime in Node mode. The product's
// disabled RunAsNode fuse stays disabled. No product GUI or real profile is used.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const SCHEMA = 'qingdan-packaged-recovery-smoke-v1';
const PREFIX = 'qingdan-packaged-recovery-smoke-';
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    assert(['--arch', '--report', '--archive', '--executable', '--electron'].includes(key) && value && !Object.hasOwn(values, key), 'Expected unique --arch, --report and optional --archive, --executable, --electron paths');
    values[key] = value;
  }
  assert(['arm64', 'x64'].includes(values['--arch']), 'Expected --arch arm64|x64');
  assert(values['--report'], 'Expected --report path');
  assert(Boolean(values['--archive']) === Boolean(values['--executable']), '--archive and --executable must be provided together');
  const arch = values['--arch'];
  const contents = path.join(ROOT, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac', '青单.app', 'Contents');
  return { arch, report: path.resolve(values['--report']),
    archive: path.resolve(values['--archive'] || path.join(contents, 'Resources/app.asar')),
    executable: path.resolve(values['--executable'] || path.join(contents, 'MacOS/青单')),
    electron: values['--electron'] ? path.resolve(values['--electron']) : undefined };
}

function nodeEnvironment(environment) {
  const clean = { ...environment };
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_NO_ASAR', 'ELECTRON_NO_SANDBOX']) delete clean[key];
  clean.ELECTRON_RUN_AS_NODE = '1';
  return clean;
}

function inspectPackage(archive, platform, arch) {
  const asar = require('@electron/asar');
  const { nativeAsarEntryPath } = require('./asar-entry-path.cjs');
  const { targetBinding, realEntry, inspectBinding } = require('./prepare-native-recovery.cjs');
  const bindingEntry = targetBinding(platform, arch).entry;
  assert(fs.lstatSync(archive).isFile() && !fs.lstatSync(archive).isSymbolicLink(), 'Expected a real packaged ASAR file');
  const natives = asar.listPackage(archive).map(value => value.split(path.sep).join('/').replace(/^\//, ''))
    .filter(value => value.startsWith('node_modules/classic-level/') && /\.node$/i.test(value));
  assert.deepEqual(natives, [bindingEntry], 'Only the target classic-level native binding may ship');
  const entry = asar.statFile(archive, nativeAsarEntryPath(bindingEntry), false);
  assert(entry.unpacked === true && !entry.link, 'The final native binding must be unpacked');
  const binding = realEntry(archive + '.unpacked', bindingEntry);
  inspectBinding(fs.readFileSync(binding), platform, arch);
  const metadata = JSON.parse(asar.extractFile(archive, nativeAsarEntryPath('node_modules/classic-level/package.json')));
  assert(metadata.name === 'classic-level' && metadata.version === '3.0.0', 'Expected packaged classic-level@3.0.0');
  // Mac ad-hoc signing may change unpacked bytes after ASAR generation; inspect
  // and execute the final disk file, never rewrite the sealed ASAR metadata.
  return { bindingEntry, binding, bindingSha256: sha(binding), asarSha256: sha(archive) };
}

function finalBindingEvidence(archive, platform, arch) {
  // Read the final unpacked disk bytes, including any changes made by native
  // signing. Called again on extracted ZIP and read-only mounted DMG payloads.
  // The ASAR's pre-sign hash/size is deliberately not used as this evidence.
  const value = inspectPackage(archive, platform, arch);
  return { entry: value.bindingEntry, sha256: value.bindingSha256,
    bytes: fs.statSync(value.binding).size, unpacked: true, finalDiskBytes: true };
}

async function child(archive, fixture, arch) {
  assert.equal(process.versions.electron, require('../package.json').devDependencies.electron, 'Use the locked official Electron version');
  assert.equal(process.arch, arch, 'Stock Electron process architecture must match the target');
  assert(path.isAbsolute(fixture) && path.basename(fixture).startsWith(PREFIX) && !fs.lstatSync(fixture).isSymbolicLink(), 'Expected a launcher-created synthetic fixture');
  assert.equal(process.env.ELECTRON_RUN_AS_NODE, '1');
  const expected = path.join(archive + '.unpacked', 'node_modules/classic-level/prebuilds', `${process.platform}-${arch}`, 'classic-level.node');
  const loaded = [], original = process.dlopen;
  process.dlopen = function (module, filename, ...args) {
    loaded.push(fs.realpathSync(filename));
    return original.call(this, module, filename, ...args);
  };
  let ClassicLevel;
  try { ({ ClassicLevel } = require(path.join(archive, 'node_modules/classic-level'))); }
  finally { process.dlopen = original; }
  assert.deepEqual(loaded, [fs.realpathSync(expected)], 'Electron must load the final packaged unpacked binding, not a source or fallback prebuild');
  const key = 'synthetic-recovery-key', value = '恢复 中文 😀 café\n exact whitespace  ';
  const database = path.join(fixture, 'synthetic-database');
  let db = new ClassicLevel(database, { valueEncoding: 'utf8' });
  try { await db.open(); await db.put(key, value); assert.equal(await db.get(key), value); }
  finally { await db.close(); }
  db = new ClassicLevel(database, { valueEncoding: 'utf8', createIfMissing: false });
  try { await db.open(); assert.equal(await db.get(key), value); }
  finally { await db.close(); }
  const result = { passed: true, platform: process.platform, arch: process.arch,
    electron: process.versions.electron, node: process.versions.node, napi: process.versions.napi,
    classicLevel: require(path.join(archive, 'node_modules/classic-level/package.json')).version,
    stockElectronNodeMode: true, packagedAsarModuleLoaded: true,
    packagedUnpackedBindingLoaded: true, syntheticWriteReadReopenPassed: true };
  fs.writeFileSync(path.join(fixture, 'result.json'), JSON.stringify(result));
}

async function runSmoke(options) {
  const report = { schema: SCHEMA, passed: false, platform: process.platform, arch: process.arch,
    productAppLaunched: false, nativeGuiTested: false, keychainAccessInstrumented: false, realUserProfileAccessed: false };
  let fixture;
  const { inside, runtimeLayout } = require('./smoke-local-session.cjs');
  const productRoot = process.platform === 'darwin' ? path.resolve(options.executable, '../../..') : path.dirname(options.executable);
  assert(!inside(productRoot, options.report) && !inside(path.dirname(options.archive), options.report), 'Report must stay outside the packaged payload');
  assert(!fs.existsSync(options.report) || !fs.lstatSync(options.report).isSymbolicLink(), 'Report cannot be a symlink');
  const stock = options.electron || require('electron');
  const stockLayout = runtimeLayout(stock);
  assert(!inside(stockLayout.root, options.report), 'Report must stay outside the stock runtime');
  try {
    assert.equal(process.arch, options.arch, 'Native host must match the target architecture');
    if (process.platform === 'darwin') require('./assert-native-macos.cjs').assertNativeMac(options.arch);
    const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
    const electron = stock;
    assert.notEqual(fs.realpathSync(electron), fs.realpathSync(options.executable), 'Never launch the product in Node mode');
    const stockWire = await getCurrentFuseWire(electron), productWire = await getCurrentFuseWire(options.executable);
    assert.equal(stockWire[FuseV1Options.RunAsNode], 49, 'Stock runtime must retain its official Node mode fuse');
    assert.equal(productWire[FuseV1Options.RunAsNode], 48, 'Product RunAsNode must remain disabled');
    const before = inspectPackage(options.archive, process.platform, options.arch);
    const executableSha256 = sha(options.executable), stockSha256 = sha(electron);
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
    const result = spawnSync(electron, [__filename, '--binding-child', options.archive, fixture, options.arch], {
      env: nodeEnvironment(process.env), encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
    });
    assert(!result.error && result.status === 0 && !result.signal, `Stock Electron packaged-binding smoke failed: ${result.error?.message || result.stderr || result.stdout || result.status}`);
    const actual = JSON.parse(fs.readFileSync(path.join(fixture, 'result.json'), 'utf8'));
    assert(actual.passed === true && actual.platform === process.platform && actual.arch === options.arch, 'Wrong child result');
    assert.deepEqual(await getCurrentFuseWire(electron), stockWire, 'Stock runtime fuse wire changed');
    assert.deepEqual(await getCurrentFuseWire(options.executable), productWire, 'Product fuse wire changed');
    assert.equal(sha(electron), stockSha256, 'Stock runtime executable changed');
    assert.equal(sha(options.executable), executableSha256, 'Product executable changed');
    assert.deepEqual(inspectPackage(options.archive, process.platform, options.arch), before, 'Packaged ASAR or binding changed');
    Object.assign(report, actual, { bindingEntry: before.bindingEntry, bindingSha256: before.bindingSha256,
      asarSha256: before.asarSha256, executableSha256,
      stockRuntimeFuseWireUnchanged: true, packagedPayloadUnchanged: true });
  } catch (error) { report.passed = false; report.error = { message: error.message }; }
  finally { if (fixture) fs.rmSync(fixture, { recursive: true, force: true }); }
  fs.writeFileSync(options.report, JSON.stringify(report, null, 2) + '\n');
  return report;
}

module.exports = { parseArgs, nodeEnvironment, inspectPackage, finalBindingEvidence, runSmoke };
if (require.main === module) {
  const work = process.argv[2] === '--binding-child'
    ? child(process.argv[3], process.argv[4], process.argv[5])
    : runSmoke(parseArgs(process.argv.slice(2))).then(report => { console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1; });
  work.catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
