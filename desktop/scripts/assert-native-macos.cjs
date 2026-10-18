'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
function assertNativeMac(arch, host = { platform: process.platform, arch: process.arch, machine: os.machine(), runnerArch: process.env.RUNNER_ARCH }, command = spawnSync) {
  assert(['x64', 'arm64'].includes(arch), 'Expected macOS target architecture x64 or arm64');
  assert.equal(host.platform, 'darwin', 'macOS packaging/verification requires native macOS');
  assert.equal(host.arch, arch, 'Node process.arch must match the macOS target');
  assert.equal(host.machine, arch === 'x64' ? 'x86_64' : 'arm64', 'Native machine architecture must match the macOS target');
  if (host.runnerArch !== undefined) assert.equal(host.runnerArch, arch === 'x64' ? 'X64' : 'ARM64', 'GitHub runner architecture must match the macOS target');
  const translated = command('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' });
  assert(!translated.error && [0, 1].includes(translated.status), 'Could not inspect native macOS translation status');
  const value = translated.stdout.trim();
  assert(value === '' || value === '0' || value === '1', 'Unexpected macOS translation status');
  assert(value !== '1', 'Rosetta translation cannot validate a native macOS release');
  return { platform: host.platform, arch: host.arch, machine: host.machine, translated: false, runnerArch: host.runnerArch || null };
}
if (require.main === module) {
  try {
    assert.equal(process.argv.length, 3, 'Usage: node scripts/assert-native-macos.cjs x64|arm64');
    console.log(JSON.stringify(assertNativeMac(process.argv[2]), null, 2));
  } catch (error) { console.error(error); process.exitCode = 1; }
}
module.exports = { assertNativeMac };
