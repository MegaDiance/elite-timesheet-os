import { Router, Response } from 'express';
import crypto from 'crypto';
import { query, withTransaction } from '../services/db';
import { requireAnyPermission, requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { HttpError, badRequest, forbidden, hasPermission, writeAudit } from '../services/policy';
import { PERMISSION_CATALOGUE, PERMISSION_CATEGORIES, permissionDef } from '../services/permissions';
import { RoleRecord, assertCovers, loadRole, readPermissionList } from '../services/roleAdmin';

/**
 * Roles: named sets of permissions.
 *
 * Owner and Employee are built in and fixed; Admin is built in and only its permissions can be
 * changed (by the owner); every other role is custom. Who holds a role, and where, is decided by
 * an assignment (routes/team.ts), not by the role. Reading needs roles.manage or users.manage (to
 * choose a role for someone); changing roles needs roles.manage, and only ever within access the
 * caller holds themselves (services/roleAdmin.ts).
 */
const router = Router();
router.use(requireAuth);

const NAME_MAX = 60;
const DESCRIPTION_MAX = 300;

function readName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > NAME_MAX) throw badRequest('VALIDATION_FAILED', `Give the role a name (${NAME_MAX} characters at most).`);
    return name;
}

function readDescription(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.trim().length > DESCRIPTION_MAX) {
        throw badRequest('VALIDATION_FAILED', `The description can be ${DESCRIPTION_MAX} characters at most.`);
    }
    return value.trim() || null;
}

const nameTaken = () => new HttpError(409, 'DUPLICATE_ROLE', 'A role with that name already exists.');
const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === '23505';

const canRead = requireAnyPermission(Permission.ROLES_MANAGE, Permission.USERS_MANAGE);

/** GET /api/roles/permissions — the permission catalogue, grouped for the role editor. */
router.get('/permissions', canRead, (_req: AuthRequest, res: Response) => {
    res.json({
        success: true,
        data: PERMISSION_CATEGORIES.map(category => ({
            category,
            permissions: PERMISSION_CATALOGUE.filter(p => p.category === category)
                .map(p => ({ key: p.key, label: p.label, description: p.description, level: p.level, assignable: p.level !== 'self' })),
        })),
    });
});

/** How many people hold each role in this organisation. Owner and Employee are derived, not stored. */
async function memberCounts(orgId: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const stored = await query('SELECT role_id, COUNT(*)::int AS n FROM user_roles WHERE org_id = $1 GROUP BY role_id', [orgId]);
    for (const row of stored.rows) counts.set(row.role_id, row.n);
    const derived = await query(
        `SELECT r.id, r.system_key,
                CASE r.system_key
                    WHEN 'OWNER' THEN 1
                    WHEN 'EMPLOYEE' THEN (SELECT COUNT(DISTINCT e.user_id)::int FROM employees e WHERE e.org_id = r.org_id AND e.user_id IS NOT NULL AND e.is_active = true)
                END AS n
           FROM roles r WHERE r.org_id = $1 AND r.system_key IN ('OWNER', 'EMPLOYEE')`,
        [orgId]
    );
    for (const row of derived.rows) counts.set(row.id, row.n);
    return counts;
}

router.get('/', canRead, async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const [roles, counts] = await Promise.all([
            query(
                `SELECT r.id, r.name, r.description, r.system_key, r.created_at,
                        ARRAY(SELECT rp.permission_key FROM role_permissions rp WHERE rp.role_id = r.id) AS permissions
                   FROM roles r WHERE r.org_id = $1
                  ORDER BY CASE r.system_key WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'EMPLOYEE' THEN 2 ELSE 3 END, lower(r.name)`,
                [ctx.orgId]
            ),
            memberCounts(ctx.orgId),
        ]);
        const canEdit = hasPermission(ctx, Permission.ROLES_MANAGE);
        res.json({
            success: true,
            data: {
                can_manage: canEdit,
                roles: await Promise.all(roles.rows.map(async (row: any) => {
                    const detail = await loadRole(ctx.orgId, row.id);
                    return describeRole(detail, counts.get(row.id) ?? 0, canEdit, ctx.isOwner);
                })),
            },
        });
    } catch (err) {
        sendError(res, err, 'ROLES LIST ERROR');
    }
});

