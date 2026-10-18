import { Temporal } from '@js-temporal/polyfill';
import { formatNumber, t } from './i18n.ts';
export type CountdownUnit = 'days' | 'weeks' | 'months' | 'years';
const unitKey = { days: 'domain.unit.day', weeks: 'domain.unit.week', months: 'domain.unit.month', years: 'domain.unit.year' } as const;
function label(unit: CountdownUnit, count: number) { return t(unitKey[unit], { count }); }
function amount(unit: CountdownUnit, count: number) { return formatNumber(count) + ' ' + label(unit, count); }
function remainder(parts: string[]) { return parts.length ? t('domain.countdown.remainder', { amount: parts.join(' ') }) : ''; }
export function countdownAmount(today: string, event: string, unit: CountdownUnit = 'days', includeStart = false) {
  const a = Temporal.PlainDate.from(today), b = Temporal.PlainDate.from(event);
  const signed = a.until(b, { largestUnit: 'days' }).days, direction = signed === 0 ? 'today' : signed > 0 ? 'future' : 'past';
  const start = signed < 0 ? b : a;
  let end = signed < 0 ? a : b;
  if (includeStart) end = end.add({ days: 1 });
  const days = start.until(end, { largestUnit: 'days' }).days;
  if (unit === 'days') return { direction, value: days, label: label(unit, days), remainder: '' };
  if (unit === 'weeks') { const value = Math.floor(days / 7); return { direction, value, label: label(unit, value), remainder: remainder(days % 7 ? [amount('days', days % 7)] : []) }; }
  if (unit !== 'months' && unit !== 'years') throw new Error(t('core.invalidCountdownUnit'));
  let years = end.year - start.year;
  if (Temporal.PlainDate.compare(start.add({ years }), end) > 0) years--;
  const cursor = unit === 'years' ? start.add({ years }) : start;
  let months = (end.year - cursor.year) * 12 + end.month - cursor.month;
  if (Temporal.PlainDate.compare(cursor.add({ months }), end) > 0) months--;
  const rest = cursor.add({ months }).until(end, { largestUnit: 'days' }).days;
  const value = unit === 'months' ? months : years;
  return { direction, value, label: label(unit, value), remainder: remainder([...(unit === 'years' && months ? [amount('months', months)] : []), ...(rest ? [amount('days', rest)] : [])]) };
}
