import { Router, Request, Response } from 'express';
import { sendError } from '../middleware/auth';
import { parseClientInfo } from '../services/securityService';
import { recoverLoginLink } from '../services/loginLinkRecovery';

/**
 * Recovery of a lost private login link — for the Organisation Owner only.
 *
 * This is not a sign-in: it creates no session and grants no access. It proves the owner's
 * identity with the organisation name, the owner's email and the owner's password, then replaces
 * the organisation's login link and returns the new one. The organisation is resolved from those
 * three values on the server; nothing else in the request names one. See services/loginLinkRecovery.ts.
 */
const router = Router();

const NOT_VERIFIED = {
    success: false,
    error: { code: 'RECOVERY_NOT_VERIFIED', message: 'The details provided could not be verified. Check the organisation name, owner email, and password and try again.' },
};

router.post('/login-link', async (req: Request, res: Response) => {
    // The response can carry the login link, so nothing may keep a copy of it.
    res.setHeader('Cache-Control', 'no-store');
    try {
        const outcome = await recoverLoginLink(req.body || {}, parseClientInfo(req));
        switch (outcome.kind) {
            case 'rate-limited':
                return res.status(429).json({ success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please wait a while before trying again.' } });
            case 'unverified':
                return res.status(401).json(NOT_VERIFIED);
            case 'recovered':
                return res.json({ success: true, data: { login_path: outcome.loginPath, login_url: outcome.loginUrl, expires_at: outcome.expiresAt } });
        }
    } catch (err) {
        sendError(res, err, 'LOGIN LINK RECOVERY ERROR');
    }
});

export default router;
