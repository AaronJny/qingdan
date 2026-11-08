'use strict';
// Called only after the exact installed candidate passed all native lifecycle
// checks. Bind unchanged smoke reports to the .deb bytes the publisher uploads.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
function assemble(root) {
  const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const version = read('desktop/package.json').version;
  assert(/^\d+\.\d+\.\d+$/.test(version));
  const archive = `Qingdan-${version}-linux-amd64.deb`;
  const bytes = fs.readFileSync(path.join(root, 'desktop/dist', archive));
  const archiveSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const packaged = read('desktop/dist/verified-linux-deb-amd64.json');
  assert.equal(packaged.version, version);
  assert.equal(packaged.archiveSha256, archiveSha256);
  const lifecycle = read('validation/lifecycle.json');
  for (const key of ['install', 'samePayloadVersionUpgrade', 'reinstall', 'remove', 'purge', 'userDataPreserved', 'globalUsernsPolicyUnchanged']) assert.equal(lifecycle[key], true, key);
  assert.equal(lifecycle.guiExitStatus, 0); assert.equal(lifecycle.mcpExitStatus, 0);
  const gui = read('validation/installed-gui.json');
  const mcp = read('validation/installed-mcp.json');
  assert.equal(gui.passed, true); assert.equal(mcp.passed, true);
  return { schema: 'qingdan-linux-deb-native-v1', version, architecture: 'amd64', archive,
    archiveBytes: bytes.length, archiveSha256, lifecycle, gui, mcp };
}
if (require.main === module) {
  const root = process.cwd();
  fs.writeFileSync(path.join(root, 'validation/verified-linux-deb-native-amd64.json'), JSON.stringify(assemble(root), null, 2) + '\n');
}
module.exports = { assemble };
