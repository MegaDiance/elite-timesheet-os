import { query } from './db';
import { badRequest, HttpError } from './policy';
import { addDays, fmtISO, parseIsoDateUtc } from './periodUtils';
import { BreakRule, DayEntry, SegmentType, breakRuleFor, loadBreakSettings, rowsToDay, writeDayRecord } from './segments';

export interface LeaveRequestRow {
    id: string;
    org_id: string;
    employee_id: string;
    location_id: string;
    leave_type: SegmentType;
    start_date: string;
    end_date: string;
    start_time: string | null;
    end_time: string | null;
    hours: number | null;
    reason: string | null;
    status: 'Pending' | 'Approved' | 'Rejected';
}

const toMinutes = (t: string): number => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

/** Whole-inclusive-date-range overlap, refined for two same-day partial requests by their actual times. */
function requestsOverlap(a: { start_date: string; end_date: string; start_time: string | null; end_time: string | null },
    b: { start_date: string; end_date: string; start_time: string | null; end_time: string | null }): boolean {
    if (a.end_date < b.start_date || b.end_date < a.start_date) return false;
    const sameSingleDay = a.start_date === a.end_date && b.start_date === b.end_date && a.start_date === b.start_date;
    if (sameSingleDay && a.start_time && a.end_time && b.start_time && b.end_time) {
        return toMinutes(a.start_time) < toMinutes(b.end_time) && toMinutes(b.start_time) < toMinutes(a.end_time);
    }
    return true;
}

/**
 * Never silently picks a side: two leave requests for the same worker with overlapping dates (and,
 * for two same-day partial requests, overlapping times) are rejected outright, matching the
 * `OVERLAP` convention `assertNoOverlap` already uses for segments.
 */
export async function assertNoOverlappingLeaveRequests(
    employeeId: string,
    candidate: { start_date: string; end_date: string; start_time: string | null; end_time: string | null },
    excludeId?: string
): Promise<void> {
    const res = await query(
        `SELECT start_date, end_date, start_time, end_time FROM leave_requests
          WHERE employee_id = $1 AND status IN ('Pending', 'Approved') AND end_date >= $2 AND start_date <= $3
            AND ($4::uuid IS NULL OR id != $4)`,
        [employeeId, candidate.start_date, candidate.end_date, excludeId ?? null]
    );
    for (const row of res.rows) {
        if (requestsOverlap(candidate, { ...row, start_time: row.start_time?.slice(0, 5) ?? null, end_time: row.end_time?.slice(0, 5) ?? null })) {
            throw badRequest('LEAVE_OVERLAP', 'This overlaps another leave request that is pending or approved. Resolve it first.');
        }
    }
}

function retypeWorkToLeave(entries: DayEntry[], leaveType: SegmentType): DayEntry[] {
    return entries.map(e => (e.type === 'WORK' ? { ...e, type: leaveType } : e));
}

const isoDatesBetween = (startIso: string, endIso: string): string[] => {
    const dates: string[] = [];
    let cursor = parseIsoDateUtc(startIso);
    const end = parseIsoDateUtc(endIso);
    while (cursor <= end) {
        dates.push(fmtISO(cursor));
        cursor = addDays(cursor, 1);
    }
    return dates;
};

/**
 * Materializes an approved leave request into shift_segments, through the same `writeDayRecord`
 * pipeline every other day-write uses — so break recomputation, lock checks and approval checks
 * all apply exactly as they would to a manual edit, unlike the old (deleted) code's raw INSERTs.
 *
 * Whole-day request: every existing WORK entry on the date range is retyped to the leave type at
 * its existing times (what a manager already does by hand for "called in sick"); a day with
 * nothing recorded at all gets an hours-only fallback entry (total hours ÷ days in range — there
 * is no better signal with no roster to anchor to).
 *
 * Partial-day request (single day, start_time/end_time set): materializes as one synthetic leave
 * entry fed through the normal day-write pipeline — `automatically_merge_leave_with_roster`
 * decides whether it splits the rostered shift around it or is rejected as an overlap, with no
 * special-casing here.
 */
export async function materializeLeaveRequest(
    orgId: string,
    worker: { id: string; location_id: string },
    request: Pick<LeaveRequestRow, 'leave_type' | 'start_date' | 'end_date' | 'start_time' | 'end_time' | 'hours'>
): Promise<{ applied: string[]; skipped: Array<{ date: string; reason: string }> }> {
    const settings = await loadBreakSettings(orgId);
    const applied: string[] = [];
    const skipped: Array<{ date: string; reason: string }> = [];

    const writeOne = async (date: string, body: Record<string, unknown>, rule: BreakRule) => {
        try {
            await writeDayRecord({ orgId, worker, recordDate: date, body, rule });
            applied.push(date);
        } catch (err) {
            skipped.push({ date, reason: err instanceof HttpError ? err.code : 'ERROR' });
        }
    };

    if (request.start_time && request.end_time) {
        // Partial-day: a single synthetic leave entry, merged (or not) into whatever else is there.
        const date = request.start_date;
        const rule = breakRuleFor(settings, date);
        const recRes = await query('SELECT dr.id FROM daily_records dr WHERE dr.org_id = $1 AND dr.employee_id = $2 AND dr.record_date = $3', [orgId, worker.id, date]);
        const existing = recRes.rows.length ? (await query('SELECT * FROM shift_segments WHERE record_id = $1', [recRes.rows[0].id])).rows : [];
        const view = rowsToDay(existing);
        const leaveEntry: DayEntry = { type: request.leave_type, start: request.start_time, finish: request.end_time, hours: 0, has_break: true, break_mins: null };
        await writeOne(date, { scope: 'BOTH', roster: [...view.roster, leaveEntry], timesheet: [...view.timesheet, leaveEntry], note: view.note }, rule);
        return { applied, skipped };
    }

    const dates = isoDatesBetween(request.start_date, request.end_date);
    const hoursPerDay = request.hours != null ? Math.round((Number(request.hours) / dates.length) * 100) / 100 : 0;

    for (const date of dates) {
        const rule = breakRuleFor(settings, date);
        const recRes = await query('SELECT dr.id FROM daily_records dr WHERE dr.org_id = $1 AND dr.employee_id = $2 AND dr.record_date = $3', [orgId, worker.id, date]);
        const existing = recRes.rows.length ? (await query('SELECT * FROM shift_segments WHERE record_id = $1', [recRes.rows[0].id])).rows : [];
        const view = rowsToDay(existing);

        if (view.roster.length === 0 && view.timesheet.length === 0) {
            const leaveEntry: DayEntry = { type: request.leave_type, start: null, finish: null, hours: hoursPerDay, has_break: true, break_mins: null };
            await writeOne(date, { scope: 'BOTH', roster: [leaveEntry], timesheet: [], note: null }, rule);
            continue;
        }

        const hasWork = view.roster.some(e => e.type === 'WORK') || view.timesheet.some(e => e.type === 'WORK');
        if (!hasWork) { skipped.push({ date, reason: 'NOTHING_TO_CHANGE' }); continue; }

        await writeOne(date, {
            scope: 'BOTH',
            roster: retypeWorkToLeave(view.roster, request.leave_type),
            timesheet: retypeWorkToLeave(view.timesheet, request.leave_type),
            note: view.note,
        }, rule);
    }

    return { applied, skipped };
}
