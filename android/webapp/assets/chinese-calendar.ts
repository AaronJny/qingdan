/** Mainland China calendar utilities. Published statutory overrides are NOT a
 * prediction engine: dates outside covered years always throw CoverageError.
 * Lunar conversion uses the runtime's ICU Chinese calendar, not holiday rules.
 */
export type GregorianDate = string;
export interface LunarDate { year: number; month: number; day: number; leapMonth: boolean }
export type ChineseDayKind = 'workday' | 'restday' | 'weekend';
export class CalendarCoverageError extends RangeError {
  constructor(message: string) { super(message); this.name = 'CalendarCoverageError'; }
}
export interface ChineseHolidayYear {
  year: number;
  publishedDate: string;
  noticeNumber: string;
  sourceUrls: readonly string[];
  holidayRanges: readonly (readonly [GregorianDate, GregorianDate])[];
  makeupWorkdays: readonly GregorianDate[];
}
/** Verified 2026-10-07 against the linked government republications of the
 * State Council notices. Only mainland national full-population arrangements;
 * employer schedules, regional holidays and half-day holidays are not inferred.
 */
export const CHINESE_HOLIDAY_YEARS: Readonly<Record<number, ChineseHolidayYear>> = Object.freeze({
  2025: Object.freeze({
    year: 2025, publishedDate: '2024-11-12', noticeNumber: '国办发明电〔2024〕12号',
    sourceUrls: Object.freeze(['https://www.forestry.gov.cn/c/www/szxx/594663.jhtml', 'https://www.gov.cn/zhengce/content/202411/content_6986382.htm']),
    holidayRanges: Object.freeze([
      ['2025-01-01', '2025-01-01'], ['2025-01-28', '2025-02-04'], ['2025-04-04', '2025-04-06'],
      ['2025-05-01', '2025-05-05'], ['2025-05-31', '2025-06-02'], ['2025-10-01', '2025-10-08'],
    ].map(pair => Object.freeze(pair as [string, string]))),
    makeupWorkdays: Object.freeze(['2025-01-26', '2025-02-08', '2025-04-27', '2025-09-28', '2025-10-11']),
  }),
  2026: Object.freeze({
    year: 2026, publishedDate: '2025-11-04', noticeNumber: '国办发明电〔2025〕7号',
    sourceUrls: Object.freeze(['https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html', 'https://zwfw.gansu.gov.cn/huixian/zczx/tzgg/art/2025/art_715c16a75e4d4c289c295e77772c7274.html']),
    holidayRanges: Object.freeze([
      ['2026-01-01', '2026-01-03'], ['2026-02-15', '2026-02-23'], ['2026-04-04', '2026-04-06'],
      ['2026-05-01', '2026-05-05'], ['2026-06-19', '2026-06-21'], ['2026-09-25', '2026-09-27'], ['2026-10-01', '2026-10-07'],
    ].map(pair => Object.freeze(pair as [string, string]))),
    makeupWorkdays: Object.freeze(['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10']),
  }),
});
export const CHINESE_HOLIDAY_COVERAGE = Object.freeze({ years: Object.freeze([2025, 2026]), region: 'CN-mainland', verifiedAt: '2026-10-07' });
export const LUNAR_CALENDAR_COVERAGE = Object.freeze({ minYear: 1900, maxYear: 2100, engine: 'Intl/ICU Chinese calendar', timeZone: 'Asia/Shanghai', fixtureSources: Object.freeze(['https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/2025.pdf', 'https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/2026.pdf']) });
function parts(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`Invalid Gregorian date: ${date}`);
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const value = new Date(0); value.setUTCFullYear(y, mo - 1, d); value.setUTCHours(0, 0, 0, 0);
  if (y < 1 || value.getUTCFullYear() !== y || value.getUTCMonth() !== mo - 1 || value.getUTCDate() !== d) throw new RangeError(`Invalid Gregorian date: ${date}`);
  return [y, mo, d];
}
function dateOf(date: string): Date { const [y, m, d] = parts(date); const value = new Date(0); value.setUTCFullYear(y, m - 1, d); value.setUTCHours(0, 0, 0, 0); return value; }
function addDay(date: string): string { const value = dateOf(date); value.setUTCDate(value.getUTCDate() + 1); return value.toISOString().slice(0, 10); }
function holidayYear(date: string): ChineseHolidayYear {
  const year = parts(date)[0], data = CHINESE_HOLIDAY_YEARS[year];
  if (!data) throw new CalendarCoverageError(`中国法定节假日数据未覆盖 ${year} 年；已核验年份：2025、2026。请先更新官方安排。`);
  return data;
}
export function isChineseWorkday(date: GregorianDate): boolean {
  const data = holidayYear(date);
  if (data.holidayRanges.some(([start, end]) => date >= start && date <= end)) return false;
  if (data.makeupWorkdays.includes(date)) return true;
  const weekday = dateOf(date).getUTCDay(); return weekday >= 1 && weekday <= 5;
}
export function isChineseRestDay(date: GregorianDate): boolean { return !isChineseWorkday(date); }
/** Weekend means Saturday/Sunday, excluding official makeup workdays.
 * Restday additionally includes public holidays on Monday–Friday. */
