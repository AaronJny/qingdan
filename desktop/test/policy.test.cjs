'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { validateServerUrl, endpoint, isServiceUrl, isLocalUiUrl, isStatusUrl, isSettingsResource, safeExternalUrl, trustedSettingsSender } = require('../src/policy.cjs');
test('default and explicit literal loopback HTTP endpoints are accepted', () => {
  for (const value of ['http://127.0.0.1:4310/', 'http://localhost:4310', 'http://[::1]:4310/']) assert.ok(validateServerUrl(value).endsWith('/'));
});
test('explicit valid HTTPS private origins and non-default ports are accepted', () => {
  for (const value of ['https://192.168.10.5:8443/', 'https://tasks.lan/', 'https://private.example.com/', 'https://[fd00::1]:8443/']) assert.equal(validateServerUrl(value), value);
});
test('connection addresses never contain credentials, tokens, fragments, unsafe schemes or non-loopback HTTP', () => {
  for (const value of ['http://192.168.1.2:4310/', 'http://0.0.0.0:4310/', 'http://localhost.attacker.net/', 'http://evil.localhost/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'https://user:password@tasks.example/', 'https://tasks.example/?token=x', 'https://tasks.example/#token', 'https://tasks.example/path', 'https://tasks.example:0/', 'https://tasks.example\\@evil.net/', ' https://tasks.example/']) assert.throws(() => validateServerUrl(value), undefined, value);
});
test('all service resources and navigation are scoped to exact origin and port', () => {
  const connection = endpoint('http://127.0.0.1:4310/');
  assert.equal(isServiceUrl('http://127.0.0.1:4310/api/tasks?q=x', connection), true);
  assert.equal(isServiceUrl('http://127.0.0.1:4310/login', connection), true);
  for (const value of ['http://127.0.0.1:4311/', 'http://localhost:4310/', 'https://127.0.0.1:4310/', 'http://user:secret@127.0.0.1:4310/', 'http://127.0.0.1:4310/%00', 'http://127.0.0.1:4310/%2fsecret']) assert.equal(isServiceUrl(value, connection), false, value);
});
test('each origin gets a distinct persistent partition and auth mode is not inferred from loopback', () => {
  const first = endpoint('http://127.0.0.1:4310/');
  assert.equal(first.partition, endpoint('http://127.0.0.1:4310/').partition);
  assert.notEqual(first.partition, endpoint('http://localhost:4310/').partition);
  assert.notEqual(first.partition, endpoint('https://tasks.example/').partition);
  assert.equal('mode' in first, false); assert.equal('password' in first, false);
});
test('local UI pages have no arbitrary file/query/sibling endpoint access', () => {
  assert.equal(isLocalUiUrl('qingdan-local://ui/settings', 'settings'), true);
  assert.equal(isStatusUrl('qingdan-local://ui/status'), true);
  assert.equal(isSettingsResource('qingdan-local://ui/settings.js'), true);
  for (const value of ['qingdan-local://evil/settings', 'qingdan-local://ui/settings?server=http://evil', 'qingdan-local://ui/../../secret', 'qingdan-local://ui/settings#x']) assert.equal(isLocalUiUrl(value, 'settings'), false);
});
test('only a fixed local settings main frame and exact native contents can use IPC', () => {
  const frame = { url: 'qingdan-local://ui/settings' }; const contents = { mainFrame: frame };
  assert.equal(trustedSettingsSender({ sender: contents, senderFrame: frame }, contents), true);
  assert.equal(trustedSettingsSender({ sender: {}, senderFrame: frame }, contents), false);
  assert.equal(trustedSettingsSender({ sender: contents, senderFrame: { url: frame.url } }, contents), false);
  frame.url = 'http://127.0.0.1:4310/'; assert.equal(trustedSettingsSender({ sender: contents, senderFrame: frame }, contents), false);
  assert.equal(trustedSettingsSender({}, undefined), false);
});
test('external browser opener validates protocol before a native confirmation', () => {
  assert.equal(safeExternalUrl('https://example.com/path?q=x'), 'https://example.com/path?q=x');
  assert.equal(safeExternalUrl('http://127.0.0.1:4310/'), 'http://127.0.0.1:4310/');
  for (const value of ['file:///tmp/a.exe', 'ms-settings:', 'javascript:alert(1)', 'http://private.lan/', 'https://u:p@server/']) assert.equal(safeExternalUrl(value), null);
});

test('raw config requires literal authority/root syntax before URL canonicalization', () => {
  for (const value of ['http:127.0.0.1:4310', 'http:///127.0.0.1:4310', 'http://2130706433:4310/', 'http://0x7f000001:4310/', 'http://127.1:4310/', 'http://%6cocalhost:4310/', 'http://127.0.0.1:4310/a/../', 'http://127.0.0.1:4310/%2e%2e/', 'http://127.0.0.1:4310/?', 'http://127.0.0.1:4310/#', 'http://@127.0.0.1:4310/']) assert.throws(() => validateServerUrl(value), undefined, value);
});
