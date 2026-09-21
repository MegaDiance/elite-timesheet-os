import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import {
    requireAuth,
    requireTenantContext,
    requirePermission,
    requireAnyBranchPermission,
    AuthRequest
} from '../middleware/auth';
import {
    Permission,
    checkUserPermission,
    resolveUserSecurityContext,
    branchesWithPermission,
    organisationHasNoBranches,
    UserSecurityContext
} from '../services/permissionService';
import { addDays, fmtISO } from '../services/periodUtils';

const router = Router();
router.use(requireAuth, requireTenantContext);

async function getContext(req: AuthRequest, orgId: string): Promise<UserSecurityContext> {
    if (req.securityContext) return req.securityContext;
    const ctx = await resolveUserSecurityContext(req.user!.id, orgId, req.user?.location_id, req.user?.role);
    req.securityContext = ctx;
    return ctx;
}

/**
 * CRITICAL TIMESHEET BOUNDARY CHECK.
 *
 * Verifies the caller holds the requested timesheet permission in the branch that the
 * target employee belongs to. Organisation-level roles (OWNER / ORG_ADMIN / ORG_MANAGER)
 * receive NO branch timesheet access here - the legacy role-string bypass has been removed.
 */
async function checkEmployeeTimesheetPermission(
    req: AuthRequest,
    empId: string,
    orgId: string,
    permission: Permission
): Promise<boolean> {
    const ctx = await getContext(req, orgId);
    if (ctx.isPlatformAdmin) return true;

    let empLoc: string | null = null;
    try {
        const check = await query('SELECT location_id FROM employees WHERE id = $1 AND org_id = $2', [empId, orgId]);
        if (check.rows.length === 0) return false;
        empLoc = check.rows[0].location_id || null;
    } catch {
        empLoc = null;
    }

    if (!empLoc) {
        // Employee not assigned to any branch (legacy / single-site data).
        if (await organisationHasNoBranches(orgId)) {
            const fallback = await checkUserPermission(ctx, permission, {});
            return fallback.allowed;
        }
        // Branch-configured tenant: require the permission in at least one branch.
        return branchesWithPermission(ctx, permission).length > 0;
    }

    const result = await checkUserPermission(ctx, permission, { branchId: empLoc });
    return result.allowed;
}

/** Backwards-compatible alias retained for the submit-on-behalf flow. */
async function checkSubmissionEmployeeLocation(req: AuthRequest, empId: string, orgId: string): Promise<boolean> {
    return checkEmployeeTimesheetPermission(req, empId, orgId, Permission.TIMESHEET_REVIEW);
}

/**
 * POST /api/submissions/submit
 * Employee (or Manager on behalf) submits timesheet for a fortnight.
 * Sets status = 'Submitted'
 */
