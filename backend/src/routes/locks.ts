import { Router, Response } from 'express';
import crypto from 'crypto';
import { query, withTransaction } from '../services/db';
import { comparePassword } from '../services/auth';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { HttpError, badRequest, loadBranch, resolveBranchFilter, writeAudit } from '../services/policy';
import { isFortnightStart } from '../services/periodUtils';
import { lockBranchPeriod } from '../services/periodLocks';

/**
 * Pay-period locks. A lock belongs to ONE branch and ONE fortnight:
 *   roster_locked     — the rostered side of that branch's days cannot change
 *   timesheet_locked  — the worked side of that branch's days cannot change
 */
const router = Router();
router.use(requireAuth);

router.get('/', requirePermission(Permission.PERIODS_LOCK), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const branchIds = resolveBranchFilter(ctx, Permission.PERIODS_LOCK, req.query.location_id);
        const params: any[] = [ctx.orgId, branchIds];
        let sql = `SELECT location_id, start_date, roster_locked, timesheet_locked
                     FROM fortnight_locks WHERE org_id = $1 AND location_id = ANY($2::uuid[])`;
        if (req.query.start_date !== undefined) {
            if (!isFortnightStart(req.query.start_date)) throw badRequest('VALIDATION_FAILED', 'start_date must be the first day of a pay period.');
            params.push(req.query.start_date);
            sql += ` AND start_date = $${params.length}`;
        }
        const result = await query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        sendError(res, err, 'LOCKS GET ERROR');
    }
});

/**
 * POST /api/locks  { location_id, start_date, roster_locked?, timesheet_locked?, password }
 * Changes only the flag(s) supplied. `password` is the caller's own password, or the
 * organisation's lock password for the flag being changed.
 */
router.post('/', requirePermission(Permission.PERIODS_LOCK), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { location_id, start_date, roster_locked, timesheet_locked, password } = req.body || {};
        if (!isFortnightStart(start_date)) throw badRequest('VALIDATION_FAILED', 'start_date must be the first day of a pay period.');
        if (roster_locked === undefined && timesheet_locked === undefined) throw badRequest('VALIDATION_FAILED', 'Nothing to change.');
        for (const flag of [roster_locked, timesheet_locked]) {
            if (flag !== undefined && typeof flag !== 'boolean') throw badRequest('VALIDATION_FAILED', 'Lock flags must be true or false.');
        }
        if (typeof password !== 'string' || !password) throw badRequest('PASSWORD_REQUIRED', 'Enter your password to change a lock.');

        const branch = await loadBranch(ctx, Permission.PERIODS_LOCK, location_id);

        const [userRes, orgRes] = await Promise.all([
            query('SELECT password_hash FROM users WHERE id = $1', [ctx.userId]),
            query('SELECT roster_lock_password_hash, timesheet_lock_password_hash FROM organisations WHERE id = $1', [ctx.orgId]),
        ]);
        const candidates: string[] = [userRes.rows[0].password_hash];
        if (roster_locked !== undefined && timesheet_locked === undefined && orgRes.rows[0].roster_lock_password_hash) candidates.push(orgRes.rows[0].roster_lock_password_hash);
        if (timesheet_locked !== undefined && roster_locked === undefined && orgRes.rows[0].timesheet_lock_password_hash) candidates.push(orgRes.rows[0].timesheet_lock_password_hash);

        let passwordOk = false;
        for (const hash of candidates) {
            if (hash && await comparePassword(password, hash)) { passwordOk = true; break; }
        }
        // 403, not 401: the session is still valid, so the client must not sign the user out.
        if (!passwordOk) throw new HttpError(403, 'INVALID_PASSWORD', 'That password is not correct. The lock was not changed.');

        const result = await withTransaction(async (tx) => {
            await lockBranchPeriod(tx, ctx.orgId, branch.id, start_date);
            const before = (await tx(
                'SELECT roster_locked, timesheet_locked FROM fortnight_locks WHERE org_id = $1 AND location_id = $2 AND start_date = $3 FOR UPDATE',
                [ctx.orgId, branch.id, start_date]
            )).rows[0] || { roster_locked: false, timesheet_locked: false };
            const after = {
                roster_locked: roster_locked === undefined ? before.roster_locked : roster_locked,
                timesheet_locked: timesheet_locked === undefined ? before.timesheet_locked : timesheet_locked,
            };
            await tx(
                `INSERT INTO fortnight_locks (id, org_id, location_id, start_date, roster_locked, timesheet_locked)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (org_id, location_id, start_date) DO UPDATE
                    SET roster_locked = EXCLUDED.roster_locked, timesheet_locked = EXCLUDED.timesheet_locked`,
                [crypto.randomUUID(), ctx.orgId, branch.id, start_date, after.roster_locked, after.timesheet_locked]
            );
            return { before, after };
        });

        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'PERIOD_LOCK_CHANGED', entityType: 'fortnight_locks', branchId: branch.id,
            previousValue: JSON.stringify(result.before), newValue: JSON.stringify(result.after),
            details: `Fortnight ${start_date}, branch "${branch.name}"`
        });
        res.json({ success: true, data: { location_id: branch.id, start_date, ...result.after } });
    } catch (err) {
        sendError(res, err, 'LOCKS UPDATE ERROR');
    }
});

export default router;
