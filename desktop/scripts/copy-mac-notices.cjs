'use strict';
const fs = require('node:fs/promises'); const path = require('node:path');
// Runs after the matching official Electron archive has been extracted, before
// electron-builder deletes its root notices and before app resources are signed.
async function copyMacNotices(context) {
  if (!['darwin', 'mas'].includes(context.electronPlatformName)) return;
  const appName = context.packager.info.framework.distMacOsAppName;
  if (typeof appName !== 'string' || path.basename(appName) !== appName || !appName.endsWith('.app')) throw new Error('Invalid extracted Electron application name');
  const resources = path.join(context.appOutDir, appName, 'Contents', 'Resources');
  const directory = await fs.lstat(resources);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Missing extracted Electron resources');
  const notices = [['LICENSE', 'LICENSE.electron.txt'], ['LICENSES.chromium.html', 'LICENSES.chromium.html']];
  for (const [sourceName, targetName] of notices) {
    const source = path.join(context.appOutDir, sourceName); const stat = await fs.lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 32 * 1024 * 1024) throw new Error('Missing or invalid official Electron runtime notice');
    await fs.copyFile(source, path.join(resources, targetName), fs.constants.COPYFILE_EXCL);
  }
}
module.exports = copyMacNotices; module.exports.default = copyMacNotices;
