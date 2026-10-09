'use strict';
const path = require('node:path'); const fs = require('node:fs');
const { app, utilityProcess } = require('electron');
app.enableSandbox();
const profile = path.join(app.getPath('appData'), 'QingdanUtilityProbe'); fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile);
app.whenReady().then(() => {
  const environment = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC' };
  const child = utilityProcess.fork(path.join(__dirname, 'worker.cjs'), [], { env: environment, stdio: 'pipe', serviceName: 'Qingdan isolated SQLite probe' });
  let accepted = false; const timeout = setTimeout(() => { console.error('QINGDAN_UTILITY_PROBE_TIMEOUT'); child.kill(); app.exit(1); }, 20000);
  child.stdout?.on('data', data => process.stdout.write(data)); child.stderr?.on('data', data => process.stderr.write(data));
  child.on('message', message => {
    accepted = message?.kind === 'qingdan-sqlite-probe' && message?.ok === true && /^24\./.test(message.node || '') && message.rows === 1 && message.finalLabel === 'updated' && message.esmTla === true;
    console.log('QINGDAN_UTILITY_PROBE_RESULT ' + JSON.stringify(message));
    child.postMessage({ kind: 'qingdan-probe-ack', ok: accepted });
  });
  child.on('exit', code => { clearTimeout(timeout); console.log('QINGDAN_UTILITY_PROBE_EXIT ' + code); app.exit(accepted && code === 0 ? 0 : 1); });
}).catch(error => { console.error('QINGDAN_UTILITY_PROBE_FAILURE ' + error.name); app.exit(1); });
