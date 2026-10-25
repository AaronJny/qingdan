'use strict';
// Synthetic sessions and temporary loopback listener only. Never reads a profile.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { AgentGateway } = require('../src/agent-gateway.cjs');
const { endpoint } = require('../src/policy.cjs');
const user = 'local:11111111-1111-4111-8111-111111111111';
const csrf = 'a'.repeat(64);
function fixture() {
  let connection = endpoint('https://fixture.example/'), accountId = user, available = true;
  const calls = []; let authGate, responseOverride;
  const gateway = new AgentGateway({ selected: () => ({ connection, available, fetch: async (url, options) => {
    calls.push({ url, options });
    if (new URL(url).pathname === '/api/auth/me') { if (authGate) await authGate; return Response.json({ user: accountId ? { userId: accountId } : null, csrfToken: csrf }); }
    const body = JSON.parse(options.body);
    if (responseOverride) return responseOverride(body);
    return Response.json({ result: body.name === 'list_lists' ? { items: body.scope.listIds.filter(id => id !== 'missing').map(id => ({ id, title: 'Synthetic list', revision: 1, writable: body.scope.writeEnabled })), nextCursor: null } : { id: 'synthetic-task', title: 'Synthetic task' } });
  } }) });
  return { gateway, calls, setAccount(value) { accountId = value; }, setConnection(value) { connection = value; }, setAvailable(value) { available = value; }, setAuthGate(value) { authGate = value; }, setResponse(value) { responseOverride = value; } };
}
const grantInput = { enabled: true, writeEnabled: false, listIds: ['list-a'], rotateToken: true };
function call(status, body = { name: 'search_tasks', arguments: {} }, headers = {}, path = '/tools') {
  const url = new URL(status.endpoint);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port, path, method: 'POST', headers: { Authorization: `Bearer ${status.token}`, 'Content-Type': 'application/json', ...headers } }, res => { let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text), headers: res.headers })); });
    req.on('error', reject); req.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
}
test('grant defaults off; explicit generation binds account and selected lists; only digest remains', async t => {
  const f = fixture(); t.after(() => f.gateway.close());
  assert.equal((await f.gateway.get(user)).enabled, false); assert.equal(f.gateway.server, null);
  await assert.rejects(f.gateway.save(user, { ...grantInput, rotateToken: false }), /Explicit/);
  const grant = await f.gateway.save(user, grantInput);
  assert.match(grant.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/tools$/); assert.match(grant.token, /^[\w-]{43}$/);
  assert.equal(grant.sessionOnly, true); assert.equal(JSON.stringify(f.gateway.grant).includes(grant.token), false);
  assert.equal((await f.gateway.get(user)).token, undefined);
  const out = await call(grant); assert.equal(out.status, 200);
  const dispatch = f.calls.at(-1); assert.equal(dispatch.url, 'https://fixture.example/api/agent/tools');
  assert.equal(dispatch.options.redirect, 'error'); assert.equal(dispatch.options.credentials, 'include');
  assert.equal(dispatch.options.headers.Origin, 'https://fixture.example'); assert.equal(dispatch.options.headers['x-qingdan-csrf'], csrf); assert.equal(dispatch.options.headers['x-qingdan-expected-account'], user);
  assert.equal(dispatch.options.headers.Authorization, undefined); assert.equal(dispatch.options.headers.Cookie, undefined);
  assert.deepEqual(JSON.parse(dispatch.options.body).scope, { listIds: ['list-a'], writeEnabled: false });
  assert.equal(out.headers['access-control-allow-origin'], undefined);
});
test('denies foreign host/browser origins, unauthorized tokens, arbitrary paths/tools/scope and read-only writes', async t => {
  const f = fixture(); t.after(() => f.gateway.close()); const grant = await f.gateway.save(user, grantInput);
  for (const headers of [{ Host: 'attacker.example' }, { Origin: 'https://fixture.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'same-origin' }]) assert.equal((await call(grant, undefined, headers)).status, 403);
  assert.equal((await call(grant, undefined, { Authorization: 'Bearer ' + 'x'.repeat(43) })).status, 401);
  assert.equal((await call(grant, undefined, {}, '/tools?x=1')).status, 404);
  for (const body of [{ name: 'raw_http', arguments: {} }, { name: 'search_tasks', arguments: {}, scope: { listIds: ['other'] } }, { name: 'search_tasks', arguments: [] }]) assert.equal((await call(grant, body)).status, 400);
  assert.equal((await call(grant, { name: 'create_task', arguments: {} })).status, 403);
  assert.equal((await call(grant, 'x'.repeat(32769))).status, 413);
});
test('rotation, disabling, logout and account changes invalidate old bearer without auto-binding', async t => {
  const f = fixture(); t.after(() => f.gateway.close()); let grant = await f.gateway.save(user, grantInput);
  const rotated = await f.gateway.save(user, grantInput); assert.notEqual(rotated.token, grant.token); assert.equal((await call(grant)).status, 401); grant = rotated;
  await f.gateway.save(user, { enabled: false, writeEnabled: false, listIds: [] }); assert.equal((await call(grant)).status, 401);
  grant = await f.gateway.save(user, grantInput); f.setAccount('another-account'); assert.equal((await call(grant)).status, 401); f.setAccount(user); assert.equal((await call(grant)).status, 401);
  grant = await f.gateway.save(user, grantInput); f.setAccount(null); assert.equal((await call(grant)).status, 401); assert.equal(f.gateway.grant, null);
});
test('switch or revoke during fresh session check cannot dispatch a tool', async t => {
  const f = fixture(); t.after(() => f.gateway.close()); const grant = await f.gateway.save(user, grantInput);
  let release; f.setAuthGate(new Promise(resolve => { release = resolve; }));
  const before = f.calls.filter(c => c.url.endsWith('/api/agent/tools')).length;
  const pending = call(grant); while (!f.calls.at(-1).url.endsWith('/api/auth/me')) await new Promise(resolve => setImmediate(resolve));
  f.gateway.revoke(); release(); assert.equal((await pending).status, 401);
  assert.equal(f.calls.filter(c => c.url.endsWith('/api/agent/tools')).length, before);
});
test('validates fresh selected list scope and rejects mismatched account, redirects and oversized service data', async t => {
  const f = fixture(); t.after(() => f.gateway.close());
  await assert.rejects(f.gateway.save(user, { ...grantInput, listIds: ['missing'] }), /unavailable/);
  await assert.rejects(f.gateway.save('other', grantInput), /account changed/);
  const grant = await f.gateway.save(user, grantInput);
  f.setResponse(() => { const response = Response.json({ result: {} }); Object.defineProperty(response, 'redirected', { value: true }); return response; });
  assert.equal((await call(grant)).status, 502);
  f.setResponse(() => Response.json({ result: 'x'.repeat(1048577) })); assert.equal((await call(grant)).status, 502);
  f.setConnection(endpoint('https://other.example/')); assert.equal((await call(grant)).status, 401);
});
