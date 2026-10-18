'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { ClassicLevel } = require('classic-level');
const { createLegacyRecovery, decodeString } = require('../src/legacy-local-recovery.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const ACCOUNT = 'local:12345678-1234-4123-8123-123456789abc';
const ORIGIN = 'http://127.0.0.1:36379';
const quickKey = `qingdan:quick-draft:${ACCOUNT}`;
const partitionFor = origin => 'qingdan-desktop-local-' + sha(origin).slice(0, 20);
function encode(value, utf16 = false) { return Buffer.concat([Buffer.from([utf16 ? 0 : 1]), Buffer.from(value, utf16 ? 'utf16le' : 'latin1')]); }
function storageKey(origin, name) { return Buffer.concat([Buffer.from(`_${origin}\0`), encode(name)]); }
async function profile(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qingdan-legacy-')); t.after(async () => { /* Sealed backups deliberately need owner chmod for test cleanup. */ async function unlock(p) { for (const entry of await fs.readdir(p, { withFileTypes: true })) { const file = path.join(p, entry.name); if (entry.isDirectory()) { await fs.chmod(file, 0o700); await unlock(file); } } } await unlock(dir); await fs.rm(dir, { recursive: true, force: true }); }); return dir; }
async function fixture(root, rows = [[quickKey, 'draft']], options = {}) {
  const origin = options.origin || ORIGIN, partition = options.partition || partitionFor(origin);
  const dir = path.join(root, 'Partitions', partition, 'Local Storage', 'leveldb');
  await fs.mkdir(dir, { recursive: true });
  const db = new ClassicLevel(dir, { keyEncoding: 'buffer', valueEncoding: 'buffer' });
  await db.open();
  try {
    if (options.version !== null) await db.put(Buffer.from('VERSION'), options.version || Buffer.from('1'), { sync: true });
    for (const [key, value] of rows) await db.put(Buffer.isBuffer(key) ? key : storageKey(origin, key), Buffer.isBuffer(value) ? value : encode(value, true), { sync: true });
    if (options.compact) await db.compactRange(Buffer.alloc(0), Buffer.from([255]));
  } finally { await db.close(); }
  return { dir, partition, origin };
}
async function hashes(dir) { const result = {}; for (const name of await fs.readdir(dir)) { const stat = await fs.lstat(path.join(dir, name)); if (stat.isFile()) result[name] = sha(await fs.readFile(path.join(dir, name))); } return result; }
function codes(recovery) { return recovery.summary().diagnostics.map(diagnostic => diagnostic.code); }

test('clean installation has no recovery and creates no recovery folder', async t => {
  const root = await profile(t), recovery = createLegacyRecovery({ profile: root });
  const summary = await recovery.prepare();
  assert.equal(summary.status, 'none'); assert.equal(summary.requiresReview, false);
  await assert.rejects(fs.access(path.join(root, 'local-recovery')), { code: 'ENOENT' });
});

test('official native binding copies and quarantines Chinese, emoji, Latin1, exact IDs/revisions; originals and immutable backups stay unchanged', async t => {
  const root = await profile(t);
  const queueKey = `qingdan:queue:write:${encodeURIComponent(ACCOUNT)}:op-001`;
  const queue = JSON.stringify({ id: 'op-001', recordId: 'task-01', kind: 'task', base: { id: 'task-01', kind: 'task', revision: 42, data: { title: 'before' } }, desired: { title: 'after' }, deleted: false });
  const source = await fixture(root, [[quickKey, '中文😀'], [`qingdan:comment-draft:${ACCOUNT}:task-01`, encode('café Å £ ÿ')], [queueKey, queue]], { compact: true });
  const before = await hashes(source.dir);
  const opened = [];
  const recovery = createLegacyRecovery({ profile: root, _driverFactory: directory => { opened.push(directory); return new ClassicLevel(directory, { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false }); } });
  const summary = await recovery.prepare();
  assert.equal(summary.status, 'pending'); assert.equal(summary.requiresReview, true); assert.equal(summary.candidateCount, 3); assert.equal(summary.validCandidateCount, 3);
  assert.deepEqual(await hashes(source.dir), before);
  assert(opened.every(dir => dir.startsWith(path.join(root, 'local-recovery', 'working') + path.sep)));
  const candidates = recovery.candidates(); assert.equal(candidates.find(item => item.key === quickKey).value, '中文😀'); assert.equal(candidates.find(item => item.key === queueKey).value, queue);
  assert.equal(candidates.find(item => item.key.includes('comment-draft')).value, 'café Å £ ÿ');
  const backup = path.join(root, 'local-recovery', 'snapshots', summary.backupIds[0]);
  assert.deepEqual(await hashes(path.join(backup, 'leveldb')), before);
  const manifestBytes = await fs.readFile(path.join(backup, 'manifest.json'));
  assert.equal((await fs.readFile(path.join(backup, 'manifest.sha256'), 'utf8')).trim(), sha(manifestBytes));
  const beforeBackup = await hashes(path.join(backup, 'leveldb'));
  const again = createLegacyRecovery({ profile: root }); await again.prepare();
  assert.deepEqual(again.summary().backupIds, summary.backupIds); assert.deepEqual(await hashes(path.join(backup, 'leveldb')), beforeBackup); assert.deepEqual(await hashes(source.dir), before);
});

test('language-only scan stays pending but is informational; acknowledgment survives restart without resolving/importing anything', async t => {
  const root = await profile(t); await fixture(root, [['qingdan-language', 'en']]);
  const recovery = createLegacyRecovery({ profile: root }); await recovery.prepare();
  assert.equal(recovery.summary().status, 'pending'); assert.equal(recovery.summary().requiresReview, false);
  await recovery.acknowledgeContinue(); assert.equal(recovery.summary().acknowledgedContinue, true);
  assert.equal(recovery.summary().status, 'pending'); assert.equal(recovery.candidates()[0].status, 'quarantined');
  const again = createLegacyRecovery({ profile: root }); await again.prepare();
  assert.equal(again.summary().acknowledgedContinue, true); assert.equal(again.summary().status, 'pending');
});

test('existing legacy partition with no Local Storage remains pending and never inspects other browser storage', async t => {
  const root = await profile(t), partition = partitionFor(ORIGIN);
  const parent = path.join(root, 'Partitions', partition); await fs.mkdir(parent, { recursive: true });
  await fs.writeFile(path.join(parent, 'Cookies'), 'private sentinel'); await fs.mkdir(path.join(parent, 'IndexedDB'));
  const recovery = createLegacyRecovery({ profile: root }); await recovery.prepare();
  assert.equal(recovery.summary().status, 'pending'); assert.equal(recovery.summary().requiresReview, true); assert.equal(recovery.summary().candidateCount, 0);
  assert(codes(recovery).includes('NO_LOCAL_STORAGE')); assert.equal(await fs.readFile(path.join(parent, 'Cookies'), 'utf8'), 'private sentinel');
});

test('only known direct LevelDB filenames are copied; unknown files and other profiles are excluded', async t => {
  const root = await profile(t), source = await fixture(root);
  await fs.writeFile(path.join(source.dir, 'Cookies'), 'do not read');
  await fs.mkdir(path.join(root, 'Partitions', 'qingdan-desktop-remote-not-local'), { recursive: true });
  const recovery = createLegacyRecovery({ profile: root }); await recovery.prepare();
  assert.equal(recovery.summary().sourceCount, 1); assert(codes(recovery).includes('EXCLUDED_FILES'));
  const copied = await fs.readdir(path.join(root, 'local-recovery', 'snapshots', recovery.summary().backupIds[0], 'leveldb'));
  assert(!copied.includes('Cookies')); assert.equal(await fs.readFile(path.join(source.dir, 'Cookies'), 'utf8'), 'do not read');
});

test('file changes during copying preserve partial evidence and prevent opening any LevelDB copy', async t => {
  const root = await profile(t), source = await fixture(root); let mutated = false, opens = 0;
  const recovery = createLegacyRecovery({ profile: root, _driverFactory() { opens++; throw Error('must not open'); }, _testHook: async phase => { if (phase === 'before-source-recheck' && !mutated) { mutated = true; await fs.appendFile(path.join(source.dir, 'LOG'), 'concurrent modification'); } } });
  await recovery.prepare(); assert(codes(recovery).includes('SOURCE_CHANGED')); assert.equal(opens, 0); assert.equal(recovery.summary().status, 'pending');
  assert((await fs.readdir(path.join(root, 'local-recovery', 'snapshots'))).length > 0);
});

test('same-sized source hash changes and replaced files are caught before native parsing', async t => {
  const root = await profile(t), source = await fixture(root); let mutated = false;
  const recovery = createLegacyRecovery({ profile: root, _testHook: async phase => { if (phase === 'copied-file' && !mutated) { mutated = true; const file = path.join(source.dir, 'CURRENT'); const content = await fs.readFile(file); content[0] = content[0] === 77 ? 78 : 77; await fs.writeFile(file, content); } } });
  await recovery.prepare(); assert(codes(recovery).includes('SOURCE_CHANGED')); assert.equal(recovery.summary().candidateCount, 0);
});

test('symlinked source directories and recognized files are rejected without following them', async t => {
  const root = await profile(t), outside = await profile(t); const external = await fixture(outside);
  await fs.mkdir(path.join(root, 'Partitions')); await fs.symlink(path.join(outside, 'Partitions', external.partition), path.join(root, 'Partitions', external.partition));
  const before = await hashes(external.dir), recovery = createLegacyRecovery({ profile: root }); await recovery.prepare();
  assert(codes(recovery).includes('UNSAFE_DIRECTORY')); assert.deepEqual(await hashes(external.dir), before);
  const root2 = await profile(t), second = await fixture(root2); await fs.rm(path.join(second.dir, 'CURRENT')); await fs.symlink(path.join(external.dir, 'CURRENT'), path.join(second.dir, 'CURRENT'));
  const next = createLegacyRecovery({ profile: root2 }); await next.prepare(); assert(codes(next).includes('UNSAFE_FILE'));
});

test('corrupt immutable backup is never overwritten or reopened and previous candidate evidence is retained', async t => {
  const root = await profile(t); await fixture(root);
  const recovery = createLegacyRecovery({ profile: root }); await recovery.prepare();
  const id = recovery.summary().backupIds[0], target = path.join(root, 'local-recovery', 'snapshots', id, 'leveldb', 'CURRENT');
  await fs.chmod(target, 0o600); await fs.writeFile(target, 'corrupt snapshot');
  let opens = 0; const again = createLegacyRecovery({ profile: root, _driverFactory() { opens++; throw Error('not allowed'); } }); await again.prepare();
  assert.equal(opens, 0); assert(codes(again).includes('BACKUP_HASH_MISMATCH')); assert.equal(again.summary().status, 'pending'); assert.equal(again.summary().candidateCount, 1);
  assert.equal(await fs.readFile(target, 'utf8'), 'corrupt snapshot'); assert.equal(again.candidates()[0].valid, false);
});

test('cross-port differing values and missing keys are conflicts, not a union or replay', async t => {
  const root = await profile(t); await fixture(root, [[quickKey, 'first'], [`qingdan:comment-draft:${ACCOUNT}:one`, 'only first']]);
  await fixture(root, [[quickKey, 'second']], { origin: 'http://127.0.0.1:44444' });
  const recovery = createLegacyRecovery({ profile: root }); await recovery.prepare();
  assert.equal(recovery.summary().conflictCount, 2); assert.equal(recovery.summary().candidateCount, 3);
  const conflicts = recovery.exportDocument().conflicts;
  assert(conflicts.some(conflict => conflict.variants.some(variant => variant.absent)));
  assert(recovery.candidates().every(candidate => candidate.status === 'quarantined'));
});

test('malformed recognized encodings and schemas remain raw quarantine evidence; unknown keys are not candidates', async t => {
  const root = await profile(t); await fixture(root, [[quickKey, Buffer.from([4, 10])], [`qingdan:comment-draft:${ACCOUNT}:one`, Buffer.from([0, 65])], [`qingdan:pending-import:${ACCOUNT}`, '{malformed'], ['qingdan:not-allowed:anything', 'unknown'], ['authToken', 'secret']]);
  const recovery = createLegacyRecovery({ profile: root }); await recovery.prepare();
  assert.equal(recovery.summary().candidateCount, 3); assert.equal(recovery.summary().validCandidateCount, 0);
  assert(codes(recovery).includes('UNKNOWN_STRING_ENCODING')); assert(codes(recovery).includes('INVALID_UTF16')); assert(codes(recovery).includes('INVALID_LOCAL_ENTRY')); assert(codes(recovery).includes('UNKNOWN_KEYS'));
  assert(recovery.candidates().some(candidate => candidate.rawValueBase64 === 'BAo=')); assert(!JSON.stringify(recovery.exportDocument()).includes('secret'));
});

test('unknown VERSION including high-bit ASCII aliases never marks candidates valid', async t => {
  for (const version of [Buffer.from('2'), Buffer.from([0xb1]), null]) {
    const root = await profile(t); await fixture(root, [[quickKey, 'known']], { version });
    const recovery = createLegacyRecovery({ profile: root }); await recovery.prepare();
    assert(codes(recovery).includes('UNKNOWN_STORAGE_VERSION')); assert.equal(recovery.summary().validCandidateCount, 0); assert.equal(recovery.summary().status, 'pending');
  }
});

test('remote origin, wrong partition hash, and remote account entries are never admitted', async t => {
  const root = await profile(t); await fixture(root, [[storageKey('https://example.com', quickKey), 'remote'], [storageKey('http://127.0.0.1:44444', quickKey), 'other port'], ['qingdan:quick-draft:remote-user', 'remote account']]);
  const recovery = createLegacyRecovery({ profile: root }); await recovery.prepare();
  assert.equal(recovery.summary().candidateCount, 0); assert(codes(recovery).includes('ORIGIN_MISMATCH')); assert(codes(recovery).includes('UNKNOWN_KEYS')); assert.equal(recovery.summary().requiresReview, true);
});

test('bounded copy and iterator limits fail visibly with pending status', async t => {
  const root = await profile(t); await fixture(root);
  const recovery = createLegacyRecovery({ profile: root, limits: { fileBytes: 1 } }); await recovery.prepare();
  assert(codes(recovery).includes('FILE_LIMIT')); assert.equal(recovery.summary().status, 'pending');
  const root2 = await profile(t); await fixture(root2);
  const iteratorLimited = createLegacyRecovery({ profile: root2, limits: { entries: 1 } }); await iteratorLimited.prepare(); assert(codes(iteratorLimited).includes('ENTRY_LIMIT'));
});

test('removed original partitions cannot erase previously pending recovery', async t => {
  const root = await profile(t); await fixture(root); const first = createLegacyRecovery({ profile: root }); await first.prepare();
  await fs.rename(path.join(root, 'Partitions'), path.join(root, 'original-preserved'));
  const again = createLegacyRecovery({ profile: root }); await again.prepare(); assert.equal(again.summary().status, 'pending'); assert.equal(again.summary().candidateCount, 1);
});

test('empty vector and unpaired UTF16 surrogate preserve Chromium string semantics', () => {
  assert.equal(decodeString(Buffer.alloc(0)), ''); assert.equal(decodeString(encode('\ud800', true)), '\ud800'); assert.throws(() => decodeString(Buffer.from([0, 65])), /UTF-16LE/);
});

test('unchanged recovery reuses sealed evidence and does not accumulate reports or working databases', async t => {
  const root = await profile(t); await fixture(root); const first = createLegacyRecovery({ profile: root }); await first.prepare();
  const reports = await fs.readdir(path.join(root, 'local-recovery', 'reports'));
  const work = await fs.readdir(path.join(root, 'local-recovery', 'working'));
  const again = createLegacyRecovery({ profile: root, _driverFactory() { throw Error('must reuse verified immutable evidence'); } }); await again.prepare();
  assert.deepEqual(await fs.readdir(path.join(root, 'local-recovery', 'reports')), reports); assert.deepEqual(await fs.readdir(path.join(root, 'local-recovery', 'working')), work); assert.equal(again.summary().validCandidateCount, 1);
});

test('a new excluded file cannot hide behind a previously verified snapshot fingerprint', async t => {
  const root = await profile(t), source = await fixture(root, [['qingdan-language', 'en']]); const first = createLegacyRecovery({ profile: root }); await first.prepare(); assert.equal(first.summary().requiresReview, false);
  await fs.writeFile(path.join(source.dir, 'unrecognized-state'), 'preserve');
  const again = createLegacyRecovery({ profile: root }); await again.prepare(); assert(codes(again).includes('EXCLUDED_FILES')); assert.equal(again.summary().requiresReview, true);
});

test('missing or corrupt persisted state remains pending even after original partitions disappear', async t => {
  for (const mode of ['missing', 'corrupt']) {
    const root = await profile(t); await fixture(root); const first = createLegacyRecovery({ profile: root }); await first.prepare();
    await fs.rename(path.join(root, 'Partitions'), path.join(root, 'original-preserved'));
    const pointer = path.join(root, 'local-recovery', 'state.json'); if (mode === 'missing') await fs.rm(pointer); else await fs.writeFile(pointer, '{bad json');
    const again = createLegacyRecovery({ profile: root }); await again.prepare(); assert.equal(again.summary().status, 'pending'); assert.equal(again.summary().requiresReview, true); assert(again.summary().diagnostics.length > 0);
  }
});

test('failed acknowledgment cannot claim durable user continuation', async t => {
  const root = await profile(t); await fixture(root); const recovery = createLegacyRecovery({ profile: root }); await recovery.prepare();
  const ack = path.join(root, 'local-recovery', 'acknowledgements'); await fs.rmdir(ack); await fs.writeFile(ack, 'blocked');
  await assert.rejects(recovery.acknowledgeContinue(), /non-directory/); assert.equal(recovery.summary().acknowledgedContinue, false); assert.equal(recovery.summary().status, 'pending');
});

test('actual damaged/truncated WAL never becomes a complete or auto-approved recovery', async t => {
  for (const mode of ['flip', 'truncate']) {
    const root = await profile(t), source = await fixture(root, [[quickKey, 'prior']], { compact: true });
    const db = new ClassicLevel(source.dir, { keyEncoding: 'buffer', valueEncoding: 'buffer' }); await db.open(); await db.put(storageKey(ORIGIN, quickKey), encode('latest'), { sync: true }); await db.close();
    const logs = (await fs.readdir(source.dir)).filter(name => /^[0-9]+\.log$/.test(name)).sort(), log = path.join(source.dir, logs.at(-1));
    const bytes = await fs.readFile(log); assert(bytes.length > 8); if (mode === 'flip') { bytes[bytes.length - 1] ^= 0xff; await fs.writeFile(log, bytes); } else await fs.writeFile(log, bytes.subarray(0, bytes.length - 8));
    const before = await hashes(source.dir), recovery = createLegacyRecovery({ profile: root }); await recovery.prepare();
    assert.equal(recovery.summary().status, 'pending'); assert.equal(recovery.summary().completeness, 'unverified'); assert.equal(recovery.summary().requiresReview, true); assert.equal(recovery.summary().acknowledgedContinue, false); assert.deepEqual(await hashes(source.dir), before);
    assert(recovery.candidates().every(candidate => candidate.status === 'quarantined'));
  }
});

test('global historical recovery budget prevents new snapshots without deleting existing evidence', async t => {
  const root = await profile(t); await fixture(root); const recovery = createLegacyRecovery({ profile: root, limits: { recoveryBytes: 1024 * 1024 - 1 } }); await recovery.prepare();
  assert(codes(recovery).includes('RECOVERY_SIZE_LIMIT')); assert.equal(recovery.summary().status, 'pending'); assert.equal((await fs.readdir(path.join(root, 'local-recovery', 'snapshots'))).length, 0);
  // The small diagnostic can still be durably acknowledged within remaining capacity.
  await recovery.acknowledgeContinue(); assert.equal(recovery.summary().acknowledgedContinue, true); assert.equal(recovery.summary().status, 'pending');
});

test('closed disposable working copies are cleaned without deleting immutable evidence', async t => {
  const root = await profile(t); await fixture(root); const recovery = createLegacyRecovery({ profile: root }); await recovery.prepare();
  assert.deepEqual(await fs.readdir(path.join(root, 'local-recovery', 'working')), []); assert.equal((await fs.readdir(path.join(root, 'local-recovery', 'snapshots'))).length, 1);
  assert.equal(recovery.exportDocument().sources[0].workingCopyRetained, false);
});

test('native driver never follows malformed CURRENT indirection outside the isolated working copy', async t => {
  for (const pointer of ['../../../../Cookies\n', '/tmp/private-file\n', 'MANIFEST-000001\n\n']) {
    const root = await profile(t), source = await fixture(root); await fs.writeFile(path.join(source.dir, 'CURRENT'), pointer);
    let opens = 0; const recovery = createLegacyRecovery({ profile: root, _driverFactory() { opens++; throw Error('must not open'); } }); await recovery.prepare();
    assert.equal(opens, 0); assert(codes(recovery).includes('INVALID_CURRENT')); assert.equal(recovery.summary().status, 'pending'); assert.equal(await fs.readFile(path.join(source.dir, 'CURRENT'), 'utf8'), pointer);
  }
});

test('a source changing while its copied database is parsed is still uncertain even for preferences', async t => {
  const root = await profile(t), source = await fixture(root, [['qingdan-language', 'en']]);
  const recovery = createLegacyRecovery({ profile: root, _driverFactory(working) {
    const db = new ClassicLevel(working, { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false });
    const open = db.open.bind(db); db.open = async () => { await fs.appendFile(path.join(source.dir, 'LOG'), 'concurrent writer'); return open(); }; return db;
  } });
  await recovery.prepare(); assert(codes(recovery).includes('SOURCE_CHANGED')); assert.equal(recovery.summary().requiresReview, true); assert.equal(recovery.summary().status, 'pending');
});

test('candidate pages are bounded, detached slices with validated offsets and limits', async t => {
  const root = await profile(t); await fixture(root, Array.from({ length: 32 }, (_, index) => [`qingdan:comment-draft:${ACCOUNT}:${String(index).padStart(2, '0')}`, 'value-' + index]));
  const recovery = createLegacyRecovery({ profile: root }); await recovery.prepare();
  const first = recovery.candidatePage(); assert.equal(first.items.length, 25); assert.equal(first.total, 32); assert.equal(first.nextOffset, 25);
  const last = recovery.candidatePage(first.nextOffset); assert.equal(last.items.length, 7); assert.equal(last.nextOffset, null);
  assert.deepEqual([...first.items, ...last.items], recovery.candidates()); first.items[0].value = 'changed'; assert.equal(recovery.candidatePage(0, 1).items[0].value, 'value-0');
  assert.deepEqual(recovery.candidatePage(999, 50), { items: [], total: 32, nextOffset: null });
  for (const [offset, limit] of [[-1, 25], [0.5, 25], [Number.MAX_SAFE_INTEGER + 1, 25], [0, 0], [0, 51], [0, 1.5], ['0', 25]]) assert.throws(() => recovery.candidatePage(offset, limit), /nonnegative safe integer/);
});

test('corrupt evidence invalidates an older continuation acknowledgment even with no original partition', async t => {
  const root = await profile(t); await fixture(root); const first = createLegacyRecovery({ profile: root }); await first.prepare(); await first.acknowledgeContinue();
  const current = path.join(root, 'local-recovery', 'snapshots', first.summary().backupIds[0], 'leveldb', 'CURRENT'); await fs.chmod(current, 0o600); await fs.writeFile(current, 'tampered');
  await fs.rename(path.join(root, 'Partitions'), path.join(root, 'original-preserved'));
  const again = createLegacyRecovery({ profile: root }); await again.prepare(); assert.equal(again.summary().acknowledgedContinue, false); assert.equal(again.summary().requiresReview, true); assert.equal(again.summary().status, 'pending'); assert(codes(again).includes('BACKUP_HASH_MISMATCH'));
});

test('status diagnostics are grouped and bounded while export preserves complete per-candidate evidence', async t => {
  const root = await profile(t); await fixture(root, Array.from({ length: 160 }, (_, index) => [`qingdan:comment-draft:${ACCOUNT}:${index}`, Buffer.from([4, index % 255])]));
  const recovery = createLegacyRecovery({ profile: root }); await recovery.prepare();
  assert.equal(recovery.summary().candidateCount, 160); assert.equal(recovery.summary().diagnosticCount, 160); assert.equal(recovery.summary().diagnostics.length, 1); assert.equal(recovery.summary().diagnostics[0].occurrences, 160);
  assert.equal(recovery.exportDocument().sources[0].diagnostics.length, 160); assert.equal(recovery.candidatePage(0, 25).items.length, 25);
});

test('combined candidate quota preserves complete backups and remains pending', async t => {
  const root = await profile(t); await fixture(root, [[quickKey, 'one'], [`qingdan:comment-draft:${ACCOUNT}:x`, 'two']]); await fixture(root, [[quickKey, 'three'], [`qingdan:comment-draft:${ACCOUNT}:x`, 'four']], { origin: 'http://127.0.0.1:44444' });
  // Each database has VERSION plus two business records; the combined review
  // contains at most three candidates, so the second source remains evidence.
  const recovery = createLegacyRecovery({ profile: root, limits: { entries: 3 } }); await recovery.prepare();
  assert(codes(recovery).includes('TOTAL_ENTRY_LIMIT')); assert(recovery.summary().candidateCount <= 3); assert.equal(recovery.summary().backupIds.length, 2); assert.equal(recovery.summary().status, 'pending'); assert.equal(recovery.summary().requiresReview, true);
});

test('oversized candidate output preserves raw backup evidence and still permits durable explicit continuation', async t => {
  const root = await profile(t); await fixture(root, [[quickKey, 'x'.repeat(2000)]]);
  const recovery = createLegacyRecovery({ profile: root, limits: { candidateBytes: 1024 } }); await recovery.prepare();
  assert(codes(recovery).includes('CANDIDATE_SIZE_LIMIT')); assert.equal(recovery.summary().candidateCount, 0); assert.equal(recovery.summary().backupIds.length, 1);
  await recovery.acknowledgeContinue(); assert.equal(recovery.summary().acknowledgedContinue, true); assert.equal(recovery.summary().status, 'pending');
});
