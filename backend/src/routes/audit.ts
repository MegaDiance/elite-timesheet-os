import { Router, Response } from 'express';
import { query } from '../services/db';
import { requireAuth, requireTenantContext, requireRole, AuthRequest } from '../middleware/auth';
import crypto from 'crypto';

const router = Router();
router.use(requireAuth, requireTenantContext);

router.get('/', requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const result = await query(`
            SELECT a.*, u.email as actor_email
            FROM audit_logs a
            LEFT JOIN users u ON a.actor_id = u.id
            WHERE a.org_id = $1
            ORDER BY a.created_at DESC
        `, [orgId]);
        res.json({ success: true, data: result.rows });
    } catch (err: any) {
        console.error('[AUDIT GET ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve audit logs.' } });
    }
});

router.delete('/clear', requireAuth, requireRole(['Admin', 'Company Admin', 'Platform Admin']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        await query('DELETE FROM audit_logs WHERE org_id = $1', [orgId]);
        await query(
            `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, details) VALUES ($1, $2, $3, $4, $5, $6)`,
            [crypto.randomUUID(), orgId, new Date().toISOString(), req.user?.id, 'CLEARED_LOGS', 'Admin cleared all audit logs']
        );
        res.json({ success: true });
    } catch (err: any) {
        console.error('[AUDIT CLEAR ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to clear audit logs.' } });
    }
});

export default router;
