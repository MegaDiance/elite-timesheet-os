import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { requireAuth, requireTenantContext, requireRole, AuthRequest } from '../middleware/auth';
import { calcHours, parseSmartTime } from '../services/timeParser';
import { sendTransactionalEmail, buildEmployeeInviteEmailTemplate } from '../services/emailService';
import { revokeAllUserSessions } from '../services/sessionService';

const router = Router();
router.use(requireAuth, requireTenantContext);

// Get all employees for the organization
router.get('/', requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const includeInactive = req.query.include_inactive === 'true';

        const sql = includeInactive
            ? `SELECT e.*, u.id as user_account_id, u.email as user_email, u.role as user_role, u.is_active as user_is_active, 
               (u.password_hash = 'PENDING_SETUP') as is_pending_setup 
               FROM employees e LEFT JOIN users u ON e.user_id = u.id WHERE e.org_id = $1`
            : `SELECT e.*, u.id as user_account_id, u.email as user_email, u.role as user_role, u.is_active as user_is_active, 
               (u.password_hash = 'PENDING_SETUP') as is_pending_setup 
               FROM employees e LEFT JOIN users u ON e.user_id = u.id WHERE e.org_id = $1 AND e.is_active = true AND e.deleted_at IS NULL`;

        const result = await query(sql, [orgId]);
        const emps = result.rows;

        for (const emp of emps) {
            const tmplResult = await query('SELECT * FROM roster_templates WHERE employee_id = $1 ORDER BY day_index ASC', [emp.id]);
            emp.template = tmplResult.rows;
            emp.status = emp.deleted_at ? 'Deleted' : (emp.is_pending_setup ? 'Pending Setup' : (emp.is_active ? 'Active' : 'Inactive'));
        }

        res.json({ success: true, data: emps });
    } catch (err: any) {
        console.error('[EMPLOYEES GET ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve employees list.' } });
    }
});

