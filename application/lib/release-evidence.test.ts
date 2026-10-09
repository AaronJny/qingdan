import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { artifactHashes, sourceHashes } from '../scripts/release-evidence.mjs';

test('source evidence includes every regular input and skips generated roots, evidence and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qingdan-source-evidence-'));
  const files = new Map([
    ['package.json', '{"version":"1.1.0"}'],
    ['README.md', 'Synthetic instructions'],
    ['Dockerfile', 'FROM synthetic-image'],
    ['.dockerignore', 'node_modules'],
    ['public/favicon.svg', '<svg></svg>'],
    ['public/app.webmanifest', '{"name":"Fixture"}'],
    ['server/main.ts', '// Synthetic server'],
  ]);
  try {
    for (const [name, text] of files) {
      await mkdir(dirname(join(root, name)), { recursive: true });
      await writeFile(join(root, name), text);
    }
    for (const name of ['node_modules/file.js', 'dist/client/index.html', 'data/private.sqlite', '.git/config', 'coverage/report.txt', 'tests/standalone-evidence.json']) {
      await mkdir(dirname(join(root, name)), { recursive: true });
      await writeFile(join(root, name), 'Excluded synthetic bytes');
    }
    if (process.platform !== 'win32') await symlink(join(root, 'package.json'), join(root, 'temporary-link.json'));
    const expected = Object.fromEntries([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([name, text]) => [name, createHash('sha256').update(text).digest('hex')]));
    assert.deepEqual(await sourceHashes(root), expected);
    assert.deepEqual(Object.keys(await sourceHashes(root)), [...files.keys()].sort());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('release evidence hashes every dist file with deterministic dist-relative keys and exact bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qingdan-release-evidence-'));
  const files = new Map([
    ['dist/server/main.mjs', new TextEncoder().encode('// synthetic server')],
    ['dist/client/assets/icon.svg', new TextEncoder().encode('<svg></svg>')],
    ['dist/client/index.html', new TextEncoder().encode('<main>Fixture</main>')],
    ['dist/client/assets/extensionless', new Uint8Array([0, 255, 128, 1])],
    ['dist/client/assets/app.js.map', new TextEncoder().encode('{"version":3}')],
  ]);
  try {
    for (const [name, bytes] of files) {
      await mkdir(dirname(join(root, name)), { recursive: true });
      await writeFile(join(root, name), bytes);
    }
    await writeFile(join(root, 'not-a-build-file.txt'), 'Do not include outside dist');
    const expected = Object.fromEntries([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]));
    assert.deepEqual(await artifactHashes(root), expected);
    assert.deepEqual(Object.keys(await artifactHashes(root)), [...files.keys()].sort());
    await writeFile(join(root, 'dist/client/assets/extensionless'), new Uint8Array([0, 255, 128, 2]));
    assert.notEqual((await artifactHashes(root))['dist/client/assets/extensionless'], expected['dist/client/assets/extensionless']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
