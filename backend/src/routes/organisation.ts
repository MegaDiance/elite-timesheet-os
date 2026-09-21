import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { hashPassword, comparePassword } from '../services/auth';
import { requireAuth, requireTenantContext, requireOrgOwner, requireAnyPermission, Permission, AuthRequest } from '../middleware/auth';
import { getFortnightStartIso, fmtISO } from '../services/periodUtils';

const router = Router();

/**
 * GET /api/organisation/discover
 * Authenticated endpoint for organisation lookup. Public access disabled to prevent org enumeration.
 * Strict query length check, and zero exposure of sensitive fields.
 */
router.get('/discover', requireAuth, async (req: any, res: Response) => {
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
 * Resolves by portal_slug, slug, or ID.
 */
router.get('/lookup/:slug', async (req: any, res: Response) => {
    try {
        const { slug } = req.params;
        if (!slug) {
            return res.status(400).json({ success: false, error: { message: 'Slug or ID is required.' } });
        }

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
        let result;
        try {
            const sql = isUuid
                ? `SELECT id, name, display_name, slug, portal_slug, logo_url, timesheet_entry_mode
                   FROM organisations
                   WHERE is_active = true AND (portal_slug = $1 OR LOWER(slug) = $1 OR id = $2)
                   LIMIT 1`
                : `SELECT id, name, display_name, slug, portal_slug, logo_url, timesheet_entry_mode
                   FROM organisations
                   WHERE is_active = true AND (portal_slug = $1 OR LOWER(slug) = $1)
                   LIMIT 1`;
            const params = isUuid ? [slug, slug] : [slug];
            result = await query(sql, params);
        } catch {
            const sql = isUuid
                ? `SELECT id, name, display_name, slug, logo_url
                   FROM organisations
                   WHERE is_active = true AND (LOWER(slug) = $1 OR id = $2)
                   LIMIT 1`
                : `SELECT id, name, display_name, slug, logo_url
                   FROM organisations
                   WHERE is_active = true AND LOWER(slug) = $1
                   LIMIT 1`;
            const params = isUuid ? [slug, slug] : [slug];
            result = await query(sql, params);
        }

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Organisation not found.' } });
        }

        const org = result.rows[0];

        let locationsCount = 0;
        try {
            const locRes = await query('SELECT COUNT(*) as count FROM locations WHERE org_id = $1 AND is_active = true', [org.id]);
            locationsCount = Number(locRes.rows[0]?.count || 0);
        } catch {}

        res.json({
            success: true,
            data: {
                id: org.id,
                name: org.display_name || org.name,
                slug: org.slug || org.id,
                portal_slug: org.portal_slug || org.slug || org.id,
                timesheet_entry_mode: org.timesheet_entry_mode || 'employee',
                locations_count: locationsCount,
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
                `SELECT id, name, slug, portal_slug, display_name, logo_url, owner_user_id,
                        COALESCE(timesheet_entry_mode, 'employee') as timesheet_entry_mode,
                        COALESCE(break_mins_weekday, 30) as break_mins_weekday, 
                        COALESCE(break_mins_weekend, 0) as break_mins_weekend, 
                        COALESCE(break_threshold_hours, 6) as break_threshold_hours,
                        COALESCE(allow_employee_chat, true) as allow_employee_chat,
                        roster_lock_password_hash,
                        timesheet_lock_password_hash
                 FROM organisations WHERE id = $1`, 
                [orgId]
            );
        } catch {
            try {
                result = await query('SELECT id, name, slug, portal_slug, timesheet_entry_mode, owner_user_id FROM organisations WHERE id = $1', [orgId]);
            } catch {
                result = await query('SELECT id, name FROM organisations WHERE id = $1', [orgId]);
            }
            if (result.rows[0]) {
                result.rows[0].break_mins_weekday = 30;
                result.rows[0].break_mins_weekend = 0;
                result.rows[0].break_threshold_hours = 6;
                result.rows[0].allow_employee_chat = true;
                result.rows[0].timesheet_entry_mode = result.rows[0].timesheet_entry_mode || 'employee';
            }
        }
        const org = result.rows[0];

        if (!org) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Organisation not found' } });
        }

        const isOwner = req.user?.role === 'Platform Admin' || 
                        org.owner_user_id === req.user?.id || 
                        req.user?.role === 'Owner';

        const origin = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:3001';
        const portalSlug = org.portal_slug || org.slug || org.id;
        const portalUrl = `${origin}/login/${portalSlug}`;

        res.json({ 
            success: true, 
            data: {
                id: org.id,
                name: org.name,
                slug: org.slug || org.id,
                portal_slug: portalSlug,
                portal_url: portalUrl,
                display_name: org.display_name || org.name,
                logo_url: org.logo_url || null,
                timesheet_entry_mode: org.timesheet_entry_mode || 'employee',
                is_owner: isOwner,
                break_mins_weekday: Number(org.break_mins_weekday ?? 30),
                break_mins_weekend: Number(org.break_mins_weekend ?? 0),
                break_threshold_hours: Number(org.break_threshold_hours ?? 6),
                allow_employee_chat: Boolean(org.allow_employee_chat ?? true),
                has_roster_lock_password: Boolean(org.roster_lock_password_hash),
                has_timesheet_lock_password: Boolean(org.timesheet_lock_password_hash)
            }
        });
    } catch (err: any) {
        console.error('[ORGANISATION GET ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve organisation details.' } });
    }
});

