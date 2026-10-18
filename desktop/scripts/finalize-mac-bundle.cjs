'use strict';
// Electron 44.6.0 first resolves the literal Electron Helper executable, then
// falls back to CFBundleName + " Helper". Keep its official internal names while
// localizing the application display name. Run BEFORE fuse finalization/signing.
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
async function writeLocalizedNames(contents, englishDisplay, chineseDisplay, stableName) {
  const resources = path.join(contents, 'Resources');
  await fs.mkdir(resources, { recursive: true }); await realDirectory(resources);
  for (const [locale, display] of [['en', englishDisplay], ['zh_CN', chineseDisplay], ['zh', chineseDisplay]]) {
    const directory = path.join(resources, locale + '.lproj');
    await fs.mkdir(directory, { recursive: true }); await realDirectory(directory);
    const file = path.join(directory, 'InfoPlist.strings');
    try { await realFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const content = `"CFBundleDisplayName" = ${JSON.stringify(display)};\n"CFBundleName" = ${JSON.stringify(stableName || display)};\n`;
    await fs.writeFile(file, content, { mode: 0o644 });
  }
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
  // Apple CFBundleDisplayName rules require the raw display name to match 青单.app.
  // https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CoreFoundationKeys.html English
  // fallback comes from the development locale, not a bundle/executable rename.
  await writeLocalizedNames(contents, 'Qingdan', '青单');
  info.CFBundleDevelopmentRegion = 'en'; info.CFBundleLocalizations = ['en', 'zh_CN', 'zh'];
  await fs.writeFile(infoPath, plist.build(info) + '\n');
  for (const helper of helpers) {
    const { source, target, sourceName, targetName, metadataPath, metadata, index } = helper;
    metadata.CFBundleName = targetName;
    metadata.CFBundleExecutable = targetName;
    metadata.CFBundleDisplayName = targetName;
    metadata.CFBundleDevelopmentRegion = 'en'; metadata.CFBundleLocalizations = ['en', 'zh_CN', 'zh'];
    await writeLocalizedNames(path.join(source, 'Contents'), `Qingdan Helper${SUFFIXES[index]}`, `青单辅助程序${DISPLAY_NAMES[index]}`, targetName);
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
