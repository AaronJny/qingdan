import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasUnsupportedRichFormat} from './rich-format.ts';
test('GFM tables are supported with and without outside pipes',()=>{
  for(const value of ['| Name | Count |\n| --- | --- |\n| Alice | 2 |','Name | Count\n--- | ---\nAlice | 2','Name | Count\n:--- | ---:\nAlice | 2','a | b\n- | -\nx | y'])assert.equal(hasUnsupportedRichFormat(value),false,value);
});
test('image Markdown is supported but raw HTML retains its source',()=>{for(const value of ['![alt](https://example.test/image.png)','![alt][ref]\n\n[ref]: https://example.test/image.png','![alt][]'])assert.equal(hasUnsupportedRichFormat(value),false,value);for(const value of ['<table><tr><td>Value</td></tr></table>','<img src="https://example.test/image.png">'])assert.equal(hasUnsupportedRichFormat(value),true,value);});
test('supported headings checks links and ordinary pipe text remain rich-editable',()=>{
  for(const value of ['## 标题\n\n**加粗**','- [ ] 第一项\n- [x] 第二项','[链接](https://example.test/)','Name | Count\nordinary text'])assert.equal(hasUnsupportedRichFormat(value),false,value);
});
