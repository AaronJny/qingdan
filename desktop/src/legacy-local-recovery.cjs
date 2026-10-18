'use strict';
// Legacy browser databases are evidence, never a live session or an import source.
// Only classic-level opens the disposable SECOND copy; originals and sealed
// snapshots are never passed to a database API. A successful parse is incomplete
// evidence: LevelDB can silently ignore a truncated WAL.
const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const PARTITION = /^qingdan-desktop-local-[a-f0-9]{20}$/;
const LEVEL_FILE = /^(?:CURRENT|LOCK|LOG(?:\.old)?|MANIFEST-[0-9]{6,}|[0-9]{6,}\.(?:log|ldb|sst|dbtmp))$/;
const ID = /^[a-f0-9-]{36}$/;
const LIMITS = Object.freeze({ partitions: 64, directoryEntries: 4096, files: 512, fileBytes: 64 * 1024 * 1024, sourceBytes: 256 * 1024 * 1024, totalBytes: 512 * 1024 * 1024, recoveryBytes: 1024 * 1024 * 1024, recoveryFiles: 16384, entries: 20000, entryBytes: 8 * 1024 * 1024, decodedBytes: 64 * 1024 * 1024, candidateBytes: 32 * 1024 * 1024, totalCandidateBytes: 64 * 1024 * 1024, documentBytes: 128 * 1024 * 1024 });
const LIMITATIONS = Object.freeze([
  'Recovery candidates are quarantined and have not been imported or replayed.',
  'Successful LevelDB parsing cannot prove completeness; damaged or truncated WAL records may be skipped silently.',
  'Only copied Local Storage is inspected. IndexedDB and sessionStorage originals remain untouched; previous sessionStorage fallback and selected file bytes may not be recoverable.',
  'Offline access is never enabled by recovery. Saved SQLite tasks remain authoritative.'
]);
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const issue = (code, message, extra = {}) => ({ code, message, ...extra });
const validDiagnostics = value => Array.isArray(value) && value.every(item => item && typeof item === 'object' && typeof item.code === 'string' && typeof item.message === 'string');
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function errorIssue(error, extra) { return issue(typeof error.code === 'string' ? error.code : 'RECOVERY_ERROR', error.message || String(error), extra); }
function statStamp(st) { return { dev: String(st.dev), ino: String(st.ino), size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs }; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
async function safeDirectory(dir, { optional = false, create = false } = {}) {
  if (create) { try { await fs.mkdir(dir, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
  let st;
  try { st = await fs.lstat(dir); } catch (e) { if (optional && e.code === 'ENOENT') return null; throw e; }
  if (!st.isDirectory() || st.isSymbolicLink()) fail('UNSAFE_DIRECTORY', 'Recovery refuses symlink or non-directory paths.');
  return { dev: String(st.dev), ino: String(st.ino) };
}
async function directoryChain(profile, parts, optional = false) {
  const chain = [];
  let dir = profile;
  for (const part of [null, ...parts]) {
    if (part) dir = path.join(dir, part);
    const identity = await safeDirectory(dir, { optional });
    if (!identity) return null;
    chain.push({ dir, identity });
  }
  return chain;
}
async function verifyChain(chain) {
  for (const item of chain) if (!same(await safeDirectory(item.dir), item.identity)) fail('SOURCE_CHANGED', 'A recovery directory changed while being read.');
}
async function names(dir, max) {
  const result = [];
  const handle = await fs.opendir(dir);
  for await (const entry of handle) {
    if (result.length >= max) fail('DIRECTORY_LIMIT', 'Recovery directory exceeds its entry limit.');
    result.push(entry.name);
  }
  return result.sort();
}
async function safeRead(filename, maxBytes) {
  const before = await fs.lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) fail('UNSAFE_FILE', 'Recovery refuses symlinks, hardlinks, and non-regular files.');
  if (before.size > maxBytes) fail('FILE_LIMIT', 'Recovery file exceeds its size limit.');
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (!same(statStamp(opened), statStamp(before))) fail('SOURCE_CHANGED', 'Recovery file changed before it could be read.');
    // Bounded reads also protect against a file growing between stat and read.
    const chunks = []; let total = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(65536, maxBytes - total + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) fail('FILE_LIMIT', 'Recovery file grew beyond its size limit.');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    if (!same(statStamp(await handle.stat()), statStamp(before)) || !same(statStamp(await fs.lstat(filename)), statStamp(before))) fail('SOURCE_CHANGED', 'Recovery file changed during reading.');
    return { bytes: Buffer.concat(chunks, total), stamp: statStamp(before) };
  } finally { await handle.close(); }
}
// Windows cannot open directories for fsync through Node. File handles still use
// FlushFileBuffers via handle.sync(); immutable evidence permits status recovery.
async function syncDirectory(dir) { if (process.platform === 'win32') return; const handle = await fs.open(dir, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); try { await handle.sync(); } finally { await handle.close(); } }
async function writeExclusive(filename, bytes, immutable = false) {
  const handle = await fs.open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
  try { await handle.writeFile(bytes); if (immutable) await handle.chmod(0o400); await handle.sync(); } finally { await handle.close(); }
}
async function ensureRecoveryCapacity(root, limits, additionalBytes = 0, additionalEntries = 4) {
  let bytes = 0, count = 0;
  async function walk(dir, depth) {
    if (depth > 4) fail('RECOVERY_LAYOUT_LIMIT', 'Unexpectedly deep recovery evidence is preserved without traversal.');
    await safeDirectory(dir);
    for (const name of await names(dir, limits.recoveryFiles)) {
      if (++count > limits.recoveryFiles) fail('RECOVERY_FILE_LIMIT', 'The total recovery evidence file limit has been reached.');
      const file = path.join(dir, name), st = await fs.lstat(file);
      if (st.isSymbolicLink() || !st.isDirectory() && (!st.isFile() || st.nlink !== 1)) fail('UNSAFE_RECOVERY_FILE', 'Recovery evidence contains an unsafe file or link.');
      if (st.isDirectory()) await walk(file, depth + 1);
      else { bytes += st.size; if (bytes + additionalBytes > limits.recoveryBytes) fail('RECOVERY_SIZE_LIMIT', 'The total recovery evidence size limit has been reached; existing evidence is preserved.'); }
    }
  }
  await walk(root, 0);
  if (count + additionalEntries > limits.recoveryFiles) fail('RECOVERY_FILE_LIMIT', 'The total recovery evidence file limit has been reached.');
  if (bytes + additionalBytes > limits.recoveryBytes) fail('RECOVERY_SIZE_LIMIT', 'The total recovery evidence size limit has been reached; existing evidence is preserved.');
  return bytes;
}
async function discardWorkingCopy(root, id, limits) {
  if (!ID.test(id)) fail('INVALID_WORKING_COPY', 'Invalid generated working-copy identifier.');
  const chain = await directoryChain(root, ['working', id]);
  const directory = chain.at(-1).dir;
  // Closed native LevelDB working files are disposable. Do not recursively
  // follow anything, and never operate on snapshots or original browser files.
  for (const name of await names(directory, limits.directoryEntries)) {
    if (!LEVEL_FILE.test(name)) fail('UNEXPECTED_WORKING_FILE', 'An unexpected working-copy file was preserved.');
    await verifyChain(chain);
    const filename = path.join(directory, name), st = await fs.lstat(filename);
    if (!st.isFile() || st.isSymbolicLink()) fail('UNSAFE_WORKING_FILE', 'An unsafe working-copy entry was preserved.');
    await fs.unlink(filename);
  }
  await verifyChain(chain); await fs.rmdir(directory); await syncDirectory(path.join(root, 'working'));
}
function contentFingerprint(files) { return sha(JSON.stringify(files.map(({ name, size, sha256 }) => ({ name, size, sha256 })))); }
async function scanSource(profile, partition, limits) {
  const chain = await directoryChain(profile, ['Partitions', partition, 'Local Storage', 'leveldb'], true);
  if (!chain) return null;
  const dir = chain.at(-1).dir;
  const allNames = await names(dir, limits.directoryEntries);
  const selected = allNames.filter(name => LEVEL_FILE.test(name));
  if (selected.length > limits.files) fail('FILE_COUNT_LIMIT', 'Too many legacy LevelDB files.');
  const files = []; let total = 0;
  for (const name of selected) {
    await verifyChain(chain);
    const { bytes, stamp } = await safeRead(path.join(dir, name), limits.fileBytes);
    total += bytes.length;
    if (total > limits.sourceBytes) fail('SOURCE_SIZE_LIMIT', 'Legacy Local Storage exceeds its recovery size limit.');
    files.push({ name, size: bytes.length, sha256: sha(bytes), stamp });
  }
  await verifyChain(chain);
  if (!same(await names(dir, limits.directoryEntries), allNames)) fail('SOURCE_CHANGED', 'Legacy Local Storage file list changed during hashing.');
  return { dir, chain, files, excluded: allNames.filter(name => !LEVEL_FILE.test(name)), fingerprint: contentFingerprint(files) };
}
async function verifySnapshot(root, ref, limits) {
  if (!ref || !ID.test(ref.backupId) || !/^[a-f0-9]{64}$/.test(ref.manifestSha256 || '')) fail('INVALID_BACKUP_REFERENCE', 'Invalid recovery backup reference.');
  const snapshot = path.join(root, 'snapshots', ref.backupId);
  await directoryChain(root, ['snapshots', ref.backupId, 'leveldb']);
  const raw = (await safeRead(path.join(snapshot, 'manifest.json'), limits.documentBytes)).bytes;
  if (sha(raw) !== ref.manifestSha256) fail('BACKUP_HASH_MISMATCH', 'The immutable recovery manifest no longer matches its recorded SHA-256.');
  const recorded = (await safeRead(path.join(snapshot, 'manifest.sha256'), 128)).bytes.toString('ascii').trim();
  if (recorded !== sha(raw)) fail('BACKUP_HASH_MISMATCH', 'The recovery manifest checksum does not match.');
  const manifest = JSON.parse(raw);
  if (manifest.schema !== 'qingdan-legacy-local-snapshot-v1' || manifest.backupId !== ref.backupId || !PARTITION.test(manifest.partition) || !Array.isArray(manifest.files) || manifest.files.length > limits.files) fail('INVALID_MANIFEST', 'Unknown recovery manifest format.');
  const expected = manifest.files.map(file => file.name).sort();
  if (new Set(expected).size !== expected.length || expected.some(name => !LEVEL_FILE.test(name)) || !same(expected, await names(path.join(snapshot, 'leveldb'), limits.directoryEntries))) fail('BACKUP_HASH_MISMATCH', 'The recovery backup file set changed.');
  let total = 0;
  for (const file of manifest.files) {
    const bytes = (await safeRead(path.join(snapshot, 'leveldb', file.name), limits.fileBytes)).bytes;
    total += bytes.length;
    if (total > limits.sourceBytes || file.size !== bytes.length || file.sha256 !== sha(bytes)) fail('BACKUP_HASH_MISMATCH', 'A recovery backup file no longer matches its manifest.');
  }
  if (manifest.fingerprint !== contentFingerprint(manifest.files)) fail('INVALID_MANIFEST', 'Invalid recovery source fingerprint.');
  return { snapshot, manifest };
}
async function makeSnapshot(root, profile, partition, source, limits, hook) {
  await ensureRecoveryCapacity(root, limits, source.files.reduce((sum, file) => sum + file.size, 0) * 3 + 1024 * 1024, source.files.length * 3 + 12);
  const backupId = crypto.randomUUID();
  const snapshot = path.join(root, 'snapshots', backupId);
  await safeDirectory(snapshot, { create: true });
  const target = path.join(snapshot, 'leveldb');
  await safeDirectory(target, { create: true });
  for (const file of source.files) {
    await verifyChain(source.chain);
    const current = await safeRead(path.join(source.dir, file.name), limits.fileBytes);
    if (!same(current.stamp, file.stamp) || sha(current.bytes) !== file.sha256) fail('SOURCE_CHANGED', 'Legacy Local Storage changed before copying.');
    await writeExclusive(path.join(target, file.name), current.bytes, true);
    if (hook) await hook('copied-file', { partition, name: file.name });
  }
  await syncDirectory(target);
  if (hook) await hook('before-source-recheck', { partition });
  const after = await scanSource(profile, partition, limits);
  if (!after || !same(source.files, after.files) || !same(source.excluded, after.excluded)) fail('SOURCE_CHANGED', 'Legacy Local Storage changed while copying; partial evidence is preserved but not parsed.');
  const manifest = { schema: 'qingdan-legacy-local-snapshot-v1', backupId, partition, createdAt: new Date().toISOString(), fingerprint: source.fingerprint, files: source.files, excludedFileNames: source.excluded, sourceRelativePath: `Partitions/${partition}/Local Storage/leveldb`, completeness: 'unverified' };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  await writeExclusive(path.join(snapshot, 'manifest.json'), bytes, true);
  await writeExclusive(path.join(snapshot, 'manifest.sha256'), Buffer.from(sha(bytes) + '\n'), true);
  await syncDirectory(snapshot);
  await fs.chmod(target, 0o500); await fs.chmod(snapshot, 0o500);
  await syncDirectory(path.join(root, 'snapshots'));
  const ref = { backupId, manifestSha256: sha(bytes) };
  await verifySnapshot(root, ref, limits);
  return ref;
}
function decodeString(bytes) {
  if (!bytes.length) return '';
  if (bytes[0] === 1) return bytes.subarray(1).toString('latin1');
  if (bytes[0] !== 0) fail('UNKNOWN_STRING_ENCODING', 'Unknown Chromium DOMStorage string marker.');
  if (os.endianness() !== 'LE' || (bytes.length - 1) % 2) fail('INVALID_UTF16', 'Unsupported or malformed Chromium UTF-16LE string.');
  return bytes.subarray(1).toString('utf16le');
}
function allowedOrigin(origin, partition) {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(origin)) return false;
  const parsed = new URL(origin);
  return Number(parsed.port) <= 65535 && parsed.origin === origin && partition === `qingdan-desktop-local-${sha(origin).slice(0, 20)}`;
}
async function inspectSnapshot(root, ref, source, limits, schema, driverFactory) {
  const { snapshot, manifest } = await verifySnapshot(root, ref, limits);
  await ensureRecoveryCapacity(root, limits, manifest.files.reduce((sum, file) => sum + file.size, 0) * 2 + 1024 * 1024, manifest.files.length * 2 + 8);
  const workId = crypto.randomUUID();
  const working = path.join(root, 'working', workId);
  await safeDirectory(working, { create: true });
  // Deliberately copy verified snapshot bytes, never the original source path.
  for (const file of manifest.files) await writeExclusive(path.join(working, file.name), (await safeRead(path.join(snapshot, 'leveldb', file.name), limits.fileBytes)).bytes);
  await syncDirectory(working);
  const records = [], diagnostics = [], unknown = [];
  let version, count = 0, decodedBytes = 0, candidateBytes = 0, unknownCount = 0, business = false, db, closed = true;
  try {
    // CURRENT is the only filename indirection handed to LevelDB. Reject path
    // traversal/absolute paths and unknown formats before the native driver can
    // follow them, even though this is already a separate working directory.
    const currentBytes = (await safeRead(path.join(working, 'CURRENT'), 1024)).bytes;
    const manifestName = currentBytes.toString('utf8').trimEnd();
    if (!/^MANIFEST-[0-9]{6,}$/.test(manifestName) || !currentBytes.equals(Buffer.from(manifestName + '\n')) || !manifest.files.some(file => file.name === manifestName)) fail('INVALID_CURRENT', 'Legacy CURRENT does not name an included LevelDB manifest exactly.');
    db = driverFactory ? driverFactory(working) : new (require('classic-level').ClassicLevel)(working, { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false, errorIfExists: false });
    closed = false;
    await db.open();
    for await (const [key, value] of db.iterator()) {
      count++;
      decodedBytes += key.length + value.length;
      if (count > limits.entries || key.length > 4096 || value.length > limits.entryBytes || decodedBytes > limits.decodedBytes) fail('ENTRY_LIMIT', 'Legacy database exceeds its candidate limits.');
      if (key.equals(Buffer.from('VERSION'))) { version = value.equals(Buffer.from('1')) ? '1' : 'unsupported'; continue; }
      if (key[0] !== 95) continue; // Chromium META records are not business values.
      const separator = key.indexOf(0, 1);
      if (separator < 0) { diagnostics.push(issue('INVALID_ORIGIN_ENVELOPE', 'A legacy key has no origin separator.', { rawKeySha256: sha(key) })); continue; }
      const originBytes = key.subarray(1, separator);
      const origin = originBytes.toString('utf8');
      if (!Buffer.from(origin).equals(originBytes) || !allowedOrigin(origin, manifest.partition)) { diagnostics.push(issue('ORIGIN_MISMATCH', 'A legacy record does not match the expected local origin and partition.', { rawKeySha256: sha(key) })); continue; }
      let name;
      try { name = decodeString(key.subarray(separator + 1)); } catch (error) { diagnostics.push(errorIssue(error, { rawKeySha256: sha(key) })); continue; }
      const descriptor = schema.describeKey(name);
      if (!descriptor) { unknownCount++; if (unknown.length < 64) unknown.push({ keySha256: sha(key) }); continue; }
      business ||= descriptor.preference !== true;
      const record = { candidateId: sha(Buffer.concat([Buffer.from(ref.backupId), key, value])), backupId: ref.backupId, partition: manifest.partition, origin, key: name, kind: descriptor.kind, rawKeyBase64: key.toString('base64'), rawValueBase64: value.toString('base64'), status: 'quarantined', completeness: 'unverified', preferenceOnly: descriptor.preference === true, valid: false };
      try {
        record.value = decodeString(value);
        if (schema.validateEntry(name, record.value) !== true) fail('INVALID_BUSINESS_VALUE', 'Legacy value does not match the known business schema.');
        record.valid = true;
      } catch (error) { record.diagnostic = errorIssue(error); diagnostics.push(errorIssue(error, { candidateId: record.candidateId })); }
      candidateBytes += Buffer.byteLength(JSON.stringify(record));
      if (candidateBytes > limits.candidateBytes) fail('CANDIDATE_SIZE_LIMIT', 'Decoded candidate output exceeds its review size limit; complete source bytes remain in immutable backups.');
      records.push(record);
    }
    const seenKeys = new Set();
    for (const record of records) { if (seenKeys.has(record.key)) diagnostics.push(issue('DUPLICATE_BUSINESS_KEY', 'Multiple encoded records represent the same business key and require review.', { key: record.key })); seenKeys.add(record.key); }
    if (version !== '1') fail('UNKNOWN_STORAGE_VERSION', 'Only Chromium Local Storage VERSION=1 is supported.');
  } catch (error) { diagnostics.push(errorIssue(error)); for (const record of records) record.valid = false; }
  finally { if (db) { try { await db.close(); closed = true; } catch (error) { diagnostics.push(errorIssue(error)); } } }
  // LOG is generated only in the working copy. An empty log is not proof of
  // completeness; truncated WALs can be skipped without any log indication.
  try {
    const log = (await safeRead(path.join(working, 'LOG'), limits.fileBytes)).bytes.toString('utf8');
    if (/corrupt|checksum|dropping|bad record/i.test(log)) diagnostics.push(issue('DRIVER_CORRUPTION', 'The working-copy LevelDB log reports possible corruption.'));
  } catch (error) { if (error.code !== 'ENOENT') diagnostics.push(errorIssue(error)); }
  if (unknownCount) diagnostics.push(issue('UNKNOWN_KEYS', 'Unknown legacy keys remain in the immutable backup and were not admitted as business candidates.', { count: unknownCount, sampledKeys: unknown, omittedKeyCount: unknownCount - unknown.length }));
  // Recheck the sealed evidence after native-driver activity.
  await verifySnapshot(root, ref, limits);
  let workingCopyRetained = true;
  if (closed) try { await discardWorkingCopy(root, workId, limits); workingCopyRetained = false; } catch (error) { diagnostics.push(errorIssue(error)); }
  return { ...source, ...ref, state: diagnostics.length ? 'uncertain' : 'parsed-unverified', records, diagnostics, requiresReview: business || diagnostics.length > 0, ...(workingCopyRetained ? { workingCopyId: workId } : {}), workingCopyRetained, completeness: 'unverified' };
}
function reconcile(sources) {
  const conflicts = [], keys = new Set();
  const indexed = sources.map(source => {
    const byKey = new Map();
    for (const record of source.records || []) { keys.add(record.key); if (!byKey.has(record.key)) byKey.set(record.key, []); byKey.get(record.key).push(record); }
    return { source, byKey };
  });
  for (const key of [...keys].sort()) {
    const signatures = new Set(), absentSourceIndexes = [], variants = [];
    indexed.forEach(({ source, byKey }, sourceIndex) => {
      const records = byKey.get(key) || [];
      signatures.add(records.length ? sha(JSON.stringify(records.map(record => [record.valid ? record.value : record.rawValueBase64, record.valid]))) : 'ABSENT');
      // Full raw values are retained once in source records. Group absence by
      // source index so many empty ports cannot multiply a report's size.
      if (!records.length) absentSourceIndexes.push(sourceIndex);
      else variants.push({ sourceIndex, partition: source.partition, backupId: source.backupId || null, sourceState: source.state, candidateIds: records.map(record => record.candidateId), absent: false });
    });
    if (absentSourceIndexes.length) variants.push({ absent: true, sourceIndexes: absentSourceIndexes });
    if (signatures.size > 1) conflicts.push({ key, variants, reason: 'Different values or absence across legacy sources require explicit review; absence may reflect deletion.' });
  }
  return conflicts;
}
function diagnosticSummary(document) {
  const grouped = new Map(); let diagnosticCount = 0, diagnosticsOmitted = 0;
  const add = (diagnostic, partition) => {
    diagnosticCount++;
    const code = String(diagnostic.code || 'RECOVERY_ERROR').slice(0, 80), message = String(diagnostic.message || '').slice(0, 1024);
    const key = `${partition || ''}\0${code}\0${message}`;
    if (grouped.has(key)) { grouped.get(key).occurrences++; return; }
    if (grouped.size >= 128) { diagnosticsOmitted++; return; }
    grouped.set(key, { code, message, ...(partition ? { partition } : {}), occurrences: 1, ...(Number.isSafeInteger(diagnostic.count) && diagnostic.count >= 0 ? { count: diagnostic.count } : {}) });
  };
  for (const diagnostic of document.diagnostics) add(diagnostic);
  for (const source of document.sources) for (const diagnostic of source.diagnostics || []) add(diagnostic, source.partition);
  return { diagnostics: [...grouped.values()], diagnosticCount, diagnosticsOmitted };
}
function emptyDocument() { return { schema: 'qingdan-legacy-local-recovery-v1', status: 'none', requiresReview: false, acknowledgedContinue: false, sources: [], conflicts: [], diagnostics: [], limitations: [...LIMITATIONS], archiveReports: [] }; }
function createLegacyRecovery({ profile, limits: overrides = {}, validateEntry, describeKey, _testHook, _driverFactory } = {}) {
  if (typeof profile !== 'string' || !path.isAbsolute(profile)) throw new TypeError('An absolute application profile is required.');
  const root = path.join(profile, 'local-recovery');
  const limits = { ...LIMITS, ...overrides };
  let document = emptyDocument(), prepared = false, preparing, stateId;
  const getSchema = () => validateEntry && describeKey ? { validateEntry, describeKey } : require('./local-business-schema.cjs');
  function summary() {
    const candidates = document.sources.flatMap(source => source.records || []);
    return clone({ status: document.status, requiresReview: document.requiresReview, acknowledgedContinue: document.acknowledgedContinue, sourceCount: document.sources.length, candidateCount: candidates.length, validCandidateCount: candidates.filter(candidate => candidate.valid).length, conflictCount: document.conflicts.length, ...diagnosticSummary(document), backupIds: document.sources.flatMap(source => source.backupId ? [source.backupId] : []), completeness: document.status === 'none' ? 'not-applicable' : 'unverified', limitations: document.limitations });
  }
  async function initializeRoot() {
    await safeDirectory(profile);
    await safeDirectory(root, { create: true });
    for (const dir of ['snapshots', 'working', 'reports', 'acknowledgements']) await safeDirectory(path.join(root, dir), { create: true });
    await syncDirectory(profile); await syncDirectory(root);
  }
  async function loadState() {
    if (!await safeDirectory(root, { optional: true })) return null;
    await safeDirectory(path.join(root, 'reports'), { optional: true });
    try {
      const pointer = JSON.parse((await safeRead(path.join(root, 'state.json'), 1024)).bytes);
      if (!ID.test(pointer.reportId) || !/^[a-f0-9]{64}$/.test(pointer.sha256)) fail('INVALID_STATE', 'Invalid persisted recovery status.');
      const bytes = (await safeRead(path.join(root, 'reports', pointer.reportId + '.json'), limits.documentBytes)).bytes;
      if (sha(bytes) !== pointer.sha256) fail('STATE_HASH_MISMATCH', 'Persisted recovery status checksum differs.');
      const result = JSON.parse(bytes);
      if (result.schema !== document.schema || result.status !== 'pending' || !Array.isArray(result.sources) || !Array.isArray(result.conflicts) || !validDiagnostics(result.diagnostics) || typeof result.requiresReview !== 'boolean' || typeof result.acknowledgedContinue !== 'boolean' || !Array.isArray(result.limitations) || !Array.isArray(result.archiveReports) || result.archiveReports.some(id => !ID.test(id)) || result.sources.some(source => !source || !PARTITION.test(source.partition) || !Array.isArray(source.records) || !validDiagnostics(source.diagnostics) || typeof source.requiresReview !== 'boolean' || source.records.some(record => !record || typeof record.key !== 'string' || typeof record.rawValueBase64 !== 'string' || typeof record.valid !== 'boolean' || record.status !== 'quarantined' || record.completeness !== 'unverified'))) fail('INVALID_STATE', 'Unsupported persisted recovery status.');
      stateId = pointer.reportId;
      return result;
    } catch (error) { if (error.code === 'ENOENT') fail('RECOVERY_STATE_MISSING', 'Existing recovery evidence has no readable status pointer; all evidence is preserved.'); throw error; }
  }
  async function persist() {
    await initializeRoot();
    const id = crypto.randomUUID();
    document.updatedAt = new Date().toISOString();
    const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n');
    if (bytes.length > limits.documentBytes) fail('DOCUMENT_LIMIT', 'Recovery report exceeds its size limit.');
    await ensureRecoveryCapacity(root, limits, bytes.length + 4096);
    await writeExclusive(path.join(root, 'reports', id + '.json'), bytes, true);
    await syncDirectory(path.join(root, 'reports'));
    const temporary = path.join(root, `.state-${crypto.randomUUID()}.tmp`);
    await writeExclusive(temporary, Buffer.from(JSON.stringify({ reportId: id, sha256: sha(bytes) }) + '\n'));
    // This replaceable pointer contains no evidence; all reports are immutable.
    await fs.rename(temporary, path.join(root, 'state.json'));
    await syncDirectory(root);
    stateId = id;
  }
  async function performPrepare() {
    let previous, partitions = [];
    try { previous = await loadState(); } catch (error) { document.status = 'pending'; document.requiresReview = true; document.diagnostics.push(errorIssue(error)); }
    try {
      const chain = await directoryChain(profile, ['Partitions'], true);
      if (chain) { partitions = (await names(chain.at(-1).dir, limits.directoryEntries)).filter(name => PARTITION.test(name)); await verifyChain(chain); }
      if (partitions.length > limits.partitions) fail('PARTITION_LIMIT', 'Too many legacy local partitions; recovery remains pending.');
    } catch (error) { document.status = 'pending'; document.requiresReview = true; document.diagnostics.push(errorIssue(error)); partitions = []; }
    if (!partitions.length && previous) {
      const recentDiagnostics = document.diagnostics;
      document = previous;
      if (recentDiagnostics.length) { document.diagnostics.push(...recentDiagnostics); document.requiresReview = true; document.acknowledgedContinue = false; }
      // Do not forget pending work if original files were later moved/deleted.
      for (const source of document.sources) if (source.backupId) { try { await verifySnapshot(root, source, limits); } catch (error) { document.requiresReview = true; document.acknowledgedContinue = false; source.records.forEach(record => { record.valid = false; }); document.diagnostics.push(errorIssue(error)); } }
      return summary();
    }
    if (!partitions.length && document.status === 'none') return summary();
    document.status = 'pending';
    if (previous) document.archiveReports = [...new Set([...(previous.archiveReports || []), stateId].filter(Boolean))];
    try {
      await initializeRoot();
      const schema = getSchema();
      let sourceBytes = 0, totalCandidates = 0, totalCandidateBytes = 0;
      for (const partition of partitions) {
        const prior = previous?.sources.find(item => item.partition === partition);
        let source = { ...(prior || {}), partition, state: 'pending', records: (prior?.records || []).map(record => ({ ...record, valid: false })), diagnostics: [], requiresReview: true };
        try {
          const current = await scanSource(profile, partition, limits);
          if (!current) { source.diagnostics.push(issue('NO_LOCAL_STORAGE', 'Legacy partition exists but no inspectable Local Storage was found. Other original browser storage was not opened.')); }
          else {
            sourceBytes += current.files.reduce((sum, file) => sum + file.size, 0);
            if (sourceBytes > limits.totalBytes) fail('TOTAL_SIZE_LIMIT', 'Combined legacy Local Storage exceeds its recovery size limit.');
            const old = previous?.sources.find(item => item.partition === partition && item.fingerprint === current.fingerprint && item.backupId && same(item.excludedFileNames || [], current.excluded));
            let ref;
            if (old) { await verifySnapshot(root, old, limits); ref = { backupId: old.backupId, manifestSha256: old.manifestSha256 }; }
            else ref = await makeSnapshot(root, profile, partition, current, limits, _testHook);
            source = { ...source, ...ref, fingerprint: current.fingerprint, excludedFileNames: current.excluded };
            const verified = await scanSource(profile, partition, limits);
            if (!verified || !same(current.files, verified.files) || !same(current.excluded, verified.excluded)) fail('SOURCE_CHANGED', 'Legacy source changed before candidate inspection.');
            if (old && ['parsed-unverified', 'uncertain'].includes(old.state)) {
              // A verified immutable report and backup can be reused; do not
              // grow working copies on every startup. Revalidate known values
              // against the current business allowlist before displaying them.
              source = clone(old);
              for (const record of source.records) {
                const descriptor = schema.describeKey(record.key);
                if (!descriptor) { record.valid = false; source.requiresReview = true; source.diagnostics.push(issue('SCHEMA_CHANGED', 'A prior candidate is not recognized by the current business schema.', { candidateId: record.candidateId })); continue; }
                record.kind = descriptor.kind;
                if (record.valid) try { schema.validateEntry(record.key, record.value); } catch (error) { record.valid = false; source.requiresReview = true; source.diagnostics.push(errorIssue(error, { candidateId: record.candidateId })); }
              }
            } else {
              source = await inspectSnapshot(root, ref, { partition, fingerprint: current.fingerprint, excludedFileNames: current.excluded }, limits, schema, _driverFactory);
              if (current.excluded.length) { source.requiresReview = true; source.diagnostics.push(issue('EXCLUDED_FILES', 'Unrecognized files were not read or copied.', { fileNames: current.excluded })); }
            }
            const finalSource = await scanSource(profile, partition, limits);
            if (!finalSource || !same(current.files, finalSource.files) || !same(current.excluded, finalSource.excluded)) fail('SOURCE_CHANGED', 'Legacy source changed during candidate inspection; recovery remains pending.');
          }
        } catch (error) { source.state = 'uncertain'; source.requiresReview = true; source.diagnostics.push(errorIssue(error)); }
        if (totalCandidates + source.records.length > limits.entries) { source.records = []; source.state = 'uncertain'; source.requiresReview = true; source.diagnostics.push(issue('TOTAL_ENTRY_LIMIT', 'Combined recovery candidates exceed the review limit; complete source bytes remain in immutable backups.')); }
        const outputBytes = Buffer.byteLength(JSON.stringify(source.records));
        if (totalCandidateBytes + outputBytes > limits.totalCandidateBytes) { source.records = []; source.state = 'uncertain'; source.requiresReview = true; source.diagnostics.push(issue('TOTAL_CANDIDATE_SIZE_LIMIT', 'Combined decoded candidates exceed the review size limit; complete source bytes remain in immutable backups.')); }
        else totalCandidateBytes += outputBytes;
        totalCandidates += source.records.length;
        document.sources.push(source);
      }
      // Keep the last known candidates for a partition that disappeared.
      for (const source of previous?.sources || []) if (!partitions.includes(source.partition)) {
        const retained = { ...source, requiresReview: true, diagnostics: [...(source.diagnostics || []), issue('SOURCE_MISSING', 'The original legacy partition is no longer present; its previous recovery evidence is retained.')] };
        if (totalCandidates + retained.records.length > limits.entries) { retained.records = []; retained.diagnostics.push(issue('TOTAL_ENTRY_LIMIT', 'Prior candidates remain in archived immutable reports; the combined review limit was reached.')); }
        const outputBytes = Buffer.byteLength(JSON.stringify(retained.records));
        if (totalCandidateBytes + outputBytes > limits.totalCandidateBytes) { retained.records = []; retained.diagnostics.push(issue('TOTAL_CANDIDATE_SIZE_LIMIT', 'Prior candidates remain in archived immutable reports; the combined review size limit was reached.')); }
        else totalCandidateBytes += outputBytes;
        totalCandidates += retained.records.length; document.sources.push(retained);
      }
      const finalPartitions = await directoryChain(profile, ['Partitions'], true);
      const finalNames = finalPartitions ? (await names(finalPartitions.at(-1).dir, limits.directoryEntries)).filter(name => PARTITION.test(name)) : [];
      if (finalPartitions) await verifyChain(finalPartitions);
      if (!same(partitions, finalNames)) { document.requiresReview = true; document.diagnostics.push(issue('PARTITIONS_CHANGED', 'The legacy local partition list changed during recovery; preserved evidence may be incomplete.')); }
      document.conflicts = reconcile(document.sources);
      document.requiresReview ||= document.sources.some(source => source.requiresReview) || document.conflicts.length > 0;
      const evidence = sources => sources.map(source => ({ partition: source.partition, backupId: source.backupId, state: source.state, diagnostics: source.diagnostics }));
      document.acknowledgedContinue = Boolean(previous?.acknowledgedContinue && same(evidence(previous.sources), evidence(document.sources)) && same(previous.diagnostics, document.diagnostics));
      if (previous && same(previous.sources, document.sources) && same(previous.conflicts, document.conflicts) && same(previous.diagnostics, document.diagnostics) && previous.requiresReview === document.requiresReview && previous.acknowledgedContinue === document.acknowledgedContinue) { document = previous; return summary(); }
      await persist();
    } catch (error) { document.requiresReview = true; document.acknowledgedContinue = false; document.diagnostics.push(errorIssue(error)); }
    return summary();
  }
  return {
    prepare() { if (prepared) return Promise.resolve(summary()); if (!preparing) preparing = performPrepare().catch(error => { document.status = 'pending'; document.requiresReview = true; document.diagnostics.push(errorIssue(error)); return summary(); }).then(result => { prepared = true; return result; }); return preparing; },
    summary,
    candidates() { return clone(document.sources.flatMap(source => source.records || [])); },
    candidatePage(offset = 0, limit = 25) {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new TypeError('Recovery page requires a nonnegative safe integer offset and a limit from 1 to 50.');
      const total = document.sources.reduce((sum, source) => sum + (source.records || []).length, 0);
      const items = []; let skipped = 0;
      for (const source of document.sources) {
        const records = source.records || [];
        if (offset >= skipped + records.length) { skipped += records.length; continue; }
        const start = Math.max(0, offset - skipped);
        for (let index = start; index < records.length && items.length < limit; index++) items.push(records[index]);
        skipped += records.length;
        if (items.length === limit) break;
      }
      return { items: clone(items), total, nextOffset: offset + items.length < total ? offset + items.length : null };
    },
    exportDocument() { return clone(document); },
    async acknowledgeContinue() {
      if (!prepared) await this.prepare();
      if (document.status === 'none') return summary();
      const old = document.acknowledgedContinue;
      document.acknowledgedContinue = true;
      try {
        await initializeRoot();
        await ensureRecoveryCapacity(root, limits, 4096, 2);
        await writeExclusive(path.join(root, 'acknowledgements', crypto.randomUUID() + '.json'), Buffer.from(JSON.stringify({ schema: 'qingdan-recovery-continue-v1', at: new Date().toISOString(), reportId: stateId || null, meaning: 'Continue with saved SQLite tasks; recovery remains pending and no candidates are imported or replayed.' }) + '\n'), true);
        await syncDirectory(path.join(root, 'acknowledgements'));
        await persist();
      } catch (error) { document.acknowledgedContinue = old; throw error; }
      return summary();
    }
  };
}
module.exports = { createLegacyRecovery, LIMITS, decodeString, allowedOrigin, reconcile };