router.post('/', requireAuth, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { full_name, department, email, phone, contracted_hours, create_account, role } = req.body;

        if (!full_name) {
            return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'full_name is required' } });
        }

        const empId = crypto.randomUUID();
        let userId: string | null = req.body.user_id || null;
        let token: string | null = null;

        if (create_account && email) {
            const cleanEmail = email.trim().toLowerCase();
            const existingUser = await query('SELECT id FROM users WHERE LOWER(email) = $1', [cleanEmail]);
            if (existingUser.rows.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'EMAIL_IN_USE', message: `An account with email ${cleanEmail} already exists.` }
                });
            }

            userId = crypto.randomUUID();
            const callerRole = req.user?.role || 'Employee';
            let userRole = role || 'Employee';
            if (!['Company Admin', 'Platform Admin'].includes(callerRole) && userRole !== 'Employee') {
                userRole = 'Employee';
            }

            await query(
                `INSERT INTO users (id, org_id, email, password_hash, role, is_active) VALUES ($1, $2, $3, $4, $5, $6)`,
                [userId, orgId, cleanEmail, 'PENDING_SETUP', userRole, false]
            );

            await query(
                `INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ($1, $2, $3, $4)`,
                [crypto.randomUUID(), orgId, userId, userRole]
            );

            token = crypto.randomBytes(32).toString('hex');
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            await query('INSERT INTO invitation_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, userId, expiresAt]);
        } else if (userId) {
            // Explicit user_id supplied: verify that the user is a member of this tenant
            const memberCheck = await query('SELECT id FROM organisation_members WHERE organisation_id = $1 AND user_id = $2', [orgId, userId]);
            if (memberCheck.rows.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'INVALID_USER_MEMBERSHIP', message: 'Provided user does not belong to this organisation.' }
                });
            }
        } else if (email) {
            // Find existing user if already a registered member of this organization
            const cleanEmail = email.trim().toLowerCase();
            const existingUser = await query('SELECT id FROM users WHERE LOWER(email) = $1', [cleanEmail]);
            if (existingUser.rows.length > 0) {
                const candUserId = existingUser.rows[0].id;
                const memberCheck = await query('SELECT id FROM organisation_members WHERE organisation_id = $1 AND user_id = $2', [orgId, candUserId]);
                if (memberCheck.rows.length > 0) {
                    userId = candUserId;
                }
            }
        }

        await query(
            `INSERT INTO employees (id, org_id, user_id, full_name, department, email, phone, contracted_hours)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [empId, orgId, userId, full_name, department || null, email || null, phone || null, contracted_hours || 76]
        );

        await query(
            `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_id, details) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [crypto.randomUUID(), orgId, new Date().toISOString(), req.user?.id, 'CREATED', empId, `Created employee ${full_name}`]
        );

        let inviteLink = null;
        let emailSent = false;
        let emailProvider = 'none';

        if (create_account && email && token) {
            const origin = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:3000';
            inviteLink = `${origin}/accept-invite?token=${token}`;

            const template = buildEmployeeInviteEmailTemplate({
                inviteLink,
                employeeName: full_name,
                recipientEmail: email
            });

            const deliveryResult = await sendTransactionalEmail({
                to: email,
                subject: template.subject,
                html: template.html,
                text: template.text
            });

            emailSent = deliveryResult.success;
            emailProvider = deliveryResult.provider;

            await query(
                `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_id, details) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [crypto.randomUUID(), orgId, new Date().toISOString(), req.user?.id, emailSent ? 'INVITE_SENT' : 'INVITE_FAILED', empId, `Dispatched account invitation to ${email} (provider: ${emailProvider})`]
            );
        }

        res.json({ 
            success: true, 
            data: { 
                id: empId, 
                user_id: userId, 
                inviteLink, 
                email_sent: emailSent, 
                provider: emailProvider,
                message: emailSent ? `Account invitation emailed to ${email}` : (create_account ? 'Account created but email delivery failed' : undefined)
            } 
        });
    } catch (err: any) {
        console.error('[EMPLOYEES CREATE ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create employee profile.' } });
    }
});

router.put('/:id', requireAuth, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const empId = req.params.id;
        const { full_name, department, email, phone, contracted_hours, create_account, role } = req.body;

        const empCheck = await query('SELECT * FROM employees WHERE id = $1 AND org_id = $2', [empId, orgId]);
        if (empCheck.rows.length === 0) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found' } });
        
        const emp = empCheck.rows[0];
        let userId = emp.user_id;
        let inviteLink = null;
        let emailSent = false;
        let emailProvider = 'none';

        if (create_account && !userId) {
            if (!email) {
                return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Email is required to create a user account' } });
            }
            const cleanEmail = email.trim().toLowerCase();
            const existingUser = await query('SELECT id FROM users WHERE LOWER(email) = $1', [cleanEmail]);
            if (existingUser.rows.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'EMAIL_IN_USE', message: `An account with email ${cleanEmail} already exists.` }
                });
            }

            userId = crypto.randomUUID();
            const callerRole = req.user?.role || 'Employee';
            let userRole = role || 'Employee';
            if (!['Company Admin', 'Platform Admin'].includes(callerRole) && userRole !== 'Employee') {
                userRole = 'Employee';
            }

            await query(
                `INSERT INTO users (id, org_id, email, password_hash, role, is_active) VALUES ($1, $2, $3, $4, $5, $6)`,
                [userId, orgId, cleanEmail, 'PENDING_SETUP', userRole, false]
            );

            await query(
                `INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ($1, $2, $3, $4)`,
                [crypto.randomUUID(), orgId, userId, userRole]
            );

            const token = crypto.randomBytes(32).toString('hex');
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            await query('INSERT INTO invitation_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, userId, expiresAt]);

            const origin = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:3000';
            inviteLink = `${origin}/accept-invite?token=${token}`;

            const template = buildEmployeeInviteEmailTemplate({
                inviteLink,
                employeeName: full_name || emp.full_name,
                recipientEmail: email
            });

            const deliveryResult = await sendTransactionalEmail({
                to: email,
                subject: template.subject,
                html: template.html,
                text: template.text
            });

            emailSent = deliveryResult.success;
            emailProvider = deliveryResult.provider;
        } else if (req.body.user_id && req.body.user_id !== emp.user_id) {
            // Explicit user_id supplied: verify that the user is a member of this tenant
            const memberCheck = await query('SELECT id FROM organisation_members WHERE organisation_id = $1 AND user_id = $2', [orgId, req.body.user_id]);
            if (memberCheck.rows.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'INVALID_USER_MEMBERSHIP', message: 'Provided user does not belong to this organisation.' }
                });
            }
            userId = req.body.user_id;
        }

        await query(
            `UPDATE employees SET full_name = $1, department = $2, email = $3, phone = $4, contracted_hours = $5, user_id = $6 WHERE id = $7 AND org_id = $8`,
            [full_name, department, email, phone, contracted_hours, userId, empId, orgId]
        );

        await query(
            `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_id, details) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [crypto.randomUUID(), orgId, new Date().toISOString(), req.user?.id, 'UPDATED', empId, `Updated employee ${full_name}`]
        );

        res.json({ success: true, data: { inviteLink, email_sent: emailSent, provider: emailProvider } });
    } catch (err: any) {
        console.error('[EMPLOYEES UPDATE ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update employee details.' } });
    }
});

