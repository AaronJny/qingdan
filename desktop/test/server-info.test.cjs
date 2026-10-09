'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { endpoint } = require('../src/policy.cjs'); const { validateInfo, probeServer, MAX_BYTES } = require('../src/server-info.cjs');
const connection = endpoint('http://127.0.0.1:4310/');
function json(value, init = {}) { return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' }, ...init }); }
test('backend alone selects local or accounts regardless of loopback connection', async () => {
  for (const mode of ['local', 'accounts']) {
    const result = await probeServer(connection, async () => json({ app: 'qingdan', version: '1.0.0', mode }));
    assert.equal(result.ok, true); assert.equal(result.info.mode, mode);
  }
});
test('app-info is exact same-origin readonly GET with no cookies or authorization', async () => {
  let target, options;
  await probeServer(connection, async (value, init) => { target = value; options = init; return json({ app: 'qingdan', version: '1.0.0', mode: 'accounts' }); });
  assert.equal(target, 'http://127.0.0.1:4310/api/app-info'); assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); assert.deepEqual(options.headers, { Accept: 'application/json' });
});
test('incompatible app/version/mode, unexpected identity fields, HTML and invalid JSON fail closed', async () => {
  for (const value of [{ app: 'other', version: '1.0.0', mode: 'local' }, { app: 'qingdan', version: '2.0.0', mode: 'local' }, { app: 'qingdan', version: '1.0.0', mode: 'public' }, { app: 'qingdan', version: '1.0.0', mode: 'local', identity: 'unexpected' }]) { assert.throws(() => validateInfo(value)); assert.equal((await probeServer(connection, async () => json(value))).ok, false); }
  assert.equal((await probeServer(connection, async () => new Response('<html/>', { headers: { 'content-type': 'text/html' } }))).ok, false);
  assert.equal((await probeServer(connection, async () => new Response('{bad', { headers: { 'content-type': 'application/json' } }))).ok, false);
});
test('response size limits and HTTP/redirect failures never open an unrelated application', async () => {
  assert.equal((await probeServer(connection, async () => new Response('x'.repeat(MAX_BYTES + 1), { headers: { 'content-type': 'application/json' } }))).ok, false);
  assert.equal((await probeServer(connection, async () => json({}, { status: 404 }))).ok, false);
  const redirect = json({ app: 'qingdan', version: '1.0.0', mode: 'local' }); Object.defineProperty(redirect, 'redirected', { value: true });
  assert.equal((await probeServer(connection, async () => redirect)).ok, false);
});
test('timeout aborts only compatibility GET and returns a useful local error', async () => {
  const result = await probeServer(connection, async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))), { timeoutMs: 10 });
  assert.equal(result.ok, false); assert.match(result.error, /超时/);
});
