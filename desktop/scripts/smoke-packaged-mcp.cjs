'use strict';
// Launch the actual sealed product, never stock Electron or a separate Node
// adapter. All gateway data and credentials are synthetic and loopback-only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '..');
const TOOLS = ['complete_task', 'create_task', 'get_task', 'list_lists', 'search_tasks', 'update_task'];
const MAX_OUTPUT = 256 * 1024;

function parseArgs(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    assert(['--arch', '--executable', '--report'].includes(key) && value && !Object.hasOwn(values, key), 'Expected unique --arch, --executable or --report values');
    values[key] = value;
  }
  const arch = values['--arch'] || process.arch;
  assert(['arm64', 'x64'].includes(arch), 'Expected arm64 or x64');
  const executable = process.platform === 'darwin'
    ? path.join(ROOT, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac', '青单.app', 'Contents', 'MacOS', '青单')
    : path.join(ROOT, 'dist', process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked', process.platform === 'win32' ? 'Qingdan.exe' : 'qingdan');
  return { arch, executable: path.resolve(values['--executable'] || executable), report: values['--report'] ? path.resolve(values['--report']) : undefined };
}

function fixtureEnvironment(fixture, endpoint, token, inherited, platform = process.platform) {
  const env = { ...inherited };
  for (const key of Object.keys(env)) if (/^(?:QINGDAN_|ELECTRON_|NODE_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$)/i.test(key)) delete env[key];
  Object.assign(env, {
    HOME: fixture, USERPROFILE: fixture,
    APPDATA: path.join(fixture, 'roaming'), LOCALAPPDATA: path.join(fixture, 'local'),
    XDG_CONFIG_HOME: path.join(fixture, 'config'), XDG_CACHE_HOME: path.join(fixture, 'cache'), XDG_DATA_HOME: path.join(fixture, 'data'),
    TMPDIR: path.join(fixture, 'tmp'), TMP: path.join(fixture, 'tmp'), TEMP: path.join(fixture, 'tmp'),
    QINGDAN_AGENT_ENDPOINT: endpoint, QINGDAN_AGENT_TOKEN: token,
  });
  // Electron routes Windows GUI binaries to a console before application code.
  // Preserve the MCP client's pipes, without enabling Node mode or changing fuses.
  if (platform === 'win32') env.ELECTRON_NO_ATTACH_CONSOLE = '1';
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TMPDIR']) fs.mkdirSync(env[key], { recursive: true });
  return env;
}

async function bounded(promise, label, milliseconds = 20000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

async function exitOnEof(child) {
  assert(child?.stdin && child.exitCode === null && child.signalCode === null, 'Packaged MCP process must still be running before EOF');
  const closed = once(child, 'close');
  child.stdin.end();
  const [code, signal] = await bounded(closed, 'Packaged MCP EOF exit', 5000);
  assert.equal(signal, null, 'EOF must exit without a termination signal');
  assert.equal(code, 0, 'EOF must exit successfully');
}

async function runSmoke(options) {
  assert.equal(process.arch, options.arch, 'Use the native target architecture');
  assert(['darwin', 'linux', 'win32'].includes(process.platform), 'Unsupported native platform');
  if (process.platform === 'darwin') require('./assert-native-macos.cjs').assertNativeMac(options.arch);
  assert(fs.statSync(options.executable).isFile(), 'Packaged executable is missing');
  const appRequire = createRequire(path.join(ROOT, '../application/package.json'));
  const clientFile = appRequire.resolve('@modelcontextprotocol/client');
  assert.equal(JSON.parse(fs.readFileSync(path.resolve(clientFile, '../../package.json'))).version, '2.4.0', 'Use locked official MCP client 2.4.0');
  const { Client } = appRequire('@modelcontextprotocol/client');
  const { StdioClientTransport, getDefaultEnvironment } = appRequire('@modelcontextprotocol/client/stdio');
  const token = `synthetic-packaged-smoke-${crypto.randomBytes(24).toString('hex')}`;
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-packaged-mcp-'));
  const expected = { result: { items: [{ id: 'fictional-list', title: 'Fictional list' }], nextCursor: null } };
  const report = { schema: 'qingdan-packaged-mcp-smoke-v1', platform: process.platform, arch: options.arch,
    productExecutableLaunched: true, clientVersion: '2.4.0', syntheticLoopbackGateway: true,
    isolatedUserDirectories: true, nativeGuiTested: false, realGrantCreated: false, eras: [] };
  let calls = 0, gatewayError, activeChild;
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/tools');
      assert(req.headers.authorization === `Bearer ${token}`, 'Wrong synthetic authorization');
      assert.equal(req.headers.cookie, undefined, 'No browser cookies may be sent');
      let body = '';
      for await (const chunk of req) { body += chunk; assert(body.length < 65536, 'Unexpected gateway body size'); }
      assert.deepEqual(JSON.parse(body), { name: 'list_lists', arguments: {} });
      calls++;
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(expected));
    } catch (error) { gatewayError = error; res.writeHead(500); res.end('{}'); }
  });
  // Hard deadline also covers a client or shutdown regression. Only our child
  // can be killed; a timeout can never be mistaken for a passing EOF test.
  const watchdog = setTimeout(() => {
    activeChild?.kill('SIGKILL'); server.closeAllConnections(); server.close();
    fs.rmSync(fixture, { recursive: true, force: true });
    console.error('Packaged MCP smoke exceeded 75 seconds'); process.exit(1);
  }, 75000);
  try {
    server.listen(0, '127.0.0.1'); await bounded(once(server, 'listening'), 'Synthetic gateway startup');
    const endpoint = `http://127.0.0.1:${server.address().port}/tools`;
    const inherited = getDefaultEnvironment();
    for (const key of ['DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY']) if (process.env[key]) inherited[key] = process.env[key];
    for (const era of ['legacy', 'modern']) {
      const transport = new StdioClientTransport({ command: options.executable,
        args: [`--user-data-dir=${path.join(fixture, 'electron-user-data')}`, '--mcp'], cwd: fixture, maxBufferSize: MAX_OUTPUT,
        env: fixtureEnvironment(fixture, endpoint, token, inherited), stderr: 'pipe' });
      let stderr = '', outputExceeded = false;
      transport.stderr.on('data', chunk => {
        if (stderr.length + chunk.length > MAX_OUTPUT) { outputExceeded = true; activeChild?.kill('SIGKILL'); }
        else stderr += chunk;
      });
      const client = new Client({ name: 'qingdan-packaged-smoke', version: '1.0.0' }, {
        versionNegotiation: { mode: era === 'legacy' ? 'legacy' : { pin: '2026-07-28' } },
      });
      try {
        const connecting = client.connect(transport, { timeout: 15000 });
        // Pinned SDK 2.4.0 stores its spawned ChildProcess here. Capture it so
        // EOF is tested directly: transport.close() can mask hangs by killing.
        activeChild = transport._process;
        await bounded(connecting, `${era} negotiation`);
        // Modern negotiation first uses an SDK-managed disposable probe;
        // the actual session child exists only after connect resolves.
        activeChild = transport._process;
        assert(activeChild?.stdin && activeChild.pid, 'Official client did not spawn the packaged executable');
        assert.equal(client.getProtocolEra(), era);
        const listed = await bounded(client.listTools(), `${era} tool listing`);
        assert.deepEqual(listed.tools.map(tool => tool.name).sort(), TOOLS);
        const result = await bounded(client.callTool({ name: 'list_lists', arguments: {} }), `${era} tool call`);
        assert.equal(result.isError, undefined); assert.deepEqual(result.structuredContent, expected);
        if (gatewayError) throw gatewayError;
        await exitOnEof(activeChild);
        assert(!outputExceeded, 'Packaged stderr exceeded its limit');
        assert(!stderr.includes(token), 'Packaged stderr exposed the synthetic secret');
        report.eras.push({ era, negotiated: true, sixToolsListed: true, toolCallPassed: true, eofExitCode: 0, secretAbsentFromStderr: true });
      } catch (error) {
        const diagnostic = stderr.replaceAll(token, '[redacted]').slice(-4000);
        const child = activeChild || transport._process;
        const status = child ? ` (exit=${child.exitCode ?? 'pending'}, signal=${child.signalCode ?? 'none'}, pid=${child.pid ?? 'unavailable'})` : ' (session process unavailable)';
        throw new Error(`${era} packaged MCP failed${status}: ${String(error.message).replaceAll(token, '[redacted]')}${diagnostic ? `\n${diagnostic}` : ''}`);
      } finally {
        if (activeChild && activeChild.exitCode === null && activeChild.signalCode === null) activeChild.kill('SIGKILL');
        await bounded(client.close(), 'Official client cleanup', 5000);
        activeChild = undefined;
      }
    }
    assert.equal(calls, 2, 'Expected exactly one synthetic gateway call per protocol era');
    report.passed = true;
    if (options.report) fs.writeFileSync(options.report, JSON.stringify(report, null, 2) + '\n');
    return report;
  } finally {
    clearTimeout(watchdog); server.closeAllConnections(); server.close();
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

module.exports = { parseArgs, fixtureEnvironment, bounded, exitOnEof, runSmoke };
if (require.main === module) {
  Promise.resolve().then(() => runSmoke(parseArgs(process.argv.slice(2))))
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
