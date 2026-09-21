import crypto from 'crypto';
import { query } from './db';

/**
 * 18 Explicit Permissions across Organisation, Branch, Roster, Timesheet, Leave, and Reports.
 */
export enum Permission {
    // Organisation-level permissions
    ORGANISATION_VIEW = 'ORGANISATION_VIEW',
    ORGANISATION_UPDATE = 'ORGANISATION_UPDATE',
    ORGANISATION_MANAGE_USERS = 'ORGANISATION_MANAGE_USERS',
    ORGANISATION_MANAGE_BRANCHES = 'ORGANISATION_MANAGE_BRANCHES',

    // Branch-level permissions
    BRANCH_VIEW = 'BRANCH_VIEW',
    BRANCH_UPDATE = 'BRANCH_UPDATE',
    BRANCH_MANAGE_USERS = 'BRANCH_MANAGE_USERS',
    BRANCH_MANAGE_STAFF = 'BRANCH_MANAGE_STAFF',

    // Roster permissions
    ROSTER_VIEW = 'ROSTER_VIEW',
    ROSTER_CREATE = 'ROSTER_CREATE',
    ROSTER_UPDATE = 'ROSTER_UPDATE',
    ROSTER_DELETE = 'ROSTER_DELETE',

    // Timesheet permissions
    // CRITICAL: Organisation roles do NOT automatically receive these permissions!
    TIMESHEET_VIEW = 'TIMESHEET_VIEW',
    TIMESHEET_REVIEW = 'TIMESHEET_REVIEW',
    TIMESHEET_APPROVE = 'TIMESHEET_APPROVE',
    TIMESHEET_LOCK = 'TIMESHEET_LOCK',

    // Leave permissions
    LEAVE_VIEW = 'LEAVE_VIEW',
    LEAVE_REVIEW = 'LEAVE_REVIEW',
    LEAVE_APPROVE = 'LEAVE_APPROVE',

    // Reporting permissions
    REPORT_VIEW = 'REPORT_VIEW',
}

/**
 * Canonical Organisation Roles
 */
export enum OrgRole {
    OWNER = 'OWNER',
    ORG_ADMIN = 'ORG_ADMIN',
    ORG_MANAGER = 'ORG_MANAGER',
}

/**
 * Canonical Branch Roles
 */
export enum BranchRole {
    BRANCH_ADMIN = 'BRANCH_ADMIN',
    BRANCH_MANAGER = 'BRANCH_MANAGER',
    EMPLOYEE = 'EMPLOYEE',
}

/**
 * Normalizes legacy or mixed-cased organisation role strings into canonical OrgRole.
 */
export function normalizeOrgRole(raw?: string | null): OrgRole | null {
    if (!raw) return null;
    const clean = raw.trim().toUpperCase();
    if (clean === 'OWNER') return OrgRole.OWNER;
    if (clean === 'COMPANY ADMIN' || clean === 'COMPANY_ADMIN') return OrgRole.OWNER;
    if (clean === 'ORG_ADMIN' || clean === 'ORG ADMIN' || clean === 'ADMIN') return OrgRole.ORG_ADMIN;
    if (clean === 'ORG_MANAGER' || clean === 'ORG MANAGER' || clean === 'MANAGER') return OrgRole.ORG_MANAGER;
    return null;
}

/**
 * Normalizes legacy or mixed-cased branch role strings into canonical BranchRole.
 */
export function normalizeBranchRole(raw?: string | null): BranchRole | null {
    if (!raw) return null;
    const clean = raw.trim().toUpperCase();
    if (clean === 'BRANCH_ADMIN' || clean === 'BRANCH ADMIN' || clean === 'ADMIN') return BranchRole.BRANCH_ADMIN;
    if (clean === 'BRANCH_MANAGER' || clean === 'BRANCH MANAGER' || clean === 'MANAGER') return BranchRole.BRANCH_MANAGER;
    if (clean === 'EMPLOYEE' || clean === 'STAFF') return BranchRole.EMPLOYEE;
    return null;
}

/**
 * Explicit Role-to-Permission mapping for Organisation Roles.
 * NOTE: Timesheet and operational roster permissions are INTENTIONALLY excluded here.
 */
