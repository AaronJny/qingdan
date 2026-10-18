'use strict';
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : entry.isFile() ? [file] : [];
  });
}
for (const folder of ['src', 'scripts', 'test']) for (const file of files(path.join(root, folder))) if (/\.(?:cjs|mjs|js)$/.test(file)) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status) process.exit(result.status);
}
require('../src/policy.cjs').validateDefaults(require('../src/defaults.json'));
for (const file of files(path.join(root, 'src'))) {
  const text = fs.readFileSync(file, 'utf8');
  if (/chatgpt\.site|auth\.openai\.com|signin-with-chatgpt|qingdan-cloud-v1/.test(text)) throw Error('Unexpected old platform runtime binding');
}
const { locales } = require('../src/language-policy.cjs');
const baseline = require('../src/translations.cjs');
const keys = Object.keys(baseline).sort();
const parameters = value => [...new Set(value.match(/\{\{[a-zA-Z0-9_]+\}\}/g) || [])].sort().join(',');
for (const locale of locales.filter(locale => !['zh-CN', 'en'].includes(locale))) {
  const dictionary = require(`../src/locales/${locale}.json`);
  if (JSON.stringify(Object.keys(dictionary).sort()) !== JSON.stringify(keys)) throw Error(`Incomplete native dictionary: ${locale}`);
  for (const key of keys) if (typeof dictionary[key] !== 'string' || !dictionary[key].trim() || parameters(dictionary[key]) !== parameters(baseline[key].en)) throw Error(`Invalid native message: ${locale}:${key}`);
}
console.log('v3 syntax/defaults/no-platform/nine-locale checks pass');
