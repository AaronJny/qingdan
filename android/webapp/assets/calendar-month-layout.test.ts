import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calendarGridDates, layoutDateGrid} from './calendar-layout';
const task = (id: string, startDate: string, dueDate: string, extra = {}) => ({id, data: {startDate, dueDate, ...extra}});

test('a multi-day task is one bar per week with only its true endpoints', () => {
  const rows = layoutDateGrid([task('a', '2026-10-16', '2026-10-21')], calendarGridDates('2026-10-19', 'month'));
  const bars = rows.flatMap(row => row.segments);
  assert.equal(bars.length, 2);
  assert.deepEqual(bars.map(({segment}) => [segment.startDate, segment.endDate, segment.continuesBefore, segment.continuesAfter]), [
    ['2026-10-16', '2026-10-18', false, true], ['2026-10-19', '2026-10-21', true, false],
  ]);
  assert.equal(bars[0].lane, bars[1].lane);
});
test('weekly lanes reserve entire date columns, keep input-order stability and expose more than five overlaps', () => {
  const dates = calendarGridDates('2026-10-19', 'month');
  const tasks = Array.from({length: 8}, (_, i) => task(`task-${i}`, '2026-10-19', '2026-10-22'));
  tasks.push(task('morning', '2026-10-20', '2026-10-20', {startTime: '09:00', dueTime: '10:00'}));
  tasks.push(task('afternoon', '2026-10-20', '2026-10-20', {startTime: '15:00', dueTime: '16:00'}));
  const layout = layoutDateGrid(tasks, dates);
  assert.deepEqual(layout, layoutDateGrid([...tasks].reverse(), dates));
  const week = layout[3]; assert.equal(week.lanes, 10); assert.equal(week.segments.length, 10);
  for (const row of layout) for (const a of row.segments) for (const b of row.segments) {
    if (a === b || a.lane !== b.lane) continue;
    assert.ok(a.segment.endColumn <= b.segment.startColumn || b.segment.endColumn <= a.segment.startColumn);
  }
});
test('continuations retain their lane while other tasks end or start across the week boundary', () => {
  const rows = layoutDateGrid([
    task('old', '2026-10-16', '2026-10-18'), task('continued', '2026-10-17', '2026-10-22'), task('new', '2026-10-19', '2026-10-21'),
  ], calendarGridDates('2026-10-19', 'month'));
  const bars = rows.flatMap(row => row.segments).filter(bar => bar.task.id === 'continued');
  assert.equal(bars.length, 2); assert.equal(bars[0].lane, bars[1].lane);
});
test('clipped, midnight, cross-month and DST intervals use occupied calendar dates', () => {
  const dates = calendarGridDates('2026-11-01', 'month');
  const rows = layoutDateGrid([
    task('wide', '2026-10-01', '2026-12-31'),
    task('midnight', '2026-10-31', '2026-11-02', {startTime: '23:30', dueTime: '00:00'}),
  ], dates);
  const bars = rows.flatMap(row => row.segments);
  assert.ok(bars.filter(bar => bar.task.id === 'wide').every(bar => bar.segment.continuesBefore && bar.segment.continuesAfter));
  const midnight = bars.filter(bar => bar.task.id === 'midnight');
  assert.equal(midnight.length, 1); assert.equal(midnight[0].segment.endDate, '2026-11-01');
  assert.equal(midnight[0].segment.endColumn - midnight[0].segment.startColumn, 2);
});
