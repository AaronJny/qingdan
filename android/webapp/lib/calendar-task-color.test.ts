import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calendarTaskColor,calendarTaskColorIndex,calendarTaskPalette} from './calendar-task-color';
const luminance=(hex:string)=>{const rgb=hex.slice(1).match(/../g)!.map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
const contrast=(a:string,b:string)=>{const [x,y]=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (x+.05)/(y+.05)};
test('identity colors are deterministic and spread sequential identifiers across the palette',()=>{
  const ids=Array.from({length:8},(_,i)=>'fictional-task-'+i);
  assert.equal(new Set(ids.map(calendarTaskColorIndex)).size,8);
  for(const id of ids){assert.deepEqual(calendarTaskColor(id),calendarTaskColor(id));assert.ok(calendarTaskColorIndex(id)>=0);}
});
test('paired surfaces provide AA text contrast and visible accent edges in both themes',()=>{
  for(const [surface,edge,darkSurface,darkEdge] of calendarTaskPalette){
    assert.ok(contrast(surface,'#333941')>=4.5);assert.ok(contrast(darkSurface,'#dfe3eb')>=4.5);
    assert.ok(contrast(surface,edge)>=3);assert.ok(contrast(darkSurface,darkEdge)>=3);
  }
});