router.put('/settings', requireAuth, requireTenantContext, requireAnyPermission([Permission.ORGANISATION_UPDATE]), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { break_mins_weekday, break_mins_weekend, break_threshold_hours, allow_employee_chat, timesheet_entry_mode } = req.body;

        const updates: string[] = [];
        const params: any[] = [];
        let pIdx = 1;

        if (break_mins_weekday !== undefined) {
            updates.push(`break_mins_weekday = $${pIdx++}`);
            params.push(Number(break_mins_weekday));
        }
        if (break_mins_weekend !== undefined) {
            updates.push(`break_mins_weekend = $${pIdx++}`);
            params.push(Number(break_mins_weekend));
        }
        if (break_threshold_hours !== undefined) {
            updates.push(`break_threshold_hours = $${pIdx++}`);
            params.push(Number(break_threshold_hours));
        }
        if (allow_employee_chat !== undefined) {
            updates.push(`allow_employee_chat = $${pIdx++}`);
            params.push(Boolean(allow_employee_chat));
        }
        if (timesheet_entry_mode !== undefined) {
            if (!['employee', 'manager'].includes(timesheet_entry_mode)) {
                return res.status(400).json({ success: false, error: { message: 'timesheet_entry_mode must be either "employee" or "manager".' } });
            }
            updates.push(`timesheet_entry_mode = $${pIdx++}`);
            params.push(timesheet_entry_mode);
        }

        if (updates.length > 0) {
            params.push(orgId);
            await query(`UPDATE organisations SET ${updates.join(', ')} WHERE id = $${pIdx}`, params);

            await query(
                `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_type, details)
                 VALUES ($1, $2, NOW(), $3, 'ORGANISATION_SETTINGS_UPDATED', 'organisation', $4)`,
                [crypto.randomUUID(), orgId, req.user?.id, `Updated organisation settings: ${updates.join(', ')}`]
            ).catch(() => {});
        }

        res.json({
            success: true,
            message: 'Settings saved successfully.',
            data: {
                timesheet_entry_mode
            }
        });
    } catch (err: any) {
        console.error('[ORGANISATION SETTINGS ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update organisation settings.' } });
    }
});

/**
 * POST /api/organisation/regenerate-portal-url
 * Generates a new cryptographically random portal slug (Organisation Owner only)
 */
router.post('/regenerate-portal-url', requireAuth, requireTenantContext, requireOrgOwner, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        
        // Generate random 10-char alphanumeric slug
        let newSlug = crypto.randomBytes(5).toString('hex');
        while (true) {
            const check = await query('SELECT id FROM organisations WHERE portal_slug = $1 OR slug = $1', [newSlug]);
            if (check.rows.length === 0) break;
            newSlug = crypto.randomBytes(5).toString('hex');
        }

        await query('UPDATE organisations SET portal_slug = $1 WHERE id = $2', [newSlug, orgId]);

        await query(
            `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_type, entity_id, details)
             VALUES ($1, $2, NOW(), $3, 'PORTAL_URL_REGENERATED', 'organisation', $2, $4)`,
            [crypto.randomUUID(), orgId, req.user?.id, `Regenerated custom portal slug to ${newSlug}`]
        ).catch(() => {});

        const origin = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:3001';
        const portalUrl = `${origin}/login/${newSlug}`;

        res.json({
            success: true,
            data: {
                portal_slug: newSlug,
                portal_url: portalUrl
            },
            message: 'Custom portal URL has been regenerated successfully. The previous URL is now invalid.'
        });
    } catch (err: any) {
        console.error('[REGENERATE PORTAL URL ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to regenerate portal URL.' } });
    }
});

