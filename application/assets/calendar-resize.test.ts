import test from 'node:test';
import assert from 'node:assert/strict';
import {resizeTaskDateEdge, resizeTaskTimeEdge, normalizeTaskInterval, moveTaskTo, clipToDateGrid, calendarGridDates} from './calendar-layout';

test('date edges extend/shrink independently across week, month and year rows', () => {
  const task = {startDate:'2026-12-30',dueDate:'2027-01-03'};
  assert.deepEqual(resizeTaskDateEdge(task,'start','2026-12-20'), {startDate:'2026-12-20',startTime:'',dueDate:'2027-01-03',dueTime:'',duration:15*1440});
  assert.equal(resizeTaskDateEdge(task,'end','2027-01-12').duration,14*1440);
  assert.equal(resizeTaskDateEdge(task,'start','2027-01-02').duration,2*1440);
  assert.equal(resizeTaskDateEdge(task,'end','2026-12-31').duration,2*1440);
  assert.equal(resizeTaskDateEdge(task,'start','2027-02-01').startDate,'2027-01-03');
  assert.equal(resizeTaskDateEdge(task,'end','2026-11-01').dueDate,'2026-12-30');
  assert.deepEqual(task,{startDate:'2026-12-30',dueDate:'2027-01-03'});
});

test('single dates become inclusive multi-day spans and movement retains the new span', () => {
  const span=resizeTaskDateEdge({dueDate:'2026-10-19'},'end','2026-10-27');
  assert.equal(span.duration,9*1440); assert.equal(span.startDate,'2026-10-19');
  const moved=moveTaskTo(span,{date:'2026-11-01'});
  assert.equal(moved.dueDate,'2026-11-09');assert.equal(moved.duration,span.duration);
  assert.equal(resizeTaskDateEdge({startDate:'2026-10-19'},'start','2026-10-18').dueDate,'2026-10-19');
});

test('calendar-day arithmetic is DST-independent and handles leap dates', () => {
  for(const timezone of ['UTC','America/New_York','Europe/Berlin','Australia/Lord_Howe']) {
    const before=process.env.TZ;process.env.TZ=timezone;
    try {
      assert.equal(resizeTaskDateEdge({dueDate:'2026-03-07'},'end','2026-03-10').duration,4*1440);
      assert.equal(resizeTaskDateEdge({dueDate:'2026-10-31'},'end','2026-11-03').duration,4*1440);
      assert.equal(resizeTaskDateEdge({dueDate:'2028-02-28'},'end','2028-03-01').duration,3*1440);
    } finally { if(before===undefined)delete process.env.TZ;else process.env.TZ=before; }
  }
});

test('timed date edges preserve wall times, midnight exclusion and minimum length', () => {
  const task={startDate:'2026-10-19',startTime:'23:00',dueDate:'2026-10-21',dueTime:'00:00'};
  const end=resizeTaskDateEdge(task,'end','2026-10-26');
  assert.equal(end.dueDate,'2026-10-27');assert.equal(end.dueTime,'00:00');assert.equal(end.startTime,'23:00');
  const start=resizeTaskDateEdge(task,'start','2026-10-18');
  assert.equal(start.startTime,'23:00');assert.equal(start.dueDate,task.dueDate);
  assert.equal(resizeTaskDateEdge(task,'start','2026-10-22').duration,15);
  assert.equal(resizeTaskDateEdge(task,'end','2026-10-18').duration,15);
  const dueOnly=resizeTaskDateEdge({dueDate:'2026-10-19',dueTime:'09:00',duration:60},'end','2026-10-20');
  assert.equal(dueOnly.startTime,'09:00');assert.equal(dueOnly.dueTime,'10:00');assert.equal(dueOnly.duration,1500);
});

test('time-grid edges clamp and retain the opposite endpoint', () => {
  const task={startDate:'2026-10-19',startTime:'09:00',dueDate:'2026-10-19',dueTime:'10:00'};
  const start=resizeTaskTimeEdge(task,'start',-26,52);assert.equal(start.startTime,'08:30');assert.equal(start.dueTime,'10:00');
  assert.equal(resizeTaskTimeEdge(task,'end',-100,52).dueTime,'09:15');
  assert.equal(resizeTaskTimeEdge(task,'start',100,52).startTime,'09:45');
});

test('week-wrap and clipped segments are not mistaken for real endpoints', () => {
  const range=normalizeTaskInterval({startDate:'2026-10-02',dueDate:'2026-10-20'})!;
  const grid=clipToDateGrid(range,calendarGridDates('2026-10-19','month'));
  assert.equal(grid.length,4);assert.equal(grid.filter(s=>!s.continuesBefore).length,1);assert.equal(grid.filter(s=>!s.continuesAfter).length,1);
  const clipped=clipToDateGrid(range,calendarGridDates('2026-10-12','week'));
  assert.equal(clipped[0].continuesBefore,true);assert.equal(clipped[0].continuesAfter,true);
});
