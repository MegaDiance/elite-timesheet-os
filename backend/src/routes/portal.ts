import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { requireAuth, requireEmployee, AuthRequest, sendError } from '../middleware/auth';
import { HttpError, badRequest, isUuid } from '../services/policy';
import { addDays, fmtISO, getFortnightStartIso, isFortnightStart, isIsoDate, parseIsoDateUtc } from '../services/periodUtils';
import { DayEntry, breakRuleFor, isSegmentType, loadBreakSettings, rowsToDay, writeDayRecord } from '../services/segments';
import { loadApprovedLeave } from '../services/rosterService';
import { parseSmartTime } from '../services/timeParser';
import { assertNoOverlappingLeaveRequests, materializeLeaveRequest } from '../services/leaveRequests';

/**
 * Employee self-service portal.
 *
 * Every route here is scoped to `req.auth.employeeId` only — no route accepts an employee id
 * from the client, so there is no id to smuggle a different worker's data through. This is the
 * one place in the app where the caller's own identity, not a request parameter, names the
 * worker record: an employee always sees their own schedule/timesheet/history and nothing else.
 */
const router = Router();
router.use(requireAuth, requireEmployee);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_SCHEDULE_RANGE_DAYS = 42; // roughly six weeks — a monthly schedule view plus margin
const MAX_HISTORY_RANGE_DAYS = 372; // matches the 26-fortnight cap in the /history loop below

function readRange(req: AuthRequest, maxDays: number): { start: string; end: string } {
    const { start_date, end_date } = req.query;
    if (!isIsoDate(start_date)) throw badRequest('VALIDATION_FAILED', 'start_date must be YYYY-MM-DD.');
    if (!isIsoDate(end_date)) throw badRequest('VALIDATION_FAILED', 'end_date must be YYYY-MM-DD.');
    const start = parseIsoDateUtc(start_date);
    const end = parseIsoDateUtc(end_date);
    if (end < start) throw badRequest('VALIDATION_FAILED', 'end_date must not be before start_date.');
    if ((end.getTime() - start.getTime()) / 86400000 > maxDays) {
        throw badRequest('VALIDATION_FAILED', `The date range must be ${maxDays} days or fewer.`);
    }
    return { start: start_date, end: end_date };
}

async function loadDays(orgId: string, employeeId: string, startDate: string, endDate: string) {
    const records = (await query(
        `SELECT id, record_date FROM daily_records
          WHERE org_id = $1 AND employee_id = $2 AND record_date >= $3 AND record_date <= $4
          ORDER BY record_date ASC`,
        [orgId, employeeId, startDate, endDate]
    )).rows;
    if (records.length === 0) return [];

    const segResult = await query('SELECT * FROM shift_segments WHERE record_id = ANY($1::uuid[])', [records.map((r: any) => r.id)]);
    const rowsByRecord = new Map<string, any[]>();
    for (const seg of segResult.rows) {
        const list = rowsByRecord.get(seg.record_id) || [];
        list.push(seg);
        rowsByRecord.set(seg.record_id, list);
    }
    return records.map((rec: any) => ({ record_date: rec.record_date, ...rowsToDay(rowsByRecord.get(rec.id) || []) }));
}

/** GET /api/portal/schedule?start_date&end_date — the employee's own rostered shifts only. */
router.get('/schedule', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { start, end } = readRange(req, MAX_SCHEDULE_RANGE_DAYS);
        const days = await loadDays(ctx.orgId, ctx.employeeId!, start, end);
        res.json({ success: true, data: days.map(d => ({ record_date: d.record_date, roster: d.roster })) });
    } catch (err) {
        sendError(res, err, 'PORTAL SCHEDULE ERROR');
    }
});

/** Whether the caller's own fortnight can currently be edited by them, and why not if not. */
async function readOnlyStatus(ctx: NonNullable<AuthRequest['auth']>, startDate: string): Promise<{ approved: boolean; timesheet_locked: boolean }> {
    const result = await query(
        `SELECT COALESCE(ts.status, 'Draft') = 'Approved' AS approved, COALESCE(fl.timesheet_locked, false) AS timesheet_locked
           FROM employees e
           LEFT JOIN timesheet_submissions ts ON ts.org_id = e.org_id AND ts.employee_id = e.id AND ts.start_date = $2
           LEFT JOIN fortnight_locks fl ON fl.org_id = e.org_id AND fl.location_id = e.location_id AND fl.start_date = $2
          WHERE e.id = $1`,
        [ctx.employeeId, startDate]
    );
    return result.rows[0] || { approved: false, timesheet_locked: false };
}

