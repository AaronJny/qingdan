'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseArgs, fixtureEnvironment, bounded, exitOnEof } = require('../scripts/smoke-packaged-mcp.cjs');

test('packaged MCP smoke selects native product and rejects malformed options', () => {
  const options = parseArgs(['--arch', process.arch]);
  assert(path.isAbsolute(options.executable));
  assert(!options.executable.includes('node_modules'));
  assert(options.executable.includes(path.join('desktop', 'dist')));
  for (const args of [['--arch', 'ia32'], ['--report'], ['--unknown', 'x'], ['--arch', 'x64', '--arch', 'x64']]) assert.throws(() => parseArgs(args));
});

test('packaged smoke uses synthetic profile directories and excludes inherited configuration', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-mcp-env-test-'));
  try {
    const env = fixtureEnvironment(fixture, 'http://127.0.0.1:1234/tools', 'synthetic-only', {
      PATH: 'test-path', HOME: '/real-home', APPDATA: '/real-appdata',
      QINGDAN_AGENT_DESCRIPTOR: '/real-descriptor', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', HTTPS_PROXY: 'http://proxy.invalid',
    });
    assert.equal(env.PATH, 'test-path'); assert.equal(env.HOME, fixture); assert.equal(env.USERPROFILE, fixture);
    assert.equal(env.QINGDAN_AGENT_TOKEN, 'synthetic-only');
    for (const key of ['QINGDAN_AGENT_DESCRIPTOR', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'HTTPS_PROXY']) assert.equal(env[key], undefined);
    for (const key of ['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'TMPDIR']) {
      assert(env[key].startsWith(fixture + path.sep)); assert(fs.statSync(env[key]).isDirectory());
    }
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('bounded phase rejects a stalled operation', async () => {
  await assert.rejects(bounded(new Promise(() => {}), 'synthetic stall', 10), /synthetic stall timed out/);
});

test('EOF gate waits for a successful exit without sending termination signals', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], { stdio: ['pipe', 'pipe', 'pipe'] });
  try { await exitOnEof(child); assert.equal(child.killed, false); }
  finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});

test('EOF gate rejects a failing exit rather than letting transport.close hide it', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume(); process.stdin.on("end", () => { process.exitCode = 3; })'], { stdio: ['pipe', 'pipe', 'pipe'] });
  try { await assert.rejects(exitOnEof(child), /EOF must exit successfully/); }
  finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});

test('every native desktop release gates artifact upload on packaged MCP smoke', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/release.yml'), 'utf8');
  for (const [job, next, verification] of [
    ['package-macos', 'package-windows', 'node scripts/verify-desktop-archives.cjs mac'],
    ['package-windows', 'package-linux', 'node scripts/verify-desktop-archives.cjs win'],
    ['package-linux', 'package-android', 'node scripts/package.cjs linux'],
  ]) {
    const section = workflow.slice(workflow.indexOf(`  ${job}:`), workflow.indexOf(`  ${next}:`));
    const gate = section.indexOf('node scripts/smoke-packaged-mcp.cjs');
    assert(gate > section.indexOf(verification) && section.indexOf(verification) >= 0, `${job} must verify packaging first`);
    assert(gate < section.indexOf('actions/upload-artifact@'), `${job} must pass before upload`);
    if (job === 'package-linux') assert(section.includes('xvfb-run --auto-servernum node scripts/smoke-packaged-mcp.cjs'));
  }
});
