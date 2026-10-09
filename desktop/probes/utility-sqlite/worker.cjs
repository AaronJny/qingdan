'use strict';
let database;
(async () => {
const acknowledgementTimeout = setTimeout(() => process.exit(1), 10000);
process.parentPort.on('message', event => { const message = event.data || event; if (message?.kind === 'qingdan-probe-ack') { clearTimeout(acknowledgementTimeout); process.exit(message.ok ? 0 : 1); } });
try {
  const { DatabaseSync, esmTla } = await import('./sqlite-module.mjs'); database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE probe(id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
  database.prepare('INSERT INTO probe(label) VALUES(?)').run('original');
  database.prepare('UPDATE probe SET label=? WHERE id=?').run('updated', 1);
  const result = database.prepare('SELECT label FROM probe WHERE id=?').get(1);
  const rows = database.prepare('SELECT COUNT(*) AS n FROM probe').get().n;
  const sqlite = database.prepare('SELECT sqlite_version() AS version').get().version;
  database.exec('BEGIN; INSERT INTO probe(label) VALUES(\'discarded\'); ROLLBACK;');
  const ok = result.label === 'updated' && rows === 1 && database.prepare('SELECT COUNT(*) AS n FROM probe').get().n === 1;
  database.close(); database = null;
  process.parentPort.postMessage({ kind: 'qingdan-sqlite-probe', ok, node: process.versions.node, electron: process.versions.electron, abi: process.versions.modules, sqlite, esmTla, rows, finalLabel: result.label });
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  try { database?.close(); } catch {}
  process.parentPort.postMessage({ kind: 'qingdan-sqlite-probe', ok: false, errorName: error.name, errorCode: error.code || '', node: process.versions.node }); process.exitCode = 1;
}

})();
