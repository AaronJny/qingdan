import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createLocalStorage, defaultMigrationsDir, storageMode, storagePaths } from './local-storage.ts';
import { applyHabitIncrement } from './habit-increment.ts';

const localStorageUrl = new URL('./local-storage.ts', import.meta.url).href;
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'qingdan-storage-'));
  const storage = createLocalStorage({ dataDir: directory });
  return { directory, storage, cleanup() { storage.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('all business migrations apply once with WAL, foreign keys and a busy wait', async () => {
  const f = fixture();
  try {
    assert.equal(await f.storage.database.prepare('PRAGMA journal_mode').first<string>('journal_mode'), 'wal');
    assert.equal(await f.storage.database.prepare('PRAGMA foreign_keys').first<number>('foreign_keys'), 1);
    assert.equal(await f.storage.database.prepare('PRAGMA busy_timeout').first<number>('timeout'), 5000);
    const expected = readdirSync(defaultMigrationsDir).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort();
    const applied = await f.storage.database.prepare('SELECT name FROM _qingdan_migrations ORDER BY name').all<{ name: string }>();
    assert.deepEqual(applied.results.map(row => row.name), expected);
    const tables = await f.storage.database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all<{ name: string }>();
    for (const name of ['records', 'history', 'members', 'invitations', 'attachments', 'notification_receipts', 'operation_receipts']) assert.ok(tables.results.some(row => row.name === name));
    f.storage.close();
    const restarted = createLocalStorage({ dataDir: f.directory });
    try { assert.equal(await restarted.database.prepare('SELECT COUNT(*) count FROM _qingdan_migrations').first<number>('count'), expected.length); }
    finally { restarted.close(); }
  } finally { f.cleanup(); }
});

test('prepared results are real and batch failures roll back every statement', async () => {
  const f = fixture();
  try {
    const db = f.storage.database;
    db.connection.exec('CREATE TABLE storage_fixture(id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const result = await db.batch([
      db.prepare('INSERT INTO storage_fixture VALUES (?,?)').bind('a', 'first'),
      db.prepare('INSERT INTO storage_fixture VALUES (?,?)').bind('b', 'second'),
      db.prepare('SELECT id,value FROM storage_fixture ORDER BY id'),
    ]);
    assert.equal(result[0].meta.changes, 1);
    assert.equal(result[1].meta.changes, 1);
    assert.equal(result[2].results.length, 2);
    await assert.rejects(db.batch([
      db.prepare('UPDATE storage_fixture SET value=? WHERE id=?').bind('incorrect', 'a'),
      db.prepare('INSERT INTO storage_fixture VALUES (?,?)').bind('a', 'duplicate'),
    ]), /UNIQUE/);
    assert.equal(await db.prepare('SELECT value FROM storage_fixture WHERE id=?').bind('a').first<string>('value'), 'first');
    assert.equal(await db.prepare('SELECT value FROM storage_fixture WHERE id=?').bind('missing').first(), null);
    assert.deepEqual(await db.prepare('SELECT id,value FROM storage_fixture ORDER BY id').raw(), [['a', 'first'], ['b', 'second']]);
    assert.equal((await db.prepare('DELETE FROM storage_fixture WHERE id=?').bind('missing').run()).meta.changes, 0);
    const returned = await db.prepare('UPDATE storage_fixture SET value=? WHERE id=? RETURNING id,value').bind('updated', 'b').run<{ id: string; value: string }>();
    assert.equal(returned.meta.changes, 1);
    assert.deepEqual(returned.results, [{ id: 'b', value: 'updated' }]);
    assert.equal((await db.prepare('SELECT * FROM storage_fixture').run()).meta.changes, 0);
    const foreign = createLocalStorage({ dataDir: join(f.directory, 'other') });
    try { await assert.rejects(db.batch([foreign.database.prepare('SELECT 1')]), /belong/); }
    finally { foreign.close(); }
  } finally { f.cleanup(); }
});

test('independent processes see durable business records and attachment bytes after restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qingdan-storage-restart-'));
  try {
    const write = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import {createLocalStorage} from ${JSON.stringify(localStorageUrl)};
      const s=createLocalStorage({dataDir:process.env.QINGDAN_TEST_DIRECTORY});
      await s.database.prepare('INSERT INTO records(id,owner_id,kind,data,updated_at) VALUES(?,?,?,?,?)').bind('task-persist','synthetic-owner','task','{"title":"Persistent task"}','2026-10-08T00:00:00Z').run();
      const bytes=new Uint8Array([0,1,127,128,254,255]);
      await s.bucket.put('synthetic-owner/attachment-persist',bytes,{httpMetadata:{contentType:'application/octet-stream'}});
      await s.database.prepare('INSERT INTO attachments(id,record_id,owner_id,name,mime,size,key,created_at) VALUES(?,?,?,?,?,?,?,?)').bind('attachment-persist','task-persist','synthetic-owner','small.bin','application/octet-stream',bytes.length,'synthetic-owner/attachment-persist','2026-10-08T00:00:00Z').run();
      s.close();
    `], { env: { ...process.env, QINGDAN_TEST_DIRECTORY: directory }, encoding: 'utf8' });
    assert.equal(write.status, 0, write.stderr);
    const read = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import {createLocalStorage} from ${JSON.stringify(localStorageUrl)};
      const s=createLocalStorage({dataDir:process.env.QINGDAN_TEST_DIRECTORY});
      const record=await s.database.prepare('SELECT data FROM records WHERE id=?').bind('task-persist').first();
      const attachment=await s.database.prepare('SELECT key FROM attachments WHERE id=?').bind('attachment-persist').first();
      const object=await s.bucket.get(attachment.key);
      console.log(JSON.stringify({title:JSON.parse(record.data).title,bytes:Array.from(new Uint8Array(await object.arrayBuffer())),mime:object.httpMetadata.contentType}));
      s.close();
    `], { env: { ...process.env, QINGDAN_TEST_DIRECTORY: directory }, encoding: 'utf8' });
    assert.equal(read.status, 0, read.stderr);
    assert.deepEqual(JSON.parse(read.stdout.trim()), { title: 'Persistent task', bytes: [0, 1, 127, 128, 254, 255], mime: 'application/octet-stream' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the existing habit service uses real atomic receipts that survive storage restart', async () => {
  const f = fixture();
  let restarted: ReturnType<typeof createLocalStorage> | undefined;
  try {
    await f.storage.database.prepare('INSERT INTO records(id,owner_id,kind,data,updated_at) VALUES(?,?,?,?,?)').bind('habit-real', 'synthetic-owner', 'habit', '{"title":"Water","target":8}', '2026-10-08T00:00:00Z').run();
    const result = await applyHabitIncrement(f.storage.database, 'synthetic-owner', 'habit-real', '2026-10-08', 1, 'persistent-increment', 1);
    assert.equal(result.replayed, false);
    f.storage.close();
    restarted = createLocalStorage({ dataDir: f.directory });
    const replay = await applyHabitIncrement(restarted.database, 'synthetic-owner', 'habit-real', '2026-10-08', 1, 'persistent-increment', 1);
    assert.equal(replay.replayed, true);
    assert.equal(await restarted.database.prepare('SELECT json_extract(data,\'$.value\') value FROM records WHERE id=?').bind(result.recordId).first<number>('value'), 1);
    assert.equal(await restarted.database.prepare('SELECT COUNT(*) count FROM operation_receipts').first<number>('count'), 1);
  } finally { restarted?.close(); f.cleanup(); }
});

