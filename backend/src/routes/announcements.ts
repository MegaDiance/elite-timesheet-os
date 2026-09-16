import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { requireAuth, requireTenantContext, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(requireAuth, requireTenantContext);

/**
 * GET /api/announcements
 * Lists announcements and automated alerts for the caller's organisation.
 */
router.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        if (!orgId) {
            return res.status(400).json({ success: false, error: { message: 'Organisation context required.' } });
        }

        const result = await query(
            `SELECT id, org_id, author_id, author_name, author_role, title, content, is_system, announcement_type, created_at
             FROM organisation_announcements 
             WHERE org_id = $1 
             ORDER BY created_at DESC 
             LIMIT 50`,
            [orgId]
        );

        res.json({ success: true, data: result.rows });
    } catch (err: any) {
        console.error('[ANNOUNCEMENTS GET ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve announcements.' } });
    }
});

/**
 * POST /api/announcements
 * Allows all organisation members (including employees) to post a team message or announcement.
 */
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { title, content } = req.body;

        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, error: { message: 'Announcement content is required.' } });
        }

        let authorName = req.user?.email ? req.user.email.split('@')[0] : 'Team Member';
        try {
            const emp = await query('SELECT full_name FROM employees WHERE user_id = $1 AND org_id = $2', [req.user?.id, orgId]);
            if (emp.rows.length > 0 && emp.rows[0].full_name) {
                authorName = emp.rows[0].full_name;
            }
        } catch {
            // fallback
        }

        const id = crypto.randomUUID();
        const role = req.user?.role || 'Employee';
        const isEmployee = role === 'Employee';

        await query(
            `INSERT INTO organisation_announcements (id, org_id, author_id, author_name, author_role, title, content, is_system, announcement_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                id,
                orgId,
                req.user?.id,
                authorName,
                role,
                title?.trim() || null,
                content.trim(),
                false,
                isEmployee ? 'team_message' : 'general'
            ]
        );

        res.json({
            success: true,
            data: {
                id,
                title: title?.trim() || null,
                content: content.trim(),
                author_name: authorName,
                author_role: role,
                created_at: new Date().toISOString()
            }
        });
    } catch (err: any) {
        console.error('[ANNOUNCEMENTS POST ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to publish announcement.' } });
    }
});

/**
 * DELETE /api/announcements/:id
 * Allows managers/admins to delete any announcement, or employees to delete their own messages.
 */
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { id } = req.params;
        const userRole = req.user?.role || 'Employee';
        const isMgmt = ['Admin', 'Company Admin', 'Platform Admin', 'Manager'].includes(userRole);

        const existing = await query('SELECT author_id FROM organisation_announcements WHERE id = $1 AND org_id = $2', [id, orgId]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Announcement not found.' } });
        }

        if (!isMgmt && existing.rows[0].author_id !== req.user?.id) {
            return res.status(403).json({ success: false, error: { message: 'You can only delete your own messages.' } });
        }

        await query('DELETE FROM organisation_announcements WHERE id = $1 AND org_id = $2', [id, orgId]);

        res.json({ success: true, message: 'Announcement deleted.' });
    } catch (err: any) {
        console.error('[ANNOUNCEMENTS DELETE ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete announcement.' } });
    }
});

export default router;
