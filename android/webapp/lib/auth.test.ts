import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { initializeStorage, closeStorage, database } from './storage.ts';
import { AuthError, authConfig, assertCsrf, createLocalUser, disableLocalUser, getLocalUser, hashPassword, loginLocalUser, SESSION_IDLE_MS, SESSION_MAX_AGE, setLocalPassword, verifyPassword } from './auth.ts';
import { dispatchAuth } from '../server/auth-routes.ts';
import { dispatchUsers } from '../server/user-routes.ts';

// All accounts, passwords, cookies and databases in this file are synthetic and isolated.
const TEST_PASSWORD = 'Synthetic test only 2026!';
const TEST_NEW_PASSWORD = 'Synthetic replacement only 2026!';
const EMAIL = 'administrator@qingdan-test.invalid';
const ORIGIN = 'http://127.0.0.1:4310';
let temp: string;
const previousOrigin = process.env.APP_ORIGIN;
const previousMode = process.env.APP_MODE;
const previousAlias = process.env.QINGDAN_MODE;
before(() => {
  temp = mkdtempSync(join(tmpdir(), 'qingdan-auth-test-'));
  process.env.APP_ORIGIN = ORIGIN;
  process.env.APP_MODE = 'accounts';
  delete process.env.QINGDAN_MODE;
  initializeStorage({ dataDir: temp });
});
beforeEach(async () => {
  await database().batch(['DELETE FROM auth_sessions', 'DELETE FROM auth_users', 'DELETE FROM auth_login_limits'].map(sql => database().prepare(sql)));
  process.env.APP_ORIGIN = ORIGIN;
  process.env.APP_MODE = 'accounts';
});
after(() => {
  closeStorage();
  rmSync(temp, { recursive: true, force: true });
  if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = previousOrigin;
  if (previousMode === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = previousMode;
  if (previousAlias === undefined) delete process.env.QINGDAN_MODE; else process.env.QINGDAN_MODE = previousAlias;
});

function request(path = '/api/auth/login', options: { method?: string; body?: unknown; cookie?: string; csrf?: string; origin?: string | null; extra?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-qingdan': '1', ...options.extra };
  if (options.origin !== null) headers.origin = options.origin || ORIGIN;
  if (options.cookie) headers.cookie = options.cookie;
  if (options.csrf) headers['x-qingdan-csrf'] = options.csrf;
  const method = options.method || 'POST';
  return new Request(ORIGIN + path, { method, headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
}
async function admin() { return createLocalUser({ email: EMAIL, password: TEST_PASSWORD, displayName: '合成测试管理员' }, { firstAdmin: true }); }
async function login(email = EMAIL, password = TEST_PASSWORD, cookie?: string) {
  return loginLocalUser(request('/api/auth/login', { cookie }), { email, password });
}
const cookieOnly = (cookie: string) => cookie.split(';')[0];
const tokenHash = (cookie: string) => createHash('sha256').update(cookieOnly(cookie).split('=')[1]).digest('hex');
const hasStatus = (status: number) => (error: unknown) => error instanceof AuthError && error.status === status;

test('passwords use independent salts, preserve Unicode/spaces, and reject invalid or malformed values', async () => {
  const password = '  合成测试密码允许空格与中文  ';
  const first = await hashPassword(password), second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$131072\$8\$1\$/);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password.trim(), first), false);
  assert.equal(await verifyPassword('wrong test password', first), false);
  assert.equal(await verifyPassword(password, 'malformed'), false);
  assert.equal(await verifyPassword(undefined, first), false);
  await assert.rejects(hashPassword('too short'), hasStatus(400));
  await assert.rejects(hashPassword('a'.repeat(129)), hasStatus(400));
});

test('initialization is one-time, user emails normalize, duplicate emails fail, and local IDs persist', async () => {
  await assert.rejects(createLocalUser({ email: 'user@test.invalid', password: TEST_PASSWORD, displayName: '测试' }), hasStatus(409));
  const user = await admin();
  assert.equal(user.role, 'admin');
  assert.match(user.userId, /^[a-f0-9-]{36}$/);
  await assert.rejects(admin(), hasStatus(409));
  const other = await createLocalUser({ email: ' Other@TEST.invalid ', password: TEST_PASSWORD, displayName: ' 测试用户 ' });
  assert.equal(other.email, 'other@test.invalid');
  assert.equal(other.displayName, '测试用户');
  assert.equal(other.role, 'user');
  await assert.rejects(createLocalUser({ email: 'OTHER@test.invalid', password: TEST_PASSWORD, displayName: '重复' }), hasStatus(409));
  closeStorage();
  initializeStorage({ dataDir: temp });
  assert.equal((await login()).user.userId, user.userId);
});

test('successful login stores only token digest and serves matching local identity and CSRF', async () => {
  const expected = await admin(), result = await login();
  assert.deepEqual(result.user, expected);
  assert.match(result.cookie, /HttpOnly; SameSite=Strict; Max-Age=604800/);
  assert.doesNotMatch(result.cookie, /Secure|Domain=/);
  const raw = cookieOnly(result.cookie).split('=')[1];
  assert.notEqual(raw, result.csrfToken);
  const rows = await database().prepare('SELECT * FROM auth_sessions').all();
  assert.equal(rows.results.length, 1);
  assert.equal(rows.results[0].token_hash, tokenHash(result.cookie));
  assert.equal(JSON.stringify(rows.results).includes(raw), false);
  const signed = request('/api/data', { cookie: cookieOnly(result.cookie), csrf: result.csrfToken });
  assert.deepEqual(await getLocalUser(signed), expected);
  assert.doesNotThrow(() => assertCsrf(signed));
  const response = (await dispatchAuth(request('/api/auth/me', { method: 'GET', cookie: cookieOnly(result.cookie) })))!;
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control')!, /no-store/);
  assert.deepEqual(await response.json(), { mode: 'accounts', user: expected, csrfToken: result.csrfToken });
});

test('untrusted identity headers, malformed/duplicate cookies, and absent sessions do not authenticate', async () => {
  await admin();
  assert.equal(await getLocalUser(), null);
  assert.equal(await getLocalUser(request('/api/auth/me', { method: 'GET', extra: { 'oai-authenticated-user-id': 'forged', 'oai-authenticated-user-email': EMAIL } })), null);
  const result = await login();
  const cookie = cookieOnly(result.cookie);
  assert.equal(await getLocalUser(request('/api/auth/me', { method: 'GET', cookie: cookie + '; ' + cookie })), null);
  assert.equal(await getLocalUser(request('/api/auth/me', { method: 'GET', cookie: 'qingdan_session=%00broken' })), null);
  const response = (await dispatchAuth(request('/api/auth/me', { method: 'GET' })))!;
  assert.deepEqual(await response.json(), { mode: 'accounts', user: null, csrfToken: null });
});

test('write protection rejects missing/cross origin, missing header, and wrong or another-session CSRF', async () => {
  await admin();
  const a = await login(), b = await login();
  const cases: Parameters<typeof request>[1][] = [{ origin: null }, { origin: 'https://untrusted.invalid' }, { csrf: 'a'.repeat(64) }, { csrf: b.csrfToken }, { extra: { 'x-qingdan': '0' } }, { extra: { 'sec-fetch-site': 'cross-site' } }];
  for (const options of cases) {
    assert.throws(() => assertCsrf(request('/api/data', { cookie: cookieOnly(a.cookie), csrf: a.csrfToken, ...options })), hasStatus(403));
  }
  assert.throws(() => assertCsrf(request('/api/data', { cookie: cookieOnly(a.cookie) })), hasStatus(403));
  await assert.rejects(loginLocalUser(request('/api/auth/login', { origin: null }), { email: EMAIL, password: TEST_PASSWORD }), hasStatus(403));
});

test('new login rotates and revokes the previous cookie; logout revokes and clears cookie', async () => {
  await admin();
  const a = await login(), b = await login(EMAIL, TEST_PASSWORD, cookieOnly(a.cookie));
  assert.notEqual(a.cookie, b.cookie);
  assert.equal(await getLocalUser(request('/api/auth/me', { method: 'GET', cookie: cookieOnly(a.cookie) })), null);
  assert.ok(await getLocalUser(request('/api/auth/me', { method: 'GET', cookie: cookieOnly(b.cookie) })));
  const denied = (await dispatchAuth(request('/api/auth/logout', { cookie: cookieOnly(b.cookie) })))!;
  assert.equal(denied.status, 403);
  const out = (await dispatchAuth(request('/api/auth/logout', { cookie: cookieOnly(b.cookie), csrf: b.csrfToken })))!;
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie')!, /Max-Age=0/);
  assert.deepEqual(await out.json(), { mode: 'accounts', user: null, csrfToken: null });
  assert.equal(await getLocalUser(request('/api/auth/me', { method: 'GET', cookie: cookieOnly(b.cookie) })), null);
});

test('absolute and idle session expiry remove server-side sessions; activity refresh preserves absolute deadline', async () => {
  await admin();
  const expired = await login();
  await database().prepare('UPDATE auth_sessions SET expires_at=? WHERE token_hash=?').bind(Date.now() - 1, tokenHash(expired.cookie)).run();
  assert.equal(await getLocalUser(request('/api/auth/me', { method: 'GET', cookie: cookieOnly(expired.cookie) })), null);
  const idle = await login();
  await database().prepare('UPDATE auth_sessions SET last_seen_at=? WHERE token_hash=?').bind(Date.now() - SESSION_IDLE_MS - 1, tokenHash(idle.cookie)).run();
  assert.equal(await getLocalUser(request('/api/auth/me', { method: 'GET', cookie: cookieOnly(idle.cookie) })), null);
  const active = await login();
  const beforeRow = await database().prepare('SELECT expires_at FROM auth_sessions WHERE token_hash=?').bind(tokenHash(active.cookie)).first<{ expires_at: number }>();
  await database().prepare('UPDATE auth_sessions SET last_seen_at=? WHERE token_hash=?').bind(Date.now() - 6 * 60 * 1000, tokenHash(active.cookie)).run();
  assert.ok(await getLocalUser(request('/api/auth/me', { method: 'GET', cookie: cookieOnly(active.cookie) })));
  const row = await database().prepare('SELECT expires_at,last_seen_at FROM auth_sessions WHERE token_hash=?').bind(tokenHash(active.cookie)).first<{ expires_at: number; last_seen_at: number }>();
  assert.equal(row!.expires_at, beforeRow!.expires_at);
  assert.ok(row!.last_seen_at > Date.now() - 10000);
  assert.ok(row!.expires_at <= Date.now() + SESSION_MAX_AGE * 1000);
});

test('wrong/unknown accounts share login errors and per-account limits persist through restart', async () => {
  await admin();
  for (let i = 0; i < 5; i++) await assert.rejects(login(EMAIL, 'wrong synthetic password'), hasStatus(401));
  closeStorage(); initializeStorage({ dataDir: temp });
  await assert.rejects(login(), hasStatus(429));
  await assert.rejects(login('missing@qingdan-test.invalid'), hasStatus(401));
  assert.equal((await database().prepare('SELECT COUNT(*) AS n FROM auth_sessions').first<{ n: number }>())!.n, 0);
  await database().prepare('UPDATE auth_login_limits SET window_end=?').bind(Date.now() - 1).run();
  assert.ok((await login()).user);
  assert.equal(await database().prepare('SELECT * FROM auth_login_limits WHERE limit_key=?').bind('account:' + createHash('sha256').update(EMAIL).digest('hex')).first(), null);
});

test('global limit stops additional password work without needing trusted proxy headers', async () => {
  await admin();
  await database().prepare('INSERT INTO auth_login_limits VALUES(?,?,?)').bind('global', 50, Date.now() + 60000).run();
  await assert.rejects(login(), hasStatus(429));
  assert.equal((await database().prepare('SELECT COUNT(*) AS n FROM auth_sessions').first<{ n: number }>())!.n, 0);
});

test('password reset revokes all sessions, rejects old password, and preserves local identity', async () => {
  const expected = await admin(), a = await login(), b = await login();
  await setLocalPassword(EMAIL, TEST_NEW_PASSWORD);
  for (const session of [a, b]) assert.equal(await getLocalUser(request('/api/auth/me', { method: 'GET', cookie: cookieOnly(session.cookie) })), null);
  await assert.rejects(login(), hasStatus(401));
  assert.deepEqual((await login(EMAIL, TEST_NEW_PASSWORD)).user, expected);
});

test('disabled accounts cannot login or keep sessions; last active administrator cannot be disabled', async () => {
  await admin();
  await assert.rejects(disableLocalUser(EMAIL), hasStatus(409));
  const email = 'member@qingdan-test.invalid';
  await createLocalUser({ email, password: TEST_PASSWORD, displayName: '合成用户' });
  const session = await login(email);
  await disableLocalUser(email);
  assert.equal(await getLocalUser(request('/api/auth/me', { method: 'GET', cookie: cookieOnly(session.cookie) })), null);
  await assert.rejects(login(email), hasStatus(401));
});

test('HTTPS cookie enforces host/secure flags; insecure non-loopback configurations fail closed', async () => {
  await admin();
  process.env.APP_ORIGIN = 'https://tasks.qingdan-test.invalid';
  const requestHttps = new Request(process.env.APP_ORIGIN + '/api/auth/login', { method: 'POST', headers: { origin: process.env.APP_ORIGIN, 'x-qingdan': '1' } });
  const result = await loginLocalUser(requestHttps, { email: EMAIL, password: TEST_PASSWORD });
  assert.match(result.cookie, /^__Host-qingdan_session=/);
  assert.match(result.cookie, /; Secure$/);
  assert.doesNotMatch(result.cookie, /Domain=/);
  for (const value of ['http://private-server.invalid:4310', 'https://user:pass@tasks.invalid', 'https://tasks.invalid/a', 'not a url']) {
    process.env.APP_ORIGIN = value;
    assert.throws(authConfig, hasStatus(503));
  }
});

test('auth dispatch enforces methods/JSON/size, handles normal errors, and leaves other APIs to the server', async () => {
  assert.equal(await dispatchAuth(request('/api/data')), null);
  assert.equal((await dispatchAuth(request('/api/auth/login', { method: 'GET' })))!.status, 405);
  assert.equal((await dispatchAuth(request('/api/auth/login', { body: [], extra: { 'content-type': 'text/plain' } })))!.status, 415);
  assert.equal((await dispatchAuth(request('/api/auth/login', { body: { email: EMAIL, password: TEST_PASSWORD }, extra: { 'content-length': '9000' } })))!.status, 413);
  assert.equal((await dispatchAuth(request('/api/auth/login', { body: { value: 'a'.repeat(9000) } })))!.status, 413);
  const invalid = new Request(ORIGIN + '/api/auth/login', { method: 'POST', headers: { origin: ORIGIN, 'x-qingdan': '1', 'content-type': 'application/json' }, body: '{' });
  assert.equal((await dispatchAuth(invalid))!.status, 400);
  await admin();
  const success = (await dispatchAuth(request('/api/auth/login', { body: { email: EMAIL, password: TEST_PASSWORD } })))!;
  assert.equal(success.status, 200);
  assert.ok(success.headers.get('set-cookie'));
  const body = await success.json();
  assert.equal(JSON.stringify(body).includes(TEST_PASSWORD), false);
  assert.ok(body.csrfToken);
});

test('account CLI refuses piped credentials and never creates a database in that path', () => {
  const isolated = join(temp, 'cli-must-not-create');
  const result = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/users.ts', 'init-admin'], { cwd: new URL('..', import.meta.url), env: { ...process.env, QINGDAN_DATA_DIR: isolated }, input: 'synthetic data is not accepted\n', encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /交互终端/);
  assert.equal(result.stdout.includes(TEST_PASSWORD), false);
  assert.equal(existsSync(isolated), false);
});

test('administrators list safe fields and create, disable, enable, reset passwords and adjust roles', async () => {
  const owner = await admin(), session = await login();
  const adminRequest = (body?: unknown, method = 'POST') => request('/api/auth/users', { method, body, cookie: cookieOnly(session.cookie), csrf: session.csrfToken });
  const listed = (await dispatchUsers(adminRequest(undefined, 'GET')))!;
  assert.equal(listed.status, 200);
  const initial = await listed.json();
  assert.equal(initial.users[0].userId, owner.userId);
  assert.equal(initial.users[0].disabled, false);
  assert.equal(JSON.stringify(initial).includes('password'), false);
  assert.equal(JSON.stringify(initial).includes('token'), false);
  const created = (await dispatchUsers(adminRequest({ operation: 'create', email: 'managed@qingdan-test.invalid', displayName: '合成管理用户', password: TEST_PASSWORD })))!;
  assert.equal(created.status, 201);
  const target = (await created.json()).user;
  const memberSession = await login(target.email);
  const change = async (operation: string, extra: Record<string, unknown> = {}) => (await dispatchUsers(adminRequest({ operation, userId: target.userId, ...extra })))!;
  assert.equal((await change('disable')).status, 200);
  assert.equal(await getLocalUser(request('/api/auth/me', { method: 'GET', cookie: cookieOnly(memberSession.cookie) })), null);
  await assert.rejects(login(target.email), hasStatus(401));
  assert.equal((await change('enable')).status, 200);
  const restored = await login(target.email);
  assert.equal((await change('password', { password: TEST_NEW_PASSWORD })).status, 200);
  assert.equal(await getLocalUser(request('/api/auth/me', { method: 'GET', cookie: cookieOnly(restored.cookie) })), null);
  await assert.rejects(login(target.email), hasStatus(401));
  const replaced = await login(target.email, TEST_NEW_PASSWORD);
  assert.equal((await change('role', { role: 'admin' })).status, 200);
  assert.equal(await getLocalUser(request('/api/auth/me', { method: 'GET', cookie: cookieOnly(replaced.cookie) })), null);
  assert.equal((await login(target.email, TEST_NEW_PASSWORD)).user.role, 'admin');
  assert.equal((await change('role', { role: 'user' })).status, 200);
  assert.equal((await change('role', { role: 'invalid' })).status, 400);
});

test('account-management APIs require admin and CSRF and protect the final enabled administrator', async () => {
  const owner = await admin(), session = await login();
  await createLocalUser({ email: 'ordinary@qingdan-test.invalid', password: TEST_PASSWORD, displayName: '合成普通用户' });
  const ordinary = await login('ordinary@qingdan-test.invalid');
  assert.equal((await dispatchUsers(request('/api/auth/users', { method: 'GET' })))!.status, 401);
  assert.equal((await dispatchUsers(request('/api/auth/users', { method: 'GET', cookie: cookieOnly(ordinary.cookie) })))!.status, 403);
  assert.equal((await dispatchUsers(request('/api/auth/users', { cookie: cookieOnly(session.cookie), body: { operation: 'disable', userId: owner.userId } })))!.status, 403);
  for (const operation of ['disable', 'role']) {
    const response = (await dispatchUsers(request('/api/auth/users', { cookie: cookieOnly(session.cookie), csrf: session.csrfToken, body: { operation, userId: owner.userId, role: 'user' } })))!;
    assert.equal(response.status, 409);
    assert.ok(await getLocalUser(request('/api/auth/me', { method: 'GET', cookie: cookieOnly(session.cookie) })));
  }
  assert.equal(await dispatchUsers(request('/api/data')), null);
});

test('in-flight login and account updates recheck changed account state before committing', async () => {
  const original = await admin();
  const additional = await createLocalUser({ email: 'second-admin@qingdan-test.invalid', displayName: '合成第二管理员', password: TEST_PASSWORD, role: 'admin' });
  const pendingLogin = login();
  const loginResult = assert.rejects(pendingLogin, hasStatus(401));
  await new Promise(resolve => setImmediate(resolve));
  await database().prepare('UPDATE auth_users SET disabled=1 WHERE user_id=?').bind(original.userId).run();
  await loginResult;
  assert.equal((await database().prepare('SELECT COUNT(*) AS n FROM auth_sessions').first<{ n: number }>())!.n, 0);
  const pendingCreate = createLocalUser({ email: 'pending@qingdan-test.invalid', displayName: '合成待创建用户', password: TEST_PASSWORD }, { actorId: additional.userId });
  const createResult = assert.rejects(pendingCreate, hasStatus(403));
  await database().prepare("UPDATE auth_users SET role='user' WHERE user_id=?").bind(additional.userId).run();
  await createResult;
  assert.equal(await database().prepare('SELECT user_id FROM auth_users WHERE email=?').bind('pending@qingdan-test.invalid').first(), null);
});

test('local mode provides a stable directory-specific identity and CSRF without accounts or cookies', async () => {
  const localDir = join(temp, 'separate-local-mode');
  closeStorage();
  process.env.APP_MODE = 'local';
  try {
    initializeStorage({ dataDir: localDir });
    const response = (await dispatchAuth(request('/api/auth/me', { method: 'GET' })))!;
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    const body = await response.json();
    assert.equal(body.mode, 'local');
    assert.match(body.user.userId, /^local:[a-f0-9-]{36}$/);
    assert.ok(body.csrfToken);
    assert.equal((await database().prepare('SELECT COUNT(*) AS n FROM auth_users').first<{ n: number }>())!.n, 0);
    assert.doesNotThrow(() => assertCsrf(request('/api/data', { csrf: body.csrfToken })));
    assert.throws(() => assertCsrf(request('/api/data')), hasStatus(403));
    assert.throws(() => assertCsrf(request('/api/data', { csrf: body.csrfToken, origin: 'https://untrusted.invalid' })), hasStatus(403));
    assert.equal((await dispatchUsers(request('/api/auth/users', { method: 'GET' })))!.status, 403);
    await assert.rejects(admin(), hasStatus(403));
    assert.equal((await dispatchAuth(request('/api/auth/login', { body: { email: EMAIL, password: TEST_PASSWORD } })))!.status, 403);
    closeStorage(); initializeStorage({ dataDir: localDir });
    assert.equal((await getLocalUser())!.userId, body.user.userId);
  } finally {
    closeStorage(); process.env.APP_MODE = 'accounts'; initializeStorage({ dataDir: temp });
  }
});
