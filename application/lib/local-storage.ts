import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  constants, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type AppMode = 'local' | 'accounts';
export interface StorageOptions { dataDir?: string; migrationsDir?: string; mode?: AppMode }
export function storageMode(explicit?: AppMode): AppMode {
  const primary = process.env.APP_MODE;
  const alias = process.env.QINGDAN_MODE;
  if (primary && alias && primary !== alias) throw new Error('APP_MODE and QINGDAN_MODE disagree. Use one consistent mode.');
  const mode = explicit || primary || alias || 'local';
  if (mode !== 'local' && mode !== 'accounts') throw new Error('APP_MODE must be local or accounts.');
  return mode;
}
const adjacentMigrationsDir = fileURLToPath(new URL('../drizzle/', import.meta.url));
export const defaultMigrationsDir = existsSync(adjacentMigrationsDir) ? adjacentMigrationsDir : resolve('./drizzle');
export function storagePaths(options: StorageOptions = {}) {
  const mode = storageMode(options.mode);
  return {
    mode,
    dataDir: resolve(options.dataDir || process.env.QINGDAN_DATA_DIR || `./data/${mode}`),
    migrationsDir: resolve(options.migrationsDir || process.env.QINGDAN_MIGRATIONS_DIR || defaultMigrationsDir),
  };
}

function isMissing(error: unknown) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
function rejectSymlink(path: string) {
  try { if (lstatSync(path).isSymbolicLink()) throw new Error(`Storage path must not be a symbolic link: ${path}`); }
  catch (error) { if (!isMissing(error)) throw error; }
}
function fsyncDirectory(path: string) {
  // Windows directory handles opened read-only cannot use FlushFileBuffers.
  // Object bytes are fsynced before rename; directory-entry power-loss durability
  // on Windows remains a platform limitation, not a reason to fail normal uploads.
  if (process.platform === 'win32') return;
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

class LocalStatement implements D1PreparedStatement {
  readonly database: LocalDatabase;
  readonly sql: string;
  readonly values: SQLInputValue[];
  constructor(database: LocalDatabase, sql: string, values: SQLInputValue[] = []) {
    this.database = database; this.sql = sql; this.values = values;
  }
  bind(...values: D1Value[]) {
    const bound = values.map(value => {
      if (value instanceof ArrayBuffer) return new Uint8Array(value);
      if (value === null || typeof value === 'string' || typeof value === 'number' || value instanceof Uint8Array) return value;
      throw new TypeError('SQL parameters must be strings, numbers, null, or bytes.');
    });
    return new LocalStatement(this.database, this.sql, bound);
  }
  execute<T = Record<string, unknown>>(): D1Result<T> {
    const started = performance.now();
    const statement = this.database.connection.prepare(this.sql);
    const hasRows = statement.columns().length > 0;
    const before = hasRows ? Number(this.database.connection.prepare('SELECT total_changes() value').get()?.value || 0) : 0;
    const results = hasRows ? statement.all(...this.values).map(row => ({ ...row })) as T[] : [];
    const mutation = hasRows ? null : statement.run(...this.values);
    const returningMutation = hasRows && Number(this.database.connection.prepare('SELECT total_changes() value').get()?.value || 0) > before
      ? this.database.connection.prepare('SELECT changes() changes, last_insert_rowid() id').get() : null;
    const changes = Number(mutation?.changes || returningMutation?.changes || 0);
    return {
      success: true, results,
      meta: {
        changes, last_row_id: Number(mutation?.lastInsertRowid || returningMutation?.id || 0),
        duration: performance.now() - started, rows_read: results.length, rows_written: changes,
      },
    };
  }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.database.connection.prepare(this.sql).get(...this.values);
    if (!row) return null;
    if (column !== undefined) {
      if (!(column in row)) throw new Error(`SQL result does not contain column: ${column}`);
      return row[column] as T;
    }
    return { ...row } as T;
  }
  async all<T = Record<string, unknown>>() { return this.execute<T>(); }
  async run<T = Record<string, unknown>>() { return this.execute<T>(); }
  async raw<T = unknown[]>() {
    const statement = this.database.connection.prepare(this.sql);
    const columns = statement.columns().map(column => column.name);
    return statement.all(...this.values).map(row => columns.map(column => row[column])) as T[];
  }
}

