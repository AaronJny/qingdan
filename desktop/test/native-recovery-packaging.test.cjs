'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const asar = require('@electron/asar');
const { createAsarFixture } = require('./fixtures/asar.cjs');
const { Arch } = require('builder-util');
const { TmpDir } = require('temp-file');
const hook = require('../scripts/prepare-native-recovery.cjs');
const { thin, fat } = require('./fixtures/macho.cjs');
const { verifyNativeNodeModules, verifyMacArchitecture } = require('../scripts/verify-mac-architecture.cjs');
const project = path.resolve(__dirname, '..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function temporary(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-native-recovery-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function write(root, name, bytes) { const file = path.join(root, ...name.split('/')); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); return file; }
function elf() {
  const bytes = Buffer.alloc(64); Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(bytes);
  bytes[4] = 2; bytes[5] = 1; bytes[6] = 1; bytes.writeUInt16LE(3, 16); bytes.writeUInt16LE(62, 18); bytes.writeUInt16LE(64, 52); return bytes;
}
function pe() {
  const bytes = Buffer.alloc(256); bytes.write('MZ'); bytes.writeUInt32LE(64, 60); bytes.write('PE\0\0', 64);
  bytes.writeUInt16LE(0x8664, 68); bytes.writeUInt16LE(112, 84); bytes.writeUInt16LE(0x2000, 86); bytes.writeUInt16LE(0x20b, 88); return bytes;
}
function fixture(t) {
  const root = temporary(t), source = path.join(root, 'app/node_modules/classic-level'), destination = path.join(root, 'stage');
  fs.mkdirSync(destination);
  write(source, 'package.json', JSON.stringify({ name: 'classic-level', version: '3.0.0' }));
  write(source, 'index.js', 'module.exports = true;');
  write(source, 'prebuilds/linux-x64/classic-level.node', elf());
  write(source, 'prebuilds/linux-x64/classic-level.musl.node', elf());
  write(source, 'prebuilds/win32-x64/classic-level.node', pe());
  write(source, 'prebuilds/darwin-x64+arm64/classic-level.node', fat(['x64', 'arm64']));
  write(source, 'prebuilds/linux-arm64/classic-level.armv8.node', thin('arm64'));
  write(source, 'build/Release/classic-level.node', Buffer.from('must not ship a local build'));
  return { root, source, destination, app: path.join(root, 'app') };
}
function snapshot(root) {
  const result = {};
  const walk = current => { for (const name of fs.readdirSync(current).sort()) { const file = path.join(current, name); if (fs.lstatSync(file).isDirectory()) walk(file); else result[path.relative(root, file)] = sha(fs.readFileSync(file)); } };
  walk(root); return result;
}
function fakeLipo(arch, calls) {
  return { hostPlatform: 'darwin', command(command, args, options) {
    calls.push({ command, args, options });
    assert.equal(command, '/usr/bin/lipo'); assert.equal(args[1], '-thin'); assert.equal(args[2], arch === 'x64' ? 'x86_64' : arch); assert.equal(args[3], '-output');
    assert.notEqual(args[0], args[4]); fs.writeFileSync(args[4], thin(arch)); return { status: 0, stderr: '' };
  } };
}

for (const platform of ['linux', 'win32']) test(`stages only the ${platform} x64 binding without modifying any source dependency`, t => {
  const f = fixture(t), before = snapshot(f.source), result = hook.stageBinding(f.source, f.destination, platform, 'x64');
  assert.deepEqual(snapshot(f.source), before);
  assert.deepEqual(Object.keys(snapshot(f.destination)), [path.join(`${platform}-x64`, 'classic-level.node')]);
  assert.equal(result.sha256, sha(fs.readFileSync(result.file)));
  assert.deepEqual(result.architectures, ['x64']); assert.equal(result.format, platform === 'linux' ? 'elf64' : 'pe32+');
});
for (const arch of ['x64', 'arm64']) test(`thins only the staged Mac ${arch} copy before the strict architecture verifier`, t => {
  const f = fixture(t), before = snapshot(f.source), calls = [];
  const result = hook.stageBinding(f.source, f.destination, 'darwin', arch, fakeLipo(arch, calls));
  assert.deepEqual(snapshot(f.source), before); assert.equal(calls.length, 1);
  assert(calls[0].args[0].startsWith(f.destination + path.sep));
  assert.equal(result.format, 'mach-o64'); assert.deepEqual(result.architectures, [arch]);
  assert.equal(verifyNativeNodeModules(f.destination, arch).length, 1);
  assert.deepEqual(Object.keys(snapshot(f.destination)), [path.join(`darwin-${arch}`, 'classic-level.node')]);
});

test('unsupported targets, altered dependency versions and nonempty/unsafe stage paths fail closed', t => {
  for (const target of [['linux', 'arm64'], ['win32', 'arm64'], ['darwin', 'universal'], ['../linux', 'x64'], ['mas', 'x64'], ['linux', '../x64']]) assert.throws(() => hook.targetBinding(...target), /Unsupported/);
  const f = fixture(t);
  for (const relative of ['../outside', '/outside', 'a//b', 'a\\b', 'a\0b', 'a:b', './package.json']) assert.throws(() => hook.realEntry(f.source, relative), /Unsafe/);
  write(f.destination, 'sentinel', 'untouched'); assert.throws(() => hook.stageBinding(f.source, f.destination, 'linux', 'x64'), /empty real directory/);
  assert.equal(fs.readFileSync(path.join(f.destination, 'sentinel'), 'utf8'), 'untouched');
  fs.unlinkSync(path.join(f.destination, 'sentinel'));
  const nested = path.join(f.source, 'stage'); fs.mkdirSync(nested);
  assert.throws(() => hook.stageBinding(f.source, nested, 'linux', 'x64'), /cannot modify/);
  write(f.source, 'package.json', JSON.stringify({ name: 'classic-level', version: '4.0.0' }));
  assert.throws(() => hook.stageBinding(f.source, f.destination, 'linux', 'x64'), /classic-level@3.0.0/);
});
test('binding symlinks and symlinked directories cannot escape the stage or package root', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t), prebuild = path.join(f.source, 'prebuilds/linux-x64/classic-level.node');
  fs.unlinkSync(prebuild); fs.symlinkSync(path.join(f.source, 'prebuilds/win32-x64/classic-level.node'), prebuild);
  assert.throws(() => hook.stageBinding(f.source, f.destination, 'linux', 'x64'), /symlink/);
  fs.rmSync(path.join(f.source, 'prebuilds/linux-x64'), { recursive: true });
  fs.symlinkSync(path.join(f.source, 'prebuilds/win32-x64'), path.join(f.source, 'prebuilds/linux-x64'));
  assert.throws(() => hook.stageBinding(f.source, f.destination, 'linux', 'x64'), /symlink/);
  const link = path.join(f.root, 'stage-link'); fs.symlinkSync(f.destination, link);
  assert.throws(() => hook.stageBinding(f.source, link, 'win32', 'x64'), /empty real directory/);
});
test('foreign, truncated, mislabeled and wrong-architecture native formats are rejected', () => {
  for (const platform of ['linux', 'win32', 'darwin']) for (const bytes of [Buffer.alloc(0), Buffer.from('not native'), elf().subarray(0, 12), pe().subarray(0, 80)]) assert.throws(() => hook.inspectBinding(bytes, platform, 'x64'));
  assert.throws(() => hook.inspectBinding(pe(), 'linux', 'x64'), /not ELF/);
  assert.throws(() => hook.inspectBinding(elf(), 'win32', 'x64'), /not PE/);
  const armElf = elf(); armElf.writeUInt16LE(183, 18); assert.throws(() => hook.inspectBinding(armElf, 'linux', 'x64'), /ELF64 x64/);
  const armPe = pe(); armPe.writeUInt16LE(0xaa64, 68); assert.throws(() => hook.inspectBinding(armPe, 'win32', 'x64'), /PE32\+ x64/);
  const bounds = pe(); bounds.writeUInt32LE(0xffffffff, 60); assert.throws(() => hook.inspectBinding(bounds, 'win32', 'x64'), /PE header/);
  assert.throws(() => hook.inspectBinding(thin('arm64'), 'darwin', 'x64'), /architecture must be exactly/);
  assert.throws(() => hook.inspectBinding(fat(['x64', 'arm64']), 'darwin', 'x64'), /architecture must be exactly/);
});
test('Mac thinning rejects non-Mac hosts, tool failure and corrupt or foreign output', t => {
  for (const mode of ['host', 'failure', 'foreign', 'universal', 'missing']) {
    const f = fixture(t), before = snapshot(f.source);
    const options = { hostPlatform: mode === 'host' ? 'linux' : 'darwin', command(command, args) {
      if (mode === 'failure') return { status: 1, stderr: 'fixture error' };
      if (mode !== 'missing') fs.writeFileSync(args[4], mode === 'universal' ? fat(['x64', 'arm64']) : thin('arm64'));
      return { status: 0 };
    } };
    assert.throws(() => hook.stageBinding(f.source, f.destination, 'darwin', 'x64', options));
    assert.deepEqual(snapshot(f.source), before);
  }
});