router.post('/submit', requireAuth, requireTenantContext, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const userId = req.user?.id!;
        const { start_date } = req.body;
        let { employee_id } = req.body;

        if (!start_date) {
            return res.status(400).json({ success: false, error: { message: 'start_date is required' } });
        }

        const isManager = ['Admin', 'Company Admin', 'Platform Admin', 'Manager', 'Owner'].includes(req.user?.role || '');

        // Check organisation timesheet_entry_mode
        try {
            const orgModeRes = await query('SELECT timesheet_entry_mode FROM organisations WHERE id = $1', [orgId]);
            const entryMode = orgModeRes.rows[0]?.timesheet_entry_mode || 'employee';
            if (entryMode === 'manager' && !isManager) {
                return res.status(403).json({
                    success: false,
                    error: {
                        code: 'TIMESHEET_MODE_MANAGER_ONLY',
                        message: 'This organisation operates in Manager Entry mode. Employees cannot submit timesheets directly.'
                    }
                });
            }
        } catch {}

        // Check if timesheet is locked for this fortnight
        const lockRes = await query('SELECT timesheet_locked FROM fortnight_locks WHERE org_id = $1 AND start_date = $2', [orgId, start_date]);
        if (lockRes.rows[0]?.timesheet_locked) {
            return res.status(403).json({ success: false, error: { code: 'TIMESHEET_LOCKED', message: 'Timesheet is locked for this fortnight.' } });
        }

        // Resolve logged in employee record
        const empRes = await query('SELECT id FROM employees WHERE user_id = $1 AND org_id = $2 AND deleted_at IS NULL', [userId, orgId]);
        const myEmpId = empRes.rows.length > 0 ? empRes.rows[0].id : null;

        if (!employee_id) {
            if (!myEmpId) {
                return res.status(404).json({ success: false, error: { message: 'No linked employee record found.' } });
            }
            employee_id = myEmpId;
        } else {
            // Verify provided employee_id belongs to this org
            const checkEmp = await query('SELECT id FROM employees WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL', [employee_id, orgId]);
            if (checkEmp.rows.length === 0) {
                return res.status(404).json({ success: false, error: { message: 'Employee not found in this organisation.' } });
            }
            if (!isManager && employee_id !== myEmpId) {
                return res.status(403).json({ success: false, error: { message: 'Forbidden: You can only submit timesheets for yourself.' } });
            }
            if (isManager && !(await checkSubmissionEmployeeLocation(req, employee_id, orgId))) {
                return res.status(403).json({
                    success: false,
                    error: {
                        code: 'LOCATION_FORBIDDEN',
                        message: 'You do not have permission to manage timesheets for employees in another location.'
                    }
                });
            }
        }

        // Check if submission already exists
        const existing = await query(
            'SELECT id, status FROM timesheet_submissions WHERE org_id = $1 AND employee_id = $2 AND start_date = $3',
            [orgId, employee_id, start_date]
        );

        if (existing.rows.length > 0 && ['Approved', 'Locked'].includes(existing.rows[0].status)) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'TIMESHEET_ALREADY_APPROVED',
                    message: 'This timesheet has already been approved and finalized. Resubmission is prohibited.'
                }
            });
        }

        // Validate shift segments completeness across the fortnight
        try {
            const [y, m, d] = start_date.split('-').map(Number);
            const fnStart = new Date(Date.UTC(y, m - 1, d));
            const fnEnd = addDays(fnStart, 13);
            const endDateIso = fmtISO(fnEnd);

            const recs = await query(
                `SELECT dr.record_date, ss.actual_in, ss.actual_out, ss.roster_in, ss.roster_out
                 FROM daily_records dr
                 JOIN shift_segments ss ON ss.record_id = dr.id
                 WHERE dr.org_id = $1 AND dr.employee_id = $2 AND dr.record_date >= $3 AND dr.record_date <= $4`,
                [orgId, employee_id, start_date, endDateIso]
            );

            for (const r of recs.rows) {
                if (r.actual_in && !r.actual_out) {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'INVALID_SEGMENT',
                            message: `Incomplete shift segment on ${r.record_date}: missing finish time for clock-in at ${r.actual_in}.`
                        }
                    });
                }
                if (!r.actual_in && r.actual_out) {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'INVALID_SEGMENT',
                            message: `Incomplete shift segment on ${r.record_date}: missing start time for finish time at ${r.actual_out}.`
                        }
                    });
                }
            }
        } catch (err: any) {
            if (!err.message?.includes('does not exist') && !err.data?.error?.includes('does not exist')) {
                throw err;
            }
        }

        let subId: string;
        if (existing.rows.length > 0) {
            subId = existing.rows[0].id;
            const updateRes = await query(`
                UPDATE timesheet_submissions
                SET status = 'Submitted', submitted_at = NOW(), rejection_reason = NULL
                WHERE id = $1 AND org_id = $2 AND status NOT IN ('Approved', 'Locked')
                RETURNING id
            `, [subId, orgId]);
            if (updateRes.rows.length === 0) {
                return res.status(403).json({
                    success: false,
                    error: {
                        code: 'TIMESHEET_ALREADY_APPROVED',
                        message: 'This timesheet has already been approved and finalized. Resubmission is prohibited.'
                    }
                });
            }
        } else {
            subId = crypto.randomUUID();
            await query(`
                INSERT INTO timesheet_submissions (id, org_id, employee_id, start_date, status, submitted_at)
                VALUES ($1, $2, $3, $4, 'Submitted', NOW())
            `, [subId, orgId, employee_id, start_date]);
        }

        // Audit log
        await query(`
            INSERT INTO audit_logs (id, org_id, actor_id, action, entity_type, entity_id, details, timestamp)
            VALUES ($1, $2, $3, 'TIMESHEET_SUBMITTED', 'timesheet_submissions', $4, $5, NOW())
        `, [
            crypto.randomUUID(),
            orgId,
            userId,
            subId,
            JSON.stringify({ employee_id, start_date, status: 'Submitted' })
        ]);

        res.json({ success: true, data: { id: subId, status: 'Submitted' } });
    } catch (err: any) {
        console.error('[SUBMISSION SUBMIT ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to submit timesheet.' } });
    }
});

