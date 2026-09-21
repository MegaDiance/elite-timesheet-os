import { Router, Response } from 'express';
import { query } from '../services/db';
import { requireAuth, requireTenantContext, AuthRequest } from '../middleware/auth';
import { getFortnightStartIso } from '../services/periodUtils';

const router = Router();
router.use(requireAuth, requireTenantContext);

/**
 * Helper to calculate fortnight start (snapped to Sunday cycle)
 */
function getFortnightStartDate(dateIso: string): string {
    return getFortnightStartIso(dateIso);
}

/**
 * GET /api/dashboard/today
 * Real-time command centre feed customized for the caller's role.
 */
router.get('/today', async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const userId = req.user?.id!;
        const role = req.user?.role || 'Employee';

        // Date resolution (default to current date YYYY-MM-DD)
        const todayIso = (req.query.date as string) || new Date().toISOString().split('T')[0];
        const activeFortnightStart = getFortnightStartDate(todayIso);

        // Fetch active fortnight lock
        const lockRes = await query(
            'SELECT start_date, roster_locked, timesheet_locked, is_published FROM fortnight_locks WHERE org_id = $1 AND start_date = $2',
            [orgId, activeFortnightStart]
        );
        const activeLock = lockRes.rows[0] || {
            start_date: activeFortnightStart,
            roster_locked: false,
            timesheet_locked: false,
            is_published: false
        };

        // Check if today is a configured public holiday
        let publicHoliday = null;
        try {
            const holidayRes = await query(
                'SELECT name FROM public_holidays WHERE org_id = $1 AND holiday_date = $2',
                [orgId, todayIso]
            );
            publicHoliday = holidayRes.rows[0] ? holidayRes.rows[0].name : null;
        } catch {}

        let isOwner = role === 'Owner';
        if (!isOwner && !req.user?.location_id && ['Company Admin', 'Admin'].includes(role)) {
            try {
                const orgCheck = await query('SELECT owner_user_id FROM organisations WHERE id = $1', [orgId]);
                if (orgCheck.rows[0]?.owner_user_id === userId) {
                    isOwner = true;
                }
            } catch {}
        }

        const isManager = ['Admin', 'Company Admin', 'Platform Admin', 'Manager', 'Owner'].includes(role) || isOwner;

        if (isManager) {
            // === MANAGER / ADMIN / OWNER COMMAND CENTRE ===
            const hasLoc = Boolean(req.user?.location_id) && role === 'Manager';
            const locParams = hasLoc ? [orgId, todayIso, req.user!.location_id] : [orgId, todayIso];
            const locClause = hasLoc ? ' AND (e.location_id = $3 OR e.location_id IS NULL)' : '';

            // 1. Staff scheduled today
            const employeeMap = new Map<string, any>();
            let scheduledEmployees: any[] = [];
            let currentlyWorkingCount = 0;
            let unplannedCount = 0;
            try {
                const scheduledRes = await query(
                    `SELECT dr.employee_id, e.full_name, e.department, e.phone,
                            ss.id as segment_id, ss.segment_type, ss.roster_in, ss.roster_out, ss.roster_hours,
                            ss.actual_in, ss.actual_out, ss.actual_hours, ss.is_unplanned, ss.notes
                     FROM daily_records dr
                     JOIN employees e ON dr.employee_id = e.id
                     JOIN shift_segments ss ON dr.id = ss.record_id
                     WHERE dr.org_id = $1 
                       AND dr.record_date = $2 
                       AND e.is_active = true 
                       AND e.deleted_at IS NULL${locClause}
                     ORDER BY ss.roster_in ASC NULLS LAST, e.full_name ASC`,
                    locParams
                );

                scheduledRes.rows.forEach((row: any) => {
                    if (!employeeMap.has(row.employee_id)) {
                        employeeMap.set(row.employee_id, {
                            employee_id: row.employee_id,
                            full_name: row.full_name,
                            department: row.department,
                            phone: row.phone,
                            segments: []
                        });
                    }
                    const emp = employeeMap.get(row.employee_id);
                    emp.segments.push({
                        segment_id: row.segment_id,
                        segment_type: row.segment_type,
                        roster_in: row.roster_in,
                        roster_out: row.roster_out,
                        roster_hours: Number(row.roster_hours || 0),
                        actual_in: row.actual_in,
                        actual_out: row.actual_out,
                        actual_hours: Number(row.actual_hours || 0),
                        is_unplanned: !!row.is_unplanned,
                        notes: row.notes
                    });

                    // Count if currently working or clocked in
                    if (row.actual_in && !row.actual_out) {
                        currentlyWorkingCount++;
                    }
                });

                scheduledEmployees = Array.from(employeeMap.values());
                unplannedCount = scheduledRes.rows.filter((r: any) => r.is_unplanned).length;
            } catch (err) {}

            // 2. Pending timesheet submissions for active cycle
            let pendingSubmissions: any[] = [];
            try {
                const subParams = hasLoc ? [orgId, req.user!.location_id] : [orgId];
                const subLocClause = hasLoc ? ' AND (e.location_id = $2 OR e.location_id IS NULL)' : '';
                const subRes = await query(
                    `SELECT ts.id as submission_id, ts.employee_id, e.full_name, e.department, 
                            ts.start_date, ts.status, ts.submitted_at
                     FROM timesheet_submissions ts
                     JOIN employees e ON ts.employee_id = e.id
                     WHERE ts.org_id = $1 
                       AND ts.status IN ('Submitted', 'Under Review')${subLocClause}
                     ORDER BY ts.submitted_at ASC`,
                    subParams
                );
                pendingSubmissions = subRes.rows;
            } catch (err) {}

            // 3. Pending leave requests
            let pendingLeave: any[] = [];
            try {
                const subParams = hasLoc ? [orgId, req.user!.location_id] : [orgId];
                const subLocClause = hasLoc ? ' AND (e.location_id = $2 OR e.location_id IS NULL)' : '';
                const leaveRes = await query(
                    `SELECT lr.id, lr.employee_id, e.full_name, e.department, 
                            lr.leave_type, lr.start_date, lr.end_date, lr.hours, lr.reason, lr.created_at
                     FROM leave_requests lr
                     JOIN employees e ON lr.employee_id = e.id
                     WHERE lr.org_id = $1 
                       AND lr.status = 'Pending'${subLocClause}
                     ORDER BY lr.created_at ASC`,
                    subParams
                );
                pendingLeave = leaveRes.rows;
            } catch (err) {}

            // 4. Total active staff
            let totalActiveStaff = 0;
            try {
                const subLocClause = hasLoc ? ' AND (e.location_id = $2 OR e.location_id IS NULL)' : '';
                const subParams = hasLoc ? [orgId, req.user!.location_id] : [orgId];
                const staffCountRes = await query(
                    `SELECT COUNT(*) as count FROM employees e WHERE e.org_id = $1 AND e.is_active = true AND e.deleted_at IS NULL${subLocClause}`,
                    subParams
                );
                totalActiveStaff = Number(staffCountRes.rows[0]?.count || 0);
            } catch (err) {}

            if (isOwner && !req.user?.location_id) {
                // === ORGANISATION OWNER EXTENDED METRICS ===
                let locCount = 0;
                let mgrCount = 0;
                let empCount = totalActiveStaff;
                let orgMeta: any = {};
                try {
                    const lRes = await query('SELECT COUNT(*) as count FROM locations WHERE org_id = $1 AND is_active = true', [orgId]);
                    locCount = Number(lRes.rows[0]?.count || 0);
                } catch {
                    try {
                        const lRes = await query('SELECT COUNT(*) as count FROM locations WHERE organisation_id = $1 AND is_active = true', [orgId]);
                        locCount = Number(lRes.rows[0]?.count || 0);
                    } catch {}
                }
                try {
                    const mRes = await query(`
                        SELECT COUNT(DISTINCT lm.user_id) as count
                        FROM location_memberships lm
                        JOIN locations l ON lm.location_id = l.id
                        WHERE l.org_id = $1 AND (LOWER(lm.role) = 'manager') AND l.is_active = true
                    `, [orgId]);
                    mgrCount = Number(mRes.rows[0]?.count || 0);
                } catch {
                    try {
                        const mRes = await query(`
                            SELECT COUNT(DISTINCT lm.user_id) as count
                            FROM location_memberships lm
                            JOIN locations l ON lm.location_id = l.id
                            WHERE l.organisation_id = $1 AND (LOWER(lm.role) = 'manager') AND l.is_active = true
                        `, [orgId]);
                        mgrCount = Number(mRes.rows[0]?.count || 0);
                    } catch {}
                }
                try {
                    const oRes = await query('SELECT name, slug, portal_slug, timesheet_entry_mode FROM organisations WHERE id = $1', [orgId]);
                    orgMeta = oRes.rows[0] || {};
                } catch {}

                const payload = {
                    role: 'Owner',
                    is_owner_view: true,
                    date: todayIso,
                    active_fortnight: activeFortnightStart,
                    lock_status: activeLock,
                    public_holiday: publicHoliday,
                    metrics: {
                        total_locations: locCount,
                        active_managers: mgrCount,
                        total_employees: empCount,
                        total_staff: totalActiveStaff,
                        scheduled_today: scheduledEmployees.length,
                        currently_working: currentlyWorkingCount,
                        pending_submissions: pendingSubmissions.length,
                        pending_leave: pendingLeave.length,
                        unplanned_shifts_today: unplannedCount
                    },
                    organisation: {
                        name: orgMeta.name || '',
                        portal_slug: orgMeta.portal_slug || null,
                        entry_mode: orgMeta.timesheet_entry_mode || 'employee'
                    },
                    summary: {
                        total_locations: locCount,
                        active_managers: mgrCount,
                        total_employees: empCount,
                        timesheet_entry_mode: orgMeta.timesheet_entry_mode || 'employee',
                        portal_slug: orgMeta.portal_slug || null,
                        organisation_name: orgMeta.name || ''
                    },
                    scheduled_today: scheduledEmployees,
                    pending_submissions: pendingSubmissions,
                    pending_leave: pendingLeave,
                    total_active_staff: totalActiveStaff,
                    currently_working: currentlyWorkingCount,
                    unplanned_shifts: unplannedCount
                };

                return res.json({
                    success: true,
                    ...payload,
                    data: payload
                });
            }

            const payload = {
                role,
                date: todayIso,
                active_fortnight: activeFortnightStart,
                lock_status: activeLock,
                public_holiday: publicHoliday,
                metrics: {
                    total_staff: totalActiveStaff,
                    scheduled_today: scheduledEmployees.length,
                    currently_working: currentlyWorkingCount,
                    pending_submissions: pendingSubmissions.length,
                    pending_leave: pendingLeave.length,
                    unplanned_shifts_today: unplannedCount
                },
                scheduled_today: scheduledEmployees,
                pending_submissions: pendingSubmissions,
                pending_leave: pendingLeave
            };

            return res.json({
                success: true,
                ...payload,
                data: payload
            });
        } else {
            // === EMPLOYEE COMMAND CENTRE ===
            const empRes = await query(
                'SELECT id, full_name, department, contracted_hours FROM employees WHERE user_id = $1 AND org_id = $2 AND deleted_at IS NULL',
                [userId, orgId]
            );

            if (empRes.rows.length === 0) {
                const payload = {
                    role,
                    date: todayIso,
                    active_fortnight: activeFortnightStart,
                    lock_status: activeLock,
                    public_holiday: publicHoliday,
                    has_employee_record: false,
                    message: 'No employee record linked to user.'
                };
                return res.json({
                    success: true,
                    ...payload,
                    data: payload
                });
            }

            const employee = empRes.rows[0];

            // 1. My shift today (only visible if published or has actuals)
            let myShifts: any[] = [];
            const isPublished = Boolean(activeLock.is_published && activeLock.roster_locked);

            const shiftRes = await query(
                `SELECT ss.id, ss.segment_type, ss.roster_in, ss.roster_out, ss.roster_hours,
                        ss.actual_in, ss.actual_out, ss.actual_hours, ss.is_unplanned, ss.notes
                 FROM daily_records dr
                 JOIN shift_segments ss ON dr.id = ss.record_id
                 WHERE dr.org_id = $1 
                   AND dr.employee_id = $2 
                   AND dr.record_date = $3`,
                [orgId, employee.id, todayIso]
            );

            if (isPublished) {
                myShifts = shiftRes.rows.map((s: any) => ({
                    segment_id: s.id,
                    segment_type: s.segment_type,
                    roster_in: s.roster_in,
                    roster_out: s.roster_out,
                    roster_hours: Number(s.roster_hours || 0),
                    actual_in: s.actual_in,
                    actual_out: s.actual_out,
                    actual_hours: Number(s.actual_hours || 0),
                    is_unplanned: !!s.is_unplanned,
                    notes: s.notes
                }));
            } else {
                // If not published, only show actuals if already clocked
                myShifts = shiftRes.rows
                    .filter((s: any) => s.actual_in || s.actual_out)
                    .map((s: any) => ({
                        segment_id: s.id,
                        segment_type: s.segment_type,
                        roster_in: null,
                        roster_out: null,
                        roster_hours: 0,
                        actual_in: s.actual_in,
                        actual_out: s.actual_out,
                        actual_hours: Number(s.actual_hours || 0),
                        is_unplanned: !!s.is_unplanned,
                        notes: s.notes
                    }));
            }

            // 2. Personal timesheet submission status for active fortnight
            const mySubRes = await query(
                'SELECT id, status, submitted_at, reviewed_at, rejection_reason FROM timesheet_submissions WHERE org_id = $1 AND employee_id = $2 AND start_date = $3',
                [orgId, employee.id, activeFortnightStart]
            );
            const timesheetStatus = mySubRes.rows[0] || {
                status: 'Draft',
                submitted_at: null,
                reviewed_at: null,
                rejection_reason: null
            };

            // 3. Employee's pending leave requests
            const myLeaveRes = await query(
                'SELECT id, leave_type, start_date, end_date, hours, status, reason FROM leave_requests WHERE org_id = $1 AND employee_id = $2 ORDER BY created_at DESC LIMIT 5',
                [orgId, employee.id]
            );

            // 4. Colleagues on duty today (privacy-preserving: name and department only)
            let teamToday: any[] = [];
            if (isPublished) {
                const teamRes = await query(
                    `SELECT DISTINCT e.full_name, e.department
                     FROM daily_records dr
                     JOIN employees e ON dr.employee_id = e.id
                     JOIN shift_segments ss ON dr.id = ss.record_id
                     WHERE dr.org_id = $1 
                       AND dr.record_date = $2 
                       AND dr.employee_id != $3
                       AND e.is_active = true 
                       AND e.deleted_at IS NULL
                     ORDER BY e.full_name ASC`,
                    [orgId, todayIso, employee.id]
                );
                teamToday = teamRes.rows;
            }

            const payload = {
                role,
                date: todayIso,
                active_fortnight: activeFortnightStart,
                lock_status: activeLock,
                public_holiday: publicHoliday,
                has_employee_record: true,
                employee: {
                    id: employee.id,
                    full_name: employee.full_name,
                    department: employee.department,
                    contracted_hours: Number(employee.contracted_hours || 76)
                },
                my_shifts: myShifts,
                timesheet_status: timesheetStatus,
                my_leave: myLeaveRes.rows,
                team_today: teamToday
            };

            return res.json({
                success: true,
                ...payload,
                data: payload
            });
        }
    } catch (err: any) {
        console.error('[DASHBOARD TODAY ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load command centre data.' } });
    }
});

export default router;
