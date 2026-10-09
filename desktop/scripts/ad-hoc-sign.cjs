'use strict';
function adHocOptions(options) {
  return {
    ...options,
    identity: '-',
    identityValidation: false, // '-' is a local integrity signature, no certificate.
    keychain: undefined,
    provisioningProfile: undefined,
    preEmbedProvisioningProfile: false,
    preAutoEntitlements: false,
  };
}
async function signPreview(options) {
  if (process.platform !== 'darwin') throw new Error('Ad-hoc signing requires real macOS');
  const { signAsync } = await import('@electron/osx-sign');
  // Override any builder-discovered publisher identity. Local preview signing
  // must never use an existing Developer ID certificate or credential.
  await signAsync(adHocOptions(options));
}
module.exports = signPreview;
module.exports.adHocOptions = adHocOptions;