/**
 * The employee timesheet is a feature the organisation switches on or off
 * (`employees_can_submit_timesheets`). While it is off, every timesheet endpoint answers as though
 * the feature does not exist for employees — reading as well as writing — so hiding the tab in the
 * portal is never the only thing standing between an employee and the data. Read per request, so
 * a change takes effect on the very next call.
 */
async function assertEmployeeTimesheetsEnabled(orgId: string): Promise<void> {
    const orgRes = await query('SELECT employees_can_submit_timesheets FROM organisations WHERE id = $1', [orgId]);
    if (!orgRes.rows[0]?.employees_can_submit_timesheets) {
        throw new HttpError(403, 'EMPLOYEE_TIMESHEETS_DISABLED', 'Employee timesheets are turned off for your organisation. Ask your manager to record your hours.');
    }
}

/** GET /api/portal/timesheet?start_date — one fortnight of the employee's own roster + timesheet. */
router.get('/timesheet', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        await assertEmployeeTimesheetsEnabled(ctx.orgId);
        if (!isFortnightStart(req.query.start_date)) throw badRequest('VALIDATION_FAILED', 'start_date must be the first day of a pay period.');
        const startDate = req.query.start_date as string;
        const endDate = fmtISO(addDays(parseIsoDateUtc(startDate), 13));
        const [days, status] = await Promise.all([
            loadDays(ctx.orgId, ctx.employeeId!, startDate, endDate),
            readOnlyStatus(ctx, startDate),
        ]);
        res.json({ success: true, data: days, ...status });
    } catch (err) {
        sendError(res, err, 'PORTAL TIMESHEET ERROR');
    }
});

const minutesOf = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

/** [start, end) in minutes; an end before the start runs past midnight. Null when not a valid timed entry. */
function windowOf(start: unknown, finish: unknown): [number, number] | null {
    const s = typeof start === 'string' ? parseSmartTime(start) : '';
    const f = typeof finish === 'string' ? parseSmartTime(finish) : '';
    if (!TIME_RE.test(s) || !TIME_RE.test(f)) return null;
    const a = minutesOf(s);
    let b = minutesOf(f);
    if (b <= a) b += 1440;
    return [a, b];
}

/**
 * What an employee's own timesheet save becomes. Employees record Normal Work only — leave goes
 * through a leave request, which a manager approves — so the employee can neither add leave here
 * (bypassing approval) nor remove or overwrite leave that is already recorded:
 *
 *   - leave already on the day's WORKED side is always kept, whatever the submission says;
 *   - submitted work may not overlap leave on either side of the day, or an approved leave
 *     request for the date; a whole-day (hours-only) leave entry blocks any work that day.
 *
 * A conflict is refused with a clear message instead of either side being silently replaced.
 */
async function employeeTimesheetKeepingLeave(ctx: NonNullable<AuthRequest['auth']>, recordDate: string, submitted: unknown): Promise<DayEntry[]> {
    if (!Array.isArray(submitted)) throw badRequest('VALIDATION_FAILED', 'timesheet must be a list.');
    const work = submitted.map(e => (e && typeof e === 'object' ? e as Record<string, unknown> : {}));
    if (work.some(e => (e.type ?? 'WORK') !== 'WORK')) {
        throw badRequest('LEAVE_VIA_REQUEST', 'Record leave with a leave request (Leave tab), not on your timesheet.');
    }

    const recRes = await query('SELECT id FROM daily_records WHERE org_id = $1 AND employee_id = $2 AND record_date = $3', [ctx.orgId, ctx.employeeId, recordDate]);
    const day = rowsToDay(recRes.rows.length ? (await query('SELECT * FROM shift_segments WHERE record_id = $1', [recRes.rows[0].id])).rows : []);
    const keptLeave = day.timesheet.filter(e => e.type !== 'WORK');

    const approved = await loadApprovedLeave(ctx.orgId, ctx.employeeId!, recordDate, recordDate);
    const leave: Array<{ type: string; window: [number, number] | null }> = [
        ...[...keptLeave, ...day.roster.filter(e => e.type !== 'WORK')].map(e => ({ type: e.type, window: windowOf(e.start, e.finish) })),
        ...approved.map(l => ({ type: l.leave_type, window: windowOf(l.start_time, l.end_time) })),
    ];
    for (const entry of work) {
        const w = windowOf(entry.start, entry.finish);
        const clash = leave.find(l => !l.window || !w || (w[0] < l.window[1] && l.window[0] < w[1]));
        if (clash) {
            throw new HttpError(409, 'LEAVE_CONFLICT', `You have ${LEAVE_LABEL[clash.type] ?? 'leave'} recorded ${clash.window ? 'at that time' : 'on this day'}. Ask your manager if that is wrong.`);
        }
    }
    return [...keptLeave, ...(work as unknown as DayEntry[])];
}

