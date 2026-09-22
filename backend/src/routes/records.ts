import { Router, Response } from 'express';
import crypto from 'crypto';
import { query, withTransaction } from '../services/db';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { HttpError, badRequest, loadWorker, resolveBranchFilter } from '../services/policy';
import { getFortnightStartIso, isFortnightStart, isIsoDate } from '../services/periodUtils';
import { getPeriodLock, isTimesheetApproved, rosterLockedError, timesheetLockedError } from '../services/periodLocks';
import { NormalisedSegment, breakRuleFor, loadBreakSettings, normaliseDaySegments } from '../services/segments';
import { calculateRosterStats } from '../services/rosterService';

/**
 * Daily records: one row per worker per day, holding that day's segments (rostered and worked).
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

        // Single batch fetch for all shift segments (no N+1)
        const segResult = await query(
            `SELECT * FROM shift_segments WHERE record_id = ANY($1::uuid[])
              ORDER BY COALESCE(roster_in, actual_in) ASC NULLS LAST, id ASC`,
            [records.map((r: any) => r.id)]
        );
        const segmentsByRecord = new Map<string, any[]>();
        for (const seg of segResult.rows) {
            const list = segmentsByRecord.get(seg.record_id) || [];
            list.push(seg);
            segmentsByRecord.set(seg.record_id, list);
        }
        for (const rec of records) rec.segments = segmentsByRecord.get(rec.id) || [];

        res.json({ success: true, data: records });
    } catch (err) {
        sendError(res, err, 'RECORDS GET ERROR');
    }
});

const hhmm = (t: string | null) => (t ? String(t).slice(0, 5) : '');
// A side is identified by its type and times; hours only identify it when it has no times.
const sideKey = (type: string, start: string | null, end: string | null, hours: unknown) => {
    if (start) return [type, hhmm(start), hhmm(end)].join('|');
    return Number(hours) > 0 ? [type, Number(hours).toFixed(2)].join('|') : null;
};
const rosterSide = (s: any) => sideKey(s.segment_type, s.roster_in, s.roster_out, s.roster_hours);
const actualSide = (s: any) => sideKey(s.actual_segment_type || s.segment_type, s.actual_in, s.actual_out, s.actual_hours);

function sameSide(existing: any[], incoming: NormalisedSegment[], side: (s: any) => string | null): boolean {
    const a = existing.map(side).filter(Boolean).sort();
    const b = incoming.map(side).filter(Boolean).sort();
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * POST /api/records  { employee_id, record_date, segments: [...] }
 * Replaces the day's segments. An empty list clears the day.
 *
 *   - roster locked     → the rostered side must be unchanged (worked hours can still be recorded)
 *   - timesheets locked → the worked side must be unchanged
 *   - timesheet approved → nothing may change
 */
router.post('/', requirePermission(Permission.ROSTERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { employee_id, record_date, segments } = req.body || {};
        if (!isIsoDate(record_date)) throw badRequest('VALIDATION_FAILED', 'record_date must be YYYY-MM-DD.');

        const worker = await loadWorker(ctx, Permission.ROSTERS_MANAGE, employee_id);
        if (!worker.is_active) {
            throw badRequest('WORKER_INACTIVE', 'Cannot record shifts or hours for an inactive worker.');
        }

        const fortnightStart = getFortnightStartIso(record_date);
        if (await isTimesheetApproved(ctx.orgId, worker.id, fortnightStart)) {
            throw new HttpError(423, 'TIMESHEET_ALREADY_APPROVED', 'This timesheet is approved. Reopen it before changing shifts or hours.');
        }

        const rule = breakRuleFor(await loadBreakSettings(ctx.orgId), record_date);
        const day = normaliseDaySegments(segments ?? [], rule);

        const lock = await getPeriodLock(ctx.orgId, worker.location_id, fortnightStart);
        await withTransaction(async (tx) => {
            const recRes = await tx(
                `INSERT INTO daily_records (id, org_id, employee_id, record_date, has_actuals) VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (org_id, employee_id, record_date) DO UPDATE SET has_actuals = EXCLUDED.has_actuals
                 RETURNING id`,
                [crypto.randomUUID(), ctx.orgId, worker.id, record_date, day.hasActuals]
            );
            const recordId = recRes.rows[0].id;

            if (lock.roster_locked || lock.timesheet_locked) {
                const existing = (await tx('SELECT * FROM shift_segments WHERE record_id = $1', [recordId])).rows;
                if (lock.roster_locked && !sameSide(existing, day.segments, rosterSide)) throw rosterLockedError();
                if (lock.timesheet_locked && !sameSide(existing, day.segments, actualSide)) throw timesheetLockedError();
            }

            await tx('DELETE FROM shift_segments WHERE record_id = $1', [recordId]);
            for (const seg of day.segments) {
                await tx(
                    `INSERT INTO shift_segments (id, record_id, segment_type, is_unplanned, roster_in, roster_out, roster_hours,
                                                 actual_in, actual_out, actual_hours, actual_segment_type, notes)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                    [crypto.randomUUID(), recordId, seg.segment_type, seg.is_unplanned, seg.roster_in, seg.roster_out, seg.roster_hours,
                        seg.actual_in, seg.actual_out, seg.actual_hours, seg.actual_segment_type, seg.notes]
                );
            }
        });

        res.json({ success: true, data: { segments: day.segments } });
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
            `SELECT ss.segment_type, ss.roster_in, ss.roster_out, ss.roster_hours, ss.notes
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
                    sourceSegs.map((s: any) => ({ segment_type: s.segment_type, roster_in: s.roster_in, roster_out: s.roster_out, roster_hours: s.roster_hours, notes: s.notes })),
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
                            `INSERT INTO shift_segments (id, record_id, segment_type, roster_in, roster_out, roster_hours, notes)
                             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                            [crypto.randomUUID(), recRes.rows[0].id, seg.segment_type, seg.roster_in, seg.roster_out, seg.roster_hours, seg.notes]
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

export default router;
