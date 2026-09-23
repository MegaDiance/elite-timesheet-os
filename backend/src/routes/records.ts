import { Router, Response } from 'express';
import crypto from 'crypto';
import { query, withTransaction } from '../services/db';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { HttpError, badRequest, loadWorker, resolveBranchFilter } from '../services/policy';
import { getFortnightStartIso, isFortnightStart, isIsoDate } from '../services/periodUtils';
import { getPeriodLock, isTimesheetApproved } from '../services/periodLocks';
import { breakRuleFor, loadBreakSettings, normaliseDaySegments, rowsToDay, writeDayRecord } from '../services/segments';
import { calculateRosterStats } from '../services/rosterService';

/**
 * Daily records: one per worker per day. A day has a ROSTER (what was planned) and a TIMESHEET
 * (what was worked); each is a list of times with a type (Normal Work or a leave type).
 * Every route authorises against the worker's own branch, loaded from the database.
 */
const router = Router();
router.use(requireAuth);

router.get('/stats', requirePermission(Permission.TIMESHEETS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        if (!isFortnightStart(req.query.start_date)) throw badRequest('VALIDATION_FAILED', 'start_date must be the first day of a pay period.');
        const worker = await loadWorker(ctx, Permission.TIMESHEETS_MANAGE, req.query.employee_id);
        const stats = await calculateRosterStats(ctx.orgId, worker.id, req.query.start_date);
        res.json({ success: true, data: stats });
    } catch (err) {
        sendError(res, err, 'RECORDS STATS ERROR');
    }
});

router.get('/', requirePermission(Permission.TIMESHEETS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { start_date, end_date, employee_id } = req.query;
        const branchIds = resolveBranchFilter(ctx, Permission.TIMESHEETS_MANAGE, req.query.location_id);

        const params: any[] = [ctx.orgId, branchIds];
        let sql = `SELECT dr.* FROM daily_records dr
                     JOIN employees e ON e.id = dr.employee_id
                    WHERE dr.org_id = $1 AND e.location_id = ANY($2::uuid[])`;
        if (start_date !== undefined) {
            if (!isIsoDate(start_date)) throw badRequest('VALIDATION_FAILED', 'start_date must be YYYY-MM-DD.');
            params.push(start_date);
            sql += ` AND dr.record_date >= $${params.length}`;
        }
        if (end_date !== undefined) {
            if (!isIsoDate(end_date)) throw badRequest('VALIDATION_FAILED', 'end_date must be YYYY-MM-DD.');
            params.push(end_date);
            sql += ` AND dr.record_date <= $${params.length}`;
        }
        if (employee_id !== undefined) {
            const worker = await loadWorker(ctx, Permission.TIMESHEETS_MANAGE, employee_id);
            params.push(worker.id);
            sql += ` AND dr.employee_id = $${params.length}`;
        }
        sql += ' ORDER BY dr.record_date ASC';

        const records = (await query(sql, params)).rows;
        if (records.length === 0) return res.json({ success: true, data: [] });

        // Single batch fetch for all rows of these days (no N+1)
        const segResult = await query('SELECT * FROM shift_segments WHERE record_id = ANY($1::uuid[])', [records.map((r: any) => r.id)]);
        const rowsByRecord = new Map<string, any[]>();
        for (const seg of segResult.rows) {
            const list = rowsByRecord.get(seg.record_id) || [];
            list.push(seg);
            rowsByRecord.set(seg.record_id, list);
        }

        res.json({
            success: true,
            data: records.map((rec: any) => ({
                id: rec.id,
                employee_id: rec.employee_id,
                record_date: rec.record_date,
                ...rowsToDay(rowsByRecord.get(rec.id) || []),
            })),
        });
    } catch (err) {
        sendError(res, err, 'RECORDS GET ERROR');
    }
});

/**
 * POST /api/records
 *   { employee_id, record_date, scope?: 'ROSTER' | 'TIMESHEET' | 'BOTH', roster?: Entry[], timesheet?: Entry[], note? }
 *   Entry = { type, start?, finish?, hours? }
 *
 * Replaces the day's roster, its timesheet, or both (the default). The side outside `scope` is kept
 * exactly as stored. Empty lists clear that side.
 *
 *   - roster locked      → the roster must be unchanged (worked hours can still be recorded)
 *   - timesheets locked  → the timesheet must be unchanged
 *   - timesheet approved → nothing may change
 */
