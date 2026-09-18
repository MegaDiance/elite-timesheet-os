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

// Audit logs are immutable and tamper-evident for compliance and cannot be cleared.
router.delete('/clear', requireAuth, async (req: AuthRequest, res: Response) => {
    return res.status(403).json({
        success: false,
        error: {
            code: 'IMMUTABLE_AUDIT_LOG',
            message: 'Statutory compliance requires that all audit logs remain immutable. Destruction of audit records is prohibited.'
        }
    });
});

export default router;
