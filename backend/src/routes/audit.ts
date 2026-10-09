import { Router, Response } from 'express';
import { query } from '../services/db';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { badRequest, isUuid } from '../services/policy';

/**
 * The organisation's audit trail. Only holders of audit.view read it, and nobody can change it:
 * rows are written exclusively through writeAudit (services/policy).
 */
const router = Router();
router.use(requireAuth);

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

/**
 * GET /api/audit?limit=&before=  — newest first, a page at a time. `before` is the `next` value of
 * the previous page (keyset paging on created_at and id, so new entries never shift a page).
 */
router.get('/', requirePermission(Permission.AUDIT_VIEW), async (req: AuthRequest, res: Response) => {
    try {
        const limitRaw = Number(req.query.limit ?? DEFAULT_LIMIT);
        const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT;
        let beforeAt: string | null = null;
        let beforeId: string | null = null;
        if (typeof req.query.before === 'string' && req.query.before) {
            const [at, id] = req.query.before.split('|');
            if (!at || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(at) || !isUuid(id)) throw badRequest('VALIDATION_FAILED', 'before must be a value returned as next.');
            beforeAt = at;
            beforeId = id;
        }
        const result = await query(
            `SELECT a.*, u.email AS actor_email, u.full_name AS actor_full_name,
                    to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
               FROM audit_logs a
               LEFT JOIN users u ON u.id = a.actor_id
              WHERE a.org_id = $1
                AND ($2::timestamptz IS NULL OR (a.created_at, a.id) < ($2::timestamptz, $3::uuid))
              ORDER BY a.created_at DESC, a.id DESC
              LIMIT $4`,
            [req.auth!.orgId, beforeAt, beforeId, limit + 1]
        );
        // The cursor keeps the database's microsecond precision, so no entry is skipped or repeated between pages.
        const rows = result.rows.slice(0, limit);
        const last = rows[rows.length - 1];
        const next = result.rows.length > limit && last ? `${last.cursor_at}|${last.id}` : null;
        res.json({ success: true, data: rows.map(({ cursor_at: _c, ...row }: any) => row), next });
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
