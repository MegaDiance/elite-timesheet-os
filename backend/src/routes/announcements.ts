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
 * Allows managers/admins to post a team announcement.
 */
router.post('/', requireAuth, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { title, content } = req.body;

        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, error: { message: 'Announcement content is required.' } });
        }

        const authorName = req.user?.email ? req.user.email.split('@')[0] : 'Management';
        const id = crypto.randomUUID();

        await query(
            `INSERT INTO organisation_announcements (id, org_id, author_id, author_name, author_role, title, content, is_system, announcement_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                id,
                orgId,
                req.user?.id,
                authorName,
                req.user?.role || 'Manager',
                title?.trim() || null,
                content.trim(),
                false,
                'general'
            ]
        );

        res.json({
            success: true,
            data: {
                id,
                title: title?.trim() || null,
                content: content.trim(),
                author_name: authorName,
                author_role: req.user?.role || 'Manager',
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
 * Allows managers/admins to delete an announcement.
 */
router.delete('/:id', requireAuth, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { id } = req.params;

        await query('DELETE FROM organisation_announcements WHERE id = $1 AND org_id = $2', [id, orgId]);
        res.json({ success: true, message: 'Announcement deleted.' });
    } catch (err: any) {
        console.error('[ANNOUNCEMENTS DELETE ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete announcement.' } });
    }
});

export default router;
