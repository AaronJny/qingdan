import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createGatewayInvoker, parseGatewayEndpoint } from './gateway.ts';
import applicationPackage from '../package.json' with { type: 'json' };

const adapterCommand = process.env.QINGDAN_TEST_ELECTRON || process.execPath;
const adapterArgs = process.env.QINGDAN_TEST_ELECTRON_ENTRY ? [process.env.QINGDAN_TEST_ELECTRON_ENTRY, '--mcp'] : process.env.QINGDAN_TEST_BUILT_MCP === '1' ? ['dist/server/mcp.mjs'] : ['--import', 'tsx', 'mcp/main.ts'];
const token = 'fictional-test-capability-not-a-real-secret';

test('gateway URL accepts only exact literal IPv4 loopback /tools endpoint', () => {
  assert.equal(parseGatewayEndpoint('http://127.0.0.1:4311/tools').hostname, '127.0.0.1');
  for (const bad of ['https://127.0.0.1:4311/tools', 'http://localhost:4311/tools', 'http://127.1:4311/tools', 'http://2130706433:4311/tools', 'http://[::1]:4311/tools', 'http://127.0.0.1:0/tools', 'http://127.0.0.1:65536/tools', 'http://user@127.0.0.1:4311/tools', 'http://127.0.0.1:4311/tools?', 'http://127.0.0.1:4311/tools#', 'http://127.0.0.1:4311/a/../tools', ' http://127.0.0.1:4311/tools', 'http://127.0.0.1:4311/tools/']) assert.throws(() => parseGatewayEndpoint(bad), bad);
  assert.throws(() => createGatewayInvoker('http://127.0.0.1:4311/tools', ''));
});

async function mockGateway(handler: import('node:http').RequestListener) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return { server, endpoint: `http://127.0.0.1:${address.port}/tools` };
}

test('adapter refuses redirects and never forwards token to a second target', async () => {
  let targetCalls = 0;
  const target = await mockGateway((_req, res) => { targetCalls++; res.end('{}'); });
  const gateway = await mockGateway((_req, res) => { res.writeHead(307, { Location: target.endpoint }); res.end(); });
  try {
    await assert.rejects(createGatewayInvoker(gateway.endpoint, token)('list_lists', {}, new AbortController().signal));
    assert.equal(targetCalls, 0);
  } finally { gateway.server.close(); target.server.close(); }
});

for (const era of ['legacy', 'modern'] as const) test(`real SDK stdio ${era}: list, validate, call, error, close`, async () => {
  const calls: Array<Record<string, unknown>> = [];
  const gateway = await mockGateway(async (req, res) => {
    assert.equal(req.url, '/tools');
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    assert.equal(req.headers.cookie, undefined);
    let raw = ''; for await (const chunk of req) raw += chunk;
    const call = JSON.parse(raw); calls.push(call);
    res.setHeader('Content-Type', 'application/json');
    if (call.name === 'get_task') { res.statusCode = 403; res.end(JSON.stringify({error: token})); }
    else res.end(JSON.stringify({result: { lists: [{id: 'fictional-list', name: 'Fictional list'}] }}));
  });
  const descriptorDir = realpathSync(mkdtempSync(join(tmpdir(), 'qingdan-sdk-descriptor-')));
  chmodSync(descriptorDir, 0o700);
  const descriptorData = {schemaVersion: 1, endpoint: gateway.endpoint, token, binding: {id: createHash('sha256').update(JSON.stringify([1, 'builtin', 'qingdan-owned-local', 'fictional-user'])).digest('hex'), mode: 'builtin', origin: 'qingdan-owned-local', accountId: 'fictional-user'}};
  const descriptor = join(descriptorDir, descriptorData.binding.id + '.json');
  writeFileSync(descriptor, JSON.stringify(descriptorData), {mode: 0o600});
  const transport = new StdioClientTransport({ command: adapterCommand, args: adapterArgs, cwd: process.cwd(), env: { ...process.env as Record<string, string>, QINGDAN_AGENT_ENDPOINT: gateway.endpoint, QINGDAN_AGENT_TOKEN: token, ...(process.platform !== 'win32' ? {QINGDAN_AGENT_DESCRIPTOR: descriptor} : {}) }, stderr: 'pipe' });
  let errors = ''; transport.stderr?.on('data', chunk => { errors += chunk; });
  const client = new Client({ name: 'qingdan-test', version: '1.0.0' }, { versionNegotiation: { mode: era === 'legacy' ? 'legacy' : {pin: '2026-07-28'} } });
  try {
    await client.connect(transport);
    assert.equal(client.getProtocolEra(), era);
    assert.equal(client.getServerVersion()?.version, applicationPackage.version);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(t => t.name).sort(), ['complete_task', 'create_task', 'get_task', 'list_lists', 'search_tasks', 'update_task']);
    const result = await client.callTool({name: 'list_lists', arguments: {}});
    assert.equal(result.isError, undefined);
    assert.equal(calls.length, 1);
    assert.deepEqual(result.structuredContent, {result: {lists: [{id: 'fictional-list', name: 'Fictional list'}]}});
    // A running adapter must keep its original capability even if the descriptor rotates.
    writeFileSync(descriptor, JSON.stringify({...descriptorData, token: 'fictional-new-revoked-token'}));
    const invalid = await client.callTool({name: 'list_lists', arguments: {limit: 1000}});
    assert.equal(invalid.isError, true);
    assert.equal(calls.length, 1, 'validation occurs before gateway invocation');
    const failed = await client.callTool({name: 'get_task', arguments: {id: 'fictional-task'}});
    assert.equal(failed.isError, true);
    assert.deepEqual(failed.structuredContent, {error: {code: 'DENIED'}});
    assert(!JSON.stringify(failed).includes(token));
    const write = {id: 'fictional-new-task', clientOperationId: 'fictional-operation', listId: 'fictional-list', title: 'Fictional task'};
    await client.callTool({name: 'create_task', arguments: write});
    assert.deepEqual(calls.at(-1), {name: 'create_task', arguments: write});
    const count = calls.length;
    const invalidWrite = await client.callTool({name: 'update_task', arguments: {id: 'fictional-new-task', expectedRevision: 1, clientOperationId: 'fictional-operation-2', changes: {status: 'done'}}});
    assert.equal(invalidWrite.isError, true);
    assert.equal(calls.length, count);
    assert(!errors.includes(token));
  } catch (error) {
    if (process.env.QINGDAN_TEST_ELECTRON) console.error(errors.replaceAll(token, '[redacted]'));
    throw error;
  } finally { await client.close(); gateway.server.close(); rmSync(descriptorDir, {recursive: true, force: true}); }
});