async function builderArchive(t, platform, arch) {
  const f = fixture(t), before = snapshot(f.source), config = { ...require('../builder.config.cjs'), files: [...require('../builder.config.cjs').files] };
  write(f.app, 'package.json', JSON.stringify({ name: 'fixture', version: '1.0.0', main: 'src/main.cjs', dependencies: { 'classic-level': '3.0.0' } }));
  write(f.app, 'src/main.cjs', 'module.exports = true;');
  const outDir = path.join(f.root, 'out'), resources = path.join(outDir, 'resources'), destination = path.join(resources, 'app'); fs.mkdirSync(resources, { recursive: true });
  const manager = new TmpDir('native-recovery-test'); t.after(() => manager.cleanup());
  const info = { appDir: f.app, projectDir: f.app, config, buildResourcesDir: 'build', appInfo: { type: 'commonjs' }, debugLogger: { isEnabled: false }, tempDirManager: manager, getWorkspaceRoot: async () => f.app };
  const packager = { info, config, projectDir: f.app, debugLogger: info.debugLogger };
  let staged;
  if (platform === 'darwin') {
    staged = hook.stageBinding(f.source, f.destination, platform, arch, fakeLipo(arch, []));
    config.files.push({ from: f.destination, to: 'node_modules/classic-level/prebuilds', filter: ['**/*.node'] });
  } else staged = await hook({ packager, arch: Arch[arch], electronPlatformName: platform });
  const expand = value => value.replaceAll('${arch}', arch).replaceAll('${os}', { linux: 'linux', win32: 'win', darwin: 'mac' }[platform]);
  const { getMainFileMatchers, getNodeModuleFileMatcher, getFileMatchers, FileMatcher } = require('app-builder-lib/out/fileMatcher');
  const { computeFileSets } = require('app-builder-lib/out/util/appFileCopier');
  const { NodeModuleCopyHelper } = require('app-builder-lib/out/util/NodeModuleCopyHelper');
  const main = getMainFileMatchers(f.app, destination, expand, {}, packager, outDir, false);
  const fileSets = await computeFileSets(main, null, packager, false);
  const matcher = getNodeModuleFileMatcher(f.app, destination, expand, {}, info);
  const moduleDestination = path.join(destination, 'node_modules/classic-level');
  const copier = new NodeModuleCopyHelper(new FileMatcher(f.source, moduleDestination, expand, matcher.patterns), info);
  const files = await copier.collectNodeModules({ name: 'classic-level', dir: f.source }, [], path.join('node_modules', 'classic-level'));
  assert(!files.some(file => /\.node$/.test(file)), 'Original prebuilds and local builds must be excluded by the locked builder');
  assert(files.includes(path.join(f.source, 'index.js')), 'Production JavaScript must survive native pruning');
  fileSets.push({ src: f.source, destination: moduleDestination, files, metadata: copier.metadata });
  const unpack = getFileMatchers(config, 'asarUnpack', destination, { macroExpander: expand, customBuildOptions: {}, globalOutDir: outDir, defaultSrc: f.app });
  const { AsarPackager } = require('app-builder-lib/out/asar/asarUtil');
  await new AsarPackager(packager, { defaultDestination: destination, resourcePath: resources, options: {}, unpackPattern: unpack[0].createFilter() }).pack(fileSets);
  const archive = path.join(resources, 'app.asar'), result = hook.verifyPackagedBindingBeforeSigning(archive, platform, arch);
  assert.equal(result.sha256, staged.sha256); assert.deepEqual(snapshot(f.source), before);
  return { ...f, archive, result };
}
for (const [platform, arch] of [['linux', 'x64'], ['win32', 'x64'], ['darwin', 'x64'], ['darwin', 'arm64']]) test(`locked builder file matchers and ASAR writer ship exactly unpacked ${platform}/${arch}`, async t => {
  const f = await builderArchive(t, platform, arch);
  const entries = asar.listPackage(f.archive).filter(name => /\.node$/.test(name));
  assert.equal(entries.length, 1); assert.equal(f.result.unpacked, true);
  if (platform === 'darwin') assert.equal(verifyNativeNodeModules(f.archive + '.unpacked', arch).length, 1);
});
test('presign afterPack validation rejects packed natives, altered bytes and extra foreign bindings', async t => {
  const f = await builderArchive(t, 'linux', 'x64'), physical = path.join(f.archive + '.unpacked', ...f.result.entry.split('/'));
  fs.appendFileSync(physical, Buffer.from('tampered')); assert.throws(() => hook.verifyPackagedBindingBeforeSigning(f.archive, 'linux', 'x64'), /ASAR size/);
  const source = path.join(f.root, 'archive-source'); write(source, f.result.entry, elf());
  await createAsarFixture(source, f.archive);
  assert.throws(() => hook.verifyPackagedBindingBeforeSigning(f.archive, 'linux', 'x64'), /unpacked and signable/);
  write(source, 'node_modules/classic-level/prebuilds/win32-x64/classic-level.node', pe());
  await createAsarFixture(source, f.archive, { unpack: '*.node' });
  assert.throws(() => hook.verifyPackagedBindingBeforeSigning(f.archive, 'linux', 'x64'), /exactly the target/);
});
test('final Mac architecture gate reads post-sign unpacked bytes despite presign ASAR metadata', async t => {
  const f = await builderArchive(t, 'darwin', 'x64'), app = path.join(f.root, '青单.app');
  const required = ['Contents/MacOS/青单', 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
    ...['', ' (GPU)', ' (Plugin)', ' (Renderer)'].map(suffix => `Contents/Frameworks/Electron Helper${suffix}.app/Contents/MacOS/Electron Helper${suffix}`)];
  for (const name of required) write(app, name, thin('x64'));
  const archive = path.join(app, 'Contents/Resources/app.asar'); fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.copyFileSync(f.archive, archive); fs.cpSync(f.archive + '.unpacked', archive + '.unpacked', { recursive: true });
  const physical = path.join(archive + '.unpacked', ...f.result.entry.split('/'));
  // Model a codesign-added LC_CODE_SIGNATURE and trailing signature bytes. This
  // is structural coverage, not a claim that a synthetic signature is valid.
  const changed = Buffer.concat([thin('x64', { commands: [16] }), Buffer.alloc(16)]);
  changed.writeUInt32LE(0x1d, 32); changed.writeUInt32LE(48, 40); changed.writeUInt32LE(16, 44);
  fs.writeFileSync(physical, changed);
  assert.throws(() => hook.verifyPackagedBindingBeforeSigning(archive, 'darwin', 'x64'), /ASAR size/);
  assert.equal(verifyMacArchitecture(app, 'x64', archive).nativeNodeModules.length, 2);
  fs.writeFileSync(physical, thin('arm64'));
  assert.throws(() => verifyMacArchitecture(app, 'x64', archive), /architecture must be exactly/);
});
test('concurrent hooks share a managed temporary root and use target macros without stale mappings', async t => {
  const f = fixture(t), config = { files: [...require('../builder.config.cjs').files] }, manager = new TmpDir('native-recovery-concurrent-test'); t.after(() => manager.cleanup());
  const info = { appDir: f.app, config, tempDirManager: manager }, packager = { info };
  const results = await Promise.all(['linux', 'win32'].map(electronPlatformName => hook({ packager, arch: Arch.x64, electronPlatformName })));
  assert.equal(config.files.filter(item => typeof item === 'object').length, 1);
  assert.match(config.files.at(-1).from, /\$\{os\}-\$\{arch\}$/);
  for (const result of results) assert(fs.existsSync(result.file));
  await manager.cleanup(); for (const result of results) assert(!fs.existsSync(result.file));
});

