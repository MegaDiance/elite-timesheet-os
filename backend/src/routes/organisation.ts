import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { hashPassword, comparePassword } from '../services/auth';
import { requireAuth, requireTenantContext, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * GET /api/organisation/discover
 * Public endpoint for safe organisation discovery during login/onboarding.
 * Strict query length check, and zero exposure of sensitive fields.
 */
router.get('/discover', async (req: any, res: Response) => {
    try {
        const queryStr = (req.query.q as string || '').trim();

        if (!queryStr || queryStr.length < 2) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'QUERY_TOO_SHORT',
                    message: 'Search query must be at least 2 characters.'
                }
            });
        }

        const safeQuery = `%${queryStr}%`;
        const result = await query(
            `SELECT id, name, slug, display_name, logo_url
             FROM organisations
             WHERE is_active = true 
               AND (name ILIKE $1 OR COALESCE(slug, '') ILIKE $1 OR COALESCE(display_name, '') ILIKE $1)
             ORDER BY name ASC
             LIMIT 10`,
            [safeQuery]
        );

        res.json({
            success: true,
            data: result.rows.map((org: any) => ({
                id: org.id,
                name: org.display_name || org.name,
                slug: org.slug || org.id,
                logo_url: org.logo_url || null
            }))
        });
    } catch (err: any) {
        console.error('[ORGANISATION DISCOVER ERROR]', err);
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to search organisations.' }
        });
    }
});

/**
 * GET /api/organisation/lookup/:slug
 * Public lookup for branded organization login screen.
 */
router.get('/lookup/:slug', async (req: any, res: Response) => {
    try {
        const { slug } = req.params;
        if (!slug) {
            return res.status(400).json({ success: false, error: { message: 'Slug or ID is required.' } });
        }

        const result = await query(
            `SELECT id, name, slug, display_name, logo_url
             FROM organisations
             WHERE is_active = true AND (slug = $1 OR id::text = $1)
             LIMIT 1`,
            [slug]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Organisation not found.' } });
        }

        const org = result.rows[0];
        res.json({
            success: true,
            data: {
                id: org.id,
                name: org.display_name || org.name,
                slug: org.slug || org.id,
                logo_url: org.logo_url || null
            }
        });
    } catch (err: any) {
        console.error('[ORGANISATION LOOKUP ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to lookup organisation.' } });
    }
});

router.get('/me', requireAuth, requireTenantContext, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        let result;
        try {
            result = await query(
                `SELECT id, name, slug, display_name, logo_url,
                        COALESCE(break_mins_weekday, 30) as break_mins_weekday, 
                        COALESCE(break_mins_weekend, 0) as break_mins_weekend, 
                        COALESCE(break_threshold_hours, 6) as break_threshold_hours,
                        roster_lock_password_hash,
                        timesheet_lock_password_hash
                 FROM organisations WHERE id = $1`, 
                [orgId]
            );
        } catch {
            result = await query('SELECT id, name FROM organisations WHERE id = $1', [orgId]);
            if (result.rows[0]) {
                result.rows[0].break_mins_weekday = 30;
                result.rows[0].break_mins_weekend = 0;
                result.rows[0].break_threshold_hours = 6;
            }
        }
        const org = result.rows[0];

        if (!org) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organisation not found' } });
        }

        res.json({ 
            success: true, 
            data: {
                id: org.id,
                name: org.name,
                slug: org.slug || org.id,
                display_name: org.display_name || org.name,
                logo_url: org.logo_url || null,
                break_mins_weekday: Number(org.break_mins_weekday ?? 30),
                break_mins_weekend: Number(org.break_mins_weekend ?? 0),
                break_threshold_hours: Number(org.break_threshold_hours ?? 6),
                has_roster_lock_password: Boolean(org.roster_lock_password_hash),
                has_timesheet_lock_password: Boolean(org.timesheet_lock_password_hash)
            }
        });
    } catch (err: any) {
        console.error('[ORGANISATION GET ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve organisation details.' } });
    }
});

