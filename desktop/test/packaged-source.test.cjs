'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const asar = require('@electron/asar');
const { sourceFiles, verifyPackagedSources } = require('../scripts/packaged-source.cjs');
const { nativeAsarEntryPath } = require('../scripts/asar-entry-path.cjs');

function fixture(t) {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qingdan-source-archive-'));
 t.after(()=>{asar.uncacheAll();fs.rmSync(directory,{recursive:true,force:true})});
 const source=path.join(directory,'source'),packaged=path.join(directory,'packaged'),archive=path.join(directory,'app.asar');
 fs.mkdirSync(path.join(source,'src/locales'),{recursive:true});
 fs.writeFileSync(path.join(source,'src/main.cjs'),"'use strict';\n");
 for(const locale of ['zh-TW','ja','ko','es','fr','de','pt-BR'])fs.writeFileSync(path.join(source,`src/locales/${locale}.json`),JSON.stringify({'desktop.language':locale}));
 fs.cpSync(source,packaged,{recursive:true});
 return {directory,source,packaged,archive,extract:name=>asar.extractFile(archive,nativeAsarEntryPath(name)),async pack(){asar.uncacheAll();await asar.createPackage(packaged,archive)}};
}
test('final ASAR source verification includes every nested native locale dictionary',async t=>{
 const f=fixture(t);await f.pack();const files=verifyPackagedSources(f.source,f.extract);
 assert.equal(files.length,8);assert.equal(files.filter(name=>name.startsWith('locales/')).length,7);
 assert.deepEqual(files,sourceFiles(path.join(f.source,'src')));
});
test('missing and mutated packaged dictionaries cannot pass byte verification',async t=>{
 for(const mutation of ['missing','changed']){
  const f=fixture(t),file=path.join(f.packaged,'src/locales/ja.json');
  if(mutation==='missing')fs.unlinkSync(file);else fs.writeFileSync(file,'{"desktop.language":"tampered"}');
  await f.pack();assert.throws(()=>verifyPackagedSources(f.source,f.extract),/ja\.json/);
 }
});
test('source traversal refuses file and directory symlinks instead of following them',{skip:process.platform==='win32'},t=>{
 const f=fixture(t),link=path.join(f.source,'src/locales/link');
 for(const target of [path.join(f.source,'src/main.cjs'),path.join(f.directory,'packaged')]){
  fs.symlinkSync(target,link,fs.statSync(target).isDirectory()?'dir':'file');
  assert.throws(()=>sourceFiles(path.join(f.source,'src')),/Source symlink is not allowed/);fs.unlinkSync(link);
 }
});
