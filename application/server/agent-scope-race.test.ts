import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initializeStorage, closeStorage, database, localPrincipalId } from '../lib/storage';
import { saveRecord, find } from '../lib/server';
import { executeAgentTool } from '../lib/agent-capabilities';

test('update receipt serialization rechecks scope after a concurrent move', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qingdan-agent-scope-race-'));
  process.env.APP_MODE = 'local';
  initializeStorage({ dataDir: dir, mode: 'local', migrationsDir: resolve('drizzle') });
  const db = database(), prepare = db.prepare;
  try {
    const user = localPrincipalId(), scope = { listIds: ['fixture-a'], writeEnabled: true };
    for (const id of ['fixture-a', 'fixture-private']) await saveRecord({ id, kind: 'list', expectedRevision: 0, data: { title: id } }, user);
    await executeAgentTool(user, scope, 'create_task', { id: 'fixture-task', listId: 'fixture-a', title: 'Synthetic task', clientOperationId: 'create' });
    const args = { id: 'fixture-task', expectedRevision: 1, clientOperationId: 'edit', changes: { title: 'Edited synthetic task' } };
    await executeAgentTool(user, scope, 'update_task', args);
    let moved = false;
    // Deterministic interleaving after allowedTask but before receipt replay's
    // current-record read. The storage belongs only to this test process.
    db.prepare = sql => {
      if (!moved && sql.startsWith('SELECT request_hash,result FROM operation_receipts')) {
        moved = true;
        (db as any).connection.prepare("UPDATE records SET list_id='fixture-private',data=json_set(data,'$.listId','fixture-private','$.description','Synthetic private content'),revision=revision+1 WHERE id='fixture-task'").run();
      }
      return prepare.call(db, sql);
    };
    await assert.rejects(executeAgentTool(user, scope, 'update_task', args), (error: any) => error.status === 403);
    assert.equal(moved, true);
  } finally { db.prepare = prepare; closeStorage(); await rm(dir, { recursive: true, force: true }); }
});

test('completion receipt excludes children moved to an archived granted list', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qingdan-agent-archived-replay-'));
  process.env.APP_MODE = 'local';
  initializeStorage({ dataDir: dir, mode: 'local', migrationsDir: resolve('drizzle') });
  try {
    const user = localPrincipalId(), scope = { listIds: ['fixture-a', 'fixture-b'], writeEnabled: true };
    for (const id of scope.listIds) await saveRecord({ id, kind: 'list', expectedRevision: 0, data: { title: id } }, user);
    for (const [id, parentId] of [['fixture-root', ''], ['fixture-child', 'fixture-root']]) await saveRecord({ id, kind: 'task', expectedRevision: 0, data: { title: id, listId: 'fixture-a', parentId, status: 'open' } }, user);
    const args = { id: 'fixture-root', expectedRevision: 1, clientOperationId: 'complete' };
    await executeAgentTool(user, scope, 'complete_task', args);
    const child = await find('fixture-child', user);
    await saveRecord({ id: child.id, kind: 'task', expectedRevision: child.revision, data: { ...child.data, listId: 'fixture-b', parentId: '' } }, user);
    const list = await find('fixture-b', user);
    await saveRecord({ id: list.id, kind: 'list', expectedRevision: list.revision, data: { ...list.data, archived: true } }, user);
    await assert.rejects(executeAgentTool(user, scope, 'get_task', { id: child.id }), (error: any) => error.status === 404);
    const result: any = await executeAgentTool(user, scope, 'complete_task', args);
    assert.equal(result.replayed, true);
    assert.deepEqual(result.tasks.map((task: any) => task.id), ['fixture-root']);
  } finally { closeStorage(); await rm(dir, { recursive: true, force: true }); }
});
