'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyBackend } = require('../scripts/verify-backend.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-payload-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const snapshot = 'a'.repeat(64), content = {
    'package.json': JSON.stringify({ name: 'synthetic', version: '1.1.0' }),
    'package-lock.json': JSON.stringify({ version: '1.1.0', packages: { '': { version: '1.1.0' }, 'node_modules/synthetic': { version: '1.0.0', integrity: 'sha512-fixture' } } }),
    'dist/server/main.mjs': '// fixture', 'dist/server/mcp.mjs': '// fixture', 'dist/server/users.mjs': '// fixture', 'dist/server/calendar-worker.mjs': '// fixture', 'dist/client/index.html': '<html>',
    'dist/client/offline-shell.html': '<html>', 'dist/client/offline-shell-manifest.json': '{}', 'dist/client/qingdan-offline-worker.js': '// fixture',
    'drizzle/meta/_journal.json': '{}', 'drizzle/0000_fixture.sql': '-- fixture',
    'node_modules/synthetic/package.json': JSON.stringify({ name: 'synthetic', version: '1.0.0' }), 'node_modules/synthetic/index.js': '// fixture',
  };
  for (const [name, bytes] of Object.entries(content)) { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
  const dependencyFiles = Object.fromEntries(Object.entries(content).filter(([name]) => name.startsWith('node_modules/synthetic/')).map(([name, bytes]) => [name.slice('node_modules/synthetic/'.length), sha(bytes)]));
  const dependencies = { source_snapshot_sha256: snapshot, packages: [{ name: 'synthetic', location: 'node_modules/synthetic', version: '1.0.0', integrity: 'sha512-fixture', files_sha256: dependencyFiles }] };
  content['dependency-manifest.json'] = JSON.stringify(dependencies); fs.writeFileSync(path.join(root, 'dependency-manifest.json'), content['dependency-manifest.json']);
  const manifest = { version: '1.1.0', source_snapshot_sha256: snapshot, checks: { test: 1, 'test:ui': 1, 'test:server': 1, 'test:mcp': 1, 'test:mcp:built': 1, typecheck: true, build: true }, files_sha256: Object.fromEntries(Object.entries(content).filter(([name]) => !name.startsWith('node_modules/')).map(([name, bytes]) => [name, sha(bytes)])) };
  fs.writeFileSync(path.join(root, 'RUNTIME-MANIFEST.json'), JSON.stringify(manifest));
  return root;
}
test('complete current payload reports exact runtime/dependency inputs', t => {
  const result = verifyBackend(fixture(t), '1.1.0'); assert.equal(result.version, '1.1.0'); assert.equal(result.dependencyFiles, 2);
});
test('missing MCP entry is rejected even with a matching runtime inventory', t => {
  const root = fixture(t), file = path.join(root, 'RUNTIME-MANIFEST.json');
  const manifest = JSON.parse(fs.readFileSync(file));
  fs.rmSync(path.join(root, 'dist/server/mcp.mjs')); delete manifest.files_sha256['dist/server/mcp.mjs'];
  fs.writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => verifyBackend(root), /mcp\.mjs/);
});
for (const check of ['test:mcp', 'test:mcp:built']) test(`missing ${check} evidence is rejected`, t => {
  const root = fixture(t), file = path.join(root, 'RUNTIME-MANIFEST.json');
  const manifest = JSON.parse(fs.readFileSync(file)); delete manifest.checks[check];
  fs.writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => verifyBackend(root), new RegExp('Missing source check: ' + check));
});
test('old version, edited dependency and extra hidden runtime files are rejected', t => {
  const root = fixture(t); assert.throws(() => verifyBackend(root, '1.0.1'));
  fs.writeFileSync(path.join(root, 'node_modules/synthetic/index.js'), '// changed'); assert.throws(() => verifyBackend(root), /Dependency hash/);
  fs.writeFileSync(path.join(root, 'node_modules/synthetic/index.js'), '// fixture');
  fs.writeFileSync(path.join(root, '.extra'), 'untracked'); assert.throws(() => verifyBackend(root), /coverage differs/);
});
test('missing offline resource and injected user data are rejected', t => {
  const root = fixture(t); fs.rmSync(path.join(root, 'dist/client/offline-shell.html')); assert.throws(() => verifyBackend(root));
  fs.writeFileSync(path.join(root, 'dist/client/offline-shell.html'), '<html>'); fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data/private.sqlite'), 'synthetic'); assert.throws(() => verifyBackend(root), /User data/);
});