router.put('/lock-passwords', requireAuth, requireTenantContext, requireAnyPermission([Permission.ORGANISATION_UPDATE]), async (req: AuthRequest, res: Response) => {
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

router.get('/leave-requests', requireAuth, requireTenantContext, requireAnyPermission([Permission.LEAVE_VIEW, Permission.ORGANISATION_VIEW]), async (req: AuthRequest, res: Response) => {
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

router.post('/leave-requests/:id/review', requireAuth, requireTenantContext, requireAnyPermission([Permission.LEAVE_APPROVE]), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { id } = req.params;
        const { status, rejection_reason } = req.body;

        if (!['Approved', 'Rejected'].includes(status)) {
            return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Status must be Approved or Rejected' } });
        }

        if (status === 'Rejected' && (!rejection_reason || !rejection_reason.trim())) {
            return res.status(400).json({ success: false, error: { code: 'REASON_REQUIRED', message: 'A rejection reason is required when declining leave.' } });
        }

        const existingLeave = await query('SELECT * FROM leave_requests WHERE id = $1 AND org_id = $2', [id, orgId]);
        if (existingLeave.rows.length === 0) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Leave request not found in your organisation.' } });
        }
        const leaveItem = existingLeave.rows[0];
        if (['Approved', 'Rejected'].includes(leaveItem.status)) {
            return res.status(409).json({
                success: false,
                error: { code: 'ALREADY_REVIEWED', message: `This leave request has already been ${leaveItem.status.toLowerCase()}.` }
            });
        }

        // Check if either start_date or end_date falls into a timesheet-locked fortnight
        const startFnIso = getFortnightStartIso(leaveItem.start_date);
        const endFnIso = getFortnightStartIso(leaveItem.end_date);

        const lockRes = await query(
            'SELECT start_date, timesheet_locked FROM fortnight_locks WHERE org_id = $1 AND start_date IN ($2, $3) AND timesheet_locked = true',
            [orgId, startFnIso, endFnIso]
        );
        if (lockRes.rows.length > 0) {
            return res.status(403).json({
                success: false,
                error: { code: 'TIMESHEET_LOCKED', message: 'Cannot review leave for a fortnight that is timesheet locked.' }
            });
        }

        const cleanReason = status === 'Rejected' ? rejection_reason.trim() : null;

        const updateRes = await query(
            `UPDATE leave_requests
             SET status = $1, reviewed_by = $2, reviewed_at = NOW(), rejection_reason = $3
             WHERE id = $4 AND org_id = $5
             RETURNING *`,
            [status, req.user?.id, cleanReason, id, orgId]
        );

        const leave = updateRes.rows[0];

        // When approved, automatically generate corresponding daily records and shift segments
        if (status === 'Approved') {
            const [sy, sm, sd] = String(leaveItem.start_date).split('T')[0].split('-').map(Number);
            const [ey, em, ed] = String(leaveItem.end_date).split('T')[0].split('-').map(Number);
            const curDate = new Date(Date.UTC(sy, sm - 1, sd));
            const endDate = new Date(Date.UTC(ey, em - 1, ed));

            const dates: string[] = [];
            while (curDate.getTime() <= endDate.getTime()) {
                dates.push(fmtISO(curDate));
                curDate.setUTCDate(curDate.getUTCDate() + 1);
            }

            const totalHours = Number(leaveItem.hours);
            const daysCount = dates.length || 1;
            const dailyHours = Math.round((totalHours / daysCount) * 100) / 100;

            for (const dIso of dates) {
                let recId: string;
                const recRes = await query(
                    'SELECT id FROM daily_records WHERE org_id = $1 AND employee_id = $2 AND record_date = $3',
                    [orgId, leaveItem.employee_id, dIso]
                );

                if (recRes.rows.length > 0) {
                    recId = recRes.rows[0].id;
                    await query('UPDATE daily_records SET has_actuals = true WHERE id = $1', [recId]);
                } else {
                    recId = crypto.randomUUID();
                    await query(
                        'INSERT INTO daily_records (id, org_id, employee_id, record_date, has_actuals) VALUES ($1, $2, $3, $4, true)',
                        [recId, orgId, leaveItem.employee_id, dIso]
                    );
                }

                // Insert leave shift segment
                await query(
                    `INSERT INTO shift_segments (id, record_id, segment_type, roster_hours, actual_hours, actual_segment_type, notes)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        crypto.randomUUID(),
                        recId,
                        leaveItem.leave_type,
                        dailyHours,
                        dailyHours,
                        leaveItem.leave_type,
                        `Approved leave request: ${leaveItem.reason || leaveItem.leave_type}`
                    ]
                );
            }
        }

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
