import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/auth';

export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
        organisation_id?: string;
        role?: string;
        scope?: string;
    };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Unauthorized' });
    }
    
    const token = authHeader.split(' ')[1];
    try {
        const decoded = verifyToken(token);
        // Block intermediate tokens intended solely for 2FA validation
        if (decoded.scope === '2fa_pending') {
            return res.status(401).json({ success: false, error: 'Two-factor verification required', message: 'Two-factor verification required' });
        }
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, error: 'Invalid or expired token', message: 'Invalid or expired token' });
    }
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