function describeRole(role: RoleRecord, memberCount: number, canManage: boolean, isOwner: boolean) {
    const system = role.systemKey !== null;
    return {
        id: role.id,
        name: role.name,
        description: role.description,
        system_key: role.systemKey,
        is_system: system,
        permissions: role.permissions,
        member_count: memberCount,
        // What the caller may change about this role (display only; the routes below enforce it).
        can_edit_permissions: canManage && (role.systemKey === null || (role.systemKey === 'ADMIN' && isOwner)),
        can_edit_details: canManage && role.systemKey === null,
        can_delete: canManage && role.systemKey === null,
    };
}

router.get('/:id', canRead, async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const role = await loadRole(ctx.orgId, req.params.id);
        const counts = await memberCounts(ctx.orgId);

        let members: unknown[];
        if (role.systemKey === 'OWNER') {
            const owner = await query(
                `SELECT u.id AS user_id, u.email, u.full_name, u.is_active FROM organisations o JOIN users u ON u.id = o.owner_user_id WHERE o.id = $1`,
                [ctx.orgId]
            );
            members = owner.rows.map((m: any) => ({ ...m, assignment_id: null, scope: { all: true, branches: [] } }));
        } else if (role.systemKey === 'EMPLOYEE') {
            const linked = await query(
                `SELECT DISTINCT ON (u.id) u.id AS user_id, u.email, u.full_name, u.is_active, l.id AS branch_id, l.name AS branch_name
                   FROM employees e JOIN users u ON u.id = e.user_id JOIN locations l ON l.id = e.location_id
                  WHERE e.org_id = $1 AND e.is_active = true ORDER BY u.id`,
                [ctx.orgId]
            );
            members = linked.rows.map((m: any) => ({
                user_id: m.user_id, email: m.email, full_name: m.full_name, is_active: m.is_active, assignment_id: null,
                scope: { all: false, branches: [{ id: m.branch_id, name: m.branch_name }] },
            }));
        } else {
            const stored = await query(
                `SELECT ur.id AS assignment_id, u.id AS user_id, u.email, u.full_name, u.is_active, ur.scope_all,
                        COALESCE(json_agg(json_build_object('id', l.id, 'name', l.name) ORDER BY l.name) FILTER (WHERE l.id IS NOT NULL), '[]'::json) AS branches
                   FROM user_roles ur
                   JOIN users u ON u.id = ur.user_id
                   LEFT JOIN user_role_branches urb ON urb.user_role_id = ur.id
                   LEFT JOIN locations l ON l.id = urb.location_id
                  WHERE ur.org_id = $1 AND ur.role_id = $2
                  GROUP BY ur.id, u.id
                  ORDER BY lower(COALESCE(u.full_name, u.email))`,
                [ctx.orgId, role.id]
            );
            members = stored.rows.map((m: any) => ({
                assignment_id: m.assignment_id, user_id: m.user_id, email: m.email, full_name: m.full_name, is_active: m.is_active,
                scope: { all: m.scope_all, branches: m.branches },
            }));
        }
        res.json({
            success: true,
            data: { ...describeRole(role, counts.get(role.id) ?? 0, hasPermission(ctx, Permission.ROLES_MANAGE), ctx.isOwner), members },
        });
    } catch (err) {
        sendError(res, err, 'ROLE GET ERROR');
    }
});

/** POST /api/roles  { name, description?, permissions: [] } — a custom role. */
router.post('/', requirePermission(Permission.ROLES_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const name = readName(req.body?.name);
        const description = readDescription(req.body?.description);
        const permissions = readPermissionList(req.body?.permissions ?? []);
        await assertCovers(ctx, permissions, 'organisation', `create the role “${name}”`);

        const id = crypto.randomUUID();
        try {
            await withTransaction(async (tx) => {
                await tx('INSERT INTO roles (id, org_id, name, description, created_by) VALUES ($1, $2, $3, $4, $5)', [id, ctx.orgId, name, description, ctx.userId]);
                for (const key of permissions) await tx('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)', [id, key]);
            });
        } catch (err) {
            if (isUniqueViolation(err)) throw nameTaken();
            throw err;
        }
        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'ROLE_CREATED', entityType: 'role', entityId: id,
            newValue: permissions.join(', '), details: `Created role “${name}” with ${permissions.length} permission(s)`,
        });
        res.status(201).json({ success: true, data: { id }, message: `Role “${name}” created.` });
    } catch (err) {
        sendError(res, err, 'ROLE CREATE ERROR');
    }
});

