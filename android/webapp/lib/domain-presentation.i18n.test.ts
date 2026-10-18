import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getLocale, setLanguagePreference } from './i18n.ts';
import { countdownAmount } from './countdown-format.ts';
import { countdownClock } from './countdown-clock.ts';
import { habitSummary } from './habit-metrics.ts';
import { calendarHolidayMark, holidaySources } from './calendar-holidays.ts';
import { activityItems } from './activity.ts';
import { CHINESE_HOLIDAY_YEARS } from '../assets/chinese-calendar.ts';

afterEach(() => setLanguagePreference('system'));

test('Node domain presentation keeps canonical Chinese by default', () => {
  assert.equal(getLocale(), 'zh-CN');
  assert.equal(countdownAmount('2026-10-07', '2026-10-08').label, '天');
  assert.equal(countdownAmount('2026-10-07', '2026-10-15', 'weeks').remainder, '余 1 天');
});

test('English countdown labels agree with zero, singular and plural amounts', () => {
  setLanguagePreference('en');
  for (const [end, value, label] of [['2026-01-01', 0, 'days'], ['2026-01-02', 1, 'day'], ['2026-01-03', 2, 'days']] as const) {
    const result = countdownAmount('2026-01-01', end);
    assert.equal(result.value, value); assert.equal(result.label, label);
  }
  assert.equal(countdownAmount('2026-01-01', '2026-01-08', 'weeks').label, 'week');
  assert.equal(countdownAmount('2026-01-01', '2026-01-15', 'weeks').label, 'weeks');
  assert.equal(countdownAmount('2026-01-01', '2026-02-01', 'months').label, 'month');
  assert.equal(countdownAmount('2026-01-01', '2026-03-01', 'months').label, 'months');
  assert.equal(countdownAmount('2026-01-01', '2027-01-01', 'years').label, 'year');
  assert.equal(countdownAmount('2026-01-01', '2028-01-01', 'years').label, 'years');
  assert.equal(countdownAmount('2026-01-01', '2026-01-09', 'weeks').remainder, '1 day remaining');
  assert.equal(countdownAmount('2026-01-01', '2027-03-03', 'years').remainder, '2 months 2 days remaining');
  setLanguagePreference('zh-CN');
  assert.equal(countdownAmount('2026-01-01', '2027-03-03', 'years').remainder, '余 2 月 2 天');
});

test('countdown target formats its real instant in the selected zone across locale changes', () => {
  const data = { dueDate: '2026-01-02', dueTime: '00:30', timezone: 'Pacific/Kiritimati' };
  const before = JSON.stringify(data);
  setLanguagePreference('en');
  const result = countdownClock(data, Date.parse('2025-12-31T10:30:00Z'));
  assert.equal(result.instant, '2026-01-01T10:30:00Z');
  assert.equal(result.date, '2026-01-02');
  assert.equal(result.value, '1 day 00:00:00');
  assert.match(result.remainder, /^Target Jan 2, 2026, 12:30 AM · Pacific\/Kiritimati$/);
  const two = countdownClock(data, Date.parse('2025-12-30T10:30:00Z'));
  assert.equal(two.value, '2 days 00:00:00');
  setLanguagePreference('zh-CN');
  const chinese = countdownClock(data, Date.parse('2025-12-31T10:30:00Z'));
  assert.equal(chinese.instant, result.instant); assert.equal(chinese.seconds, result.seconds);
  assert.match(chinese.remainder, /^目标 /); assert.equal(JSON.stringify(data), before);
});

test('habit streak units pluralize and labels change without changing metrics', () => {
  const habit: any = { id: 'h', data: { target: 1, habitPeriod: 'week' } };
  const log = (date: string): any => ({ id: 'habitlog:h:' + date, kind: 'habitLog', revision: 1, updatedAt: 'now', data: { habitId: 'h', date, value: 1 } });
  setLanguagePreference('en');
  assert.equal(habitSummary(habit, [], '2026-10-07').streakUnit, 'weeks');
  assert.equal(habitSummary(habit, [log('2026-10-07')], '2026-10-07').streakUnit, 'week');
  const two = habitSummary(habit, [log('2026-10-07'), log('2026-09-30')], '2026-10-07');
  assert.equal(two.streakUnit, 'weeks'); assert.equal(two.rateLabel, '4-week goal rate');
  habit.data.habitPeriod = 'day';
  assert.equal(habitSummary(habit, [log('2026-10-07')], '2026-10-07').streakUnit, 'completion');
  const daily = habitSummary(habit, [log('2026-10-07'), log('2026-10-06')], '2026-10-07');
  assert.equal(daily.streakUnit, 'completions'); assert.equal(daily.rateLabel, '30-day completion rate');
  setLanguagePreference('zh-CN');
  assert.equal(habitSummary(habit, [], '2026-10-07').streakUnit, '次');
});

test('holiday marks translate while official calendar dates and source URLs remain unchanged', () => {
  const before = JSON.stringify(CHINESE_HOLIDAY_YEARS), sources = [...holidaySources(2026)];
  setLanguagePreference('en');
  assert.deepEqual(calendarHolidayMark('2026-10-07'), { kind: 'holiday', label: 'Off', name: 'National Day', date: '2026-10-07' });
  assert.deepEqual(calendarHolidayMark('2026-10-10'), { kind: 'makeup', label: 'Work', name: 'Make-up workday', date: '2026-10-10' });
  assert.equal(calendarHolidayMark('2025-10-06')?.name, 'National Day / Mid-Autumn Festival');
  assert.equal(JSON.stringify(CHINESE_HOLIDAY_YEARS), before); assert.deepEqual(holidaySources(2026), sources);
  setLanguagePreference('zh-CN'); assert.equal(calendarHolidayMark('2026-10-07')?.name, '国庆节');
});

test('activity translates only app-owned text and never task titles, authors or comments', () => {
  const state: any = { user: { userId: 'me', displayName: 'Me' }, records: [{ id: 't', kind: 'task', data: { title: '今天', comments: [{ id: 'c', author: '新增了任务', authorId: 'other', text: '完成了任务 中文 English', mentions: ['me'], createdAt: '2026-10-07T10:00:00Z' }] } }], history: [{ id: 'h', recordId: 't', actorId: 'other', action: 'complete', createdAt: '2026-10-07T11:00:00Z' }] };
  const before = JSON.stringify(state);
  setLanguagePreference('en');
  const items = activityItems(state, {});
  assert.equal(items[0].message, 'Completed the task'); assert.equal(items[0].title, '今天');
  assert.equal(items[1].message, 'Mentioned you · 新增了任务: 完成了任务 中文 English'); assert.equal(items[1].title, '今天');
  assert.equal(JSON.stringify(state), before);
  setLanguagePreference('zh-CN');
  assert.equal(activityItems(state, {})[1].message, '提及了你 · 新增了任务：完成了任务 中文 English');
});
