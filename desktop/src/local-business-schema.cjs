'use strict';
// Only this enumerated, non-credential application state is allowed across the
// built-in local bridge. The account is the database principal, never a port.
const LOCAL_ID = /^local:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS = new Set(['task','list','folder','tag','habit','habitLog','focus','settings','filter','countdown','template']);
const RAW_EXACT = new Set(['quick-draft','batch-tag-draft','pending-create','pending-write','pending-import','matrix-draft','calendar-batch','pending-template']);
const RAW_SUFFIX = new Set(['draft','check-draft','subtask-draft','comment-draft','focus-note','view']);
const ENCODED_EXACT = new Set(['desktop-quick-draft','full-backup-pending','habit-group-rename','reminder-actions','offline-shell-opt','offline']);
const ENCODED_SUFFIX = new Set(['comment-mentions','background-upload','attachment-upload','list-transfer','form-draft']);
const TEXT = new Set(['quick-draft','batch-tag-draft','desktop-quick-draft','check-draft','subtask-draft','comment-draft','focus-note']);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string';
const integer = value => Number.isSafeInteger(value) && value >= 0;
function fail() { throw Object.assign(new TypeError('Invalid local business storage entry'), { code: 'INVALID_LOCAL_ENTRY' }); }
function describeKey(key, principalId) {
  if (typeof key !== 'string' || key.length > 2048 || /[\u0000-\u001f\u007f]/u.test(key)) return null;
  if (principalId !== undefined && !LOCAL_ID.test(principalId)) return null;
  if (key === 'qingdan-language') return { kind: 'language', preference: true };
  if (key === 'qingdan:offline-shell-session:v1') return { kind: 'offline-shell-session', accountId: principalId };
  let match = /^qingdan:queue:(create|write):([^:]+):(.+)$/.exec(key), kind, accountId, suffix;
  try {
    if (match) { kind = `queue-${match[1]}`; accountId = decodeURIComponent(match[2]); suffix = decodeURIComponent(match[3]); if (encodeURIComponent(accountId) !== match[2] || encodeURIComponent(suffix) !== match[3]) return null; }
    else {
      match = /^qingdan:([a-z-]+):(.+)$/.exec(key); if (!match) return null; kind = match[1];
      if (RAW_EXACT.has(kind)) accountId = match[2];
      else if (RAW_SUFFIX.has(kind)) { const parts = /^(local:[^:]+):(.+)$/.exec(match[2]); if (!parts) return null; accountId = parts[1]; suffix = parts[2]; }
      else if (ENCODED_EXACT.has(kind)) { accountId = decodeURIComponent(match[2]); if (encodeURIComponent(accountId) !== match[2]) return null; }
      else if (ENCODED_SUFFIX.has(kind)) { const colon = match[2].indexOf(':'); if (colon < 1) return null; const encoded = match[2].slice(0,colon); accountId = decodeURIComponent(encoded); if (encodeURIComponent(accountId) !== encoded) return null; suffix = match[2].slice(colon+1); }
      else return null;
    }
  } catch { return null; }
  if (!LOCAL_ID.test(accountId) || principalId !== undefined && accountId !== principalId || suffix !== undefined && (!suffix || suffix.length > 1600 || /[\u0000-\u001f\u007f]/u.test(suffix))) return null;
  return { kind, accountId, suffix, preference: ['view','offline-shell-opt'].includes(kind) };
}
function record(value) { return object(value) && string(value.id) && KINDS.has(value.kind) && integer(value.revision) && object(value.data); }
function create(value) { return object(value) && string(value.id) && KINDS.has(value.kind) && object(value.data); }
function write(value) { return object(value) && string(value.id) && string(value.recordId) && KINDS.has(value.kind) && record(value.base) && object(value.desired) && typeof value.deleted === 'boolean'; }
function validateEntry(key, value, principalId) {
  const entry = describeKey(key, principalId); if (!entry || !string(value) || Buffer.byteLength(value,'utf8') > 8 * 1024 * 1024) fail();
  const { kind, accountId, suffix } = entry;
  if (kind === 'language') { if (!['system', 'zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR'].includes(value)) fail(); return true; }
  if (kind === 'offline-shell-opt') { if (!['enabled','disabled'].includes(value)) fail(); return true; }
  if (TEXT.has(kind)) return true;
  let data; try { data = JSON.parse(value); } catch { fail(); }
  // Bound depth/node count even for legitimate nested task/template drafts.
  let nodes = 0; function walk(v, depth) { if (++nodes > 300000 || depth > 40) fail(); if (v && typeof v === 'object') for (const [k,x] of Object.entries(v)) { if (['__proto__','prototype','constructor'].includes(k)) fail(); walk(x,depth+1); } } walk(data,0);
  let valid = false;
  switch (kind) {
    case 'draft': valid = object(data) && string(data.title) && string(data.description) && object(data.dirty); break;
    case 'comment-mentions': valid = Array.isArray(data) && data.every(string); break;
    case 'queue-create': valid = create(data) && data.id === suffix; break;
    case 'queue-write': valid = write(data) && data.id === suffix; break;
    case 'pending-create': valid = Array.isArray(data) && data.every(item => Array.isArray(item) && item.length === 2 && string(item[0]) && create(item[1])); break;
    case 'pending-write': valid = Array.isArray(data) && data.every(write); break;
    case 'pending-import': valid = object(data) && string(data.fingerprint) && string(data.id); break;
    case 'pending-template': valid = object(data) && string(data.templateId) && string(data.id) && typeof data.keepDates === 'boolean'; break;
    case 'full-backup-pending': valid = object(data) && data.userId === accountId && string(data.name) && /^[a-f0-9]{64}$/.test(data.hash); break;
    case 'matrix-draft': valid = object(data) && data.userId === accountId && object(data.rules); break;
    case 'calendar-batch': valid = object(data) && data.userId === accountId && Array.isArray(data.records) && data.records.every(record) && object(data.plan); break;
    case 'habit-group-rename': valid = object(data) && data.userId === accountId && Array.isArray(data.order) && data.order.every(string) && typeof data.grouped === 'boolean' && string(data.from) && string(data.to); break;
    case 'reminder-actions': valid = object(data) && data.accountId === accountId && Array.isArray(data.pending) && data.pending.length <= 50 && data.pending.every(item => object(item) && string(item.title) && string(item.taskId) && object(item.input) && string(item.input.operationId) && ['snooze','cancel'].includes(item.input.operation)); break;
    case 'attachment-upload': valid = object(data) && data.version === 1 && data.userId === accountId && encodeURIComponent(data.recordId) === suffix && string(data.operationId) && string(data.name) && string(data.mime) && integer(data.size) && /^[a-f0-9]{64}$/.test(data.digest) && /^[a-f0-9]{64}$/.test(data.fingerprint); break;
    case 'background-upload': valid = object(data) && data.userId === accountId && data.recordId === suffix && /^bg:[a-f0-9]{64}$/.test(data.id) && string(data.name) && integer(data.size); break;
    case 'list-transfer': valid = object(data) && data.userId === accountId && data.listId === suffix && string(data.operationId) && string(data.targetUserId) && string(data.targetJoinedAt) && integer(data.expectedRevision); break;
    case 'form-draft': {
      const colon = suffix.indexOf(':'); let scope; try { scope = decodeURIComponent(suffix.slice(colon+1)); } catch { fail(); }
      valid = colon > 0 && object(data) && data.version === 1 && data.accountId === accountId && KINDS.has(data.kind) && data.kind === suffix.slice(0,colon) && data.scope === scope && encodeURIComponent(scope) === suffix.slice(colon+1) && string(data.token) && object(data.fields) && (data.base === null || record(data.base)) && (!data.submission || object(data.submission) && string(data.submission.id) && string(data.submission.recordId) && object(data.submission.payload) && object(data.submission.fields)); break;
    }
    case 'view': valid = object(data) && Object.keys(data).every(k => ['showDone','layout','sort','group'].includes(k)) && (data.showDone === undefined || typeof data.showDone === 'boolean') && (data.layout === undefined || ['list','kanban','timeline'].includes(data.layout)) && (data.sort === undefined || ['manual','priority','date','title'].includes(data.sort)) && (data.group === undefined || ['date','list','priority','section','none'].includes(data.group)); break;
    case 'offline': valid = object(data) && data.version === 1 && data.accountId === accountId && string(data.savedAt) && object(data.data) && data.data.user?.userId === accountId && data.data.user?.mode === 'local' && Array.isArray(data.data.records) && data.data.records.every(record); break;
    case 'offline-shell-session': valid = object(data) && data.version === 1 && LOCAL_ID.test(data.accountId) && (principalId === undefined || data.accountId === principalId) && string(data.confirmedAt) && Number.isFinite(Date.parse(data.confirmedAt)) && typeof data.active === 'boolean' && (data.reason === undefined || string(data.reason)) && Object.keys(data).every(k => ['version','accountId','confirmedAt','active','reason'].includes(k)); break;
  }
  if (!valid) fail(); return true;
}
module.exports = { LOCAL_ID, describeKey, validateEntry };
