'use strict';
const http = require('node:http');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { isServiceUrl } = require('./policy.cjs');
const { AgentDescriptorStore } = require('./agent-descriptor.cjs');
const validAccount = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const validListId = value => typeof value === 'string' && /^[-a-zA-Z0-9_:]{1,160}$/.test(value);
const READ_TOOLS = new Set(['list_lists', 'search_tasks', 'get_task']);
const WRITE_TOOLS = new Set(['create_task', 'update_task', 'complete_task']);
const MAX_BODY = 32768, MAX_RESPONSE = 1048576;
const digest = token => createHash('sha256').update(token).digest();
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
async function jsonResponse(response, connection, pathname) {
  if (response.redirected || response.url && (!isServiceUrl(response.url, connection) || new URL(response.url).pathname !== pathname) || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw fail('Invalid service response', 502);
  const reader = response.body?.getReader(); if (!reader) throw fail('Missing service response', 502);
  const chunks = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_RESPONSE) { await reader.cancel(); throw fail('Service response too large', 502); } chunks.push(Buffer.from(value)); } }
  finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('Invalid service JSON', 502); }
}
class AgentGateway {
  // selected supplies ONLY the desktop-owned currently selected session. No URL,
  // cookie, scope or account supplied by an adapter can alter this selection.
  constructor({ selected, profile, descriptorStore, mcpCommand = null }) { this.mcpCommand = mcpCommand; this.descriptors = descriptorStore || (profile ? new AgentDescriptorStore({ profile }) : null); this.selected = selected; this.generation = 0; this.controllers = new Set(); this.grant = null; this.server = null; this.listening = null; this.closed = false; }
  revoke() { this.generation++; this.grant = null; this.descriptors?.remove(); for (const controller of this.controllers) controller.abort(); this.controllers.clear(); }
  cleanupStaleDescriptors() { this.descriptors?.cleanupStale(); }
  async close() { this.closed = true; this.revoke(); if (this.listening) await this.listening.catch(() => {}); const server = this.server; this.server = null; if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
  current() { const value = this.selected(); if (this.closed || !value?.available || !value.connection || typeof value.fetch !== 'function') throw fail('Desktop connection unavailable', 503); return value; }
  matches(connection) { try { const now = this.current().connection; return now === connection && now.origin === connection.origin && now.partition === connection.partition; } catch { return false; } }
  async request(connection, pathname, accountId, body, csrf, generation) {
    if (!this.matches(connection) || generation !== this.generation) throw fail('Agent access revoked', 401);
    const controller = new AbortController(); this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 12000); timer.unref?.();
    try {
      const response = await this.current().fetch(new URL(pathname, connection.serverUrl).href, {
        method: body ? 'POST' : 'GET', credentials: 'include', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', Origin: connection.origin, 'x-qingdan': '1', 'x-qingdan-csrf': csrf, 'x-qingdan-expected-account': accountId } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await jsonResponse(response, connection, pathname);
      if (!this.matches(connection) || generation !== this.generation) throw fail('Agent access revoked', 401);
      return { status: response.status, ok: response.ok, data };
    } finally { clearTimeout(timer); this.controllers.delete(controller); }
  }
  async authenticate(accountId, connection, generation) {
    if (!validAccount(accountId)) throw fail('Invalid account');
    let result;
    try { result = await this.request(connection, '/api/auth/me', accountId, null, null, generation); }
    catch (error) { if (generation === this.generation) this.revoke(); throw error; }
    if (!result.ok || result.data.user?.userId !== accountId || !/^[a-f0-9]{64}$/.test(result.data.csrfToken || '')) {
      if (generation === this.generation) this.revoke(); throw fail('Current account changed; grant access again', 401);
    }
    return result.data;
  }
  snapshot(accountId, connection) {
    const grant = this.grant;
    const enabled = !!grant && grant.accountId === accountId && grant.connection === connection;
    return { enabled, writeEnabled: enabled && grant.writeEnabled, listIds: enabled ? [...grant.listIds] : [], tokenConfigured: enabled,
      serverUrl: connection.serverUrl, accountId, endpoint: enabled ? this.endpoint : null, descriptorPath: this.descriptors?.pathFor(connection, accountId) || null, sessionOnly: true, mcpCommand: this.mcpCommand, mcpArgs: ['--mcp'] };
  }
  async get(accountId) {
    const { connection } = this.current(); await this.authenticate(accountId, connection, this.generation);
    return this.snapshot(accountId, connection);
  }
  async save(accountId, input) {
    if (!plain(input) || Object.keys(input).some(key => !['enabled', 'writeEnabled', 'listIds', 'rotateToken'].includes(key)) || typeof input.enabled !== 'boolean' || typeof input.writeEnabled !== 'boolean' || !Array.isArray(input.listIds) || input.listIds.length > 100 || input.listIds.some(id => !validListId(id)) || new Set(input.listIds).size !== input.listIds.length || input.rotateToken !== undefined && typeof input.rotateToken !== 'boolean') throw fail('Invalid Agent access settings');
    const { connection } = this.current(), generation = this.generation;
    const auth = await this.authenticate(accountId, connection, generation);
    if (!input.enabled) { this.revoke(); return this.snapshot(accountId, connection); }
    if (!input.listIds.length) throw fail('Select at least one list');
    const old = this.grant;
    const changed = !old || old.connection !== connection || old.accountId !== accountId || old.writeEnabled !== input.writeEnabled || JSON.stringify([...old.listIds].sort()) !== JSON.stringify([...input.listIds].sort());
    if (changed && input.rotateToken !== true) throw fail('Explicit token generation is required for a new or changed grant');
    // Resolve the selection from fresh server data, never trust renderer caches.
    const seen = new Set(); let cursor;
    for (let page = 0; page < 3; page++) {
      const result = await this.request(connection, '/api/agent/tools', accountId, { name: 'list_lists', arguments: { limit: 50, ...(cursor ? { cursor } : {}) }, scope: { listIds: input.listIds, writeEnabled: input.writeEnabled } }, auth.csrfToken, generation);
      const value = result.data.result;
      if (!result.ok || !Array.isArray(value?.items) || value.items.some(item => !validListId(item.id) || !input.listIds.includes(item.id) || input.writeEnabled && item.writable !== true)) throw fail('Selected lists are unavailable or not writable', 403);
      for (const item of value.items) seen.add(item.id);
      if (!value.nextCursor) break;
      if (!validListId(value.nextCursor) || value.nextCursor === cursor) throw fail('Invalid list response', 502);
      cursor = value.nextCursor;
    }
    if (seen.size !== input.listIds.length) throw fail('Selected lists are unavailable', 403);
    await this.listen();
    if (!this.matches(connection) || generation !== this.generation) throw fail('Agent access revoked', 401);
    let token;
    if (changed || input.rotateToken) {
      this.revoke(); token = randomBytes(32).toString('base64url');
      let descriptorPath = null;
      if (this.descriptors?.supported) descriptorPath = this.descriptors.write(connection, accountId, this.endpoint, token);
      this.grant = { connection, accountId, descriptorPath, listIds: [...input.listIds], writeEnabled: input.writeEnabled, tokenDigest: digest(token) };
    }
    return { ...this.snapshot(accountId, connection), ...(token && !this.grant.descriptorPath ? { token } : {}) };
  }
  async listen() {
    if (this.server?.listening) return;
    if (!this.listening) this.listening = new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => { void this.handle(request, response); }); this.server = server;
      server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 32;
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => { this.endpoint = `http://127.0.0.1:${server.address().port}/tools`; resolve(); });
    }).finally(() => { this.listening = null; });
    return this.listening;
  }
  async handle(request, response) {
    const send = (status, value) => { if (!response.destroyed) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Connection: 'close' }); response.end(JSON.stringify(value)); } };
    try {
      if (request.socket.remoteAddress !== '127.0.0.1' || request.headers.host !== new URL(this.endpoint).host || request.headers.origin !== undefined || request.headers['sec-fetch-site'] !== undefined) throw fail('Browser and non-loopback requests are not accepted', 403);
      if (request.method !== 'POST' || request.url !== '/tools') throw fail('Not found', 404);
      const grant = this.grant, generation = this.generation;
      const authorization = request.headers.authorization;
      if (!grant || typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization) || !timingSafeEqual(digest(authorization.slice(7)), grant.tokenDigest)) throw fail('Agent access denied', 401);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw fail('JSON required', 415);
      if (Number(request.headers['content-length'] || 0) > MAX_BODY) throw fail('Request too large', 413);
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw fail('Request too large', 413); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('Invalid JSON'); }
      if (!plain(body) || Object.keys(body).some(key => !['name', 'arguments'].includes(key)) || typeof body.name !== 'string' || body.name.length > 80 || !plain(body.arguments)) throw fail('Invalid tool request');
      if (!READ_TOOLS.has(body.name) && !WRITE_TOOLS.has(body.name)) throw fail('Unknown tool');
      if (WRITE_TOOLS.has(body.name) && !grant.writeEnabled) throw fail('Agent access is read only', 403);
      const auth = await this.authenticate(grant.accountId, grant.connection, generation);
      const result = await this.request(grant.connection, '/api/agent/tools', grant.accountId, { name: body.name, arguments: body.arguments, scope: { listIds: [...grant.listIds], writeEnabled: grant.writeEnabled } }, auth.csrfToken, generation);
      if (result.status === 401) this.revoke();
      send(result.status, result.data);
    } catch (error) { send(error.status || 502, { error: error.status ? error.message : 'Desktop gateway request failed' }); }
  }
}
module.exports = { AgentGateway };
