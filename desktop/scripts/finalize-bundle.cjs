'use strict';
async function finalizeBundle(context) {
  require('./prepare-native-recovery.cjs').verifyNativeRecovery(context);
  await require('./finalize-mac-bundle.cjs')(context);
  await require('./finalize-linux-bundle.cjs')(context);
}
module.exports = finalizeBundle;
module.exports.default = finalizeBundle;
