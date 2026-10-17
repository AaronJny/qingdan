'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '../..');
const read = path => readFileSync(resolve(root, path), 'utf8');

test('web and Android use the existing green clipboard identity', () => {
  const icon = read('application/public/favicon.svg');
  assert.equal(read('android/webapp/public/favicon.svg'), icon);
  assert.match(icon, /viewBox="0 0 1024 1024"/);
  assert.equal((icon.match(/<circle /g) || []).length, 3);
  for (const color of ['#276455', '#f7f7f0', '#a9c7a5']) {
    assert.ok(icon.includes(color), color);
    assert.ok(read('android/android/app/src/main/res/drawable/ic_qingdan.xml').includes(color), color);
  }
  const native = read('android/android/app/src/main/res/drawable/ic_qingdan.xml');
  assert.equal((native.match(/<path /g) || []).length, 9);
  assert.match(native, /android:viewportWidth="1024" android:viewportHeight="1024"/);
  for (const project of ['application', 'android/webapp']) {
    assert.equal(JSON.parse(read(project + '/public/manifest.webmanifest')).theme_color, '#276455');
    for (const file of ['web/app.tsx', 'app/workspace.tsx']) {
      const source = read(project + '/' + file);
      assert.match(source, /<img src="\/favicon.svg" alt="" aria-hidden="true"\/>/);
      assert.ok(!source.includes('>✓</'), file);
    }
    assert.match(read(project + '/app/globals.css'), /\.brand-logo img\{display:block;width:100%;height:100%\}/);
    for (const file of ['file.svg', 'globe.svg', 'window.svg']) {
      assert.equal(existsSync(resolve(root, project, 'public', file)), false, file);
    }
  }
  assert.doesNotMatch(read('android/webapp/app/workspace-dialogs.tsx'), /能力与边界|没有用于展示的假同步/);
});
