'use strict';
// Test-only Node launcher. IPC triggers the entry point's existing closeStorage
// shutdown handler on Windows as well as POSIX; no service logic is replaced.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const [root, ...extra] = process.argv.slice(2);
if (!root || !path.isAbsolute(root) || extra.length || !process.send) throw Error('An absolute backend root and owned IPC parent are required.');
let imported = false, stopping = false;
function shutdown() {
  stopping = true;
  if (imported) {
    if (process.listenerCount('SIGTERM')) process.emit('SIGTERM');
    else process.exit(1);
  }
}
process.on('message', message => { if (message?.kind === 'qingdan-smoke-shutdown') shutdown(); });
process.on('disconnect', shutdown);
void import(pathToFileURL(path.join(root, 'dist/server/main.mjs')).href).then(() => { imported = true; if (stopping) shutdown(); }).catch(error => { console.error(error); process.exit(1); });