const LEAVE_LABEL: Record<string, string> = { Sick: 'Sick Leave', Annual: 'Annual Leave', TIL: 'TIL', LWIP: 'unpaid leave', Other: 'leave' };

/**
 * POST /api/portal/timesheet  { record_date, timesheet: Entry[], note? }
 *
 * Self-submit: records what the employee actually worked on one day of their own timesheet.
 * Always writes the TIMESHEET side only — a `roster` key in the body is rejected outright by
 * `mergeDayWrite`, not silently ignored, so an employee can never smuggle a roster change through
 * this endpoint. Refuses outright while `employees_can_submit_timesheets` is off for the org.
 */
router.post('/timesheet', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        await assertEmployeeTimesheetsEnabled(ctx.orgId);

        const { record_date } = req.body || {};
        if (!isIsoDate(record_date)) throw badRequest('VALIDATION_FAILED', 'record_date must be YYYY-MM-DD.');

        const workerRes = await query('SELECT is_active FROM employees WHERE id = $1', [ctx.employeeId]);
        if (!workerRes.rows[0]?.is_active) throw badRequest('WORKER_INACTIVE', 'Your worker record is deactivated.');

        const rule = breakRuleFor(await loadBreakSettings(ctx.orgId), record_date);
        const timesheet = await employeeTimesheetKeepingLeave(ctx, record_date, req.body?.timesheet);
        const body = { ...(req.body || {}), scope: 'TIMESHEET', timesheet };
        const saved = await writeDayRecord({
            orgId: ctx.orgId,
            worker: { id: ctx.employeeId!, location_id: ctx.branchIds[0] },
            recordDate: record_date,
            body,
            rule,
        });
        res.json({ success: true, data: rowsToDay(saved) });
    } catch (err) {
        sendError(res, err, 'PORTAL TIMESHEET SUBMIT ERROR');
    }
});

/** GET /api/portal/history?start_date&end_date — approval status of the employee's own past fortnights. */
router.get('/history', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { start, end } = readRange(req, MAX_HISTORY_RANGE_DAYS);
        const fortnights: string[] = [];
        let cursor = getFortnightStartIso(start);
        const endDate = parseIsoDateUtc(end);
        while (parseIsoDateUtc(cursor) <= endDate && fortnights.length < 26) {
            fortnights.push(cursor);
            cursor = fmtISO(addDays(parseIsoDateUtc(cursor), 14));
        }
        if (fortnights.length === 0) return res.json({ success: true, data: [] });

        const round2 = (n: number) => Math.round(n * 100) / 100;
        const rows = await Promise.all(fortnights.map(async (startDate) => {
            const fortnightEnd = fmtISO(addDays(parseIsoDateUtc(startDate), 13));
            const result = await query(
                `SELECT COALESCE(ts.status, 'Draft') AS status,
                        COALESCE(fl.timesheet_locked, false) AS timesheet_locked,
                        COALESCE(h.actual, 0)::float AS actual_hours
                   FROM employees e
                   LEFT JOIN timesheet_submissions ts ON ts.org_id = e.org_id AND ts.employee_id = e.id AND ts.start_date = $3
                   LEFT JOIN fortnight_locks fl ON fl.org_id = e.org_id AND fl.location_id = e.location_id AND fl.start_date = $3
                   LEFT JOIN (SELECT dr.employee_id, SUM(ss.actual_hours) AS actual
                                FROM daily_records dr JOIN shift_segments ss ON ss.record_id = dr.id
                               WHERE dr.org_id = $1 AND dr.employee_id = $2 AND dr.record_date >= $3 AND dr.record_date <= $4
                               GROUP BY dr.employee_id) h ON h.employee_id = e.id
                  WHERE e.id = $2`,
                [ctx.orgId, ctx.employeeId, startDate, fortnightEnd]
            );
            const row = result.rows[0] || { status: 'Draft', timesheet_locked: false, actual_hours: 0 };
            return {
                start_date: startDate,
                status: row.status === 'Approved' && row.timesheet_locked ? 'Locked' : row.status,
                actual_hours: round2(row.actual_hours),
            };
        }));
        res.json({ success: true, data: rows });
    } catch (err) {
        sendError(res, err, 'PORTAL HISTORY ERROR');
    }
});


/** GET /api/portal/leave-requests — the employee's own requests, newest first. */
router.get('/leave-requests', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const rows = (await query(
            `SELECT id, leave_type, start_date, end_date, start_time, end_time, hours, reason, status, rejection_reason, created_at
               FROM leave_requests WHERE org_id = $1 AND employee_id = $2 ORDER BY created_at DESC`,
            [ctx.orgId, ctx.employeeId]
        )).rows;
        res.json({ success: true, data: rows });
    } catch (err) {
        sendError(res, err, 'PORTAL LEAVE REQUESTS LIST ERROR');
    }
});

