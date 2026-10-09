'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { projectLock, analyzeImports } = require('./runtime-dependencies.cjs');
const { verifyBackend } = require('./verify-backend.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function hashFiles(root, excludeNestedNodeModules = false) {
  const result = {};
  for (const name of fs.readdirSync(root).sort()) {
    if (excludeNestedNodeModules && name === 'node_modules') continue;
    const file = path.join(root, name), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw Error(`Symlink not allowed in runtime input: ${file}`);
    if (stat.isDirectory()) for (const [child, hash] of Object.entries(hashFiles(file, excludeNestedNodeModules))) result[`${name}/${child}`] = hash;
    else if (stat.isFile()) result[name] = sha(fs.readFileSync(file));
    else throw Error(`Unexpected runtime file: ${file}`);
  }
  return result;
}
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && command.endsWith('.cmd') });
  if (result.error || result.status !== 0) throw result.error || Error(`${command} failed (${result.status})`);
}
function validateDestination(application, destination) {
  application = fs.realpathSync(path.resolve(application)); destination = path.resolve(destination);
  function within(parent, child) {
    const relative = path.relative(parent, child);
    return !relative || !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
  }
  if (within(application, destination) || within(destination, application)) throw Error('Application and backend destination must not overlap.');
  if (fs.existsSync(destination)) {
    const stat = fs.lstatSync(destination);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Existing backend destination must be a real generated directory.');
    const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'RUNTIME-MANIFEST.json')));
    if (manifest.product !== 'qingdan-standalone') throw Error('Existing destination is not a generated Qingdan backend.');
    function inspect(directory) {
      for (const name of fs.readdirSync(directory)) {
        const file = path.join(directory, name), item = fs.lstatSync(file);
        if (['data', '.git'].includes(name) || item.isSymbolicLink()) throw Error('Existing destination contains user data, repository state or symlinks; it cannot be replaced.');
        if (item.isDirectory()) inspect(file);
      }
    }
    inspect(destination);
  }
}
async function prepareBackend(application, destination) {
  application = path.resolve(application); destination = path.resolve(destination);
  validateDestination(application, destination);
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true });
  const stageParent = fs.mkdtempSync(path.join(parent, '.backend-stage-'));
  const stage = path.join(stageParent, 'backend');
  try {
    run(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), [path.join(__dirname, '../../server-packaging/prepare-runtime.py'), application, stage], application);
    const sourcePackage = JSON.parse(fs.readFileSync(path.join(application, 'package.json')));
    const sourceLock = JSON.parse(fs.readFileSync(path.join(application, 'package-lock.json')));
    const externalImports = await analyzeImports(application);
    const { runtimePackage, runtimeLock } = projectLock(sourcePackage, sourceLock, externalImports);
    const manifestPath = path.join(stage, 'RUNTIME-MANIFEST.json');
    const originalManifest = JSON.parse(fs.readFileSync(manifestPath));
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(runtimePackage, null, 2) + '\n');
    fs.writeFileSync(path.join(stage, 'package-lock.json'), JSON.stringify(runtimeLock, null, 2) + '\n');
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], stage);
    const packages = [];
    for (const [location, record] of Object.entries(runtimeLock.packages)) {
      if (!location) continue;
      const packageDirectory = path.join(stage, location);
      const packageJson = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json')));
      const name = packageJson.name;
      if (packageJson.version !== record.version) throw Error(`Installed version mismatch: ${name}`);
      packages.push({ name, location, version: record.version, resolved: record.resolved, integrity: record.integrity, license: record.license, files_sha256: hashFiles(packageDirectory, true) });
    }
    fs.writeFileSync(path.join(stage, 'dependency-manifest.json'), JSON.stringify({ source_snapshot_sha256: originalManifest.source_snapshot_sha256, application_lock_sha256: sha(fs.readFileSync(path.join(application, 'package-lock.json'))), external_imports: externalImports, packages }, null, 2) + '\n');
    fs.writeFileSync(path.join(stage, 'RUNTIME-START-HERE.txt'), `青单 ${runtimePackage.version} 桌面内置后端\n由当前完整检查通过的 application 源码生成；快照：${originalManifest.source_snapshot_sha256}\n桌面程序自动管理启动/停止。此目录不包含用户数据。不要单独安装依赖或覆盖用户数据目录。\n`);
    fs.rmSync(manifestPath);
    const files = hashFiles(stage);
    for (const name of Object.keys(files)) if (name.startsWith('node_modules/')) delete files[name];
    fs.writeFileSync(manifestPath, JSON.stringify({ ...originalManifest, dependency_policy: 'checked compiled external imports + application lock closure; pure JavaScript, no install scripts', external_imports: externalImports, files_sha256: files }, null, 2) + '\n');
    verifyBackend(stage, runtimePackage.version);
    validateDestination(application, destination);  // Recheck before replacing an existing generated directory.
    let backup = null;
    if (fs.existsSync(destination)) {
      backup = path.join(stageParent, 'previous-backend');
      fs.renameSync(destination, backup);
    }
    try { fs.renameSync(stage, destination); }
    catch (error) { if (backup) fs.renameSync(backup, destination); throw error; }
    console.log(`Prepared Qingdan ${runtimePackage.version} embedded backend with ${packages.length} locked runtime packages.`);
    return destination;
  } finally { fs.rmSync(stageParent, { recursive: true, force: true }); }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length > 2) throw Error('Usage: node scripts/prepare-backend.cjs [application-directory] [fresh-or-generated-backend-directory]');
  void prepareBackend(args[0] || path.join(__dirname, '../../application'), args[1] || path.join(__dirname, '../backend')).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { prepareBackend, hashFiles, validateDestination };
