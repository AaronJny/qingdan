'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const SCHEMA_VERSION = 1;
function unsafe() { return new Error('Private Agent configuration storage is unavailable'); }
function sameFile(left, right) { return left.dev === right.dev && left.ino === right.ino; }
function bindingFor(connection, accountId) {
  // Built-in service ports and partitions change on restart. The persisted local
  // database principal, not a port or a generic "local" label, identifies it.
  const origin = connection.builtin ? 'qingdan-owned-local' : connection.origin;
  const mode = connection.builtin ? 'builtin' : 'server';
  const id = createHash('sha256').update(JSON.stringify([SCHEMA_VERSION, mode, origin, accountId])).digest('hex');
  return { id, mode, origin, accountId };
}
class AgentDescriptorStore {
  constructor({ profile, platform = process.platform, filesystem = fs, uid = process.getuid?.() }) {
    if (!path.isAbsolute(profile)) throw unsafe();
    this.fs = filesystem; this.uid = uid; this.platform = platform; this.profile = profile;
    this.directory = path.join(profile, 'agent-access'); this.active = null;
    // POSIX mode bits are NOT Windows ACLs. Until ACL verification is supported,
    // Windows uses the explicit one-time token/env setup and writes no descriptor.
    this.supported = platform !== 'win32' && Number.isSafeInteger(uid);
  }
  pathFor(connection, accountId) { return this.supported ? path.join(this.directory, bindingFor(connection, accountId).id + '.json') : null; }
  checkAncestors() {
    let current = this.profile;
    while (true) {
      const stat = this.fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o022 && !(stat.mode & 0o1000)) throw unsafe();
      const parent = path.dirname(current); if (parent === current) break; current = parent;
    }
    const stat = this.fs.lstatSync(this.profile); if (stat.uid !== this.uid) throw unsafe();
  }
  privateStat(file, directory = false) {
    const stat = this.fs.lstatSync(file);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) || stat.uid !== this.uid || stat.mode & 0o077) throw unsafe();
    return stat;
  }
  ensure(create = false) {
    if (!this.supported) throw unsafe();
    this.checkAncestors();
    try { return this.privateStat(this.directory, true); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      this.fs.mkdirSync(this.directory, { mode: 0o700 });
      return this.privateStat(this.directory, true);
    }
  }
  syncDirectory() {
    const fd = this.fs.openSync(this.directory, this.fs.constants.O_RDONLY | this.fs.constants.O_NOFOLLOW);
    try { this.fs.fsyncSync(fd); } finally { this.fs.closeSync(fd); }
  }
  cleanupStale() {
    if (!this.supported) return;
    try { this.ensure(); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    // Called only after Electron's single-instance lock. Remove only recognized
    // private artifacts from earlier runs; never recurse or follow symlinks.
    for (const name of this.fs.readdirSync(this.directory)) {
      if (!/^(?:[a-f0-9]{64}\.json|\.write-[a-f0-9]{32}\.tmp)$/.test(name)) continue;
      const file = path.join(this.directory, name); this.privateStat(file); this.fs.unlinkSync(file);
    }
    this.syncDirectory();
  }
  write(connection, accountId, endpoint, token) {
    const root = this.ensure(true), binding = bindingFor(connection, accountId);
    const file = path.join(this.directory, binding.id + '.json');
    const temporary = path.join(this.directory, '.write-' + randomBytes(16).toString('hex') + '.tmp');
    let fd, replaced = false;
    try {
      try { this.privateStat(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const flags = this.fs.constants.O_WRONLY | this.fs.constants.O_CREAT | this.fs.constants.O_EXCL | this.fs.constants.O_NOFOLLOW;
      fd = this.fs.openSync(temporary, flags, 0o600);
      const stat = this.fs.fstatSync(fd);
      if (!stat.isFile() || stat.uid !== this.uid || stat.mode & 0o077 || stat.nlink !== 1) throw unsafe();
      this.fs.writeFileSync(fd, JSON.stringify({ schemaVersion: SCHEMA_VERSION, endpoint, token, binding }) + '\n'); this.fs.fsyncSync(fd);
      this.fs.closeSync(fd); fd = undefined;
      if (!sameFile(root, this.ensure())) throw unsafe();
      this.fs.renameSync(temporary, file); replaced = true;
      this.active = { file, stat };
      if (!sameFile(stat, this.privateStat(file))) throw unsafe();
      this.syncDirectory();
      return file;
    } catch {
      if (fd !== undefined) { try { this.fs.closeSync(fd); } catch {} }
      if (replaced) this.remove(); else { try { this.fs.unlinkSync(temporary); } catch {} }
      throw unsafe();
    }
  }
  remove() {
    const active = this.active; this.active = null;
    if (!active) return true;
    try {
      this.ensure(); const stat = this.privateStat(active.file);
      if (!sameFile(stat, active.stat)) return false;
      this.fs.unlinkSync(active.file); this.syncDirectory(); return true;
    } catch (error) { return error.code === 'ENOENT'; }
  }
}
module.exports = { AgentDescriptorStore, bindingFor };
