'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const launcher = require('./linux-launcher.cjs');
async function finalizeLinuxBundle(context) {
  if (context.electronPlatformName !== 'linux') return;
  const directory = await fs.lstat(context.appOutDir);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw Error('Invalid Linux bundle directory.');
  const executable = await fs.lstat(path.join(context.appOutDir, 'qingdan'));
  if (!executable.isFile() || executable.isSymbolicLink() || !(executable.mode & 0o111)) throw Error('Invalid Linux executable.');
  await fs.writeFile(path.join(context.appOutDir, 'AppRun'), launcher, { mode: 0o755, flag: 'wx' });
}
module.exports = finalizeLinuxBundle;
module.exports.default = finalizeLinuxBundle;
