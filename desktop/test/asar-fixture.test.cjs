'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { setImmediate } = require('node:timers/promises');
const { finished } = require('node:stream/promises');
const asar = require('@electron/asar');
const { createAsarFixture } = require('./fixtures/asar.cjs');

for (const fails of [false, true]) test(`ASAR fixtures ${fails ? 'reject a failed' : 'wait for the delayed'} final write`, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdan-asar-finish-'));
  const source = path.join(directory, 'source'), archive = path.join(directory, 'app.asar');
  const bytes = Buffer.from('ASAR fixture payload waiting for its final write');
  fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'last.txt'), bytes);
  const originalWrite = fs.write, originalCreate = asar.createPackageWithOptions;
  let output;
  const packageReturned = new Promise(resolve => {
    t.mock.method(asar, 'createPackageWithOptions', async (...args) => {
      output = await originalCreate(...args);
      resolve(); return output;
    });
  });
  let release;
  const delayed = new Promise(resolve => {
    t.mock.method(fs, 'write', function (fd, buffer, offset, length, position, callback) {
      if (!buffer.subarray(offset, offset + length).equals(bytes)) return originalWrite.apply(this, arguments);
      release = error => error ? callback(error) : originalWrite.call(fs, fd, buffer, offset, length, position, callback);
      resolve();
    });
  });
  let settled = false;
  const packed = createAsarFixture(source, archive);
  packed.then(() => { settled = true; }, () => { settled = true; });
  t.after(async () => {
    if (release) release();
    await packed.catch(() => {});
    if (output) await finished(output, { cleanup: true }).catch(() => {});
    asar.uncache(archive); fs.rmSync(directory, { recursive: true, force: true });
  });
  await delayed;
  await packageReturned;
  await setImmediate();
  assert.equal(settled, false, 'Packaging must not finish while the final write is pending');
  assert(!asar.extractFile(archive, 'last.txt').equals(bytes), 'The delayed write reproduces premature byte verification');
  const complete = release; release = null;
  if (fails) {
    const failure = new Error('Synthetic ASAR final write failure');
    complete(failure);
    await assert.rejects(packed, error => error === failure);
  } else {
    complete(); await packed;
    assert(asar.extractFile(archive, 'last.txt').equals(bytes));
  }
});
