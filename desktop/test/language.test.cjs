'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const language = require('../src/language.cjs'); const resources = require('../src/translations.cjs');
const {statusPage, settingsPage} = require('../src/local-pages.cjs');
const {menuTemplate} = require('../src/menu.cjs');
test('preference persistence, system selection, malformed fallback and non-mutating invalid choice',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qingdan-language-')); const file=path.join(dir,'language.json');
 try{
  assert.deepEqual(language.initialize(file,'zh-TW'),{preference:'system',locale:'zh-CN',revision:0});
  language.savePreference(file,'en'); assert.deepEqual(language.initialize(file,'zh-CN'),{preference:'en',locale:'en',revision:0});
  const before=fs.readFileSync(file,'utf8');for(const invalid of ['fr','EN',null,{},['en'],'en\n'])assert.throws(()=>language.savePreference(file,invalid),/Invalid language/);assert.equal(fs.readFileSync(file,'utf8'),before);
  language.savePreference(file,'system');assert.equal(language.initialize(file,'fr-FR').locale,'en');
  fs.writeFileSync(file,'{"preference":"unknown"}');assert.equal(language.initialize(file,'zh-CN').preference,'system');
  fs.writeFileSync(file,'invalid');assert.equal(language.initialize(file,'').locale,'en');
  const blocked=path.join(dir,'blocked');fs.mkdirSync(blocked);const snapshot=language.snapshot();assert.throws(()=>language.savePreference(blocked,'zh-CN'));assert.deepEqual(language.snapshot(),snapshot,'failed atomic save does not advance revision or preference');
 }finally{fs.rmSync(dir,{recursive:true,force:true});language.initialize('/nonexistent/qingdan-language','zh-CN');}
});
test('native dictionaries have complete semantic keys and English local pages do not scan or translate endpoint data',()=>{
 for(const [key,value] of Object.entries(resources)){assert.match(key,/^desktop\.[a-z0-9.]+$/);assert.ok(value.en);assert.ok(value['zh-CN']);}
 language.initialize('/nonexistent/qingdan-language','en-US');
 const status=statusPage({builtin:false,serverUrl:'https://example.test/?task=青单&note=<draft>'},'disconnected','服务器响应为空。');
 assert.match(status,/<html lang="en" data-language-revision="0">/);assert.match(status,/The server response was empty/);assert.match(status,/task=青单&amp;note=&lt;draft&gt;/);
 assert.match(settingsPage(),/Save and connect/);assert.match(settingsPage(),/value="system" data-i18n="desktop\.system\.default">System default/);
 assert.equal(menuTemplate({platform:'win32',packaged:true})[0].label,'File');
 assert.equal(language.translateNativeError('服务器响应为空。'),'The server response was empty.');
 language.initialize('/nonexistent/qingdan-language','zh-CN');
 assert.equal(language.translateNativeError('The server response was empty.'),'服务器响应为空。');
 assert.equal(menuTemplate({platform:'win32',packaged:true})[0].label,'文件');
});
