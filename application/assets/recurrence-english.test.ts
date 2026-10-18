import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguagePreference } from '../lib/i18n.ts';
import { parseChineseTask } from './recurrence.ts';
const options = { today: '2026-10-07', timeZone: 'America/New_York' };
afterEach(() => setLanguagePreference('system'));

test('English relative dates are case insensitive and preserve user task/tag text', () => {
  setLanguagePreference('en');
  for (const [token, date] of [['TODAY', '2026-10-07'], ['Tomorrow', '2026-10-08'], ['Day After Tomorrow', '2026-10-09']]) {
    assert.deepEqual(parseChineseTask(`${token} 9:30 提交方案 !1 #工作 #Monday`, options), { title: '提交方案', due: { date, time: '09:30', timeZone: 'America/New_York' }, priority: 1, tags: ['工作', 'Monday'], unsupported: [] });
  }
  assert.equal(parseChineseTask('day after tomorrow Plan', { today: '2026-12-31' }).due?.date, '2027-01-02');
  assert.equal(parseChineseTask('tomorrow Plan', { today: '2024-02-28' }).due?.date, '2024-02-29');
});

test('English weekdays choose the nearest date including today', () => {
  const expected = ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
  for (const [i, weekday] of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].entries()) {
    assert.equal(parseChineseTask(`${weekday.toUpperCase()} Team sync`, options).due?.date, expected[i]);
  }
});

test('English tokens require Unicode word boundaries and are not extracted from tags', () => {
  for (const title of ['Tomorrowland mondayish today_notes', '中文tomorrow中文', 'Wednesday2']) {
    const result = parseChineseTask(title, options); assert.equal(result.title, title); assert.equal(result.due, undefined);
  }
  assert.deepEqual(parseChineseTask('Review #weekly #tomorrow', options), { title: 'Review', tags: ['weekly', 'tomorrow'], unsupported: [] });
});

test('unsupported week-boundary and recurring English phrases remain intact without a fake due date', () => {
  setLanguagePreference('en');
  for (const title of ['next Monday Review', 'last week Monday Review', 'this Friday Review', 'next-week Tuesday 09:30 Review', 'every Wednesday 09:30 Review', 'every two weeks Monday Review', 'each day Review', 'weekly Review', 'monthly Review', 'daily Review']) {
    const result = parseChineseTask(title, options);
    assert.equal(result.title, title, title); assert.equal(result.due, undefined, title);
    assert.match(result.unsupported.join(' '), /not supported/i, title);
  }
});

test('English and mixed date/time conflicts warn without removing date/time text', () => {
  setLanguagePreference('en');
  for (const title of ['today tomorrow 09:00 Review', 'Monday 2026-10-08 Review', '明天 today Review', 'tomorrow 09:00 10:00 Review']) {
    const result = parseChineseTask(title, options);
    assert.equal(result.title, title); assert.equal(result.due, undefined);
    assert.match(result.unsupported.join(' '), /Multiple (?:date|time) markers/);
  }
  assert.match(parseChineseTask('2026-02-30 Review', options).unsupported.join(' '), /Invalid date: 2026-02-30/);
  assert.match(parseChineseTask('25:00 Review', options).unsupported.join(' '), /Invalid time: 25:00/);
});

test('both syntaxes work regardless of interface language with identical stored formats', () => {
  setLanguagePreference('zh-CN');
  const english = parseChineseTask('tomorrow 09:30 Submit #work !2', options);
  setLanguagePreference('en');
  assert.deepEqual(parseChineseTask('明天 09:30 Submit #work !2', options), english);
  assert.deepEqual(english.due, { date: '2026-10-08', time: '09:30', timeZone: 'America/New_York' });
  const unsupportedChinese = parseChineseTask('每周三 复盘', options);
  assert.equal(unsupportedChinese.due, undefined); assert.equal(unsupportedChinese.title, '每周三 复盘');
  assert.match(unsupportedChinese.unsupported.join(' '), /not supported/);
});
