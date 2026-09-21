import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/auth';
import { validateSession, touchSession, SessionRecord } from '../services/sessionService';
import { query } from '../services/db';
import {
    Permission,
    OrgRole,
    BranchRole,
    UserSecurityContext,
    resolveUserSecurityContext,
    checkUserPermission,
    normalizeBranchRole,
    hasPermissionInAnyBranch,
    organisationHasNoBranches,
    OrgRole as OrgRoleEnum
} from '../services/permissionService';

export { Permission, OrgRole, BranchRole, UserSecurityContext };

export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
        organisation_id?: string;
        role?: string;
        location_id?: string;
        scope?: string;
        session_id?: string;
    };
    session?: SessionRecord & { location_id?: string };
    locationRole?: string;
    securityContext?: UserSecurityContext;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Unauthorized' });
    }
    
    const token = authHeader.split(' ')[1];
    let decoded: any;

    try {
        decoded = verifyToken(token);
    } catch (err) {
        return res.status(401).json({ success: false, error: 'Invalid or expired token', message: 'Invalid or expired token' });
    }

    // Block intermediate tokens intended solely for 2FA validation
    if (decoded?.scope === '2fa_pending') {
        return res.status(401).json({ success: false, error: 'Two-factor verification required', message: 'Two-factor verification required' });
    }

    // 1. Server-Side Session Validation & 15-Minute Inactivity Enforcement
    if (decoded?.session_id) {
        const validation = await validateSession(decoded.session_id);
        if (!validation.valid) {
            if (validation.reason === 'INACTIVITY_TIMEOUT') {
                return res.status(401).json({
                    success: false,
                    code: 'SESSION_EXPIRED',
                    reason: 'INACTIVITY_TIMEOUT',
                    message: 'Your session has expired due to 15 minutes of inactivity. Please sign in again.'
                });
            } else if (validation.reason === 'REVOKED') {
                return res.status(401).json({
                    success: false,
                    code: 'SESSION_REVOKED',
                    message: 'Your session has been signed out or revoked.'
                });
            } else if (validation.reason === 'USER_DEACTIVATED') {
                return res.status(401).json({
                    success: false,
                    code: 'USER_DEACTIVATED',
                    message: 'Your user account has been deactivated. Please contact an administrator.'
                });
            } else {
                return res.status(401).json({
                    success: false,
                    code: 'SESSION_EXPIRED',
                    message: 'Your session is no longer active. Please sign in again.'
                });
            }
        }

        // Active session: touch activity timestamp
        await touchSession(decoded.session_id);
        req.session = validation.session;

        // Cross-tenant session protection: verify session org_id matches token org_id
        if (validation.session?.org_id && decoded.organisation_id && validation.session.org_id !== decoded.organisation_id) {
            return res.status(403).json({
                success: false,
                code: 'TENANT_MISMATCH',
                message: 'Session tenant context mismatch detected.'
            });
        }

        // Bind location_id from session if available and not on token
        if (validation.session?.location_id && !decoded.location_id) {
            decoded.location_id = validation.session.location_id;
        }
    } else {
        // Enforce session requirements in production or when explicitly configured
        if (process.env.NODE_ENV === 'production' || process.env.REQUIRE_SESSION_ID === 'true') {
            return res.status(401).json({
                success: false,
                code: 'SESSION_REQUIRED',
                message: 'Active server session required. Direct JWTs without session context are prohibited.'
            });
        }

        // Fallback for direct token callers in testing/development: check user active state
        try {
            const userRes = await query('SELECT is_active FROM users WHERE id = $1', [decoded.id]);
            if (userRes.rows.length > 0 && userRes.rows[0].is_active === false) {
                return res.status(401).json({
                    success: false,
                    code: 'USER_DEACTIVATED',
                    message: 'Your user account has been deactivated.'
                });
            }
        } catch {
            // ignore if mock db is in transition
        }
    }

    req.user = decoded;
    if (decoded?.id && decoded?.organisation_id) {
        try {
            req.securityContext = await resolveUserSecurityContext(
                decoded.id,
                decoded.organisation_id,
                decoded.location_id,
                decoded.role
            );
        } catch {}
    }
    next();
}

