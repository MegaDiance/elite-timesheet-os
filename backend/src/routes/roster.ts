import { Router, Response } from 'express';
import { autoRosterAll, autoLogAll } from '../services/rosterService';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { badRequest, loadWorker, resolveBranchFilter } from '../services/policy';
import { isFortnightStart } from '../services/periodUtils';

const router = Router();
router.use(requireAuth);

/**
 * `employee_id` narrows the action to a single worker (a row's own "Roster"/"Log" button) instead
 * of the whole branch filter — authorised the same way any other single-worker action is, via
 * loadWorker, so it can never be used to reach a worker outside the caller's branches.
 */
async function readBulkRequest(req: AuthRequest, permission: Permission) {
    const { start_date, selected_days, location_id, employee_id } = req.body || {};
    if (!isFortnightStart(start_date)) throw badRequest('VALIDATION_FAILED', 'start_date must be the first day of a pay period.');
    if (selected_days !== undefined && (!Array.isArray(selected_days) || selected_days.some((d: unknown) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 13))) {
        throw badRequest('VALIDATION_FAILED', 'selected_days must be day numbers between 0 and 13.');
    }
    const ctx = req.auth!;
    const employeeIds = employee_id !== undefined ? [(await loadWorker(ctx, permission, employee_id)).id] : undefined;
    return {
        orgId: ctx.orgId,
        // Optional branch filter, checked against the caller's scope. Locked branches and approved timesheets are skipped.
        branchIds: resolveBranchFilter(ctx, permission, location_id),
        fortnightStartIso: start_date as string,
        selectedDays: selected_days as number[] | undefined,
        employeeIds,
        actorId: ctx.userId,
    };
}

router.post('/auto-roster', requirePermission(Permission.ROSTERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const result = await autoRosterAll(await readBulkRequest(req, Permission.ROSTERS_MANAGE));
        res.json({ success: true, data: result });
    } catch (err) {
        sendError(res, err, 'ROSTER AUTO-ROSTER ERROR');
    }
});

router.post('/auto-log', requirePermission(Permission.TIMESHEETS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const result = await autoLogAll(await readBulkRequest(req, Permission.TIMESHEETS_MANAGE));
        res.json({ success: true, data: result });
    } catch (err) {
        sendError(res, err, 'ROSTER AUTO-LOG ERROR');
    }
});

export default router;
