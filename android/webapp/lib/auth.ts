import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { database, localPrincipalId } from './storage.ts';

export type LocalUser = {
  userId: string;
  email: string;
  displayName: string;
  fullName: string | null;
  role: 'admin' | 'user';
};
type UserRow = { user_id: string; email: string; display_name: string; password_hash: string; role: LocalUser['role']; disabled: number };
type SessionRow = UserRow & { expires_at: number; last_seen_at: number };
export type ManagedUser = LocalUser & { disabled: boolean; createdAt: string };
export class AuthError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) { super(message); this.status = status; this.code = code; }
}

const SCRYPT = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
let activeHashes = 0;
const localCsrfToken = randomBytes(32).toString('hex');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const userOf = (row: UserRow): LocalUser => ({ userId: row.user_id, email: row.email, displayName: row.display_name, fullName: row.display_name, role: row.role });

export function appMode(): 'local' | 'accounts' {
  const primary = process.env.APP_MODE, alias = process.env.QINGDAN_MODE;
  if (primary && alias && primary !== alias) throw new AuthError('APP_MODE 与 QINGDAN_MODE 配置冲突。', 503);
  const mode = primary || alias || 'local';
  if (mode !== 'local' && mode !== 'accounts') throw new AuthError('APP_MODE 必须为 local 或 accounts。', 503);
  return mode;
}

export function authConfig(): { origin: string; secure: boolean; cookieName: string } {
  let url: URL;
  try { url = new URL(process.env.APP_ORIGIN || 'http://127.0.0.1:4310'); }
  catch { throw new AuthError('APP_ORIGIN 配置无效。', 503); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) {
    throw new AuthError('APP_ORIGIN 必须是 HTTPS 来源；本机回环地址可使用 HTTP。', 503);
  }
  const secure = url.protocol === 'https:';
  return { origin: url.origin, secure, cookieName: secure ? '__Host-qingdan_session' : 'qingdan_session' };
}

export function assertSameOrigin(request: Request): void {
  if (request.headers.get('origin') !== authConfig().origin || request.headers.get('x-qingdan') !== '1' || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new AuthError('请求来源不匹配，请从青单页面重试。', 403);
  }
}

function sessionToken(request?: Request): string | null {
  if (!request) return null;
  const name = authConfig().cookieName;
  const values = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return TOKEN_PATTERN.test(value) ? value : null;
}

function csrfFor(token: string): string { return digest('qingdan-csrf-v1:' + token); }
export function csrfTokenForRequest(request: Request): string | null {
  if (appMode() === 'local') return localCsrfToken;
  const token = sessionToken(request);
  return token ? csrfFor(token) : null;
}

export function assertCsrf(request: Request): void {
  assertSameOrigin(request);
  const expected = csrfTokenForRequest(request);
  const received = request.headers.get('x-qingdan-csrf') || '';
  if (!expected || !HASH_PATTERN.test(received) || !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'))) {
    throw new AuthError('登录会话已变化，请刷新页面后重试。', 403, 'CSRF_INVALID');
  }
}

export function sessionCookie(token: string | null): string {
  const config = authConfig();
  return `${config.cookieName}=${token || ''}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_MAX_AGE : 0}${config.secure ? '; Secure' : ''}`;
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new AuthError('请输入有效邮箱。');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError('请输入有效邮箱。');
  return email;
}

function validPassword(password: unknown, creating: boolean): password is string {
  return typeof password === 'string' && [...password].length >= (creating ? 15 : 1) && [...password].length <= 128 && Buffer.byteLength(password, 'utf8') <= 1024 && !password.includes('\0');
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (activeHashes >= 2) throw new AuthError('登录请求较多，请稍后重试。', 429);
  activeHashes++;
  try {
    return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32, SCRYPT, (error, key) => error ? reject(error) : resolve(key)));
  } finally { activeHashes--; }
}

