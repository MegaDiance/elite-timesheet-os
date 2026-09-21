import { Router, Response } from 'express';
import { autoRosterAll, autoLogAll } from '../services/rosterService';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { badRequest, resolveBranchFilter } from '../services/policy';
import { isFortnightStart } from '../services/periodUtils';

const router = Router();
router.use(requireAuth);

function readBulkRequest(req: AuthRequest, permission: Permission) {
    const { start_date, selected_days, location_id } = req.body || {};
    if (!isFortnightStart(start_date)) throw badRequest('VALIDATION_FAILED', 'start_date must be the first day of a pay period.');
    if (selected_days !== undefined && (!Array.isArray(selected_days) || selected_days.some((d: unknown) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 13))) {
        throw badRequest('VALIDATION_FAILED', 'selected_days must be day numbers between 0 and 13.');
    }
    return {
        orgId: req.auth!.orgId,
        // Optional branch filter, checked against the caller's scope. Locked branches and approved timesheets are skipped.
        branchIds: resolveBranchFilter(req.auth!, permission, location_id),
        fortnightStartIso: start_date as string,
        selectedDays: selected_days as number[] | undefined,
        actorId: req.auth!.userId,
    };
}

router.post('/auto-roster', requirePermission(Permission.ROSTERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const result = await autoRosterAll(readBulkRequest(req, Permission.ROSTERS_MANAGE));
        res.json({ success: true, data: result });
    } catch (err) {
        sendError(res, err, 'ROSTER AUTO-ROSTER ERROR');
    }
});

router.post('/auto-log', requirePermission(Permission.TIMESHEETS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const result = await autoLogAll(readBulkRequest(req, Permission.TIMESHEETS_MANAGE));
        res.json({ success: true, data: result });
    } catch (err) {
        sendError(res, err, 'ROSTER AUTO-LOG ERROR');
    }
});

export default router;
