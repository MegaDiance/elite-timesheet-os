import crypto from 'crypto';
import { query } from './db';
import {
    ASSIGNABLE_PERMISSIONS, EMPLOYEE_PERMISSIONS, OWNER_PERMISSIONS, Permission, SystemRoleKey,
    isBranchLevel, isPermissionKey, permissionLevel,
} from './permissions';

export { Permission };

/**
 * SimpleHours authorisation model.
 *
 *   authenticated user → organisation (from the server-side session) → assignments (role + scope)
 *                      → permissions → branches
 *
 * A person's effective access in an organisation is the union of:
 *   - the Owner role, when they are organisations.owner_user_id (every permission, entire organisation);
 *   - each role assignment in user_roles, restricted to that assignment's scope (the entire
 *     organisation, or the branches listed for it). Organisation-level permissions (users.manage,
 *     roles.manage, …) only count from an entire-organisation assignment, so a branch-scoped role
 *     can never reach across the organisation;
 *   - the Employee role, when they are linked to an active worker record (own-portal permissions only).
 *
 * Everything here is resolved from the database on every request. Nothing is read from token
 * claims, URLs, request bodies, query strings or headers to decide what a caller may do; client-
 * supplied branch ids are only ever a filter that is checked against the caller's scope. Code asks
 * "does this caller hold permission P (in branch B)?" and never asks which role they have.
 */

/** Where one permission applies for a caller. */
export interface Grant {
    /** The entire organisation, including branches added later. */
    all: boolean;
    /** The branches it applies in when `all` is false. */
    branchIds: Set<string>;
}

export interface RoleRef {
    id: string | null;
    name: string;
    systemKey: SystemRoleKey | null;
}

export interface AccessContext {
    userId: string;
    email: string;
    fullName: string | null;
    orgId: string;
    sessionId: string;
    /** The roles this account holds here. Display only; authorisation uses `grants`. */
    roles: RoleRef[];
    /** organisations.owner_user_id — the one account that cannot lose its access by role changes. */
    isOwner: boolean;
    /** Every permission this account holds here, and where. */
    grants: ReadonlyMap<string, Grant>;
    /** Every branch of the organisation (what an entire-organisation grant covers). */
    allBranchIds: string[];
    /** Branches this account can see or act in: the union of its grants' scopes (and its own branch, for an employee). */
    branchIds: string[];
    /** The worker record this login is linked to, if any. */
    employeeId: string | null;
    employeeBranchId: string | null;
}