test('dependency hashing attributes nested package files only to that package', t => {
  const { hashFiles } = require('../scripts/prepare-backend.cjs');
  const root = fixture(t), parent = path.join(root, 'node_modules/synthetic');
  const child = path.join(parent, 'node_modules/child'); fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(child, 'index.js'), '// child');
  assert.deepEqual(Object.keys(hashFiles(parent, true)), ['index.js', 'package.json']);
  assert.deepEqual(Object.keys(hashFiles(child, true)), ['index.js']);
  assert(Object.keys(hashFiles(parent)).includes('node_modules/child/index.js'));
});

test('preparation rejects overlapping or unrelated destinations without changing files', t => {
  const { validateDestination } = require('../scripts/prepare-backend.cjs');
  const source = fixture(t), unrelated = fixture(t);
  assert.throws(() => validateDestination(source, source), /overlap/);
  assert.throws(() => validateDestination(source, path.join(source, 'generated')), /overlap/);
  assert.throws(() => validateDestination(source, path.dirname(source)), /overlap/);
  fs.rmSync(path.join(unrelated, 'RUNTIME-MANIFEST.json'));
  const before = fs.readFileSync(path.join(unrelated, 'package.json'));
  assert.throws(() => validateDestination(source, unrelated));
  assert(fs.readFileSync(path.join(unrelated, 'package.json')).equals(before));
});
test('known old generated backend can be regenerated, but user data blocks replacement', t => {
  const { validateDestination } = require('../scripts/prepare-backend.cjs');
  const source = fixture(t), destination = fixture(t);
  fs.writeFileSync(path.join(destination, 'RUNTIME-MANIFEST.json'), JSON.stringify({ product: 'qingdan-standalone', version: '1.0.1' }));
  assert.doesNotThrow(() => validateDestination(source, destination));
  fs.mkdirSync(path.join(destination, 'data'));
  assert.throws(() => validateDestination(source, destination), /user data/);
  assert(fs.existsSync(path.join(destination, 'data')));
});


test('backend destination canonicalization rejects overlap through ancestor aliases and missing suffixes', t => {
  const { validateDestination, canonicalDestination } = require('../scripts/prepare-backend.cjs');
  const base = fixture(t), source = path.join(base, 'application'), alias = path.join(base, 'alias');
  fs.mkdirSync(source); fs.symlinkSync(base, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const sourceAlias = path.join(alias, 'application');
  assert.equal(canonicalDestination(path.join(sourceAlias, 'missing', 'backend')), path.join(fs.realpathSync(source), 'missing', 'backend'));
  assert.throws(() => validateDestination(source, sourceAlias), /overlap/);
  assert.throws(() => validateDestination(source, path.join(sourceAlias, 'missing', 'backend')), /overlap/);
  assert.throws(() => validateDestination(sourceAlias, source), /overlap/);
  assert.throws(() => validateDestination(sourceAlias, alias), /overlap/);
  assert.doesNotThrow(() => validateDestination(sourceAlias, path.join(alias, 'separate', 'missing', 'backend')));
  assert(!fs.existsSync(path.join(base, 'separate')), 'validation must not create any paths');
});
test('backend canonicalization fails closed for broken links, non-directory parents and terminal directory links', t => {
  const { validateDestination, canonicalDestination } = require('../scripts/prepare-backend.cjs');
  const source = fixture(t), base = fixture(t);
  const ordinaryFile = path.join(base, 'file'); fs.writeFileSync(ordinaryFile, 'fixture');
  assert.throws(() => canonicalDestination(path.join(ordinaryFile, 'child')));
  const generated = path.join(base, 'generated'); fs.mkdirSync(generated);
  fs.writeFileSync(path.join(generated, 'RUNTIME-MANIFEST.json'), JSON.stringify({ product: 'qingdan-standalone' }));
  const linked = path.join(base, 'linked'); fs.symlinkSync(generated, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => validateDestination(source, linked), /real generated directory/);
  if (process.platform !== 'win32') {
    const broken = path.join(base, 'broken'); fs.symlinkSync(path.join(base, 'absent'), broken);
    assert.throws(() => canonicalDestination(broken), /Broken symlink/);
    assert.throws(() => canonicalDestination(path.join(broken, 'new', 'backend')), /Broken symlink/);
  }
});