export const ORG_ROLE_PERMISSIONS: Record<OrgRole, ReadonlySet<Permission>> = {
    [OrgRole.OWNER]: new Set([
        Permission.ORGANISATION_VIEW,
        Permission.ORGANISATION_UPDATE,
        Permission.ORGANISATION_MANAGE_USERS,
        Permission.ORGANISATION_MANAGE_BRANCHES,
        Permission.BRANCH_VIEW,
        Permission.BRANCH_UPDATE,
        Permission.BRANCH_MANAGE_USERS,
        Permission.REPORT_VIEW,
    ]),
    [OrgRole.ORG_ADMIN]: new Set([
        Permission.ORGANISATION_VIEW,
        Permission.ORGANISATION_UPDATE,
        Permission.ORGANISATION_MANAGE_USERS,
        Permission.ORGANISATION_MANAGE_BRANCHES,
        Permission.BRANCH_VIEW,
        Permission.BRANCH_UPDATE,
        Permission.BRANCH_MANAGE_USERS,
        Permission.REPORT_VIEW,
    ]),
    [OrgRole.ORG_MANAGER]: new Set([
        Permission.ORGANISATION_VIEW,
        Permission.BRANCH_VIEW,
        Permission.REPORT_VIEW,
    ]),
};

/**
 * Explicit Role-to-Permission mapping for Branch Roles (scoped to the assigned branch).
 */
export const BRANCH_ROLE_PERMISSIONS: Record<BranchRole, ReadonlySet<Permission>> = {
    [BranchRole.BRANCH_ADMIN]: new Set([
        Permission.BRANCH_VIEW,
        Permission.BRANCH_UPDATE,
        Permission.BRANCH_MANAGE_USERS,
        Permission.BRANCH_MANAGE_STAFF,
        Permission.ROSTER_VIEW,
        Permission.ROSTER_CREATE,
        Permission.ROSTER_UPDATE,
        Permission.ROSTER_DELETE,
        Permission.TIMESHEET_VIEW,
        Permission.TIMESHEET_REVIEW,
        Permission.TIMESHEET_APPROVE,
        Permission.TIMESHEET_LOCK,
        Permission.LEAVE_VIEW,
        Permission.LEAVE_REVIEW,
        Permission.LEAVE_APPROVE,
        Permission.REPORT_VIEW,
    ]),
    [BranchRole.BRANCH_MANAGER]: new Set([
        Permission.BRANCH_VIEW,
        Permission.BRANCH_MANAGE_STAFF,
        Permission.ROSTER_VIEW,
        Permission.ROSTER_CREATE,
        Permission.ROSTER_UPDATE,
        Permission.ROSTER_DELETE,
        Permission.TIMESHEET_VIEW,
        Permission.TIMESHEET_REVIEW,
        Permission.TIMESHEET_APPROVE,
        Permission.LEAVE_VIEW,
        Permission.LEAVE_REVIEW,
        Permission.LEAVE_APPROVE,
        Permission.REPORT_VIEW,
    ]),
    [BranchRole.EMPLOYEE]: new Set([]),
};

export interface BranchMembershipInfo {
    branchId: string;
    branchName?: string;
    role: BranchRole;
    isActive: boolean;
}

export interface UserSecurityContext {
    userId: string;
    email?: string;
    orgId: string;
    isPlatformAdmin: boolean;
    orgRole: OrgRole | null;
    branchMemberships: BranchMembershipInfo[];
    activeBranchId?: string | null;
    activeBranchRole?: BranchRole | null;
    effectivePermissions: Set<Permission>;
}

/**
 * Resolves the complete multi-tenant security context for a user in an organisation.
 */