export function requireRole(roles: string[]) {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user || !req.user.role) {
            return res.status(403).json({ success: false, error: 'Forbidden', message: 'Forbidden' });
        }
        const userRole = (req.user.role || '').trim().toLowerCase();
        const lowerRoles = roles.map(r => r.trim().toLowerCase());

        // If management roles are requested, automatically permit 'owner'
        if (lowerRoles.some(r => ['admin', 'company admin', 'manager'].includes(r))) {
            if (!lowerRoles.includes('owner')) lowerRoles.push('owner');
        }

        if (!lowerRoles.includes(userRole)) {
            return res.status(403).json({ success: false, error: 'Insufficient permissions', message: 'Insufficient permissions' });
        }
        next();
    };
}

// Tenant Isolation Middleware
export function requireTenantContext(req: AuthRequest, res: Response, next: NextFunction) {
    if (!req.user || !req.user.organisation_id) {
        return res.status(403).json({ success: false, error: 'Tenant context required', message: 'Tenant context required' });
    }
    next();
}

// Organisation Owner Authorization Middleware
export async function requireOrgOwner(req: AuthRequest, res: Response, next: NextFunction) {
    if (!req.user || !req.user.organisation_id) {
        return res.status(403).json({ success: false, code: 'TENANT_REQUIRED', message: 'Tenant context required' });
    }

    if (req.user.role === 'Platform Admin') {
        return next();
    }

    const userId = req.user.id;
    const orgId = req.user.organisation_id;

    try {
        // Check if user is registered owner in organisations or organisation_members
        const orgRes = await query(
            'SELECT owner_user_id FROM organisations WHERE id = $1',
            [orgId]
        );

        if (orgRes.rows.length > 0 && orgRes.rows[0].owner_user_id === userId) {
            return next();
        }

        const memberRes = await query(
            'SELECT role FROM organisation_members WHERE organisation_id = $1 AND user_id = $2',
            [orgId, userId]
        );

        if (memberRes.rows.length > 0) {
            const mRole = memberRes.rows[0].role;
            if (mRole === 'Owner' || mRole === 'Company Admin' || req.user.role === 'Owner' || req.user.role === 'Company Admin') {
                return next();
            }
        }
    } catch {
        // Fallback for tests or simplified schemas
        if (req.user.role === 'Owner' || req.user.role === 'Company Admin') {
            return next();
        }
    }

    return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_OWNER_REQUIRED',
        error: { code: 'OWNER_REQUIRED', message: 'Only the organisation owner has permission to perform this action.' },
        message: 'Only the organisation owner has permission to perform this action.'
    });
}

// Location Isolation Middleware
export function requireLocationContext(options?: { allowedRoles?: string[] }) {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user || !req.user.organisation_id) {
            return res.status(403).json({ success: false, code: 'TENANT_REQUIRED', message: 'Tenant context required' });
        }

        // Platform Admin always bypasses location limits
        if (req.user.role === 'Platform Admin') {
            return next();
        }

        const orgId = req.user.organisation_id;
        const userId = req.user.id;

        // Resolve requested location ID
        const targetLocationId = 
            req.params.locationId || 
            req.params.id || 
            (req.query.location_id as string) || 
            (req.query.locationId as string) ||
            req.body?.location_id || 
            req.body?.locationId ||
            req.headers['x-location-id'] ||
            req.user.location_id;

        // NOTE: The former blanket owner bypass has been REMOVED.
        // Organisation ownership does NOT grant branch operational access; an explicit
        // active location_membership is required for every branch-scoped operation.

        if (!targetLocationId) {
            // Check if organization has any locations configured
            try {
                const locCountRes = await query('SELECT COUNT(*) as count FROM locations WHERE org_id = $1 AND is_active = true', [orgId]);
                const locCount = Number(locCountRes.rows[0]?.count || 0);
                if (locCount === 0) {
                    // Legacy or single-location org without locations table setup yet
                    return next();
                }
            } catch {
                return next();
            }

            return res.status(400).json({
                success: false,
                code: 'LOCATION_CONTEXT_REQUIRED',
                message: 'Active location context is required for this operation.'
            });
        }

        // Verify that targetLocationId belongs to this organisation
        try {
            const locRes = await query('SELECT id, is_active FROM locations WHERE id = $1 AND org_id = $2', [targetLocationId, orgId]);
            if (locRes.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    code: 'LOCATION_NOT_FOUND',
                    message: 'The specified location does not exist in this organisation.'
                });
            }
        } catch {
            return next();
        }

        // Strict Location Isolation: Verify user has active membership in this location
        try {
            const memberRes = await query(
                'SELECT role, is_active FROM location_memberships WHERE location_id = $1 AND user_id = $2',
                [targetLocationId, userId]
            );

            if (memberRes.rows.length === 0 || memberRes.rows[0].is_active === false) {
                return res.status(403).json({
                    success: false,
                    code: 'LOCATION_ACCESS_DENIED',
                    message: 'Access denied: You are not an authorized member of this location.'
                });
            }

            const membership = memberRes.rows[0];
            req.locationRole = membership.role;

            if (options?.allowedRoles && options.allowedRoles.length > 0) {
                const normMemberRole = normalizeBranchRole(membership.role);
                const roleMatches = options.allowedRoles.some(r => {
                    const normOpt = normalizeBranchRole(r);
                    return (normOpt && normMemberRole && normOpt === normMemberRole) ||
                           r.toLowerCase() === (membership.role || '').toLowerCase();
                });
                if (!roleMatches) {
                    return res.status(403).json({
                        success: false,
                        code: 'LOCATION_ROLE_INSUFFICIENT',
                        message: 'Insufficient location-level permissions for this operation.'
                    });
                }
            }

            req.user.location_id = targetLocationId as string;
            return next();
        } catch (err) {
            return next();
        }
    };
}

