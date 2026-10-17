import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { bundledLicenses } from './license-plugin.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'qingdan-licenses-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function packageFixture(root, directory, name, version, notices = { LICENSE: 'Copyright fixture authors\nMIT fixture notice\n' }) {
  const path = join(root, 'node_modules', directory);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'package.json'), JSON.stringify({ name, version, license: 'MIT', main: 'index.js' }));
  await writeFile(join(path, 'index.js'), 'export const value = 42;\n');
  for (const [file, text] of Object.entries(notices)) await writeFile(join(path, file), text);
  return join(path, 'index.js');
}

function generate(ids, options) {
  const files = new Map();
  bundledLicenses(options).generateBundle.call({
    emitFile(file) { files.set(file.fileName, file.source); },
    getModuleIds() { return ids.values(); },
  });
  return files;
}

test('retains upstream notices, scoped packages and multiple versions deterministically', async t => {
  const root = await fixture(t);
  const first = await packageFixture(root, 'example', 'example', '1.0.0');
  const nested = await packageFixture(root, 'other/node_modules/example', 'example', '2.0.0');
  const scoped = await packageFixture(root, '@fixture/example', '@fixture/example', '3.0.0', {
    'NOTICE.txt': 'Additional upstream notice\n',
    'LICENCE.md': 'Scoped package copyright\nPermissive fixture license\n',
  });
  const files = generate([nested, first, scoped.replaceAll('/', '\\') + '?commonjs', first, join(root, 'app.js')]);
  const versions = JSON.parse(files.get('assets/licenses/WEB-DEPENDENCY-VERSIONS.json'));
  assert.deepEqual(versions.map(({ name, version }) => [name, version]), [
    ['@fixture/example', '3.0.0'], ['example', '1.0.0'], ['example', '2.0.0'],
  ]);
  assert.deepEqual(versions[0].noticeFiles, ['LICENCE.md', 'NOTICE.txt']);
  const text = files.get('assets/licenses/WEB-DEPENDENCY-LICENSES.txt');
  assert.match(text, /Scoped package copyright\nPermissive fixture license/);
  assert.match(text, /Additional upstream notice/);
  assert.match(text, /Copyright fixture authors\nMIT fixture notice/);
  assert.deepEqual(generate([scoped, first, nested]), files);
});

test('provides the precise ical.js source archive together with its license', async t => {
  const root = await fixture(t);
  const id = await packageFixture(root, 'ical.js', 'ical.js', '2.2.1', { LICENSE: 'Mozilla Public License Version 2.0\n' });
  await writeFile(join(root, 'node_modules/ical.js/package.json'), JSON.stringify({ name: 'ical.js', version: '2.2.1', license: 'MPL-2.0' }));
  const files = generate([id]);
  const [{ sourceArchive }] = JSON.parse(files.get('assets/licenses/WEB-DEPENDENCY-VERSIONS.json'));
  assert.equal(sourceArchive, 'https://registry.npmjs.org/ical.js/-/ical.js-2.2.1.tgz');
  assert.match(files.get('assets/licenses/WEB-DEPENDENCY-LICENSES.txt'), /Source Code Form.*lib\/ical\/.*https:\/\/registry\.npmjs\.org\/ical\.js\/-\/ical\.js-2\.2\.1\.tgz/);
  assert.match(files.get('assets/licenses/WEB-DEPENDENCY-LICENSES.txt'), /Mozilla Public License Version 2\.0/);
  assert.equal(
    await readFile(new URL('../docs/licenses/ical.js-MPL-2.0.txt', import.meta.url), 'utf8'),
    await readFile(new URL('../node_modules/ical.js/LICENSE', import.meta.url), 'utf8'),
  );
});

test('fails closed when a bundled package omits a license notice or includes an empty one', async t => {
  const root = await fixture(t);
  for (const [name, notices] of [['missing', {}], ['empty', { LICENSE: '\n' }]]) {
    const id = await packageFixture(root, name, name, '1.0.0', notices);
    assert.throws(() => generate([id]), new RegExp(`Missing license notice for bundled package ${name}@1\\.0\\.0`));
  }
});

test('Vite emits notices in both regular and separate offline-asset layouts', async t => {
  const root = await fixture(t);
  await packageFixture(root, '@fixture/bundled', '@fixture/bundled', '1.2.3');
  await packageFixture(root, 'unused', 'unused', '9.9.9');
  await writeFile(join(root, 'index.html'), '<script type="module" src="/entry.js"></script>');
  await writeFile(join(root, 'entry.js'), "import { value } from '@fixture/bundled'; console.log(value);");
  for (const noticeDirectory of ['assets/licenses', 'offline-assets']) {
    const result = await build({
      configFile: false, root, logLevel: 'silent', plugins: [bundledLicenses({ noticeDirectory })],
      build: { write: false, minify: true },
    });
    assert.ok(!Array.isArray(result));
    const output = new Map(result.output.filter(item => item.type === 'asset').map(item => [item.fileName, item.source]));
    assert.deepEqual(JSON.parse(output.get(`${noticeDirectory}/WEB-DEPENDENCY-VERSIONS.json`)).map(p => `${p.name}@${p.version}`), ['@fixture/bundled@1.2.3']);
    assert.match(output.get(`${noticeDirectory}/WEB-DEPENDENCY-LICENSES.txt`), /Copyright fixture authors\nMIT fixture notice/);
  }
});

test('offline build copies and hash-verifies notices with the MIME types served by the app', async t => {
  const root = await fixture(t);
  await packageFixture(root, '@fixture/bundled', '@fixture/bundled', '1.2.3');
  await mkdir(join(root, 'offline'));
  await mkdir(join(root, 'public'));
  await writeFile(join(root, 'offline/index.html'), '<script type="module" src="./entry.js"></script>');
  await writeFile(join(root, 'offline/entry.js'), "import { value } from '@fixture/bundled'; console.log(value);");
  await writeFile(join(root, 'offline/worker.js'), '/* Synthetic offline worker fixture. */');
  await writeFile(join(root, 'public/favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const projectLicense = 'Synthetic project license fixture.\n';
  await writeFile(join(root, 'LICENSE'), projectLicense);
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./build-offline.mjs', import.meta.url))], { cwd: root });
  const output = join(root, 'dist/client');
  const manifest = JSON.parse(await readFile(join(output, 'offline-shell-manifest.json'), 'utf8'));
  assert.equal(await readFile(join(output, 'LICENSE.txt'), 'utf8'), projectLicense);
  const projectLicenseResource = manifest.resources.find(item => item.url === '/LICENSE.txt');
  assert.ok(projectLicenseResource, 'Project license must remain available in the offline cache');
  assert.equal(projectLicenseResource.sha256, createHash('sha256').update(projectLicense).digest('hex'));
  for (const [name, mime] of [['WEB-DEPENDENCY-LICENSES.txt', 'application/octet-stream'], ['WEB-DEPENDENCY-VERSIONS.json', 'application/json']]) {
    const url = `/offline-assets/${name}`;
    const bytes = await readFile(join(output, url));
    const resource = manifest.resources.find(item => item.url === url);
    assert.ok(resource, `Offline cache manifest must include ${name}`);
    assert.equal(resource.mime, mime);
    assert.equal(resource.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  const versions = JSON.parse(await readFile(join(output, 'offline-assets/WEB-DEPENDENCY-VERSIONS.json'), 'utf8'));
  assert.deepEqual(versions.map(p => `${p.name}@${p.version}`), ['@fixture/bundled@1.2.3']);
});
