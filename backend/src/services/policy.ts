import crypto from 'crypto';
import { query } from './db';

/**
 * SimpleHours authorisation model.
 *
 * There are three authenticated roles:
 *   OWNER        — organisations.owner_user_id. Organisation-wide authority.
 *   BRANCH_ADMIN — one row in branch_admins per assigned branch. Branch-scoped authority.
 *   EMPLOYEE     — a worker record (employees table) linked to a login via employees.user_id.
 *                  Holds none of the Permission values below (ROLE_PERMISSIONS.EMPLOYEE is
 *                  empty), so every existing permission check rejects an employee exactly as
 *                  it would reject an unauthenticated caller. Employee-only capability is
 *                  granted by new routes checking `ctx.role === 'EMPLOYEE'` directly, never by
 *                  adding new Permission values.
 *
 * Branches are scopes, not roles.
 *
 * Everything here is resolved from the database on every request. Nothing is read from
 * token claims, URLs, request bodies, query strings or headers to decide what a caller
 * may do; client-supplied branch ids are only ever a filter that is checked against the
 * caller's scope.
 */
export type Role = 'OWNER' | 'BRANCH_ADMIN' | 'EMPLOYEE';

export const Permission = {
    // Organisation-wide (OWNER only)
    ORGANISATION_MANAGE: 'organisation.manage',
    SECURITY_MANAGE: 'security.manage',
    BRANCHES_MANAGE: 'branches.manage',
    BRANCH_ADMINS_MANAGE: 'branch_admins.manage',
    HOLIDAYS_MANAGE: 'holidays.manage',
    AUDIT_VIEW: 'audit.view',
    ANNOUNCEMENTS_MODERATE: 'announcements.moderate',
    // Branch-scoped (OWNER in every branch, BRANCH_ADMIN in assigned branches)
    BRANCH_VIEW: 'branch.view',
    WORKERS_MANAGE: 'workers.manage',
    ROSTERS_MANAGE: 'rosters.manage',
    TIMESHEETS_MANAGE: 'timesheets.manage',
    PERIODS_LOCK: 'periods.lock',
    REPORTS_VIEW: 'reports.view',
} as const;

export type Permission = typeof Permission[keyof typeof Permission];

const BRANCH_SCOPED: ReadonlySet<Permission> = new Set([
    Permission.BRANCH_VIEW,
    Permission.WORKERS_MANAGE,
    Permission.ROSTERS_MANAGE,
    Permission.TIMESHEETS_MANAGE,
    Permission.PERIODS_LOCK,
    Permission.REPORTS_VIEW,
]);

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
    OWNER: new Set(Object.values(Permission)),
    BRANCH_ADMIN: BRANCH_SCOPED,
    EMPLOYEE: new Set(),
};

export interface AccessContext {
    userId: string;
    email: string;
    fullName: string | null;
    orgId: string;
    sessionId: string;
    role: Role;
    /** Branches this account may act in. OWNER: every branch of the organisation. */
    branchIds: string[];
    /** The worker record this login is linked to, when role is EMPLOYEE. Null otherwise. */
    employeeId: string | null;
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

/**
 * Resolves what a user may do in one organisation, or null when they have no access there
 * (unknown or inactive organisation, not the owner, no assignment to an active branch, and
 * no active worker record linked to this login).
 */
export async function resolveAccess(userId: string, orgId: string): Promise<{ role: Role; branchIds: string[]; employeeId: string | null } | null> {
    const res = await query(
        `SELECT o.owner_user_id = $1 AS is_owner,
                ARRAY(SELECT l.id::text FROM locations l WHERE l.org_id = o.id) AS all_branches,
                ARRAY(SELECT ba.location_id::text
                        FROM branch_admins ba
                        JOIN locations l ON l.id = ba.location_id
                       WHERE ba.user_id = $1 AND ba.org_id = o.id AND l.is_active = true) AS assigned_branches,
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
    const row = res.rows[0];
    if (!row) return null;
    if (row.is_owner === true) return { role: 'OWNER', branchIds: row.all_branches, employeeId: null };
    if (row.assigned_branches.length > 0) return { role: 'BRANCH_ADMIN', branchIds: row.assigned_branches, employeeId: null };
    if (row.employee_id) return { role: 'EMPLOYEE', branchIds: [row.employee_branch_id], employeeId: row.employee_id };
    return null;
}

/** Organisations a user can sign in to, with the role they hold in each. */
export async function listAccessibleOrganisations(userId: string): Promise<Array<{ id: string; name: string; portal_slug: string | null; role: Role }>> {
    const res = await query(
        `SELECT o.id, o.name, o.portal_slug,
                CASE
                    WHEN o.owner_user_id = $1 THEN 'OWNER'
                    WHEN EXISTS (SELECT 1 FROM branch_admins ba
                                   JOIN locations l ON l.id = ba.location_id
                                  WHERE ba.org_id = o.id AND ba.user_id = $1 AND l.is_active = true) THEN 'BRANCH_ADMIN'
                    ELSE 'EMPLOYEE'
                END AS role
           FROM organisations o
          WHERE o.is_active = true
            AND (o.owner_user_id = $1
                 OR EXISTS (SELECT 1 FROM branch_admins ba
                              JOIN locations l ON l.id = ba.location_id
                             WHERE ba.org_id = o.id AND ba.user_id = $1 AND l.is_active = true)
                 OR EXISTS (SELECT 1 FROM employees e
                              JOIN locations l ON l.id = e.location_id
                             WHERE e.org_id = o.id AND e.user_id = $1 AND e.is_active = true AND l.is_active = true))
          ORDER BY name ASC`,
        [userId]
    );
    return res.rows;
}

export function hasPermission(ctx: AccessContext, permission: Permission): boolean {
    return ROLE_PERMISSIONS[ctx.role].has(permission);
}

export function isBranchScoped(permission: Permission): boolean {
    return BRANCH_SCOPED.has(permission);
}

export function canAccessBranch(ctx: AccessContext, branchId: string | null | undefined): boolean {
    return Boolean(branchId) && ctx.branchIds.includes(branchId as string);
}

/** Throws 403 unless the caller holds `permission` in `branchId`. The branch id must come from a database row. */
export function assertBranchAccess(ctx: AccessContext, permission: Permission, branchId: string | null | undefined): void {
    if (!hasPermission(ctx, permission) || !canAccessBranch(ctx, branchId)) {
        throw forbidden('You do not have access to this branch.');
    }
}

/**
 * Branch filter for list endpoints. Without a requested branch the caller's whole scope is
 * returned. A requested branch outside that scope is refused (never widened, never ignored).
 */
export function resolveBranchFilter(ctx: AccessContext, permission: Permission, requested?: unknown): string[] {
    if (!hasPermission(ctx, permission)) throw forbidden();
    if (requested === undefined || requested === null || requested === '') return ctx.branchIds;
    if (!isUuid(requested)) throw badRequest('INVALID_BRANCH', 'location_id must be a branch id.');
    if (!canAccessBranch(ctx, requested)) throw forbidden('You do not have access to this branch.');
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

/** Loads a branch of the caller's organisation and authorises the caller against it. */
export async function loadBranch(ctx: AccessContext, permission: Permission, branchId: unknown): Promise<any> {
    if (!isUuid(branchId)) throw notFound('Branch');
    const res = await query('SELECT * FROM locations WHERE id = $1 AND org_id = $2', [branchId, ctx.orgId]);
    const branch = res.rows[0];
    if (!branch) throw notFound('Branch');
    if (isBranchScoped(permission)) {
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
