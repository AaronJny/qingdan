import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CalendarCoverageError, CHINESE_HOLIDAY_YEARS, getChineseHolidayCoverage, getChineseHolidayYears, installVerifiedChineseHolidayYears, isChineseWorkday } from '../assets/chinese-calendar.ts';
import { CHINESE_HOLIDAY_SOURCE, chineseHolidayCalendarYears, emptyChineseHolidayCache, installChineseHolidayCache, isOfficialHolidayPaperUrl, parseChineseHolidayDocument, parseOfficialChineseHolidayPaper, refreshChineseHolidays, validateChineseHolidayCache, type HolidayFetcher } from './chinese-holiday-source.ts';
const read = (file: string) => readFileSync(new URL(`./fixtures/chinese-holiday/${file}`, import.meta.url), 'utf8');
const raw2025 = read('2025.json'), raw2026 = read('2026.json'), raw2027 = read('2027-unpublished.json'), official2026 = read('2026-official.html');
const now = new Date('2026-10-09T04:00:00Z'), tomorrow = new Date('2026-10-10T04:00:00Z');
const url = (year: number) => `${CHINESE_HOLIDAY_SOURCE}${year}.json`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const response = (text: string, status = 200, headers: Record<string, string> = {}) => ({ text, status, headers });
const fixtureFetcher: HolidayFetcher = async u => response(u === url(2025) ? raw2025 : u === url(2026) ? raw2026 : u === url(2027) ? raw2027 : official2026);
/** Synthetic future-year fixture, deliberately not a real 2027 holiday claim. */
function futureFixture(year = 2027, crossYear = false) {
  const data = JSON.parse(raw2026); data.year = year; data.$id = url(year); data.papers = [`https://www.gov.cn/zhengce/zhengceku/${year - 1}09/content_fixture.htm`];
  data.days = data.days.map((d: { date: string }) => ({ ...d, date: d.date.replace('2026', String(year)) }));
  let html = official2026.replaceAll('2026', String(year)).replaceAll('2025', String(year - 1)).replaceAll('11月04日', '9月30日').replaceAll('11月4日', '9月30日');
  if (crossYear) {
    data.days.unshift({ date: `${year - 1}-12-31`, name: '元旦', isOffDay: true });
    html = html.replace('1月1日（周四）至3日（周六）放假调休，共3天。', `${year - 1}年12月31日至${year}年1月3日放假调休，共4天。`);
  }
  return { data, raw: JSON.stringify(data), html, fetcher: (async u => response(u === url(year) ? JSON.stringify(data) : html)) as HolidayFetcher };
}

