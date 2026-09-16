import { query } from './db';

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
 * Classifies a shift's worked hours across calendar dates, accounting for midnight crossovers.
 * E.g. Friday 22:00 -> Saturday 02:00 splits into:
 *   - Friday: 2 hours (Normal)
 *   - Saturday: 2 hours (Saturday)
 * If a date is a public holiday, all worked hours on that calendar date are classified as public holiday hours.
 * Does NOT calculate penalty rates or multipliers.
 */
export async function classifyShiftHours(
    orgId: string,
    recordDate: string,
    startTime: string,
    endTime: string,
    segmentType: string = 'WORK'
): Promise<ShiftClassification[]> {
    const isLeave = ['Sick', 'Annual', 'TIL'].includes(segmentType);
    
    // Check public holidays for this organization
    const holidayRes = await query('SELECT holiday_date, name FROM public_holidays WHERE org_id = $1', [orgId]);
    const holidayMap = new Map<string, string>();
    if (holidayRes && holidayRes.rows) {
        holidayRes.rows.forEach((h: any) => holidayMap.set(h.holiday_date, h.name));
    }

    const startM = timeToMinutes(startTime);
    const endM = timeToMinutes(endTime);

    // If times are invalid or identical
    if (startM === endM) {
        return [];
    }

    const crossesMidnight = endM < startM;
    const slices: { date: string, minutes: number }[] = [];

    if (!crossesMidnight) {
        // Entire shift on recordDate
        slices.push({ date: recordDate, minutes: endM - startM });
    } else {
        // Shift crosses midnight into next day
        const day1Minutes = 1440 - startM;
        const day2Minutes = endM;
        const nextDate = addDaysToIso(recordDate, 1);

        slices.push({ date: recordDate, minutes: day1Minutes });
        slices.push({ date: nextDate, minutes: day2Minutes });
    }

    // Typical break deduction: If total shift >= 6h, deduct 30 min (0.5h) proportionally from slices
    const totalMinutes = slices.reduce((acc, s) => acc + s.minutes, 0);
    const breakDeductionM = totalMinutes >= 360 ? 30 : 0;
    
    return slices.map((s, idx) => {
        // Deduct break from the longer slice
        let netMinutes = s.minutes;
        if (breakDeductionM > 0) {
            if (slices.length === 1) {
                netMinutes = Math.max(0, netMinutes - breakDeductionM);
            } else if (idx === (slices[0].minutes >= slices[1].minutes ? 0 : 1)) {
                netMinutes = Math.max(0, netMinutes - breakDeductionM);
            }
        }

        const hours = Math.round((netMinutes / 60) * 100) / 100;
        const weekday = getWeekdayName(s.date);
        const isPublicHoliday = holidayMap.has(s.date);
        const holidayName = holidayMap.get(s.date);

        let normalHours = 0;
        let saturdayHours = 0;
        let sundayHours = 0;
        let publicHolidayHours = 0;
        let leaveHours = 0;

        if (isLeave) {
            leaveHours = hours;
        } else if (isPublicHoliday) {
            publicHolidayHours = hours;
        } else if (weekday === 'Sat') {
            saturdayHours = hours;
        } else if (weekday === 'Sun') {
            sundayHours = hours;
        } else {
            normalHours = hours;
        }

        return {
            date: s.date,
            dayOfWeek: weekday,
            isPublicHoliday,
            holidayName,
            normalHours,
            saturdayHours,
            sundayHours,
            publicHolidayHours,
            leaveHours,
            leaveType: isLeave ? segmentType : undefined,
            totalHours: hours
        };
    });
}
