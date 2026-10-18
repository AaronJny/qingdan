'use strict';
// Reproducible, non-executing check of the packaged archive and runtime fuses.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const { nativeAsarEntryPath } = require('./asar-entry-path.cjs');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
const root = path.resolve(__dirname, '..');
require('./verify-backend.cjs').verifyBackend(path.join(root, 'backend'), JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version);
const [executableArg, archiveArg, reportArg, ...flags] = process.argv.slice(2);
assert(flags.length === 0 || flags.length === 2 && flags[0] === '--arch' && ['arm64', 'x64'].includes(flags[1]), 'Expected --arch arm64|x64');
const arch = flags[1];
if (!executableArg || !archiveArg || !reportArg) throw Error('Usage: node scripts/verify-packaged.cjs executable app.asar report.json [--arch arm64|x64]');
const executable = path.resolve(executableArg), archive = path.resolve(archiveArg);
const isMac = path.basename(path.dirname(executable)) === 'MacOS';
assert.equal(Boolean(arch), isMac, 'An explicit architecture is required only for macOS packaged verification');
const nativeHost = isMac ? require('./assert-native-macos.cjs').assertNativeMac(arch) : undefined;
const macArchitecture = isMac ? require('./verify-mac-architecture.cjs').verifyMacArchitecture(path.resolve(executable, '../../..'), arch, archive) : undefined;
// This verifier runs after electron-builder has finalized/sign-sealed the app,
// and again against each extracted ZIP/read-only mounted DMG. Hash the actual
// final unpacked native file; ASAR metadata may still contain its pre-sign hash.
const finalRecoveryBinding = isMac ? require('./smoke-packaged-recovery.cjs').finalBindingEvidence(archive, 'darwin', arch) : undefined;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const extract = name => asar.extractFile(archive, nativeAsarEntryPath(name));
const same = name => assert(extract(name).equals(fs.readFileSync(path.join(root, name))), name + ' differs');
const sourceFiles = fs.readdirSync(path.join(root, 'src')).filter(n => fs.statSync(path.join(root, 'src', n)).isFile());
for (const name of sourceFiles) same('src/' + name);
const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const packagedPackage = JSON.parse(extract('package.json'));
// electron-builder removes build-only scripts/dependencies from the production package.
for (const key of ['name','productName','version','main','author','description','license','engines']) assert.deepEqual(packagedPackage[key], sourcePackage[key], 'package ' + key);
assert(!packagedPackage.devDependencies && !packagedPackage.scripts, 'build-only metadata must not ship');
same('backend/RUNTIME-MANIFEST.json'); same('backend/dependency-manifest.json');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'backend/RUNTIME-MANIFEST.json')));
let inputs = 0, embedded = 0;
for (const [name, hash] of Object.entries(manifest.files_sha256)) {
 assert.equal(sha(fs.readFileSync(path.join(root, 'backend', name))), hash, 'input ' + name); inputs++;
 if (name === 'package-lock.json') continue; // Builder deliberately excludes development lock metadata.
 assert.equal(sha(extract('backend/' + name)), hash, 'embedded ' + name); embedded++;
}
const deps = JSON.parse(fs.readFileSync(path.join(root, 'backend/dependency-manifest.json')));
let dependencyFiles = 0, omittedSourceMaps = 0, omittedTypeDeclarations = 0;
const dependencyMetadataStripped = [];
for (const pkg of deps.packages) for (const [name, hash] of Object.entries(pkg.files_sha256)) {
 assert.equal(sha(fs.readFileSync(path.join(root, 'backend', pkg.location || ('node_modules/' + pkg.name), name))), hash, 'dependency input');
 if (name.endsWith('.map')) { omittedSourceMaps++; continue; }
 if (name.endsWith('.d.ts')) { omittedTypeDeclarations++; continue; } // Builder default development-file exclusion.
 if (name === 'package.json') {
  const original = JSON.parse(fs.readFileSync(path.join(root, 'backend', pkg.location || ('node_modules/' + pkg.name), name)));
  const packaged = JSON.parse(extract('backend/' + (pkg.location || ('node_modules/' + pkg.name)) + '/' + name));
  for (const key of Object.keys(packaged)) assert.deepEqual(packaged[key], original[key], pkg.name + ' metadata ' + key);
  const removed = Object.keys(original).filter(key => !(key in packaged));
  for (const key of removed) assert(['scripts','keywords','contributors','bugs','devDependencies'].includes(key), 'unexpected metadata removal ' + key);
  dependencyMetadataStripped.push({name:pkg.name,removed}); dependencyFiles++; continue;
 }
 assert.equal(sha(extract('backend/' + (pkg.location || ('node_modules/' + pkg.name)) + '/' + name)), hash, 'dependency ' + pkg.name + '/' + name); dependencyFiles++;
}
const expected = { RunAsNode:false, EnableCookieEncryption:true, EnableNodeOptionsEnvironmentVariable:false, EnableNodeCliInspectArguments:false, EnableEmbeddedAsarIntegrityValidation:true, OnlyLoadAppFromAsar:true, GrantFileProtocolExtraPrivileges:false };
(async () => {
 const wire = await getCurrentFuseWire(executable);
 for (const [name, enabled] of Object.entries(expected)) assert.equal(wire[FuseV1Options[name]], enabled ? 49 : 48, name);
 const report = { ...(isMac ? { platform: 'mac', arch, nativeHost, macArchitecture, finalRecoveryBinding } : {}), version:JSON.parse(extract('package.json')).version, executableSha256:sha(fs.readFileSync(executable)), asarSha256:sha(fs.readFileSync(archive)), sourceFilesMatched:sourceFiles, backendVersion:manifest.version, backendSourceSnapshotSha256:manifest.source_snapshot_sha256, allBackendInputFilesMatched:inputs, embeddedBackendFilesMatched:embedded, buildMetadataExcluded:['package-lock.json'], dependencyPackages:deps.packages.map(p => ({name:p.name,version:p.version})), dependencyFilesMatched:dependencyFiles, dependencyMetadataStripped, omittedSourceMaps, omittedTypeDeclarations, fusesVerified:expected, nativeGuiTested:false };
 fs.writeFileSync(path.resolve(reportArg), JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report,null,2));
})().catch(error => { console.error(error); process.exitCode=1; });
