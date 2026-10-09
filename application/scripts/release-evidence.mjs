import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const excludedSourceDirectories = new Set(['node_modules', 'dist', 'data', '.git', 'coverage']);
const sortedMap = entries => Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));

/** Include all regular source inputs, including documents, images and config. */
export async function sourceHashes(root) {
  const entries = [];
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (directory === root && excludedSourceDirectories.has(item.name)) continue;
      const path = resolve(directory, item.name);
      if (item.isDirectory()) await visit(path);
      else if (item.isFile()) {
        const name = relative(root, path).replaceAll('\\', '/');
        if (name === 'tests/standalone-evidence.json') continue;
        entries.push([name, createHash('sha256').update(await readFile(path)).digest('hex')]);
      }
    }
  }
  root = resolve(root);
  await visit(root);
  return sortedMap(entries);
}

/** Every built file is part of the evidence, regardless of extension. */
export async function artifactHashes(root) {
  const entries = [];
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) await visit(path);
      else if (item.isFile()) {
        const name = relative(root, path).replaceAll('\\', '/');
        entries.push([name, createHash('sha256').update(await readFile(path)).digest('hex')]);
      } else throw new Error('Build artifacts must be regular files: ' + path);
    }
  }
  await visit(resolve(root, 'dist'));
  return sortedMap(entries);
}