/**
 * GET /api/submissions
 * Manager / Admin view: List submission statuses for all employees in a fortnight
 */
router.get('/', requireAuth, requireTenantContext, requireAnyBranchPermission(Permission.TIMESHEET_VIEW), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const startDate = req.query.start_date as string;

        if (!startDate) {
            return res.status(400).json({ success: false, error: { message: 'start_date query param required' } });
        }

        // Restrict the roster of employees to the branches where the caller holds TIMESHEET_VIEW.
        const ctx = await getContext(req, orgId);
        const requestedBranch = (req.query.location_id as string) || req.user?.location_id || null;
        let allowedBranchIds: string[] | null = null;
        if (!ctx.isPlatformAdmin) {
            const viewable = branchesWithPermission(ctx, Permission.TIMESHEET_VIEW);
            if (requestedBranch) {
                allowedBranchIds = viewable.filter(b => b === requestedBranch);
            } else if (viewable.length > 0) {
                allowedBranchIds = viewable;
            } else {
                allowedBranchIds = null; // legacy tenant fallback (guard already authorised)
            }
        }

        let employeesRes;
        try {
            if (allowedBranchIds && allowedBranchIds.length > 0) {
                const placeholders = allowedBranchIds.map((_, i) => `$${i + 2}`).join(', ');
                employeesRes = await query(
                    `SELECT id, full_name, department, contracted_hours FROM employees
                     WHERE org_id = $1 AND location_id IN (${placeholders})
                       AND is_active = true AND deleted_at IS NULL ORDER BY full_name ASC`,
                    [orgId, ...allowedBranchIds]
                );
            } else {
                employeesRes = await query(
                    'SELECT id, full_name, department, contracted_hours FROM employees WHERE org_id = $1 AND is_active = true AND deleted_at IS NULL ORDER BY full_name ASC',
                    [orgId]
                );
            }
        } catch {
            employeesRes = await query(
                'SELECT id, full_name, department, contracted_hours FROM employees WHERE org_id = $1 AND is_active = true AND deleted_at IS NULL ORDER BY full_name ASC',
                [orgId]
            );
        }

        const subsRes = await query(
            'SELECT * FROM timesheet_submissions WHERE org_id = $1 AND start_date = $2',
            [orgId, startDate]
        );
        const subMap = new Map<string, any>();
        subsRes.rows.forEach((s: any) => subMap.set(s.employee_id, s));

        // Calculate hours for each employee in this fortnight
        const [y, m, d] = startDate.split('-').map(Number);
        const fnStart = new Date(Date.UTC(y, m - 1, d));
        const fnEnd = addDays(fnStart, 13);
        const endDateIso = fmtISO(fnEnd);

        const hoursMap = new Map<string, { rostered: number; actual: number }>();
        try {
            const recRes = await query(
                `SELECT dr.employee_id, ss.roster_hours, ss.actual_hours, ss.actual_in, ss.actual_out
                 FROM daily_records dr
                 JOIN shift_segments ss ON ss.record_id = dr.id
                 WHERE dr.org_id = $1 AND dr.record_date >= $2 AND dr.record_date <= $3`,
                [orgId, startDate, endDateIso]
            );

            for (const row of recRes.rows) {
                const prev = hoursMap.get(row.employee_id) || { rostered: 0, actual: 0 };
                prev.rostered += Number(row.roster_hours || 0);
                if (row.actual_hours > 0 || (row.actual_in && row.actual_out)) {
                    prev.actual += Number(row.actual_hours || 0);
                }
                hoursMap.set(row.employee_id, prev);
            }
        } catch {
            // Safe fallback if daily_records not yet created
        }

        const list = employeesRes.rows.map((emp: any) => {
            const sub = subMap.get(emp.id);
            const hrs = hoursMap.get(emp.id) || { rostered: 0, actual: 0 };
            const contracted = Number(emp.contracted_hours || 76);
            const actualHours = Math.round(hrs.actual * 100) / 100;
            const rosteredHours = Math.round(hrs.rostered * 100) / 100;
            const variance = Math.round((actualHours - contracted) * 100) / 100;

            return {
                employee_id: emp.id,
                full_name: emp.full_name,
                department: emp.department,
                contracted_hours: contracted,
                rostered_hours: rosteredHours,
                actual_hours: actualHours,
                variance_hours: variance,
                status: sub ? sub.status : 'Draft',
                submission_id: sub ? sub.id : null,
                submitted_at: sub ? sub.submitted_at : null,
                reviewed_at: sub ? sub.reviewed_at : null,
                reviewed_by: sub ? sub.reviewed_by : null,
                rejection_reason: sub ? sub.rejection_reason : null
            };
        });

        res.json({ success: true, data: list });
    } catch (err: any) {
        console.error('[SUBMISSIONS GET ALL ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to retrieve timesheet submissions.' } });
    }
});

