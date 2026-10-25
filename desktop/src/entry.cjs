'use strict';
// Dispatch before loading GUI/session/profile code or acquiring its instance lock.
if (process.argv.includes('--mcp')) {
  const { app } = require('electron');
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const index = process.argv.indexOf('--mcp');
  process.argv = [process.execPath, 'qingdan-mcp', ...process.argv.slice(index + 1)];
  // No BrowserWindow, profile selection, account login or grant creation occurs here.
  let stopped = false;
  const stop = () => { if (!stopped) { stopped = true; app.exit(process.exitCode || 0); } };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  import(pathToFileURL(path.join(__dirname, '../backend/dist/server/mcp.mjs')).href)
    .then(({ mcpInput }) => {
      if (process.exitCode || !mcpInput) { process.exitCode ||= 1; stop(); return; }
      mcpInput.once('end', stop);
      mcpInput.once('close', stop);
      if (mcpInput.readableEnded || mcpInput.destroyed) stop();
    })
    .catch(() => { process.stderr.write('Qingdan MCP adapter is unavailable. Reinstall a complete desktop build.\n'); app.exit(1); });
} else {
  require('./main.cjs');
}
