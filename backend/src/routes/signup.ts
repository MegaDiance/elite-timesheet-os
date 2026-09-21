import { Router, Response } from 'express';
import crypto from 'crypto';
import { query, withTransaction } from '../services/db';
import { comparePassword, hashPassword } from '../services/auth';
import { sendError } from '../middleware/auth';
import { badRequest, writeAudit } from '../services/policy';
import { sendTransactionalEmail, buildOrganisationSetupEmailTemplate, isEmailDeliveryConfigured } from '../services/emailService';
import {
    RateLimitedRequest, checkRateLimit, throttle, recordFailedAttempt, clearRateLimit,
    isStrongPassword, isValidEmail, newPortalSlug, newSecretToken, publicBaseUrl, sha256Hex
} from '../services/authUtils';

/**
 * Organisation sign-up. This is how an Organisation Owner comes to exist:
 *
 *   enter email → emailed single-use setup link → setup form → organisation + first branch
 *   are created and the account becomes the organisation's OWNER.
 *
 * The link proves control of the email address. It is random, stored hashed, expires after
 * 24 hours, is single use and is never returned by the API. Completing sign-up does not create
 * a session; the new owner signs in through the organisation's private sign-in link.
 */
const router = Router();

const SIGNUP_LIFETIME_MS = 24 * 60 * 60 * 1000;
const INVALID_LINK = { success: false, error: { code: 'INVALID_SETUP_LINK', message: 'This setup link is invalid, expired or already used. Request a new one.' } };

async function findOpenSignup(rawToken: unknown) {
    if (typeof rawToken !== 'string' || !rawToken.trim()) return null;
    const res = await query(
        'SELECT id, email FROM organisation_signups WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()',
        [sha256Hex(rawToken.trim())]
    );
    return res.rows[0] || null;
}

