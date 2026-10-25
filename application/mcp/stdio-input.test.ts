import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { createMcpInput } from './stdio-input.ts';

test('Windows Electron ignores its immutable EOF shim and opens only inherited fd 0', () => {
  const input = new PassThrough();
  const runtime = { platform: 'win32', versions: { electron: '44.6.0' }, get stdin(): never { throw new Error('The Electron EOF shim must never be used'); } };
  const open: NonNullable<Parameters<typeof createMcpInput>[1]> = (file, options) => {
    assert.equal(file, ''); assert.deepEqual(options, { fd: 0, autoClose: false });
    return input;
  };
  assert.equal(createMcpInput(runtime, open), input);
  input.destroy();
});

test('ordinary Node and non-Windows Electron retain their real process.stdin', () => {
  const stdin = new PassThrough();
  const unexpected = () => { throw new Error('Must not open another input'); };
  for (const runtime of [
    { platform: 'win32', versions: {}, stdin },
    { platform: 'linux', versions: { electron: '44.6.0' }, stdin },
    { platform: 'darwin', versions: { electron: '44.6.0' }, stdin },
  ]) assert.equal(createMcpInput(runtime, unexpected), stdin);
  stdin.destroy();
});
