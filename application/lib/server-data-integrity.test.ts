import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bootstrap, find, saveRecord } from './server';
import { initializeStorage, closeStorage, database, bucket } from './storage';
import { restoreBackup } from '../app/api/import/route';
import type { AppRecord, Kind, RecordData } from './types';

const createdAt = '2026-10-08T00:00:00Z';
const user = (userId: string) => ({ userId, email: userId + '@example.test', displayName: userId });

async function fixture(run: () => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'qingdan-data-integrity-'));
  initializeStorage({ dataDir: dir, mode: 'accounts', migrationsDir: resolve('drizzle') });
  try { await run(); }
  finally { closeStorage(); await rm(dir, { recursive: true, force: true }); }
}

async function record(id: string, ownerId: string, kind: Kind, data: RecordData) {
  await database().prepare('INSERT INTO records (id,owner_id,kind,list_id,data,revision,updated_at,deleted) VALUES (?,?,?,?,?,1,?,0)')
    .bind(id, ownerId, kind, kind === 'task' ? data.listId! : null, JSON.stringify(data), createdAt).run();
}

async function attachment(id: string, recordId: string, ownerId: string) {
  const bytes = new TextEncoder().encode('Synthetic attachment bytes for ' + id);
  const key = ownerId + '/' + id;
  await bucket().put(key, bytes);
  await database().prepare('INSERT INTO attachments (id,record_id,owner_id,name,mime,size,key,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id, recordId, ownerId, id + '.txt', 'text/plain', bytes.length, key, createdAt).run();
  return { bytes, key };
}

async function movableTree() {
  await record('source-list', 'source', 'list', { title: 'Source list', sections: [] });
  await record('target-list', 'target', 'list', { title: 'Target list', sections: ['Destination section'] });
  for (const [id, parentId] of [['root', ''], ['child', 'root'], ['grandchild', 'child']] as const) {
    await record(id, 'source', 'task', { title: id, listId: 'source-list', parentId, status: 'open' });
  }
  for (const listId of ['source-list', 'target-list']) {
    await database().prepare('INSERT INTO members (list_id,user_id,email,role,joined_at) VALUES (?,?,?,?,?)')
      .bind(listId, 'editor', 'editor@example.test', 'edit', createdAt).run();
  }
  return find('root', 'editor', true);
}

const move = (root: AppRecord) => saveRecord({
  id: root.id, kind: 'task', expectedRevision: root.revision, clientOperationId: 'move-tree',
  data: { ...root.data, listId: 'target-list', section: 'Destination section' },
}, 'editor');

test('moving a task to another account updates root and nested attachment ownership without relocating bytes', async () => fixture(async () => {
  const root = await movableTree();
  const files = new Map<string, Awaited<ReturnType<typeof attachment>>>();
  for (const id of ['root', 'child', 'grandchild']) files.set(id, await attachment('file-' + id, id, 'source'));
  await record('unrelated', 'source', 'task', { title: 'Unrelated task', listId: 'source-list' });
  await attachment('file-unrelated', 'unrelated', 'source');

  const result = await move(root);
  assert.deepEqual(result.related.map(r => r.id).sort(), ['child', 'grandchild']);
  for (const id of ['root', 'child', 'grandchild']) {
    const moved = await find(id, 'target');
    assert.equal(moved.ownerId, 'target');
    assert.equal(moved.listId, 'target-list');
    assert.equal(moved.data.listId, 'target-list');
    assert.equal(moved.data.section, 'Destination section');
    assert.equal(moved.revision, 2);
    const file = await database().prepare('SELECT owner_id,key FROM attachments WHERE id=?').bind('file-' + id).first<{ owner_id: string; key: string }>();
    assert.equal(file!.owner_id, 'target');
    assert.equal(file!.key, files.get(id)!.key);
    assert.deepEqual(new Uint8Array(await (await bucket().get(file!.key))!.arrayBuffer()), files.get(id)!.bytes);
    await assert.rejects(find(id, 'source'), (error: any) => error.status === 404);
  }
  assert.deepEqual((await bootstrap(user('target'))).attachments.map(a => a.id).sort(), ['file-child', 'file-grandchild', 'file-root']);
  assert.deepEqual((await bootstrap(user('source'))).attachments.map(a => a.id), ['file-unrelated']);
  assert.equal((await database().prepare('SELECT owner_id FROM attachments WHERE id=?').bind('file-unrelated').first<{ owner_id: string }>())!.owner_id, 'source');

  const replay = await move(root);
  assert.equal('replayed' in replay && replay.replayed, true);
  assert.equal((await find('root', 'target')).revision, 2);
  assert.equal((await database().prepare('SELECT COUNT(*) n FROM history').first<{ n: number }>())!.n, 3);
}));

test('a concurrent descendant change prevents all task and attachment ownership updates', async () => fixture(async () => {
  const root = await movableTree();
  for (const id of ['root', 'child', 'grandchild']) await attachment('file-' + id, id, 'source');
  const db = database(), originalBatch = db.batch.bind(db);
  db.batch = async statements => {
    await db.prepare('UPDATE records SET revision=revision+1 WHERE id=?').bind('grandchild').run();
    return originalBatch(statements);
  };
  try { await assert.rejects(move(root), (error: any) => error.status === 409); }
  finally { db.batch = originalBatch; }
  for (const id of ['root', 'child', 'grandchild']) {
    const current = await find(id, 'source');
    assert.equal(current.ownerId, 'source');
    assert.equal(current.listId, 'source-list');
    assert.equal((await db.prepare('SELECT owner_id FROM attachments WHERE id=?').bind('file-' + id).first<{ owner_id: string }>())!.owner_id, 'source');
  }
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM history').first<{ n: number }>())!.n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM operation_receipts').first<{ n: number }>())!.n, 0);
}));

