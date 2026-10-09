'use strict';
const { isServiceUrl } = require('./policy.cjs');
function validAccount(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value); }
function cleanAlert(value) {
  if (!value || typeof value !== 'object' || (typeof value.id !== 'string' || !/^[a-f0-9]{64}$/.test(value.id)) || !validAccount(value.taskId)
    || typeof value.title !== 'string' || value.title.length > 4000 || typeof value.scheduledAt !== 'string' || value.scheduledAt.length > 64 || !Number.isFinite(Date.parse(value.scheduledAt))) return null;
  return { id: value.id, taskId: value.taskId, title: value.title.slice(0, 500), scheduledAt: value.scheduledAt,
    kind: value.kind === 'countdown' ? 'countdown' : 'task', ...(validAccount(value.checkId) ? { checkId: value.checkId } : {}) };
}
async function readJson(response, connection, pathname) {
  if (!response.ok || response.redirected || response.url && (!isServiceUrl(response.url, connection) || new URL(response.url).pathname !== pathname)
    || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('Invalid reminder response');
  const reader = response.body?.getReader(); if (!reader) throw new Error('Missing reminder response');
  const chunks = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 262144) { await reader.cancel(); throw new Error('Reminder response too large'); } chunks.push(Buffer.from(value)); } }
  finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
