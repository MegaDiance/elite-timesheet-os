import { Router, Request, Response } from 'express';
import { sendError } from '../middleware/auth';
import { parseClientInfo } from '../services/securityService';
import { emailLoginLinks, findLoginLinks } from '../services/loginLinkRecovery';
import { isEmailSendingEnabled } from '../services/emailService';

/**
 * "I've lost my company's login link" — for anyone with a SimpleHours account.
 *
 * Neither endpoint signs anyone in or creates a session. The organisation is never named in the
 * request: it comes from the account the email (and password) belongs to. See
 * services/loginLinkRecovery.ts.
 */
const router = Router();

const NOT_VERIFIED = {
    success: false,
    error: { code: 'RECOVERY_NOT_VERIFIED', message: 'That email and password don’t match an account. Check them and try again.' },
};
const TOO_MANY = { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please wait a while before trying again.' } };

/** Which options the page can offer. Whether email is on is not a secret: every emailed flow already says so. */
router.get('/options', (_req: Request, res: Response) => {
    res.json({ success: true, data: { email_enabled: isEmailSendingEnabled() } });
});

/** { email, password } → the login link of every organisation that account can sign in to. */
router.post('/login-link', async (req: Request, res: Response) => {
    // The response can carry login links, so nothing may keep a copy of it.
    res.setHeader('Cache-Control', 'no-store');
    try {
        const outcome = await findLoginLinks(req.body || {}, parseClientInfo(req));
        switch (outcome.kind) {
            case 'rate-limited':
                return res.status(429).json(TOO_MANY);
            case 'unverified':
                return res.status(401).json(NOT_VERIFIED);
            case 'found':
                return res.json({
                    success: true,
                    data: {
                        organisations: outcome.links.map(l => ({
                            name: l.organisationName, login_path: l.loginPath, login_url: l.loginUrl, expires_at: l.expiresAt, replaced: l.replaced,
                        })),
                    },
                });
        }
    } catch (err) {
        sendError(res, err, 'LOGIN LINK RECOVERY ERROR');
    }
});

/** { email } → the links are emailed to that address if it has an account. The answer never says whether it does. */
router.post('/login-link/email', async (req: Request, res: Response) => {
    try {
        const outcome = await emailLoginLinks(req.body || {}, parseClientInfo(req));
        switch (outcome.kind) {
            case 'email-off':
                return res.status(409).json({ success: false, error: { code: 'EMAIL_DISABLED', message: 'Sending login links by email is turned off. Use your email and password instead.' } });
            case 'rate-limited':
                return res.status(429).json(TOO_MANY);
            case 'accepted':
                return res.json({ success: true, message: 'If that email belongs to a SimpleHours account, we’ve sent its login links there.' });
        }
    } catch (err) {
        sendError(res, err, 'LOGIN LINK EMAIL ERROR');
    }
});

export default router;
