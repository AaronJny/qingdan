'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const [platform, ...flags] = process.argv.slice(2);
const allowed = ['--dir', '--zip', '--dmg', '--appimage', '--arm64', '--x64'];
if (!['linux', 'win', 'mac'].includes(platform) || flags.some(flag => !allowed.includes(flag)) || flags.includes('--dmg') && platform !== 'mac' || flags.includes('--appimage') && platform !== 'linux' || platform === 'linux' && (flags.includes('--arm64') || flags.includes('--zip')) || flags.includes('--arm64') && flags.includes('--x64') || flags.includes('--dir') && flags.some(flag => ['--zip', '--dmg', '--appimage'].includes(flag))) throw Error('Unsupported target');
const root = path.resolve(__dirname, '..');
const arch = flags.includes('--arm64') ? 'arm64' : flags.includes('--x64') ? 'x64' : (platform === 'mac' ? process.arch : 'x64');
if (platform === 'mac') require('./assert-native-macos.cjs').assertNativeMac(arch);
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', ROARR_LOG: 'false' };
for (const key of Object.keys(env)) if (/^(?:RCODESIGN_|APPLE_|CSC_|WIN_CSC_|GH_TOKEN$|GITHUB_TOKEN$)/.test(key) && key !== 'CSC_IDENTITY_AUTO_DISCOVERY') delete env[key];
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0 || result.error) process.exit(result.status || 1);
}
// Preparation is deliberately separate: packaging may only consume checked inputs.
require('./verify-backend.cjs').verifyBackend(path.join(root, 'backend'), JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version);
run(process.execPath, ['scripts/verify-backend.cjs']);
run(process.execPath, ['scripts/check.cjs']);
run(process.execPath, ['--test', ...fs.readdirSync(path.join(root, 'test')).filter(name => name.endsWith('.test.cjs')).map(name => `test/${name}`)]);
const targetFlags = ['--zip', '--dmg', '--appimage'];
const targets = flags.filter(flag => targetFlags.includes(flag)).map(flag => flag === '--appimage' ? 'AppImage' : flag.slice(2));
const args = ['--config', 'builder.config.cjs', `--${platform}`, ...targets, '--publish', 'never', ...flags.filter(flag => !targetFlags.includes(flag))];
if (!flags.includes('--arm64') && !flags.includes('--x64')) args.push(`--${arch}`);
if (platform === 'mac') args.push('-c.mac.identity=null');
run(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), ...args]);
const output = platform === 'mac' ? path.join(root, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac', '青单.app', 'Contents') : path.join(root, 'dist', platform === 'win' ? 'win-unpacked' : 'linux-unpacked');
const executable = platform === 'mac' ? path.join(output, 'MacOS', '青单') : path.join(output, platform === 'win' ? 'Qingdan.exe' : 'qingdan');
const archive = path.join(output, platform === 'mac' ? 'Resources' : 'resources', 'app.asar');
run(process.execPath, ['scripts/verify-packaged.cjs', executable, archive, path.join(root, 'dist', `verified-${platform}-${arch}.json`), ...(platform === 'mac' ? ['--arch', arch] : [])]);
if (platform === 'linux' && !flags.includes('--dir')) {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  run(process.execPath, ['scripts/verify-linux-appimage.cjs', path.join(root, 'dist', `Qingdan-${version}-linux-x64.AppImage`), output, path.join(root, 'dist', 'verified-linux-appimage-x64.json'), '--smoke']);
}