router.put('/settings', requireAuth, requireTenantContext, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { break_mins_weekday, break_mins_weekend, break_threshold_hours } = req.body;

        await query(
            `UPDATE organisations 
             SET break_mins_weekday = $1, break_mins_weekend = $2, break_threshold_hours = $3 
             WHERE id = $4`,
            [
                break_mins_weekday !== undefined ? Number(break_mins_weekday) : 30,
                break_mins_weekend !== undefined ? Number(break_mins_weekend) : 0,
                break_threshold_hours !== undefined ? Number(break_threshold_hours) : 6,
                orgId
            ]
        );

        res.json({ success: true, message: 'Settings saved successfully.' });
    } catch (err: any) {
        console.error('[ORGANISATION SETTINGS ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update organisation settings.' } });
    }
});

router.put('/lock-passwords', requireAuth, requireTenantContext, requireRole(['Admin', 'Company Admin', 'Platform Admin']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { current_password, new_roster_lock_password, new_timesheet_lock_password } = req.body;

        if (!current_password) {
            return res.status(400).json({ success: false, error: { message: 'Current admin password required.' } });
        }

        const userRes = await query('SELECT password_hash FROM users WHERE id = $1', [req.user?.id]);
        if (userRes.rows.length === 0 || !(await comparePassword(current_password, userRes.rows[0].password_hash))) {
            return res.status(401).json({ success: false, error: { message: 'Invalid current password.' } });
        }

        const updates: string[] = [];
        const params: any[] = [];
        let pIdx = 1;

        if (new_roster_lock_password !== undefined) {
            const hash = new_roster_lock_password ? await hashPassword(new_roster_lock_password) : null;
            updates.push(`roster_lock_password_hash = $${pIdx++}`);
            params.push(hash);
        }

        if (new_timesheet_lock_password !== undefined) {
            const hash = new_timesheet_lock_password ? await hashPassword(new_timesheet_lock_password) : null;
            updates.push(`timesheet_lock_password_hash = $${pIdx++}`);
            params.push(hash);
        }

        if (updates.length > 0) {
            params.push(orgId);
            await query(`UPDATE organisations SET ${updates.join(', ')} WHERE id = $${pIdx}`, params);
        }

        res.json({ success: true, message: 'Lock passwords updated successfully.' });
    } catch (err: any) {
        console.error('[ORGANISATION LOCK PASSWORDS ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update lock passwords.' } });
    }
});

router.get('/leave-requests', requireAuth, requireTenantContext, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const result = await query(
            `SELECT lr.*, e.full_name as employee_name, e.department as employee_department, e.email as employee_email
             FROM leave_requests lr
             JOIN employees e ON lr.employee_id = e.id
             WHERE lr.org_id = $1
             ORDER BY lr.created_at DESC`,
            [orgId]
        );

        res.json({ success: true, data: result.rows });
    } catch (err: any) {
        console.error('[ORGANISATION GET LEAVE REQUESTS ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve leave requests.' } });
    }
});

router.post('/leave-requests/:id/review', requireAuth, requireTenantContext, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { id } = req.params;
        const { status, rejection_reason } = req.body;

        if (!['Approved', 'Rejected'].includes(status)) {
            return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Status must be Approved or Rejected' } });
        }

        const updateRes = await query(
            `UPDATE leave_requests
             SET status = $1, reviewed_by = $2, reviewed_at = NOW(), rejection_reason = $3
             WHERE id = $4 AND org_id = $5
             RETURNING *`,
            [status, req.user?.id, rejection_reason || null, id, orgId]
        );

        if (updateRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Leave request not found' } });
        }

        const leave = updateRes.rows[0];

        // Audit log
        await query(
            `INSERT INTO audit_logs (id, org_id, actor_id, action, entity_type, entity_id, details, timestamp)
             VALUES ($1, $2, $3, $4, 'leave_requests', $5, $6, NOW())`,
            [
                crypto.randomUUID(),
                orgId,
                req.user?.id,
                'LEAVE_REVIEWED',
                id,
                JSON.stringify({ status, rejection_reason: rejection_reason || null })
            ]
        );

        res.json({ success: true, data: leave });
    } catch (err: any) {
        console.error('[ORGANISATION REVIEW LEAVE REQUEST ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to review leave request.' } });
    }
});

export default router;
