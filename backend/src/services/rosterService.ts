import { query, withTransaction } from './db';
import { addDays, fmtISO, parseIsoDateUtc } from './periodUtils';
import { HttpError, writeAudit } from './policy';
import { lockWorkerPeriod } from './periodLocks';
import {
    BreakRule, DayEntry, SEGMENT_TYPES, SegmentType, breakRuleFor, isWeekendDate, loadBreakSettings, mergeLeaveIntoRoster, rowsToDay, writeDayRecord,
} from './segments';

/**
 * Fortnight totals for one worker (the caller has already authorised access to that worker).
 */
export async function calculateRosterStats(orgId: string, workerId: string, fortnightStartIso: string) {
    const endIso = fmtISO(addDays(parseIsoDateUtc(fortnightStartIso), 13));
    const segRes = await query(
        `SELECT dr.record_date, dr.has_actuals, ss.segment_type, ss.actual_segment_type, ss.roster_hours, ss.actual_hours, ss.is_unplanned
           FROM daily_records dr JOIN shift_segments ss ON ss.record_id = dr.id
          WHERE dr.org_id = $1 AND dr.employee_id = $2 AND dr.record_date >= $3 AND dr.record_date <= $4`,
        [orgId, workerId, fortnightStartIso, endIso]
    );

    let rostered = 0;
    let actual = 0;
    const byType: Record<string, number> = Object.fromEntries(SEGMENT_TYPES.map(t => [t, 0]));
    let weekdays = 0;
    let weekends = 0;
    let unplanned = 0;

    for (const seg of segRes.rows) {
        rostered += Number(seg.roster_hours || 0);
        actual += Number(seg.actual_hours || 0);

        const type = (seg.has_actuals && seg.actual_segment_type) || seg.segment_type;
        const hrs = seg.has_actuals ? Number(seg.actual_hours || 0) : Number(seg.roster_hours || 0);
        byType[type] = (byType[type] || 0) + hrs;
        if (type === 'WORK') {
            if (isWeekendDate(String(seg.record_date))) weekends += hrs; else weekdays += hrs;
        }
        if (seg.is_unplanned) unplanned += hrs;
    }

    const empRes = await query('SELECT contracted_hours FROM employees WHERE id = $1 AND org_id = $2', [workerId, orgId]);
    const contracted = Number(empRes.rows[0]?.contracted_hours ?? 76);
    const round2 = (n: number) => Math.round(n * 100) / 100;

    return {
        rostered: round2(rostered),
        actual: round2(actual),
        contracted,
        variance: round2(actual - contracted),
        leave: {
            Normal: round2(byType.WORK),
            Weekdays: round2(weekdays),
            Weekends: round2(weekends),
            Sick: round2(byType.Sick),
            Annual: round2(byType.Annual),
            TIL: round2(byType.TIL),
            LWIP: round2(byType.LWIP),
            Other: round2(byType.Other),
            Unplanned: round2(unplanned),
        },
    };
}

interface BulkScope {
    orgId: string;
    /** Branches the caller is authorised for — resolved by the route, never taken from the client. */
    branchIds: string[];
    fortnightStartIso: string;
    selectedDays?: number[];
    /** Restricts to just these workers (already authorised by the route via loadWorker), e.g. a single row's "Roster"/"Log" button. Omitted for the whole-branch tools. */
    employeeIds?: string[];
    actorId: string;
}

function targetDayIndexes(selectedDays?: number[]): number[] {
    const all = Array.from({ length: 14 }, (_, i) => i);
    if (!Array.isArray(selectedDays) || selectedDays.length === 0) return all;
    return all.filter(i => selectedDays.includes(i));
}

/** Workers in scope whose period can still be changed: active, not approved, and in a branch that is not locked. */
async function editableWorkerRows(scope: BulkScope, lockColumn: 'roster_locked' | 'timesheet_locked', run: typeof query = query) {
    const res = await run(
        `SELECT e.id, e.location_id
           FROM employees e
          WHERE e.org_id = $1 AND e.location_id = ANY($2::uuid[]) AND e.is_active = true
            AND ($4::uuid[] IS NULL OR e.id = ANY($4::uuid[]))
            AND NOT EXISTS (SELECT 1 FROM timesheet_submissions ts
                             WHERE ts.org_id = e.org_id AND ts.employee_id = e.id AND ts.start_date = $3 AND ts.status = 'Approved')
            AND NOT EXISTS (SELECT 1 FROM fortnight_locks fl
                             WHERE fl.org_id = e.org_id AND fl.location_id = e.location_id AND fl.start_date = $3 AND fl.${lockColumn} = true)
          ORDER BY e.id`,
        [scope.orgId, scope.branchIds, scope.fortnightStartIso, scope.employeeIds ?? null]
    );
    return res.rows as Array<{ id: string; location_id: string }>;
}

