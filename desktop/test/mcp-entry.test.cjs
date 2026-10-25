'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/entry.cjs'), 'utf8');
test('desktop entry keeps normal GUI path and package points to dispatcher', () => {
  const loaded = [];
  vm.runInNewContext(source, {process: {argv: ['qingdan']}, require: value => loaded.push(value)});
  assert.deepEqual(loaded, ['./main.cjs']);
  assert.equal(require('../package.json').main, 'src/entry.cjs');
});
test('MCP dispatch branch does not import GUI or touch user profile', () => {
  const prefix = source.slice(0, source.indexOf('  import('));
  const loaded = [], hooks = [];
  const fake = {argv: ['qingdan', '--mcp', '--descriptor', '/fictional/private.json'], execPath: '/fixture/qingdan', stdin: {once: (...args) => hooks.push(args[0])}, once: (...args) => hooks.push(args[0])};
  vm.runInNewContext(prefix + '\n}', {process: fake, __dirname: '/fixture/src', require: value => {loaded.push(value); if(value === 'electron') return {app: {exit() {}}}; return require(value);}});
  assert.deepEqual(Array.from(fake.argv), ['/fixture/qingdan', 'qingdan-mcp', '--descriptor', '/fictional/private.json']);
  assert(!loaded.includes('./main.cjs')); assert.deepEqual(hooks, ['SIGINT','SIGTERM']);
  assert(!source.includes('process.stdin'), 'EOF must use the adapter-selected input, not Electron\'s Windows EOF shim');
});

test('MCP entry watches the selected input and exits once on EOF or close', () => {
  const { EventEmitter } = require('node:events');
  const input = new EventEmitter(), exits = [];
  const prefix = source.slice(0, source.indexOf('  import('));
  const ready = source.slice(source.indexOf('    .then(({ mcpInput }) => {') + '    .then('.length, source.indexOf('\n    .catch(')).replace(/\)$/, '');
  const context = { process: { argv: ['qingdan', '--mcp'], execPath: '/fixture/qingdan', once() {} },
    __dirname: '/fixture/src', input,
    require: value => value === 'electron' ? { app: { exit: code => exits.push(code) } } : require(value) };
  vm.runInNewContext(prefix + '\n(' + ready + ')({ mcpInput: input });\n}', context);
  input.emit('end'); input.emit('close');
  assert.deepEqual(exits, [0]);
});
