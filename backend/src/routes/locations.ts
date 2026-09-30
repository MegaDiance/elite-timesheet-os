import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { requireAuth, requireManagement, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { badRequest, forbidden, hasPermission, isUuid, loadBranch, notFound, writeAudit } from '../services/policy';

/**
 * Branches (stored in the `locations` table).
 * branches.manage (organisation-wide) creates, edits, deactivates and reactivates branches.
 * Everyone else who manages data sees only the branches their permissions cover — nothing else.
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

router.get('/', requireManagement, async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const includeInactive = req.query.include_inactive === 'true';
        // Who has access to a branch is only shown to people who manage users.
        const showTeam = hasPermission(ctx, Permission.USERS_MANAGE);
        const result = await query(
            `SELECT l.*,
                    (SELECT COUNT(*)::int FROM employees e
                      WHERE e.location_id = l.id AND e.is_active = true) AS active_staff_count,
                    CASE WHEN $4::boolean THEN COALESCE((SELECT json_agg(json_build_object('id', m.id, 'email', m.email, 'full_name', m.full_name) ORDER BY m.email)
                                FROM (SELECT DISTINCT u.id, u.email, u.full_name
                                        FROM user_roles ur
                                        JOIN users u ON u.id = ur.user_id
                                       WHERE ur.org_id = l.org_id
                                         AND (ur.scope_all OR EXISTS (SELECT 1 FROM user_role_branches urb WHERE urb.user_role_id = ur.id AND urb.location_id = l.id))) m),
                              '[]'::json) ELSE '[]'::json END AS admins
               FROM locations l
              WHERE l.org_id = $1 AND l.id = ANY($2::uuid[]) AND (l.is_active = true OR $3::boolean)
              ORDER BY l.name ASC`,
            [ctx.orgId, ctx.branchIds, includeInactive, showTeam]
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

router.get('/:id', requireManagement, async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        if (!isUuid(req.params.id)) throw notFound('Branch');
        const found = await query('SELECT * FROM locations WHERE id = $1 AND org_id = $2', [req.params.id, ctx.orgId]);
        if (found.rows.length === 0) throw notFound('Branch');
        if (!ctx.branchIds.includes(found.rows[0].id)) throw forbidden('You do not have access to this branch.');
        res.json({ success: true, data: found.rows[0] });
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
 * Deactivating removes the branch from every branch-scoped assignment immediately.
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