/**
 * POST /api/submissions/review
 * Move status to 'Under Review'
 */
router.post('/review', requireAuth, requireTenantContext, requireAnyBranchPermission(Permission.TIMESHEET_REVIEW), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const { submission_id, employee_id, start_date } = req.body;

        if (start_date) {
            const lockRes = await query('SELECT timesheet_locked FROM fortnight_locks WHERE org_id = $1 AND start_date = $2', [orgId, start_date]);
            if (lockRes.rows[0]?.timesheet_locked) {
                return res.status(403).json({ success: false, error: { code: 'TIMESHEET_LOCKED', message: 'Timesheet is locked for this fortnight.' } });
            }
        }

        let targetId = submission_id;
        if (!targetId && employee_id && start_date) {
            const subRes = await query('SELECT id FROM timesheet_submissions WHERE org_id = $1 AND employee_id = $2 AND start_date = $3', [orgId, employee_id, start_date]);
            if (subRes.rows.length > 0) {
                targetId = subRes.rows[0].id;
            }
        }

        if (!targetId) {
            return res.status(400).json({ success: false, error: { message: 'Missing submission identification or submission does not exist.' } });
        }

        const subCheck = await query('SELECT id, status, employee_id FROM timesheet_submissions WHERE id = $1 AND org_id = $2', [targetId, orgId]);
        if (subCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Submission not found in your organisation.' } });
        }

        if (!(await checkEmployeeTimesheetPermission(req, subCheck.rows[0].employee_id, orgId, Permission.TIMESHEET_REVIEW))) {
            return res.status(403).json({
                success: false,
                error: { code: 'LOCATION_FORBIDDEN', message: 'You do not have permission to manage timesheets for employees in another location.' }
            });
        }

        const curStatus = subCheck.rows[0].status;
        if (['Approved', 'Locked'].includes(curStatus)) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'TIMESHEET_ALREADY_APPROVED',
                    message: 'Approved timesheets cannot be moved to Under Review.'
                }
            });
        }
        if (!['Submitted', 'Under Review'].includes(curStatus)) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_TRANSITION',
                    message: `Cannot review timesheet with status '${curStatus}'. Only submitted timesheets can be reviewed.`
                }
            });
        }

        await query(`
            UPDATE timesheet_submissions
            SET status = 'Under Review'
            WHERE id = $1 AND org_id = $2 AND status IN ('Submitted', 'Under Review')
        `, [targetId, orgId]);

        res.json({ success: true, data: { status: 'Under Review' } });
    } catch (err: any) {
        console.error('[REVIEW SUBMISSION ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to update submission status.' } });
    }
});

/**
 * POST /api/submissions/approve
 * Move status to 'Approved'
 */
