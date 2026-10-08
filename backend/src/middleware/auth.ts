import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/auth';
import { validateSession, touchSession, revokeSession } from '../services/sessionService';
import { AccessContext, HttpError, Permission, hasAnyPermission, hasManagementAccess, hasPermission, resolveAccess } from '../services/policy';

export { Permission, AccessContext };

export interface AuthRequest extends Request {
    /** Set by requireAuth. Resolved from the database for this request; never from token claims. */
    auth?: AccessContext;
}

/** Marks a middleware as an authorisation policy so the route-inventory test can verify every route declares one. */
type PolicyHandler = ((req: AuthRequest, res: Response, next: NextFunction) => unknown) & { policy: string };

function deny(res: Response, status: number, code: string, message: string, extra?: Record<string, unknown>) {
    return res.status(status).json({ success: false, code, error: { code, message }, message, ...extra });
}

const SESSION_MESSAGES: Record<string, { code: string; message: string }> = {
    INACTIVITY_TIMEOUT: { code: 'SESSION_EXPIRED', message: 'Your session has expired due to 15 minutes of inactivity. Please sign in again.' },
    SESSION_EXPIRED: { code: 'SESSION_EXPIRED', message: 'Your session is no longer active. Please sign in again.' },
    REVOKED: { code: 'SESSION_REVOKED', message: 'Your session has been signed out or revoked.' },
    USER_DEACTIVATED: { code: 'USER_DEACTIVATED', message: 'Your user account has been deactivated. Please contact the organisation owner.' },
    NOT_FOUND: { code: 'SESSION_EXPIRED', message: 'Your session is no longer active. Please sign in again.' },
};

/**
 * Authenticates the request and resolves the caller's role and branch scope.
 *
 *   token {sub, sid} → server session (active, not idle, not expired, same user)
 *                    → session.org_id → organisation active → role assignments → permissions → branch scope
 *
 * Any failure or error denies. There is no session-less mode and no role or permission claim: the
 * organisation comes from the session row, the permissions from the database, on every request.
 */
export const requireAuth: PolicyHandler = Object.assign(
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const header = req.headers.authorization;
        if (!header || !header.startsWith('Bearer ')) {
            return deny(res, 401, 'UNAUTHENTICATED', 'Unauthorized');
        }

        let decoded: any;
        try {
            decoded = verifyToken(header.slice('Bearer '.length));
        } catch {
            return deny(res, 401, 'UNAUTHENTICATED', 'Invalid or expired token');
        }
        if (!decoded?.sub || !decoded?.sid || decoded.scope) {
            return deny(res, 401, 'UNAUTHENTICATED', 'Invalid or expired token');
        }

        try {
            const validation = await validateSession(decoded.sid);
            if (!validation.valid || !validation.session) {
                const info = SESSION_MESSAGES[validation.reason || 'NOT_FOUND'];
                return deny(res, 401, info.code, info.message, { reason: validation.reason });
            }
            const session = validation.session;
            if (session.user_id !== decoded.sub || !session.org_id) {
                return deny(res, 401, 'SESSION_EXPIRED', SESSION_MESSAGES.NOT_FOUND.message);
            }

            const access = await resolveAccess(session.user_id, session.org_id);
            if (!access) {
                await revokeSession(session.id);
                return deny(res, 401, 'ACCESS_REVOKED', 'Your access to this organisation has ended.');
            }

            await touchSession(session.id);

            req.auth = {
                userId: session.user_id,
                email: session.user_email,
                fullName: session.user_full_name || null,
                orgId: session.org_id,
                sessionId: session.id,
                roles: access.roles,
                isOwner: access.isOwner,
                grants: access.grants,
                allBranchIds: access.allBranchIds,
                branchIds: access.branchIds,
                employeeId: access.employeeId,
                employeeBranchId: access.employeeBranchId,
            };
            next();
        } catch (err) {
            console.error('[AUTH ERROR]', err);
            return deny(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
        }
    },
    { policy: 'authenticated' }
);

/**
 * Coarse gate: the caller must hold `permission` somewhere. Branch-level permissions are held per
 * branch, so handlers must additionally authorise against the resource's own branch with
 * loadWorker / loadBranch / resolveBranchFilter from services/policy.
 */
export function requirePermission(permission: Permission): PolicyHandler {
    return Object.assign(
        (req: AuthRequest, res: Response, next: NextFunction) => {
            if (!req.auth) return deny(res, 401, 'UNAUTHENTICATED', 'Unauthorized');
            if (!hasPermission(req.auth, permission)) {
                return deny(res, 403, 'FORBIDDEN', 'You do not have access to this.');
            }
            next();
        },
        { policy: permission }
    );
}

/** Coarse gate for a screen that several permissions open (each caller still only sees what its own permission covers). */
export function requireAnyPermission(...permissions: Permission[]): PolicyHandler {
    return Object.assign(
        (req: AuthRequest, res: Response, next: NextFunction) => {
            if (!req.auth) return deny(res, 401, 'UNAUTHENTICATED', 'Unauthorized');
            if (!hasAnyPermission(req.auth, permissions)) {
                return deny(res, 403, 'FORBIDDEN', 'You do not have access to this.');
            }
            next();
        },
        { policy: `any(${permissions.join('|')})` }
    );
}

/** Coarse gate for shared management screens (holidays, noticeboard, navigation counts): the caller must hold at least one management permission. */
export const requireManagement: PolicyHandler = Object.assign(
    (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.auth) return deny(res, 401, 'UNAUTHENTICATED', 'Unauthorized');
        if (!hasManagementAccess(req.auth)) {
            return deny(res, 403, 'FORBIDDEN', 'You do not have access to this.');
        }
        next();
    },
    { policy: 'management' }
);

/** For the few actions no role can hold: only the organisation's owner (e.g. transferring ownership). */
export const requireOwner: PolicyHandler = Object.assign(
    (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.auth) return deny(res, 401, 'UNAUTHENTICATED', 'Unauthorized');
        if (!req.auth.isOwner) return deny(res, 403, 'FORBIDDEN', 'You do not have access to this.');
        next();
    },
    { policy: 'owner' }
);

/** Coarse gate for the employee portal: an active worker record linked to this login, and the portal permission. */
export const requireEmployee: PolicyHandler = Object.assign(
    (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.auth) return deny(res, 401, 'UNAUTHENTICATED', 'Unauthorized');
        if (!req.auth.employeeId || !hasPermission(req.auth, Permission.PORTAL_ACCESS)) {
            return deny(res, 403, 'FORBIDDEN', 'You do not have access to this.');
        }
        next();
    },
    { policy: 'employee' }
);

/** Translates policy errors thrown by handlers; everything else is a generic 500 with no detail. */
export function sendError(res: Response, err: unknown, logLabel: string) {
    if (err instanceof HttpError) {
        return deny(res, err.status, err.code, err.message);
    }
    console.error(`[${logLabel}]`, err);
    return deny(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}