export async function resolveUserSecurityContext(
    userId: string,
    orgId: string,
    requestedBranchId?: string | null,
    jwtRole?: string
): Promise<UserSecurityContext> {
    const isPlatformAdmin = jwtRole === 'Platform Admin';

    if (isPlatformAdmin) {
        const allPermissions = new Set<Permission>(Object.values(Permission));
        return {
            userId,
            orgId,
            isPlatformAdmin: true,
            orgRole: OrgRole.OWNER,
            branchMemberships: [],
            activeBranchId: requestedBranchId || null,
            activeBranchRole: BranchRole.BRANCH_ADMIN,
            effectivePermissions: allPermissions,
        };
    }

    // 1. Resolve Organisation Role
    let resolvedOrgRole: OrgRole | null = null;

    try {
        const orgRes = await query('SELECT owner_user_id FROM organisations WHERE id = $1', [orgId]);
        if (orgRes.rows.length > 0 && orgRes.rows[0].owner_user_id === userId) {
            resolvedOrgRole = OrgRole.OWNER;
        }
    } catch {}

    if (!resolvedOrgRole) {
        try {
            const memberRes = await query(
                'SELECT role FROM organisation_members WHERE organisation_id = $1 AND user_id = $2',
                [orgId, userId]
            );
            if (memberRes.rows.length > 0) {
                resolvedOrgRole = normalizeOrgRole(memberRes.rows[0].role);
            }
        } catch {}
    }

    if (!resolvedOrgRole && jwtRole) {
        resolvedOrgRole = normalizeOrgRole(jwtRole);
    }

    // 2. Resolve Branch Memberships
    const branchMemberships: BranchMembershipInfo[] = [];
    try {
        const locMemRes = await query(
            `SELECT lm.location_id, lm.role, lm.is_active, l.name as location_name
             FROM location_memberships lm
             JOIN locations l ON lm.location_id = l.id
             WHERE lm.user_id = $1 AND l.org_id = $2 AND l.is_active = true AND (lm.is_active = true OR lm.is_active IS NULL)
             ORDER BY l.name ASC`,
            [userId, orgId]
        );

        for (const row of locMemRes.rows) {
            const bRole = normalizeBranchRole(row.role) || BranchRole.EMPLOYEE;
            branchMemberships.push({
                branchId: row.location_id,
                branchName: row.location_name,
                role: bRole,
                isActive: row.is_active !== false,
            });
        }
    } catch {}

    // 3. Resolve Active Branch Context
    let activeBranchId: string | null = requestedBranchId || null;
    let activeBranchRole: BranchRole | null = null;

    if (activeBranchId) {
        const activeMembership = branchMemberships.find(bm => bm.branchId === activeBranchId);
        if (activeMembership) {
            activeBranchRole = activeMembership.role;
        }
    } else if (branchMemberships.length === 1) {
        // Default to sole branch if only one exists
        activeBranchId = branchMemberships[0].branchId;
        activeBranchRole = branchMemberships[0].role;
    }

    // 4. Compose Effective Permissions
    const effectivePermissions = new Set<Permission>();

    // Add organisation-level permissions
    if (resolvedOrgRole && ORG_ROLE_PERMISSIONS[resolvedOrgRole]) {
        for (const p of ORG_ROLE_PERMISSIONS[resolvedOrgRole]) {
            effectivePermissions.add(p);
        }
    }

    // Add active branch permissions
    if (activeBranchRole && BRANCH_ROLE_PERMISSIONS[activeBranchRole]) {
        for (const p of BRANCH_ROLE_PERMISSIONS[activeBranchRole]) {
            effectivePermissions.add(p);
        }
    }

    return {
        userId,
        orgId,
        isPlatformAdmin: false,
        orgRole: resolvedOrgRole,
        branchMemberships,
        activeBranchId,
        activeBranchRole,
        effectivePermissions,
    };
}

/**
 * Checks whether the user security context satisfies a required permission.
 *
 * CRITICAL RULE:
 * Timesheet permissions (TIMESHEET_VIEW, TIMESHEET_REVIEW, TIMESHEET_APPROVE, TIMESHEET_LOCK)
 * strictly require active branch membership in the target branch. Organisation roles alone grant 0 timesheet access.
 */