router.post('/approve', requireAuth, requireTenantContext, requireAnyBranchPermission(Permission.TIMESHEET_APPROVE), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const userId = req.user?.id!;
        const { submission_id, employee_id, start_date } = req.body;

        if (start_date) {
            const lockRes = await query('SELECT timesheet_locked FROM fortnight_locks WHERE org_id = $1 AND start_date = $2', [orgId, start_date]);
            if (lockRes.rows[0]?.timesheet_locked) {
                return res.status(403).json({ success: false, error: { code: 'TIMESHEET_LOCKED', message: 'Timesheet is locked for this fortnight.' } });
            }
        }

        let targetId = submission_id;
        if (!targetId && employee_id && start_date) {
            // Validate employee belongs to caller's organisation
            const empCheck = await query('SELECT id FROM employees WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL', [employee_id, orgId]);
            if (empCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: { message: 'Employee not found in your organisation.' } });
            }
            if (!(await checkEmployeeTimesheetPermission(req, employee_id, orgId, Permission.TIMESHEET_APPROVE))) {
                return res.status(403).json({ success: false, error: { code: 'LOCATION_FORBIDDEN', message: 'You do not have permission to manage timesheets for employees in another location.' } });
            }

            const subRes = await query('SELECT id, status FROM timesheet_submissions WHERE org_id = $1 AND employee_id = $2 AND start_date = $3', [orgId, employee_id, start_date]);
            if (subRes.rows.length > 0) {
                targetId = subRes.rows[0].id;
            } else {
                return res.status(400).json({
                    success: false,
                    error: { code: 'INVALID_TRANSITION', message: 'Cannot approve timesheet: Timesheet has not been submitted.' }
                });
            }
        }

        if (!targetId) {
            return res.status(400).json({ success: false, error: { message: 'Missing submission identification or no submission exists.' } });
        }

        const subCheck = await query('SELECT id, status, employee_id FROM timesheet_submissions WHERE id = $1 AND org_id = $2', [targetId, orgId]);
        if (subCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Submission not found in your organisation.' } });
        }
        if (!(await checkEmployeeTimesheetPermission(req, subCheck.rows[0].employee_id, orgId, Permission.TIMESHEET_APPROVE))) {
            return res.status(403).json({ success: false, error: { code: 'LOCATION_FORBIDDEN', message: 'You do not have permission to manage timesheets for employees in another location.' } });
        }

        const curStatus = subCheck.rows[0].status;
        if (['Approved', 'Locked'].includes(curStatus)) {
            return res.status(400).json({
                success: false,
                error: { code: 'ALREADY_APPROVED', message: 'This timesheet has already been approved.' }
            });
        }
        if (!['Submitted', 'Under Review'].includes(curStatus)) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_TRANSITION',
                    message: `Cannot approve timesheet with status '${curStatus}'. Timesheet must be submitted before approval.`
                }
            });
        }

        const updateRes = await query(`
            UPDATE timesheet_submissions
            SET status = 'Approved', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = NULL
            WHERE id = $2 AND org_id = $3 AND status IN ('Submitted', 'Under Review')
            RETURNING id
        `, [userId, targetId, orgId]);

        if (updateRes.rows.length === 0) {
            return res.status(409).json({
                success: false,
                error: { code: 'CONCURRENT_MODIFICATION', message: 'Timesheet status was modified concurrently.' }
            });
        }

        // Audit log
        await query(`
            INSERT INTO audit_logs (id, org_id, actor_id, action, entity_type, entity_id, details, timestamp)
            VALUES ($1, $2, $3, 'TIMESHEET_APPROVED', 'timesheet_submissions', $4, $5, NOW())
        `, [
            crypto.randomUUID(),
            orgId,
            userId,
            targetId,
            JSON.stringify({ status: 'Approved', approved_by: req.user?.email })
        ]);

        res.json({ success: true, data: { id: targetId, status: 'Approved' } });
    } catch (err: any) {
        console.error('[APPROVE SUBMISSION ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to approve timesheet submission.' } });
    }
});

/**
 * POST /api/submissions/reject
 * Reject submission with mandatory feedback reason
 */