async function editableWorkers(scope: BulkScope, lockColumn: 'roster_locked' | 'timesheet_locked') {
    return (await editableWorkerRows(scope, lockColumn)).map(r => r.id);
}

interface ApprovedLeave {
    leave_type: SegmentType;
    start_date: string;
    end_date: string;
    start_time: string | null;
    end_time: string | null;
}

/** Approved leave requests of one worker that touch [startIso, endIso]. The leave_requests table is the source of truth for approved leave. */
export async function loadApprovedLeave(orgId: string, workerId: string, startIso: string, endIso: string): Promise<ApprovedLeave[]> {
    const res = await query(
        `SELECT leave_type, start_date, end_date, start_time, end_time FROM leave_requests
          WHERE org_id = $1 AND employee_id = $2 AND status = 'Approved' AND start_date <= $4 AND end_date >= $3`,
        [orgId, workerId, startIso, endIso]
    );
    return res.rows.map((r: any) => ({ ...r, start_time: r.start_time ? String(r.start_time).slice(0, 5) : null, end_time: r.end_time ? String(r.end_time).slice(0, 5) : null }));
}

/**
 * Replaces the ROSTER of one worker-day with `shifts` without ever removing, shortening or
 * overwriting leave. The rules, in order:
 *
 *   - Approved whole-day leave (a leave request with no times) covering the date, or any
 *     hours-only leave already on the day's roster → the day is left exactly as it is.
 *   - Timed leave already on the roster, plus any approved partial-day leave request for the date,
 *     is kept; the new Normal Work shifts are split around it (never over it).
 *   - The worked side (timesheet) is never touched: the write is roster-only.
 *   - Approval and roster/timesheet locks are enforced by writeDayRecord, like every other write.
 *
 * Returns null when applied, otherwise why the day was skipped (e.g. APPROVED_LEAVE, LEAVE_ON_DAY,
 * ROSTER_LOCKED, TIMESHEET_ALREADY_APPROVED, OVERLAP), so callers can report every skipped day.
 */
export async function applyRosterKeepingLeave(params: {
    orgId: string;
    worker: { id: string; location_id: string };
    date: string;
    shifts: DayEntry[];
    approvedLeave: ApprovedLeave[];
    rule: BreakRule;
}): Promise<string | null> {
    const { orgId, worker, date, shifts, approvedLeave, rule } = params;
    const covering = approvedLeave.filter(l => l.start_date <= date && l.end_date >= date);
    if (covering.some(l => !l.start_time || !l.end_time)) return 'APPROVED_LEAVE';

    const recRes = await query('SELECT id FROM daily_records WHERE org_id = $1 AND employee_id = $2 AND record_date = $3', [orgId, worker.id, date]);
    const existing = recRes.rows.length ? (await query('SELECT * FROM shift_segments WHERE record_id = $1', [recRes.rows[0].id])).rows : [];
    const leave = rowsToDay(existing).roster.filter(e => e.type !== 'WORK');
    if (leave.some(e => !e.start || !e.finish)) return 'LEAVE_ON_DAY';

    for (const l of covering) {
        const already = leave.some(e => e.type === l.leave_type && e.start === l.start_time && e.finish === l.end_time);
        if (!already) leave.push({ type: l.leave_type, start: l.start_time, finish: l.end_time, hours: 0, has_break: true, break_mins: null });
    }

    try {
        await writeDayRecord({ orgId, worker, recordDate: date, body: { scope: 'ROSTER', roster: mergeLeaveIntoRoster([...leave, ...shifts]) }, rule });
        return null;
    } catch (err) {
        if (err instanceof HttpError) return err.code;
        throw err;
    }
}

export interface BulkRosterResult {
    workers: number;
    applied: number;
    skipped: Array<{ employee_id: string; date: string; reason: string }>;
}

/**
 * Applies each worker's default roster template to the selected days.
 *
 * Goes through applyRosterKeepingLeave for every day, so it never overwrites or deletes worked
 * hours or leave (rostered leave, or approved leave requests), and every lock/approval rule is
 * enforced the same way as a manual edit. Days it could not change are reported, not silently
 * dropped. A worked entry with no matching template shift keeps its hours and becomes unplanned.
 */
