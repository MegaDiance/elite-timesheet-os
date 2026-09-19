/**
 * Utility functions for 14-day fortnight cycles.
 * Matches backend periodUtils.ts logic and reference anchor date.
 */

export function getFortnightStart(d: Date | string = new Date()): Date {
  let utcDate: Date;
  if (typeof d === 'string') {
    const parts = d.split('T')[0].split('-');
    if (parts.length === 3) {
      utcDate = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    } else {
      const dt = new Date(d);
      utcDate = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    }
  } else {
    utcDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  // Reference Sunday: March 29, 2026 UTC
  const ref = new Date(Date.UTC(2026, 2, 29));
  const diffDays = Math.floor((utcDate.getTime() - ref.getTime()) / 86400000);
  const offset = Math.floor(diffDays / 14);
  return new Date(ref.getTime() + offset * 14 * 86400000);
}

export function fmtISO(d: Date): string {
  return (
    d.getUTCFullYear() +
    '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getUTCDate()).padStart(2, '0')
  );
}

export function getFortnightStartIso(d: Date | string = new Date()): string {
  return fmtISO(getFortnightStart(d));
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

export function getFortnightDates(startDate: Date | string): Date[] {
  const start = typeof startDate === 'string' ? getFortnightStart(startDate) : startDate;
  const dates: Date[] = [];
  for (let i = 0; i < 14; i++) {
    dates.push(addDays(start, i));
  }
  return dates;
}

export function formatFortnightLabel(startDate: Date | string): string {
  const start = typeof startDate === 'string' ? getFortnightStart(startDate) : startDate;
  const end = addDays(start, 13);
  const opt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  const startStr = start.toLocaleDateString(undefined, opt);
  const endStr = end.toLocaleDateString(undefined, { ...opt, year: 'numeric' });
  return `${startStr} – ${endStr}`;
}