router.post('/', requirePermission(Permission.ROSTERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { employee_id, record_date } = req.body || {};
        if (!isIsoDate(record_date)) throw badRequest('VALIDATION_FAILED', 'record_date must be YYYY-MM-DD.');

        const worker = await loadWorker(ctx, Permission.ROSTERS_MANAGE, employee_id);
        if (!worker.is_active) {
            throw badRequest('WORKER_INACTIVE', 'Cannot record shifts or hours for an inactive worker.');
        }

        const rule = breakRuleFor(await loadBreakSettings(ctx.orgId), record_date);
        const saved = await writeDayRecord({ orgId: ctx.orgId, worker, recordDate: record_date, body: req.body || {}, rule });
        res.json({ success: true, data: rowsToDay(saved) });
    } catch (err) {
        sendError(res, err, 'RECORDS SAVE ERROR');
    }
});

/**
 * POST /api/records/copy-day
 * { employee_id, source_date, target_dates: [...], target_employee_ids?: [...], include_actuals?: boolean }
 *
 * Copies one day's rostered segments onto other days (and, optionally, other workers). Each target
 * is authorised and lock-checked on its own; targets that already hold worked hours, are approved,
 * or are roster-locked are skipped and reported — copying never overwrites recorded hours.
 */
router.post('/copy-day', requirePermission(Permission.ROSTERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { employee_id, source_date, target_dates, target_employee_ids } = req.body || {};
        if (!isIsoDate(source_date)) throw badRequest('VALIDATION_FAILED', 'source_date must be YYYY-MM-DD.');
        if (!Array.isArray(target_dates) || target_dates.length === 0 || target_dates.length > 31 || !target_dates.every(isIsoDate)) {
            throw badRequest('VALIDATION_FAILED', 'target_dates must be a list of 1–31 dates.');
        }
        const targetWorkerIds: unknown[] = Array.isArray(target_employee_ids) && target_employee_ids.length > 0 ? target_employee_ids : [employee_id];
        if (targetWorkerIds.length > 200) throw badRequest('VALIDATION_FAILED', 'Too many workers selected.');

        const source = await loadWorker(ctx, Permission.ROSTERS_MANAGE, employee_id);
        const sourceSegs = (await query(
            `SELECT ss.segment_type, ss.roster_in, ss.roster_out, ss.roster_hours, ss.notes, ss.has_break
               FROM shift_segments ss JOIN daily_records dr ON dr.id = ss.record_id
              WHERE dr.org_id = $1 AND dr.employee_id = $2 AND dr.record_date = $3
                AND (ss.roster_in IS NOT NULL OR ss.roster_hours > 0)`,
            [ctx.orgId, source.id, source_date]
        )).rows;
        if (sourceSegs.length === 0) throw badRequest('NOTHING_TO_COPY', 'That day has no rostered segments to copy.');

        const settings = await loadBreakSettings(ctx.orgId);
        const copied: Array<{ employee_id: string; date: string }> = [];
        const skipped: Array<{ employee_id: string; date: string; reason: string }> = [];

        for (const workerId of targetWorkerIds) {
            const worker = await loadWorker(ctx, Permission.ROSTERS_MANAGE, workerId);
            for (const date of target_dates as string[]) {
                if (worker.id === source.id && date === source_date) continue;
                const skip = (reason: string) => skipped.push({ employee_id: worker.id, date, reason });
                if (!worker.is_active) { skip('INACTIVE'); continue; }

                const fortnightStart = getFortnightStartIso(date);
                if (await isTimesheetApproved(ctx.orgId, worker.id, fortnightStart)) { skip('APPROVED'); continue; }
                if ((await getPeriodLock(ctx.orgId, worker.location_id, fortnightStart)).roster_locked) { skip('ROSTER_LOCKED'); continue; }

                const day = normaliseDaySegments(
                    sourceSegs.map((s: any) => ({ segment_type: s.segment_type, roster_in: s.roster_in, roster_out: s.roster_out, roster_hours: s.roster_hours, notes: s.notes, has_break: s.has_break })),
                    breakRuleFor(settings, date)
                );

                const done = await withTransaction(async (tx) => {
                    const recRes = await tx(
                        `INSERT INTO daily_records (id, org_id, employee_id, record_date) VALUES ($1, $2, $3, $4)
                         ON CONFLICT (org_id, employee_id, record_date) DO UPDATE SET record_date = EXCLUDED.record_date
                         RETURNING id, has_actuals`,
                        [crypto.randomUUID(), ctx.orgId, worker.id, date]
                    );
                    if (recRes.rows[0].has_actuals) return false;
                    await tx('DELETE FROM shift_segments WHERE record_id = $1', [recRes.rows[0].id]);
                    for (const seg of day.segments) {
                        await tx(
                            `INSERT INTO shift_segments (id, record_id, segment_type, roster_in, roster_out, roster_hours, notes, has_break)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                            [crypto.randomUUID(), recRes.rows[0].id, seg.segment_type, seg.roster_in, seg.roster_out, seg.roster_hours, seg.notes, seg.has_break]
                        );
                    }
                    return true;
                });
                if (done) copied.push({ employee_id: worker.id, date }); else skip('HAS_WORKED_HOURS');
            }
        }

        res.json({ success: true, data: { copied, skipped } });
    } catch (err) {
        sendError(res, err, 'RECORDS COPY ERROR');
    }
});

/**
 * POST /api/records/apply-break
 *   { employee_id, record_dates: string[], has_break: boolean }
 *
 * Turns the unpaid break on or off for every existing segment of the given days ("Apply Break" /
 * "Apply Break to All Days" in the roster/timesheet editor). A day with nothing recorded yet has
 * nothing to flip, so it is skipped rather than creating an empty day. Each date is authorised
 * and lock/approval-checked independently, exactly like `copy-day` — one locked or approved day
 * never blocks the others.
 */
router.post('/apply-break', requirePermission(Permission.ROSTERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { employee_id, record_dates, has_break } = req.body || {};
        if (typeof has_break !== 'boolean') throw badRequest('VALIDATION_FAILED', 'has_break must be true or false.');
        if (!Array.isArray(record_dates) || record_dates.length === 0 || record_dates.length > 31 || !record_dates.every(isIsoDate)) {
            throw badRequest('VALIDATION_FAILED', 'record_dates must be a list of 1-31 dates.');
        }

        const worker = await loadWorker(ctx, Permission.ROSTERS_MANAGE, employee_id);
        if (!worker.is_active) throw badRequest('WORKER_INACTIVE', 'Cannot change breaks for an inactive worker.');

        const settings = await loadBreakSettings(ctx.orgId);
        const applied: string[] = [];
        const skipped: Array<{ date: string; reason: string }> = [];

        for (const date of record_dates as string[]) {
            const skip = (reason: string) => skipped.push({ date, reason });
            try {
                const recRes = await query(
                    'SELECT id FROM daily_records WHERE org_id = $1 AND employee_id = $2 AND record_date = $3',
                    [ctx.orgId, worker.id, date]
                );
                if (recRes.rows.length === 0) { skip('NOTHING_TO_CHANGE'); continue; }

                const existing = (await query('SELECT * FROM shift_segments WHERE record_id = $1', [recRes.rows[0].id])).rows;
                if (existing.length === 0) { skip('NOTHING_TO_CHANGE'); continue; }

                const view = rowsToDay(existing);
                const flip = (list: typeof view.roster) => list.map(e => ({ ...e, has_break }));
                const body = { scope: 'BOTH' as const, roster: flip(view.roster), timesheet: flip(view.timesheet), note: view.note };
                await writeDayRecord({ orgId: ctx.orgId, worker, recordDate: date, body, rule: breakRuleFor(settings, date) });
                applied.push(date);
            } catch (err) {
                skip(err instanceof HttpError ? err.code : 'ERROR');
            }
        }

        res.json({ success: true, data: { applied, skipped } });
    } catch (err) {
        sendError(res, err, 'RECORDS APPLY BREAK ERROR');
    }
});

export default router;
