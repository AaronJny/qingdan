import {test} from 'node:test';
import assert from 'node:assert/strict';
import {repeatPreviewData, repeatPreviews} from './calendar-repeat-preview';
import {normalizeTaskInterval} from '../assets/calendar-layout';
import type {RecordData} from './types';

test('all-day repeats shift both inclusive endpoints without mutating their source', () => {
  const source: RecordData = {title:'Synthetic span',status:'open',startDate:'2026-10-26',dueDate:'2026-10-28',recurrence:{start:{date:'2026-10-28'},rule:{frequency:'weekly'}}};
  const snapshot=structuredClone(source);
  const next=repeatPreviewData(source,{date:'2026-11-04'});
  assert.equal(next.startDate,'2026-11-02');assert.equal(next.dueDate,'2026-11-04');
  assert.equal(normalizeTaskInterval(next)?.durationMinutes,3*1440);
  assert.deepEqual(source,snapshot);assert.equal(next.recurrence,source.recurrence);
});

test('overnight repeats retain wall-clock span across month, leap day and DST boundaries', () => {
  for (const [start,due,nextStart,nextDue] of [
    ['2026-10-31','2026-11-01','2026-11-07','2026-11-08'],
    ['2026-03-07','2026-03-08','2026-03-14','2026-03-15'],
    ['2028-02-28','2028-02-29','2028-03-06','2028-03-07'],
  ]) {
    const source: RecordData={startDate:start,startTime:'23:30',dueDate:due,dueTime:'01:30',duration:120,timezone:'America/New_York',startInstant:'old-start',endInstant:'old-end'};
    const next=repeatPreviewData(source,{date:nextDue,time:'01:30',timeZone:'America/New_York'});
    assert.equal(next.startDate,nextStart);assert.equal(next.startTime,'23:30');assert.equal(next.dueTime,'01:30');
    assert.equal(normalizeTaskInterval(next)?.durationMinutes,120);
    assert.equal(next.startInstant,'');assert.equal(next.endInstant,'');
  }
});

test('due-only previews keep duration and do not gain a start date', () => {
  const next=repeatPreviewData({dueDate:'2026-10-26',dueTime:'09:00',duration:45},{date:'2026-10-27',time:'09:00'});
  assert.equal(next.startDate,undefined);assert.equal(normalizeTaskInterval(next)?.durationMinutes,45);
  const allDay=repeatPreviewData({dueDate:'2026-10-26'},{date:'2026-10-27'});
  assert.equal(normalizeTaskInterval(allDay)?.allDay,true);assert.equal(normalizeTaskInterval(allDay)?.durationMinutes,1440);
});

test('cross-window spans include later deadlines but exclude unrelated future occurrences', () => {
  const source: RecordData={status:'open',startDate:'2026-10-18',startTime:'23:00',dueDate:'2026-10-19',dueTime:'01:00',recurrence:{start:{date:'2026-10-19',time:'01:00'},rule:{frequency:'weekly'}}};
  const previews=repeatPreviews(source,'2026-10-19','2026-10-25');
  assert.equal(previews.length,1);assert.equal(previews[0].startDate,'2026-10-25');assert.equal(previews[0].dueDate,'2026-10-26');
  assert.deepEqual(repeatPreviews({...source,status:'done'},'2026-10-19','2026-10-25'),[]);
  assert.deepEqual(repeatPreviews({...source,recurrence:undefined},'2026-10-19','2026-10-25'),[]);
});

 test('unsupported holiday look-ahead never discards supported in-window previews', () => {
  const source: RecordData={status:'open',startDate:'2026-12-01',dueDate:'2026-12-03',recurrence:{start:{date:'2026-12-03'},rule:{frequency:'chinese-workday'}}};
  const previews=repeatPreviews(source,'2026-12-01','2026-12-31');
  assert.ok(previews.length>0);assert.equal(previews[0].dueDate,'2026-12-04');
  assert.equal(previews.at(-1)?.dueDate,'2026-12-31');
});
