import { Router, Response } from 'express';
import { query } from '../services/db';
import { requireAuth, requireManagement, Permission, AuthRequest, sendError } from '../middleware/auth';
import { AccessContext, badRequest, forbidden, isUuid, scopedBranchIds } from '../services/policy';
import { fmtISO, getFortnightStart } from '../services/periodUtils';

/**
 * Counts for the navigation badges ("3 timesheets waiting"). There is deliberately no dashboard:
 * people go straight to the page they work in, and these counts only point them at it. Each count
 * is limited to the branches where the caller holds the permission to act on it, and a requested
 * branch outside everything the caller can see is refused.
 */
const router = Router();
router.use(requireAuth);

const DEFAULT_TIMEZONE = 'Australia/Melbourne';

/** Today's calendar date ('YYYY-MM-DD') in a branch's timezone. */
function todayInTimezone(timeZone: string | null): string {
    const format = (zone: string) => {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
        const part = (type: string) => parts.find(p => p.type === type)?.value;
        return `${part('year')}-${part('month')}-${part('day')}`;
    };
    try {
        return format(timeZone || DEFAULT_TIMEZONE);
    } catch {
        // A branch with an unrecognised timezone name still gets counts.
        return format(DEFAULT_TIMEZONE);
    }
}

/**
 * The branches (within a permission's scope) the caller asked for. `requested` must be one of the
 * branches the caller can see at all; the permission then narrows it further, possibly to none.
 */
function visibleScope(ctx: AccessContext, permission: Permission, requested: unknown): string[] {
    const scope = scopedBranchIds(ctx, permission);
    return requested === null ? scope : scope.filter(id => id === requested);
}

/** Validates `?location_id=` against everything the caller can see; null means "all of it". */
function readRequestedBranch(ctx: AccessContext, value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (!isUuid(value)) throw badRequest('INVALID_BRANCH', 'location_id must be a branch id.');
    if (!ctx.branchIds.includes(value)) throw forbidden('You do not have access to this branch.');
    return value;
}

/**
 * GET /api/attention?location_id=
 * Small counts for the navigation badges: timesheets still waiting for approval this pay period,
 * and leave requests waiting for a decision — only for the branches the caller may act in, and
 * leave only when the caller can review it.
 */
router.get('/', requireManagement, async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const requested = readRequestedBranch(ctx, req.query.location_id);
        const timesheetScope = visibleScope(ctx, Permission.TIMESHEETS_APPROVE, requested);
        const leaveScope = visibleScope(ctx, Permission.LEAVE_APPROVE, requested);
        const fortnightStart = fmtISO(getFortnightStart(todayInTimezone(null)));
        const [timesheets, leave] = await Promise.all([
            timesheetScope.length > 0
                ? query(
                    `SELECT COUNT(*)::int AS n FROM employees e
                      WHERE e.org_id = $1 AND e.location_id = ANY($2::uuid[]) AND e.is_active = true
                        AND NOT EXISTS (SELECT 1 FROM timesheet_submissions ts
                                         WHERE ts.org_id = e.org_id AND ts.employee_id = e.id AND ts.start_date = $3 AND ts.status = 'Approved')`,
                    [ctx.orgId, timesheetScope, fortnightStart])
                : Promise.resolve({ rows: [{ n: 0 }] }),
            leaveScope.length > 0
                ? query(
                    `SELECT COUNT(*)::int AS n FROM leave_requests lr
                       JOIN employees e ON e.id = lr.employee_id AND e.org_id = lr.org_id
                      WHERE lr.org_id = $1 AND e.location_id = ANY($2::uuid[]) AND lr.status = 'Pending'`,
                    [ctx.orgId, leaveScope])
                : Promise.resolve({ rows: [{ n: 0 }] }),
        ]);
        res.json({ success: true, data: { timesheets_waiting: timesheets.rows[0].n, leave_pending: leave.rows[0].n, fortnight_start: fortnightStart } });
    } catch (err) {
        sendError(res, err, 'ATTENTION ERROR');
    }
});

export default router;