export async function autoRosterAll(scope: BulkScope): Promise<BulkRosterResult> {
    const settings = await loadBreakSettings(scope.orgId);
    const fortnightStart = parseIsoDateUtc(scope.fortnightStartIso);
    const fortnightEnd = fmtISO(addDays(fortnightStart, 13));
    const workerIds = await editableWorkers(scope, 'roster_locked');
    const result: BulkRosterResult = { workers: workerIds.length, applied: 0, skipped: [] };

    for (const workerId of workerIds) {
        const worker = (await query('SELECT id, location_id FROM employees WHERE id = $1 AND org_id = $2', [workerId, scope.orgId])).rows[0];
        const templates = (await query(
            'SELECT day_index, segment_type, roster_in, roster_out, has_break, break_mins FROM roster_templates WHERE employee_id = $1 AND roster_in IS NOT NULL AND roster_out IS NOT NULL ORDER BY day_index, roster_in',
            [workerId]
        )).rows;
        const approvedLeave = await loadApprovedLeave(scope.orgId, workerId, scope.fortnightStartIso, fortnightEnd);

        for (const dayIndex of targetDayIndexes(scope.selectedDays)) {
            const dayTemplates = templates.filter((t: any) => t.day_index === dayIndex);
            // A worker with no template at all gets the standard 09:00–17:00 shift.
            const dateIso = fmtISO(addDays(fortnightStart, dayIndex));
            const shifts: DayEntry[] = dayTemplates.length > 0
                ? dayTemplates.map((t: any) => ({
                    type: t.segment_type, start: String(t.roster_in).slice(0, 5), finish: String(t.roster_out).slice(0, 5), hours: 0,
                    has_break: t.has_break !== false, break_mins: t.break_mins ?? null,
                }))
                : (templates.length === 0 ? [{ type: 'WORK', start: '09:00', finish: '17:00', hours: 0, has_break: true, break_mins: null }] : []);
            if (shifts.length === 0) continue;

            const skipped = await applyRosterKeepingLeave({ orgId: scope.orgId, worker, date: dateIso, shifts, approvedLeave, rule: breakRuleFor(settings, dateIso) });
            if (skipped) result.skipped.push({ employee_id: workerId, date: dateIso, reason: skipped });
            else result.applied++;
        }
    }

    await writeAudit({
        orgId: scope.orgId, actorId: scope.actorId, action: 'AUTO_ROSTER',
        details: `Applied roster templates for the fortnight starting ${scope.fortnightStartIso} (${workerIds.length} workers, ${result.applied} days, ${result.skipped.length} skipped)`,
    });
    return result;
}

/**
 * Copies the roster into worked hours for the selected days: the whole rostered day, timed and
 * hours-only entries alike. Only days with no worked time at all are filled, so recorded hours are
 * never overwritten and never overlapped by copied times.
 */
export async function autoLogAll(scope: BulkScope): Promise<{ workers: number }> {
    const fortnightStart = parseIsoDateUtc(scope.fortnightStartIso);
    const dates = targetDayIndexes(scope.selectedDays).map(i => fmtISO(addDays(fortnightStart, i)));
    let workerIds: string[] = [];

    await withTransaction(async (tx) => {
        // Take each candidate's worker-period lock (in id order, so concurrent bulk runs cannot
        // deadlock), then re-read who is still editable inside the transaction: a worker approved
        // or a branch locked a moment ago is never written.
        for (const w of await editableWorkerRows(scope, 'timesheet_locked')) {
            await lockWorkerPeriod(tx, scope.orgId, w.id, w.location_id, scope.fortnightStartIso);
        }
        workerIds = (await editableWorkerRows(scope, 'timesheet_locked', tx)).map(w => w.id);
        if (workerIds.length > 0 && dates.length > 0) {
            const updated = await tx(
                `UPDATE shift_segments ss
                    SET actual_in = ss.roster_in, actual_out = ss.roster_out, actual_hours = ss.roster_hours, actual_segment_type = ss.segment_type,
                        actual_has_break = ss.has_break, actual_break_mins = ss.break_mins
                   FROM daily_records dr
                  WHERE dr.id = ss.record_id AND dr.org_id = $1 AND dr.employee_id = ANY($2::uuid[]) AND dr.record_date = ANY($3::date[])
                    AND ((ss.roster_in IS NOT NULL AND ss.roster_out IS NOT NULL) OR COALESCE(ss.roster_hours, 0) > 0)
                    AND NOT EXISTS (SELECT 1 FROM shift_segments w
                                     WHERE w.record_id = dr.id AND (w.actual_in IS NOT NULL OR COALESCE(w.actual_hours, 0) > 0))
                  RETURNING ss.record_id`,
                [scope.orgId, workerIds, dates]
            );
            const recordIds = Array.from(new Set(updated.rows.map((r: any) => r.record_id)));
            if (recordIds.length > 0) await tx('UPDATE daily_records SET has_actuals = true WHERE id = ANY($1::uuid[])', [recordIds]);
        }
    });

    await writeAudit({ orgId: scope.orgId, actorId: scope.actorId, action: 'AUTO_LOG', details: `Copied roster to worked hours for the fortnight starting ${scope.fortnightStartIso} (${workerIds.length} workers)` });
    return { workers: workerIds.length };
}
