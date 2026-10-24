'use strict';
const asar = require('@electron/asar');
const { finished } = require('node:stream/promises');

async function createAsarFixture(source, archive, options = {}) {
  // @electron/asar 3.x resolves with the WriteStream after end(), not after
  // its pending file writes finish. Readers and cleanup must wait for close.
  const output = await asar.createPackageWithOptions(source, archive, options);
  await finished(output, { cleanup: true });
  asar.uncache(archive);
}

module.exports = { createAsarFixture };
