'use strict';
const nodeFs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { LOCAL_ID, describeKey, validateEntry } = require('./local-business-schema.cjs');
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_KEYS = 20000;
function storageError(code, message) { return Object.assign(new Error(message), { code }); }
function requireDirectory(fs, directory) {
  try { const stat = fs.lstatSync(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw storageError('UNSAFE_STORAGE_PATH','Unsafe local storage directory'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; fs.mkdirSync(directory, { mode:0o700 }); }
}
function syncDirectory(fs, directory, platform) {
  // Windows does not support opening directories with the standard CRT flags.
  // The file itself is flushed and atomically replaced on every supported OS.
  if (platform === 'win32') return;
  const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
class LocalBusinessStore {
  constructor({ profile, principalId, fs = nodeFs, platform = process.platform, maxBytes = MAX_FILE_BYTES, maxKeys = MAX_KEYS, compactOnOpen = false }) {
    if (!path.isAbsolute(profile) || !LOCAL_ID.test(principalId)) throw storageError('INVALID_LOCAL_IDENTITY','Invalid local storage identity');
    this.fs = fs; this.platform = platform; this.principalId = principalId; this.maxBytes = maxBytes; this.maxKeys = maxKeys;
    this.directory = path.join(profile,'local-ui'); requireDirectory(fs, profile); requireDirectory(fs,this.directory);
    this.file = path.join(this.directory,createHash('sha256').update(principalId).digest('hex')+'.json');
    this.state = { schema:'qingdan-local-business-v1', principalId, revision:0, entries:{} };
    this.blocked = false; this.load();
    // Only the owner may request this before exposing a new UI session. No live
    // renderer revision references survive a process restart/new principal.
    if (compactOnOpen) this.compactBeforeSession();
  }
  load() {
    let raw;
    try { const stat = this.fs.lstatSync(this.file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > this.maxBytes) throw storageError('INVALID_LOCAL_STORE','Local input store requires review'); raw = this.fs.readFileSync(this.file,'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    let state; try { state = JSON.parse(raw); } catch { throw storageError('INVALID_LOCAL_STORE','Local input store requires review'); }
    if (!state || state.schema !== 'qingdan-local-business-v1' || state.principalId !== this.principalId || !Number.isSafeInteger(state.revision) || state.revision < 0 || !state.entries || typeof state.entries !== 'object' || Array.isArray(state.entries) || Object.keys(state.entries).length > this.maxKeys) throw storageError('INVALID_LOCAL_STORE','Local input store requires review');
    for (const [key,entry] of Object.entries(state.entries)) {
      if (!describeKey(key,this.principalId) || !entry || !Number.isSafeInteger(entry.revision) || entry.revision < 1 || entry.revision > state.revision || Object.keys(entry).some(k=>!['revision','value'].includes(k))) throw storageError('INVALID_LOCAL_STORE','Local input store requires review');
      if (entry.value !== null) validateEntry(key,entry.value,this.principalId);
    }
    this.state = state;
  }
  compactBeforeSession() {
    const entries = Object.fromEntries(Object.entries(this.state.entries).filter(([,entry])=>entry.value !== null));
    if (Object.keys(entries).length === Object.keys(this.state.entries).length) return;
    this.commit({...this.state,entries});
  }
  snapshot() { return { revision:this.state.revision, entries:Object.fromEntries(Object.entries(this.state.entries).map(([key,entry])=>[key,{...entry}])) }; }
  read(key) { if (!describeKey(key,this.principalId)) throw storageError('INVALID_LOCAL_KEY','Unsupported local storage key'); const entry = this.state.entries[key]; return { value:entry?.value ?? null, revision:entry?.revision || 0 }; }
  keys() { return Object.keys(this.state.entries).filter(key=>this.state.entries[key].value !== null); }
  write(key, value, expectedRevision) {
    if (this.blocked) throw storageError('LOCAL_WRITE_UNCERTAIN','A storage write needs verification. Restart to reread the saved input.');
    const before = this.read(key);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision !== before.revision) throw storageError('LOCAL_WRITE_CONFLICT','This input changed in another window. Export your unsaved input, then reload to review the saved version before editing again.');
    if (value !== null) validateEntry(key,value,this.principalId);
    if (before.value === value) return { ...before, changed:false };
    const revision = this.state.revision+1;
    if (!Number.isSafeInteger(revision)) throw storageError('LOCAL_STORAGE_LIMIT','Local input storage revision limit reached');
    const next = { ...this.state, revision, entries:{...this.state.entries,[key]:{value,revision}} };
    this.commit(next);
    return { value,revision,changed:true,oldValue:before.value };
  }
  commit(next) {
    const bytes = Buffer.from(JSON.stringify(next)+'\n');
    if (bytes.length > this.maxBytes || Object.keys(next.entries).length > this.maxKeys) throw storageError('LOCAL_STORAGE_QUOTA','Local input storage is full. Export pending input and restart before retrying.');
    const temporary = path.join(this.directory,'.write-'+randomUUID()+'.tmp');
    let fd, replaced = false;
    try {
      requireDirectory(this.fs,this.directory);
      // A symlink replacement by another process must never redirect a write.
      try { const stat = this.fs.lstatSync(this.file); if (!stat.isFile() || stat.isSymbolicLink()) throw storageError('UNSAFE_STORAGE_PATH','Unsafe local storage file'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      fd = this.fs.openSync(temporary,'wx',0o600); this.fs.writeFileSync(fd,bytes); this.fs.fsyncSync(fd); this.fs.closeSync(fd); fd = undefined;
      this.fs.renameSync(temporary,this.file); replaced = true;
      syncDirectory(this.fs,this.directory,this.platform);
      this.state = next;
      return;
    } catch (error) {
      if (fd !== undefined) { try { this.fs.closeSync(fd); } catch {} }
      if (!replaced) { try { this.fs.unlinkSync(temporary); } catch {} }
      else { this.blocked = true; this.state = next; }
      throw storageError(replaced?'LOCAL_WRITE_UNCERTAIN':'LOCAL_WRITE_FAILED',replaced?'The input write may have reached disk but could not be fully verified. Restart before editing it again.':'The input could not be durably saved. Keep this window open and export the input.');
    }
  }
}
module.exports = { LocalBusinessStore, MAX_FILE_BYTES, MAX_KEYS, syncDirectory };
