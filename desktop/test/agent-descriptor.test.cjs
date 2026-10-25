'use strict';
// Only private temporary fixtures; no application/user profile is read or changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AgentDescriptorStore, bindingFor } = require('../src/agent-descriptor.cjs');
const { AgentGateway } = require('../src/agent-gateway.cjs');
const { endpoint } = require('../src/policy.cjs');
const uid = process.getuid?.();
const posix = { skip: process.platform === 'win32' };
const localAccount = 'local:11111111-1111-4111-8111-111111111111';
function fixture(t) { const profile = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-agent-descriptor-'))); t.after(() => fs.rmSync(profile, { recursive: true, force: true })); return { profile, store: new AgentDescriptorStore({ profile }) }; }
test('stable descriptor binding separates server/account/database identities, not changing local ports', () => {
  const local = bindingFor(endpoint('http://127.0.0.1:51111/', true), localAccount);
  assert.equal(local.id, bindingFor(endpoint('http://127.0.0.1:52222/', true), localAccount).id);
  for (const other of [bindingFor(endpoint('http://127.0.0.1:51111/', true), 'local:another-database'), bindingFor(endpoint('https://a.example/'), localAccount), bindingFor(endpoint('https://b.example/'), localAccount), bindingFor(endpoint('https://a.example/'), 'different-account')]) assert.notEqual(local.id, other.id);
  assert.notEqual(bindingFor(endpoint('https://a.example/'), 'a').id, bindingFor(endpoint('https://a.example/'), 'b').id);
});
test('descriptor writes atomically with private modes; revoke removes it and startup never restores it', posix, t => {
  const { store, profile } = fixture(t), connection = endpoint('https://fixture.example/');
  const before = store.pathFor(connection, 'fixture-account'); assert.equal(fs.existsSync(path.dirname(before)), false);
  const file = store.write(connection, 'fixture-account', 'http://127.0.0.1:51234/tools', 'x'.repeat(43));
  assert.equal(file, before); assert.equal(fs.statSync(file).mode & 0o777, 0o600); assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  const value = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(value.schemaVersion, 1); assert.equal(value.token, 'x'.repeat(43)); assert.equal(value.binding.id + '.json', path.basename(file));
  assert.equal(store.remove(), true); assert.equal(fs.existsSync(file), false);
  store.write(connection, 'fixture-account', 'http://127.0.0.1:51235/tools', 'y'.repeat(43));
  const restarted = new AgentDescriptorStore({ profile }); restarted.cleanupStale(); assert.equal(fs.existsSync(file), false); assert.equal(restarted.active, null);
  assert.equal(restarted.write(connection, 'fixture-account', 'http://127.0.0.1:51236/tools', 'z'.repeat(43)), file);
});
test('unsafe roots, file symlinks, hardlinks, public files and owner mismatch fail closed', posix, t => {
  const { store, profile } = fixture(t), connection = endpoint('https://fixture.example/');
  const outside = path.join(profile, 'outside'); fs.mkdirSync(outside, { mode: 0o700 });
  fs.symlinkSync(outside, store.directory); assert.throws(() => store.write(connection, 'a', 'http://127.0.0.1:1234/tools', 'x'.repeat(43))); fs.unlinkSync(store.directory);
  fs.mkdirSync(store.directory, { mode: 0o755 }); assert.throws(() => store.write(connection, 'a', 'http://127.0.0.1:1234/tools', 'x'.repeat(43))); fs.chmodSync(store.directory, 0o700);
  const file = store.pathFor(connection, 'a'), target = path.join(outside, 'target'); fs.writeFileSync(target, 'untouched', { mode: 0o600 });
  fs.symlinkSync(target, file); assert.throws(() => store.write(connection, 'a', 'http://127.0.0.1:1234/tools', 'x'.repeat(43))); assert.equal(fs.readFileSync(target, 'utf8'), 'untouched'); fs.unlinkSync(file);
  fs.linkSync(target, file); assert.throws(() => store.write(connection, 'a', 'http://127.0.0.1:1234/tools', 'x'.repeat(43))); fs.unlinkSync(file);
  fs.writeFileSync(file, '{}', { mode: 0o644 }); assert.throws(() => store.write(connection, 'a', 'http://127.0.0.1:1234/tools', 'x'.repeat(43)));
  const wrongOwner = new AgentDescriptorStore({ profile, uid: uid + 1 }); assert.throws(() => wrongOwner.cleanupStale());
});
test('atomic write failure deletes temporary credential and does not grant a descriptor', posix, t => {
  const { profile } = fixture(t);
  const injected = Object.create(fs); injected.renameSync = () => { throw new Error('Synthetic write failure'); };
  const store = new AgentDescriptorStore({ profile, filesystem: injected });
  assert.throws(() => store.write(endpoint('https://fixture.example/'), 'a', 'http://127.0.0.1:1234/tools', 'x'.repeat(43)));
  assert.deepEqual(fs.readdirSync(store.directory), []); assert.equal(store.active, null);
});
test('Windows never equates Unix mode bits with ACL protection and writes no descriptor', t => {
  const { profile } = fixture(t), store = new AgentDescriptorStore({ profile, platform: 'win32', uid: 123 });
  assert.equal(store.supported, false); assert.equal(store.pathFor(endpoint('https://fixture.example/'), 'a'), null); store.cleanupStale();
  assert.throws(() => store.write(endpoint('https://fixture.example/'), 'a', 'http://127.0.0.1:1234/tools', 'x'.repeat(43)));
  assert.equal(fs.existsSync(store.directory), false);
});
test('gateway descriptor grant returns no token to renderer and removes file on every revoke', posix, async t => {
  const { profile } = fixture(t), connection = endpoint('http://127.0.0.1:51111/', true);
  const gateway = new AgentGateway({ profile, selected: () => ({ connection, available: true, fetch: async (url, options) => Response.json(url.endsWith('/api/auth/me') ? { user: { userId: localAccount }, csrfToken: 'a'.repeat(64) } : { result: { items: [{ id: 'list-a', writable: JSON.parse(options.body).scope.writeEnabled }], nextCursor: null } }) }) });
  t.after(() => gateway.close());
  const off = await gateway.get(localAccount); assert.equal(off.enabled, false); assert.ok(off.descriptorPath); assert.equal(fs.existsSync(off.descriptorPath), false);
  const on = await gateway.save(localAccount, { enabled: true, writeEnabled: false, listIds: ['list-a'], rotateToken: true });
  assert.equal(on.descriptorPath, off.descriptorPath); assert.equal(on.token, undefined); assert.ok(fs.existsSync(on.descriptorPath));
  const old = JSON.parse(fs.readFileSync(on.descriptorPath, 'utf8')).token;
  const renewed = await gateway.save(localAccount, { enabled: true, writeEnabled: false, listIds: ['list-a'], rotateToken: true });
  assert.equal(renewed.token, undefined); assert.notEqual(JSON.parse(fs.readFileSync(on.descriptorPath, 'utf8')).token, old);
  gateway.revoke(); assert.equal(fs.existsSync(on.descriptorPath), false); assert.equal(gateway.grant, null);
});