test('live-downloaded machine fixtures validate, and current future fixture is unpublished', () => {
  assert.equal(parseChineseHolidayDocument(raw2026, 2026).days.length, 39);
  assert.equal(parseChineseHolidayDocument(raw2025, 2025).days.length, 33);
  assert.deepEqual(parseChineseHolidayDocument(raw2027, 2027).days, []);
});
test('official offline fixture independently parses each of the 39 dates', () => {
  const parsed = parseOfficialChineseHolidayPaper(official2026, 2026, '2026-10-09');
  assert.equal(parsed.publishedDate, '2025-11-04'); assert.equal(parsed.noticeNumber, '国办发明电〔2025〕7号');
  assert.deepEqual(parsed.days, parseChineseHolidayDocument(raw2026, 2026).days);
});
test('rolling refresh uses three machine requests and accepts immutable baselines without official HTTP', async () => {
  const calls: string[] = []; const result = await refreshChineseHolidays({ now, fetcher: async (u, o) => { calls.push(u); return fixtureFetcher(u, o); } });
  assert.deepEqual(calls, [url(2025), url(2026), url(2027)]);
  assert.deepEqual(result.results.map(r => r.status), ['updated', 'updated', 'unpublished']);
  assert.deepEqual(result.requests, { machine: 3, official: 0 });
  assert.equal(result.cache.years[2026].verification, 'builtin-baseline'); assert.deepEqual(result.cache.years[2026].officialEvidence, []);
  assert.deepEqual(validateChineseHolidayCache(JSON.parse(JSON.stringify(result.cache)), now), result.cache);
});
test('rollover is based on Asia/Shanghai, and a caller cannot expand a single-run request budget', async () => {
  const result = await refreshChineseHolidays({ now: new Date('2026-12-31T16:01:00Z'), fetcher: async u => response(JSON.stringify({ year: Number(u.slice(-9, -5)), papers: [], days: [] })) });
  assert.deepEqual(result.results.map(r => r.year), [2026, 2027, 2028]);
  await assert.rejects(refreshChineseHolidays({ years: [2025, 2026, 2027, 2028], now, fetcher: fixtureFetcher }), /一至三个/);
  await assert.rejects(refreshChineseHolidays({ years: [2026, 2026], now, fetcher: fixtureFetcher }), /一至三个/);
});
test('unpublished years remain uncovered and do not get weekday-based statutory rules', async () => {
  const result = await refreshChineseHolidays({ years: [2027], now, fetcher: fixtureFetcher }); installChineseHolidayCache(result.cache, now);
  assert.equal(result.results[0].status, 'unpublished'); assert.equal(getChineseHolidayYears()[2027], undefined);
  assert.throws(() => isChineseWorkday('2027-01-04'), CalendarCoverageError); installVerifiedChineseHolidayYears([]);
});
test('every schema boundary rejects malformed values and duplicate dates', () => {
  const original = JSON.parse(raw2026);
  const mutations: ((v: any) => void)[] = [v => { v.year = 2027; }, v => { v.extra = true; }, v => { v.$id = url(2025); }, v => { v.days[0].date = '2026-02-30'; }, v => { v.days[0].date = '2025-11-30'; }, v => { v.days[0].date = '2027-01-01'; }, v => { v.days[0].isOffDay = 'true'; }, v => { v.days[0].name = '预测春节'; }, v => { v.days[0].extra = 1; }, v => { v.days.push(v.days[0]); }, v => { v.papers.push(v.papers[0]); }, v => { v.papers = []; }, v => { v.days = []; }];
  for (const mutate of mutations) { const data = structuredClone(original); mutate(data); assert.throws(() => parseChineseHolidayDocument(JSON.stringify(data), 2026)); }
  assert.throws(() => parseChineseHolidayDocument('{"year":2026,"year":2026,"papers":[],"days":[]}', 2026), /重复字段/);
  assert.throws(() => parseChineseHolidayDocument(raw2026.replace('"isOffDay": true', '"isOffDay": false, "isOffDay": true'), 2026), /重复字段/);
  assert.throws(() => parseChineseHolidayDocument('['.repeat(40), 2026), /JSON/);
  assert.throws(() => parseChineseHolidayDocument(' '.repeat(128 * 1024) + raw2026, 2026), /大小/);
});
test('official URL allowlist is boundary-aware and rejects credentials, query, insecure and non-government links', () => {
  assert.equal(isOfficialHolidayPaperUrl('https://www.gov.cn/zhengce/content_123.htm'), true);
  for (const value of ['https://gov.cn.evil.test/x.htm', 'https://evilgov.cn/x.htm', 'http://www.gov.cn/x.htm', 'https://u:p@www.gov.cn/x.htm', 'https://www.gov.cn:8443/x.htm', 'https://www.gov.cn/x.htm?redirect=1', 'https://www.gov.cn/x.htm#fake', 'https://127.0.0.1/x.htm', 'https://www.gov.cn/x.pdf']) assert.equal(isOfficialHolidayPaperUrl(value), false, value);
});
test('a synthetic future year is cached from the machine source without official HTTP', async () => {
  const future = futureFixture(); const result = await refreshChineseHolidays({ years: [2027], now, fetcher: future.fetcher });
  assert.equal(result.results[0].status, 'updated'); assert.equal(result.cache.years[2027].verification, 'machine-source'); assert.deepEqual(result.requests, { machine: 1, official: 0 });
  assert.deepEqual(result.cache.years[2027].officialEvidence, []);
  installChineseHolidayCache(result.cache, now); assert.equal(isChineseWorkday('2027-02-15'), false); assert.equal(getChineseHolidayCoverage().years.includes(2027), true); installVerifiedChineseHolidayYears([]);
});
test('new notice can modify previous December without granting coverage to an otherwise unknown year', async () => {
  const future = futureFixture(2027, true); const result = await refreshChineseHolidays({ years: [2027], now, fetcher: future.fetcher });
  assert.equal(result.results[0].status, 'updated'); const years = chineseHolidayCalendarYears(result.cache, now); assert.deepEqual(years.map(y => y.year), [2026, 2027]);
  installChineseHolidayCache(result.cache, now); assert.equal(isChineseWorkday('2026-12-31'), false); assert.equal(isChineseWorkday('2026-10-10'), true); assert.equal(isChineseWorkday('2027-01-03'), false); installVerifiedChineseHolidayYears([]);
});
test('machine omissions, additions, labels and work flags remain machine-source data', async () => {
  const mutators: ((v: any) => void)[] = [v => v.days.pop(), v => { v.days[0].isOffDay = false; }, v => { v.days[0].name = '国庆节'; }, v => v.days.push({ date: '2027-07-01', name: '元旦', isOffDay: true })];
  for (const mutate of mutators) {
    const fixture = futureFixture(); mutate(fixture.data);
    const result = await refreshChineseHolidays({ years: [2027], now, fetcher: fixture.fetcher });
    assert.equal(result.results[0].status, 'updated'); assert.equal(result.cache.years[2027].verification, 'machine-source'); assert.equal(result.requests.official, 0);
  }
});
test('changed baseline data is replaced from the machine source without official HTTP', async () => {
  const first = await refreshChineseHolidays({ years: [2026], now, fetcher: fixtureFetcher }); const altered = JSON.parse(raw2026); altered.days.pop();
  const second = await refreshChineseHolidays({ cache: first.cache, years: [2026], now: tomorrow, fetcher: async u => response(u === url(2026) ? JSON.stringify(altered) : official2026) });
  assert.equal(second.results[0].status, 'updated'); assert.notEqual(second.cache.years[2026].sourceHash, first.cache.years[2026].sourceHash); assert.equal(second.requests.official, 0);
});
test('known published empty data is withdrawal-suspected while old rules and proof survive', async () => {
  const first = await refreshChineseHolidays({ years: [2026], now, fetcher: fixtureFetcher });
  const second = await refreshChineseHolidays({ cache: first.cache, years: [2026], now: tomorrow, fetcher: async () => response('{"year":2026,"days":[],"papers":[]}') });
  assert.equal(second.results[0].code, 'withdrawal_suspected'); assert.deepEqual(second.cache.years[2026], first.cache.years[2026]);
  const cold = await refreshChineseHolidays({ years: [2025], now, fetcher: async () => response('{"year":2025,"days":[],"papers":[]}') }); assert.equal(cold.results[0].code, 'withdrawal_suspected');
});
test('invalid official title, unannounced future date, wrong day count and unknown instructions fail closed', () => {
  assert.throws(() => parseOfficialChineseHolidayPaper(official2026, 2027, '2026-10-09'), /对应年度/);
  assert.throws(() => parseOfficialChineseHolidayPaper(official2026, 2026, '2025-11-03'), /尚未发布/);
  assert.throws(() => parseOfficialChineseHolidayPaper(official2026.replace('共3天。', '共4天。'), 2026, '2026-10-09'), /天数/);
  assert.throws(() => parseOfficialChineseHolidayPaper(official2026.replace('1月4日（周日）上班。', '1月4日（周日）取消上班。'), 2026, '2026-10-09'), /完整解释/);
  assert.throws(() => parseOfficialChineseHolidayPaper('<title>国务院办公厅关于2026年部分节假日安排的通知</title>仅标题', 2026, '2026-10-09'), /编号或正文/);
});
test('with-weekend wording does not add unlisted Saturday or Sunday statutory dates', () => {
  const html = official2026.replace('6月19日（周五）至21日（周日）放假，共3天。', '6月19日（周五）放假，与周末连休。');
  const doc = parseOfficialChineseHolidayPaper(html, 2026, '2026-10-09');
  assert.ok(doc.days.some(d => d.date === '2026-06-19')); assert.ok(!doc.days.some(d => d.date === '2026-06-20' || d.date === '2026-06-21'));
});
test('machine response never follows static official URLs', async () => {
  const fixture = futureFixture(); let calls = 0;
  const first = await refreshChineseHolidays({ years: [2027], now, fetcher: async u => { calls++; return response(u === url(2027) ? fixture.raw : '', u === url(2027) ? 200 : 403); } });
  assert.equal(calls, 1); assert.equal(first.results[0].status, 'updated'); assert.equal(first.cache.origins['https://www.gov.cn'], undefined); assert.equal(first.cache.years[2027].verification, 'machine-source');
  calls = 0; const second = await refreshChineseHolidays({ cache: first.cache, years: [2027], now: tomorrow, fetcher: async u => { calls++; assert.equal(u, url(2027)); return response(fixture.raw); } });
  assert.equal(calls, 1); assert.equal(second.results[0].status, 'unchanged'); assert.equal(second.requests.official, 0);
});
test('machine-origin 403 prevents all remaining source requests in that run and subsequent runs', async () => {
  const first = await refreshChineseHolidays({ now, fetcher: async () => response('', 403) }); assert.equal(first.requests.machine, 1); assert.ok(first.results.every(r => r.status === 'blocked'));
  const second = await refreshChineseHolidays({ cache: first.cache, now: tomorrow, fetcher: async () => assert.fail('must not retry blocked origin') }); assert.equal(second.requests.machine, 0);
});
test('429 observes Retry-After seconds and applies a shared cooldown to every year on that origin', async () => {
  const first = await refreshChineseHolidays({ now, fetcher: async () => response('', 429, { 'Retry-After': '172800' }) });
  assert.equal(first.requests.machine, 1); assert.equal(first.cache.origins['https://raw.githubusercontent.com'].retryAt, '2026-10-11T04:00:00.000Z'); assert.ok(first.results.every(r => r.status === 'deferred'));
  const second = await refreshChineseHolidays({ cache: first.cache, now: tomorrow, fetcher: async () => assert.fail('must honor Retry-After') }); assert.equal(second.requests.machine, 0);
  const resumed = await refreshChineseHolidays({ cache: first.cache, now: new Date('2026-10-11T04:00:00Z'), fetcher: fixtureFetcher }); assert.equal(resumed.requests.machine, 3);
});
test('Retry-After HTTP dates are accepted, malformed or missing values default to one day', async () => {
  for (const [retryAfter, expected] of [['Sun, 11 Oct 2026 04:00:00 GMT', '2026-10-11T04:00:00.000Z'], ['nonsense', tomorrow.toISOString()], ['', tomorrow.toISOString()]]) {
    const result = await refreshChineseHolidays({ now, years: [2027], fetcher: async () => response('', 429, { 'retry-after': retryAfter }) }); assert.equal(result.results[0].retryAt, expected);
  }
});
test('multiple machine years advance without an official HTTP budget', async () => {
  const a = futureFixture(2027), b = futureFixture(2028); const fetcher: HolidayFetcher = async u => response(u === url(2027) ? a.raw : u === url(2028) ? b.raw : u === a.data.papers[0] ? a.html : b.html);
  const first = await refreshChineseHolidays({ now: new Date('2027-10-09Z'), years: [2027, 2028], fetcher }); assert.deepEqual(first.requests, { machine: 2, official: 0 }); assert.deepEqual(first.results.map(r => r.status), ['updated', 'updated']);
  const second = await refreshChineseHolidays({ cache: first.cache, now: new Date('2027-10-10Z'), years: [2027, 2028], fetcher }); assert.deepEqual(second.requests, { machine: 2, official: 0 }); assert.deepEqual(second.results.map(r => r.status), ['unchanged', 'unchanged']);
});
test('conditional 304 responses reuse only the exact body bound to the saved validator', async () => {
  const first = await refreshChineseHolidays({ years: [2026], now, fetcher: async () => response(raw2026, 200, { etag: '"safe"', 'last-modified': 'Wed, 01 Oct 2025 00:00:00 GMT' }) });
  const second = await refreshChineseHolidays({ cache: first.cache, years: [2026], now: tomorrow, fetcher: async (_u, options) => { assert.equal(options?.headers?.['If-None-Match'], '"safe"'); assert.ok(options?.headers?.['If-Modified-Since']); return response('', 304); } });
  assert.equal(second.results[0].status, 'unchanged'); assert.equal(second.cache.years[2026].lastSuccessAt, tomorrow.toISOString());
  const corrupt = await refreshChineseHolidays({ cache: first.cache, years: [2026], now: tomorrow, fetcher: async () => response('not JSON', 200, { etag: '"bad"' }) });
  const third = await refreshChineseHolidays({ cache: corrupt.cache, years: [2026], now: new Date('2026-10-11Z'), fetcher: async (_u, options) => { assert.equal(options?.headers?.['If-None-Match'], undefined); return response('', 304); } });
  assert.equal(third.results[0].code, 'http_error'); assert.equal(third.cache.years[2026].sourceHash, first.cache.years[2026].sourceHash);
});
test('network errors never leak raw URLs and leave successful cache untouched', async () => {
  const first = await refreshChineseHolidays({ years: [2026], now, fetcher: fixtureFetcher });
  const result = await refreshChineseHolidays({ cache: first.cache, years: [2026], now: tomorrow, fetcher: async () => { throw new Error('private-url?secret=token'); } });
  assert.equal(result.results[0].code, 'fetch_failed'); assert.ok(!JSON.stringify(result.results).includes('token')); assert.deepEqual(result.cache.years, first.cache.years);
});
test('persisted source/evidence tampering is rejected before installation', async () => {
  const fixture = futureFixture(); const first = await refreshChineseHolidays({ years: [2027], now, fetcher: fixture.fetcher });
  const tampered = structuredClone(first.cache); tampered.years[2027].sourceBody += ' '; assert.throws(() => validateChineseHolidayCache(tampered, now), /哈希/);
  assert.equal(first.cache.years[2027].verification, 'machine-source');
  const noProof = structuredClone(first.cache); noProof.years[2027].officialEvidence = []; assert.doesNotThrow(() => validateChineseHolidayCache(noProof, now));
  assert.throws(() => validateChineseHolidayCache({ ...emptyChineseHolidayCache(), origins: { 'https://evil.test': { blocked: false } } }, now), /冷却状态/);
});
test('dynamic snapshot installation is immutable, atomic, and rejects overlapping or malformed ranges', () => {
  const base = structuredClone(CHINESE_HOLIDAY_YEARS[2026]); installVerifiedChineseHolidayYears([base]); base.makeupWorkdays = []; assert.equal(isChineseWorkday('2026-10-10'), true);
  const invalid = { ...base, holidayRanges: [['2026-01-01', '2026-01-03'], ['2026-01-02', '2026-01-04']] as [string, string][] };
  assert.throws(() => installVerifiedChineseHolidayYears([invalid]), /重复/); assert.equal(isChineseWorkday('2026-10-10'), true); assert.ok(Object.isFrozen(getChineseHolidayYears()[2026])); installVerifiedChineseHolidayYears([]);
});
test('combined Mid-Autumn/National Day sections and single-day no-adjustment wording are supported', async () => {
  const fixture = futureFixture();
  fixture.data.days = fixture.data.days.filter((day: { name: string; date: string }) => day.name !== '中秋节' && !['2027-01-02', '2027-01-03', '2027-01-04'].includes(day.date)).map((day: { name: string }) => ({ ...day, name: day.name === '国庆节' ? '国庆节、中秋节' : day.name }));
  const html = fixture.html.replace('1月1日（周四）至3日（周六）放假调休，共3天。1月4日（周日）上班。', '1月1日（周五）放假1天，不调休。').replace(/六、中秋节[：:][\s\S]*?七、国庆节[：:]/, '六、国庆节、中秋节：');
  const result = await refreshChineseHolidays({ now, years: [2027], fetcher: async u => response(u === url(2027) ? JSON.stringify(fixture.data) : html) });
  assert.equal(result.results[0].status, 'updated'); assert.ok(result.cache.years[2027]);
});
test('partial next-year December evidence never invents full coverage for an unknown previous year', async () => {
  const fixture = futureFixture(2030, true); const date = new Date('2029-10-09Z');
  const result = await refreshChineseHolidays({ now: date, years: [2030], fetcher: fixture.fetcher });
  assert.equal(result.results[0].status, 'updated'); assert.deepEqual(result.calendarYears.map(y => y.year), [2030]);
});
test('built-in baseline shortcut also rejects mislabeled holidays with otherwise identical dates', async () => {
  const wrong = JSON.parse(raw2026); wrong.days[0].name = '春节';
  const result = await refreshChineseHolidays({ now, years: [2026], fetcher: async u => response(u === url(2026) ? JSON.stringify(wrong) : official2026) });
  assert.equal(result.results[0].status, 'updated'); assert.equal(result.cache.years[2026].verification, 'machine-source'); assert.equal(result.requests.official, 0);
});
