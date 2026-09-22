import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { HttpError, badRequest, loadWorker, resolveBranchFilter, writeAudit } from '../services/policy';
import { addDays, fmtISO, isFortnightStart, parseIsoDateUtc } from '../services/periodUtils';
import { getPeriodLock, timesheetLockedError } from '../services/periodLocks';

/**
 * Timesheet approval.
 *
 * Hours are entered by the Organisation Owner or a Branch Admin, so there is no submit / review /
 * reject handshake: a worker's fortnight is either Draft or Approved. Approving freezes that
 * worker's days for the fortnight; reopening (while the period is not locked) makes them editable again.
 */
const router = Router();
router.use(requireAuth);

function readStartDate(value: unknown): string {
    if (!isFortnightStart(value)) throw badRequest('VALIDATION_FAILED', 'start_date must be the first day of a pay period.');
    return value;
}

router.get('/', requirePermission(Permission.TIMESHEETS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const startDate = readStartDate(req.query.start_date);
        const endDate = fmtISO(addDays(parseIsoDateUtc(startDate), 13));
        const branchIds = resolveBranchFilter(ctx, Permission.TIMESHEETS_MANAGE, req.query.location_id);

        const result = await query(
            `SELECT e.id AS employee_id, e.full_name, e.department, e.location_id, l.name AS location_name,
                    COALESCE(e.contracted_hours, 76)::float AS contracted_hours,
                    COALESCE(h.rostered, 0)::float AS rostered_hours,
                    COALESCE(h.actual, 0)::float AS actual_hours,
                    COALESCE(ts.status, 'Draft') AS status,
                    ts.id AS submission_id, ts.reviewed_at, ts.reviewed_by,
                    COALESCE(fl.timesheet_locked, false) AS timesheet_locked
               FROM employees e
               JOIN locations l ON l.id = e.location_id
               LEFT JOIN timesheet_submissions ts ON ts.org_id = e.org_id AND ts.employee_id = e.id AND ts.start_date = $3
               LEFT JOIN fortnight_locks fl ON fl.org_id = e.org_id AND fl.location_id = e.location_id AND fl.start_date = $3
               LEFT JOIN (SELECT dr.employee_id, SUM(ss.roster_hours) AS rostered, SUM(ss.actual_hours) AS actual
                            FROM daily_records dr JOIN shift_segments ss ON ss.record_id = dr.id
                           WHERE dr.org_id = $1 AND dr.record_date >= $3 AND dr.record_date <= $4
                           GROUP BY dr.employee_id) h ON h.employee_id = e.id
              WHERE e.org_id = $1 AND e.location_id = ANY($2::uuid[]) AND e.is_active = true
              ORDER BY e.full_name ASC`,
            [ctx.orgId, branchIds, startDate, endDate]
        );

        const round2 = (n: number) => Math.round(n * 100) / 100;
        res.json({
            success: true,
            data: result.rows.map((row: any) => ({
                ...row,
                rostered_hours: round2(row.rostered_hours),
                actual_hours: round2(row.actual_hours),
                variance_hours: round2(row.actual_hours - row.contracted_hours),
                status: row.status === 'Approved' && row.timesheet_locked ? 'Locked' : row.status,
            }))
        });
    } catch (err) {
        sendError(res, err, 'SUBMISSIONS LIST ERROR');
    }
});

/** Authorises against the worker's own branch and refuses when that branch's period is locked. */
async function loadEditableWorker(req: AuthRequest, workerId: unknown, startDate: string) {
    const ctx = req.auth!;
    const worker = await loadWorker(ctx, Permission.TIMESHEETS_MANAGE, workerId);
    if ((await getPeriodLock(ctx.orgId, worker.location_id, startDate)).timesheet_locked) throw timesheetLockedError();
    return worker;
}

async function approve(req: AuthRequest, workerId: unknown, startDate: string) {
    const ctx = req.auth!;
    const worker = await loadEditableWorker(req, workerId, startDate);
    const saved = await query(
        `INSERT INTO timesheet_submissions (id, org_id, employee_id, start_date, status, reviewed_by, reviewed_at)
         VALUES ($1, $2, $3, $4, 'Approved', $5, NOW())
         ON CONFLICT (org_id, employee_id, start_date) DO UPDATE
            SET status = 'Approved', reviewed_by = EXCLUDED.reviewed_by, reviewed_at = NOW()
          WHERE timesheet_submissions.status <> 'Approved'
         RETURNING id`,
        [crypto.randomUUID(), ctx.orgId, worker.id, startDate, ctx.userId]
    );
    if (saved.rows.length === 0) throw new HttpError(409, 'ALREADY_APPROVED', 'This timesheet has already been approved.');
    await writeAudit({
        orgId: ctx.orgId, actorId: ctx.userId, action: 'TIMESHEET_APPROVED', entityType: 'timesheet_submissions', entityId: saved.rows[0].id,
        branchId: worker.location_id, details: `${worker.full_name}, fortnight ${startDate}`
    });
    return { employee_id: worker.id, id: saved.rows[0].id, status: 'Approved' };
}

router.post('/approve', requirePermission(Permission.TIMESHEETS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const startDate = readStartDate(req.body?.start_date);
        res.json({ success: true, data: await approve(req, req.body?.employee_id, startDate) });
    } catch (err) {
        sendError(res, err, 'APPROVE TIMESHEET ERROR');
    }
});

/**
 * POST /api/submissions/bulk-approve  { start_date, employee_ids: [...] }
 * Every item is authorised on its own and reported on its own — nothing is dropped silently.
 */
router.post('/bulk-approve', requirePermission(Permission.TIMESHEETS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const startDate = readStartDate(req.body?.start_date);
        const ids = req.body?.employee_ids;
        if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) throw badRequest('VALIDATION_FAILED', 'employee_ids must be a list of 1–500 workers.');

        const approved: any[] = [];
        const failed: Array<{ employee_id: unknown; code: string; message: string }> = [];
        for (const id of ids) {
            try {
                approved.push(await approve(req, id, startDate));
            } catch (err) {
                if (!(err instanceof HttpError)) throw err;
                failed.push({ employee_id: id, code: err.code, message: err.message });
            }
        }
        res.json({ success: failed.length === 0, data: { approved, failed } });
    } catch (err) {
        sendError(res, err, 'BULK APPROVE ERROR');
    }
});

router.post('/reopen', requirePermission(Permission.TIMESHEETS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const startDate = readStartDate(req.body?.start_date);
        const worker = await loadEditableWorker(req, req.body?.employee_id, startDate);
        const reopened = await query(
            `UPDATE timesheet_submissions SET status = 'Draft', reviewed_by = $1, reviewed_at = NOW()
              WHERE org_id = $2 AND employee_id = $3 AND start_date = $4 AND status = 'Approved' RETURNING id`,
            [ctx.userId, ctx.orgId, worker.id, startDate]
        );
        if (reopened.rows.length === 0) throw new HttpError(409, 'NOT_APPROVED', 'This timesheet is not approved.');
        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'TIMESHEET_REOPENED', entityType: 'timesheet_submissions', entityId: reopened.rows[0].id,
            branchId: worker.location_id, details: `${worker.full_name}, fortnight ${startDate}`
        });
        res.json({ success: true, data: { employee_id: worker.id, id: reopened.rows[0].id, status: 'Draft' } });
    } catch (err) {
        sendError(res, err, 'REOPEN TIMESHEET ERROR');
    }
});

export default router;