export async function hashPassword(password: string): Promise<string> {
  if (!validPassword(password, true)) throw new AuthError('密码需要 15–128 个字符，可使用空格和中文。');
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$131072$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: unknown, encoded: string): Promise<boolean> {
  if (!validPassword(password, false)) return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$131072$8$1' || !/^[A-Za-z0-9_-]{22}$/.test(parts[4]) || !TOKEN_PATTERN.test(parts[5])) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (salt.length !== 16 || expected.length !== 32) return false;
  const key = await derive(password, salt);
  return timingSafeEqual(key, expected);
}

export async function getLocalUser(request?: Request): Promise<LocalUser | null> {
  if (appMode() === 'local') return { userId: localPrincipalId(), email: 'local@qingdan.invalid', displayName: '本地用户', fullName: '本地用户', role: 'admin' };
  const token = sessionToken(request);
  if (!token) return null;
  const db = database(), now = Date.now(), tokenHash = digest(token);
  const row = await db.prepare('SELECT u.*,s.expires_at,s.last_seen_at FROM auth_sessions s JOIN auth_users u ON u.user_id=s.user_id WHERE s.token_hash=?').bind(tokenHash).first<SessionRow>();
  if (!row || row.disabled || row.expires_at <= now || row.last_seen_at <= now - SESSION_IDLE_MS) {
    if (row) await db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(tokenHash).run();
    return null;
  }
  if (row.last_seen_at < now - 5 * 60 * 1000) await db.prepare('UPDATE auth_sessions SET last_seen_at=? WHERE token_hash=?').bind(now, tokenHash).run();
  return userOf(row);
}

async function reserveLimit(key: string, max: number, windowMs: number): Promise<void> {
  const now = Date.now();
  const row = await database().prepare(`INSERT INTO auth_login_limits(limit_key,attempts,window_end) VALUES(?,1,?)
    ON CONFLICT(limit_key) DO UPDATE SET attempts=CASE WHEN window_end<=? THEN 1 ELSE attempts+1 END,
    window_end=CASE WHEN window_end<=? THEN excluded.window_end ELSE window_end END
    RETURNING attempts`).bind(key, now + windowMs, now, now).first<{ attempts: number }>();
  if (!row || row.attempts > max) throw new AuthError('尝试次数较多，请稍后重试。', 429, 'LOGIN_RATE_LIMITED');
}

export async function loginLocalUser(request: Request, input: { email?: unknown; password?: unknown }): Promise<{ user: LocalUser; csrfToken: string; cookie: string }> {
  assertAccountsMode();
  assertSameOrigin(request);
  const email = normalizeEmail(input.email);
  if (!validPassword(input.password, false)) throw new AuthError('邮箱或密码不正确。', 401);
  const db = database(), now = Date.now();
  await db.prepare('DELETE FROM auth_login_limits WHERE window_end<?').bind(now - 24 * 60 * 60 * 1000).run();
  await reserveLimit('global', 50, 60 * 1000);
  const accountKey = 'account:' + digest(email);
  await reserveLimit(accountKey, 5, 15 * 60 * 1000);
  const row = await db.prepare('SELECT * FROM auth_users WHERE email=?').bind(email).first<UserRow>();
  // Perform the same costly operation for unknown accounts. This digest is not an account or a usable credential.
  const dummy = `scrypt$131072$8$1$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(32).toString('base64url')}`;
  const verified = await verifyPassword(input.password, row?.password_hash || dummy);
  if (!row || row.disabled || !verified) throw new AuthError('邮箱或密码不正确。', 401);
  const token = randomBytes(32).toString('base64url');
  const previous = sessionToken(request);
  const statements = [db.prepare('DELETE FROM auth_sessions WHERE expires_at<=? OR last_seen_at<=?').bind(now, now - SESSION_IDLE_MS)];
  if (previous) statements.push(db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(digest(previous)));
  const sessionInsertIndex = statements.length;
  // Recheck the account inside the transaction: a password reset or disable during scrypt must not grant a stale session.
  statements.push(db.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,last_seen_at,expires_at) SELECT ?,user_id,?,?,? FROM auth_users WHERE user_id=? AND password_hash=? AND disabled=0').bind(digest(token), now, now, now + SESSION_MAX_AGE * 1000, row.user_id, row.password_hash));
  statements.push(db.prepare('DELETE FROM auth_login_limits WHERE limit_key=?').bind(accountKey));
  const results = await db.batch(statements);
  if (results[sessionInsertIndex].meta.changes !== 1) throw new AuthError('邮箱或密码不正确。', 401);
  return { user: userOf(row), csrfToken: csrfFor(token), cookie: sessionCookie(token) };
}