export class LocalDatabase implements D1Database {
  readonly connection: DatabaseSync;
  readonly mode: AppMode;
  readonly localPrincipalId: string | null;
  private closed = false;
  constructor(file: string, migrationsDir: string, mode: AppMode, hasObjects = false) {
    rejectSymlink(file);
    this.connection = new DatabaseSync(file);
    try {
      this.connection.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
      this.preflightRuntime(mode, hasObjects);
      this.migrate(migrationsDir);
      const runtime = this.initializeRuntime(mode, hasObjects);
      this.mode = runtime.mode;
      this.localPrincipalId = runtime.localPrincipalId;
    } catch (error) { this.connection.close(); throw error; }
  }
  private assertUnmarkedEmpty(hasObjects: boolean) {
    const tables = this.connection.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_qingdan_migrations','_qingdan_runtime')").all();
    for (const table of tables) {
      const name = String(table.name).replaceAll('"', '""');
      if (this.connection.prepare(`SELECT 1 FROM "${name}" LIMIT 1`).get()) throw new Error('Existing data has no verified mode marker. Automatic adoption is blocked. Use an explicit backup/export and import into a new mode-specific data directory.');
    }
    if (hasObjects) throw new Error('Existing stored files have no verified mode marker. Automatic adoption is blocked. Restore or migrate explicitly.');
  }
  private assertMode(prior: Record<string, unknown>, mode: AppMode) {
    if (prior.mode !== mode) throw new Error(`This data directory belongs to ${prior.mode} mode and cannot be opened as ${mode}. Use a different data directory and explicitly export/import data to change modes.`);
    if (mode === 'local' && (typeof prior.local_principal_id !== 'string' || !prior.local_principal_id.startsWith('local:'))) throw new Error('Local identity metadata is invalid. Restore a verified backup.');
  }
  private preflightRuntime(mode: AppMode, hasObjects: boolean) {
    const hasRuntime = this.connection.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='_qingdan_runtime'").get();
    const prior = hasRuntime ? this.connection.prepare('SELECT mode,local_principal_id FROM _qingdan_runtime WHERE id=1').get() : null;
    if (prior) this.assertMode(prior, mode);
    else this.assertUnmarkedEmpty(hasObjects);
  }
  private initializeRuntime(mode: AppMode, hasObjects: boolean) {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      this.connection.exec("CREATE TABLE IF NOT EXISTS _qingdan_runtime (id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL CHECK(mode IN ('local','accounts')), local_principal_id TEXT, created_at TEXT NOT NULL)");
      const prior = this.connection.prepare('SELECT mode,local_principal_id FROM _qingdan_runtime WHERE id=1').get();
      if (prior) {
        this.assertMode(prior, mode);
        this.connection.exec('COMMIT');
        return { mode, localPrincipalId: mode === 'local' ? String(prior.local_principal_id) : null };
      }
      this.assertUnmarkedEmpty(hasObjects);
      const localPrincipalId = mode === 'local' ? 'local:' + randomUUID() : null;
      this.connection.prepare('INSERT INTO _qingdan_runtime(id,mode,local_principal_id,created_at) VALUES(1,?,?,?)').run(mode, localPrincipalId, new Date().toISOString());
      this.connection.exec('COMMIT');
      return { mode, localPrincipalId };
    } catch (error) { this.connection.exec('ROLLBACK'); throw error; }
  }
  private migrate(directory: string) {
    const migrations = readdirSync(directory).filter(name => /^\d{4}_[a-zA-Z0-9_-]+\.sql$/.test(name)).sort();
    if (!migrations.length) throw new Error('No database migrations found.');
    this.connection.exec('CREATE TABLE IF NOT EXISTS _qingdan_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const available = new Set(migrations);
    const applied = this.connection.prepare('SELECT name FROM _qingdan_migrations').all();
    for (const row of applied) if (!available.has(String(row.name))) throw new Error(`Previously applied migration is missing: ${row.name}`);
    for (const name of migrations) {
      const sql = readFileSync(join(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      // Lock before checking the ledger so simultaneous processes cannot both apply the same migration.
      this.connection.exec('BEGIN IMMEDIATE');
      try {
        const prior = this.connection.prepare('SELECT checksum FROM _qingdan_migrations WHERE name=?').get(name);
        if (prior && prior.checksum !== checksum) throw new Error(`Applied migration has changed: ${name}`);
        if (!prior) {
          this.connection.exec(sql);
          this.connection.prepare('INSERT INTO _qingdan_migrations (name,checksum,applied_at) VALUES (?,?,?)').run(name, checksum, new Date().toISOString());
        }
        this.connection.exec('COMMIT');
      } catch (error) { this.connection.exec('ROLLBACK'); throw error; }
    }
  }
  prepare(sql: string) { return new LocalStatement(this, sql); }
  async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    for (const statement of statements) {
      if (!(statement instanceof LocalStatement) || statement.database !== this) throw new TypeError('Batch statements must belong to this database.');
    }
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      // All statements run synchronously in one event-loop turn. No request can interleave inside this transaction.
      const results = statements.map(statement => (statement as LocalStatement).execute<T>());
      this.connection.exec('COMMIT');
      return results;
    } catch (error) { this.connection.exec('ROLLBACK'); throw error; }
  }
  close() {
    if (this.closed) return;
    this.connection.close();
    this.closed = true;
  }
}