test('bootstrap attachment metadata uses current record access even when stored ownership is stale', async () => fixture(async () => {
  await record('private-target', 'target', 'task', { title: 'Private target', listId: 'target-list' });
  await attachment('stale-former-owner-file', 'private-target', 'source');
  await attachment('orphan-file', 'missing-record', 'source');
  await record('source-task', 'source', 'task', { title: 'Source task', listId: 'source-list' });
  await attachment('stale-current-owner-file', 'source-task', 'target');
  await record('source-countdown', 'source', 'countdown', { title: 'Private countdown' });
  await attachment('countdown-file', 'source-countdown', 'source');
  await database().prepare('INSERT INTO members (list_id,user_id,email,role,joined_at) VALUES (?,?,?,?,?)')
    .bind('target-list', 'reader', 'reader@example.test', 'read', createdAt).run();

  assert.deepEqual((await bootstrap(user('source'))).attachments.map(a => a.id).sort(), ['countdown-file', 'stale-current-owner-file']);
  assert.deepEqual((await bootstrap(user('target'))).attachments.map(a => a.id), ['stale-former-owner-file']);
  assert.deepEqual((await bootstrap(user('reader'))).attachments.map(a => a.id), ['stale-former-owner-file']);
  await database().prepare('DELETE FROM members WHERE user_id=?').bind('reader').run();
  assert.deepEqual((await bootstrap(user('reader'))).attachments, []);
}));

test('v1 import remaps focus habit links to restored habits and clears external or wrong-kind links', async () => fixture(async () => {
  const backupRecord = (id: string, kind: Kind, data: RecordData): AppRecord => ({
    id, kind, ownerId: 'old-owner', listId: null, data, revision: 1, updatedAt: createdAt, deleted: false,
  });
  const body = { format: 'qingdan', version: 1, operationId: 'habit-focus-import', records: [
    backupRecord('old-habit', 'habit', { title: 'Imported habit' }),
    backupRecord('old-tag', 'tag', { title: 'Imported tag' }),
    backupRecord('linked-focus', 'focus', { title: 'Linked focus', habitId: 'old-habit', focusStatus: 'finished', seconds: 60 }),
    backupRecord('external-focus', 'focus', { title: 'External focus', habitId: 'missing-habit', focusStatus: 'paused', seconds: 30 }),
    backupRecord('wrong-kind-focus', 'focus', { title: 'Wrong-kind focus', habitId: 'old-tag', focusStatus: 'finished', seconds: 15 }),
  ] };
  const restored = await (await restoreBackup(user('source'), body)).json();
  assert.equal(restored.count, 5);
  assert.deepEqual(restored.notices, ['部分专注记录的关联习惯未包含在备份中或类型无效，已断开关联；专注记录及其时间保留。']);
  const rows = (await database().prepare('SELECT * FROM records').all()).results;
  const habit = rows.find((r: any) => r.kind === 'habit') as any;
  assert.notEqual(habit.id, 'old-habit');
  const imported = rows.filter((r: any) => r.kind === 'focus').map((r: any) => JSON.parse(r.data));
  assert.equal(imported.find(r => r.title === 'Linked focus').habitId, habit.id);
  assert.equal(imported.find(r => r.title === 'External focus').habitId, '');
  assert.equal(imported.find(r => r.title === 'External focus').focusStatus, 'cancelled');
  assert.equal(imported.find(r => r.title === 'Wrong-kind focus').habitId, '');
  const linked = rows.find((r: any) => r.kind === 'focus' && JSON.parse(r.data).title === 'Linked focus') as any;
  const focus = await find(linked.id, 'source');
  await saveRecord({ id: focus.id, kind: 'focus', data: { ...focus.data, seconds: 120 }, expectedRevision: focus.revision }, 'source');
  const replay = await (await restoreBackup(user('source'), body)).json();
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.notices, restored.notices);
  assert.equal((await database().prepare('SELECT COUNT(*) n FROM records').first<{ n: number }>())!.n, 5);
}));