test('bad startup emits no stdout or secrets and exits nonzero', async () => {
  const child = spawn(adapterCommand, adapterArgs, { env: { ...process.env, QINGDAN_AGENT_ENDPOINT: 'https://example.invalid/tools', QINGDAN_AGENT_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 1); assert.equal(stdout, ''); assert(!stderr.includes(token));
});

test('official clients work with the immutable Windows Electron stdin EOF shim', async () => {
  let calls = 0;
  const gateway = await mockGateway(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    let body = ''; for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { name: 'list_lists', arguments: {} });
    calls++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ result: { lists: [{ id: 'fictional-windows-list' }] } }));
  });
  const entry = pathToFileURL(join(process.cwd(), process.env.QINGDAN_TEST_BUILT_MCP === '1' ? 'dist/server/mcp.mjs' : 'mcp/main.ts')).href;
  const shim = `
    import { Readable } from 'node:stream';
    const fakeStdin = Readable.from([]);
    Object.defineProperty(process, 'platform', { value: 'win32' });
    Object.defineProperty(process.versions, 'electron', { value: 'synthetic-test' });
    Object.defineProperty(process, 'stdin', { configurable: false, get: () => fakeStdin });
    const { mcpInput } = await import(${JSON.stringify(entry)});
    if (!mcpInput || mcpInput === fakeStdin) throw new Error('Used the Windows EOF shim');
    mcpInput.once('end', () => process.exit(process.exitCode || 0));
  `;
  try {
    for (const era of ['legacy', 'modern'] as const) {
      const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', '--input-type=module', '-e', shim],
        cwd: process.cwd(), env: { ...process.env as Record<string, string>, QINGDAN_AGENT_DESCRIPTOR: '', QINGDAN_AGENT_ENDPOINT: gateway.endpoint, QINGDAN_AGENT_TOKEN: token }, stderr: 'pipe' });
      let stderr = ''; transport.stderr?.on('data', chunk => { stderr += chunk; });
      const client = new Client({ name: 'qingdan-windows-stdin-test', version: '1.0.0' }, { versionNegotiation: { mode: era === 'legacy' ? 'legacy' : { pin: '2026-07-28' } } });
      try {
        await client.connect(transport, { timeout: 10000 });
        assert.equal(client.getProtocolEra(), era);
        assert.equal((await client.listTools()).tools.length, 6);
        assert.deepEqual((await client.callTool({ name: 'list_lists', arguments: {} })).structuredContent, { result: { lists: [{ id: 'fictional-windows-list' }] } });
        assert(!stderr.includes(token));
      } finally { await client.close(); }
    }
    assert.equal(calls, 2);
  } finally { gateway.server.closeAllConnections(); gateway.server.close(); }
});

 test('gateway surfaces only stable error codes, rejects malformed or oversized success', async () => {
  for (const [status, payload, expected] of [[409, JSON.stringify({code: 'CONFLICT', error: token}), 'CONFLICT'], [403, JSON.stringify({code: token, error: token}), 'UNAVAILABLE'], [200, '{}', 'UNAVAILABLE'], [200, 'not JSON', undefined], [200, 'x'.repeat(2 * 1024 * 1024 + 1), undefined]] as const) {
    const gateway = await mockGateway((_req, res) => { res.statusCode = status; res.end(payload); });
    try {
      await assert.rejects(createGatewayInvoker(gateway.endpoint, token)('list_lists', {}, new AbortController().signal), (error: Error & {code?: string}) => { assert(!error.message.includes(token)); if (expected) assert.equal(error.code, expected); return true; });
    } finally { gateway.server.close(); }
  }
});

test('gateway request observes cancellation without retry', async () => {
  let calls = 0;
  const gateway = await mockGateway((_req, _res) => { calls++; });
  const controller = new AbortController();
  try {
    const pending = createGatewayInvoker(gateway.endpoint, token)('create_task', {id: 'fictional'}, controller.signal);
    setTimeout(() => controller.abort(), 30);
    await assert.rejects(pending);
    assert(calls <= 1);
  } finally { gateway.server.closeAllConnections(); gateway.server.close(); }
});