export class HttpError extends Error {
    constructor(public status: number, public code: string, message: string) {
        super(message);
    }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found.`);
export const forbidden = (message = 'You do not have access to this.') => new HttpError(403, 'FORBIDDEN', message);
export const badRequest = (code: string, message: string) => new HttpError(400, code, message);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);

export type ResolvedAccess = Pick<AccessContext, 'roles' | 'isOwner' | 'grants' | 'allBranchIds' | 'branchIds' | 'employeeId' | 'employeeBranchId'>;

/**
 * Resolves what a user may do in one organisation, or null when they have no access there
 * (unknown or inactive organisation, not the owner, no role assignment that grants anything, and
 * no active worker record linked to this login).
 */
export async function resolveAccess(userId: string, orgId: string): Promise<ResolvedAccess | null> {
    const orgRes = await query(
        `SELECT o.owner_user_id = $1 AS is_owner,
                ARRAY(SELECT l.id::text FROM locations l WHERE l.org_id = o.id) AS all_branches,
                (SELECT e.id::text
                   FROM employees e
                   JOIN locations l ON l.id = e.location_id AND l.is_active = true
                  WHERE e.user_id = $1 AND e.org_id = o.id AND e.is_active = true
                  LIMIT 1) AS employee_id,
                (SELECT e.location_id::text
                   FROM employees e
                   JOIN locations l ON l.id = e.location_id AND l.is_active = true
                  WHERE e.user_id = $1 AND e.org_id = o.id AND e.is_active = true
                  LIMIT 1) AS employee_branch_id
           FROM organisations o
          WHERE o.id = $2 AND o.is_active = true`,
        [userId, orgId]
    );
    const org = orgRes.rows[0];
    if (!org) return null;

    const assignments = (await query(
        `SELECT r.id AS role_id, r.name, r.system_key, ur.scope_all,
                ARRAY(SELECT urb.location_id::text
                        FROM user_role_branches urb
                        JOIN locations l ON l.id = urb.location_id AND l.org_id = urb.org_id
                       WHERE urb.user_role_id = ur.id AND l.is_active = true) AS branch_ids,
                ARRAY(SELECT rp.permission_key FROM role_permissions rp WHERE rp.role_id = r.id) AS permissions
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id AND r.org_id = ur.org_id
          WHERE ur.user_id = $1 AND ur.org_id = $2
          ORDER BY r.name ASC`,
        [userId, orgId]
    )).rows;

    const grants = new Map<string, Grant>();
    const roles: RoleRef[] = [];
    const grant = (permission: string, all: boolean, branches: Iterable<string>) => {
        const entry = grants.get(permission) || { all: false, branchIds: new Set<string>() };
        if (all) entry.all = true;
        for (const id of branches) entry.branchIds.add(id);
        grants.set(permission, entry);
    };

    if (org.is_owner === true) {
        roles.push({ id: null, name: 'Owner', systemKey: 'OWNER' });
        for (const permission of OWNER_PERMISSIONS) grant(permission, true, org.all_branches);
    }

    for (const assignment of assignments) {
        // Owner and Employee access is derived from the organisation and the worker record, never
        // from an assignment row, so such a row (which nothing creates) would grant nothing.
        if (assignment.system_key === 'OWNER' || assignment.system_key === 'EMPLOYEE') continue;
        const scopeAll: boolean = assignment.scope_all === true;
        let counted = false;
        for (const permission of assignment.permissions as string[]) {
            // Only permissions an administrator may hand out count: a stored self-service or unknown key is ignored.
            if (!isPermissionKey(permission) || !(ASSIGNABLE_PERMISSIONS as readonly string[]).includes(permission)) continue;
            if (isBranchLevel(permission)) {
                if (scopeAll) grant(permission, true, org.all_branches);
                else if (assignment.branch_ids.length > 0) grant(permission, false, assignment.branch_ids);
                else continue;
            } else if (scopeAll) {
                grant(permission, true, []);
            } else {
                continue;
            }
            counted = true;
        }
        if (counted) {
            roles.push({ id: assignment.role_id, name: assignment.name, systemKey: assignment.system_key });
        }
    }

    if (org.employee_id) {
        roles.push({ id: null, name: 'Employee', systemKey: 'EMPLOYEE' });
        for (const permission of EMPLOYEE_PERMISSIONS) grant(permission, false, [org.employee_branch_id]);
    }

    if (grants.size === 0) return null;

    const branchIds = new Set<string>();
    for (const [permission, entry] of grants) {
        if (permissionLevel(permission) !== 'branch' && permissionLevel(permission) !== 'self') continue;
        for (const id of entry.all ? org.all_branches : entry.branchIds) branchIds.add(id);
    }
    return {
        roles, isOwner: org.is_owner === true, grants,
        allBranchIds: org.all_branches, branchIds: [...branchIds],
        employeeId: org.employee_id ?? null, employeeBranchId: org.employee_branch_id ?? null,
    };
}

/** Organisations a user can sign in to, with the roles they hold in each. */
export async function listAccessibleOrganisations(userId: string): Promise<Array<{ id: string; name: string; roles: string[] }>> {
    const candidates = await query(
        `SELECT o.id, o.name
           FROM organisations o
          WHERE o.is_active = true
            AND (o.owner_user_id = $1
                 OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.org_id = o.id AND ur.user_id = $1)
                 OR EXISTS (SELECT 1 FROM employees e
                              JOIN locations l ON l.id = e.location_id
                             WHERE e.org_id = o.id AND e.user_id = $1 AND e.is_active = true AND l.is_active = true))
          ORDER BY o.name ASC`,
        [userId]
    );
    const result: Array<{ id: string; name: string; roles: string[] }> = [];
    for (const org of candidates.rows) {
        const access = await resolveAccess(userId, org.id);
        if (access) result.push({ id: org.id, name: org.name, roles: access.roles.map(r => r.name) });
    }
    return result;
}

/** How many other active organisations this login could sign in to (a cheap count; used to decide whether to offer "Switch organisation"). */
export async function countOtherOrganisations(userId: string, currentOrgId: string): Promise<number> {
    const res = await query(
        `SELECT COUNT(*)::int AS n
           FROM organisations o
          WHERE o.is_active = true AND o.id <> $2
            AND (o.owner_user_id = $1
                 OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.org_id = o.id AND ur.user_id = $1)
                 OR EXISTS (SELECT 1 FROM employees e
                              JOIN locations l ON l.id = e.location_id
                             WHERE e.org_id = o.id AND e.user_id = $1 AND e.is_active = true AND l.is_active = true))`,
        [userId, currentOrgId]
    );
    return res.rows[0].n;
}

/**
 * A login is global (one person, one account), so a password reset changes it everywhere. Before
 * someone with access to THIS organisation issues a reset link for a login, the login must have no
 * access they are not entitled to hand out: it must not own any organisation, and must have no
 * access in any other organisation. `allowTeamMemberHere` is false when the caller is resetting an
 * employee login, so a reset link can never be created for a team member of the same organisation
 * through a worker record either. Throws 409 otherwise.
 */
export async function assertResettableLogin(userId: string, orgId: string, opts: { allowTeamMemberHere: boolean }): Promise<void> {
    const res = await query(
        `SELECT EXISTS (SELECT 1 FROM organisations WHERE owner_user_id = $1) AS owns_any,
                EXISTS (SELECT 1 FROM user_roles WHERE user_id = $1 AND org_id <> $2) AS team_elsewhere,
                EXISTS (SELECT 1 FROM user_roles WHERE user_id = $1 AND org_id = $2) AS team_here,
                EXISTS (SELECT 1 FROM employees WHERE user_id = $1 AND org_id <> $2) AS employee_elsewhere`,
        [userId, orgId]
    );
    const r = res.rows[0];
    if (r.owns_any || r.team_elsewhere || r.employee_elsewhere || (!opts.allowTeamMemberHere && r.team_here)) {
        throw new HttpError(409, 'ACCOUNT_HAS_OTHER_ACCESS',
            'This login is also used for other access, so a reset link can’t be created for it here. The person can reset it themselves with “Forgot password?” on their sign-in page.');
    }
}

/** True when the caller holds `permission` somewhere (an organisation-level permission is only ever held organisation-wide). */
export function hasPermission(ctx: Pick<AccessContext, 'grants'>, permission: Permission): boolean {
    const grant = ctx.grants.get(permission);
    return Boolean(grant && (grant.all || grant.branchIds.size > 0));
}

export function hasAnyPermission(ctx: AccessContext, permissions: readonly Permission[]): boolean {
    return permissions.some(p => hasPermission(ctx, p));
}

/** The caller can act on the organisation's data in at least one way (anything beyond the employee's own portal). */
export function hasManagementAccess(ctx: Pick<AccessContext, 'grants'>): boolean {
    for (const permission of ctx.grants.keys()) {
        if (permissionLevel(permission) !== 'self' && hasPermission(ctx, permission as Permission)) return true;
    }
    return false;
}

/** The branches where `permission` applies for the caller. */
export function scopedBranchIds(ctx: AccessContext, permission: Permission): string[] {
    const grant = ctx.grants.get(permission);
    if (!grant) return [];
    return grant.all ? ctx.allBranchIds : [...grant.branchIds];
}

export function canAccessBranch(ctx: AccessContext, permission: Permission, branchId: string | null | undefined): boolean {
    if (!branchId) return false;
    const grant = ctx.grants.get(permission);
    if (!grant) return false;
    return grant.all ? ctx.allBranchIds.includes(branchId) : grant.branchIds.has(branchId);
}

/** Throws 403 unless the caller holds `permission` in `branchId`. The branch id must come from a database row. */
export function assertBranchAccess(ctx: AccessContext, permission: Permission, branchId: string | null | undefined): void {
    if (!canAccessBranch(ctx, permission, branchId)) {
        throw forbidden('You do not have access to this branch.');
    }
}

/**
 * Branch filter for list endpoints. Without a requested branch the whole scope of the permission is
 * returned. A requested branch outside that scope is refused (never widened, never ignored).
 */
export function resolveBranchFilter(ctx: AccessContext, permission: Permission, requested?: unknown): string[] {
    if (!hasPermission(ctx, permission)) throw forbidden();
    const scope = scopedBranchIds(ctx, permission);
    if (requested === undefined || requested === null || requested === '') return scope;
    if (!isUuid(requested)) throw badRequest('INVALID_BRANCH', 'location_id must be a branch id.');
    if (!scope.includes(requested)) throw forbidden('You do not have access to this branch.');
    return [requested];
}

/** As resolveBranchFilter, for a screen several permissions open: the union of their scopes. */
export function resolveBranchFilterAny(ctx: AccessContext, permissions: readonly Permission[], requested?: unknown): string[] {
    const held = permissions.filter(p => hasPermission(ctx, p));
    if (held.length === 0) throw forbidden();
    const scope = Array.from(new Set(held.flatMap(p => scopedBranchIds(ctx, p))));
    if (requested === undefined || requested === null || requested === '') return scope;
    if (!isUuid(requested)) throw badRequest('INVALID_BRANCH', 'location_id must be a branch id.');
    if (!scope.includes(requested)) throw forbidden('You do not have access to this branch.');
    return [requested];
}

export interface WorkerRow {
    id: string;
    org_id: string;
    location_id: string;
    full_name: string;
    is_active: boolean;
    email: string | null;
    /** The employee-portal login linked to this worker, if any. */
    user_id: string | null;
}

/**
 * Loads a worker record inside the caller's organisation and authorises the caller against
 * the worker's own branch. 404 when the id is not in this organisation (other tenants'
 * records are never confirmed to exist), 403 when it is in a branch outside the caller's scope.
 */
export async function loadWorker(ctx: AccessContext, permission: Permission, workerId: unknown): Promise<WorkerRow> {
    if (!isUuid(workerId)) throw notFound('Worker');
    const res = await query(
        'SELECT id, org_id, location_id, full_name, is_active, email, user_id FROM employees WHERE id = $1 AND org_id = $2',
        [workerId, ctx.orgId]
    );
    const worker: WorkerRow | undefined = res.rows[0];
    if (!worker) throw notFound('Worker');
    assertBranchAccess(ctx, permission, worker.location_id);
    return worker;
}

/**
 * As loadWorker, for screens several permissions open: the caller is authorised when ANY of the
 * permissions applies in the worker's own branch.
 */
export async function loadWorkerAny(ctx: AccessContext, permissions: readonly Permission[], workerId: unknown): Promise<WorkerRow> {
    if (!isUuid(workerId)) throw notFound('Worker');
    const res = await query(
        'SELECT id, org_id, location_id, full_name, is_active, email, user_id FROM employees WHERE id = $1 AND org_id = $2',
        [workerId, ctx.orgId]
    );
    const worker: WorkerRow | undefined = res.rows[0];
    if (!worker) throw notFound('Worker');
    if (!permissions.some(p => canAccessBranch(ctx, p, worker.location_id))) throw forbidden('You do not have access to this branch.');
    return worker;
}

/**
 * Loads a branch of the caller's organisation and authorises the caller against it: a branch-level
 * permission must apply in this branch, an organisation-level one must be held organisation-wide.
 */
export async function loadBranch(ctx: AccessContext, permission: Permission, branchId: unknown): Promise<any> {
    if (!isUuid(branchId)) throw notFound('Branch');
    const res = await query('SELECT * FROM locations WHERE id = $1 AND org_id = $2', [branchId, ctx.orgId]);
    const branch = res.rows[0];
    if (!branch) throw notFound('Branch');
    if (isBranchLevel(permission)) {
        assertBranchAccess(ctx, permission, branch.id);
    } else if (!hasPermission(ctx, permission)) {
        throw forbidden();
    }
    return branch;
}

/** Single writer for audit_logs. Never throws: an audit failure is logged, not surfaced to the caller. */
export async function writeAudit(entry: {
    orgId: string;
    actorId: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    branchId?: string | null;
    targetUserId?: string | null;
    previousValue?: string | null;
    newValue?: string | null;
    details?: string | null;
    ip?: string | null;
}): Promise<void> {
    try {
        await query(
            `INSERT INTO audit_logs (id, org_id, location_id, actor_id, target_user_id, action, entity_type, entity_id,
                                     previous_value, new_value, details, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
                crypto.randomUUID(),
                entry.orgId,
                entry.branchId || null,
                entry.actorId,
                entry.targetUserId || null,
                entry.action,
                entry.entityType || null,
                isUuid(entry.entityId) ? entry.entityId : null,
                entry.previousValue ?? null,
                entry.newValue ?? null,
                entry.details ?? null,
                entry.ip || null,
            ]
        );
    } catch (err) {
        console.error('[AUDIT LOG ERROR]', err);
    }
}
