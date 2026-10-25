import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initializeStorage, closeStorage, database, localPrincipalId } from '../lib/storage';
import { saveRecord, find } from '../lib/server';
import { executeAgentTool } from '../lib/agent-capabilities';
import { dispatchApi } from './routes';
import { createLocalUser } from '../lib/auth';

for (const mode of ['local', 'accounts'] as const) test(`agent capabilities preserve ${mode} authentication, scope, revisions and completion`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qingdan-agent-synthetic-'));
  const origin = mode === 'local' ? 'http://127.0.0.1:4310' : 'https://synthetic-agent.example.test';
  process.env.APP_MODE = mode; process.env.APP_ORIGIN = origin;
  initializeStorage({ dataDir: dir, mode, migrationsDir: resolve('drizzle') });
  try {
    let session: any, cookie = '';
    if (mode === 'accounts') {
      await createLocalUser({ email: 'agent-fixture@example.test', password: 'Synthetic fixture password only 2026!', displayName: 'Fictional tester' }, { firstAdmin: true });
      const login = await dispatchApi(new Request(origin + '/api/auth/login', { method: 'POST', headers: { origin, 'x-qingdan': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'agent-fixture@example.test', password: 'Synthetic fixture password only 2026!' }) }));
      assert.equal(login.status, 200); session = await login.json(); cookie = login.headers.get('set-cookie')!.split(';')[0];
    } else session = await (await dispatchApi(new Request(origin + '/api/auth/me'))).json();
    const user = session.user.userId;
    const headers = { origin, cookie, 'content-type': 'application/json', 'x-qingdan': '1', 'x-qingdan-csrf': session.csrfToken, 'x-qingdan-expected-account': user };
    const scope = { listIds: ['fictional-garden'], writeEnabled: true };
    const raw = (name: string, args: any, s: any = scope, h: any = headers) => dispatchApi(new Request(origin + '/api/agent/tools', { method: 'POST', headers: h, body: JSON.stringify({ name, arguments: args, scope: s }) }));
    const call = async (name: string, args: any, s = scope) => { const res = await raw(name, args, s); assert.equal(res.status, 200, await res.clone().text()); return (await res.json()).result; };
    // A read must not create an inbox or any other record.
    assert.deepEqual(await call('list_lists', {}), { items: [], nextCursor: null });
    assert.equal((await database().prepare('SELECT COUNT(*) n FROM records').first<any>())!.n, 0);
    for (const id of ['fictional-garden', 'fictional-private']) await saveRecord({ id, kind: 'list', expectedRevision: 0, data: { title: id, listType: 'task' } }, user);
    const create = { id: 'fictional-seed', listId: 'fictional-garden', title: 'Plant fictional seedlings', description: 'A synthetic example', dueDate: '2026-11-05', clientOperationId: 'create-seed' };
    assert.equal((await raw('create_task', create, { ...scope, writeEnabled: false })).status, 403);
    assert.equal((await raw('create_task', { ...create, listId: 'fictional-private' })).status, 403);
    assert.equal((await raw('create_task', { ...create, status: 'done' })).status, 400);
    assert.equal((await raw('create_task', { ...create, dueDate: '2026-02-30' })).status, 400);
    for (const h of [{ ...headers, origin: 'https://evil.example.test' }, { ...headers, 'x-qingdan-csrf': '' }, { ...headers, 'x-qingdan-expected-account': 'wrong-account' }]) assert.ok([403, 409].includes((await raw('create_task', create, scope, h)).status));
    if (mode === 'accounts') assert.ok([401, 403].includes((await raw('list_lists', {}, scope, { ...headers, cookie: '' })).status));
    const made = await call('create_task', create); assert.equal(made.task.revision, 1);
    assert.equal((await call('create_task', create)).replayed, true);
    assert.equal((await raw('create_task', { ...create, title: 'Different input' })).status, 409);
    const update = { id: create.id, expectedRevision: 1, clientOperationId: 'edit-seed', changes: { title: 'Water fictional seedlings' } };
    const edited = await call('update_task', update); assert.equal(edited.task.revision, 2);
    // Retrying a patch after a later UI edit must replay, not overwrite newer data.
    const current = await find(create.id, user);
    await saveRecord({ id: current.id, kind: 'task', expectedRevision: current.revision, data: { ...current.data, description: 'Newer fictional note' }, clientOperationId: 'ui-edit' }, user);
    assert.equal((await call('update_task', update)).replayed, true);
    assert.equal((await call('get_task', { id: create.id })).task.description, 'Newer fictional note');
    assert.equal((await raw('update_task', { ...update, changes: { title: 'Different patch' } })).status, 409);
    assert.equal((await raw('update_task', { ...update, clientOperationId: 'new-op-stale-revision' })).status, 409);
    assert.equal((await raw('update_task', { ...update, changes: { listId: 'fictional-private' } })).status, 400);
    assert.equal((await raw('get_task', { id: create.id }, { listIds: [], writeEnabled: false })).status, 403);
    await saveRecord({ id: 'fictional-hidden', kind: 'task', expectedRevision: 0, data: { title: 'Private fictional task', listId: 'fictional-private', status: 'open' } }, user);
    for (const id of ['fictional-second', 'fictional-third']) await call('create_task', { ...create, id, clientOperationId: id });
    const page1 = await call('search_tasks', { limit: 1 }); assert.equal(page1.items.length, 1); assert.ok(page1.nextCursor);
    const page2 = await call('search_tasks', { cursor: page1.nextCursor, limit: 1 }); assert.notEqual(page1.items[0].id, page2.items[0].id);
    const found = await call('search_tasks', { query: 'WATER', dueFrom: '2026-11-01', dueTo: '2026-11-10', status: 'open' }); assert.equal(found.items.length, 1);
    assert.equal('description' in found.items[0], false); assert.equal('comments' in found.items[0], false); assert.equal('ownerId' in found.items[0], false);
    assert.equal((await raw('search_tasks', { limit: 51 })).status, 400);
    assert.equal((await raw('search_tasks', { listId: 'fictional-private' })).status, 403);
    assert.equal((await raw('unknown_tool', {})).status, 400);
    assert.equal((await raw('get_task', { id: create.id }, { ...scope, listIds: '*' })).status, 400);
    // Completion uses existing subtree + recurrence semantics, and one receipt.
    const recurring = await saveRecord({ id: 'fictional-repeat', kind: 'task', expectedRevision: 0, data: { title: 'Inspect fictional greenhouse', listId: 'fictional-garden', status: 'open', dueDate: '2026-11-01', recurrence: { start: { date: '2026-11-01', timeZone: 'UTC' }, rule: { frequency: 'daily' } } } }, user);
    await call('create_task', { id: 'fictional-child', listId: 'fictional-garden', title: 'Check fictional gauge', parentId: recurring.id, clientOperationId: 'child-create' });
    const complete = { id: recurring.id, expectedRevision: 1, clientOperationId: 'complete-repeat' };
    const done = await call('complete_task', complete); assert.ok(done.nextTaskId); assert.equal(done.tasks.find((t: any) => t.id === 'fictional-child').status, 'done');
    const repeated = await call('complete_task', complete); assert.equal(repeated.replayed, true); assert.equal(repeated.nextTaskId, done.nextTaskId);
    assert.equal((await raw('complete_task', { ...complete, clientOperationId: 'new-completion' })).status, 409);
    assert.equal((await database().prepare("SELECT COUNT(*) n FROM operation_receipts WHERE id='complete:agent:complete-repeat'").first<any>())!.n, 1);
    // Restart preserves operation receipts without persisting a separate agent DB.
    closeStorage(); initializeStorage({ dataDir: dir, mode, migrationsDir: resolve('drizzle') });
    assert.equal((await executeAgentTool(user, scope, 'update_task', update) as any).replayed, true);
    if (mode === 'local') assert.equal(localPrincipalId(), user);
  } finally { closeStorage(); await rm(dir, { recursive: true, force: true }); }
});

