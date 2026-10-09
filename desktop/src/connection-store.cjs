'use strict';
const fs = require('node:fs'); const path = require('node:path');
const { validateServerUrl } = require('./policy.cjs');
function validateSelection(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['mode', 'serverUrl'].includes(key))) throw new Error('请选择本机模式或明确的私服地址。');
  if (raw.mode === 'builtin') return Object.freeze({ mode: 'builtin', serverUrl: '' });
  if (raw.mode !== 'server') throw new Error('不支持的连接模式。');
  return Object.freeze({ mode: 'server', serverUrl: validateServerUrl(raw.serverUrl) });
}
function readConnection(file) {
  try { const raw = JSON.parse(fs.readFileSync(file, 'utf8')); if (raw.schemaVersion !== 3) throw new Error('Unsupported configuration'); return { ...validateSelection({ mode: raw.mode, serverUrl: raw.serverUrl }), warning: '' }; }
  catch (error) { return { mode: 'builtin', serverUrl: '', warning: error.code === 'ENOENT' ? '' : '连接配置无法读取，已使用内置本机模式；已有本机数据不会删除。' }; }
}
function saveConnection(file, value) {
  const selected = validateSelection(value); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 3, ...selected }, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temporary, file); return selected;
}
module.exports = { validateSelection, readConnection, saveConnection };