export function matchesChineseDay(date: GregorianDate, kind: ChineseDayKind): boolean {
  const workday = isChineseWorkday(date);
  if (kind === 'workday') return workday;
  if (kind === 'restday') return !workday;
  if (kind !== 'weekend') throw new RangeError(`Unsupported Chinese day kind: ${kind}`);
  return !workday && [0, 6].includes(dateOf(date).getUTCDay());
}
let lunarFormatter: Intl.DateTimeFormat | undefined;
function formatter(): Intl.DateTimeFormat {
  if (!lunarFormatter) {
    lunarFormatter = new Intl.DateTimeFormat('en-u-ca-chinese', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' });
    if (lunarFormatter.resolvedOptions().calendar !== 'chinese') { lunarFormatter = undefined; throw new CalendarCoverageError('当前运行环境不支持 Intl 中国农历，请使用完整 ICU 环境'); }
  }
  return lunarFormatter;
}
function rawLunar(date: GregorianDate): LunarDate {
  // Shanghai noon is far from date boundaries; Gregorian date remains local.
  const value = dateOf(date); value.setUTCHours(4);
  const fields = formatter().formatToParts(value);
  const year = Number(fields.find(p => (p.type as string) === 'relatedYear')?.value);
  const monthString = fields.find(p => p.type === 'month')?.value ?? '';
  const match = /^(\d{1,2})(bis)?$/.exec(monthString);
  const day = Number(fields.find(p => p.type === 'day')?.value);
  if (!Number.isInteger(year) || !match || Number(match[1]) < 1 || Number(match[1]) > 12 || !Number.isInteger(day) || day < 1 || day > 30) throw new CalendarCoverageError('Intl 中国农历输出格式不受支持');
  return { year, month: Number(match[1]), day, leapMonth: !!match[2] };
}
function assertLunarYear(year: number): void {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new CalendarCoverageError('农历换算支持农历 1900–2100 年');
}
export function gregorianToLunar(date: GregorianDate): LunarDate {
  parts(date); const result = rawLunar(date); assertLunarYear(result.year); return result;
}
interface LunarYearIndex { days: Map<string, GregorianDate>; monthLengths: Map<string, number> }
const indexes = new Map<number, LunarYearIndex>();
function lunarKey(month: number, leap: boolean, day?: number): string { return `${month}:${leap ? 1 : 0}${day === undefined ? '' : `:${day}`}`; }
function yearIndex(year: number): LunarYearIndex {
  assertLunarYear(year);
  const cached = indexes.get(year); if (cached) return cached;
  const days = new Map<string, GregorianDate>(), monthLengths = new Map<string, number>();
  // A lunar year starts Jan/Feb and ends Jan/Feb of the next Gregorian year.
  for (let date = `${year}-01-01`; date < `${year + 1}-03-01`; date = addDay(date)) {
    const lunar = rawLunar(date);
    if (lunar.year !== year) continue;
    days.set(lunarKey(lunar.month, lunar.leapMonth, lunar.day), date);
    const key = lunarKey(lunar.month, lunar.leapMonth); monthLengths.set(key, Math.max(monthLengths.get(key) ?? 0, lunar.day));
  }
  const index = { days, monthLengths };
  // Bound memory; callers can use the entire supported span without a permanent growing cache.
  if (indexes.size >= 12) indexes.delete(indexes.keys().next().value!);
  indexes.set(year, index); return index;
}
function validateLunar(date: LunarDate): void {
  assertLunarYear(date.year);
  if (!Number.isInteger(date.month) || date.month < 1 || date.month > 12 || !Number.isInteger(date.day) || date.day < 1 || date.day > 30 || typeof date.leapMonth !== 'boolean') throw new RangeError('无效农历日期');
}
export function lunarMonthLength(year: number, month: number, leapMonth = false): number | undefined {
  validateLunar({ year, month, day: 1, leapMonth }); return yearIndex(year).monthLengths.get(lunarKey(month, leapMonth));
}
export function lunarToGregorian(date: LunarDate): GregorianDate {
  validateLunar(date); const result = yearIndex(date.year).days.get(lunarKey(date.month, date.leapMonth, date.day));
  if (!result) throw new RangeError(`农历日期不存在：${date.year}年${date.leapMonth ? '闰' : ''}${date.month}月${date.day}日`);
  return result;
}
export interface LunarAnniversaryOptions {
  month: number; day: number; leapMonth?: boolean;
  /** A leap birthday can skip non-leap years, or use that year's regular month. */
  missingLeapMonth?: 'skip' | 'regular';
  /** Day 30 in a 29-day month skips by default; explicit clamp uses day 29. */
  invalidDay?: 'skip' | 'clamp';
}
export function lunarAnniversaryInYear(year: number, options: LunarAnniversaryOptions): GregorianDate | undefined {
  let leap = options.leapMonth ?? false;
  validateLunar({ year, month: options.month, day: options.day, leapMonth: leap });
  if (!['skip', 'regular'].includes(options.missingLeapMonth ?? 'skip') || !['skip', 'clamp'].includes(options.invalidDay ?? 'skip')) throw new RangeError('无效农历纪念日策略');
  let length = lunarMonthLength(year, options.month, leap);
  if (length === undefined && leap && options.missingLeapMonth === 'regular') { leap = false; length = lunarMonthLength(year, options.month, false); }
  if (length === undefined || options.day > length && options.invalidDay !== 'clamp') return undefined;
  return lunarToGregorian({ year, month: options.month, day: Math.min(options.day, length), leapMonth: leap });
}
