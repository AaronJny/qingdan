/** Run: node --experimental-strip-types --test assets/calendar-layout.test.ts */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateToDay, dayToDate, timeToMinute, minuteToTime, wallToMinute, minuteToWall,
  addCalendarDays, addCalendarMonths, addCalendarYears, normalizeTaskInterval,
  moveTaskTo, moveTaskToAllDay, pixelsToMinuteDelta, resizeTimedTask, resizeAllDayTask,
  clipInterval, splitIntervalByDay, clipToDateGrid, allocateOverlapLanes,
  dragSelectTask, calendarGridDates,
} from './calendar-layout.ts';
import type { TaskSchedule, MinuteInterval } from './calendar-layout.ts';
const at = (date: string, time = '00:00') => wallToMinute(date, time);
const timed: TaskSchedule = { startDate: '2026-10-07', startTime: '23:30', dueDate: '2026-10-09', dueTime: '00:15', duration: 1 };
const allDay: TaskSchedule = { startDate: '2026-12-30', dueDate: '2027-01-02' };
function interval(start: string, startTime: string, end: string, endTime: string): MinuteInterval {
  return { start: at(start, startTime), end: at(end, endTime) };
}
test('Gregorian day indexing handles leap years, pre-1970 and years below 100', () => {
  for (const date of ['0001-01-01', '0004-02-29', '0099-12-31', '0100-01-01', '1900-03-01', '1969-12-31', '1970-01-01', '2000-02-29', '2024-02-29', '9999-12-31']) assert.equal(dayToDate(dateToDay(date)), date);
  assert.equal(dateToDay('1970-01-01'), 0);
  assert.equal(addCalendarDays('2024-02-28', 2), '2024-03-01');
  assert.equal(addCalendarDays('0099-12-31', 1), '0100-01-01');
  assert.equal(addCalendarDays('2027-01-01', -1), '2026-12-31');
});
test('rejects impossible dates, unsafe day indices and overflow', () => {
  for (const date of ['0000-01-01', '2025-02-29', '1900-02-29', '2026-13-01', '2026-04-31', '2026-1-01', 'garbage']) assert.throws(() => dateToDay(date), RangeError);
  for (const value of [NaN, Infinity, 1.2, Number.MAX_SAFE_INTEGER]) assert.throws(() => dayToDate(value), RangeError);
  assert.throws(() => addCalendarDays('0001-01-01', -1), RangeError);
  assert.throws(() => addCalendarDays('9999-12-31', 1), RangeError);
});
test('wall-minute times require exact HH:mm and round-trip negative epoch minutes', () => {
  assert.equal(timeToMinute('00:00'), 0); assert.equal(timeToMinute('23:59'), 1439);
  assert.equal(minuteToTime(570), '09:30');
  assert.deepEqual(minuteToWall(-1), { date: '1969-12-31', time: '23:59' });
  for (const date of ['0001-01-01', '0099-12-31', '2026-10-07', '9999-12-31']) assert.deepEqual(minuteToWall(at(date, '23:59')), { date, time: '23:59' });
  for (const time of ['24:00', '09:60', '9:30', '09:30:00', '', 'ab:cd']) assert.throws(() => timeToMinute(time), RangeError);
  for (const n of [-1, 1440, 1.5, NaN]) assert.throws(() => minuteToTime(n), RangeError);
});
test('normalizes an explicit timed multi-day range, overriding stale duration', () => {
  assert.deepEqual(normalizeTaskInterval(timed), { allDay: false, start: at('2026-10-07', '23:30'), end: at('2026-10-09', '00:15'), durationMinutes: 1485 });
});
test('due-only timed records preserve legacy start anchor and duration', () => {
  assert.deepEqual(normalizeTaskInterval({ dueDate: '2026-10-07', dueTime: '23:45', duration: 45 }), { allDay: false, start: at('2026-10-07', '23:45'), end: at('2026-10-08', '00:30'), durationMinutes: 45 });
  assert.equal(normalizeTaskInterval({ dueDate: '2026-10-07', dueTime: '09:30' })?.durationMinutes, 30);
  assert.equal(normalizeTaskInterval({ dueDate: '2026-10-07', dueTime: '09:30', duration: 0 })?.durationMinutes, 30);
  assert.equal(normalizeTaskInterval({ dueDate: '2026-10-07', dueTime: '09:30', duration: 1 })?.durationMinutes, 15);
});
test('all-day ranges use inclusive stored endpoints and ignore estimate duration', () => {
  assert.deepEqual(normalizeTaskInterval(allDay), { allDay: true, start: at('2026-12-30'), end: at('2027-01-03'), durationMinutes: 5760 });
  assert.equal(normalizeTaskInterval({ dueDate: '2026-10-07', duration: 30 })?.durationMinutes, 1440);
  assert.equal(normalizeTaskInterval({ startDate: '2026-10-09', dueDate: '2026-10-07' })?.durationMinutes, 1440);
});
test('start-only, empty dates and mixed timed/all-day endpoint conventions are explicit', () => {
  assert.equal(normalizeTaskInterval({}), null);
  assert.equal(normalizeTaskInterval({ dueDate: '', startDate: '', startTime: '', dueTime: '' }), null);
  assert.equal(normalizeTaskInterval({ startDate: '2026-10-07', startTime: '09:00', duration: 60 })?.durationMinutes, 60);
  assert.equal(normalizeTaskInterval({ startDate: '2026-10-07', startTime: '23:30', dueDate: '2026-10-07' })?.durationMinutes, 30);
  assert.equal(normalizeTaskInterval({ startDate: '2026-10-07', dueDate: '2026-10-07', dueTime: '01:00' })?.durationMinutes, 60);
});
test('inverted/zero timed endpoints repair to minimum valid duration', () => {
  const base = { startDate: '2026-10-07', startTime: '09:30', dueDate: '2026-10-07' };
  for (const dueTime of ['09:30', '09:00']) assert.equal(normalizeTaskInterval({ ...base, dueTime })?.durationMinutes, 15);
  assert.equal(normalizeTaskInterval({ ...base, dueTime: '09:00' }, { minimumDurationMinutes: 5 })?.durationMinutes, 5);
});
test('invalid scheduling values/options fail rather than silently producing NaN', () => {
  for (const duration of [-1, 1.5, NaN, Infinity]) assert.throws(() => normalizeTaskInterval({ dueDate: '2026-10-07', duration }), RangeError);
  assert.throws(() => normalizeTaskInterval({ dueDate: 'bad' }), RangeError);
  assert.throws(() => normalizeTaskInterval({ dueTime: '24:00' }), RangeError);
  assert.throws(() => normalizeTaskInterval({}, { minimumDurationMinutes: 0 }), RangeError);
  assert.throws(() => normalizeTaskInterval({}, { defaultDurationMinutes: NaN }), RangeError);
  assert.throws(() => normalizeTaskInterval({ dueDate: '2026-10-07', dueTime: '09:00', duration: Number.MAX_SAFE_INTEGER }), RangeError);
});
test('timed moves preserve coherent start/end and exact cross-year duration', () => {
  const source = Object.freeze({ ...timed });
  const patch = moveTaskTo(source, { date: '2026-12-31', time: '22:00' });
  assert.deepEqual(patch, { startDate: '2026-12-31', startTime: '22:00', dueDate: '2027-01-01', dueTime: '22:45', duration: 1485 });
  assert.equal(normalizeTaskInterval(patch)?.durationMinutes, 1485);
  assert.equal(source.duration, 1);
  assert.equal(moveTaskTo(source, { date: '2026-11-01' }).startTime, '23:30');
});
test('due-only timed move materializes explicit start/end across midnight', () => {
  assert.deepEqual(moveTaskTo({ dueDate: '2026-10-07', dueTime: '09:30', duration: 60 }, { date: '2026-10-08', time: '23:30' }), { startDate: '2026-10-08', startTime: '23:30', dueDate: '2026-10-09', dueTime: '00:30', duration: 60 });
});
test('all-day move retains inclusive multi-day span and empty clocks', () => {
  assert.deepEqual(moveTaskTo(allDay, { date: '2024-02-27' }), { startDate: '2024-02-27', startTime: '', dueDate: '2024-03-01', dueTime: '', duration: 5760 });
  assert.deepEqual(moveTaskTo({ dueDate: '2026-10-07' }, { date: '2026-10-09' }), { startDate: '2026-10-09', startTime: '', dueDate: '2026-10-09', dueTime: '', duration: 1440 });
});
test('explicit mode conversions keep covered dates/whole wall-minute spans', () => {
  const conversion = moveTaskTo(allDay, { date: '2026-10-07', time: '09:30' });
  assert.equal(conversion.startTime, '09:30'); assert.equal(conversion.dueTime, '09:30'); assert.equal(conversion.dueDate, '2026-10-11'); assert.equal(conversion.duration, 5760);
  assert.deepEqual(moveTaskToAllDay({ startDate: '2026-10-07', startTime: '23:30', dueDate: '2026-10-09', dueTime: '00:00' }, '2026-11-01'), { startDate: '2026-11-01', startTime: '', dueDate: '2026-11-02', dueTime: '', duration: 2880 });
  assert.equal(moveTaskToAllDay(timed, '2026-11-01').duration, 4320);
});
test('moves reject unscheduled tasks, invalid targets and calendar overflow', () => {
  assert.throws(() => moveTaskTo({}, { date: '2026-10-07' }), RangeError);
  assert.throws(() => moveTaskTo(timed, { date: '2026-02-30' }), RangeError);
  assert.throws(() => moveTaskTo(timed, { date: '2026-10-07', time: '' }), RangeError);
  assert.throws(() => moveTaskTo(timed, { date: '9999-12-31' }), RangeError);
});
test('pixel delta uses zoom-aware symmetric fifteen-minute snapping', () => {
  assert.equal(pixelsToMinuteDelta(26, 52), 30);
  assert.equal(pixelsToMinuteDelta(13, 104), 15);
  assert.equal(pixelsToMinuteDelta(-13, 104), -15);
  assert.equal(pixelsToMinuteDelta(3, 60), 0);
  assert.equal(pixelsToMinuteDelta(10, 60, 5), 10);
  for (const pixelsPerHour of [0, -1, Infinity, NaN]) assert.throws(() => pixelsToMinuteDelta(10, pixelsPerHour), RangeError);
  assert.throws(() => pixelsToMinuteDelta(NaN, 52), RangeError);
  assert.throws(() => pixelsToMinuteDelta(10, 52, 0), RangeError);
});
test('timed resize updates actual ending date/time/duration and keeps original start', () => {
  assert.deepEqual(resizeTimedTask(timed, 26, 52), { startDate: '2026-10-07', startTime: '23:30', dueDate: '2026-10-09', dueTime: '00:45', duration: 1515 });
  assert.equal(resizeTimedTask(timed, -26, 52).dueDate, '2026-10-08');
  assert.equal(resizeTimedTask(timed, -26, 52).dueTime, '23:45');
  assert.deepEqual(resizeTimedTask(timed, -5000, 52), { startDate: '2026-10-07', startTime: '23:30', dueDate: '2026-10-07', dueTime: '23:45', duration: 15 });
  assert.equal(resizeTimedTask(timed, -5000, 52, 15, 5).duration, 5);
});
test('all-day resize includes ending date and clamps to at least one day', () => {
  assert.deepEqual(resizeAllDayTask(allDay, 2), { startDate: '2026-12-30', startTime: '', dueDate: '2027-01-04', dueTime: '', duration: 8640 });
  assert.deepEqual(resizeAllDayTask(allDay, -99), { startDate: '2026-12-30', startTime: '', dueDate: '2026-12-30', dueTime: '', duration: 1440 });
  assert.throws(() => resizeAllDayTask(allDay, 1.5), RangeError);
  assert.throws(() => resizeAllDayTask(timed, 1), RangeError);
  assert.throws(() => resizeTimedTask(allDay, 1, 52), RangeError);
});
test('clip interval uses half-open intersection and never invents edge overlaps', () => {
  assert.deepEqual(clipInterval({ start: 15, end: 75 }, { start: 30, end: 60 }), { start: 30, end: 60 });
  assert.equal(clipInterval({ start: 15, end: 30 }, { start: 30, end: 60 }), null);
  assert.equal(clipInterval({ start: 60, end: 75 }, { start: 30, end: 60 }), null);
  assert.throws(() => clipInterval({ start: 1, end: 1 }, { start: 0, end: 2 }), RangeError);
});
test('day/week grid splits multi-day timed ranges at midnight and clips before/after', () => {
  const segments = splitIntervalByDay(normalizeTaskInterval(timed)!, '2026-10-08', '2026-10-09');
  assert.deepEqual(segments.map(s => [s.date, s.startMinute, s.endMinute, s.continuesBefore, s.continuesAfter]), [['2026-10-08', 0, 1440, true, true], ['2026-10-09', 0, 15, true, false]]);
  assert.equal(splitIntervalByDay(normalizeTaskInterval(timed)!, '2026-10-07', '2026-10-07')[0].startMinute, 1410);
  assert.deepEqual(splitIntervalByDay(normalizeTaskInterval(timed)!, '2026-10-10', '2026-10-11'), []);
});
test('exclusive midnight endpoint never creates next-day chip', () => {
  const item = interval('2026-10-07', '23:00', '2026-10-08', '00:00');
  const days = calendarGridDates('2026-10-07', 'week');
  assert.deepEqual(splitIntervalByDay(item, days[0], days.at(-1)!).map(s => [s.date, s.endMinute]), [['2026-10-07', 1440]]);
  assert.deepEqual(clipToDateGrid(item, days).map(s => [s.startColumn, s.endColumn, s.startDate, s.endDate]), [[2, 3, '2026-10-07', '2026-10-07']]);
});
test('month grid bars clip through viewport and split across week rows', () => {
  const dates = calendarGridDates('2026-10-07', 'month');
  const item = interval('2026-09-25', '09:30', '2026-10-07', '00:15');
  const segments = clipToDateGrid(item, dates);
  assert.deepEqual(segments.map(s => [s.row, s.startColumn, s.endColumn, s.startDate, s.endDate, s.continuesBefore, s.continuesAfter]), [
    [0, 0, 7, '2026-09-28', '2026-10-04', true, true], [1, 0, 3, '2026-10-05', '2026-10-07', true, false],
  ]);
  const over = clipToDateGrid(interval('2026-09-01', '00:00', '2026-12-01', '00:00'), dates);
  assert.equal(over.length, 6); assert.ok(over.every(s => s.continuesBefore && s.continuesAfter));
});
test('grids support partial rows/day cells and reject noncontiguous dates', () => {
  const item = interval('2026-10-06', '12:00', '2026-10-10', '12:00');
  assert.deepEqual(clipToDateGrid(item, ['2026-10-07'], 1).map(s => [s.row, s.startColumn, s.endColumn, s.continuesBefore, s.continuesAfter]), [[0, 0, 1, true, true]]);
  assert.deepEqual(clipToDateGrid(item, []), []);
  assert.throws(() => clipToDateGrid(item, ['2026-10-07', '2026-10-09']), RangeError);
  assert.throws(() => clipToDateGrid(item, ['2026-10-07', '2026-10-07']), RangeError);
  assert.throws(() => splitIntervalByDay(item, '2026-10-09', '2026-10-07'), RangeError);
  assert.throws(() => clipToDateGrid(item, [], 0), RangeError);
});
test('overlap lanes handle half-hour starts/cross-hour overlaps and adjacent endpoints', () => {
  const events = Object.freeze([
    Object.freeze({ id: 'A', start: 570, end: 630 }), // 09:30–10:30
    Object.freeze({ id: 'B', start: 600, end: 660 }), // 10:00–11:00
    Object.freeze({ id: 'C', start: 630, end: 690 }), // 10:30–11:30
    Object.freeze({ id: 'D', start: 690, end: 720 }),
  ]);
  const lanes = allocateOverlapLanes(events);
  assert.deepEqual(lanes.map(e => [e.id, e.lane, e.laneCount, e.group]), [['A', 0, 2, 0], ['B', 1, 2, 0], ['C', 0, 2, 0], ['D', 0, 1, 1]]);
  assert.equal('lane' in events[0], false);
});
test('overlap connected groups use peak concurrency and stable deterministic ties', () => {
  const events = [{ id: 'short', start: 10, end: 20 }, { id: 'long', start: 10, end: 40 }, { id: 'same', start: 10, end: 20 }, { id: 'tail', start: 25, end: 50 }];
  assert.deepEqual(allocateOverlapLanes(events).map(e => [e.id, e.lane, e.laneCount]), [['long', 0, 3], ['short', 1, 3], ['same', 2, 3], ['tail', 1, 3]]);
  assert.deepEqual(allocateOverlapLanes([]), []);
  assert.throws(() => allocateOverlapLanes([{ start: 10, end: 10 }]), RangeError);
});
test('lane assignment has no collisions and minimal width under a dense deterministic fixture', () => {
  const events = Array.from({ length: 100 }, (_, i) => ({ id: String(i), start: (i * 37) % 800, end: (i * 37) % 800 + 15 + (i * 19) % 90 }));
  const lanes = allocateOverlapLanes(events);
  for (const a of lanes) for (const b of lanes) if (a.id !== b.id && a.start < b.end && b.start < a.end) assert.notEqual(a.lane, b.lane);
  for (const a of lanes) {
    const group = lanes.filter(b => b.group === a.group);
    const peak = Math.max(...group.map(p => group.filter(b => b.start <= p.start && b.end > p.start).length));
    assert.equal(a.laneCount, peak);
  }
});
test('day clipping before lane assignment excludes next-day false overlaps', () => {
  const ranges = [interval('2026-10-07', '23:30', '2026-10-08', '00:30'), interval('2026-10-08', '00:15', '2026-10-08', '00:45')];
  const day1 = allocateOverlapLanes(ranges.flatMap(r => splitIntervalByDay(r, '2026-10-07', '2026-10-07')));
  const day2 = allocateOverlapLanes(ranges.flatMap(r => splitIntervalByDay(r, '2026-10-08', '2026-10-08')));
  assert.equal(day1.length, 1); assert.equal(day1[0].laneCount, 1);
  assert.equal(day2.length, 2); assert.ok(day2.every(s => s.laneCount === 2));
});
test('drag-select sorts direction, snaps fifteen minutes and returns coherent actual patches', () => {
  const expected = { startDate: '2026-10-07', startTime: '09:15', dueDate: '2026-10-07', dueTime: '10:00', duration: 45 };
  assert.deepEqual(dragSelectTask('2026-10-07', 558, 597, 60), expected);
  assert.deepEqual(dragSelectTask('2026-10-07', 597, 558, 60), expected);
  assert.equal(dragSelectTask('2026-10-07', 600, 600, 60).duration, 15);
  assert.deepEqual(dragSelectTask('2026-12-31', 1410, 1470, 60), { startDate: '2026-12-31', startTime: '23:30', dueDate: '2027-01-01', dueTime: '00:30', duration: 60 });
  assert.deepEqual(dragSelectTask('1970-01-01', -15, 15, 60), { startDate: '1969-12-31', startTime: '23:45', dueDate: '1970-01-01', dueTime: '00:15', duration: 30 });
});
test('month/year navigation clamps Gregorian endpoints without accidental rollover', () => {
  assert.equal(addCalendarMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addCalendarMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addCalendarMonths('2026-02-28', 1, 31), '2026-03-31');
  assert.equal(addCalendarMonths('2026-01-31', -1), '2025-12-31');
  assert.equal(addCalendarMonths('2026-12-31', 14), '2028-02-29');
  assert.equal(addCalendarYears('2024-02-29', 1), '2025-02-28');
  assert.equal(addCalendarYears('2025-02-28', 3, 29), '2028-02-29');
  assert.equal(addCalendarYears('0099-02-28', 1), '0100-02-28');
  assert.throws(() => addCalendarYears('9999-01-01', 1), RangeError);
  assert.throws(() => addCalendarMonths('0001-01-01', -1), RangeError);
  assert.throws(() => addCalendarMonths('2026-01-01', 1, 32), RangeError);
});
test('month/week/day date grids respect configurable week starts across year boundaries', () => {
  const month = calendarGridDates('2026-10-31', 'month');
  assert.equal(month.length, 42); assert.equal(month[0], '2026-09-28'); assert.equal(month.at(-1), '2026-11-08');
  assert.deepEqual(calendarGridDates('2027-01-01', 'week'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  assert.equal(calendarGridDates('2027-01-01', 'week', 0)[0], '2026-12-27');
  assert.deepEqual(calendarGridDates('2024-02-29', 'day'), ['2024-02-29']);
  assert.throws(() => calendarGridDates('2026-10-07', 'week', 7), RangeError);
});
test('DST transition days retain 1440 local wall-minute cells in every host timezone', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/New_York', 'Europe/Berlin', 'Asia/Shanghai', 'Pacific/Auckland']) {
      process.env.TZ = zone;
      for (const date of ['2026-03-08', '2026-11-01', '2026-03-29', '2026-10-25']) {
        assert.equal(at(addCalendarDays(date, 1)) - at(date), 1440);
        assert.equal(normalizeTaskInterval({ dueDate: date })?.durationMinutes, 1440);
      }
      const patch = moveTaskTo({ startDate: '2026-03-07', startTime: '01:30', dueDate: '2026-03-07', dueTime: '03:30' }, { date: '2026-03-08' });
      assert.equal(patch.startTime, '01:30'); assert.equal(patch.dueTime, '03:30'); assert.equal(patch.duration, 120);
      // 02:30 is a valid geometry cell even when the zone has no actual instant.
      assert.deepEqual(minuteToWall(at('2026-03-08', '02:30')), { date: '2026-03-08', time: '02:30' });
      assert.equal(dragSelectTask('2026-11-01', 60, 120, 60).duration, 60);
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test('normalization/move/resize round trips remain coherent across deterministic calendar fixtures', () => {
  for (const date of ['0004-02-28', '0099-12-31', '2024-02-28', '2026-03-08', '2026-11-01', '2026-12-31']) {
    for (const duration of [15, 30, 90, 1440, 3000]) {
      const source = { dueDate: date, dueTime: '23:45', duration };
      const moved = moveTaskTo(source, { date, time: '23:30' });
      assert.equal(normalizeTaskInterval(moved)?.durationMinutes, duration);
      assert.equal(normalizeTaskInterval(resizeTimedTask(moved, 15, 60))?.durationMinutes, duration + 15);
    }
  }
});