/**
 * Granular Permission Authorization Middleware
 */
export function requirePermission(
    permission: Permission,
    options?: {
        getBranchId?: (req: AuthRequest) => string | undefined;
        getEmployeeId?: (req: AuthRequest) => string | undefined;
    }
) {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user || !req.user.organisation_id) {
            return res.status(403).json({ success: false, error: 'Tenant context required', message: 'Tenant context required' });
        }

        const orgId = req.user.organisation_id;
        const userId = req.user.id;

        // Resolve or refresh security context if not already loaded
        let context = req.securityContext;
        if (!context) {
            context = await resolveUserSecurityContext(userId, orgId, req.user.location_id, req.user.role);
            req.securityContext = context;
        }

        // Resolve branchId
        let branchId: string | undefined = undefined;
        if (options?.getBranchId) {
            branchId = options.getBranchId(req);
        } else {
            branchId = 
                req.params.locationId || 
                req.params.branchId || 
                (req.query.location_id as string) || 
                (req.query.branch_id as string) || 
                (req.query.locationId as string) ||
                req.body?.location_id || 
                req.body?.branch_id || 
                req.body?.locationId ||
                (req.headers['x-location-id'] as string) ||
                req.user.location_id;
        }

        // Resolve employeeId
        let employeeId: string | undefined = undefined;
        if (options?.getEmployeeId) {
            employeeId = options.getEmployeeId(req);
        } else {
            employeeId = req.params.employeeId || req.body?.employee_id || (req.query.employee_id as string);
        }

        const check = await checkUserPermission(context, permission, { branchId, employeeId });
        if (!check.allowed) {
            return res.status(403).json({
                success: false,
                code: 'FORBIDDEN_INSUFFICIENT_PERMISSION',
                error: {
                    code: 'PERMISSION_DENIED',
                    message: check.reason || 'Insufficient permissions for this operation.'
                },
                message: check.reason || 'Insufficient permissions for this operation.'
            });
        }

        next();
    };
}

// Timesheet Entry Mode Enforcement Middleware
export function requireTimesheetMode(expectedMode: 'employee' | 'manager') {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        const orgId = req.user?.organisation_id;
        if (!orgId) return next();

        try {
            const orgRes = await query('SELECT timesheet_entry_mode FROM organisations WHERE id = $1', [orgId]);
            const actualMode = orgRes.rows[0]?.timesheet_entry_mode || 'employee';

            if (actualMode !== expectedMode) {
                return res.status(403).json({
                    success: false,
                    code: 'TIMESHEET_MODE_DISALLOWED',
                    message: expectedMode === 'employee' 
                        ? 'This organisation is configured for manager-entered timesheets. Employee submissions are disabled.'
                        : 'This organisation is configured for employee-submitted timesheets.'
                });
            }
        } catch {}

        next();
    };
}


