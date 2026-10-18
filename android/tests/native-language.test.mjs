import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root = new URL('../android/app/src/main/', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
function strings(name) {
 const values = [...read(`res/${name}/strings.xml`).matchAll(/<string name="([a-z0-9_]+)">([\s\S]*?)<\/string>/g)];
 assert.equal(new Set(values.map(value=>value[1])).size,values.length,'no duplicate Android resource IDs');
 return Object.fromEntries(values.map(value=>[value[1],value[2]]));
}
test('native Android resources cover both languages with stable IDs and system launcher fallback',()=>{
 const en=strings('values'),zh=strings('values-zh-rCN');assert.deepEqual(Object.keys(en).sort(),Object.keys(zh).sort());
 assert.equal(en.app_name,'Qingdan');assert.equal(zh.app_name,'青单');assert.equal(strings('values-zh').app_name,'青单');
 for(const file of ['MainActivity.java','NativeLanguage.java','OriginPolicy.java','ExportPayload.java'])for(const match of read('java/cn/qingdan/android/'+file).matchAll(/NativeLanguage\.text\("([a-z.]+)"\)/g))assert.ok(en[match[1].replaceAll('.','_')],match[1]);
});
test('native language uses existing trusted top-frame command routing and Android resource APIs',()=>{
 const activity=read('java/cn/qingdan/android/MainActivity.java');
 assert.match(activity,/request\.isForMainFrame\(\) && trustedRoot\(view\) && resumed\) handleNativeCommand/);
 assert.match(activity,/setNativeLanguage\(NativeLanguage\.parseCommand\(url\)\)/);
 assert.match(activity,/createConfigurationContext\(configuration\)/);
 assert.match(activity,/putString\("language", value\)\.commit\(\)/);
 assert.match(activity,/__QINGDAN_NATIVE_LANGUAGE_READY__=true/);
 assert.doesNotMatch(activity,/addJavascriptInterface\([^;]+(?:Language|Locale)/);
 const helper=read('java/cn/qingdan/android/NativeLanguage.java');
 assert.match(helper,/query\.size\(\) != 1/);assert.match(helper,/validPreference\(query\.get\("preference"\)\)/);
});

test('all nine Android resource sets have complete stable keys and compatible interpolation',()=>{
 const baseline=strings('values');
 const parameters=value=>[...new Set(value.match(/%\d+\$[sd]|%[sd]/g)||[])].sort();
 for(const directory of ['values-zh-rCN','values-b+zh+Hant','values-ja','values-ko','values-es','values-fr','values-de','values-pt-rBR']){
  const dictionary=strings(directory);assert.deepEqual(Object.keys(dictionary).sort(),Object.keys(baseline).sort(),directory);
  for(const [key,value]of Object.entries(dictionary)){assert.ok(value.trim(),`${directory}:${key}`);assert.deepEqual(parameters(value),parameters(baseline[key]),`${directory}:${key}`);}
 }
 const activity=read('java/cn/qingdan/android/MainActivity.java');assert.match(activity,/NativeLanguage\.choices\(\)/);assert.match(activity,/NativeLanguage\.names\(\)/);
 const helper=read('java/cn/qingdan/android/NativeLanguage.java');
 for(const locale of ['zh-CN','en','zh-TW','ja','ko','es','fr','de','pt-BR'])assert.ok(helper.includes(`"${locale}"`));
});