router.post('/:id/deactivate', requireAuth, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const empId = req.params.id;
        const empRes = await query('SELECT user_id FROM employees WHERE id = $1 AND org_id = $2', [empId, orgId]);
        await query('UPDATE employees SET is_active = false, deleted_at = $1 WHERE id = $2 AND org_id = $3', [new Date().toISOString(), empId, orgId]);
        if (empRes.rows.length > 0 && empRes.rows[0].user_id) {
            const userId = empRes.rows[0].user_id;
            // 1. Remove user membership from this organisation
            await query('DELETE FROM organisation_members WHERE user_id = $1 AND organisation_id = $2', [userId, orgId]);

            // 2. Revoke active sessions for this user in this tenant
            await query('UPDATE sessions SET is_active = false, revoked_at = NOW() WHERE user_id = $1 AND org_id = $2', [userId, orgId]);

            // 3. Only deactivate the global user record and revoke all sessions if no memberships remain anywhere
            const remainingMemberships = await query('SELECT id FROM organisation_members WHERE user_id = $1', [userId]);
            if (remainingMemberships.rows.length === 0) {
                await query('UPDATE users SET is_active = false WHERE id = $1', [userId]);
                await revokeAllUserSessions(userId);
            }
        }
        await query(`INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_id, details) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [crypto.randomUUID(), orgId, new Date().toISOString(), req.user?.id, 'DEACTIVATED', empId, `Deactivated employee ${empId}`]);
        res.json({ success: true });
    } catch (err: any) {
        console.error('[EMPLOYEES DEACTIVATE ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to deactivate employee.' } });
    }
});

router.post('/:id/reactivate', requireAuth, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const empId = req.params.id;
        await query('UPDATE employees SET is_active = true, deleted_at = NULL WHERE id = $1 AND org_id = $2', [empId, orgId]);
        await query(`INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_id, details) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [crypto.randomUUID(), orgId, new Date().toISOString(), req.user?.id, 'RESTORED', empId, `Restored employee ${empId}`]);
        res.json({ success: true });
    } catch (err: any) {
        console.error('[EMPLOYEES REACTIVATE ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to reactivate employee.' } });
    }
});

router.delete('/:id', requireAuth, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const empId = req.params.id;

        const empCheck = await query('SELECT * FROM employees WHERE id = $1 AND org_id = $2', [empId, orgId]);
        if (empCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found' } });
        }
        const emp = empCheck.rows[0];

        // Guard: Cannot delete employee with approved/locked historical payroll records
        const approvedCheck = await query(
            "SELECT id FROM timesheet_submissions WHERE employee_id = $1 AND org_id = $2 AND status IN ('Approved', 'Locked') LIMIT 1",
            [empId, orgId]
        );
        if (approvedCheck.rows.length > 0) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'EMPLOYEE_HAS_APPROVED_PAYROLL',
                    message: 'Cannot permanently delete an employee with approved timesheets or payroll history. Deactivate the employee instead.'
                }
            });
        }

        // Clean up linked user account if exists (scoped to tenant!)
        if (emp.user_id && emp.user_id !== req.user?.id) {
            await query('DELETE FROM organisation_members WHERE user_id = $1 AND organisation_id = $2', [emp.user_id, orgId]);
            // Only remove user credential if no other org memberships exist
            const remainingMemberships = await query('SELECT id FROM organisation_members WHERE user_id = $1', [emp.user_id]);
            if (remainingMemberships.rows.length === 0) {
                await query('DELETE FROM invitation_tokens WHERE user_id = $1', [emp.user_id]);
                await query('DELETE FROM reset_tokens WHERE user_id = $1', [emp.user_id]);
                await query('DELETE FROM two_factor_codes WHERE user_id = $1', [emp.user_id]);
                await query('DELETE FROM users WHERE id = $1 AND role = \'Employee\'', [emp.user_id]);
            }
        }

        // Clean up roster templates, records, submissions (scoped to orgId)
        await query('DELETE FROM roster_templates WHERE employee_id = $1', [empId]);
        await query('DELETE FROM shift_segments WHERE record_id IN (SELECT id FROM daily_records WHERE employee_id = $1 AND org_id = $2)', [empId, orgId]);
        await query('DELETE FROM daily_records WHERE employee_id = $1 AND org_id = $2', [empId, orgId]);
        await query('DELETE FROM timesheet_submissions WHERE employee_id = $1 AND org_id = $2', [empId, orgId]);
        await query('DELETE FROM leave_requests WHERE employee_id = $1 AND org_id = $2', [empId, orgId]);

        // Delete employee row
        await query('DELETE FROM employees WHERE id = $1 AND org_id = $2', [empId, orgId]);

        await query(`INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_id, details) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [crypto.randomUUID(), orgId, new Date().toISOString(), req.user?.id, 'PERMANENTLY_DELETED', empId, `Permanently deleted employee ${emp.full_name}`]);
        res.json({ success: true });
    } catch (err: any) {
        console.error('[EMPLOYEES DELETE ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete employee.' } });
    }
});

router.post('/:id/templates', requireAuth, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const empId = req.params.id;
        const { templates } = req.body; // Array of template objects

        const empCheck = await query('SELECT * FROM employees WHERE id = $1 AND org_id = $2', [empId, orgId]);
        if (empCheck.rows.length === 0) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found' } });

        await query('DELETE FROM roster_templates WHERE employee_id = $1', [empId]);

        let orgSettings = { break_mins_weekday: 30, break_mins_weekend: 0, break_threshold_hours: 6 };
        try {
            const orgRes = await query(
                'SELECT break_mins_weekday, break_mins_weekend, break_threshold_hours FROM organisations WHERE id = $1',
                [orgId]
            );
            if (orgRes.rows[0]) {
                orgSettings = {
                    break_mins_weekday: orgRes.rows[0].break_mins_weekday ?? 30,
                    break_mins_weekend: orgRes.rows[0].break_mins_weekend ?? 0,
                    break_threshold_hours: orgRes.rows[0].break_threshold_hours ?? 6
                };
            }
        } catch {}

        for (const t of templates) {
            const rIn = t.roster_in ? (parseSmartTime(t.roster_in) || null) : null;
            const rOut = t.roster_out ? (parseSmartTime(t.roster_out) || null) : null;
            const isWeekend = (t.day_index % 7 === 0 || t.day_index % 7 === 6);
            const breakOptions = {
                breakMins: isWeekend ? Number(orgSettings.break_mins_weekend) : Number(orgSettings.break_mins_weekday),
                breakThresholdHours: Number(orgSettings.break_threshold_hours)
            };
            const h = (rIn && rOut) 
                ? calcHours(rIn, rOut, breakOptions) 
                : Math.max(0, Math.round(Number(t.roster_hours || 0) * 100) / 100);

            await query(`
                INSERT INTO roster_templates (id, employee_id, day_index, segment_type, roster_in, roster_out, roster_hours)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [crypto.randomUUID(), empId, t.day_index, t.segment_type || 'WORK', rIn, rOut, h]);
        }

        res.json({ success: true });
    } catch (err: any) {
        console.error('[EMPLOYEES TEMPLATES ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update roster template.' } });
    }
});

