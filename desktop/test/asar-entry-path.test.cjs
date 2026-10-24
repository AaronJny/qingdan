'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const asar = require('@electron/asar');
const { createAsarFixture } = require('./fixtures/asar.cjs');
const { nativeAsarEntryPath } = require('../scripts/asar-entry-path.cjs');

test('ASAR entry conversion preserves exact components on POSIX and Windows', () => {
  const name = 'backend/node_modules/@js-temporal/polyfill/dist/index.cjs';
  assert.equal(nativeAsarEntryPath(name, path.posix), name);
  assert.equal(nativeAsarEntryPath(name, path.win32), 'backend\\node_modules\\@js-temporal\\polyfill\\dist\\index.cjs');
  assert.equal(nativeAsarEntryPath('package.json', path.win32), 'package.json');
  assert.equal(nativeAsarEntryPath('build/icon.png', path.win32), 'build\\icon.png');
  for (const unsafe of ['', '/absolute', '../outside', 'backend/../outside', 'backend//file', './file', 'backend\\file', 'C:/file', 'backend/\0file']) {
    assert.throws(() => nativeAsarEntryPath(unsafe, path.win32));
  }
});

test('real ASAR deeply nested frontend/dependency entries extract with host paths and injected win32 lookup', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-asar-entry-'));
  t.after(() => { asar.uncacheAll(); fs.rmSync(directory, { recursive: true, force: true }); });
  const source = path.join(directory, 'source'), archive = path.join(directory, 'fixture.asar');
  const files = {
    'package.json': Buffer.from('{"version":"1.2.3"}'),
    'src/main.cjs': Buffer.from('// shallow source fixture'),
    'backend/dist/client/assets/index-fixture.js': Buffer.from('// deep frontend fixture'),
    'backend/node_modules/@js-temporal/polyfill/dist/index.cjs': Buffer.from('// deeply nested dependency fixture'),
    'backend/drizzle/meta/_journal.json': Buffer.from('{"fixture":true}'),
    'build/icon.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  };
  for (const [name, bytes] of Object.entries(files)) {
    const file = path.join(source, ...name.split('/')); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
  }
  await createAsarFixture(source, archive);
  for (const [name, bytes] of Object.entries(files)) assert(asar.extractFile(archive, nativeAsarEntryPath(name)).equals(bytes), name);
  const header = asar.getRawHeader(archive).header;
  // Reproduce @electron/asar's public-entry lookup semantics with injected
  // Windows dirname/basename/sep against the actual packed archive header.
  // This catches the original defect even when tests execute on Linux/macOS.
  const win32Lookup = filename => {
    let directory = header;
    for (const component of path.win32.dirname(filename).split(path.win32.sep)) {
      if (component === '.') continue;
      directory = directory?.files?.[component];
      assert(directory, 'ASAR directory missing for Windows lookup: ' + filename);
    }
    const entry = directory.files?.[path.win32.basename(filename)];
    assert(entry, 'ASAR entry missing for Windows lookup: ' + filename);
    return entry;
  };
  const deep = 'backend/dist/client/assets/index-fixture.js';
  assert.throws(() => win32Lookup(deep), /ASAR directory missing/);
  // A one-level directory already worked with Windows dirname, explaining why
  // src/main.cjs passed before the deep backend snapshot check failed.
  assert.equal(win32Lookup('src/main.cjs').size, files['src/main.cjs'].length);
  for (const [name, bytes] of Object.entries(files)) {
    const nativeName = nativeAsarEntryPath(name, path.win32), metadata = win32Lookup(nativeName);
    assert.equal(metadata.size, bytes.length, name);
    const hostName = nativeName.split(path.win32.sep).join(path.sep);
    assert(asar.extractFile(archive, hostName).equals(bytes), 'Windows-normalized entry bytes: ' + name);
  }
});