export interface ObjectHttpMetadata {
  contentType?: string; contentLanguage?: string; contentDisposition?: string;
  contentEncoding?: string; cacheControl?: string; cacheExpiry?: Date;
}
interface StoredMetadata {
  version: 1; key: string; size: number; etag: string; uploaded: string;
  httpMetadata: Omit<ObjectHttpMetadata, 'cacheExpiry'> & { cacheExpiry?: string };
  customMetadata: Record<string, string>;
}
export interface LocalObject {
  key: string; size: number; etag: string; httpEtag: string; uploaded: Date;
  httpMetadata: ObjectHttpMetadata; customMetadata: Record<string, string>;
  writeHttpMetadata(headers: Headers): void;
}
export interface LocalObjectBody extends LocalObject {
  body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
}
type ObjectInput = string | ArrayBuffer | ArrayBufferView | Blob | ReadableStream<Uint8Array>;

export class LocalBucket {
  readonly directory: string;
  constructor(directory: string) {
    rejectSymlink(directory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.directory = realpathSync(directory);
  }
  private objectPath(key: string) {
    if (typeof key !== 'string' || !key || Buffer.byteLength(key) > 1024 || key.startsWith('/') || /[\\\x00-\x1f]/.test(key) || key.split('/').some(part => !part || part === '.' || part === '..')) throw new TypeError('Invalid object key.');
    // Keys are opaque identifiers, never filesystem paths.
    return join(this.directory, createHash('sha256').update(key).digest('hex') + '.qobj');
  }
  private read(key: string): { metadata: StoredMetadata; bytes: Buffer } | null {
    const file = this.objectPath(key);
    let fd: number;
    try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if (isMissing(error)) return null; throw error; }
    let data: Buffer;
    try { data = readFileSync(fd); } finally { closeSync(fd); }
    if (data.length < 4) throw new Error('Object storage file is incomplete.');
    const length = data.readUInt32BE(0);
    if (length > 64 * 1024 || length + 4 > data.length) throw new Error('Object storage metadata is invalid.');
    const metadata = JSON.parse(data.subarray(4, length + 4).toString('utf8')) as StoredMetadata;
    const bytes = data.subarray(length + 4);
    if (metadata.version !== 1 || metadata.key !== key || metadata.size !== bytes.length || metadata.etag !== createHash('sha256').update(bytes).digest('hex')) throw new Error('Object storage integrity check failed.');
    return { metadata, bytes };
  }
  private describe(metadata: StoredMetadata): LocalObject {
    const httpMetadata = { ...metadata.httpMetadata, ...(metadata.httpMetadata.cacheExpiry ? { cacheExpiry: new Date(metadata.httpMetadata.cacheExpiry) } : {}) } as ObjectHttpMetadata;
    return {
      key: metadata.key, size: metadata.size, etag: metadata.etag, httpEtag: '"' + metadata.etag + '"',
      uploaded: new Date(metadata.uploaded), httpMetadata, customMetadata: { ...metadata.customMetadata },
      writeHttpMetadata(headers: Headers) {
        const names: Record<string, string> = { contentType: 'Content-Type', contentLanguage: 'Content-Language', contentDisposition: 'Content-Disposition', contentEncoding: 'Content-Encoding', cacheControl: 'Cache-Control' };
        for (const [field, header] of Object.entries(names)) if (httpMetadata[field as keyof ObjectHttpMetadata]) headers.set(header, String(httpMetadata[field as keyof ObjectHttpMetadata]));
        if (httpMetadata.cacheExpiry) headers.set('Expires', httpMetadata.cacheExpiry.toUTCString());
      },
    };
  }
  async head(key: string): Promise<LocalObject | null> {
    const stored = this.read(key);
    return stored ? this.describe(stored.metadata) : null;
  }
  async get(key: string): Promise<LocalObjectBody | null> {
    const stored = this.read(key);
    if (!stored) return null;
    const blob = new Blob([new Uint8Array(stored.bytes)]);
    return {
      ...this.describe(stored.metadata), body: blob.stream(),
      arrayBuffer: () => blob.arrayBuffer(), text: () => blob.text(),
      async json<T>() { return JSON.parse(await blob.text()) as T; },
    };
  }
  async put(key: string, input: ObjectInput, options: { httpMetadata?: ObjectHttpMetadata; customMetadata?: Record<string, string> } = {}): Promise<LocalObject> {
    const file = this.objectPath(key);
    let bytes: Buffer;
    if (typeof input === 'string') bytes = Buffer.from(input);
    else if (input instanceof ArrayBuffer) bytes = Buffer.from(input);
    else if (ArrayBuffer.isView(input)) bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    else if (input instanceof Blob) bytes = Buffer.from(await input.arrayBuffer());
    else if (input instanceof ReadableStream) bytes = Buffer.from(await new Response(input).arrayBuffer());
    else throw new TypeError('Unsupported object body.');
    const metadata: StoredMetadata = {
      version: 1, key, size: bytes.length, etag: createHash('sha256').update(bytes).digest('hex'), uploaded: new Date().toISOString(),
      httpMetadata: { ...options.httpMetadata, ...(options.httpMetadata?.cacheExpiry ? { cacheExpiry: options.httpMetadata.cacheExpiry.toISOString() } : {}) } as StoredMetadata['httpMetadata'],
      customMetadata: { ...options.customMetadata },
    };
    const header = Buffer.from(JSON.stringify(metadata));
    if (header.length > 64 * 1024) throw new TypeError('Object metadata is too large.');
    const prefix = Buffer.alloc(4); prefix.writeUInt32BE(header.length);
    const temporary = join(this.directory, '.tmp-' + randomUUID());
    let fd: number | undefined;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, Buffer.concat([prefix, header, bytes]));
      fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temporary, file);
      fsyncDirectory(this.directory);
    } catch (error) {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
    return this.describe(metadata);
  }
  async delete(key: string | string[]) {
    for (const item of Array.isArray(key) ? key : [key]) {
      try { unlinkSync(this.objectPath(item)); }
      catch (error) { if (!isMissing(error)) throw error; }
    }
    fsyncDirectory(this.directory);
  }
}

export function createLocalStorage(options: StorageOptions = {}) {
  const paths = storagePaths(options);
  mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
  const dataDir = realpathSync(paths.dataDir);
  const bucket = new LocalBucket(join(dataDir, 'objects'));
  const database = new LocalDatabase(join(dataDir, 'qingdan.sqlite'), paths.migrationsDir, paths.mode, readdirSync(bucket.directory).some(name => name.endsWith('.qobj')));
  return { database, bucket, dataDir, migrationsDir: paths.migrationsDir, mode: database.mode, localPrincipalId: database.localPrincipalId, close: () => database.close() };
}
