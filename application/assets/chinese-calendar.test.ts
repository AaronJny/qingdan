/** Run: node --experimental-strip-types --test assets/chinese-calendar.test.ts */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CalendarCoverageError, CHINESE_HOLIDAY_YEARS, CHINESE_HOLIDAY_COVERAGE, gregorianToLunar, isChineseRestDay, isChineseWorkday, lunarAnniversaryInYear, lunarMonthLength, lunarToGregorian, matchesChineseDay } from './chinese-calendar.ts';
const lunar = (year: number, month: number, day: number, leapMonth = false) => ({ year, month, day, leapMonth });
test('coverage metadata and verified source URLs are explicit and immutable', () => {
  assert.deepEqual(CHINESE_HOLIDAY_COVERAGE.years, [2025, 2026]);
  assert.equal(CHINESE_HOLIDAY_YEARS[2026].noticeNumber, '国办发明电〔2025〕7号');
  assert.ok(CHINESE_HOLIDAY_YEARS[2025].sourceUrls[0].startsWith('https://www.forestry.gov.cn/'));
  assert.ok(Object.isFrozen(CHINESE_HOLIDAY_YEARS[2026].holidayRanges[0]));
});
test('2025 makeup workdays override Saturday/Sunday and holidays override weekdays', () => {
  for (const date of ['2025-01-26', '2025-02-08', '2025-04-27', '2025-09-28', '2025-10-11']) assert.equal(isChineseWorkday(date), true, date);
  for (const date of ['2025-01-01', '2025-01-28', '2025-02-04', '2025-04-04', '2025-05-05', '2025-06-02', '2025-10-08']) assert.equal(isChineseWorkday(date), false, date);
  assert.equal(isChineseWorkday('2025-10-09'), true);
});
test('2026 makeup workdays and all holiday range boundaries', () => {
  for (const date of ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10']) assert.equal(isChineseWorkday(date), true, date);
  for (const [start, end] of CHINESE_HOLIDAY_YEARS[2026].holidayRanges) { assert.equal(isChineseWorkday(start), false, start); assert.equal(isChineseWorkday(end), false, end); }
  assert.equal(isChineseWorkday('2026-10-08'), true);
});
test('rest days and real weekends are distinct and honor makeup overrides', () => {
  assert.equal(isChineseRestDay('2026-10-01'), true);
  assert.equal(matchesChineseDay('2026-10-01', 'weekend'), false);
  assert.equal(matchesChineseDay('2026-10-03', 'weekend'), true);
  assert.equal(matchesChineseDay('2026-10-10', 'weekend'), false);
  assert.equal(matchesChineseDay('2026-10-11', 'weekend'), true);
});
test('unpublished years never fall back to ordinary weekday guessing', () => {
  assert.throws(() => isChineseWorkday('2027-01-04'), CalendarCoverageError);
  assert.throws(() => isChineseRestDay('2024-01-01'), CalendarCoverageError);
  assert.throws(() => matchesChineseDay('2027-01-03', 'weekend'), CalendarCoverageError);
  assert.throws(() => isChineseWorkday('2026-02-30'), /Invalid Gregorian/);
});
// Fixtures verified against HKO official Gregorian/lunar tables linked in coverage.
test('HKO 2025/2026 lunar conversion fixtures include year boundary and leap month', () => {
  assert.deepEqual(gregorianToLunar('2025-01-29'), lunar(2025, 1, 1));
  assert.deepEqual(gregorianToLunar('2025-07-24'), lunar(2025, 6, 30));
  assert.deepEqual(gregorianToLunar('2025-07-25'), lunar(2025, 6, 1, true));
  assert.deepEqual(gregorianToLunar('2025-08-23'), lunar(2025, 7, 1));
  assert.deepEqual(gregorianToLunar('2026-02-16'), lunar(2025, 12, 29));
  assert.deepEqual(gregorianToLunar('2026-02-17'), lunar(2026, 1, 1));
  assert.deepEqual(gregorianToLunar('2026-06-19'), lunar(2026, 5, 5));
  assert.deepEqual(gregorianToLunar('2026-09-25'), lunar(2026, 8, 15));
});
test('inverse lunar conversion distinguishes regular from leap months', () => {
  assert.equal(lunarToGregorian(lunar(2025, 6, 1)), '2025-06-25');
  assert.equal(lunarToGregorian(lunar(2025, 6, 1, true)), '2025-07-25');
  assert.equal(lunarToGregorian(lunar(2026, 8, 15)), '2026-09-25');
  assert.throws(() => lunarToGregorian(lunar(2026, 6, 1, true)), /不存在/);
});
test('all Gregorian dates in 2025 and 2026 round-trip through lunar and leap flags', () => {
  for (let millis = Date.parse('2025-01-01T00:00:00Z'); millis < Date.parse('2027-01-01T00:00:00Z'); millis += 86400000) {
    const date = new Date(millis).toISOString().slice(0, 10);
    assert.equal(lunarToGregorian(gregorianToLunar(date)), date);
  }
});
test('lunar invalid day/month/year and unsupported coverage error explicitly', () => {
  assert.throws(() => lunarToGregorian(lunar(2026, 13, 1)), /无效/);
  assert.throws(() => lunarToGregorian(lunar(2026, 1, 31)), /无效/);
  assert.throws(() => lunarToGregorian(lunar(1899, 1, 1)), CalendarCoverageError);
  assert.throws(() => gregorianToLunar('2200-01-01'), CalendarCoverageError);
  assert.throws(() => gregorianToLunar('2026-04-31'), /Invalid Gregorian/);
});
test('lunar month lengths and anniversary invalid-day policy', () => {
  assert.equal(lunarMonthLength(2025, 6), 30);
  assert.equal(lunarMonthLength(2025, 6, true), 29);
  assert.equal(lunarAnniversaryInYear(2025, { month: 6, day: 30, leapMonth: true }), undefined);
  assert.equal(lunarAnniversaryInYear(2025, { month: 6, day: 30, leapMonth: true, invalidDay: 'clamp' }), '2025-08-22');
});
test('lunar leap birthday policy skips or falls back only when explicitly requested', () => {
  assert.equal(lunarAnniversaryInYear(2026, { month: 6, day: 1, leapMonth: true }), undefined);
  assert.equal(lunarAnniversaryInYear(2026, { month: 6, day: 1, leapMonth: true, missingLeapMonth: 'regular' }), '2026-07-14');
  assert.equal(lunarAnniversaryInYear(2025, { month: 6, day: 1, leapMonth: true }), '2025-07-25');
});
