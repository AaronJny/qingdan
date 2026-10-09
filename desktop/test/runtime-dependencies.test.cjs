'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { packageName, projectLock } = require('../scripts/runtime-dependencies.cjs');
function fixture() {
  const pkg = { name: 'synthetic', version: '1.1.0', engines: { node: '>=24 <25' }, dependencies: { '@scope/runtime': '^1', 'unused-client': '^1' } };
  const record = (version, extra = {}) => ({ version, resolved: 'https://registry.npmjs.org/synthetic.tgz', integrity: 'sha512-fixture', ...extra });
  const lock = { version: pkg.version, lockfileVersion: 3, packages: { '': { version: pkg.version }, 'node_modules/@scope/runtime': record('1.2.0', { dependencies: { child: '^2' } }), 'node_modules/child': record('2.0.1'), 'node_modules/unused-client': record('1.0.0') } };
  return { pkg, lock };
}
test('external package names preserve scopes and omit Node builtins', () => {
  assert.equal(packageName('@scope/runtime/subpath'), '@scope/runtime'); assert.equal(packageName('ical.js'), 'ical.js');
  assert.equal(packageName('node:sqlite'), null); assert.equal(packageName('fs'), null);
  assert.throws(() => packageName('../unsafe')); assert.throws(() => packageName('https://example.test/code'));
});
test('runtime closure retains exact checked lock versions and excludes frontend-only dependencies', () => {
  const { pkg, lock } = fixture(); const result = projectLock(pkg, lock, ['node:sqlite', '@scope/runtime/subpath']);
  assert.deepEqual(result.runtimePackage.dependencies, { '@scope/runtime': '1.2.0' });
  assert.deepEqual(Object.keys(result.runtimeLock.packages), ['', 'node_modules/@scope/runtime', 'node_modules/child']);
  assert.equal(result.runtimeLock.packages[''].version, '1.1.0'); assert(!result.runtimePackage.devDependencies);
});
test('missing or platform-sensitive dependencies fail before installing anything', () => {
  for (const patch of [{ dev: true }, { hasInstallScript: true }, { os: ['linux'] }, { resolved: 'https://unreviewed.example/code.tgz' }]) {
    const { pkg, lock } = fixture(); Object.assign(lock.packages['node_modules/@scope/runtime'], patch);
    assert.throws(() => projectLock(pkg, lock, ['@scope/runtime']));
  }
  const { pkg, lock } = fixture(); delete lock.packages['node_modules/child'];
  assert.throws(() => projectLock(pkg, lock, ['@scope/runtime']), /not found/);
  assert.throws(() => projectLock(pkg, fixture().lock, ['unapproved-import']), /production dependency/);
});
test('package/lock version drift is rejected', () => {
  const { pkg, lock } = fixture(); lock.packages[''].version = '1.0.1';
  assert.throws(() => projectLock(pkg, lock, ['@scope/runtime']), /versions differ/);
});

test('nested lock dependencies resolve before hoisted packages', () => {
  const { pkg, lock } = fixture();
  lock.packages['node_modules/@scope/runtime/node_modules/child'] = { ...lock.packages['node_modules/child'], version: '2.1.0' };
  const result = projectLock(pkg, lock, ['@scope/runtime']);
  assert.equal(result.runtimeLock.packages['node_modules/@scope/runtime/node_modules/child'].version, '2.1.0');
  assert(!result.runtimeLock.packages['node_modules/child']);
});