router.post('/:id/send-invitation', requireAuth, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const empId = req.params.id;

        const empCheck = await query(`
            SELECT e.*, u.id as user_account_id, u.email as user_email, u.password_hash 
            FROM employees e 
            LEFT JOIN users u ON e.user_id = u.id 
            WHERE e.id = $1 AND e.org_id = $2
        `, [empId, orgId]);

        if (empCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee not found' } });
        }

        let emp = empCheck.rows[0];
        let userAccountId = emp.user_account_id;
        let recipientEmail = emp.user_email || emp.email;

        if (!userAccountId) {
            if (!recipientEmail) {
                return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Employee has no email address assigned' } });
            }
            userAccountId = crypto.randomUUID();
            await query(
                `INSERT INTO users (id, org_id, email, password_hash, role, is_active) VALUES ($1, $2, $3, $4, $5, $6)`,
                [userAccountId, orgId, recipientEmail, 'PENDING_SETUP', 'Employee', false]
            );
            await query(`UPDATE employees SET user_id = $1 WHERE id = $2`, [userAccountId, empId]);
        } else if (emp.password_hash !== 'PENDING_SETUP') {
            return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Employee account is already setup' } });
        }

        // Delete any existing tokens for this user to invalidate them
        await query('DELETE FROM invitation_tokens WHERE user_id = $1', [userAccountId]);

        // Generate new token
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        
        await query(
            'INSERT INTO invitation_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', 
            [tokenHash, userAccountId, expiresAt]
        );

        const origin = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:3000';
        const inviteLink = `${origin}/accept-invite?token=${token}`;

        const template = buildEmployeeInviteEmailTemplate({
            inviteLink,
            employeeName: emp.full_name,
            recipientEmail
        });

        const deliveryResult = await sendTransactionalEmail({
            to: recipientEmail,
            subject: template.subject,
            html: template.html,
            text: template.text
        });

        await query(
            'INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_id, details) VALUES ($1, $2, $3, $4, $5, $6, $7)', 
            [crypto.randomUUID(), orgId, new Date().toISOString(), req.user?.id, deliveryResult.success ? 'INVITE_SENT' : 'INVITE_FAILED', empId, `Admin resent invitation to ${recipientEmail} (provider: ${deliveryResult.provider})`]
        );

        res.json({ 
            success: true, 
            data: { 
                inviteLink, 
                email_sent: deliveryResult.success,
                provider: deliveryResult.provider,
                message: deliveryResult.success ? `Invitation email resent to ${recipientEmail}` : `Token created, but email delivery failed: ${deliveryResult.error}`
            } 
        });
    } catch (err: any) {
        console.error('[EMPLOYEES SEND INVITE ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to dispatch employee invitation.' } });
    }
});

export default router;
