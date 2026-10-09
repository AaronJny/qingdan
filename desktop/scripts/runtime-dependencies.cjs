'use strict';
// Derive the pure-JavaScript server dependency closure from the checked build.
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
function packageName(specifier) {
  if (builtins.has(specifier) || specifier.startsWith('node:')) return null;
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes('\\') || specifier.includes(':')) throw Error(`Unsupported external import: ${specifier}`);
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
}
function projectLock(sourcePackage, sourceLock, specifiers) {
  if (sourceLock.lockfileVersion !== 3 || !sourceLock.packages?.['']) throw Error('A version 3 application lock is required.');
  if (sourcePackage.version !== sourceLock.version || sourcePackage.version !== sourceLock.packages[''].version) throw Error('Application package/lock versions differ.');
  const packages = {}, direct = {}, selected = new Set();
  function resolveDependency(requester, name) {
    let base = requester;
    while (true) {
      const key = `${base ? `${base}/` : ''}node_modules/${name}`;
      if (sourceLock.packages[key]) return key;
      const split = base.lastIndexOf('/node_modules/');
      if (split >= 0) base = base.slice(0, split);
      else if (base) base = '';
      else throw Error(`Locked dependency not found: ${name} from ${requester || 'root'}`);
    }
  }
  function visit(key) {
    if (selected.has(key)) return;
    const record = sourceLock.packages[key];
    if (!record || record.dev || record.link || record.hasInstallScript || record.os || record.cpu || record.optionalDependencies) throw Error(`Runtime dependency needs separate platform/install review: ${key}`);
    if (!record.integrity || !record.resolved?.startsWith('https://registry.npmjs.org/')) throw Error(`Unverified registry dependency: ${key}`);
    selected.add(key); packages[key] = structuredClone(record);
    for (const name of Object.keys(record.dependencies || {})) visit(resolveDependency(key, name));
    for (const name of Object.keys(record.peerDependencies || {})) {
      if (!record.peerDependenciesMeta?.[name]?.optional) visit(resolveDependency(key, name));
    }
  }
  for (const specifier of specifiers) {
    const name = packageName(specifier);
    if (!name) continue;
    if (!sourcePackage.dependencies?.[name]) throw Error(`Server import is not an application production dependency: ${name}`);
    const key = resolveDependency('', name); direct[name] = sourceLock.packages[key].version; visit(key);
  }
  const runtimePackage = { name: sourcePackage.name, version: sourcePackage.version, private: true, type: 'module', engines: sourcePackage.engines, scripts: { start: 'node dist/server/main.mjs', users: 'node dist/server/users.mjs' }, dependencies: Object.fromEntries(Object.entries(direct).sort()) };
  const rootPackage = { name: runtimePackage.name, version: runtimePackage.version, dependencies: runtimePackage.dependencies, engines: runtimePackage.engines };
  return { runtimePackage, runtimeLock: { name: runtimePackage.name, version: runtimePackage.version, lockfileVersion: 3, requires: true, packages: { '': rootPackage, ...Object.fromEntries(Object.entries(packages).sort()) } } };
}
async function analyzeImports(application) {
  const esbuild = require(path.join(application, 'node_modules/esbuild'));
  const result = await esbuild.build({ entryPoints: fs.readdirSync(path.join(application, 'dist/server')).filter(name => name.endsWith('.mjs')).map(name => path.join(application, 'dist/server', name)), bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false, metafile: true, outdir: 'unused-analysis' });
  return [...new Set(Object.values(result.metafile.outputs).flatMap(output => output.imports.filter(item => item.external).map(item => item.path)))].sort();
}
module.exports = { packageName, projectLock, analyzeImports };
