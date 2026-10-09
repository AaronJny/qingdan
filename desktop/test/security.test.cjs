'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const { EventEmitter } = require('node:events');
const { endpoint } = require('../src/policy.cjs'); const { installServiceSession, installLocalSession, installContentsSecurity, installSettingsContents } = require('../src/security.cjs');
const connection = endpoint('http://127.0.0.1:4310/');
function event(extra = {}) { return { ...extra, prevented: false, preventDefault() { this.prevented = true; } }; }
function session() { const value = new EventEmitter(); value.setPermissionRequestHandler = fn => { value.permission = fn; }; value.setPermissionCheckHandler = fn => { value.check = fn; }; value.setDevicePermissionHandler = fn => { value.device = fn; }; value.webRequest = { onBeforeRequest(fn) { value.request = fn; } }; return value; }
function allowed(value, url, resourceType = 'script') { let result; value.request({ url, resourceType }, answer => { result = !answer.cancel; }); return result; }
test('service session permits exact loopback resources, blocks unrelated HTTPS/HTTP/WS and settings page', () => {
  const value = session(); installServiceSession(value, connection);
  assert.equal(allowed(value, 'http://127.0.0.1:4310/api/auth/me'), true);
  assert.equal(allowed(value, 'qingdan-local://ui/status', 'mainFrame'), true);
  for (const url of ['https://cdn.example/app.js', 'http://127.0.0.1:4311/', 'http://localhost:4310/', 'ws://127.0.0.1:4310/', 'wss://server/', 'file:///tmp/a', 'qingdan-local://ui/settings', 'qingdan-local://ui/settings.js']) assert.equal(allowed(value, url), false, url);
  assert.equal(allowed(value, 'blob:http://127.0.0.1:4310/id', 'other'), true);
  assert.equal(allowed(value, 'blob:http://127.0.0.1:4310/id', 'mainFrame'), false);
  assert.equal(allowed(value, 'data:image/png;base64,AAA', 'image'), true);
  assert.equal(allowed(value, 'data:text/javascript,alert(1)', 'script'), false);
  assert.equal(value.check(), false);
});
test('local settings session can only load bundled assets and cannot download', () => {
  const value = session(); installLocalSession(value);
  assert.equal(allowed(value, 'qingdan-local://ui/settings', 'mainFrame'), true);
  assert.equal(allowed(value, 'qingdan-local://ui/settings.js'), true);
  for (const url of [connection.serverUrl, 'https://server/', 'file:///tmp/a', 'qingdan-local://ui/status']) assert.equal(allowed(value, url), false);
  const e = event(); value.emit('will-download', e); assert.equal(e.prevented, true);
});
test('downloads require current server initiator and exact same-origin chain with user save dialog', () => {
  const value = session(); installServiceSession(value, connection); let options;
  const item = { getInitiatorOrigin: () => connection.origin, getURLChain: () => ['http://127.0.0.1:4310/api/export'], getFilename: () => 'tasks.json', setSaveDialogOptions: value => { options = value; } };
  const e = event(); value.emit('will-download', e, item); assert.equal(e.prevented, false); assert.equal(options.defaultPath, 'tasks.json');
  const other = event(); value.emit('will-download', other, { ...item, getURLChain: () => ['https://other.example/tasks.json'] }); assert.equal(other.prevented, true);
  const source = event(); value.emit('will-download', source, { ...item, getInitiatorOrigin: () => 'null' }); assert.equal(source.prevented, true);
});
test('remote navigation cannot reach settings IPC page; external links require separate confirmation', () => {
  const contents = new EventEmitter(); contents.setWindowOpenHandler = fn => { contents.open = fn; }; const outside = []; let blocked = 0;
  installContentsSecurity(contents, connection, { popupOptions: () => ({ secure: true }), canOpenPopup: () => true, onPopupCreated() {}, confirmExternal: value => outside.push(value), onBlocked: () => blocked++ });
  const config = event({ url: 'qingdan-local://ui/settings', isMainFrame: true }); contents.emit('will-navigate', config); assert.equal(config.prevented, true); assert.equal(blocked, 1);
  const iframe = event({ url: 'https://other.example/', isMainFrame: false }); contents.emit('will-frame-navigate', iframe); assert.equal(iframe.prevented, true); assert.equal(outside.length, 0);
  assert.equal(contents.open({ url: connection.serverUrl }).action, 'allow');
  assert.equal(contents.open({ url: 'https://other.example/' }).action, 'deny'); assert.equal(outside.length, 1);
});
test('settings page cannot navigate or open new windows/webviews', () => {
  const contents = new EventEmitter(); contents.setWindowOpenHandler = fn => { contents.open = fn; }; installSettingsContents(contents);
  const e = event(); contents.emit('will-navigate', e); assert.equal(e.prevented, true); assert.deepEqual(contents.open({ url: connection.serverUrl }), { action: 'deny' });
});
