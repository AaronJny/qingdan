'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { inspectMachOFile, parseMachO, assertTargetMachO } = require('./macho-architecture.cjs');
const { nativeAsarEntryPath } = require('./asar-entry-path.cjs');
const NATIVE_EXTENSION = /\.(?:node|dylib|so)$/i;
function verifyNativeNodeModules(directory, arch) {
  const result = [];
  const walk = current => {
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name), stat = fs.lstatSync(file);
      assert(!stat.isSymbolicLink(), `Native dependency symlink is not allowed: ${file}`);
      if (stat.isDirectory()) walk(file);
      else if (/\.node$/i.test(name)) result.push(assertTargetMachO(inspectMachOFile(file), arch, path.relative(directory, file).split(path.sep).join('/')));
    }
  };
  walk(directory); return result;
}
function verifyMacArchitecture(bundle, arch, archive = null) {
  assert(['x64', 'arm64'].includes(arch), 'An explicit macOS target architecture is required');
  const files = [], modules = [];
  const walk = current => {
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) continue; // The archive snapshot checks all link targets and escapes.
      if (stat.isDirectory()) { walk(file); continue; }
      assert(stat.isFile(), `Unexpected bundle entry: ${file}`);
      const relative = path.relative(bundle, file).split(path.sep).join('/');
      const framework = relative.match(/(?:^|\/)([^/]+)\.framework\/(?:Versions\/[^/]+\/)?([^/]+)$/);
      const required = NATIVE_EXTENSION.test(name) || relative.includes('/MacOS/') || framework && framework[1] === framework[2];
      const info = inspectMachOFile(file);
      if (info || required) files.push(assertTargetMachO(info, arch, relative));
      if (/\.node$/i.test(name)) modules.push(relative);
    }
  };
  walk(bundle);
  const required = ['Contents/MacOS/青单', 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
    ...['', ' (GPU)', ' (Plugin)', ' (Renderer)'].map(suffix => `Contents/Frameworks/Electron Helper${suffix}.app/Contents/MacOS/Electron Helper${suffix}`)];
  for (const name of required) assert(files.some(file => file.path === name), `Missing native macOS runtime binary: ${name}`);
  if (archive) {
    const asar = require('@electron/asar');
    for (const item of asar.listPackage(archive)) {
      const name = item.split(path.sep).join('/').replace(/^\//, '');
      const native = nativeAsarEntryPath(name), stat = asar.statFile(archive, native, false);
      if (stat.files) continue;
      // Inspect every regular ASAR file, not only a suffix that can be renamed.
      const bytes = asar.extractFile(archive, native), info = parseMachO(bytes, name);
      const relative = 'Contents/Resources/app.asar/' + name;
      if (info || NATIVE_EXTENSION.test(name)) files.push(assertTargetMachO(info, arch, relative));
      if (/\.node$/i.test(name)) modules.push(relative);
    }
  }
  return { targetArch: arch, allMachOMatchTarget: true, machOFiles: files.sort((a, b) => a.path.localeCompare(b.path, 'en')), nativeNodeModules: modules.sort() };
}
module.exports = { verifyNativeNodeModules, verifyMacArchitecture };
