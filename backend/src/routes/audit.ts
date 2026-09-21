import { Router, Response } from 'express';
import { query } from '../services/db';
import { requireAuth, requireTenantContext, requireAnyPermission, Permission, AuthRequest } from '../middleware/auth';
import crypto from 'crypto';

const router = Router();
router.use(requireAuth, requireTenantContext);

router.get('/', requireAnyPermission([Permission.ORGANISATION_VIEW, Permission.REPORT_VIEW]), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const hasLoc = Boolean(req.user?.location_id) && ['Manager'].includes(req.user?.role || '');
        const params = hasLoc ? [orgId, req.user!.location_id] : [orgId];
        const locClause = hasLoc ? ' AND (a.location_id = $2 OR a.location_id IS NULL)' : '';

        let result;
        try {
            result = await query(`
                SELECT a.*, u.email as actor_email
                FROM audit_logs a
                LEFT JOIN users u ON a.actor_id = u.id
                WHERE a.org_id = $1 AND (a.scope = 'organisation' OR a.scope IS NULL)${locClause}
                ORDER BY a.created_at DESC
            `, params);
        } catch {
            result = await query(`
                SELECT a.*, u.email as actor_email
                FROM audit_logs a
                LEFT JOIN users u ON a.actor_id = u.id
                WHERE a.org_id = $1 AND (a.scope = 'organisation' OR a.scope IS NULL)${locClause}
                ORDER BY a.timestamp DESC
            `, params);
        }
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