export async function logoutLocalUser(request: Request): Promise<void> {
  assertAccountsMode();
  assertCsrf(request);
  const token = sessionToken(request);
  if (token) await database().prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(digest(token)).run();
}

function actorClause(actorId?: string): string {
  return actorId ? " AND EXISTS(SELECT 1 FROM auth_users actor WHERE actor.user_id=? AND actor.role='admin' AND actor.disabled=0)" : '';
}
const actorValues = (actorId?: string): string[] => actorId ? [actorId] : [];

export async function createLocalUser(input: { email: string; password: string; displayName: string; role?: LocalUser['role'] }, options: { firstAdmin?: boolean; actorId?: string } = {}): Promise<LocalUser> {
  assertAccountsMode();
  const email = normalizeEmail(input.email), displayName = input.displayName.trim();
  if (!displayName || displayName.length > 100) throw new AuthError('姓名需要 1–100 个字符。');
  const role = options.firstAdmin ? 'admin' : input.role || 'user';
  if (!['admin', 'user'].includes(role)) throw new AuthError('用户角色无效。');
  const passwordHash = await hashPassword(input.password), id = randomUUID(), db = database();
  let inserted;
  try {
    inserted = await db.prepare(`INSERT INTO auth_users(user_id,email,display_name,password_hash,role,created_at)
      SELECT ?,?,?,?,?,? WHERE ${options.firstAdmin ? 'NOT EXISTS(SELECT 1 FROM auth_users)' : "EXISTS(SELECT 1 FROM auth_users WHERE role='admin' AND disabled=0)"}${actorClause(options.actorId)}`)
      .bind(id, email, displayName, passwordHash, role, Date.now(), ...actorValues(options.actorId)).run();
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed.*auth_users\.email/i.test(error.message)) throw new AuthError('该邮箱已有账号。', 409);
    throw error;
  }
  if (inserted.meta.changes !== 1) throw new AuthError(options.actorId ? '管理员会话或权限已变化，请重新登录。' : options.firstAdmin ? '管理员已初始化，请使用 add-user。' : '请先使用 init-admin 初始化管理员。', options.actorId ? 403 : 409);
  return { userId: id, email, displayName, fullName: displayName, role };
}

export async function setLocalPassword(emailInput: string, password: string, actorId?: string): Promise<void> {
  assertAccountsMode();
  const email = normalizeEmail(emailInput), passwordHash = await hashPassword(password), db = database();
  const result = await db.batch([
    db.prepare(`DELETE FROM auth_sessions WHERE user_id IN(SELECT user_id FROM auth_users WHERE email=?${actorClause(actorId)})`).bind(email, ...actorValues(actorId)),
    db.prepare(`UPDATE auth_users SET password_hash=? WHERE email=?${actorClause(actorId)}`).bind(passwordHash, email, ...actorValues(actorId)),
    db.prepare(`DELETE FROM auth_login_limits WHERE limit_key=?${actorClause(actorId)}`).bind('account:' + digest(email), ...actorValues(actorId)),
  ]);
  if (result[1].meta.changes !== 1) throw new AuthError(actorId ? '管理员会话或权限已变化，请重新登录。' : '账号不存在。', actorId ? 403 : 404);
}