/**
 * POST /api/portal/leave-requests  { leave_type, start_date, end_date, start_time?, end_time?, hours?, reason? }
 *
 * A whole-day request (no times) needs `hours` (used only as a fallback if nothing is rostered
 * on a day once approved); a partial-day request (start_time + end_time) must be a single day.
 * When the organisation has `leave_requests_require_approval` off, the request is approved and
 * materialized immediately instead of sitting Pending.
 */
router.post('/leave-requests', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { leave_type, start_date, end_date, start_time, end_time, hours, reason } = req.body || {};

        if (!isSegmentType(leave_type) || leave_type === 'WORK') throw badRequest('VALIDATION_FAILED', 'leave_type must be a leave type (not Normal Work).');
        if (!isIsoDate(start_date) || !isIsoDate(end_date)) throw badRequest('VALIDATION_FAILED', 'start_date and end_date must be YYYY-MM-DD.');
        if (end_date < start_date) throw badRequest('VALIDATION_FAILED', 'end_date must not be before start_date.');

        const hasTimes = start_time !== undefined && start_time !== null && start_time !== '';
        if (hasTimes !== (end_time !== undefined && end_time !== null && end_time !== '')) {
            throw badRequest('VALIDATION_FAILED', 'Enter both a start time and a finish time, or neither.');
        }
        if (hasTimes) {
            if (!TIME_RE.test(start_time) || !TIME_RE.test(end_time)) throw badRequest('VALIDATION_FAILED', 'Enter times like 09:00.');
            if (start_time >= end_time) throw badRequest('VALIDATION_FAILED', 'The finish time must be after the start time.');
            if (start_date !== end_date) throw badRequest('VALIDATION_FAILED', 'A request with times must be for a single day.');
        }

        let hoursValue: number | null = null;
        if (!hasTimes) {
            hoursValue = Number(hours);
            const daysInRange = (parseIsoDateUtc(end_date).getTime() - parseIsoDateUtc(start_date).getTime()) / 86400000 + 1;
            if (!Number.isFinite(hoursValue) || hoursValue <= 0 || hoursValue > daysInRange * 24) {
                throw badRequest('VALIDATION_FAILED', `hours must be between 0 and ${daysInRange * 24}.`);
            }
        }

        const reasonText = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null;
        await assertNoOverlappingLeaveRequests(ctx.employeeId!, { start_date, end_date, start_time: hasTimes ? start_time : null, end_time: hasTimes ? end_time : null });

        const requireApproval = (await query('SELECT leave_requests_require_approval FROM organisations WHERE id = $1', [ctx.orgId])).rows[0]?.leave_requests_require_approval !== false;
        const id = crypto.randomUUID();
        const worker = { id: ctx.employeeId!, location_id: ctx.branchIds[0] };

        await query(
            `INSERT INTO leave_requests (id, org_id, employee_id, location_id, leave_type, start_date, end_date, start_time, end_time, hours, reason, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [id, ctx.orgId, worker.id, worker.location_id, leave_type, start_date, end_date, hasTimes ? start_time : null, hasTimes ? end_time : null, hoursValue, reasonText, requireApproval ? 'Pending' : 'Approved']
        );

        if (!requireApproval) {
            const result = await materializeLeaveRequest(ctx.orgId, worker, { leave_type, start_date, end_date, start_time: hasTimes ? start_time : null, end_time: hasTimes ? end_time : null, hours: hoursValue });
            return res.status(201).json({ success: true, data: { id, status: 'Approved', ...result }, message: 'Leave recorded.' });
        }
        res.status(201).json({ success: true, data: { id, status: 'Pending' }, message: 'Leave request sent for approval.' });
    } catch (err) {
        sendError(res, err, 'PORTAL LEAVE REQUEST CREATE ERROR');
    }
});

/** DELETE /api/portal/leave-requests/:id — withdraws the employee's own request, only while Pending. */
router.delete('/leave-requests/:id', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        if (!isUuid(req.params.id)) throw badRequest('VALIDATION_FAILED', 'Invalid request id.');
        const deleted = await query(
            `DELETE FROM leave_requests WHERE id = $1 AND org_id = $2 AND employee_id = $3 AND status = 'Pending' RETURNING id`,
            [req.params.id, ctx.orgId, ctx.employeeId]
        );
        if (deleted.rows.length === 0) throw badRequest('NOT_PENDING', 'Only a pending request can be withdrawn.');
        res.json({ success: true, message: 'Leave request withdrawn.' });
    } catch (err) {
        sendError(res, err, 'PORTAL LEAVE REQUEST WITHDRAW ERROR');
    }
});

export default router;