class ReminderScheduler {
  constructor({ Notification, onEvent = () => {}, onOpen = () => {}, canRun = () => true }) {
    this.Notification = Notification; this.onEvent = onEvent; this.onOpen = onOpen; this.canRun = canRun;
    this.generation = 0; this.notifications = new Set(); this.alerts = new Map(); this.delivered = new Map(); this.forgotten = new Map(); this.accountId = null;
    this.supported = !!Notification?.isSupported(); this.failed = false; this.pending = null;
  }
  get ownsDelivery() { return this.supported && !this.failed; }
  configure(connection, fetch_) {
    if (this.connection === connection) return;
    this.cancel(); this.connection = connection; this.fetch = fetch_; this.accountId = null; this.failed = false;
  }
  bindAccount(accountId) {
    if (!validAccount(accountId)) throw new Error('Invalid desktop account');
    if (this.accountId !== accountId) { this.cancel(); this.accountId = accountId; this.failed = false; }
    return this.snapshot(accountId);
  }
  snapshot(accountId) { return { notificationOwner: this.ownsDelivery, alerts: accountId === this.accountId ? [...this.alerts.values()] : [] }; }
  forget(accountId, ids) {
    if (accountId !== this.accountId || !Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) return false;
    for (const id of ids) { const deliveredAt = this.delivered.get(id); if (deliveredAt) this.forgotten.set(id, deliveredAt); this.alerts.delete(id); }
    for (const notification of this.notifications) if (ids.includes(notification.qingdanReminderId)) { this.notifications.delete(notification); try { notification.close(); } catch {} }
    return true;
  }
  cancel() {
    this.generation++; this.controller?.abort(); this.controller = null; this.pending = null;
    for (const notification of this.notifications) { try { notification.close(); } catch {} }
    this.notifications.clear(); this.alerts.clear(); this.delivered.clear(); this.forgotten.clear();
  }
  invalidateSession() { this.cancel(); this.accountId = null; }
  async check() {
    if (this.pending || !this.connection || !this.accountId || !this.ownsDelivery || !this.canRun()) return;
    const generation = this.generation, connection = this.connection, accountId = this.accountId;
    const controller = new AbortController(); this.controller = controller;
    const active = () => generation === this.generation && connection === this.connection && accountId === this.accountId && !controller.signal.aborted && this.canRun();
    const timer = setTimeout(() => controller.abort(), 12000); timer.unref?.();
    const request = async (pathname, body, csrf) => {
      if (!active()) throw new Error('Cancelled reminder request');
      const response = await this.fetch(new URL(pathname, connection.serverUrl).href, {
        method: body ? 'POST' : 'GET', credentials: 'include', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', Origin: connection.origin, 'x-qingdan': '1', 'x-qingdan-csrf': csrf, 'x-qingdan-expected-account': accountId } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await readJson(response, connection, pathname);
      if (!active()) throw new Error('Cancelled reminder response');
      return result;
    };
    const run = async () => {
      const auth = await request('/api/auth/me');
      if (auth.user?.userId !== accountId || !/^[a-f0-9]{64}$/.test(auth.csrfToken || '')) {
        if (active()) this.invalidateSession(); return;
      }
      const visibleIds = [...this.alerts.keys()].slice(0, 100);
      const result = await request('/api/reminders', { operation: 'check', visibleIds, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, auth.csrfToken);
      if (!Array.isArray(result.alerts) || result.alerts.length > 30 || !Array.isArray(result.activeIds)) throw new Error('Invalid reminder list');
      for (const id of visibleIds) if (!result.activeIds.includes(id)) this.alerts.delete(id);
      const alerts = result.alerts.map(cleanAlert); if (alerts.some(value => !value)) throw new Error('Invalid reminder item');
      const acknowledged = [];
      for (const alert of alerts) {
        if (!active()) return;
        // A lost ack response may return the same claim after its lease expires.
        // Dedupe that delivery, while allowing the same alert to be snoozed later.
        const previous = this.delivered.get(alert.id);
        let shown = previous === alert.scheduledAt;
        if (!shown) shown = await this.showNotification(alert, active, controller.signal, accountId);
        if (!active()) return;
        if (shown) { this.delivered.set(alert.id, alert.scheduledAt); if (this.forgotten.get(alert.id) !== alert.scheduledAt) this.alerts.set(alert.id, alert); acknowledged.push(alert.id); }
        else { this.failed = true; this.onEvent({ type: 'runtime-status', notificationOwner: false }); break; }
      }
      while (this.alerts.size > 100) this.alerts.delete(this.alerts.keys().next().value);
      while (this.forgotten.size > 1000) this.forgotten.delete(this.forgotten.keys().next().value);
      while (this.delivered.size > 1000) this.delivered.delete(this.delivered.keys().next().value);
      if (!active()) return;
      this.onEvent({ type: 'reminders', accountId, alerts: [...this.alerts.values()] });
      if (acknowledged.length) await request('/api/reminders', { operation: 'ack', ids: acknowledged }, auth.csrfToken);
    };
    const pending = run().catch(() => {}).finally(() => { clearTimeout(timer); if (this.pending === pending) this.pending = null; if (this.controller === controller) this.controller = null; });
    this.pending = pending; return pending;
  }
  showNotification(alert, active, signal, accountId) {
    return new Promise(resolve => {
      let notification, timer, settled = false;
      const finish = shown => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(shown); };
      const abort = () => { try { notification?.close(); } catch {} finish(false); };
      try {
        notification = new this.Notification({ title: '青单提醒', body: alert.title, silent: false });
        this.notifications.add(notification); notification.qingdanReminderId = alert.id;
        if (this.notifications.size > 100) { const oldest = this.notifications.values().next().value; this.notifications.delete(oldest); try { oldest.close(); } catch {} }
        notification.once('show', () => finish(active()));
        notification.once('failed', () => { this.notifications.delete(notification); finish(false); });
        notification.once('close', () => { this.notifications.delete(notification); finish(false); });
        notification.on('click', () => { if (this.accountId === accountId && this.notifications.has(notification) && this.canRun()) this.onOpen({ ...alert, accountId }); });
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => { abort(); this.notifications.delete(notification); }, 4000); timer.unref?.();
        if (active()) notification.show(); else abort();
      } catch { if (notification) this.notifications.delete(notification); finish(false); }
    });
  }
}
module.exports = { ReminderScheduler, readJson, cleanAlert, validAccount };
