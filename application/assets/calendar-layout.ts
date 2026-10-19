/** Calendar geometry uses Gregorian wall minutes, NOT Unix minutes or real instants.
 * Every local day has 1,440 cells even at DST gaps/folds. For reminders/actual
 * elapsed time, resolve wall endpoints with recurrence.wallTimeToInstant instead.
 * No host timezone, browser, persistence, or recurrence mutation is involved.
 */
export interface TaskSchedule {
  dueDate?: string; dueTime?: string; startDate?: string; startTime?: string; duration?: number;
}
export interface SchedulePatch {
  dueDate: string; dueTime: string; startDate: string; startTime: string; duration: number;
}
export interface WallPoint { date: string; time: string }
export interface MinuteInterval { start: number; end: number }
export interface TaskInterval extends MinuteInterval { allDay: boolean; durationMinutes: number }
export interface NormalizeOptions { defaultDurationMinutes?: number; minimumDurationMinutes?: number }
export interface DaySegment extends MinuteInterval {
  date: string; startMinute: number; endMinute: number; continuesBefore: boolean; continuesAfter: boolean;
}
export interface GridSegment extends MinuteInterval {
  row: number; startColumn: number; endColumn: number; startDate: string; endDate: string;
  continuesBefore: boolean; continuesAfter: boolean;
}
const DAY = 1440;
const MS_DAY = 86400000;
function integer(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
  return value;
}
function positive(value: number, label: string): number {
  integer(value, label); if (value <= 0) throw new RangeError(`${label} must be positive`); return value;
}
function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`); return value;
}
function gregorianDate(year: number, month: number, day: number): Date {
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0); return date;
}
function daysInMonth(year: number, month: number): number { return gregorianDate(year, month + 1, 0).getUTCDate(); }
function dateParts(date: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`Invalid local date: ${date}`);
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) throw new RangeError(`Invalid local date: ${date}`);
  return [year, month, day];
}
function formatDate(year: number, month: number, day: number): string {
  if (year < 1 || year > 9999) throw new RangeError('Date outside supported years 0001–9999');
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export function dateToDay(date: string): number { return gregorianDate(...dateParts(date)).getTime() / MS_DAY; }
export function dayToDate(day: number): string {
  integer(day, 'Day index'); const date = new Date(day * MS_DAY);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid day index');
  return formatDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
export function timeToMinute(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || +match[1] > 23 || +match[2] > 59) throw new RangeError(`Invalid local time: ${time}`);
  return +match[1] * 60 + +match[2];
}
export function minuteToTime(minute: number): string {
  integer(minute, 'Minute'); if (minute < 0 || minute >= DAY) throw new RangeError('Time minute must be 0–1439');
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
export function wallToMinute(date: string, time = '00:00'): number { return dateToDay(date) * DAY + timeToMinute(time); }
export function minuteToWall(minute: number): WallPoint {
  integer(minute, 'Wall minute'); const day = Math.floor(minute / DAY);
  return { date: dayToDate(day), time: minuteToTime(minute - day * DAY) };
}
export function addCalendarDays(date: string, days: number): string { return dayToDate(dateToDay(date) + integer(days, 'Day offset')); }
export function addCalendarMonths(date: string, months: number, preferredDay?: number): string {
  const [year, month, day] = dateParts(date); integer(months, 'Month offset');
  const preferred = preferredDay ?? day; integer(preferred, 'Preferred day');
  if (preferred < 1 || preferred > 31) throw new RangeError('Preferred day must be 1–31');
  const total = year * 12 + month - 1 + months, y = Math.floor(total / 12), m = ((total % 12) + 12) % 12 + 1;
  return formatDate(y, m, Math.min(preferred, daysInMonth(y, m)));
}
export function addCalendarYears(date: string, years: number, preferredDay?: number): string {
  integer(years, 'Year offset'); return addCalendarMonths(date, integer(years * 12, 'Month offset'), preferredDay);
}
/** Canonical half-open interval. All-day dueDate is stored inclusive. A due-only
 * timed task starts at dueDate/dueTime (legacy calendar anchor) and uses duration.
 * With startDate, dueDate/dueTime is authoritative; absent dueTime means through
 * the due day. Inverted/zero timed ends are repaired to the minimum span.
 * Missing dueDate and startDate means unscheduled (null). Empty strings are absent.
 */
export function normalizeTaskInterval(data: TaskSchedule, options: NormalizeOptions = {}): TaskInterval | null {
  const minimum = positive(options.minimumDurationMinutes ?? 15, 'Minimum duration');
  const fallback = positive(options.defaultDurationMinutes ?? 30, 'Default duration');
  if (data.duration !== undefined && (!Number.isSafeInteger(data.duration) || data.duration < 0)) throw new RangeError('Duration must be a nonnegative integer');
  if (data.startTime) timeToMinute(data.startTime);
  if (data.dueTime) timeToMinute(data.dueTime);
  if (data.startDate) dateParts(data.startDate);
  if (data.dueDate) dateParts(data.dueDate);
  const date = data.startDate || data.dueDate;
  if (!date) return null;
  const allDay = !data.startTime && !data.dueTime;
  let start: number, end: number;
  if (allDay) {
    start = wallToMinute(date);
    end = Math.max(start + DAY, wallToMinute(data.dueDate || date) + DAY);
  } else {
    start = wallToMinute(date, data.startTime || (data.startDate ? '00:00' : data.dueTime) || '00:00');
    const duration = Math.max(minimum, data.duration || fallback);
    end = data.startDate && data.dueDate
      ? wallToMinute(data.dueDate, data.dueTime || '00:00') + (data.dueTime ? 0 : DAY)
      : start + duration;
    end = Math.max(start + minimum, end);
  }
  integer(start, 'Interval start'); integer(end, 'Interval end');
  return { allDay, start, end, durationMinutes: integer(end - start, 'Duration') };
}
function requireInterval(data: TaskSchedule, options?: NormalizeOptions): TaskInterval {
  const value = normalizeTaskInterval(data, options);
  if (!value) throw new RangeError('Task has no calendar date'); return value;
}
function intervalPatch(interval: TaskInterval): SchedulePatch {
  const start = minuteToWall(interval.start);
  if (interval.allDay) return {
    startDate: start.date, startTime: '', dueDate: dayToDate(Math.ceil(interval.end / DAY) - 1), dueTime: '', duration: interval.end - interval.start,
  };
  const end = minuteToWall(interval.end);
  return { startDate: start.date, startTime: start.time, dueDate: end.date, dueTime: end.time, duration: interval.end - interval.start };
}
/** Destination means the NEW START. Omitted time preserves original timed time;
 * a time converts an all-day span to timed without losing its wall-minute span.
 * Use moveTaskToAllDay for an explicit timed-to-all-day conversion.
 */
export function moveTaskTo(data: TaskSchedule, destination: { date: string; time?: string }, options?: NormalizeOptions): SchedulePatch {
  const source = requireInterval(data, options);
  const allDay = source.allDay && destination.time === undefined;
  const start = wallToMinute(destination.date, destination.time ?? (source.allDay ? '00:00' : minuteToWall(source.start).time));
  return intervalPatch({ ...source, allDay, start, end: start + source.durationMinutes });
}
export function moveTaskToAllDay(data: TaskSchedule, date: string, options?: NormalizeOptions): SchedulePatch {
  const source = requireInterval(data, options);
  // Keep the number of local dates touched, excluding a timed midnight endpoint.
  const days = Math.max(1, Math.ceil(source.end / DAY) - Math.floor(source.start / DAY));
  const start = wallToMinute(date);
  return intervalPatch({ allDay: true, start, end: start + days * DAY, durationMinutes: days * DAY });
}
export function pixelsToMinuteDelta(deltaPixels: number, pixelsPerHour: number, snapMinutes = 15): number {
  finite(deltaPixels, 'Pixel delta'); finite(pixelsPerHour, 'Pixels per hour'); positive(snapMinutes, 'Snap minutes');
  if (pixelsPerHour <= 0) throw new RangeError('Pixels per hour must be positive');
  const units = deltaPixels * 60 / pixelsPerHour / snapMinutes;
  // Symmetric nearest snapping; negative half-steps shrink by a full step.
  return integer(Math.sign(units) * Math.round(Math.abs(units)) * snapMinutes, 'Minute delta');
}
export function resizeTimedTask(data: TaskSchedule, deltaPixels: number, pixelsPerHour: number, snapMinutes = 15, minimumDurationMinutes = 15): SchedulePatch {
  positive(minimumDurationMinutes, 'Minimum duration');
  const source = requireInterval(data, { minimumDurationMinutes });
  if (source.allDay) throw new RangeError('Use resizeAllDayTask for an all-day task');
  return intervalPatch({ ...source, end: Math.max(source.start + minimumDurationMinutes, source.end + pixelsToMinuteDelta(deltaPixels, pixelsPerHour, snapMinutes)) });
}
export function resizeAllDayTask(data: TaskSchedule, deltaDays: number): SchedulePatch {
  integer(deltaDays, 'Day delta'); const source = requireInterval(data);
  if (!source.allDay) throw new RangeError('Use resizeTimedTask for a timed task');
  return intervalPatch({ ...source, end: Math.max(source.start + DAY, source.end + deltaDays * DAY) });
}
export type CalendarEdge = 'start' | 'end';
/** Resize the actual endpoint to a calendar date, independently of grid rows.
 * The end date is the last occupied day (all-day due dates stay inclusive).
 * Timed tasks retain their wall-clock endpoint, including exclusive midnight.
 */
export function resizeTaskDateEdge(data: TaskSchedule, edge: CalendarEdge, date: string): SchedulePatch {
  const source = requireInterval(data), day = dateToDay(date);
  const minimum = source.allDay ? DAY : 15;
  if (edge === 'start') {
    const start = Math.min(source.end - minimum, source.start + (day - Math.floor(source.start / DAY)) * DAY);
    return intervalPatch({ ...source, start });
  }
  const end = Math.max(source.start + minimum, source.end + (day - (Math.ceil(source.end / DAY) - 1)) * DAY);
  return intervalPatch({ ...source, end });
}
/** Vertical time-grid handles use the same fixed opposite endpoint and snapping. */
export function resizeTaskTimeEdge(data: TaskSchedule, edge: CalendarEdge, deltaPixels: number, pixelsPerHour: number): SchedulePatch {
  const source = requireInterval(data);
  if (source.allDay) throw new RangeError('Use date edges for an all-day task');
  const delta = pixelsToMinuteDelta(deltaPixels, pixelsPerHour);
  return intervalPatch(edge === 'start'
    ? { ...source, start: Math.min(source.end - 15, source.start + delta) }
    : { ...source, end: Math.max(source.start + 15, source.end + delta) });
}
function validateInterval(interval: MinuteInterval): void {
  integer(interval.start, 'Interval start'); integer(interval.end, 'Interval end');
  if (interval.end <= interval.start) throw new RangeError('Interval must have positive duration');
}
export function clipInterval(interval: MinuteInterval, window: MinuteInterval): MinuteInterval | null {
  validateInterval(interval); validateInterval(window);
  const start = Math.max(interval.start, window.start), end = Math.min(interval.end, window.end);
  return end > start ? { start, end } : null;
}
/** Grid clipping never includes the date of an exclusive midnight endpoint. */
export function splitIntervalByDay(interval: MinuteInterval, from: string, through: string): DaySegment[] {
  const first = dateToDay(from), last = dateToDay(through);
  if (last < first) throw new RangeError('Grid end precedes start');
  const clipped = clipInterval(interval, { start: first * DAY, end: (last + 1) * DAY });
  if (!clipped) return [];
  const out: DaySegment[] = [];
  for (let day = Math.floor(clipped.start / DAY); day < Math.ceil(clipped.end / DAY); day++) {
    const start = Math.max(day * DAY, clipped.start), end = Math.min((day + 1) * DAY, clipped.end);
    out.push({ date: dayToDate(day), start, end, startMinute: start - day * DAY, endMinute: end - day * DAY, continuesBefore: interval.start < start, continuesAfter: interval.end > end });
  }
  return out;
}
/** Horizontal month/week bars split at row boundaries. endColumn is exclusive.
 * Dates must be contiguous and ascending. rows can be partial (e.g. a day grid).
 */
export function clipToDateGrid(interval: MinuteInterval, dates: readonly string[], columns = 7): GridSegment[] {
  validateInterval(interval); positive(columns, 'Columns');
  if (!dates.length) return [];
  const first = dateToDay(dates[0]);
  dates.forEach((date, i) => { if (dateToDay(date) !== first + i) throw new RangeError('Grid dates must be contiguous and ascending'); });
  const clipped = clipInterval(interval, { start: first * DAY, end: (first + dates.length) * DAY });
  if (!clipped) return [];
  const firstIndex = Math.floor(clipped.start / DAY) - first, lastIndex = Math.ceil(clipped.end / DAY) - first - 1;
  const result: GridSegment[] = [];
  for (let index = firstIndex; index <= lastIndex;) {
    const row = Math.floor(index / columns), rowEnd = Math.min(lastIndex, (row + 1) * columns - 1);
    const start = Math.max(clipped.start, (first + index) * DAY), end = Math.min(clipped.end, (first + rowEnd + 1) * DAY);
    result.push({ row, startColumn: index % columns, endColumn: rowEnd % columns + 1, startDate: dates[index], endDate: dates[rowEnd], start, end, continuesBefore: interval.start < start, continuesAfter: interval.end > end });
    index = rowEnd + 1;
  }
  return result;
}
export type LaneInterval<T extends MinuteInterval> = T & { lane: number; laneCount: number; group: number };
/** Interval graph coloring: adjacent endpoints do not overlap. laneCount is the
 * maximum concurrency of each connected overlap group, including cross-hour
 * chains. Pass clipped day segments to compute lanes separately per day.
 * Returns chronological order; input values are never mutated.
 */
export function allocateOverlapLanes<T extends MinuteInterval>(intervals: readonly T[]): LaneInterval<T>[] {
  intervals.forEach(validateInterval);
  const sorted = intervals.map((item, index) => ({ item, index })).sort((a, b) => a.item.start - b.item.start || b.item.end - a.item.end || a.index - b.index);
  const output: LaneInterval<T>[] = [];
  let laneEnds: number[] = [], group = -1, groupStart = 0;
  function closeGroup(): void { for (let i = groupStart; i < output.length; i++) output[i].laneCount = laneEnds.length; }
  for (const { item } of sorted) {
    if (laneEnds.length === 0 || laneEnds.every(end => end <= item.start)) {
      closeGroup(); laneEnds = []; group++; groupStart = output.length;
    }
    let lane = laneEnds.findIndex(end => end <= item.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.end;
    output.push({ ...item, lane, laneCount: 0, group });
  }
  closeGroup(); return output;
}
/** Pixel coordinates are relative to local midnight, ignoring scroll position.
 * Snap both endpoints to the nearest step, sort upward/downward drags, and keep
 * a one-step minimum. Coordinates may exceed a day for explicit multi-day drags.
 */
export function dragSelectTask(date: string, startPixels: number, endPixels: number, pixelsPerHour: number, snapMinutes = 15): SchedulePatch {
  const a = pixelsToMinuteDelta(startPixels, pixelsPerHour, snapMinutes), b = pixelsToMinuteDelta(endPixels, pixelsPerHour, snapMinutes);
  const midnight = wallToMinute(date), start = midnight + Math.min(a, b), end = midnight + Math.max(Math.max(a, b), Math.min(a, b) + snapMinutes);
  return intervalPatch({ allDay: false, start, end, durationMinutes: end - start });
}
export function calendarGridDates(anchor: string, view: 'month' | 'week' | 'day', weekStartsOn = 1): string[] {
  integer(weekStartsOn, 'Week start'); if (weekStartsOn < 0 || weekStartsOn > 6) throw new RangeError('Week start must be 0–6');
  const [year, month] = dateParts(anchor);
  let first = view === 'month' ? formatDate(year, month, 1) : anchor;
  if (view !== 'day') first = addCalendarDays(first, -((gregorianDate(...dateParts(first)).getUTCDay() - weekStartsOn + 7) % 7));
  const length = view === 'month' ? 42 : view === 'week' ? 7 : view === 'day' ? 1 : 0;
  if (!length) throw new RangeError('Unsupported calendar view');
  return Array.from({ length }, (_, i) => addCalendarDays(first, i));
}
