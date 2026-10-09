'use strict';
// Reproducible, non-executing check of the packaged archive and runtime fuses.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
const root = path.resolve(__dirname, '..');
const [executableArg, archiveArg, reportArg] = process.argv.slice(2);
if (!executableArg || !archiveArg || !reportArg) throw Error('Usage: node scripts/verify-packaged.cjs executable app.asar report.json');
const executable = path.resolve(executableArg), archive = path.resolve(archiveArg);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const extract = name => asar.extractFile(archive, name);
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
 assert.equal(sha(fs.readFileSync(path.join(root, 'backend/node_modules', pkg.name, name))), hash, 'dependency input');
 if (name.endsWith('.map')) { omittedSourceMaps++; continue; }
 if (name.endsWith('.d.ts')) { omittedTypeDeclarations++; continue; } // Builder default development-file exclusion.
 if (name === 'package.json') {
  const original = JSON.parse(fs.readFileSync(path.join(root, 'backend/node_modules', pkg.name, name)));
  const packaged = JSON.parse(extract('backend/node_modules/' + pkg.name + '/' + name));
  for (const key of Object.keys(packaged)) assert.deepEqual(packaged[key], original[key], pkg.name + ' metadata ' + key);
  const removed = Object.keys(original).filter(key => !(key in packaged));
  for (const key of removed) assert(['scripts','keywords','contributors','bugs','devDependencies'].includes(key), 'unexpected metadata removal ' + key);
  dependencyMetadataStripped.push({name:pkg.name,removed}); dependencyFiles++; continue;
 }
 assert.equal(sha(extract('backend/node_modules/' + pkg.name + '/' + name)), hash, 'dependency ' + pkg.name + '/' + name); dependencyFiles++;
}
const expected = { RunAsNode:false, EnableCookieEncryption:true, EnableNodeOptionsEnvironmentVariable:false, EnableNodeCliInspectArguments:false, EnableEmbeddedAsarIntegrityValidation:true, OnlyLoadAppFromAsar:true, GrantFileProtocolExtraPrivileges:false };
(async () => {
 const wire = await getCurrentFuseWire(executable);
 for (const [name, enabled] of Object.entries(expected)) assert.equal(wire[FuseV1Options[name]], enabled ? 49 : 48, name);
 const report = { version:JSON.parse(extract('package.json')).version, executableSha256:sha(fs.readFileSync(executable)), asarSha256:sha(fs.readFileSync(archive)), sourceFilesMatched:sourceFiles, backendSourceCommit:manifest.source_commit, allBackendInputFilesMatched:inputs, embeddedBackendFilesMatched:embedded, buildMetadataExcluded:['package-lock.json'], dependencyPackages:deps.packages.map(p => ({name:p.name,version:p.version})), dependencyFilesMatched:dependencyFiles, dependencyMetadataStripped, omittedSourceMaps, omittedTypeDeclarations, fusesVerified:expected, nativeGuiTested:false };
 fs.writeFileSync(path.resolve(reportArg), JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report,null,2));
})().catch(error => { console.error(error); process.exitCode=1; });
