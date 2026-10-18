/** Local-calendar recurrence. Values are wall dates/times, never UTC instants.
 * Recurrence retains local timeZone semantics: 09:00 stays 09:00 across DST.
 * wallTimeToInstant explicitly resolves timezone gaps/folds via Temporal.
 * COUNT counts scheduled slots before EXDATE exclusions, like RFC 5545.
 * Chinese statutory calendars and lunar anniversaries use verified/bounded
 * assets/chinese-calendar.ts coverage. Unknown statutory years always error.
 */
import { Temporal } from '@js-temporal/polyfill';
import { t } from '../lib/i18n.ts';
import { gregorianToLunar, lunarAnniversaryInYear, matchesChineseDay } from './chinese-calendar.ts';
import type { ChineseDayKind, LunarAnniversaryOptions } from './chinese-calendar.ts';

export type DateOnly = string;
export type LocalTime = string;
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Sunday = 0
export interface LocalOccurrence { date: DateOnly; time?: LocalTime; timeZone?: string }
export type RecurrenceRule =
  | { frequency: 'daily'; interval?: number }
  | { frequency: 'weekly'; interval?: number; weekdays?: Weekday[]; weekStartsOn?: Weekday }
  | { frequency: 'monthly'; interval?: number; day?: number; nthWeekday?: { nth: 1 | 2 | 3 | 4 | 5 | -1; weekday: Weekday } }
  | { frequency: 'yearly'; interval?: number; month?: number; day?: number }
  | { frequency: 'dates'; dates: DateOnly[] }
  | ({ frequency: 'lunar-yearly'; interval?: number } & LunarAnniversaryOptions)
  | { frequency: 'chinese-workday' | 'chinese-restday' | 'chinese-weekend'; interval?: number };
