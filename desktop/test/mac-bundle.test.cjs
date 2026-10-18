'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const plist = require('plist');
const hook = require('../scripts/finalize-mac-bundle.cjs');
const { MAC_LOCALIZATIONS, localizedBundleNames } = require('../scripts/bundle-locales.cjs');
const windows = process.platform === 'win32';
if (windows) {
  // Windows does not store POSIX execute bits. Only that fixture metadata is
  // simulated; helper names, bytes, plist identity and collisions remain real.
  const originalLstat = fs.lstat;
  test.mock.method(fs, 'lstat', async function(file, ...args) {
    const value = await originalLstat.call(fs, file, ...args);
    if (String(file).includes('qingdan-mac-test-') && String(file).includes(path.sep + 'MacOS' + path.sep) && value.isFile()) value.mode |= 0o111;
    return value;
  });
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qingdan-mac-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = path.join(root, '青单.app');
  async function bundle(directory, name, id, chinese = false) {
    await fs.mkdir(path.join(directory, 'Contents/MacOS'), { recursive: true });
    await fs.writeFile(path.join(directory, 'Contents/MacOS', name), 'fixture', { mode: 0o755 });
    await fs.writeFile(path.join(directory, 'Contents/Info.plist'), plist.build({ CFBundleName: chinese ? '青单' : 'Electron Helper', CFBundleDisplayName: chinese ? '青单' : name, CFBundleExecutable: name, CFBundleIdentifier: id, CFBundleVersion: '1.0.2' }));
  }
  await bundle(app, '青单', 'app.qingdan.desktop', true);
  for (const suffix of hook.SUFFIXES) await bundle(path.join(app, 'Contents/Frameworks', `Qingdan Helper${suffix}.app`), `Qingdan Helper${suffix}`, `app.qingdan.desktop.helper${suffix}`);
  return { app, root, frameworks: path.join(app, 'Contents/Frameworks') };
}
test('macOS helper lookup names stay unchanged while display names follow system language', async t => {
  const { app, frameworks } = await fixture(t);
  // The previous release's Chinese CFBundleName could resolve neither candidate.
  for (const name of ['Electron', '青单']) await assert.rejects(fs.access(path.join(frameworks, `${name} Helper.app/Contents/MacOS/${name} Helper`)));
  await hook.finalizeBundle(app, 'Qingdan');
  for (const suffix of hook.SUFFIXES) {
    const helper = path.join(frameworks, `Electron Helper${suffix}.app`);
    const info = plist.parse(await fs.readFile(path.join(helper, 'Contents/Info.plist'), 'utf8'));
    assert.equal(info.CFBundleExecutable, `Electron Helper${suffix}`);
    assert.equal(info.CFBundleName, `Electron Helper${suffix}`);
    assert.equal(info.CFBundleDisplayName, `Electron Helper${suffix}`);
    assert.equal(info.CFBundleDevelopmentRegion, 'en');
    assert.deepEqual(info.CFBundleLocalizations, [...MAC_LOCALIZATIONS]);
    for (const [locale] of localizedBundleNames('Qingdan', '青单')) assert.match(await fs.readFile(path.join(helper, `Contents/Resources/${locale}.lproj/InfoPlist.strings`), 'utf8'), /CFBundleDisplayName/);
    assert.match(await fs.readFile(path.join(helper, 'Contents/Resources/en.lproj/InfoPlist.strings'), 'utf8'), /Qingdan Helper/);
    assert.match(await fs.readFile(path.join(helper, 'Contents/Resources/zh_CN.lproj/InfoPlist.strings'), 'utf8'), /青单辅助程序/);
    assert.equal(info.CFBundleIdentifier, `app.qingdan.desktop.helper${suffix}`);
    if (!windows) assert.ok((await fs.stat(path.join(helper, 'Contents/MacOS', info.CFBundleExecutable))).mode & 0o111);
    await assert.rejects(fs.access(path.join(frameworks, `Qingdan Helper${suffix}.app`)));
  }
  const mainInfo = plist.parse(await fs.readFile(path.join(app, 'Contents/Info.plist'), 'utf8'));
  assert.equal(mainInfo.CFBundleIdentifier, 'app.qingdan.desktop'); assert.equal(mainInfo.CFBundleDevelopmentRegion, 'en');
  assert.deepEqual(mainInfo.CFBundleLocalizations, [...MAC_LOCALIZATIONS]);
  for (const [locale, display] of localizedBundleNames('Qingdan', '青单')) assert.ok((await fs.readFile(path.join(app, `Contents/Resources/${locale}.lproj/InfoPlist.strings`), 'utf8')).includes(`"CFBundleDisplayName" = "${display}"`));
  assert.equal(mainInfo.CFBundleDisplayName, '青单', 'Finder lookup still matches the on-disk app name');
  assert.match(await fs.readFile(path.join(app, 'Contents/Resources/en.lproj/InfoPlist.strings'), 'utf8'), /"CFBundleDisplayName" = "Qingdan"/);
  for (const locale of ['zh_CN','zh']) assert.match(await fs.readFile(path.join(app, `Contents/Resources/${locale}.lproj/InfoPlist.strings`), 'utf8'), /"CFBundleDisplayName" = "青单"/);
});
test('missing helper fails packaging before changing other helpers', async t => {
  const { app, frameworks } = await fixture(t);
  await fs.rm(path.join(frameworks, 'Qingdan Helper (Renderer).app'), { recursive: true });
  await assert.rejects(hook.finalizeBundle(app, 'Qingdan'));
  await fs.access(path.join(frameworks, 'Qingdan Helper.app/Contents/MacOS/Qingdan Helper'));
});
test('nonexecutable helper and conflicting destination are rejected', async t => {
  const { app, frameworks } = await fixture(t);
  const binary = path.join(frameworks, 'Qingdan Helper.app/Contents/MacOS/Qingdan Helper');
  if (!windows) {
    await fs.chmod(binary, 0o644); await assert.rejects(hook.finalizeBundle(app, 'Qingdan'), /Invalid bundle file/);
    await fs.chmod(binary, 0o755);
  }
  await fs.mkdir(path.join(frameworks, 'Electron Helper.app'));
  await assert.rejects(hook.finalizeBundle(app, 'Qingdan'), /collision/);
});
test('hook ignores Windows and Linux packages', async () => {
  for (const electronPlatformName of ['win32', 'linux']) await hook({ electronPlatformName });
});
test('config retains application identity, Chinese Mac filename and safety fuses', () => {
  const config = require('../builder.config.cjs');
  assert.equal(config.appId, 'app.qingdan.desktop');
  assert.equal(config.mac.executableName, '青单');
  assert.deepEqual(config.mac.target, [{ target: 'dir', arch: ['arm64', 'x64'] }]);
  assert.equal(config.mac.extendInfo.CFBundleName, '青单');
  assert.equal(config.mac.extendInfo.CFBundleDevelopmentRegion, 'en');
  assert.deepEqual(config.mac.extendInfo.CFBundleLocalizations, ['en','zh-CN','zh-Hans','zh-TW','zh-Hant','ja','ko','es','fr','de','pt-BR','zh_CN','zh','zh_Hans','zh_TW','zh_Hant','pt_BR']);
  assert.equal(config.electronFuses.enableEmbeddedAsarIntegrityValidation, true);
  assert.equal(config.electronFuses.onlyLoadAppFromAsar, true);
  assert.equal(config.electronFuses.runAsNode, false);
  assert.match(require('node:fs').readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8'), /app\.getPath\('appData'\), 'QingdanDesktop'/);
});
test('localized metadata refuses symbolic-link resource directories', {skip:windows}, async t => {
  const {app,root}=await fixture(t);const outside=path.join(root,'outside');await fs.mkdir(outside);
  await fs.symlink(outside,path.join(app,'Contents/Resources'));
  await assert.rejects(hook.finalizeBundle(app,'Qingdan'),/Invalid bundle directory/);
  assert.deepEqual(await fs.readdir(outside),[]);
});

test('canonical Apple language IDs and legacy aliases keep the correct Chinese script', () => {
  const names = Object.fromEntries(localizedBundleNames('Qingdan', '青单'));
  for (const locale of ['zh-TW', 'zh-Hant', 'zh_TW', 'zh_Hant']) assert.equal(names[locale], '青單');
  for (const locale of ['zh-CN', 'zh-Hans', 'zh_CN', 'zh_Hans', 'zh']) assert.equal(names[locale], '青单');
  for (const locale of ['en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'pt_BR']) assert.equal(names[locale], 'Qingdan');
  const helpers = Object.fromEntries(localizedBundleNames('Qingdan Helper (GPU)', '青单辅助程序（图形）'));
  assert.equal(helpers['zh-Hant'], '青單輔助程式（圖形）');
  assert.equal(helpers['zh-Hant'], helpers['zh_Hant']);
});
