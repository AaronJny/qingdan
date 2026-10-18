'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

/** Deterministic source paths, including nested native dictionaries. Never follow links. */
function sourceFiles(directory, prefix = '') {
  const directoryStat = fs.lstatSync(directory);
  assert(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(), 'Source directory must be a real directory: ' + directory);
  const result = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const absolute = path.join(directory, name);
    const relative = prefix ? prefix + '/' + name : name;
    const stat = fs.lstatSync(absolute);
    assert(!stat.isSymbolicLink(), 'Source symlink is not allowed: ' + relative);
    if (stat.isDirectory()) result.push(...sourceFiles(absolute, relative));
    else { assert(stat.isFile(), 'Non-regular source entry: ' + relative); result.push(relative); }
  }
  return result;
}
function verifyPackagedSources(root, extract) {
  const files = sourceFiles(path.join(root, 'src'));
  for (const name of files) {
    const packaged = extract('src/' + name);
    const source = fs.readFileSync(path.join(root, 'src', ...name.split('/')));
    assert(Buffer.isBuffer(packaged) && packaged.equals(source), 'src/' + name + ' differs');
  }
  return files;
}
module.exports = { sourceFiles, verifyPackagedSources };