export interface RecurrenceSchedule {
  start: LocalOccurrence;
  rule: RecurrenceRule;
  end?: { count?: number; date?: DateOnly };
  /** Entire local dates to omit. Count still includes omitted scheduled slots. */
  exclusions?: DateOnly[];
  completionRelative?: boolean;
  /** An EXDATE-like filter; count still counts scheduled slots before filtering. */
  dayFilter?: ChineseDayKind;
}
export interface OccurrenceQuery {
  from?: DateOnly;
  through?: DateOnly;
  limit?: number;
  /** Resets the local cadence after completion; must use the schedule timezone. */
  completedAt?: LocalOccurrence;
  /** Already completed scheduled slots, needed with completion-relative COUNT. */
  completedCount?: number;
}
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
function daysInMonth(y: number, m: number): number { return new Date(Date.UTC(y < 100 ? y + 400 : y, m, 0)).getUTCDate(); }
export function isDateOnly(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}
function dateParts(date: DateOnly): [number, number, number] {
  if (!isDateOnly(date)) throw new RangeError(`Invalid local date: ${date}`);
  return date.split('-').map(Number) as [number, number, number];
}
function formatDate(y: number, m: number, d: number): DateOnly {
  if (y < 1 || y > 9999) throw new RangeError('Date outside supported years 0001–9999');
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function utcDate(date: DateOnly): Date {
  const [y, m, d] = dateParts(date);
  const result = new Date(0); result.setUTCFullYear(y, m - 1, d); result.setUTCHours(0, 0, 0, 0); return result;
}
export function addLocalDays(date: DateOnly, days: number): DateOnly {
  if (!Number.isSafeInteger(days)) throw new RangeError('Day offset must be an integer');
  const d = utcDate(date); d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
export function addLocalMonths(date: DateOnly, months: number, preferredDay?: number): DateOnly {
  if (!Number.isSafeInteger(months)) throw new RangeError('Month offset must be an integer');
  const [y, m, d] = dateParts(date); const total = y * 12 + m - 1 + months;
  const newY = Math.floor(total / 12), newM = ((total % 12) + 12) % 12 + 1;
  const day = preferredDay ?? d;
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new RangeError('Day must be 1–31');
  return formatDate(newY, newM, Math.min(day, daysInMonth(newY, newM)));
}
export function localWeekday(date: DateOnly): Weekday { return utcDate(date).getUTCDay() as Weekday; }
export function isLocalTime(time: string): boolean {
  const m = TIME_RE.exec(time); return !!m && Number(m[1]) < 24 && Number(m[2]) < 60 && Number(m[3] ?? 0) < 60;
}
function validateOccurrence(value: LocalOccurrence): void {
  dateParts(value.date);
  if (value.time !== undefined && !isLocalTime(value.time)) throw new RangeError(`Invalid local time: ${value.time}`);
  if (value.timeZone !== undefined) { try { new Intl.DateTimeFormat('en', { timeZone: value.timeZone }); } catch { throw new RangeError(`Invalid timezone: ${value.timeZone}`); } }
}
function positiveInteger(n: number, name: string): void { if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`${name} must be a positive integer`); }
function weekday(n: number): void { if (!Number.isInteger(n) || n < 0 || n > 6) throw new RangeError('Weekday must be 0–6'); }
function validateSchedule(s: RecurrenceSchedule): void {
  validateOccurrence(s.start);
  const r = s.rule;
  if (!['daily', 'weekly', 'monthly', 'yearly', 'dates', 'lunar-yearly', 'chinese-workday', 'chinese-restday', 'chinese-weekend'].includes(r.frequency)) throw new RangeError('Unsupported recurrence frequency');
  if (r.frequency !== 'dates') positiveInteger(r.interval ?? 1, 'Interval');
  if (r.frequency === 'weekly') { (r.weekdays ?? []).forEach(weekday); weekday(r.weekStartsOn ?? 1); if (r.weekdays?.length === 0) throw new RangeError('Select at least one weekday'); }
  if (r.frequency === 'monthly') {
    if (r.day !== undefined && r.nthWeekday) throw new RangeError('Choose day-of-month or nth weekday, not both');
    if (r.day !== undefined && (!Number.isInteger(r.day) || r.day < 1 || r.day > 31)) throw new RangeError('Day must be 1–31');
    if (r.nthWeekday) { weekday(r.nthWeekday.weekday); if (![1, 2, 3, 4, 5, -1].includes(r.nthWeekday.nth)) throw new RangeError('Invalid ordinal weekday'); }
  }
  if (r.frequency === 'yearly') {
    if (r.month !== undefined && (!Number.isInteger(r.month) || r.month < 1 || r.month > 12)) throw new RangeError('Month must be 1–12');
    if (r.day !== undefined && (!Number.isInteger(r.day) || r.day < 1 || r.day > 31)) throw new RangeError('Day must be 1–31');
  }
  if (r.frequency === 'dates') { r.dates.forEach(dateParts); if (s.completionRelative) throw new RangeError('Explicit dates cannot be completion-relative'); }
  if (r.frequency === 'lunar-yearly') {
    const year = gregorianToLunar(s.start.date).year; lunarAnniversaryInYear(year, r);
  }
  if (s.dayFilter !== undefined && !['workday', 'restday', 'weekend'].includes(s.dayFilter)) throw new RangeError('Invalid Chinese day filter');
  if (s.end?.count !== undefined) positiveInteger(s.end.count, 'Count');
  if (s.end?.date !== undefined) dateParts(s.end.date);
  (s.exclusions ?? []).forEach(dateParts);
  const chineseKind: ChineseDayKind | undefined = s.dayFilter ?? (r.frequency === 'chinese-workday' || r.frequency === 'chinese-restday' || r.frequency === 'chinese-weekend' ? r.frequency.replace('chinese-', '') as ChineseDayKind : undefined);
  if (chineseKind) { matchesChineseDay(s.start.date, chineseKind); if (s.end?.date) matchesChineseDay(s.end.date, chineseKind); }
  if (r.frequency === 'lunar-yearly' && s.end?.date) gregorianToLunar(s.end.date);
}
function nthDay(y: number, m: number, nth: number, day: Weekday): DateOnly | undefined {
  const last = daysInMonth(y, m);
  const d = nth === -1
    ? last - (localWeekday(formatDate(y, m, last)) - day + 7) % 7
    : 1 + (day - localWeekday(formatDate(y, m, 1)) + 7) % 7 + (nth - 1) * 7;
  return d <= last ? formatDate(y, m, d) : undefined;
}
/** Each generated candidate is at/after anchor; absent fifth weekdays are skipped. */
function* candidates(anchor: DateOnly, r: RecurrenceRule, afterCompletion: boolean, through?: DateOnly): Generator<DateOnly> {
  const [y, m, d] = dateParts(anchor); const interval = r.frequency === 'dates' ? 1 : r.interval ?? 1;
  if (r.frequency === 'dates') { yield* [...new Set(r.dates)].sort().filter(date => date >= anchor); return; }
  if (r.frequency === 'lunar-yearly') {
    const firstYear = gregorianToLunar(anchor).year;
    for (let year = firstYear; year <= 2100; year += interval) {
      if (through && year > Number(through.slice(0, 4))) return;
      const date = lunarAnniversaryInYear(year, r);
      if (date && date >= anchor && (!afterCompletion || date > anchor)) yield date;
    }
    return;
  }
  if (r.frequency === 'chinese-workday' || r.frequency === 'chinese-restday' || r.frequency === 'chinese-weekend') {
    const kind = r.frequency.replace('chinese-', '') as ChineseDayKind;
    let slot = afterCompletion ? 1 : 0;
    for (let date = afterCompletion ? addLocalDays(anchor, 1) : anchor; !through || date <= through; date = addLocalDays(date, 1)) {
      if (matchesChineseDay(date, kind) && slot++ % interval === 0) yield date;
    }
    return;
  }
  if (r.frequency === 'weekly' && !r.weekdays) {
    // A default weekly cadence means the anchor's weekday, including completion-relative shifts.
    for (let i = afterCompletion ? 1 : 0; ; i++) yield addLocalDays(anchor, i * interval * 7);
  } else if (r.frequency === 'weekly') {
    const first = addLocalDays(anchor, -((localWeekday(anchor) - (r.weekStartsOn ?? 1) + 7) % 7));
    const offsets = [...new Set(r.weekdays)].map(day => (day - (r.weekStartsOn ?? 1) + 7) % 7).sort((a, b) => a - b);
    for (let i = 0; ; i++) for (const offset of offsets) { const date = addLocalDays(first, i * interval * 7 + offset); if (date >= anchor && (!afterCompletion || date > anchor)) yield date; }
  } else {
    for (let i = 0; ; i++) {
      let date: DateOnly | undefined;
      if (r.frequency === 'daily') date = addLocalDays(anchor, i * interval);
      else if (r.frequency === 'monthly') {
        const monthStart = addLocalMonths(formatDate(y, m, 1), i * interval);
        const [my, mm] = dateParts(monthStart);
        date = r.nthWeekday ? nthDay(my, mm, r.nthWeekday.nth, r.nthWeekday.weekday) : formatDate(my, mm, Math.min(r.day ?? d, daysInMonth(my, mm)));
      } else if (r.frequency === 'yearly') {
        const year = y + i * interval, month = r.month ?? m;
        date = formatDate(year, month, Math.min(r.day ?? d, daysInMonth(year, month)));
      }
      if (date !== undefined && date >= anchor && (!afterCompletion || date > anchor)) yield date;
    }
  }
}
/** Returns inclusive local-date range. Defaults to first 100 occurrences.
 * For completion-relative rules, completedAt becomes the cadence anchor; the
 * next slot is strictly after that date. Named month/day selections still apply.
 * Chinese-day interval counts eligible days. Its completion-relative next slot
 * advances by interval eligible days, rather than reusing the completed slot.
 * A maximum 200,000 visited slots protects accidental unbounded range scans.
 */
export function getOccurrences(s: RecurrenceSchedule, q: OccurrenceQuery = {}): LocalOccurrence[] {
  validateSchedule(s);
  const limit = q.limit ?? 100; positiveInteger(limit, 'Limit');
  if (limit > 10000) throw new RangeError('Limit cannot exceed 10000');
  if (q.from !== undefined) dateParts(q.from);
  if (q.through !== undefined) dateParts(q.through);
  if (q.completedAt) validateOccurrence(q.completedAt);
  const chineseKind: ChineseDayKind | undefined = s.dayFilter ?? (s.rule.frequency === 'chinese-workday' || s.rule.frequency === 'chinese-restday' || s.rule.frequency === 'chinese-weekend' ? s.rule.frequency.replace('chinese-', '') as ChineseDayKind : undefined);
  for (const boundary of [q.from, q.through, q.completedAt?.date]) {
    if (boundary && chineseKind) matchesChineseDay(boundary, chineseKind);
    if (boundary && s.rule.frequency === 'lunar-yearly') gregorianToLunar(boundary);
  }
  if (q.completedCount !== undefined && (!Number.isSafeInteger(q.completedCount) || q.completedCount < 0)) throw new RangeError('Completed count must be nonnegative');
  if (q.completedAt && !s.completionRelative) throw new RangeError('completedAt requires completion-relative recurrence');
  if (q.completedAt && q.completedAt.timeZone !== undefined && q.completedAt.timeZone !== s.start.timeZone) throw new RangeError('Completion timezone must match schedule');
  if (q.completedAt && q.completedAt.date < s.start.date) throw new RangeError('Completion cannot precede schedule start');
  const anchor = q.completedAt?.date ?? s.start.date;
  const end = [s.end?.date, q.through].filter((v): v is string => !!v).sort()[0];
  if (end && end < anchor || q.from && end && q.from > end) return [];
  const exclusions = new Set(s.exclusions), results: LocalOccurrence[] = [];
  let count = q.completedAt ? q.completedCount ?? 0 : 0, visits = 0;
  if (s.end?.count !== undefined && count >= s.end.count) return [];
  for (const date of candidates(anchor, s.rule, !!q.completedAt, end)) {
    if (++visits > 200000) throw new RangeError('Recurrence range is too large; narrow the range');
    if (end && date > end) break;
    count++;
    if ((!q.from || date >= q.from) && !exclusions.has(date) && (!s.dayFilter || matchesChineseDay(date, s.dayFilter))) {
      const occurrence: LocalOccurrence = { date };
      const time = s.completionRelative && q.completedAt?.time ? q.completedAt.time : s.start.time;
      if (time !== undefined) occurrence.time = time;
      if (s.start.timeZone !== undefined) occurrence.timeZone = s.start.timeZone;
      results.push(occurrence);
      if (results.length >= limit) break;
    }
    if (s.end?.count !== undefined && count >= s.end.count) break;
  }
  return results;
}
export function nextOccurrence(s: RecurrenceSchedule, q: Omit<OccurrenceQuery, 'limit'> = {}): LocalOccurrence | undefined { return getOccurrences(s, { ...q, limit: 1 })[0]; }
/** Pass now already expressed in task's timezone. All-day tasks compare dates
 * only, so today's task is not overdue at midnight or because of UTC offset. */
export function isOverdue(due: LocalOccurrence, now: LocalOccurrence): boolean {
  validateOccurrence(due); validateOccurrence(now);
  if (due.timeZone && now.timeZone && due.timeZone !== now.timeZone) throw new RangeError('Compare values in the same timezone');
  if (due.date !== now.date) return due.date < now.date;
  if (due.time === undefined) return false;
  if (now.time === undefined) throw new RangeError('Current local time is needed for a timed deadline');
  return due.time.padEnd(8, ':00') < now.time.padEnd(8, ':00');
}
export interface ParsedChineseTask {
  title: string;
  due?: LocalOccurrence;
  priority?: 1 | 2 | 3;
  tags: string[];
  /** Human-readable limitations, never silently inferred as supported. */
  unsupported: string[];
}
export interface ChineseParseOptions { today: DateOnly; timeZone?: string }
/** Bounded deterministic Chinese/English parsing, not an NLP/holiday engine.
 * Chinese 周X and English weekday names mean the next match, including today. Conflicting date/time tokens are
 * returned as unsupported and left in the title for manual review. */
export function parseChineseTask(input: string, options: ChineseParseOptions): ParsedChineseTask {
  validateOccurrence({ date: options.today, timeZone: options.timeZone });
  const unsupported: string[] = [], tags: string[] = [];
  if (/(?:工作日|节假日|法定假日|调休|农历|春节|中秋|国庆)/u.test(input)) unsupported.push(t('core.naturalLanguageHolidaysMakeupWorkdaysAndLunarDates'));
  if (/(?:每(?:天|日|周|星期|月|年|隔|\s*[一二三四五六七八九十\d]+\s*[天日周月年])|隔\s*[一二三四五六七八九十\d]+\s*[天日周月年]|[一二三四五六七八九十\d]+[天日周月年](?:后|前)|第[一二三四五六七八九十\d]+个|上周|上星期|下下周|月底|月末|下个月|下月|明年|本周|本星期)/u.test(input)) unsupported.push(t('core.complexRelativeDatesAndNaturalLanguageRecurrenceRules'));
  let title = input.replace(/(?:^|\s)#([^\s#]+)/gu, (_, tag: string) => { if (!tags.includes(tag)) tags.push(tag); return ' '; });
  // These phrases have deliberately unsupported week-boundary/recurrence semantics.
  // Keep their date/time text intact rather than extracting a weekday inside them.
  const unsupportedEnglish = /(?<![\p{L}\p{N}_])(?:(?:next|last|this)[\s-]+(?:week(?:end)?|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:every|each)\s+(?:(?:other|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?(?:day|week(?:day|end)?|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?|daily|weekly|monthly|yearly|annually)(?![\p{L}\p{N}_])/iu.test(title);
  if (unsupportedEnglish) unsupported.push(t('domain.parser.unsupportedEnglish'));
  const priorities = [...title.matchAll(/(?:^|\s)!([123])(?=\s|$)/g)];
  let priority: 1 | 2 | 3 | undefined;
  if (priorities.length > 1) unsupported.push(t('core.multiplePriorityMarkersPleaseConfirmManually'));
  else if (priorities.length === 1) { priority = Number(priorities[0][1]) as 1 | 2 | 3; title = title.replace(/(?:^|\s)![123](?=\s|$)/g, ' '); }
  const tokens = [...title.matchAll(/\d{4}-\d{2}-\d{2}|今天|明天|后天|(?:下)?(?:周|星期)[一二三四五六日天]|(?<![\p{L}\p{N}_])(?:day\s+after\s+tomorrow|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?![\p{L}\p{N}_])/giu)].filter(match => {
    // Do not extract a fake due date from e.g. 每周三, 上周三 or 下下周三.
    if (!/(?:周|星期)/u.test(match[0])) return true;
    const prefix = title.slice(0, match.index);
    return !/[每本上下]$/u.test(prefix);
  });
  const hasEnglishDate = tokens.some(match => /^[a-z]/i.test(match[0]));
  const timeTokens = [...title.matchAll(/(?<![\d:])\d{1,2}:\d{2}(?![\d:])/g)];
  // With English/conflicting phrases, leave all date/time tokens for review.
  const deferDateTime = unsupportedEnglish || hasEnglishDate && (tokens.length > 1 || timeTokens.length > 1);
  let date: DateOnly | undefined;
  if (tokens.length > 1) unsupported.push(t('core.multipleDateMarkersPleaseConfirmManually'));
  else if (tokens.length === 1 && !deferDateTime) {
    const token = tokens[0][0], english = token.toLowerCase().replace(/\s+/g, ' ');
    if (/^\d/.test(token)) { if (isDateOnly(token)) date = token; else unsupported.push(t('core.invalidDateValue', { p0: token })); }
    else if (['today', 'tomorrow', 'day after tomorrow'].includes(english)) date = addLocalDays(options.today, ['today', 'tomorrow', 'day after tomorrow'].indexOf(english));
    else if (/^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.test(english)) {
      const day = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(english);
      date = addLocalDays(options.today, (day - localWeekday(options.today) + 7) % 7);
    }
    else if (['今天', '明天', '后天'].includes(token)) date = addLocalDays(options.today, ['今天', '明天', '后天'].indexOf(token));
    else if (/^下/.test(token)) unsupported.push(t('core.weekBoundariesForNextWeekAreNotInferred'));
    else {
      const day = ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 } as Record<string, Weekday>)[token.at(-1)!];
      date = addLocalDays(options.today, (day - localWeekday(options.today) + 7) % 7);
    }
    if (date) title = title.replace(token, ' ');
  }
  const times = [...title.matchAll(/(?<![\d:])\d{1,2}:\d{2}(?![\d:])/g)];
  let time: LocalTime | undefined;
  if (times.length > 1) unsupported.push(t('core.multipleTimeMarkersPleaseConfirmManually'));
  else if (times.length === 1 && !deferDateTime) {
    const token = times[0][0], normalized = token.padStart(5, '0');
    if (isLocalTime(normalized)) { time = normalized; title = title.replace(token, ' '); } else unsupported.push(t('core.invalidTimeValue', { p0: token }));
  }
  if (/\d{1,2}:\d{2}:\d{2}/u.test(title)) unsupported.push(t('core.timesWithSecondsAreNotSupportedUseHh'));
  if (/(?:上午|下午|晚上|早上|中午|凌晨)\s*\d+(?:点|时)|\d+点(?:半|\d+分)?/u.test(title)) unsupported.push(t('core.colloquialChineseTimesAreNotSupportedUseHh'));
  const result: ParsedChineseTask = { title: title.replace(/\s+/g, ' ').trim(), tags, unsupported: [...new Set(unsupported)] };
  if (priority !== undefined) result.priority = priority;
  if (date || time) { result.due = { date: date ?? options.today }; if (time) result.due.time = time; if (options.timeZone) result.due.timeZone = options.timeZone; }
  return result;
}

/** Temporal's disambiguation semantics: fold earlier/later chooses one instant;
 * gap earlier/later shifts backward/forward by the transition's exact duration.
 * reject is the default, preventing accidental scheduling in a gap or fold.
 * See https://tc39.es/proposal-temporal/docs/timezone.html
 */
export type TimeDisambiguation = 'earlier' | 'later' | 'reject' | 'compatible';
export function wallTimeToInstant(value: LocalOccurrence, disambiguation: TimeDisambiguation = 'reject'): string {
  validateOccurrence(value);
  if (value.time === undefined || value.timeZone === undefined) throw new RangeError('Timed local value and explicit timezone are required; all-day dates are not instants');
  if (!['earlier', 'later', 'reject', 'compatible'].includes(disambiguation)) throw new RangeError('Invalid time disambiguation');
  const [year, month, day] = dateParts(value.date), [hour, minute, second = 0] = value.time.split(':').map(Number);
  return Temporal.ZonedDateTime.from({ year, month, day, hour, minute, second, timeZone: value.timeZone }, { disambiguation, overflow: 'reject' }).toInstant().toString({ smallestUnit: 'second' });
}
/** LocalOccurrence supports whole seconds; input subsecond precision truncates. */
export function instantToWallTime(instant: string | number | Date, timeZone: string): LocalOccurrence {
  const value = typeof instant === 'string' ? Temporal.Instant.from(instant) : Temporal.Instant.fromEpochMilliseconds(instant instanceof Date ? instant.getTime() : instant);
  const zoned = value.toZonedDateTimeISO(timeZone);
  return { date: zoned.toPlainDate().toString(), time: zoned.toPlainTime().toString({ smallestUnit: 'second' }), timeZone };
}
