'use strict';
async function finalizeBundle(context) {
  await require('./finalize-mac-bundle.cjs')(context);
  await require('./finalize-linux-bundle.cjs')(context);
}
module.exports = finalizeBundle;
module.exports.default = finalizeBundle;