export async function checkUserPermission(
    context: UserSecurityContext,
    permission: Permission,
    options?: {
        branchId?: string | null;
        employeeId?: string | null;
    }
): Promise<{ allowed: boolean; reason?: string }> {
    if (context.isPlatformAdmin) {
        return { allowed: true };
    }

    const isBranchScoped = [
        Permission.TIMESHEET_VIEW,
        Permission.TIMESHEET_REVIEW,
        Permission.TIMESHEET_APPROVE,
        Permission.TIMESHEET_LOCK,
        Permission.ROSTER_VIEW,
        Permission.ROSTER_CREATE,
        Permission.ROSTER_UPDATE,
        Permission.ROSTER_DELETE,
        Permission.LEAVE_VIEW,
        Permission.LEAVE_REVIEW,
        Permission.LEAVE_APPROVE,
        Permission.BRANCH_MANAGE_STAFF,
    ].includes(permission);

    // If permission is purely organisation-level (e.g. ORGANISATION_VIEW, ORGANISATION_UPDATE, ORGANISATION_MANAGE_USERS)
    if (!isBranchScoped) {
        if (context.effectivePermissions.has(permission)) {
            return { allowed: true };
        }
        return { allowed: false, reason: `User lacks organisation permission ${permission}.` };
    }

    // Branch-Scoped Operations: resolve target branch ID
    let targetBranchId = options?.branchId || context.activeBranchId || null;

    if (!targetBranchId && options?.employeeId) {
        try {
            const empRes = await query('SELECT location_id FROM employees WHERE id = $1 AND org_id = $2', [options.employeeId, context.orgId]);
            if (empRes.rows.length > 0) {
                targetBranchId = empRes.rows[0].location_id;
            }
        } catch {}
    }

    // If organisation has no locations defined at all, fallback to org permissions for legacy setups
    if (!targetBranchId) {
        if (await organisationHasNoBranches(context.orgId)) {
            // No locations exist in org yet: grant if user has an organisation management role
            if (context.orgRole === OrgRole.OWNER || context.orgRole === OrgRole.ORG_ADMIN || context.orgRole === OrgRole.ORG_MANAGER) {
                return { allowed: true };
            }
        }

        return {
            allowed: false,
            reason: 'Branch context is required for branch-scoped operational permissions.'
        };
    }

    // Verify branch belongs to organisation
    try {
        const locCheck = await query('SELECT id FROM locations WHERE id = $1 AND org_id = $2', [targetBranchId, context.orgId]);
        if (locCheck.rows.length === 0) {
            return { allowed: false, reason: 'Target branch does not exist in this organisation.' };
        }
    } catch {}

    // Find user's explicit branch membership in target branch
    const membership = context.branchMemberships.find(bm => bm.branchId === targetBranchId && bm.isActive);

    if (!membership) {
        return {
            allowed: false,
            reason: `Access denied: User does not hold an active branch membership in target branch ${targetBranchId}. Organisation roles do not inherit branch operational access.`
        };
    }

    // Check branch role permissions
    const branchPerms = BRANCH_ROLE_PERMISSIONS[membership.role];
    if (branchPerms && branchPerms.has(permission)) {
        return { allowed: true };
    }

    return {
        allowed: false,
        reason: `Branch role ${membership.role} in branch ${targetBranchId} lacks required permission ${permission}.`
    };
}

/**
 * Returns true when the user holds the given permission in at least one active branch membership.
 * Used for listing endpoints where no explicit branch was requested.
 */
export function hasPermissionInAnyBranch(context: UserSecurityContext, permission: Permission): boolean {
    if (context.isPlatformAdmin) return true;
    return context.branchMemberships.some(bm => {
        if (!bm.isActive) return false;
        const perms = BRANCH_ROLE_PERMISSIONS[bm.role];
        return Boolean(perms && perms.has(permission));
    });
}

/**
 * Lists the branch ids in which the user holds the given permission.
 */
export function branchesWithPermission(context: UserSecurityContext, permission: Permission): string[] {
    return context.branchMemberships
        .filter(bm => bm.isActive && BRANCH_ROLE_PERMISSIONS[bm.role]?.has(permission))
        .map(bm => bm.branchId);
}

/**
 * True when the organisation has no active locations configured (legacy / single-site tenants).
 * Such tenants fall back to organisation-level authorisation.
 */
export async function organisationHasNoBranches(orgId: string): Promise<boolean> {
    try {
        const countRes = await query('SELECT COUNT(*) as count FROM locations WHERE org_id = $1 AND is_active = true', [orgId]);
        return Number(countRes.rows[0]?.count || 0) === 0;
    } catch {
        return true;
    }
}

/**
 * Structured Security Audit Logger.
 * Records security-sensitive events with actor, org, target, branch, previous value, and new value.
 */
export async function logSecurityAuditEvent(params: {
    actorId: string;
    orgId: string;
    action: string;
    targetUserId?: string | null;
    branchId?: string | null;
    previousValue?: string | null;
    newValue?: string | null;
    details?: string | null;
    ipAddress?: string | null;
}): Promise<void> {
    try {
        const logId = crypto.randomUUID();
        const payloadDetails = params.details || JSON.stringify({
            previous_value: params.previousValue || null,
            new_value: params.newValue || null,
            target_user_id: params.targetUserId || null,
            branch_id: params.branchId || null,
        });

        await query(
            `INSERT INTO audit_logs (
                id, org_id, location_id, actor_id, user_id, target_user_id,
                action, previous_value, new_value, details, ip_address, timestamp, scope
            ) VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10, NOW(), 'organisation')`,
            [
                logId,
                params.orgId,
                params.branchId || null,
                params.actorId,
                params.targetUserId || null,
                params.action,
                params.previousValue || null,
                params.newValue || null,
                payloadDetails,
                params.ipAddress || null,
            ]
        );
    } catch (err) {
        console.error('[SECURITY AUDIT LOG ERROR]', err);
    }
}
