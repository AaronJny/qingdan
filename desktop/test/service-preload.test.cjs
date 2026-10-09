'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { trustedServiceSender, endpoint } = require('../src/policy.cjs');
test('service preload exposes only fixed narrow actions and settings never forwards page-controlled arguments', async () => {
  let name, bridge; const calls = [];
  const electron = { contextBridge: { exposeInMainWorld(key, value) { name = key; bridge = value; } }, ipcRenderer: { invoke(...args) { calls.push(args); return Promise.resolve({ ok: true }); } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/service-preload.cjs'), 'utf8'), { require(id) { assert.equal(id, 'electron'); return electron; } });
  assert.equal(name, 'qingdanDesktop');
  assert.deepEqual(Object.keys(bridge).sort(), ['forgetReminders', 'getConnection', 'onRuntimeEvent', 'openConnectionSettings', 'runtimeReady']);
  assert.equal(Object.isFrozen(bridge), true);
  await bridge.getConnection({ arbitraryPath: '/private' }); await bridge.openConnectionSettings({ mode: 'server', serverUrl: 'https://attacker.example/' });
  assert.deepEqual(calls, [['qingdan-desktop:connection'], ['qingdan-desktop:open-settings']]);
});
test('only current top-level app page or bundled disconnected page can use service bridge', () => {
  const connection = endpoint('https://tasks.example/'); const frame = { url: connection.serverUrl }; const contents = { mainFrame: frame };
  const event = { sender: contents, senderFrame: frame };
  assert.equal(trustedServiceSender(event, contents, connection), true);
  for (const url of ['https://other.example/', 'qingdan-local://ui/settings', 'qingdan-local://ui/status.js', 'file:///tmp/a']) { frame.url = url; assert.equal(trustedServiceSender(event, contents, connection), false, url); }
  frame.url = 'qingdan-local://ui/status'; assert.equal(trustedServiceSender(event, contents, connection), true);
  assert.equal(trustedServiceSender({ ...event, senderFrame: { url: frame.url } }, contents, connection), false);
  assert.equal(trustedServiceSender(event, undefined, connection), false);
});
test('runtime listener never exposes ipc event objects, ignores unknown event names and unsubscribes its exact callback', () => {
  let bridge, receive, removed; const values = [];
  const electron = { contextBridge: { exposeInMainWorld(_key, value) { bridge = value; } }, ipcRenderer: { invoke() {}, on(channel, fn) { assert.equal(channel, 'qingdan-desktop:runtime-event'); receive = fn; }, removeListener(channel, fn) { removed = { channel, fn }; } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/service-preload.cjs'), 'utf8'), { require: () => electron });
  const stop = bridge.onRuntimeEvent(value => values.push(value)); const secretEvent = { sender: 'must-not-escape' };
  receive(secretEvent, { type: 'arbitrary-channel' }); receive(secretEvent, { type: 'quick-add' }); assert.deepEqual(values, [{ type: 'quick-add' }]); stop(); assert.equal(removed.fn, receive);
});
