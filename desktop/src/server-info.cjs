'use strict';
const { isServiceUrl } = require('./policy.cjs');
const MAX_BYTES = 8192;
function validateInfo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['app', 'version', 'mode'].includes(key)) || value.app !== 'qingdan' || !['local', 'accounts'].includes(value.mode) || typeof value.version !== 'string' || value.version.length > 64 || !/^1\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/.test(value.version)) throw new Error('服务器接口与当前桌面版本不兼容。');
  return Object.freeze({ app: 'qingdan', version: value.version, mode: value.mode });
}
async function probeServer(connection, fetch_, { timeoutMs = 5000 } = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  const target = new URL('/api/app-info', connection.serverUrl).href;
  try {
    const response = await fetch_(target, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (!response.ok || response.redirected || response.url && (!isServiceUrl(response.url, connection) || new URL(response.url).pathname !== '/api/app-info')) throw new Error('无法识别青单服务器接口。');
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('服务器没有返回青单兼容信息。');
    if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('服务器响应超出允许大小。');
    const reader = response.body?.getReader(); if (!reader) throw new Error('服务器响应为空。');
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > MAX_BYTES) throw new Error('服务器响应超出允许大小。');
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    const info = validateInfo(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    return { ok: true, info };
  } catch (error) {
    const message = typeof error?.message === 'string' ? error.message : '';
    return { ok: false, error: error?.name === 'AbortError' ? '连接服务器超时，请检查后端是否已启动。' : message.startsWith('服务器') || message.startsWith('无法识别') ? message : '无法连接服务器，请检查地址、网络和HTTPS证书。' };
  } finally { clearTimeout(timer); controller.abort(); }
}
module.exports = { validateInfo, probeServer, MAX_BYTES };
