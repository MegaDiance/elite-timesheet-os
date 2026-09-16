import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { requireAuth, requireTenantContext, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

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

        // Check if timesheet is locked for this fortnight
        const lockRes = await query('SELECT timesheet_locked FROM fortnight_locks WHERE org_id = $1 AND start_date = $2', [orgId, start_date]);
        if (lockRes.rows[0]?.timesheet_locked) {
            return res.status(403).json({ success: false, error: { code: 'TIMESHEET_LOCKED', message: 'Timesheet is locked for this fortnight.' } });
        }

        const isManager = ['Admin', 'Company Admin', 'Platform Admin', 'Manager'].includes(req.user?.role || '');

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
        }

        // Check if submission already exists
        const existing = await query(
            'SELECT id, status FROM timesheet_submissions WHERE org_id = $1 AND employee_id = $2 AND start_date = $3',
            [orgId, employee_id, start_date]
        );

        let subId: string;
        if (existing.rows.length > 0) {
            subId = existing.rows[0].id;
            await query(`
                UPDATE timesheet_submissions
                SET status = 'Submitted', submitted_at = NOW(), rejection_reason = NULL
                WHERE id = $1
            `, [subId]);
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
router.get('/', requireAuth, requireTenantContext, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const startDate = req.query.start_date as string;

        if (!startDate) {
            return res.status(400).json({ success: false, error: { message: 'start_date query param required' } });
        }

        const employeesRes = await query(
            'SELECT id, full_name, department, contracted_hours FROM employees WHERE org_id = $1 AND is_active = true AND deleted_at IS NULL ORDER BY full_name ASC',
            [orgId]
        );

        const subsRes = await query(
            'SELECT * FROM timesheet_submissions WHERE org_id = $1 AND start_date = $2',
            [orgId, startDate]
        );
        const subMap = new Map<string, any>();
        subsRes.rows.forEach((s: any) => subMap.set(s.employee_id, s));

        const data = employeesRes.rows.map((emp: any) => {
            const sub = subMap.get(emp.id);
            return {
                employee_id: emp.id,
                full_name: emp.full_name,
                department: emp.department,
                contracted_hours: Number(emp.contracted_hours || 76),
                status: sub ? sub.status : 'Draft',
                submission_id: sub ? sub.id : null,
                submitted_at: sub ? sub.submitted_at : null,
                reviewed_at: sub ? sub.reviewed_at : null,
                reviewed_by: sub ? sub.reviewed_by : null,
                rejection_reason: sub ? sub.rejection_reason : null
            };
        });

        res.json({ success: true, data });
    } catch (err: any) {
        console.error('[GET SUBMISSIONS ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to retrieve timesheet submissions.' } });
    }
});

/**
 * POST /api/submissions/review
 * Move status to 'Under Review'
 */
router.post('/review', requireAuth, requireTenantContext, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const { submission_id, employee_id, start_date } = req.body;

        let targetId = submission_id;
        if (!targetId && employee_id && start_date) {
            const subRes = await query('SELECT id FROM timesheet_submissions WHERE org_id = $1 AND employee_id = $2 AND start_date = $3', [orgId, employee_id, start_date]);
            if (subRes.rows.length > 0) {
                targetId = subRes.rows[0].id;
            }
        }

        if (!targetId) {
            return res.status(400).json({ success: false, error: { message: 'Missing submission identification' } });
        }

        await query(`UPDATE timesheet_submissions SET status = 'Under Review' WHERE id = $1 AND org_id = $2`, [targetId, orgId]);

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
router.post('/approve', requireAuth, requireTenantContext, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const userId = req.user?.id!;
        const { submission_id, employee_id, start_date } = req.body;

        let targetId = submission_id;
        if (!targetId && employee_id && start_date) {
            const subRes = await query('SELECT id FROM timesheet_submissions WHERE org_id = $1 AND employee_id = $2 AND start_date = $3', [orgId, employee_id, start_date]);
            if (subRes.rows.length > 0) {
                targetId = subRes.rows[0].id;
            } else {
                targetId = crypto.randomUUID();
                await query(`
                    INSERT INTO timesheet_submissions (id, org_id, employee_id, start_date, status, submitted_at)
                    VALUES ($1, $2, $3, $4, 'Submitted', NOW())
                `, [targetId, orgId, employee_id, start_date]);
            }
        }

        if (!targetId) {
            return res.status(400).json({ success: false, error: { message: 'Missing submission identification' } });
        }

        await query(`
            UPDATE timesheet_submissions
            SET status = 'Approved', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = NULL
            WHERE id = $2 AND org_id = $3
        `, [userId, targetId, orgId]);

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
router.post('/reject', requireAuth, requireTenantContext, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const userId = req.user?.id!;
        const { submission_id, employee_id, start_date, reason } = req.body;

        if (!reason || !reason.trim()) {
            return res.status(400).json({ success: false, error: { message: 'A rejection reason is required.' } });
        }

        let targetId = submission_id;
        if (!targetId && employee_id && start_date) {
            const subRes = await query('SELECT id FROM timesheet_submissions WHERE org_id = $1 AND employee_id = $2 AND start_date = $3', [orgId, employee_id, start_date]);
            if (subRes.rows.length > 0) {
                targetId = subRes.rows[0].id;
            } else {
                targetId = crypto.randomUUID();
                await query(`
                    INSERT INTO timesheet_submissions (id, org_id, employee_id, start_date, status, submitted_at)
                    VALUES ($1, $2, $3, $4, 'Submitted', NOW())
                `, [targetId, orgId, employee_id, start_date]);
            }
        }

        if (!targetId) {
            return res.status(400).json({ success: false, error: { message: 'Missing submission identification' } });
        }

        await query(`
            UPDATE timesheet_submissions
            SET status = 'Rejected', rejection_reason = $1, reviewed_by = $2, reviewed_at = NOW()
            WHERE id = $3 AND org_id = $4
        `, [reason.trim(), userId, targetId, orgId]);

        // Audit log
        await query(`
            INSERT INTO audit_logs (id, org_id, actor_id, action, entity_type, entity_id, details, timestamp)
            VALUES ($1, $2, $3, 'TIMESHEET_REJECTED', 'timesheet_submissions', $4, $5, NOW())
        `, [
            crypto.randomUUID(),
            orgId,
            userId,
            targetId,
            JSON.stringify({ status: 'Rejected', reason: reason.trim(), rejected_by: req.user?.email })
        ]);

        res.json({ success: true, data: { id: targetId, status: 'Rejected', rejection_reason: reason.trim() } });
    } catch (err: any) {
        console.error('[REJECT SUBMISSION ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to reject timesheet submission.' } });
    }
});

export default router;