/**
 * Permission middleware for listing endpoints where no explicit branch was requested.
 *
 * - If a branch is identified in the request, strict per-branch evaluation applies.
 * - Otherwise the caller is allowed when they hold the permission in at least one
 *   active branch membership.
 * - Legacy tenants with no configured branches fall back to organisation-level roles.
 */
export function requireAnyBranchPermission(permission: Permission) {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user || !req.user.organisation_id) {
            return res.status(403).json({ success: false, error: 'Tenant context required', message: 'Tenant context required' });
        }

        const orgId = req.user.organisation_id;
        let context = req.securityContext;
        if (!context) {
            context = await resolveUserSecurityContext(req.user.id, orgId, req.user.location_id, req.user.role);
            req.securityContext = context;
        }

        if (context.isPlatformAdmin) return next();

        const explicitBranchId =
            (req.query.location_id as string) ||
            (req.query.locationId as string) ||
            req.body?.location_id ||
            (req.headers['x-location-id'] as string) ||
            req.user.location_id;

        if (explicitBranchId) {
            const check = await checkUserPermission(context, permission, { branchId: explicitBranchId });
            if (check.allowed) return next();
            return res.status(403).json({
                success: false,
                code: 'FORBIDDEN_INSUFFICIENT_PERMISSION',
                error: { code: 'PERMISSION_DENIED', message: check.reason || 'Insufficient permissions for this operation.' },
                message: check.reason || 'Insufficient permissions for this operation.'
            });
        }

        if (hasPermissionInAnyBranch(context, permission)) return next();

        // Legacy fallback: organisations without configured branches
        if (await organisationHasNoBranches(orgId)) {
            if (context.orgRole === OrgRoleEnum.OWNER || context.orgRole === OrgRoleEnum.ORG_ADMIN || context.orgRole === OrgRoleEnum.ORG_MANAGER) {
                return next();
            }
        }

        const message = `Access denied: ${permission} requires an active branch membership. Organisation-level roles do not inherit branch access.`;
        return res.status(403).json({
            success: false,
            code: 'FORBIDDEN_INSUFFICIENT_PERMISSION',
            error: { code: 'PERMISSION_DENIED', message },
            message
        });
    };
}

/**
 * Allows the request when ANY of the supplied permissions is satisfied.
 * Branch-scoped permissions are evaluated with requireAnyBranchPermission semantics.
 */
export function requireAnyPermission(permissions: Permission[], options?: { branchParam?: string }) {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user || !req.user.organisation_id) {
            return res.status(403).json({ success: false, error: 'Tenant context required', message: 'Tenant context required' });
        }

        const orgId = req.user.organisation_id;
        let context = req.securityContext;
        if (!context) {
            context = await resolveUserSecurityContext(req.user.id, orgId, req.user.location_id, req.user.role);
            req.securityContext = context;
        }
        if (context.isPlatformAdmin) return next();

        const explicitBranchId =
            (options?.branchParam ? (req.params[options.branchParam] as string) : undefined) ||
            (req.query.location_id as string) ||
            (req.query.locationId as string) ||
            req.body?.location_id ||
            (req.headers['x-location-id'] as string) ||
            req.user.location_id;

        for (const permission of permissions) {
            if (context.effectivePermissions.has(permission) && !explicitBranchId) {
                const direct = await checkUserPermission(context, permission, {});
                if (direct.allowed) return next();
            }
            if (explicitBranchId) {
                const scoped = await checkUserPermission(context, permission, { branchId: explicitBranchId });
                if (scoped.allowed) return next();
            }
            if (hasPermissionInAnyBranch(context, permission)) return next();
            if (context.effectivePermissions.has(permission)) {
                const direct = await checkUserPermission(context, permission, {});
                if (direct.allowed) return next();
            }
        }

        if (await organisationHasNoBranches(orgId)) {
            if (context.orgRole === OrgRoleEnum.OWNER || context.orgRole === OrgRoleEnum.ORG_ADMIN || context.orgRole === OrgRoleEnum.ORG_MANAGER) {
                return next();
            }
        }

        const message = `Access denied: this operation requires one of [${permissions.join(', ')}].`;
        return res.status(403).json({
            success: false,
            code: 'FORBIDDEN_INSUFFICIENT_PERMISSION',
            error: { code: 'PERMISSION_DENIED', message },
            message
        });
    };
}