router.post('/request', throttle, async (req: RateLimitedRequest, res: Response) => {
    try {
        const { email } = req.body || {};
        if (!isValidEmail(email)) throw badRequest('VALIDATION_FAILED', 'A valid email address is required.');
        if (!isEmailDeliveryConfigured()) {
            return res.status(503).json({ success: false, error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Sign-up is unavailable right now. Please try again later.' } });
        }

        const cleanEmail = email.trim().toLowerCase();
        const token = newSecretToken();
        const signupId = crypto.randomUUID();
        await query('DELETE FROM organisation_signups WHERE email = $1 AND used_at IS NULL', [cleanEmail]);
        await query(
            'INSERT INTO organisation_signups (id, email, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
            [signupId, cleanEmail, token.hash, new Date(Date.now() + SIGNUP_LIFETIME_MS).toISOString()]
        );

        const template = buildOrganisationSetupEmailTemplate({ setupLink: `${publicBaseUrl()}/setup-organisation?token=${token.raw}`, recipientEmail: cleanEmail });
        const result = await sendTransactionalEmail({ to: cleanEmail, subject: template.subject, html: template.html, text: template.text });
        await query(
            'UPDATE organisation_signups SET delivery_status = $1, last_error = $2 WHERE id = $3',
            [result.success ? 'sent' : 'failed', result.success ? null : result.error || 'UNKNOWN', signupId]
        );

        // Same response whatever happened, so the endpoint reveals nothing about any email address.
        res.json({ success: true, message: 'Check your email for a link to set up your organisation.' });
    } catch (err) {
        sendError(res, err, 'SIGNUP REQUEST ERROR');
    }
});

router.get('/verify', checkRateLimit, async (req: RateLimitedRequest, res: Response) => {
    try {
        const signup = await findOpenSignup(req.query.token);
        if (!signup) {
            recordFailedAttempt(req.rateLimitKey);
            return res.status(400).json(INVALID_LINK);
        }
        const existing = await query('SELECT 1 FROM users WHERE LOWER(email) = $1', [signup.email]);
        res.json({ success: true, data: { email: signup.email, account_exists: existing.rows.length > 0 } });
    } catch (err) {
        sendError(res, err, 'SIGNUP VERIFY ERROR');
    }
});

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

router.post('/complete', checkRateLimit, async (req: RateLimitedRequest, res: Response) => {
    try {
        const body = req.body || {};
        const signup = await findOpenSignup(body.token);
        if (!signup) {
            recordFailedAttempt(req.rateLimitKey);
            return res.status(400).json(INVALID_LINK);
        }

        const orgName = typeof body.organisation_name === 'string' ? body.organisation_name.trim() : '';
        if (!orgName || orgName.length > 120) throw badRequest('VALIDATION_FAILED', 'Organisation name is required (120 characters at most).');
        if (typeof body.password !== 'string' || !body.password) throw badRequest('VALIDATION_FAILED', 'Password is required.');

        const branchName = typeof body.branch_name === 'string' && body.branch_name.trim() ? body.branch_name.trim().slice(0, 120) : 'Main Branch';
        const branchAddress = typeof body.branch_address === 'string' && body.branch_address.trim() ? body.branch_address.trim() : null;
        const branchTimezone = typeof body.branch_timezone === 'string' && body.branch_timezone.trim() ? body.branch_timezone.trim() : 'Australia/Melbourne';

        const userRes = await query('SELECT id, password_hash, is_active FROM users WHERE LOWER(email) = $1', [signup.email]);
        const existingUser = userRes.rows[0];
        let newPasswordHash: string | null = null;
        if (existingUser) {
            const ok = existingUser.is_active && existingUser.password_hash && await comparePassword(body.password, existingUser.password_hash);
            if (!ok) {
                recordFailedAttempt(req.rateLimitKey);
                return res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'An account already exists for this email. Enter its current password to continue.' } });
            }
        } else {
            const strength = isStrongPassword(body.password);
            if (!strength.valid) throw badRequest('WEAK_PASSWORD', strength.reason!);
            newPasswordHash = await hashPassword(body.password);
        }

        for (const field of ['roster_lock_password', 'timesheet_lock_password']) {
            if (body[field] !== undefined && body[field] !== null && body[field] !== '' && (typeof body[field] !== 'string' || body[field].length < 4)) {
                throw badRequest('VALIDATION_FAILED', 'Lock passwords must be at least 4 characters.');
            }
        }
        const rosterLockHash = body.roster_lock_password ? await hashPassword(body.roster_lock_password) : null;
        const timesheetLockHash = body.timesheet_lock_password ? await hashPassword(body.timesheet_lock_password) : null;

        const created = await withTransaction(async (tx) => {
            // Single use: only one request can consume the setup link.
            const claim = await tx('UPDATE organisation_signups SET used_at = NOW() WHERE id = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING id', [signup.id]);
            if (claim.rows.length === 0) return null;

            let userId: string = existingUser?.id;
            if (!userId) {
                userId = crypto.randomUUID();
                const ownerName = typeof body.owner_name === 'string' && body.owner_name.trim() ? body.owner_name.trim().slice(0, 120) : null;
                await tx(
                    'INSERT INTO users (id, email, password_hash, full_name, is_active, two_factor_enabled) VALUES ($1, $2, $3, $4, true, $5)',
                    [userId, signup.email, newPasswordHash, ownerName, body.enable_2fa === true]
                );
            }

            const orgId = crypto.randomUUID();
            const portalSlug = newPortalSlug();
            await tx(
                `INSERT INTO organisations (id, name, display_name, portal_slug, owner_user_id, is_active,
                                            break_mins_weekday, break_mins_weekend, break_threshold_hours,
                                            roster_lock_password_hash, timesheet_lock_password_hash)
                 VALUES ($1, $2, $2, $3, $4, true, $5, $6, $7, $8, $9)`,
                [orgId, orgName, portalSlug, userId,
                    readNumber(body.break_mins_weekday, 30, 0, 240), readNumber(body.break_mins_weekend, 0, 0, 240), readNumber(body.break_threshold_hours, 6, 0, 24),
                    rosterLockHash, timesheetLockHash]
            );
            await tx(
                'INSERT INTO locations (id, org_id, name, address, timezone, is_active) VALUES ($1, $2, $3, $4, $5, true)',
                [crypto.randomUUID(), orgId, branchName, branchAddress, branchTimezone]
            );
            return { orgId, userId, portalSlug };
        });

        if (!created) return res.status(400).json(INVALID_LINK);
        clearRateLimit(req.rateLimitKey);
        await writeAudit({ orgId: created.orgId, actorId: created.userId, action: 'ORGANISATION_CREATED', entityType: 'organisation', entityId: created.orgId, details: `Organisation "${orgName}" created` });

        res.status(201).json({
            success: true,
            data: { login_path: `/login/${created.portalSlug}` },
            message: 'Your organisation is ready. Sign in to continue.'
        });
    } catch (err) {
        sendError(res, err, 'SIGNUP COMPLETE ERROR');
    }
});

export default router;