test('agent scope never overrides list membership or read-only roles', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qingdan-agent-permissions-'));
  process.env.APP_MODE = 'local'; process.env.APP_ORIGIN = 'http://127.0.0.1:4310';
  initializeStorage({ dataDir: dir, mode: 'local', migrationsDir: resolve('drizzle') });
  try {
    const owner = localPrincipalId(), viewer = 'synthetic-viewer';
    await saveRecord({ id: 'fictional-shared-list', kind: 'list', expectedRevision: 0, data: { title: 'Fictional shared garden' } }, owner);
    await saveRecord({ id: 'fictional-shared-task', kind: 'task', expectedRevision: 0, data: { title: 'Inspect fictional pots', status: 'open', listId: 'fictional-shared-list' } }, owner);
    const scope = { listIds: ['fictional-shared-list'], writeEnabled: true };
    assert.deepEqual(await executeAgentTool(viewer, scope, 'search_tasks', {}), { items: [], nextCursor: null });
    await assert.rejects(executeAgentTool(viewer, scope, 'get_task', { id: 'fictional-shared-task' }));
    await database().prepare('INSERT INTO members(list_id,user_id,email,role,joined_at) VALUES(?,?,?,?,?)').bind('fictional-shared-list', viewer, 'viewer@example.test', 'view', new Date().toISOString()).run();
    assert.equal((await executeAgentTool(viewer, scope, 'list_lists', {}) as any).items[0].writable, false);
    assert.equal((await executeAgentTool(viewer, scope, 'search_tasks', {}) as any).items.length, 1);
    await assert.rejects(executeAgentTool(viewer, scope, 'complete_task', { id: 'fictional-shared-task', expectedRevision: 1, clientOperationId: 'viewer-complete' }), (error: any) => error.status === 403);
    await assert.rejects(executeAgentTool(viewer, scope, 'update_task', { id: 'fictional-shared-task', expectedRevision: 1, clientOperationId: 'viewer-edit', changes: { title: 'Denied' } }), (error: any) => error.status === 403);
    assert.equal((await find('fictional-shared-task', owner)).revision, 1);
  } finally { closeStorage(); await rm(dir, { recursive: true, force: true }); }
});
