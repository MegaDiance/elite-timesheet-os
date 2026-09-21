import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { badRequest, loadBranch, writeAudit } from '../services/policy';

/**
 * Branches (stored in the `locations` table).
 * The Organisation Owner creates, edits, deactivates and reactivates branches.
 * A Branch Admin can see the branches they are assigned to — nothing else.
 */
const router = Router();
router.use(requireAuth);

function readBranchFields(body: any) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120) throw badRequest('VALIDATION_FAILED', 'Branch name is required (120 characters at most).');
    return {
        name,
        address: typeof body?.address === 'string' && body.address.trim() ? body.address.trim() : null,
        timezone: typeof body?.timezone === 'string' && body.timezone.trim() ? body.timezone.trim() : 'Australia/Melbourne',
    };
}

router.get('/', requirePermission(Permission.BRANCH_VIEW), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const includeInactive = req.query.include_inactive === 'true';
        const result = await query(
            `SELECT l.*,
                    (SELECT COUNT(*)::int FROM employees e
                      WHERE e.location_id = l.id AND e.is_active = true AND e.deleted_at IS NULL) AS active_staff_count,
                    COALESCE((SELECT json_agg(json_build_object('id', u.id, 'email', u.email, 'full_name', u.full_name) ORDER BY u.email)
                                FROM branch_admins ba JOIN users u ON u.id = ba.user_id
                               WHERE ba.location_id = l.id), '[]'::json) AS admins
               FROM locations l
              WHERE l.org_id = $1 AND l.id = ANY($2::uuid[]) AND (l.is_active = true OR $3::boolean)
              ORDER BY l.name ASC`,
            [ctx.orgId, ctx.branchIds, includeInactive]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        sendError(res, err, 'BRANCH LIST ERROR');
    }
});

router.post('/', requirePermission(Permission.BRANCHES_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const fields = readBranchFields(req.body);

        const existing = await query('SELECT id FROM locations WHERE org_id = $1 AND LOWER(name) = $2', [ctx.orgId, fields.name.toLowerCase()]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: `A branch named "${fields.name}" already exists.` } });
        }

        const result = await query(
            `INSERT INTO locations (id, org_id, name, address, timezone, is_active)
             VALUES ($1, $2, $3, $4, $5, true) RETURNING *`,
            [crypto.randomUUID(), ctx.orgId, fields.name, fields.address, fields.timezone]
        );
        const branch = result.rows[0];
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'BRANCH_CREATED', entityType: 'location', entityId: branch.id, branchId: branch.id, details: `Created branch "${branch.name}"` });
        res.status(201).json({ success: true, data: branch, message: `Branch "${branch.name}" created successfully.` });
    } catch (err) {
        sendError(res, err, 'BRANCH CREATE ERROR');
    }
});

router.get('/:id', requirePermission(Permission.BRANCH_VIEW), async (req: AuthRequest, res: Response) => {
    try {
        const branch = await loadBranch(req.auth!, Permission.BRANCH_VIEW, req.params.id);
        res.json({ success: true, data: branch });
    } catch (err) {
        sendError(res, err, 'BRANCH GET ERROR');
    }
});

router.put('/:id', requirePermission(Permission.BRANCHES_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const branch = await loadBranch(ctx, Permission.BRANCHES_MANAGE, req.params.id);
        const fields = readBranchFields(req.body);

        const clash = await query('SELECT id FROM locations WHERE org_id = $1 AND LOWER(name) = $2 AND id <> $3', [ctx.orgId, fields.name.toLowerCase(), branch.id]);
        if (clash.rows.length > 0) {
            return res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: `A branch named "${fields.name}" already exists.` } });
        }

        const updated = await query(
            'UPDATE locations SET name = $1, address = $2, timezone = $3, updated_at = NOW() WHERE id = $4 AND org_id = $5 RETURNING *',
            [fields.name, fields.address, fields.timezone, branch.id, ctx.orgId]
        );
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'BRANCH_UPDATED', entityType: 'location', entityId: branch.id, branchId: branch.id, previousValue: branch.name, newValue: fields.name });
        res.json({ success: true, data: updated.rows[0], message: 'Branch updated successfully.' });
    } catch (err) {
        sendError(res, err, 'BRANCH UPDATE ERROR');
    }
});

/**
 * Branches are never deleted: rosters, timesheets and audit history belong to them.
 * Deactivating removes the branch from every Branch Admin's scope immediately.
 * The last active branch cannot be deactivated.
 */
router.post('/:id/deactivate', requirePermission(Permission.BRANCHES_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const branch = await loadBranch(ctx, Permission.BRANCHES_MANAGE, req.params.id);

        const others = await query('SELECT COUNT(*)::int AS count FROM locations WHERE org_id = $1 AND is_active = true AND id <> $2', [ctx.orgId, branch.id]);
        if (others.rows[0].count === 0) {
            throw badRequest('LAST_BRANCH', 'An organisation needs at least one active branch.');
        }

        await query('UPDATE locations SET is_active = false, updated_at = NOW() WHERE id = $1 AND org_id = $2', [branch.id, ctx.orgId]);
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'BRANCH_DEACTIVATED', entityType: 'location', entityId: branch.id, branchId: branch.id, details: `Deactivated branch "${branch.name}" (history preserved)` });
        res.json({ success: true, message: `Branch "${branch.name}" has been deactivated. Historical records remain preserved.` });
    } catch (err) {
        sendError(res, err, 'BRANCH DEACTIVATE ERROR');
    }
});

router.post('/:id/reactivate', requirePermission(Permission.BRANCHES_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const branch = await loadBranch(ctx, Permission.BRANCHES_MANAGE, req.params.id);
        await query('UPDATE locations SET is_active = true, updated_at = NOW() WHERE id = $1 AND org_id = $2', [branch.id, ctx.orgId]);
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'BRANCH_REACTIVATED', entityType: 'location', entityId: branch.id, branchId: branch.id, details: `Reactivated branch "${branch.name}"` });
        res.json({ success: true, message: `Branch "${branch.name}" has been reactivated.` });
    } catch (err) {
        sendError(res, err, 'BRANCH REACTIVATE ERROR');
    }
});

export default router;