/**
 * PUT /api/roles/:id  { name?, description?, permissions? }
 *
 * Custom roles: name, description and permissions. Admin: permissions only, and only the owner.
 * Owner and Employee: never. Whoever edits must hold every permission the role has or is given,
 * organisation-wide, so a role can never be used to reach further than its editor can.
 */
router.put('/:id', requirePermission(Permission.ROLES_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const role = await loadRole(ctx.orgId, req.params.id);
        if (role.systemKey === 'OWNER') throw forbidden('The Owner role has full access and can’t be changed.');
        if (role.systemKey === 'EMPLOYEE') throw forbidden('The Employee role is fixed: it is what the employee portal needs and nothing more.');
        if (role.systemKey === 'ADMIN' && !ctx.isOwner) throw forbidden('Only the owner can change what the Admin role can do.');

        const body = req.body || {};
        const name = body.name === undefined ? role.name : readName(body.name);
        const description = body.description === undefined ? role.description : readDescription(body.description);
        if (role.systemKey === 'ADMIN' && (name !== role.name || description !== role.description)) {
            throw forbidden('The Admin role’s name and description are fixed. You can change its permissions.');
        }
        const permissions = body.permissions === undefined ? role.permissions : readPermissionList(body.permissions);
        const before = new Set(role.permissions);
        const after = new Set<string>(permissions);
        const added = permissions.filter(p => !before.has(p));
        const removed = role.permissions.filter(p => !after.has(p));

        await assertCovers(ctx, [...role.permissions, ...permissions], 'organisation', `change the role “${role.name}”`);

        try {
            await withTransaction(async (tx) => {
                await tx('UPDATE roles SET name = $1, description = $2, updated_at = NOW() WHERE id = $3 AND org_id = $4', [name, description, role.id, ctx.orgId]);
                if (added.length > 0 || removed.length > 0) {
                    await tx('DELETE FROM role_permissions WHERE role_id = $1', [role.id]);
                    for (const key of permissions) await tx('INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)', [role.id, key]);
                }
            });
        } catch (err) {
            if (isUniqueViolation(err)) throw nameTaken();
            throw err;
        }

        if (name !== role.name || description !== role.description) {
            await writeAudit({
                orgId: ctx.orgId, actorId: ctx.userId, action: 'ROLE_UPDATED', entityType: 'role', entityId: role.id,
                previousValue: role.name, newValue: name, details: `Edited role “${role.name}”`,
            });
        }
        if (added.length > 0 || removed.length > 0) {
            const label = (keys: string[]) => keys.map(k => permissionDef(k)?.label ?? k).join(', ') || 'none';
            await writeAudit({
                orgId: ctx.orgId, actorId: ctx.userId, action: 'ROLE_PERMISSIONS_CHANGED', entityType: 'role', entityId: role.id,
                previousValue: role.permissions.join(', '), newValue: permissions.join(', '),
                details: `Role “${name}”. Added: ${label(added)}. Removed: ${label(removed)}.`,
            });
        }
        res.json({ success: true, message: 'Role saved.' });
    } catch (err) {
        sendError(res, err, 'ROLE UPDATE ERROR');
    }
});

/** DELETE /api/roles/:id — custom roles only. People who held it lose it (and any access that came only from it). */
router.delete('/:id', requirePermission(Permission.ROLES_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const role = await loadRole(ctx.orgId, req.params.id);
        if (role.systemKey !== null) throw forbidden(`The ${role.name} role is built in and can’t be deleted.`);
        await assertCovers(ctx, role.permissions, 'organisation', `delete the role “${role.name}”`);

        const members = (await query('SELECT COUNT(*)::int AS n FROM user_roles WHERE org_id = $1 AND role_id = $2', [ctx.orgId, role.id])).rows[0].n;
        await query('DELETE FROM roles WHERE id = $1 AND org_id = $2', [role.id, ctx.orgId]);
        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'ROLE_DELETED', entityType: 'role', entityId: role.id,
            previousValue: role.name, details: `Deleted role “${role.name}”, held by ${members} ${members === 1 ? 'person' : 'people'}`,
        });
        res.json({ success: true, message: `Role “${role.name}” deleted.` });
    } catch (err) {
        sendError(res, err, 'ROLE DELETE ERROR');
    }
});

export default router;
