import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '..');
const groups = ['core', 'ui-primary', 'ui-secondary', 'domain'];
const en = {}, zh = {};
const parameters = value => [...new Set(value.match(/\{[a-zA-Z0-9_]+\}/g) || [])].sort();
for (const group of groups) {
  const a = JSON.parse(readFileSync(resolve(root, `lib/locales/${group}.en.json`), 'utf8'));
  const b = JSON.parse(readFileSync(resolve(root, `lib/locales/${group}.zh.json`), 'utf8'));
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `Locale keys differ in ${group}`);
  for (const key of Object.keys(a)) {
    assert.ok(!Object.hasOwn(en, key), `Duplicate message key: ${key}`);
    assert.ok(a[key].trim() && b[key].trim(), `Empty message: ${key}`);
    assert.deepEqual(parameters(a[key]), parameters(b[key]), `Interpolation differs: ${key}`);
  }
  Object.assign(en, a); Object.assign(zh, b);
}
let calls = 0;
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'api') scan(path); continue; }
    if (!/\.tsx$/.test(path)) continue;
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const aliases = new Set();
    for (const statement of source.statements) if (ts.isImportDeclaration(statement) && /\/i18n$/.test(statement.moduleSpecifier.text)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) if ((item.propertyName?.text || item.name.text) === 't') aliases.add(item.name.text);
    }
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && aliases.has(node.expression.text) && node.arguments.length && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text;
        assert.ok(Object.hasOwn(en, key), `Undeclared interface key ${key} in ${relative(root, path)}`); calls++;
      }
      if (ts.isJsxText(node) && /\p{Script=Han}/u.test(node.text) && node.text.trim() !== '简体中文') throw Error(`Unlocalized JSX in ${relative(root, path)}: ${node.text.trim()}`);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
for (const directory of ['app', 'web', 'offline']) if (existsSync(resolve(root, directory))) scan(resolve(root, directory));
const android = resolve(root, '../android/webapp');
if (existsSync(android)) for (const path of ['lib/i18n.ts', 'lib/i18n-react.tsx', 'lib/i18next.d.ts', ...groups.flatMap(group => [`lib/locales/${group}.en.json`, `lib/locales/${group}.zh.json`])]) assert.equal(readFileSync(resolve(root, path), 'utf8'), readFileSync(resolve(android, path), 'utf8'), `Android locale resources drifted: ${path}`);
console.log(`Localization verified: ${Object.keys(en).length} messages, ${calls} explicit UI call sites, matching locales and shared runtime.`);
