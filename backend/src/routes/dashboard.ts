import { Router, Response } from 'express';
import { query } from '../services/db';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { badRequest, hasPermission, isUuid, resolveBranchFilter } from '../services/policy';
import { publicBaseUrl } from '../services/authUtils';
import { addDays, fmtISO, getFortnightStart, isIsoDate } from '../services/periodUtils';

/**
 * Management dashboard: what is happening today in the branches the caller may act in.
 * The Organisation Owner sees every branch; a Branch Admin sees their assigned branches.
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
        // A branch with an unrecognised timezone name still gets a dashboard.
        return format(DEFAULT_TIMEZONE);
    }
}

/** A client-supplied ?date= only selects which day to show; it must be a real calendar date. */
function readDate(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (!isIsoDate(value)) {
        throw badRequest('INVALID_DATE', 'date must be a calendar date in YYYY-MM-DD format.');
    }
    return value;
}

/**
 * GET /api/dashboard/today?location_id=&date=
 */
router.get('/today', requirePermission(Permission.BRANCH_VIEW), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const branchFilter = resolveBranchFilter(ctx, Permission.BRANCH_VIEW, req.query.location_id);
        const requestedDate = readDate(req.query.date);
        // Deactivated branches are left out unless one was asked for by id (already checked against the caller's scope above).
        const includeInactive = isUuid(req.query.location_id);

        const branchRes = await query(
            `SELECT l.id, l.name, l.is_active, l.timezone
               FROM locations l
              WHERE l.org_id = $1 AND l.id = ANY($2::uuid[]) AND (l.is_active = true OR $3::boolean)
              ORDER BY l.name ASC`,
            [ctx.orgId, branchFilter, includeInactive]
        );
        const branches: Array<{ id: string; name: string; is_active: boolean; timezone: string | null }> = branchRes.rows;
        // Every query below is limited to these ids: a subset of the caller's authorised scope.
        const scope = branches.map(b => b.id);
        const branchName = new Map(branches.map(b => [b.id, b.name]));

        const date = requestedDate || todayInTimezone(branches[0]?.timezone || null);
        const fortnightStart = getFortnightStart(date);
        const fortnightStartIso = fmtISO(fortnightStart);
        const fortnightEndIso = fmtISO(addDays(fortnightStart, 13));
        const isOwnerView = hasPermission(ctx, Permission.ORGANISATION_MANAGE);

        const [holidayRes, lockRes, scheduledRes, workerRes, orgRes] = await Promise.all([
            query('SELECT name FROM public_holidays WHERE org_id = $1 AND holiday_date = $2', [ctx.orgId, date]),
            query(
                `SELECT fl.location_id, fl.roster_locked, fl.timesheet_locked
                   FROM fortnight_locks fl
                   JOIN locations l ON l.id = fl.location_id AND l.org_id = fl.org_id
                  WHERE fl.org_id = $1 AND fl.start_date = $2 AND l.id = ANY($3::uuid[])`,
                [ctx.orgId, fortnightStartIso, scope]
            ),
            query(
                `SELECT e.id AS employee_id, e.full_name, e.department, e.phone, e.location_id,
                        ss.id AS segment_id, ss.segment_type, ss.actual_segment_type,
                        ss.roster_in, ss.roster_out, ss.roster_hours,
                        ss.actual_in, ss.actual_out, ss.actual_hours, ss.is_unplanned, ss.notes
                   FROM daily_records dr
                   JOIN employees e ON e.id = dr.employee_id AND e.org_id = dr.org_id
                   JOIN shift_segments ss ON ss.record_id = dr.id
                  WHERE dr.org_id = $1
                    AND dr.record_date = $2
                    AND e.location_id = ANY($3::uuid[])
                    AND e.is_active = true
                    AND e.deleted_at IS NULL
                  ORDER BY ss.roster_in ASC NULLS LAST, e.full_name ASC`,
                [ctx.orgId, date, scope]
            ),
            query(
                `SELECT e.id AS employee_id, e.full_name, e.department, e.location_id,
                        COALESCE(ts.status, 'Draft') AS status
                   FROM employees e
                   LEFT JOIN timesheet_submissions ts
                          ON ts.org_id = e.org_id AND ts.employee_id = e.id AND ts.start_date = $2
                  WHERE e.org_id = $1
                    AND e.location_id = ANY($3::uuid[])
                    AND e.is_active = true
                    AND e.deleted_at IS NULL
                  ORDER BY e.full_name ASC`,
                [ctx.orgId, fortnightStartIso, scope]
            ),
            isOwnerView
                ? query(
                    `SELECT COALESCE(o.display_name, o.name) AS name, o.portal_slug,
                            (SELECT COUNT(DISTINCT ba.user_id)::int FROM branch_admins ba WHERE ba.org_id = o.id) AS branch_admins
                       FROM organisations o
                      WHERE o.id = $1`,
                    [ctx.orgId]
                )
                : Promise.resolve(null),
        ]);

        // 1. Who is rostered / working today
        const scheduledByWorker = new Map<string, any>();
        let unplannedShifts = 0;
        for (const row of scheduledRes.rows) {
            let worker = scheduledByWorker.get(row.employee_id);
            if (!worker) {
                worker = {
                    employee_id: row.employee_id,
                    full_name: row.full_name,
                    department: row.department,
                    phone: row.phone,
                    location_id: row.location_id,
                    location_name: branchName.get(row.location_id) || null,
                    is_working: false,
                    segments: [],
                };
                scheduledByWorker.set(row.employee_id, worker);
            }
            worker.segments.push({
                segment_id: row.segment_id,
                segment_type: row.segment_type,
                actual_segment_type: row.actual_segment_type,
                roster_in: row.roster_in,
                roster_out: row.roster_out,
                roster_hours: Number(row.roster_hours || 0),
                actual_in: row.actual_in,
                actual_out: row.actual_out,
                actual_hours: Number(row.actual_hours || 0),
                is_unplanned: Boolean(row.is_unplanned),
                notes: row.notes,
            });
            if (row.actual_in && !row.actual_out) worker.is_working = true;
            if (row.is_unplanned) unplannedShifts++;
        }
        const scheduledToday = Array.from(scheduledByWorker.values());

        // 2. Per-branch period status and timesheet counts for the current fortnight
        const branchStatus = new Map(branches.map(b => [b.id, {
            location_id: b.id,
            location_name: b.name,
            roster_locked: false,
            timesheet_locked: false,
            active_workers: 0,
            timesheets_approved: 0,
            timesheets_pending: 0,
        }]));
        for (const lock of lockRes.rows) {
            const status = branchStatus.get(lock.location_id);
            if (!status) continue;
            status.roster_locked = Boolean(lock.roster_locked);
            status.timesheet_locked = Boolean(lock.timesheet_locked);
        }

        const pendingTimesheets: any[] = [];
        let approvedCount = 0;
        for (const worker of workerRes.rows) {
            const status = branchStatus.get(worker.location_id);
            if (!status) continue;
            status.active_workers++;
            if (worker.status === 'Approved') {
                status.timesheets_approved++;
                approvedCount++;
            } else {
                status.timesheets_pending++;
                pendingTimesheets.push({
                    employee_id: worker.employee_id,
                    full_name: worker.full_name,
                    department: worker.department,
                    location_id: worker.location_id,
                    location_name: status.location_name,
                    status: worker.status,
                });
            }
        }

        // 3. Organisation card (Owner only). The link is built from server configuration.
        const org = orgRes?.rows[0];
        const organisation = org
            ? {
                name: org.name,
                sign_in_link: `${publicBaseUrl()}/login/${org.portal_slug}`,
                branch_admins: org.branch_admins,
            }
            : null;

        res.json({
            success: true,
            data: {
                role: ctx.role,
                date,
                active_fortnight: fortnightStartIso,
                fortnight_end: fortnightEndIso,
                public_holiday: holidayRes.rows[0]?.name || null,
                branches: branches.map(b => ({ id: b.id, name: b.name, is_active: b.is_active })),
                metrics: {
                    branches: branches.length,
                    active_workers: approvedCount + pendingTimesheets.length,
                    scheduled_today: scheduledToday.length,
                    currently_working: scheduledToday.filter(w => w.is_working).length,
                    unplanned_shifts_today: unplannedShifts,
                    timesheets_approved: approvedCount,
                    timesheets_pending: pendingTimesheets.length,
                },
                branch_status: Array.from(branchStatus.values()),
                scheduled_today: scheduledToday,
                pending_timesheets: pendingTimesheets,
                organisation,
            },
        });
    } catch (err) {
        sendError(res, err, 'DASHBOARD TODAY ERROR');
    }
});

export default router;