test('a competing process releases its transaction and the configured busy wait permits the next write', async () => {
  const f = fixture();
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import {createLocalStorage} from ${JSON.stringify(localStorageUrl)};
    const s=createLocalStorage({dataDir:process.env.QINGDAN_TEST_DIRECTORY});
    s.database.connection.exec('BEGIN IMMEDIATE');
    s.database.connection.prepare('INSERT INTO records(id,owner_id,kind,data,updated_at) VALUES(?,?,?,?,?)').run('other-process','synthetic-owner','tag','{"title":"Other"}','2026-10-08T00:00:00Z');
    console.log('locked');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);
    s.database.connection.exec('COMMIT');
    s.close();
  `], { env: { ...process.env, QINGDAN_TEST_DIRECTORY: f.directory }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const exited = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', chunk => String(chunk).includes('locked') ? resolve() : reject(new Error('Unexpected child response')));
      child.once('error', reject);
      child.once('exit', code => { if (code !== 0) reject(new Error(stderr || 'Competing process failed')); });
    });
    const result = await f.storage.database.prepare('INSERT INTO records(id,owner_id,kind,data,updated_at) VALUES(?,?,?,?,?)').bind('after-lock','synthetic-owner','tag','{"title":"After"}','2026-10-08T00:00:00Z').run();
    assert.equal(result.meta.changes, 1);
    assert.equal(await exited, 0, stderr);
    assert.equal(await f.storage.database.prepare("SELECT COUNT(*) count FROM records WHERE owner_id='synthetic-owner'").first<number>('count'), 2);
  } finally { if (child.exitCode === null) child.kill(); f.cleanup(); }
});

test('object storage supports streams, metadata, atomic overwrite and explicit deletion', async () => {
  const f = fixture();
  try {
    const objects = f.storage.bucket;
    assert.equal(await objects.head('owner/missing'), null);
    const stream = new Blob(['small file']).stream();
    const object = await objects.put('owner/file', stream, { httpMetadata: { contentType: 'text/plain', cacheControl: 'private', cacheExpiry: new Date('2030-01-01T00:00:00Z') }, customMetadata: { purpose: 'synthetic' } });
    assert.equal(object.size, 10);
    assert.equal((await objects.get('owner/file'))?.size, 10);
    const headers = new Headers(); object.writeHttpMetadata(headers);
    assert.equal(headers.get('Content-Type'), 'text/plain');
    assert.equal(headers.get('Expires'), 'Tue, 01 Jan 2030 00:00:00 GMT');
    assert.equal(await (await objects.get('owner/file'))?.text(), 'small file');
    assert.equal(await new Response((await objects.get('owner/file'))?.body).text(), 'small file');
    assert.equal((await objects.head('owner/file'))?.customMetadata.purpose, 'synthetic');
    await objects.put('owner/file', new Uint8Array([9, 8, 7]), { httpMetadata: { contentType: 'application/octet-stream' } });
    assert.deepEqual(Array.from(new Uint8Array((await (await objects.get('owner/file'))?.arrayBuffer())!)), [9, 8, 7]);
    assert.equal(readdirSync(objects.directory).filter(name => name.startsWith('.tmp-')).length, 0);
    await objects.delete(['owner/file', 'owner/missing']);
    assert.equal(await objects.get('owner/file'), null);
  } finally { f.cleanup(); }
});

test('opaque object keys cannot address parent paths or absolute filesystem paths', async () => {
  const f = fixture();
  try {
    const unrelated = join(f.directory, 'unrelated.txt'); writeFileSync(unrelated, 'leave this file alone');
    for (const key of ['', '../unrelated.txt', '/tmp/unrelated.txt', 'owner/../../unrelated.txt', 'owner/./file', 'owner\\file', 'owner//file', 'owner/\0file']) {
      await assert.rejects(f.storage.bucket.put(key, 'invalid'), /Invalid object key/);
      await assert.rejects(f.storage.bucket.get(key), /Invalid object key/);
      await assert.rejects(f.storage.bucket.delete(key), /Invalid object key/);
    }
    assert.equal(readFileSync(unrelated, 'utf8'), 'leave this file alone');
    await f.storage.bucket.put('owner/bg:valid-unicode-青单', 'valid');
    assert.equal(await (await f.storage.bucket.get('owner/bg:valid-unicode-青单'))?.text(), 'valid');
  } finally { f.cleanup(); }
});

test('migration failures are atomic and previously applied SQL cannot silently change', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qingdan-migrations-'));
  const migrationsDir = join(directory, 'migrations'); mkdirSync(migrationsDir);
  const dataDir = join(directory, 'data');
  writeFileSync(join(migrationsDir, '0000_fixture.sql'), 'CREATE TABLE fixture(id TEXT PRIMARY KEY);');
  let storage = createLocalStorage({ dataDir, migrationsDir });
  try {
    storage.close();
    writeFileSync(join(migrationsDir, '0001_failure.sql'), 'CREATE TABLE partial(id TEXT); INSERT INTO nonexistent VALUES(1);');
    assert.throws(() => createLocalStorage({ dataDir, migrationsDir }), /no such table/);
    writeFileSync(join(migrationsDir, '0001_failure.sql'), 'CREATE TABLE recovered(id TEXT);');
    storage = createLocalStorage({ dataDir, migrationsDir });
    assert.equal(await storage.database.prepare("SELECT name FROM sqlite_schema WHERE name='partial'").first(), null);
    assert.equal(await storage.database.prepare('SELECT COUNT(*) count FROM _qingdan_migrations').first<number>('count'), 2);
    storage.close();
    writeFileSync(join(migrationsDir, '0000_fixture.sql'), 'CREATE TABLE fixture(id TEXT PRIMARY KEY, changed TEXT);');
    assert.throws(() => createLocalStorage({ dataDir, migrationsDir }), /has changed/);
  } finally { storage.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('mode markers persist local identity and require separate directories for mode changes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qingdan-mode-'));
  let local = createLocalStorage({ dataDir: join(directory, 'local'), mode: 'local' });
  const accountsDir = join(directory, 'accounts');
  let accounts = createLocalStorage({ dataDir: accountsDir, mode: 'accounts' });
  try {
    const principal = local.localPrincipalId;
    assert.match(principal!, /^local:[0-9a-f-]{36}$/);
    assert.equal(accounts.localPrincipalId, null);
    assert.equal(await local.database.prepare('SELECT COUNT(*) count FROM auth_users').first<number>('count'), 0);
    local.close(); accounts.close();
    assert.throws(() => createLocalStorage({ dataDir: join(directory, 'local'), mode: 'accounts' }), /belongs to local mode/);
    assert.throws(() => createLocalStorage({ dataDir: accountsDir, mode: 'local' }), /belongs to accounts mode/);
    local = createLocalStorage({ dataDir: join(directory, 'local'), mode: 'local' });
    accounts = createLocalStorage({ dataDir: accountsDir, mode: 'accounts' });
    assert.equal(local.localPrincipalId, principal);
    const otherLocal = createLocalStorage({ dataDir: join(directory, 'other-local'), mode: 'local' });
    try { assert.notEqual(otherLocal.localPrincipalId, principal); } finally { otherLocal.close(); }
  } finally { local.close(); accounts.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('nonempty directories without a verified mode marker are not automatically adopted', async () => {
  const f = fixture();
  try {
    await f.storage.database.prepare('INSERT INTO records(id,owner_id,kind,data,updated_at) VALUES(?,?,?,?,?)').bind('unmarked-record', 'synthetic-old-owner', 'tag', '{"title":"Keep owner"}', '2026-10-08T00:00:00Z').run();
    f.storage.database.connection.exec('DROP TABLE _qingdan_runtime');
    f.storage.close();
    for (const mode of ['local', 'accounts'] as const) assert.throws(() => createLocalStorage({ dataDir: f.directory, mode }), /no verified mode marker/);
  } finally { f.cleanup(); }
});

test('APP_MODE has a validated alias and default paths are separated by mode', () => {
  const primary = process.env.APP_MODE, alias = process.env.QINGDAN_MODE, dataDir = process.env.QINGDAN_DATA_DIR;
  try {
    delete process.env.APP_MODE; delete process.env.QINGDAN_MODE; delete process.env.QINGDAN_DATA_DIR;
    assert.equal(storageMode(), 'local');
    assert.equal(storagePaths().dataDir, join(process.cwd(), 'data', 'local'));
    process.env.APP_MODE = 'accounts';
    assert.equal(storagePaths().dataDir, join(process.cwd(), 'data', 'accounts'));
    process.env.QINGDAN_MODE = 'local';
    assert.throws(() => storageMode(), /disagree/);
    process.env.QINGDAN_MODE = 'accounts';
    assert.equal(storageMode(), 'accounts');
    assert.equal(storageMode('local'), 'local');
    process.env.APP_MODE = 'unknown'; delete process.env.QINGDAN_MODE;
    assert.throws(() => storageMode(), /must be local or accounts/);
  } finally {
    if (primary === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = primary;
    if (alias === undefined) delete process.env.QINGDAN_MODE; else process.env.QINGDAN_MODE = alias;
    if (dataDir === undefined) delete process.env.QINGDAN_DATA_DIR; else process.env.QINGDAN_DATA_DIR = dataDir;
  }
});

test('a stopped-server full-directory backup restores records, object bytes and the same local identity', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qingdan-storage-restore-'));
  const sourceDir = join(directory, 'source'), restoredDir = join(directory, 'restored');
  const source = createLocalStorage({ dataDir: sourceDir, mode: 'local' });
  let restored: ReturnType<typeof createLocalStorage> | undefined;
  try {
    const identity = source.localPrincipalId;
    await source.database.prepare('INSERT INTO records(id,owner_id,kind,data,updated_at) VALUES(?,?,?,?,?)').bind('backup-task', identity!, 'task', '{"title":"Restored"}', '2026-10-08T00:00:00Z').run();
    await source.bucket.put(identity + '/backup-file', new Uint8Array([3, 1, 4, 1, 5]));
    source.close();
    cpSync(sourceDir, restoredDir, { recursive: true, force: false, errorOnExist: true });
    restored = createLocalStorage({ dataDir: restoredDir, mode: 'local' });
    assert.equal(restored.localPrincipalId, identity);
    const record = await restored.database.prepare('SELECT owner_id,data FROM records WHERE id=?').bind('backup-task').first<{ owner_id: string; data: string }>();
    assert.equal(record?.owner_id, identity);
    assert.equal(JSON.parse(record!.data).title, 'Restored');
    assert.deepEqual(Array.from(new Uint8Array((await (await restored.bucket.get(identity + '/backup-file'))?.arrayBuffer())!)), [3, 1, 4, 1, 5]);
  } finally { source.close(); restored?.close(); rmSync(directory, { recursive: true, force: true }); }
});
