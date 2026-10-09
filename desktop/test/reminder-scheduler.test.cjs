'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const { EventEmitter } = require('node:events');
const { ReminderScheduler, cleanAlert } = require('../src/reminder-scheduler.cjs'); const { endpoint } = require('../src/policy.cjs');
const alert = { id: 'a'.repeat(64), taskId: 'task-1', title: '合成提醒', scheduledAt: '2026-10-09T03:00:00Z', kind: 'task' };
function setup({ outcome = 'show', supported = true } = {}) {
  const calls = [], notifications = [], events = [], opened = []; let mode = outcome, authAccount = 'account-a', failAck = false, gate = null, alerts = [alert];
  class Notification extends EventEmitter {
    static isSupported() { return supported; }
    constructor(options) { super(); this.options = options; notifications.push(this); }
    show() { if (mode === 'throw') throw new Error('Synthetic failure'); if (mode !== 'pending') queueMicrotask(() => this.emit(mode)); }
    close() { this.closed = true; this.emit('close'); }
  }
  const connection = endpoint('https://private.example/');
  const scheduler = new ReminderScheduler({ Notification, onEvent: value => events.push(value), onOpen: value => opened.push(value) });
  const fetch = async (url, options) => {
    const body = options.body && JSON.parse(options.body); calls.push({ url, options, body });
    if (gate) { const current = gate; gate = null; return await current; }
    if (url.endsWith('/api/auth/me')) return Response.json({ user: authAccount ? { userId: authAccount } : null, csrfToken: 'f'.repeat(64) });
    if (body.operation === 'ack') { if (failAck) throw new Error('Lost ack response'); return Response.json({ ok: true }); }
    return Response.json({ alerts, activeIds: [alert.id] });
  };
  scheduler.configure(connection, fetch); scheduler.bindAccount('account-a');
  return { scheduler, calls, notifications, events, opened, connection, fetch, setOutcome(value) { mode = value; }, setAuth(value) { authAccount = value; }, setAckFailure(value) { failAck = value; }, setGate(value) { gate = value; }, setAlerts(value) { alerts = value; } };
}
test('native scheduler works without a window, uses the selected session and acknowledges only after show', async () => {
  const f = setup({ outcome: 'pending' }); const pending = f.scheduler.check(); await new Promise(r => setImmediate(r));
  assert.equal(f.notifications.length, 1); assert.equal(f.calls.filter(c => c.body?.operation === 'ack').length, 0);
  f.notifications[0].emit('show'); await pending;
  const ack = f.calls.find(c => c.body?.operation === 'ack'); assert.ok(ack); assert.deepEqual(ack.body.ids, [alert.id]);
  for (const call of f.calls) { assert.equal(new URL(call.url).origin, f.connection.origin); assert.equal(call.options.credentials, 'include'); assert.equal(call.options.redirect, 'error'); if (call.body) { assert.equal(call.options.headers.Origin, f.connection.origin); assert.equal(call.options.headers['x-qingdan-expected-account'], 'account-a'); assert.match(call.options.headers['x-qingdan-csrf'], /^[a-f0-9]{64}$/); } }
  f.notifications[0].emit('click'); assert.equal(f.opened[0].taskId, alert.taskId); f.scheduler.cancel();
});
for (const outcome of ['failed', 'throw', 'close']) test(`native notification ${outcome} never acknowledges an undisplayed alert`, async () => {
  const f = setup({ outcome }); await f.scheduler.check(); assert.equal(f.calls.some(c => c.body?.operation === 'ack'), false); assert.equal(f.scheduler.ownsDelivery, false); assert.ok(f.events.some(e => e.type === 'runtime-status' && !e.notificationOwner)); f.scheduler.cancel();
});
test('account mismatch, logout and unsupported systems cannot claim reminders', async () => {
  for (const auth of [null, 'account-b']) { const f = setup(); f.setAuth(auth); await f.scheduler.check(); assert.equal(f.calls.length, 1); assert.equal(f.notifications.length, 0); assert.equal(f.scheduler.accountId, null); }
  const f = setup({ supported: false }); await f.scheduler.check(); assert.equal(f.calls.length, 0);
});
test('late old-origin response after switching is discarded and cannot write to the new service', async () => {
  const f = setup(); let resolve; f.setGate(new Promise(r => { resolve = r; })); const pending = f.scheduler.check();
  const other = endpoint('https://other.example/'); f.scheduler.configure(other, async () => { throw new Error('New server not authorized by old run'); }); f.scheduler.bindAccount('account-b');
  resolve(Response.json({ user: { userId: 'account-a' }, csrfToken: 'f'.repeat(64) })); await pending;
  assert.equal(f.calls.length, 1); assert.equal(f.notifications.length, 0); assert.equal(f.events.length, 0);
});
test('switching during pending native display closes it and suppresses late show/ack/click', async () => {
  const f = setup({ outcome: 'pending' }); const pending = f.scheduler.check(); await new Promise(r => setImmediate(r));
  f.scheduler.configure(endpoint('https://other.example/'), f.fetch); f.notifications[0].emit('show'); f.notifications[0].emit('click'); await pending;
  assert.equal(f.notifications[0].closed, true); assert.equal(f.calls.some(c => c.body?.operation === 'ack'), false); assert.equal(f.opened.length, 0);
});
test('lost acknowledgement retries without duplicate display, while snooze can display the same ID later', async () => {
  const f = setup(); f.setAckFailure(true); await f.scheduler.check(); f.setAckFailure(false); await f.scheduler.check(); assert.equal(f.notifications.length, 1);
  f.setAlerts([{ ...alert, scheduledAt: '2026-10-09T03:15:00Z' }]); await f.scheduler.check(); assert.equal(f.notifications.length, 2); f.scheduler.cancel();
});
test('local dismissal does not mutate the server and cannot dismiss another account', async () => {
  const f = setup(); await f.scheduler.check(); const before = f.calls.length;
  assert.equal(f.scheduler.forget('account-b', [alert.id]), false); assert.equal(f.scheduler.snapshot('account-a').alerts.length, 1);
  assert.equal(f.scheduler.forget('account-a', [alert.id]), true); assert.equal(f.scheduler.snapshot('account-a').alerts.length, 0); assert.equal(f.calls.length, before); assert.equal(f.notifications[0].closed, true); f.scheduler.cancel();
});
test('duplicate concurrent checks share no second auth or claim and invalid response data fails closed', async () => {
  const f = setup({ outcome: 'pending' }); const pending = f.scheduler.check(); await f.scheduler.check(); await new Promise(r => setImmediate(r)); assert.equal(f.notifications.length, 1); f.notifications[0].emit('show'); await pending; f.scheduler.cancel();
  assert.equal(cleanAlert({ ...alert, id: 'invalid' }), null); assert.equal(cleanAlert({ ...alert, title: 'x'.repeat(4001) }), null);
  const bad = setup(); bad.setAlerts([{ ...alert, taskId: '\0' }]); await bad.scheduler.check(); assert.equal(bad.notifications.length, 0); assert.equal(bad.calls.some(c => c.body?.operation === 'ack'), false);
});
test('a response already in flight cannot restore a locally dismissed delivered reminder', async () => {
  const f = setup(); await f.scheduler.check(); let release; f.setGate(new Promise(r => { release = r; })); const pending = f.scheduler.check();
  f.scheduler.forget('account-a', [alert.id]); release(Response.json({ user: { userId: 'account-a' }, csrfToken: 'f'.repeat(64) })); await pending;
  assert.equal(f.notifications.length, 1); assert.equal(f.scheduler.snapshot('account-a').alerts.length, 0);
  f.setAlerts([{ ...alert, scheduledAt: '2026-10-09T03:15:00Z' }]); await f.scheduler.check(); assert.equal(f.scheduler.snapshot('account-a').alerts.length, 1); f.scheduler.cancel();
});
