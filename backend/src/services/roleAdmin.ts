import { query } from './db';
import {
    AccessContext, HttpError, badRequest, canAccessBranch, forbidden, isUuid, notFound, writeAudit,
} from './policy';
import {
    ASSIGNABLE_PERMISSIONS, EMPLOYEE_PERMISSIONS, HIGH_PRIVILEGE_PERMISSIONS, OWNER_PERMISSIONS, Permission, SystemRoleKey,
    isBranchLevel, isPermissionKey, permissionDef,
} from './permissions';
import { hasFreshReauthentication, revokeUserSessionsInOrganisation } from './sessionService';

/**
 * Rules for who may hand out what.
 *
 * The one rule behind all of them: nobody can give, change or take away access they could not
 * exercise themselves. A permission is "covered" for a caller when the caller holds it in the
 * scope in question:
 *   - a branch-level permission over the entire organisation needs the caller to hold it organisation-wide;
 *     over chosen branches it needs the caller to hold it in every one of those branches;
 *   - an organisation-level permission is only effective from an entire-organisation assignment,
 *     so it needs the caller to hold it organisation-wide (and does nothing on a branch-scoped one).
 * On top of that: nobody edits their own access, the Owner's access is never assigned or removed,
 * and the built-in roles are fixed as documented in permissions.ts.
 */

export interface ScopeInput {
    all: boolean;
    branchIds: string[];
}

export interface RoleRecord {
    id: string;
    name: string;
    description: string | null;
    systemKey: SystemRoleKey | null;
    permissions: string[];
    createdAt: string;
}

/** Permissions that hold for a role: Owner and Employee are defined in code, Admin and custom roles in the database. */
export function permissionsOfSystemRole(key: SystemRoleKey | null): readonly string[] | null {
    if (key === 'OWNER') return OWNER_PERMISSIONS;
    if (key === 'EMPLOYEE') return EMPLOYEE_PERMISSIONS;
    return null;
}

/** Loads a role of THIS organisation. An id from another organisation is simply "not found". */
export async function loadRole(orgId: string, roleId: unknown): Promise<RoleRecord> {
    if (!isUuid(roleId)) throw notFound('Role');
    const res = await query(
        `SELECT r.id, r.name, r.description, r.system_key, r.created_at,
                ARRAY(SELECT rp.permission_key FROM role_permissions rp WHERE rp.role_id = r.id ORDER BY rp.permission_key) AS permissions
           FROM roles r WHERE r.id = $1 AND r.org_id = $2`,
        [roleId, orgId]
    );
    const row = res.rows[0];
    if (!row) throw notFound('Role');
    const fixed = permissionsOfSystemRole(row.system_key);
    return {
        id: row.id, name: row.name, description: row.description, systemKey: row.system_key,
        permissions: fixed ? [...fixed] : row.permissions, createdAt: row.created_at,
    };
}

/** Reads and validates a permission list from a request: known, hand-out-able, no duplicates. */
export function readPermissionList(value: unknown): Permission[] {
    if (!Array.isArray(value) || value.length > ASSIGNABLE_PERMISSIONS.length) {
        throw badRequest('VALIDATION_FAILED', 'permissions must be a list of permission keys.');
    }
    const seen = new Set<string>();
    for (const key of value) {
        if (!isPermissionKey(key)) throw badRequest('VALIDATION_FAILED', 'One of the permissions is not recognised.');
        if (!(ASSIGNABLE_PERMISSIONS as readonly string[]).includes(key)) {
            throw badRequest('VALIDATION_FAILED', `“${permissionDef(key)?.label ?? key}” belongs to the Employee role and can’t be added to other roles.`);
        }
        seen.add(key);
    }
    return [...seen] as Permission[];
}

/** Reads a scope from a request: the entire organisation, or a non-empty set of active branches of this organisation. */
export async function readScope(orgId: string, value: any): Promise<ScopeInput> {
    if (!value || typeof value !== 'object') throw badRequest('VALIDATION_FAILED', 'Choose the entire organisation or at least one branch.');
    if (value.all === true) return { all: true, branchIds: [] };
    const ids = value.branch_ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id: unknown) => !isUuid(id))) {
        throw badRequest('VALIDATION_FAILED', 'Choose the entire organisation or at least one branch.');
    }
    const unique = Array.from(new Set(ids as string[]));
    const found = await query('SELECT id FROM locations WHERE org_id = $1 AND is_active = true AND id = ANY($2::uuid[])', [orgId, unique]);
    if (found.rows.length !== unique.length) throw new HttpError(404, 'NOT_FOUND', 'One or more branches were not found.');
    return { all: false, branchIds: unique };
}

/** The permissions in `permissions` the caller may NOT hand out (or take away) over `scope`. */
export function uncoveredPermissions(ctx: AccessContext, permissions: readonly string[], scope: ScopeInput | 'organisation'): string[] {
    const entireOrganisation = scope === 'organisation' || scope.all;
    return permissions.filter(permission => {
        // Over chosen branches an organisation-level permission has no effect, so nothing is handed out.
        if (!entireOrganisation && !isBranchLevel(permission)) return false;
        const grant = ctx.grants.get(permission);
        if (!grant) return true;
        if (!entireOrganisation) return !(scope as ScopeInput).branchIds.every(id => canAccessBranch(ctx, permission as Permission, id));
        // Over the entire organisation the caller must hold the permission organisation-wide.
        return !grant.all;
    });
}

