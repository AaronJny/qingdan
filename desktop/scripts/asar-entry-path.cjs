'use strict';
const path = require('node:path');
const assert = require('node:assert/strict');
// Manifest paths are portable POSIX names. @electron/asar walks directory
// components using host path.sep, including on Windows. Keep the same entry
// components while converting only their separators at the extraction boundary.
function nativeAsarEntryPath(name, hostPath = path) {
  assert(typeof name === 'string' && name.length && !/[\\:\0]/.test(name), 'Invalid ASAR entry path');
  const components = name.split('/');
  assert(components.every(component => component && component !== '.' && component !== '..'), 'ASAR entry path must be a safe relative POSIX path');
  return components.join(hostPath.sep);
}
module.exports = { nativeAsarEntryPath };