test('real staged prebuild loads through node-gyp-build and performs a database round trip on Node 24', async t => {
  if (!['linux', 'win32', 'darwin'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch) || process.platform !== 'darwin' && process.arch !== 'x64') { t.skip('No supported native host'); return; }
  assert.equal(process.versions.node.split('.')[0], '24', 'Release checks require the supported Node 24 runtime');
  const root = temporary(t), packageRoot = path.join(root, 'classic-level'), stage = path.join(packageRoot, 'prebuilds'); fs.mkdirSync(stage, { recursive: true });
  const source = path.join(project, 'node_modules/classic-level'), sourceFile = path.join(source, ...hook.targetBinding(process.platform, process.arch).source.split('/')), before = sha(fs.readFileSync(sourceFile));
  const result = hook.stageBinding(source, stage, process.platform, process.arch);
  write(packageRoot, 'package.json', JSON.stringify({ name: 'classic-level', version: '3.0.0' }));
  // Windows keeps a loaded .node DLL locked until its process exits, even
  // after LevelDB closes. Keep the real native proof in a child so the parent
  // can remove the staged dependency only after the DLL has been unloaded.
  const child = spawnSync(process.execPath, ['-e', `
    'use strict';
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const [packageRoot, expectedFile, loaderFile, database] = process.argv.slice(1);
    (async () => {
      assert.equal(process.versions.node.split('.')[0], '24');
      const loader = require(loaderFile);
      assert.equal(loader.resolve(packageRoot), expectedFile);
      const binding = loader(packageRoot), context = binding.db_init();
      fs.mkdirSync(database);
      await binding.db_open(context, database, { createIfMissing: true, errorIfExists: false });
      try {
        await binding.db_put(context, 'recovery-test', '保存 works', { sync: true });
        assert.equal(await binding.db_get(context, 1, 'recovery-test', undefined), '保存 works');
      } finally { await binding.db_close(context); }
      console.log(JSON.stringify({ resolved: expectedFile, value: '保存 works', closed: true }));
    })().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
  `, packageRoot, result.file, require.resolve('node-gyp-build'), path.join(root, 'db')], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  assert.equal(sha(fs.readFileSync(sourceFile)), before);
  assert.ifError(child.error);
  assert.equal(child.status, 0, `Staged native binding child failed (${child.signal || 'no signal'}): ${child.stderr || child.stdout}`);
  assert.deepEqual(JSON.parse(child.stdout.trim()), { resolved: result.file, value: '保存 works', closed: true });
});

test('configuration preserves existing hooks and verifies the staged binding before bundle finalization', () => {
  const config = require('../builder.config.cjs');
  assert.equal(config.beforePack, 'scripts/prepare-native-recovery.cjs'); assert.deepEqual(config.asarUnpack, ['**/*.node']);
  assert.equal(config.afterExtract, 'scripts/copy-mac-notices.cjs'); assert.equal(config.afterPack, 'scripts/finalize-bundle.cjs');
  assert.equal(config.npmRebuild, false); assert.equal(config.electronFuses.enableEmbeddedAsarIntegrityValidation, true);
  const finalizer = fs.readFileSync(path.join(project, config.afterPack), 'utf8');
  assert(finalizer.indexOf('verifyNativeRecovery') < finalizer.indexOf('finalize-mac-bundle'));
});
