import { addDays, fmtISO, getFortnightStartIso } from '../../utils/fortnight';

/**
 * Calendar-date helpers for the roster. Dates are 'YYYY-MM-DD' strings and are always handled in
 * UTC, so a day never shifts with the browser's timezone.
 */

function parseIsoUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export const shiftIso = (iso: string, days: number): string => fmtISO(addDays(parseIsoUtc(iso), days));

/** The 14 dates of the pay period that starts on `startIso`. */
export const fortnightDays = (startIso: string): string[] => Array.from({ length: 14 }, (_, i) => shiftIso(startIso, i));

/** Today's date where the user is (not in UTC). */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const currentFortnightIso = (): string => getFortnightStartIso(todayIso());

export const isWeekendIso = (iso: string): boolean => {
  const day = parseIsoUtc(iso).getUTCDay();
  return day === 0 || day === 6;
};

/** "Tue 7 Apr" (short) or "Tuesday 7 April" (long). */
export function dayLabel(iso: string, style: 'short' | 'long' = 'short'): string {
  const options: Intl.DateTimeFormatOptions = style === 'long'
    ? { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }
    : { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' };
  return parseIsoUtc(iso).toLocaleDateString('en-AU', options).replace(',', '');
}

/** "Mon 30 Mar – Fri 3 Apr" for a run of days, a short list, or "5 days". */
export function describeDays(chosen: string[]): string {
  const sorted = [...chosen].sort();
  if (sorted.length === 0) return 'no days';
  if (sorted.length === 1) return dayLabel(sorted[0]);
  const run = sorted.every((d, i) => i === 0 || shiftIso(sorted[i - 1], 1) === d);
  if (run) return `${dayLabel(sorted[0])} – ${dayLabel(sorted[sorted.length - 1])}`;
  if (sorted.length <= 3) return sorted.map(d => dayLabel(d)).join(', ');
  return `${sorted.length} days`;
}

export const weekdayShort = (iso: string): string =>
  parseIsoUtc(iso).toLocaleDateString('en-AU', { weekday: 'short', timeZone: 'UTC' });

export const dayOfMonth = (iso: string): number => parseIsoUtc(iso).getUTCDate();

/** "5 Apr – 18 Apr 2026" for the pay period starting on `startIso`. */
export function periodLabel(startIso: string): string {
  const start = parseIsoUtc(startIso);
  const end = addDays(start, 13);
  const short: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return `${start.toLocaleDateString('en-AU', short)} – ${end.toLocaleDateString('en-AU', { ...short, year: 'numeric' })}`;
}
