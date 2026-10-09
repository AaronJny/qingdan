'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const plist = require('plist');
const hook = require('../scripts/finalize-mac-bundle.cjs');
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
test('macOS internal helper names match the Electron 44.6.0 default lookup and display in Chinese', async t => {
  const { app, frameworks } = await fixture(t);
  // The previous release's Chinese CFBundleName could resolve neither candidate.
  for (const name of ['Electron', '青单']) await assert.rejects(fs.access(path.join(frameworks, `${name} Helper.app/Contents/MacOS/${name} Helper`)));
  await hook.finalizeBundle(app, 'Qingdan');
  for (const suffix of hook.SUFFIXES) {
    const helper = path.join(frameworks, `Electron Helper${suffix}.app`);
    const info = plist.parse(await fs.readFile(path.join(helper, 'Contents/Info.plist'), 'utf8'));
    assert.equal(info.CFBundleExecutable, `Electron Helper${suffix}`);
    assert.equal(info.CFBundleName, `Electron Helper${suffix}`);
    assert.ok(info.CFBundleDisplayName.startsWith('青单辅助程序'));
    assert.equal(info.CFBundleIdentifier, `app.qingdan.desktop.helper${suffix}`);
    assert.ok((await fs.stat(path.join(helper, 'Contents/MacOS', info.CFBundleExecutable))).mode & 0o111);
    await assert.rejects(fs.access(path.join(frameworks, `Qingdan Helper${suffix}.app`)));
  }
  assert.equal(plist.parse(await fs.readFile(path.join(app, 'Contents/Info.plist'), 'utf8')).CFBundleIdentifier, 'app.qingdan.desktop');
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
  await fs.chmod(binary, 0o644); await assert.rejects(hook.finalizeBundle(app, 'Qingdan'), /Invalid bundle file/);
  await fs.chmod(binary, 0o755); await fs.mkdir(path.join(frameworks, 'Electron Helper.app'));
  await assert.rejects(hook.finalizeBundle(app, 'Qingdan'), /collision/);
});
test('hook ignores Windows and Linux packages', async () => {
  for (const electronPlatformName of ['win32', 'linux']) await hook({ electronPlatformName });
});
test('config retains application identity, Chinese Mac filename and safety fuses', () => {
  const config = require('../builder.config.cjs');
  assert.equal(config.appId, 'app.qingdan.desktop');
  assert.equal(config.mac.executableName, '青单');
  assert.equal(config.mac.extendInfo.CFBundleName, '青单');
  assert.equal(config.electronFuses.enableEmbeddedAsarIntegrityValidation, true);
  assert.equal(config.electronFuses.onlyLoadAppFromAsar, true);
  assert.equal(config.electronFuses.runAsNode, false);
  assert.match(require('node:fs').readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8'), /app\.getPath\('appData'\), 'QingdanDesktop'/);
});
