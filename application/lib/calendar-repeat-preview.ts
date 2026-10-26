import {addCalendarDays, dateToDay, normalizeTaskInterval, wallToMinute} from '../assets/calendar-layout';
import {getOccurrences, type LocalOccurrence} from '../assets/recurrence';
import type {RecordData} from './types';

/** Shift local calendar dates, not elapsed milliseconds, preserving wall times
 * across DST. These display-only copies never change the source task or rule. */
export function repeatPreviewData(data: RecordData, occurrence: LocalOccurrence): RecordData {
  const dueDate = data.dueDate || data.recurrence?.start.date;
  const offset = dueDate ? dateToDay(occurrence.date) - dateToDay(dueDate) : 0;
  return {
    ...data,
    dueDate: occurrence.date,
    dueTime: occurrence.time,
    ...(data.startDate ? {startDate: addCalendarDays(data.startDate, offset)} : {}),
    // Stored instants describe the original occurrence, never this preview.
    startInstant: '',
    endInstant: '',
  };
}

/** Recurrence dates anchor the deadline. Include a later deadline when its
 * multi-day span starts inside the visible window, then clip by actual span. */
export function repeatPreviews(data: RecordData, from: string, through: string): RecordData[] {
  if (!data.recurrence || data.status !== 'open') return [];
  const dueDate = data.dueDate || data.recurrence.start.date;
  const lookAhead = data.startDate ? Math.max(0, dateToDay(dueDate) - dateToDay(data.startDate)) : 0;
  const windowStart = wallToMinute(from), windowEnd = wallToMinute(through) + 1440;
  const occurrences = getOccurrences(data.recurrence, {from, through, limit:1000});
  if (lookAhead && occurrences.length < 1000) {
    try {
      occurrences.push(...getOccurrences(data.recurrence, {
        from:addCalendarDays(through, 1), through:addCalendarDays(through, lookAhead), limit:1000-occurrences.length,
      }));
    } catch {
      // A bounded holiday/lunar calendar may not cover the look-ahead dates.
      // Keep verified in-window occurrences instead of hiding the entire series.
    }
  }
  return occurrences
    .filter(occurrence => occurrence.date > (data.dueDate || ''))
    .map(occurrence => repeatPreviewData(data, occurrence))
    .filter(preview => {
      const interval = normalizeTaskInterval(preview);
      return interval && interval.start < windowEnd && interval.end > windowStart;
    });
}
