'use strict';
// Optional Linux engineering-signing helper. Use only a trusted crates.io-built
// apple-codesign 0.29.0. An ad-hoc seal does not establish Apple/macOS acceptance.
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const { spawnSync } = require('node:child_process');
function signingEnvironment(home) { return { PATH: '/usr/bin:/bin', HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC' }; }
function argumentsFor(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) { const name = argv[i]; if (!['--rcodesign', '--input', '--output'].includes(name) || options[name] || !argv[i + 1] || !path.isAbsolute(argv[i + 1])) throw new Error('Use exactly --rcodesign, --input, --output with absolute paths'); options[name] = argv[i + 1]; }
  if (Object.keys(options).length !== 3) throw new Error('All three explicit paths are required');
  const input = path.resolve(options['--input']); const output = path.resolve(options['--output']);
  if (!input.endsWith('.app') || !output.endsWith('.app') || input === output || !path.relative(input, output).startsWith('..' + path.sep)) throw new Error('Output must be a different app outside the input bundle');
  return { binary: options['--rcodesign'], input, output };
}
function projectedRealPath(file) {
  let cursor = file; const suffix = [];
  while (true) {
    try { fs.lstatSync(cursor); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    suffix.unshift(path.basename(cursor)); const parent = path.dirname(cursor); if (parent === cursor) throw new Error('Cannot resolve output parent'); cursor = parent;
  }
  return path.join(fs.realpathSync(cursor), ...suffix);
}
function signEngineering(options, run = spawnSync) {
  if (process.platform !== 'linux') throw new Error('This optional helper is for Linux engineering candidates only; native Mac packaging uses codesign');
  try { fs.lstatSync(options.output); throw new Error('Refusing to replace any existing candidate'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const realInput = fs.realpathSync(options.input); const realOutput = projectedRealPath(options.output);
  if (realInput === realOutput || !path.relative(realInput, realOutput).startsWith('..' + path.sep)) throw new Error('Output parent resolves inside the original bundle');
  const source = fs.lstatSync(options.input); if (!source.isDirectory() || source.isSymbolicLink()) throw new Error('Expected a finalized real .app directory');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-adhoc-home-')); fs.mkdirSync(path.join(home, 'config'), { mode: 0o700 });
  const config = path.join(home, 'adhoc.toml'); fs.writeFileSync(config, '[default.sign]\nsigner = {}\n', { mode: 0o600 }); const env = signingEnvironment(home);
  try {
    const version = run(options.binary, ['-C', config, '--version'], { env, encoding: 'utf8', timeout: 15000 });
    if (version.status !== 0 || !/^apple-codesign 0\.29\.0\s*$/.test(version.stdout || '')) throw new Error('Requires trusted apple-codesign 0.29.0; no candidate copied');
    fs.cpSync(options.input, options.output, { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true, force: false, errorOnExist: true });
    const result = run(options.binary, ['-C', config, 'sign', '--timestamp-url', 'none', options.output], { env, stdio: 'inherit' });
    if (result.status !== 0 || result.error) throw new Error('Engineering signature failed; preserve candidate/log for inspection, do not treat it as usable');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}
module.exports = { signingEnvironment, argumentsFor, signEngineering };
if (require.main === module) { try { signEngineering(argumentsFor(process.argv.slice(2))); console.log('Ad-hoc engineering candidate created. Native macOS codesign/launch/Gatekeeper acceptance remains unverified.'); } catch (error) { console.error(error.message); process.exitCode = 1; } }
