import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAgentConfiguration, readAgentDescriptor } from './descriptor.ts';
const fixture = {schemaVersion: 1, endpoint: 'http://127.0.0.1:4311/tools', token: 'fictional-owner-only-token', binding: {id: createHash('sha256').update(JSON.stringify([1, 'builtin', 'qingdan-owned-local', 'fictional-user'])).digest('hex'), mode: 'builtin', origin: 'qingdan-owned-local', accountId: 'fictional-user'}};

test('private descriptor loads once and rotation cannot alter returned connection', {skip: process.platform === 'win32'}, () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'qingdan-descriptor-'))); chmodSync(dir, 0o700);
  const file = join(dir, fixture.binding.id + '.json');
  try {
    writeFileSync(file, JSON.stringify(fixture), {mode: 0o600});
    const copied = join(dir, 'wrong-binding.json'); writeFileSync(copied, JSON.stringify(fixture), {mode: 0o600}); assert.throws(() => readAgentDescriptor(copied)); rmSync(copied);
    writeFileSync(file, JSON.stringify({...fixture, binding: {...fixture.binding, accountId: 'different-fictional-user'}})); assert.throws(() => readAgentDescriptor(file));
    writeFileSync(file, JSON.stringify(fixture));
    const loaded = readAgentDescriptor(file);
    assert.deepEqual(loaded, {endpoint: fixture.endpoint, token: fixture.token});
    writeFileSync(file, JSON.stringify({...fixture, token: 'fictional-replacement-token'}));
    assert.equal(loaded.token, fixture.token);
    assert.equal(readAgentConfiguration(['--descriptor', file], {}).token, 'fictional-replacement-token');
    assert.equal(readAgentConfiguration([], {QINGDAN_AGENT_DESCRIPTOR: file}).token, 'fictional-replacement-token');
    chmodSync(file, 0o644); assert.throws(() => readAgentDescriptor(file)); chmodSync(file, 0o600);
    chmodSync(dir, 0o755); assert.throws(() => readAgentDescriptor(file)); chmodSync(dir, 0o700);
    const alias = join(dir, 'alias.json'); symlinkSync(file, alias); assert.throws(() => readAgentDescriptor(alias));
    const hardlink = join(dir, 'hard.json'); linkSync(file, hardlink); assert.throws(() => readAgentDescriptor(file)); rmSync(hardlink);
    const folder = join(dir, 'folder'); mkdirSync(folder); assert.throws(() => readAgentDescriptor(folder));
    writeFileSync(file, 'x'.repeat(17 * 1024)); assert.throws(() => readAgentDescriptor(file));
    writeFileSync(file, JSON.stringify({...fixture, endpoint: 'https://remote.invalid/tools'})); assert.throws(() => readAgentDescriptor(file));
    writeFileSync(file, JSON.stringify({...fixture, binding: {id: 'invalid'}})); assert.throws(() => readAgentDescriptor(file));
    rmSync(file); assert.throws(() => readAgentDescriptor(file));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('descriptor selection fails closed and never falls back after a descriptor error', () => {
  assert.throws(() => readAgentConfiguration(['--unexpected'], {}));
  assert.throws(() => readAgentConfiguration([], {QINGDAN_AGENT_DESCRIPTOR: '/missing/fictional.json', QINGDAN_AGENT_ENDPOINT: fixture.endpoint, QINGDAN_AGENT_TOKEN: fixture.token}));
  assert.throws(() => readAgentDescriptor('relative.json'));
  assert.deepEqual(readAgentConfiguration([], {QINGDAN_AGENT_ENDPOINT: fixture.endpoint, QINGDAN_AGENT_TOKEN: fixture.token}), {endpoint: fixture.endpoint, token: fixture.token});
});
