import { test } from 'node:test';
import assert from 'node:assert/strict';
import i18next from 'i18next';
import { LOCALES } from './language-policy';
import { unitMessages } from './i18n-units';

test('counted-unit catalog has complete keys and one amount placeholder in every locale', () => {
 const keys=Object.keys(unitMessages.en).sort();
 for(const locale of LOCALES){
  assert.deepEqual(Object.keys(unitMessages[locale]).sort(),keys,locale);
  for(const [key,value]of Object.entries(unitMessages[locale])){
   assert.match(key,/^units\.[A-Za-z]+_(one|other|many)$/);
   assert.equal(value.match(/\{amount\}/g)?.length,1,`${locale}:${key}`);
  }
 }
});
test('i18next selects localized counted-unit forms for zero, decimals, singular and millions', () => {
 const engine=i18next.createInstance();
 void engine.init({fallbackLng:'en',supportedLngs:[...LOCALES],resources:Object.fromEntries(LOCALES.map(locale=>[locale,{translation:unitMessages[locale]}])),initAsync:false,keySeparator:false,interpolation:{escapeValue:false,prefix:'{',suffix:'}'}});
 const keys=Object.keys(unitMessages.en).filter(key=>key.endsWith('_other')).map(key=>key.slice(0,-6));
 for(const locale of LOCALES)for(const count of [0,1,2,1.5,1000000])for(const key of keys){
  const amount=new Intl.NumberFormat(locale).format(count),form=new Intl.PluralRules(locale).select(count);
  assert.equal(engine.t(key as any,{lng:locale,count,amount}),unitMessages[locale][`${key}_${form}`].replace('{amount}',amount),`${locale}:${key}:${count}`);
 }
 assert.equal(engine.t('units.task' as any,{lng:'ko',count:2,amount:'2'}),'할 일 2개');
 assert.equal(engine.t('units.record' as any,{lng:'ja',count:2,amount:'2'}),'2件の記録');
});
