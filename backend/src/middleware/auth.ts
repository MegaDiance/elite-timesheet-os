import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/auth';
import { validateSession, touchSession, SessionRecord } from '../services/sessionService';
import { query } from '../services/db';

export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
        organisation_id?: string;
        role?: string;
        scope?: string;
        session_id?: string;
    };
    session?: SessionRecord;
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
    next();
}

export function requireRole(roles: string[]) {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user || !req.user.role) {
            return res.status(403).json({ success: false, error: 'Forbidden', message: 'Forbidden' });
        }
        if (!roles.includes(req.user.role)) {
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
