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
    'dist/server/main.mjs': '// fixture', 'dist/server/users.mjs': '// fixture', 'dist/server/calendar-worker.mjs': '// fixture', 'dist/client/index.html': '<html>',
    'dist/client/offline-shell.html': '<html>', 'dist/client/offline-shell-manifest.json': '{}', 'dist/client/qingdan-offline-worker.js': '// fixture',
    'drizzle/meta/_journal.json': '{}', 'drizzle/0000_fixture.sql': '-- fixture',
    'node_modules/synthetic/package.json': JSON.stringify({ name: 'synthetic', version: '1.0.0' }), 'node_modules/synthetic/index.js': '// fixture',
  };
  for (const [name, bytes] of Object.entries(content)) { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
  const dependencyFiles = Object.fromEntries(Object.entries(content).filter(([name]) => name.startsWith('node_modules/synthetic/')).map(([name, bytes]) => [name.slice('node_modules/synthetic/'.length), sha(bytes)]));
  const dependencies = { source_snapshot_sha256: snapshot, packages: [{ name: 'synthetic', location: 'node_modules/synthetic', version: '1.0.0', integrity: 'sha512-fixture', files_sha256: dependencyFiles }] };
  content['dependency-manifest.json'] = JSON.stringify(dependencies); fs.writeFileSync(path.join(root, 'dependency-manifest.json'), content['dependency-manifest.json']);
  const manifest = { version: '1.1.0', source_snapshot_sha256: snapshot, checks: { test: 1, 'test:ui': 1, 'test:server': 1, typecheck: true, build: true }, files_sha256: Object.fromEntries(Object.entries(content).filter(([name]) => !name.startsWith('node_modules/')).map(([name, bytes]) => [name, sha(bytes)])) };
  fs.writeFileSync(path.join(root, 'RUNTIME-MANIFEST.json'), JSON.stringify(manifest));
  return root;
}
test('complete current payload reports exact runtime/dependency inputs', t => {
  const result = verifyBackend(fixture(t), '1.1.0'); assert.equal(result.version, '1.1.0'); assert.equal(result.dependencyFiles, 2);
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