const labels = (keys: string[]) => keys.map(k => permissionDef(k)?.label ?? k).join(', ');

/** Throws 403 (and records the attempt) unless the caller covers every permission over the scope. */
export async function assertCovers(ctx: AccessContext, permissions: readonly string[], scope: ScopeInput | 'organisation', action: string, ip?: string | null): Promise<void> {
    const missing = uncoveredPermissions(ctx, permissions, scope);
    if (missing.length === 0) return;
    await writeAudit({
        orgId: ctx.orgId, actorId: ctx.userId, action: 'ACCESS_ESCALATION_BLOCKED', entityType: 'role',
        details: `Blocked: ${action}. Missing: ${labels(missing)}`, ip: ip ?? null,
    });
    throw forbidden(`You can’t do this because it includes access you don’t have yourself: ${labels(missing)}.`);
}

/** The people the caller may never change through role administration: themselves and the owner. */
export async function assertCanChangeUser(ctx: AccessContext, rawTargetUserId: string): Promise<void> {
    // UUIDs are case-insensitive in the database, so they must be here too ("ABC…" is the same person as "abc…").
    const targetUserId = String(rawTargetUserId).toLowerCase();
    if (targetUserId === ctx.userId.toLowerCase()) {
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'ACCESS_ESCALATION_BLOCKED', entityType: 'user', targetUserId, details: 'Blocked: changing own access' });
        throw forbidden('You can’t change your own access. Ask the owner or another administrator.');
    }
    const owner = await query('SELECT owner_user_id FROM organisations WHERE id = $1', [ctx.orgId]);
    if (String(owner.rows[0]?.owner_user_id ?? '').toLowerCase() === targetUserId) {
        throw forbidden('The owner has full access to the organisation. It can’t be assigned or removed.');
    }
}

/** True when the person belongs to this organisation: they hold a role assignment or an active worker record is linked to their login. */
export async function isMemberOfOrganisation(orgId: string, userId: string): Promise<boolean> {
    const res = await query(
        `SELECT EXISTS (SELECT 1 FROM user_roles WHERE org_id = $1 AND user_id = $2)
             OR EXISTS (SELECT 1 FROM employees WHERE org_id = $1 AND user_id = $2 AND is_active = true) AS member`,
        [orgId, userId]
    );
    return res.rows[0].member === true;
}

/** Everything a person's existing assignments in this organisation give them, as [permissions, scope] pairs. */
export async function assignmentsOf(orgId: string, userId: string): Promise<Array<{ id: string; roleId: string; roleName: string; systemKey: SystemRoleKey | null; permissions: string[]; scope: ScopeInput }>> {
    const res = await query(
        `SELECT ur.id, ur.role_id, r.name, r.system_key, ur.scope_all,
                ARRAY(SELECT urb.location_id::text FROM user_role_branches urb WHERE urb.user_role_id = ur.id) AS branch_ids,
                ARRAY(SELECT rp.permission_key FROM role_permissions rp WHERE rp.role_id = r.id) AS permissions
           FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.org_id = ur.org_id
          WHERE ur.org_id = $1 AND ur.user_id = $2
          ORDER BY r.name ASC`,
        [orgId, userId]
    );
    return res.rows.map((row: any) => ({
        id: row.id, roleId: row.role_id, roleName: row.name, systemKey: row.system_key, permissions: row.permissions,
        scope: { all: row.scope_all === true, branchIds: row.branch_ids },
    }));
}

/**
 * The caller may act on a person's login (e.g. issue a password-reset link) only when they could
 * hand out everything that person holds: otherwise resetting the password would be a way to take
 * over more access than the caller has.
 */
export async function assertCoversUser(ctx: AccessContext, targetUserId: string, action: string): Promise<void> {
    for (const assignment of await assignmentsOf(ctx.orgId, targetUserId)) {
        await assertCovers(ctx, assignment.permissions, assignment.scope, action);
    }
}

/**
 * Handing out organisation-wide control (managing people, roles, security, branches or the
 * organisation itself) needs the caller's password again, within the last few minutes
 * (POST /api/auth/reauthenticate). It applies to everyone, the owner included, so a session left
 * open on a shared computer can't be used to give someone else the keys. `permissions` is what is
 * being handed out; over chosen branches organisation-level permissions do nothing, so nothing is
 * checked there.
 */
export async function assertReauthenticatedToGrant(ctx: AccessContext, permissions: readonly string[], scope: ScopeInput | 'organisation'): Promise<void> {
    if (scope !== 'organisation' && !scope.all) return;
    if (!permissions.some(p => (HIGH_PRIVILEGE_PERMISSIONS as readonly string[]).includes(p))) return;
    if (await hasFreshReauthentication(ctx.sessionId)) return;
    throw new HttpError(403, 'REAUTH_REQUIRED', 'This gives organisation-wide control. Enter your password to continue.');
}

/** After a change: someone left with no access here at all has their sessions here ended straight away. */
export async function endSessionsIfNoAccess(orgId: string, userId: string): Promise<void> {
    const res = await query(
        `SELECT (o.owner_user_id = $2
                 OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.org_id = o.id AND ur.user_id = $2)
                 OR EXISTS (SELECT 1 FROM employees e WHERE e.org_id = o.id AND e.user_id = $2 AND e.is_active = true)) AS has_access
           FROM organisations o WHERE o.id = $1`,
        [orgId, userId]
    );
    if (res.rows[0] && res.rows[0].has_access !== true) await revokeUserSessionsInOrganisation(userId, orgId);
}

