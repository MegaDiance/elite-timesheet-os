export interface ShiftClassification {
    date: string;
    dayOfWeek: string;
    isPublicHoliday: boolean;
    holidayName?: string;
    normalHours: number;
    saturdayHours: number;
    sundayHours: number;
    publicHolidayHours: number;
    leaveHours: number;
    leaveType?: string;
    totalHours: number;
}

/**
 * Parses HH:mm string to minutes from 00:00
 */
export function timeToMinutes(t?: string): number {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

/**
 * Returns weekday name for a date string YYYY-MM-DD
 * Pure UTC calculation to prevent timezone drift
 */
export function getWeekdayName(dateIso: string): string {
    const [y, m, d] = dateIso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[dt.getUTCDay()];
}

/**
 * Adds days to an ISO date string (YYYY-MM-DD)
 */
export function addDaysToIso(dateIso: string, n: number): string {
    const [y, m, d] = dateIso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
    return dt.toISOString().split('T')[0];
}

/**
 * Classifies one timed segment's paid hours across calendar dates, accounting for midnight crossovers.
 * E.g. Friday 22:00 -> Saturday 02:00 splits into:
 *   - Friday: 2 hours (Normal)
 *   - Saturday: 2 hours (Saturday)
 * If a date is a public holiday, all work hours on that calendar date are public holiday hours.
 *
 * `netHours` is the segment's stored paid hours — already net of the day's break (see
 * services/segments.ts). Classification never re-derives a break of its own, so the category
 * columns always add up to the hours that were recorded. When a segment crosses midnight the
 * unpaid time comes off the longer slice. Does NOT calculate penalty rates or multipliers.
 */
export function classifySegmentHours(params: {
    recordDate: string;
    startTime: string;
    endTime: string;
    netHours: number;
    segmentType: string;
    holidays: Map<string, string>;
}): ShiftClassification[] {
    const isLeave = params.segmentType !== 'WORK';
    const startM = timeToMinutes(params.startTime);
    const endM = timeToMinutes(params.endTime);
    if (startM === endM) return [];

    const slices: { date: string; minutes: number }[] = endM > startM
        ? [{ date: params.recordDate, minutes: endM - startM }]
        : [
            { date: params.recordDate, minutes: 1440 - startM },
            { date: addDaysToIso(params.recordDate, 1), minutes: endM },
        ];

    const rawMinutes = slices.reduce((acc, s) => acc + s.minutes, 0);
    const unpaidMinutes = Math.max(0, rawMinutes - Math.round(params.netHours * 60));
    const longerSlice = slices.length === 1 || slices[0].minutes >= slices[1].minutes ? 0 : 1;

    return slices.map((s, idx) => {
        const netMinutes = idx === longerSlice ? Math.max(0, s.minutes - unpaidMinutes) : s.minutes;
        const hours = Math.round((netMinutes / 60) * 100) / 100;
        const weekday = getWeekdayName(s.date);
        const isPublicHoliday = params.holidays.has(s.date);

        const result: ShiftClassification = {
            date: s.date,
            dayOfWeek: weekday,
            isPublicHoliday,
            holidayName: params.holidays.get(s.date),
            normalHours: 0,
            saturdayHours: 0,
            sundayHours: 0,
            publicHolidayHours: 0,
            leaveHours: 0,
            leaveType: isLeave ? params.segmentType : undefined,
            totalHours: hours
        };

        if (isLeave) result.leaveHours = hours;
        else if (isPublicHoliday) result.publicHolidayHours = hours;
        else if (weekday === 'Sat') result.saturdayHours = hours;
        else if (weekday === 'Sun') result.sundayHours = hours;
        else result.normalHours = hours;

        return result;
    });
}
