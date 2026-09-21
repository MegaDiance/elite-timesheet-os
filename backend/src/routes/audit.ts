import { Router, Response } from 'express';
import { query } from '../services/db';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';

/**
 * The organisation's audit trail. Only the Organisation Owner reads it, and nobody can change it:
 * rows are written exclusively through writeAudit (services/policy).
 */
const router = Router();
router.use(requireAuth);

router.get('/', requirePermission(Permission.AUDIT_VIEW), async (req: AuthRequest, res: Response) => {
    try {
        const result = await query(
            `SELECT a.*, u.email AS actor_email, u.full_name AS actor_full_name
               FROM audit_logs a
               LEFT JOIN users u ON u.id = a.actor_id
              WHERE a.org_id = $1
              ORDER BY a.created_at DESC`,
            [req.auth!.orgId]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        sendError(res, err, 'AUDIT GET ERROR');
    }
});

// Audit logs are immutable and tamper-evident for compliance and cannot be cleared by anyone.
router.delete('/clear', requirePermission(Permission.AUDIT_VIEW), (_req: AuthRequest, res: Response) => {
    res.status(403).json({
        success: false,
        error: {
            code: 'IMMUTABLE_AUDIT_LOG',
            message: 'Statutory compliance requires that all audit logs remain immutable. Destruction of audit records is prohibited.'
        }
    });
});

export default router;