router.post('/reject', requireAuth, requireTenantContext, requireAnyBranchPermission(Permission.TIMESHEET_REVIEW), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const userId = req.user?.id!;
        const { submission_id, employee_id, start_date } = req.body;
        const rawReason = req.body.reason || req.body.rejection_reason;

        if (!rawReason || !rawReason.trim()) {
            return res.status(400).json({ success: false, error: { message: 'A rejection reason is required.' } });
        }
        const reason = rawReason.trim();

        if (start_date) {
            const lockRes = await query('SELECT timesheet_locked FROM fortnight_locks WHERE org_id = $1 AND start_date = $2', [orgId, start_date]);
            if (lockRes.rows[0]?.timesheet_locked) {
                return res.status(403).json({ success: false, error: { code: 'TIMESHEET_LOCKED', message: 'Timesheet is locked for this fortnight.' } });
            }
        }

        let targetId = submission_id;
        if (!targetId && employee_id && start_date) {
            // Validate employee belongs to caller's organisation
            const empCheck = await query('SELECT id FROM employees WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL', [employee_id, orgId]);
            if (empCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: { message: 'Employee not found in your organisation.' } });
            }
            if (!(await checkSubmissionEmployeeLocation(req, employee_id, orgId))) {
                return res.status(403).json({ success: false, error: { code: 'LOCATION_FORBIDDEN', message: 'You do not have permission to manage timesheets for employees in another location.' } });
            }

            const subRes = await query('SELECT id, status FROM timesheet_submissions WHERE org_id = $1 AND employee_id = $2 AND start_date = $3', [orgId, employee_id, start_date]);
            if (subRes.rows.length > 0) {
                targetId = subRes.rows[0].id;
            } else {
                return res.status(400).json({
                    success: false,
                    error: { code: 'INVALID_TRANSITION', message: 'Cannot reject timesheet: Timesheet has not been submitted.' }
                });
            }
        }

        if (!targetId) {
            return res.status(400).json({ success: false, error: { message: 'Missing submission identification or no submission exists to reject.' } });
        }

        const subCheck = await query('SELECT id, status, employee_id FROM timesheet_submissions WHERE id = $1 AND org_id = $2', [targetId, orgId]);
        if (subCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Submission not found in your organisation.' } });
        }
        if (!(await checkSubmissionEmployeeLocation(req, subCheck.rows[0].employee_id, orgId))) {
            return res.status(403).json({ success: false, error: { code: 'LOCATION_FORBIDDEN', message: 'You do not have permission to manage timesheets for employees in another location.' } });
        }

        const curStatus = subCheck.rows[0].status;
        if (['Approved', 'Locked'].includes(curStatus)) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'TIMESHEET_ALREADY_APPROVED',
                    message: 'This timesheet has already been approved and finalized. It cannot be rejected.'
                }
            });
        }
        if (!['Submitted', 'Under Review'].includes(curStatus)) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_TRANSITION',
                    message: `Cannot reject timesheet with status '${curStatus}'. Only submitted timesheets can be rejected.`
                }
            });
        }

        const updateRes = await query(`
            UPDATE timesheet_submissions
            SET status = 'Rejected', rejection_reason = $1, reviewed_by = $2, reviewed_at = NOW()
            WHERE id = $3 AND org_id = $4 AND status IN ('Submitted', 'Under Review')
            RETURNING id
        `, [reason, userId, targetId, orgId]);

        if (updateRes.rows.length === 0) {
            return res.status(409).json({
                success: false,
                error: { code: 'CONCURRENT_MODIFICATION', message: 'Timesheet status was modified concurrently.' }
            });
        }

        // Audit log
        await query(`
            INSERT INTO audit_logs (id, org_id, actor_id, action, entity_type, entity_id, details, timestamp)
            VALUES ($1, $2, $3, 'TIMESHEET_REJECTED', 'timesheet_submissions', $4, $5, NOW())
        `, [
            crypto.randomUUID(),
            orgId,
            userId,
            targetId,
            JSON.stringify({ status: 'Rejected', reason, rejected_by: req.user?.email })
        ]);

        res.json({ success: true, data: { id: targetId, status: 'Rejected', rejection_reason: reason } });
    } catch (err: any) {
        console.error('[REJECT SUBMISSION ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to reject timesheet submission.' } });
    }
});

/**
 * POST /api/submissions/bulk-approve
 * Manager / Admin approves multiple employee timesheets in one operation
 */
