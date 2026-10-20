'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { css } = require('../src/local-pages.cjs');
const { menuTemplate } = require('../src/menu.cjs');
const { locales, initialize, resources } = require('../src/language.cjs');

test('removed legacy review has no shipped page, script, preload, menu entry or UI translations',()=>{
 for(const file of ['local-recovery-page.cjs','local-recovery-preload.cjs','recovery.js'])assert.equal(fs.existsSync(path.join(__dirname,'../src',file)),false,file);
 for(const locale of locales){
  initialize('/nonexistent/qingdan-language',locale);
  const dictionary=resources[locale].translation;
  assert.deepEqual(Object.keys(dictionary).filter(key=>key.startsWith('desktop.recovery.')),['desktop.recovery.storage.failed']);
  const labels=menuTemplate({platform:'win32',packaged:true}).flatMap(group=>group.submenu||[]).map(item=>item.label).filter(Boolean);
  assert.ok(labels.every(label=>!label.includes('desktop.recovery.')));
 }
 initialize('/nonexistent/qingdan-language','zh-CN');
 assert.ok(!menuTemplate({platform:'darwin',packaged:true}).flatMap(group=>group.submenu||[]).some(item=>item.label==='核对旧版输入'));
});

test('native hidden controls retain shared display override',()=>{
 assert.match(css,/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/);
});
