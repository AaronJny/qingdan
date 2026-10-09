/** Run: node --experimental-strip-types --test assets/recurrence.test.ts */
import test from 'node:test';
import assert from 'node:assert/strict';
import { addLocalDays, addLocalMonths, getOccurrences, isDateOnly, isLocalTime, isOverdue, localWeekday, nextOccurrence, parseChineseTask, wallTimeToInstant, instantToWallTime } from './recurrence.ts';
import type { RecurrenceSchedule } from './recurrence.ts';
const dates = (s: RecurrenceSchedule, q = {}) => getOccurrences(s, q).map(o => o.date);
const daily: RecurrenceSchedule = { start: { date: '2026-10-07' }, rule: { frequency: 'daily' } };
test('validates real Gregorian dates including leap years and years below 100', () => {
  assert.equal(isDateOnly('2024-02-29'), true); assert.equal(isDateOnly('2025-02-29'), false);
  assert.equal(isDateOnly('0004-02-29'), true); assert.equal(isDateOnly('0000-01-01'), false);
  assert.equal(isDateOnly('2026-4-01'), false); assert.equal(isDateOnly('2026-04-31'), false);
});
test('local date arithmetic has no host timezone dependency', () => {
  assert.equal(addLocalDays('2024-02-28', 2), '2024-03-01');
  assert.equal(addLocalDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addLocalDays('0099-12-31', 1), '0100-01-01');
  assert.equal(localWeekday('2026-10-07'), 3);
});
test('month addition clamps and allows explicitly restoring preferred day', () => {
  assert.equal(addLocalMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addLocalMonths('2026-02-28', 1, 31), '2026-03-31');
  assert.equal(addLocalMonths('2026-01-31', -1), '2025-12-31');
});
test('daily interval and inclusive date range', () => {
  assert.deepEqual(dates({ ...daily, rule: { frequency: 'daily', interval: 2 } }, { from: '2026-10-08', through: '2026-10-13' }), ['2026-10-09', '2026-10-11', '2026-10-13']);
});
test('count includes excluded slots', () => {
  assert.deepEqual(dates({ ...daily, end: { count: 3 }, exclusions: ['2026-10-08'] }), ['2026-10-07', '2026-10-09']);
});
test('count and date bounds combine with whichever comes first', () => {
  assert.deepEqual(dates({ ...daily, end: { count: 10, date: '2026-10-09' } }), ['2026-10-07', '2026-10-08', '2026-10-09']);
  assert.deepEqual(dates({ ...daily, end: { count: 1, date: '2026-10-09' } }), ['2026-10-07']);
  assert.deepEqual(dates(daily, { through: '2026-10-06' }), []);
});
test('weekly selected weekdays are chronological and deduplicated', () => {
  assert.deepEqual(dates({ ...daily, rule: { frequency: 'weekly', weekdays: [5, 1, 5] } }, { limit: 4 }), ['2026-10-09', '2026-10-12', '2026-10-16', '2026-10-19']);
});
test('weekly interval skips entire calendar week blocks', () => {
  assert.deepEqual(dates({ ...daily, rule: { frequency: 'weekly', weekdays: [1, 5], interval: 2 } }, { limit: 4 }), ['2026-10-09', '2026-10-19', '2026-10-23', '2026-11-02']);
});
test('weekly respects customized week start', () => {
  assert.deepEqual(dates({ start: { date: '2026-10-10' }, rule: { frequency: 'weekly', weekdays: [0, 6], interval: 2, weekStartsOn: 0 } }, { limit: 3 }), ['2026-10-10', '2026-10-18', '2026-10-24']);
});
test('default weekly uses start weekday', () => {
  assert.deepEqual(dates({ ...daily, rule: { frequency: 'weekly', interval: 2 } }, { limit: 3 }), ['2026-10-07', '2026-10-21', '2026-11-04']);
});
test('monthly day 31 clamps without drifting to day 28', () => {
  assert.deepEqual(dates({ start: { date: '2026-01-31' }, rule: { frequency: 'monthly' } }, { limit: 4 }), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});
test('monthly explicit day can begin after start and supports interval', () => {
  assert.deepEqual(dates({ ...daily, rule: { frequency: 'monthly', day: 15, interval: 2 } }, { limit: 3 }), ['2026-10-15', '2026-12-15', '2027-02-15']);
});
test('monthly third weekday', () => {
  assert.deepEqual(dates({ start: { date: '2026-01-01' }, rule: { frequency: 'monthly', nthWeekday: { nth: 3, weekday: 1 } } }, { limit: 3 }), ['2026-01-19', '2026-02-16', '2026-03-16']);
});
test('monthly last weekday', () => {
  assert.deepEqual(dates({ start: { date: '2026-01-01' }, rule: { frequency: 'monthly', nthWeekday: { nth: -1, weekday: 5 } } }, { limit: 3 }), ['2026-01-30', '2026-02-27', '2026-03-27']);
});
test('missing fifth weekday skips month and does not consume count', () => {
  assert.deepEqual(dates({ start: { date: '2026-01-01' }, rule: { frequency: 'monthly', nthWeekday: { nth: 5, weekday: 1 } }, end: { count: 2 } }), ['2026-03-30', '2026-06-29']);
});
test('yearly leap-day clamp restores leap day in leap years', () => {
  assert.deepEqual(dates({ start: { date: '2024-02-29' }, rule: { frequency: 'yearly' } }, { limit: 5 }), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
});
test('yearly explicit month/day and custom interval', () => {
  assert.deepEqual(dates({ ...daily, rule: { frequency: 'yearly', month: 12, day: 31, interval: 2 } }, { limit: 3 }), ['2026-12-31', '2028-12-31', '2030-12-31']);
});
test('explicit dates sort, deduplicate, filter before start and apply exclusions', () => {
  assert.deepEqual(dates({ ...daily, rule: { frequency: 'dates', dates: ['2026-10-09', '2026-10-07', '2026-10-07', '2026-10-06', '2026-10-11'] }, exclusions: ['2026-10-09'] }), ['2026-10-07', '2026-10-11']);
});
test('wall clock and timezone survive DST', () => {
  const s: RecurrenceSchedule = { start: { date: '2026-03-07', time: '09:00', timeZone: 'America/New_York' }, rule: { frequency: 'daily' } };
  assert.deepEqual(getOccurrences(s, { limit: 3 }), [7, 8, 9].map(d => ({ date: `2026-03-0${d}`, time: '09:00', timeZone: 'America/New_York' })));
});
test('completion-relative daily interval resets anchor and clock', () => {
  assert.deepEqual(getOccurrences({ ...daily, start: { ...daily.start, time: '08:00' }, rule: { frequency: 'daily', interval: 3 }, completionRelative: true }, { completedAt: { date: '2026-10-09', time: '14:30' }, limit: 2 }), [{ date: '2026-10-12', time: '14:30' }, { date: '2026-10-15', time: '14:30' }]);
});
test('completion-relative monthly cadence clamps and counts prior completions', () => {
  assert.deepEqual(dates({ start: { date: '2026-01-01' }, rule: { frequency: 'monthly' }, completionRelative: true, end: { count: 3 } }, { completedAt: { date: '2026-01-31' }, completedCount: 1 }), ['2026-02-28', '2026-03-31']);
  assert.deepEqual(dates({ ...daily, completionRelative: true, end: { count: 2 } }, { completedAt: { date: '2026-10-09' }, completedCount: 2 }), []);
});
test('completion-relative weekly default follows actual completion weekday', () => {
  assert.equal(nextOccurrence({ ...daily, rule: { frequency: 'weekly', interval: 2 }, completionRelative: true }, { completedAt: { date: '2026-10-09' } })?.date, '2026-10-23');
});
test('all-day overdue compares only local date', () => {
  assert.equal(isOverdue({ date: '2026-10-07', timeZone: 'Asia/Shanghai' }, { date: '2026-10-07', time: '23:59', timeZone: 'Asia/Shanghai' }), false);
  assert.equal(isOverdue({ date: '2026-10-06' }, { date: '2026-10-07' }), true);
  assert.equal(isOverdue({ date: '2026-10-08' }, { date: '2026-10-07' }), false);
});
test('timed overdue normalizes seconds and equality', () => {
  assert.equal(isOverdue({ date: '2026-10-07', time: '09:00' }, { date: '2026-10-07', time: '09:00:00' }), false);
  assert.equal(isOverdue({ date: '2026-10-07', time: '09:00' }, { date: '2026-10-07', time: '09:00:01' }), true);
  assert.equal(isOverdue({ date: '2026-10-07', time: '09:01' }, { date: '2026-10-07', time: '09:00:59' }), false);
});
test('invalid rules and date/time inputs fail explicitly', () => {
  assert.throws(() => dates({ ...daily, rule: { frequency: 'daily', interval: 0 } }), /Interval/);
  assert.throws(() => dates({ ...daily, rule: { frequency: 'weekly', weekdays: [] } }), /weekday/);
  assert.throws(() => dates({ ...daily, rule: { frequency: 'monthly', day: 31, nthWeekday: { nth: 1, weekday: 1 } } }), /not both/);
  assert.throws(() => dates({ ...daily, end: { count: 0 } }), /Count/);
  assert.throws(() => dates({ ...daily, start: { date: '2026-02-30' } }), /Invalid local date/);
  assert.throws(() => dates({ ...daily, start: { ...daily.start, timeZone: 'Mars/Olympus' } }), /timezone/);
  assert.throws(() => dates({ ...daily, rule: { frequency: 'dates', dates: [] }, completionRelative: true }), /cannot/);
  assert.equal(isLocalTime('24:00'), false);
});
test('invalid query and timezone comparisons fail explicitly', () => {
  assert.throws(() => dates(daily, { limit: 0 }), /Limit/);
  assert.throws(() => dates(daily, { limit: 10001 }), /10000/);
  assert.throws(() => dates(daily, { completedAt: { date: '2026-10-08' } }), /completion-relative/);
  assert.throws(() => dates({ ...daily, completionRelative: true }, { completedAt: { date: '2026-10-06' } }), /precede/);
  assert.throws(() => isOverdue({ date: '2026-10-07', time: '09:00' }, { date: '2026-10-07' }), /Current local time/);
  assert.throws(() => isOverdue({ date: '2026-10-07', timeZone: 'UTC' }, { date: '2026-10-07', timeZone: 'Asia/Shanghai' }), /same timezone/);
});
test('Chinese basic parser extracts title, tomorrow, time, priority and tags', () => {
  assert.deepEqual(parseChineseTask('明天 09:30 提交方案 !1 #工作 #方案 #工作', { today: '2026-10-07', timeZone: 'Asia/Shanghai' }), { title: '提交方案', due: { date: '2026-10-08', time: '09:30', timeZone: 'Asia/Shanghai' }, priority: 1, tags: ['工作', '方案'], unsupported: [] });
});
test('Chinese today and day-after-tomorrow cross month/year correctly', () => {
  assert.equal(parseChineseTask('今天 买菜', { today: '2026-12-31' }).due?.date, '2026-12-31');
  assert.equal(parseChineseTask('后天 买菜', { today: '2026-12-31' }).due?.date, '2027-01-02');
});
test('Chinese weekday means next matching weekday including today', () => {
  assert.equal(parseChineseTask('周三 开会', { today: '2026-10-07' }).due?.date, '2026-10-07');
  assert.equal(parseChineseTask('星期二 开会', { today: '2026-10-07' }).due?.date, '2026-10-13');
  assert.equal(parseChineseTask('周天 休息', { today: '2026-10-07' }).due?.date, '2026-10-11');
});
test('explicit date/time and priorities 2/3', () => {
  assert.deepEqual(parseChineseTask('复盘 2026-11-15 18:05 !2 #学习', { today: '2026-10-07' }), { title: '复盘', due: { date: '2026-11-15', time: '18:05' }, priority: 2, tags: ['学习'], unsupported: [] });
  assert.equal(parseChineseTask('18:05 复盘 !3', { today: '2026-10-07' }).due?.date, '2026-10-07');
  assert.equal(parseChineseTask('复盘 !3', { today: '2026-10-07' }).priority, 3);
});
test('conflicting tokens and invalid dates/times stay visible for review', () => {
  const result = parseChineseTask('今天 明天 2026-02-30 25:00 !1 !2 复盘', { today: '2026-10-07' });
  assert.equal(result.due, undefined); assert.equal(result.priority, undefined);
  assert.equal(result.unsupported.length, 3); assert.match(result.title, /2026-02-30/);
  assert.match(parseChineseTask('2026-02-30 复盘', { today: '2026-10-07' }).unsupported[0], /无效日期/);
});
test('holidays, lunar calendar and complex natural-language recurrence explicitly unsupported', () => {
  assert.match(parseChineseTask('春节前 买票', { today: '2026-10-07' }).unsupported.join(' '), /自然语言尚不解析/);
  assert.match(parseChineseTask('每月最后一个工作日 报销', { today: '2026-10-07' }).unsupported.join(' '), /不支持复杂/);
  assert.equal(parseChineseTask('下周三 复盘', { today: '2026-10-07' }).due, undefined);
  assert.match(parseChineseTask('下午3点 复盘', { today: '2026-10-07' }).unsupported.join(' '), /HH:mm/);
});

test('unsupported recurrence phrases cannot leak a bogus due date', () => {
  for (const title of ['每周三 开会', '上周三 复盘', '本周三 复盘', '下下周三 复盘', '每2天 跑步', '三天后 出发']) {
    const result = parseChineseTask(title, { today: '2026-10-07' });
    assert.equal(result.due, undefined, title); assert.ok(result.unsupported.length > 0, title);
    assert.equal(result.title, title);
  }
});
test('parser refuses partial seconds-based times', () => {
  const result = parseChineseTask('12:30:20 复盘', { today: '2026-10-07' });
  assert.equal(result.due, undefined); assert.match(result.unsupported[0], /HH:mm/);
});

test('timezone instant conversion of an ordinary Shanghai deadline round-trips', () => {
  const wall = { date: '2026-10-07', time: '09:30:00', timeZone: 'Asia/Shanghai' };
  assert.equal(wallTimeToInstant(wall), '2026-10-07T01:30:00Z');
  assert.deepEqual(instantToWallTime('2026-10-07T01:30:00Z', 'Asia/Shanghai'), wall);
  assert.deepEqual(instantToWallTime(Date.parse('2026-10-07T01:30:00Z'), 'Asia/Shanghai'), wall);
});
test('DST fold deterministic earlier/later and reject', () => {
  const wall = { date: '2026-11-01', time: '01:30', timeZone: 'America/New_York' };
  assert.equal(wallTimeToInstant(wall, 'earlier'), '2026-11-01T05:30:00Z');
  assert.equal(wallTimeToInstant(wall, 'later'), '2026-11-01T06:30:00Z');
  assert.equal(wallTimeToInstant(wall, 'compatible'), '2026-11-01T05:30:00Z');
  assert.throws(() => wallTimeToInstant(wall), RangeError);
});
test('DST gap deterministic backward/forward shifts and reject', () => {
  const wall = { date: '2026-03-08', time: '02:30', timeZone: 'America/New_York' };
  assert.equal(wallTimeToInstant(wall, 'earlier'), '2026-03-08T06:30:00Z');
  assert.equal(wallTimeToInstant(wall, 'later'), '2026-03-08T07:30:00Z');
  assert.equal(wallTimeToInstant(wall, 'compatible'), '2026-03-08T07:30:00Z');
  assert.throws(() => wallTimeToInstant(wall, 'reject'), RangeError);
  assert.equal(instantToWallTime(wallTimeToInstant(wall, 'later'), wall.timeZone).time, '03:30:00');
});
test('timezone conversion handles half-hour DST, quarter-hour offsets, skipped day', () => {
  const gap = { date: '2026-10-04', time: '02:15', timeZone: 'Australia/Lord_Howe' };
  assert.equal(wallTimeToInstant(gap, 'earlier'), '2026-10-03T15:15:00Z');
  assert.equal(wallTimeToInstant(gap, 'later'), '2026-10-03T15:45:00Z');
  assert.equal(wallTimeToInstant({ date: '2026-10-07', time: '12:00', timeZone: 'Asia/Kathmandu' }), '2026-10-07T06:15:00Z');
  const skipped = { date: '2011-12-30', time: '12:00', timeZone: 'Pacific/Apia' };
  assert.equal(wallTimeToInstant(skipped, 'earlier'), '2011-12-29T22:00:00Z');
  assert.equal(wallTimeToInstant(skipped, 'later'), '2011-12-30T22:00:00Z');
  assert.throws(() => wallTimeToInstant(skipped), RangeError);
});
test('all-day dates and unzoned values cannot silently become UTC instants', () => {
  assert.throws(() => wallTimeToInstant({ date: '2026-10-07', timeZone: 'UTC' }), /all-day/);
  assert.throws(() => wallTimeToInstant({ date: '2026-10-07', time: '09:30' }), /timezone/);
  assert.throws(() => instantToWallTime('2026-10-07T09:30:00', 'UTC'), RangeError);
});
test('Chinese workday recurrence includes official Sunday makeup work and skips holidays', () => {
  assert.deepEqual(dates({ start: { date: '2026-01-01' }, rule: { frequency: 'chinese-workday' } }, { limit: 4 }), ['2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07']);
  assert.deepEqual(dates({ start: { date: '2026-10-01' }, rule: { frequency: 'chinese-workday' } }, { limit: 4 }), ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-12']);
});
test('Chinese workday interval counts eligible slots and completion interval does too', () => {
  assert.deepEqual(dates({ start: { date: '2026-10-08' }, rule: { frequency: 'chinese-workday', interval: 3 } }, { limit: 3 }), ['2026-10-08', '2026-10-12', '2026-10-15']);
  assert.deepEqual(dates({ start: { date: '2026-10-08' }, rule: { frequency: 'chinese-workday', interval: 3 }, completionRelative: true }, { completedAt: { date: '2026-10-08' }, limit: 2 }), ['2026-10-12', '2026-10-15']);
});
test('Chinese restday/weekend recurrence respects makeup workdays', () => {
  assert.deepEqual(dates({ start: { date: '2026-10-08' }, rule: { frequency: 'chinese-restday' } }, { limit: 3 }), ['2026-10-11', '2026-10-17', '2026-10-18']);
  assert.deepEqual(dates({ start: { date: '2026-10-01' }, rule: { frequency: 'chinese-weekend' } }, { limit: 3 }), ['2026-10-03', '2026-10-04', '2026-10-11']);
});
test('daily date filter skips restdays while COUNT still counts original slots', () => {
  assert.deepEqual(dates({ start: { date: '2026-10-08' }, rule: { frequency: 'daily' }, dayFilter: 'workday', end: { count: 5 } }), ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-12']);
});
test('bounded Chinese recurrence stops at known year end; unknown next year throws', () => {
  assert.deepEqual(dates({ start: { date: '2026-12-30' }, rule: { frequency: 'chinese-workday' } }, { through: '2026-12-31' }), ['2026-12-30', '2026-12-31']);
  assert.throws(() => dates({ start: { date: '2026-12-31' }, rule: { frequency: 'chinese-workday' } }, { limit: 2 }), /未覆盖 2027/);
});
test('lunar yearly anniversary derives actual Gregorian dates and retains wall clock', () => {
  assert.deepEqual(getOccurrences({ start: { date: '2025-01-01', time: '09:00', timeZone: 'Asia/Shanghai' }, rule: { frequency: 'lunar-yearly', month: 8, day: 15 } }, { limit: 2 }), [{ date: '2025-10-06', time: '09:00', timeZone: 'Asia/Shanghai' }, { date: '2026-09-25', time: '09:00', timeZone: 'Asia/Shanghai' }]);
});
test('lunar anniversary leap fallback is explicit and exclusions apply', () => {
  assert.deepEqual(dates({ start: { date: '2025-01-29' }, rule: { frequency: 'lunar-yearly', month: 6, day: 1, leapMonth: true, missingLeapMonth: 'regular' }, exclusions: ['2025-07-25'], end: { count: 2 } }), ['2026-07-14']);
});

test('Chinese recurrence queries reject unknown coverage even with count bounds or filters', () => {
  const schedule: RecurrenceSchedule = { start: { date: '2026-10-08' }, rule: { frequency: 'chinese-workday' } };
  assert.throws(() => dates(schedule, { from: '2027-01-01', limit: 1 }), /未覆盖 2027/);
  assert.throws(() => dates(schedule, { through: '2027-01-01', limit: 1 }), /未覆盖 2027/);
  assert.throws(() => dates({ ...schedule, end: { date: '2027-01-01', count: 1 } }), /未覆盖 2027/);
  assert.throws(() => dates({ start: { date: '2027-01-01' }, rule: { frequency: 'daily' }, dayFilter: 'workday' }, { limit: 1 }), /未覆盖 2027/);
});
test('lunar recurrence rejects explicit query bounds beyond supported runtime range', () => {
  const schedule: RecurrenceSchedule = { start: { date: '2026-10-08' }, rule: { frequency: 'lunar-yearly', month: 8, day: 15 } };
  assert.throws(() => dates(schedule, { through: '2200-01-01' }), /1900–2100/);
});
