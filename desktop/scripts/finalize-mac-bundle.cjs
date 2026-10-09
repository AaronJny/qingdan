'use strict';
// Electron 44.6.0 first resolves the literal Electron Helper executable, then
// falls back to CFBundleName + " Helper". Keep its official internal names while
// presenting a Chinese application name. Run BEFORE fuse finalization/signing.
const fs = require('node:fs/promises');
const path = require('node:path');
const plist = require('plist');
const SUFFIXES = ['', ' (GPU)', ' (Plugin)', ' (Renderer)'];
const DISPLAY_NAMES = ['', '（图形）', '（插件）', '（渲染器）'];
async function realFile(file, executable = false) {
  const value = await fs.lstat(file);
  if (!value.isFile() || value.isSymbolicLink() || executable && !(value.mode & 0o111)) throw new Error(`Invalid bundle file: ${file}`);
}
async function realDirectory(directory) {
  const value = await fs.lstat(directory);
  if (!value.isDirectory() || value.isSymbolicLink()) throw new Error(`Invalid bundle directory: ${directory}`);
}
async function finalizeBundle(bundle, helperPrefix) {
  if (!helperPrefix || path.basename(helperPrefix) !== helperPrefix) throw new Error('Invalid helper prefix');
  await realDirectory(bundle);
  const contents = path.join(bundle, 'Contents');
  const infoPath = path.join(contents, 'Info.plist');
  await realFile(infoPath);
  const info = plist.parse(await fs.readFile(infoPath, 'utf8'));
  if (info.CFBundleName !== '青单' || info.CFBundleDisplayName !== '青单' || info.CFBundleIdentifier !== 'app.qingdan.desktop' || info.CFBundleExecutable !== '青单') throw new Error('Unexpected main app identity');
  await realFile(path.join(contents, 'MacOS', info.CFBundleExecutable), true);
  const frameworks = path.join(contents, 'Frameworks');
  await realDirectory(frameworks);
  // Validate all four bundles before mutating anything. Missing helpers are a
  // packaging error, never a reason to turn off a fuse or ignore a launch check.
  const helpers = [];
  for (let index = 0; index < SUFFIXES.length; index++) {
    const suffix = SUFFIXES[index], sourceName = `${helperPrefix} Helper${suffix}`, targetName = `Electron Helper${suffix}`;
    const source = path.join(frameworks, `${sourceName}.app`), target = path.join(frameworks, `${targetName}.app`);
    await realDirectory(source); await realDirectory(path.join(source, 'Contents')); await realDirectory(path.join(source, 'Contents', 'MacOS'));
    const metadataPath = path.join(source, 'Contents', 'Info.plist'); await realFile(metadataPath);
    const metadata = plist.parse(await fs.readFile(metadataPath, 'utf8'));
    if (metadata.CFBundleExecutable !== sourceName) throw new Error(`Helper executable mismatch: ${sourceName}`);
    await realFile(path.join(source, 'Contents', 'MacOS', sourceName), true);
    if (source !== target) {
      try { await fs.lstat(target); throw new Error(`Refusing helper collision: ${targetName}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    helpers.push({ source, target, sourceName, targetName, metadataPath, metadata, index });
  }
  for (const helper of helpers) {
    const { source, target, sourceName, targetName, metadataPath, metadata, index } = helper;
    metadata.CFBundleName = targetName;
    metadata.CFBundleExecutable = targetName;
    metadata.CFBundleDisplayName = `青单辅助程序${DISPLAY_NAMES[index]}`;
    await fs.writeFile(metadataPath, plist.build(metadata) + '\n');
    if (source !== target) {
      await fs.rename(path.join(source, 'Contents', 'MacOS', sourceName), path.join(source, 'Contents', 'MacOS', targetName));
      await fs.rename(source, target);
    }
  }
  for (const suffix of SUFFIXES) await realFile(path.join(frameworks, `Electron Helper${suffix}.app`, 'Contents', 'MacOS', `Electron Helper${suffix}`), true);
}
async function finalizeMacBundle(context) {
  if (!['darwin', 'mas'].includes(context.electronPlatformName)) return;
  const { productFilename, sanitizedProductName } = context.packager.appInfo;
  if (productFilename !== '青单') throw new Error('macOS bundle must be 青单.app');
  await finalizeBundle(path.join(context.appOutDir, `${productFilename}.app`), sanitizedProductName);
}
module.exports = finalizeMacBundle;
module.exports.default = finalizeMacBundle;
module.exports.finalizeBundle = finalizeBundle;
module.exports.SUFFIXES = SUFFIXES;