export async function disableLocalUser(emailInput: string, actorId?: string): Promise<void> {
  assertAccountsMode();
  const email = normalizeEmail(emailInput), db = database();
  const result = await db.batch([
    db.prepare(`DELETE FROM auth_sessions WHERE user_id IN(SELECT user_id FROM auth_users WHERE email=? AND (role='user' OR disabled=1 OR EXISTS(SELECT 1 FROM auth_users WHERE email<>? AND role='admin' AND disabled=0))${actorClause(actorId)})`).bind(email, email, ...actorValues(actorId)),
    db.prepare(`UPDATE auth_users SET disabled=1 WHERE email=? AND (role='user' OR disabled=1 OR EXISTS(SELECT 1 FROM auth_users WHERE email<>? AND role='admin' AND disabled=0))${actorClause(actorId)}`).bind(email, email, ...actorValues(actorId)),
  ]);
  if (result[1].meta.changes !== 1) throw new AuthError('账号不存在、管理员权限已变化，或不能停用最后一位启用的管理员。', 409);
}

export function assertAccountsMode(): void {
  if (appMode() !== 'accounts') throw new AuthError('本地模式无需账号密码，账号管理仅在账号模式可用。', 403, 'ACCOUNTS_MODE_REQUIRED');
}

function managedUser(row: UserRow & { created_at: number }): ManagedUser {
  return { ...userOf(row), disabled: !!row.disabled, createdAt: new Date(row.created_at).toISOString() };
}

export async function listLocalUsers(): Promise<ManagedUser[]> {
  assertAccountsMode();
  const rows = await database().prepare('SELECT user_id,email,display_name,role,disabled,created_at FROM auth_users ORDER BY created_at,user_id').all<UserRow & { created_at: number }>();
  return rows.results.map(managedUser);
}

export async function managedUserById(userId: unknown): Promise<ManagedUser> {
  assertAccountsMode();
  if (typeof userId !== 'string' || !/^[a-f0-9-]{36}$/.test(userId)) throw new AuthError('用户编号无效。');
  const row = await database().prepare('SELECT user_id,email,display_name,role,disabled,created_at FROM auth_users WHERE user_id=?').bind(userId).first<UserRow & { created_at: number }>();
  if (!row) throw new AuthError('账号不存在。', 404);
  return managedUser(row);
}

export async function enableLocalUser(userId: unknown, actorId?: string): Promise<ManagedUser> {
  const user = await managedUserById(userId);
  const result = await database().prepare(`UPDATE auth_users SET disabled=0 WHERE user_id=?${actorClause(actorId)}`).bind(user.userId, ...actorValues(actorId)).run();
  if (result.meta.changes !== 1) throw new AuthError('管理员会话或权限已变化，请重新登录。', 403);
  return managedUserById(user.userId);
}

export async function setLocalRole(userId: unknown, role: unknown, actorId?: string): Promise<ManagedUser> {
  const user = await managedUserById(userId);
  if (role !== 'admin' && role !== 'user') throw new AuthError('用户角色无效。');
  const db = database();
  const results = await db.batch([
    db.prepare(`DELETE FROM auth_sessions WHERE user_id IN(SELECT user_id FROM auth_users WHERE user_id=? AND (role='user' OR disabled=1 OR ?='admin' OR EXISTS(SELECT 1 FROM auth_users WHERE user_id<>? AND role='admin' AND disabled=0))${actorClause(actorId)})`).bind(user.userId, role, user.userId, ...actorValues(actorId)),
    db.prepare(`UPDATE auth_users SET role=? WHERE user_id=? AND (role='user' OR disabled=1 OR ?='admin' OR EXISTS(SELECT 1 FROM auth_users WHERE user_id<>? AND role='admin' AND disabled=0))${actorClause(actorId)}`).bind(role, user.userId, role, user.userId, ...actorValues(actorId)),
  ]);
  if (results[1].meta.changes !== 1) throw new AuthError('管理员权限已变化，或不能降低最后一位启用管理员的角色。', 409);
  return managedUserById(user.userId);
}
