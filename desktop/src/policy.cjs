'use strict';
const { createHash } = require('node:crypto');
const SCHEME = 'qingdan-local';
const UI_ORIGIN = `${SCHEME}://ui`;
const LOCAL_SETTINGS_URL = `${UI_ORIGIN}/settings`;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
function parseUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
  try { return new URL(value); } catch { return null; }
}
function validateServerUrl(value) {
  const raw = typeof value === 'string' ? value.match(/^(https?):\/\/(\[[^\]\/@?#]+\]|[^\/:@?#%]+)(?::([0-9]+))?\/?$/iu) : null;
  const url = parseUrl(value);
  const literalLoopback = raw && LOOPBACK.has(raw[2].toLowerCase());
  if (!raw || !url || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.port === '0') throw new Error('请输入服务器根地址，不能包含账号、密码、查询参数或子路径。');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && literalLoopback)) throw new Error('HTTP只允许localhost、127.0.0.1或::1；其他服务器必须使用HTTPS。');
  if (['0.0.0.0', '[::]'].includes(url.hostname) || !url.hostname || url.hostname.includes('*')) throw new Error('请输入明确的服务器地址。');
  return url.href;
}
function validateDefaults(raw) {
  if (!raw || raw.schemaVersion !== 2 || typeof raw.appName !== 'string' || !raw.appName.trim() || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}$/.test(raw.appId)) throw new Error('Invalid standalone defaults');
  return Object.freeze({ schemaVersion: 2, appName: raw.appName.trim(), appId: raw.appId, serverUrl: validateServerUrl(raw.serverUrl) });
}
function endpoint(value, builtin = false) {
  const serverUrl = validateServerUrl(value); const url = new URL(serverUrl);
  return Object.freeze({ serverUrl, origin: url.origin, hostname: url.hostname, builtin, partition: `persist:qingdan-desktop-${builtin ? 'local' : 'server'}-${createHash('sha256').update(url.origin).digest('hex').slice(0, 20)}` });
}
function isServiceUrl(value, connection) {
  const url = parseUrl(value);
  if (!url || url.username || url.password || url.origin !== connection.origin || !['http:', 'https:'].includes(url.protocol)) return false;
  let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { return false; }
  return !/[\u0000-\u001f\u007f\\]/u.test(pathname) && !pathname.includes('//');
}
function isLocalUiUrl(value, page) {
  const url = parseUrl(value);
  return !!url && url.protocol === `${SCHEME}:` && url.hostname === 'ui' && !url.port && !url.username && !url.password && !url.search && !url.hash && url.pathname === `/${page}`;
}
function isStatusUrl(value) { return ['status', 'ui.css', 'status.js'].some(page => isLocalUiUrl(value, page)); }
function isSettingsResource(value) { return ['settings', 'ui.css', 'settings.js'].some(page => isLocalUiUrl(value, page)); }
function safeExternalUrl(value) {
  const url = parseUrl(value);
  if (!url || url.username || url.password || !url.hostname || url.port === '0') return null;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) return null;
  return url.href;
}
function safeDownloadFilename(value) {
  const name = String(value || 'download').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/gu, '_').replace(/[. ]+$/u, '').slice(0, 180);
  return !name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `qingdan-${name || 'download'}` : name;
}
function trustedSettingsSender(event, settingsContents) {
  return !!settingsContents && event?.sender === settingsContents && event.senderFrame === settingsContents.mainFrame && isLocalUiUrl(event.senderFrame?.url, 'settings');
}
function trustedServiceSender(event, contents, connection) {
  return !!contents && !!connection && event?.sender === contents && event.senderFrame === contents.mainFrame &&
    (isServiceUrl(event.senderFrame?.url, connection) || isLocalUiUrl(event.senderFrame?.url, 'status'));
}
module.exports = { SCHEME, UI_ORIGIN, LOCAL_SETTINGS_URL, parseUrl, validateServerUrl, validateDefaults, endpoint, isServiceUrl, isLocalUiUrl, isStatusUrl, isSettingsResource, safeExternalUrl, safeDownloadFilename, trustedSettingsSender, trustedServiceSender };