router.post('/bulk-approve', requireAuth, requireTenantContext, requireAnyBranchPermission(Permission.TIMESHEET_APPROVE), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const userId = req.user?.id!;
        let { start_date, employee_ids, submission_ids } = req.body;

        if (!start_date) {
            return res.status(400).json({ success: false, error: { message: 'start_date is required.' } });
        }

        // If submission_ids is provided, resolve them to employee_ids belonging to caller's org
        if (Array.isArray(submission_ids) && submission_ids.length > 0 && (!employee_ids || employee_ids.length === 0)) {
            const subPlaceholders = submission_ids.map((_, i) => `$${i + 2}`).join(', ');
            const subEmpRes = await query(
                `SELECT employee_id FROM timesheet_submissions WHERE org_id = $1 AND id IN (${subPlaceholders})`,
                [orgId, ...submission_ids]
            );
            employee_ids = subEmpRes.rows.map((r: any) => r.employee_id);
        }

        if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
            return res.status(400).json({ success: false, error: { message: 'start_date and non-empty employee_ids or submission_ids array are required.' } });
        }

        // Check if timesheet is locked for this fortnight
        const lockRes = await query('SELECT timesheet_locked FROM fortnight_locks WHERE org_id = $1 AND start_date = $2', [orgId, start_date]);
        if (lockRes.rows[0]?.timesheet_locked) {
            return res.status(403).json({ success: false, error: { code: 'TIMESHEET_LOCKED', message: 'Timesheet is locked for this fortnight.' } });
        }

        // Verify that all employees belong to caller's org and location (filter out any foreign ids for tenant and location isolation)
        let empCheck;
        try {
            empCheck = await query(
                `SELECT id FROM employees WHERE org_id = $1 AND id IN (${employee_ids.map((_: any, i: number) => `$${i + 2}`).join(', ')}) AND deleted_at IS NULL`,
                [orgId, ...employee_ids]
            );
        } catch {
            empCheck = await query(
                `SELECT id FROM employees WHERE org_id = $1 AND id IN (${employee_ids.map((_: any, i: number) => `$${i + 2}`).join(', ')}) AND deleted_at IS NULL`,
                [orgId, ...employee_ids]
            );
        }

        // Enforce the timesheet branch boundary per employee.
        const validEmployees: string[] = [];
        for (const row of empCheck.rows) {
            if (await checkEmployeeTimesheetPermission(req, row.id, orgId, Permission.TIMESHEET_APPROVE)) {
                validEmployees.push(row.id);
            }
        }

        if (validEmployees.length === 0) {
            return res.status(404).json({
                success: false,
                error: { code: 'INVALID_EMPLOYEE', message: 'No selected employees belong to your organisation.' }
            });
        }

        const approvedEmployees: string[] = [];
        for (const empId of validEmployees) {
            const subRes = await query(
                `SELECT id, status FROM timesheet_submissions 
                 WHERE org_id = $1 AND employee_id = $2 AND start_date = $3 AND status IN ('Submitted', 'Under Review')`,
                [orgId, empId, start_date]
            );

            if (subRes.rows.length === 0) {
                // Skip employees without a submitted timesheet
                continue;
            }

            const subId = subRes.rows[0].id;
            const updateRes = await query(
                `UPDATE timesheet_submissions
                 SET status = 'Approved', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = NULL
                 WHERE id = $2 AND org_id = $3 AND status IN ('Submitted', 'Under Review')
                 RETURNING id`,
                [userId, subId, orgId]
            );
            if (updateRes.rows.length > 0) {
                approvedEmployees.push(empId);
            }
        }

        if (approvedEmployees.length === 0) {
            return res.status(400).json({
                success: false,
                error: { code: 'NO_SUBMITTED_TIMESHEETS', message: 'No selected employees have submitted timesheets ready for approval.' }
            });
        }

        // Audit log
        await query(
            `INSERT INTO audit_logs (id, org_id, actor_id, action, entity_type, entity_id, details, timestamp)
             VALUES ($1, $2, $3, 'TIMESHEET_BULK_APPROVED', 'timesheet_submissions', NULL, $4, NOW())`,
            [
                crypto.randomUUID(),
                orgId,
                userId,
                JSON.stringify({ start_date, approved_count: approvedEmployees.length, employee_ids: approvedEmployees, approved_by: req.user?.email })
            ]
        );

        res.json({
            success: true,
            data: {
                start_date,
                approved_count: approvedEmployees.length,
                approved_employees: approvedEmployees
            }
        });
    } catch (err: any) {
        console.error('[BULK APPROVE ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to bulk-approve timesheets.' } });
    }
});

export default router;
