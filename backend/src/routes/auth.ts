import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { comparePassword, generateToken, generateTempToken, verifyTempToken, hashPassword } from '../services/auth';
import { requireAuth, AuthRequest, sendError } from '../middleware/auth';
import { ROLE_PERMISSIONS, listAccessibleOrganisations, resolveAccess, writeAudit, isUuid } from '../services/policy';
import { sendTransactionalEmail, buildPasswordResetEmailTemplate, buildTwoFactorEmailTemplate, buildSuspiciousLoginVerificationTemplate, isEmailSendingEnabled } from '../services/emailService';
import { createSession, touchSession, revokeSession, revokeAllUserSessions, getActiveUserSessions, recordLoginAttempt } from '../services/sessionService';
import { ClientInfo, parseClientInfo, assessLoginRisk, createLoginChallenge } from '../services/securityService';
import {
    RateLimitedRequest, checkRateLimit, throttle, recordFailedAttempt, clearRateLimit,
    isStrongPassword, sha256Hex, hashesEqual, newSecretToken, newSixDigitCode, publicBaseUrl, maskEmail
} from '../services/authUtils';

const router = Router();

// Compared against when the email is unknown, so unknown and known emails take the same time.
const dummyPasswordHash = hashPassword(crypto.randomUUID());

const INVALID_CREDENTIALS = { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } };

async function findOrganisationBySlug(slug: string): Promise<{ id: string } | null> {
    const clean = slug.trim().toLowerCase();
    const res = await query(
        'SELECT id FROM organisations WHERE is_active = true AND portal_slug = $1',
        [clean]
    );
    return res.rows[0] || null;
}

/**
 * Where a user should sign in after an auth flow that happens outside a session (password reset):
 * the organisation the flow was started from when they still have access there, otherwise their
 * only organisation. Null when that is ambiguous — there is no generic sign-in page to fall back
 * to, and the user's organisations are never listed outside a session.
 */
async function portalLoginPath(userId: string, preferredOrgId: string | null): Promise<string | null> {
    if (preferredOrgId && await resolveAccess(userId, preferredOrgId)) {
        const org = await query('SELECT portal_slug FROM organisations WHERE id = $1 AND is_active = true', [preferredOrgId]);
        if (org.rows[0]?.portal_slug) return `/login/${org.rows[0].portal_slug}`;
    }
    const orgs = await listAccessibleOrganisations(userId);
    return orgs.length === 1 && orgs[0].portal_slug ? `/login/${orgs[0].portal_slug}` : null;
}

/** Issues the email one-time code and the short-lived token for the second login step. */
async function beginTwoFactorStep(user: any, orgId: string): Promise<{ status: number; body: any }> {
    const { code, hash } = newSixDigitCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await query('DELETE FROM two_factor_codes WHERE user_id = $1', [user.id]);
    await query(
        'INSERT INTO two_factor_codes (id, user_id, code_hash, expires_at, attempts) VALUES ($1, $2, $3, $4, 0)',
        [crypto.randomUUID(), user.id, hash, expiresAt]
    );

    const template = buildTwoFactorEmailTemplate({ code, recipientEmail: user.email });
    const emailResult = await sendTransactionalEmail({ to: user.email, subject: template.subject, html: template.html, text: template.text });
    if (!emailResult.success) {
        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [user.id]);
        return {
            status: 503,
            body: { success: false, error: { code: 'EMAIL_DELIVERY_FAILED', message: 'We could not send your verification code. Please try again shortly.' } }
        };
    }

    return {
        status: 200,
        body: { success: true, require_2fa: true, temp_token: generateTempToken({ sub: user.id, org: orgId }), masked_email: maskEmail(user.email) }
    };
}

/** Describes the signed-in account to the client. Display only — the server never trusts it back. */
async function describeAccess(userId: string, orgId: string) {
    const access = await resolveAccess(userId, orgId);
    if (!access) return null;
    const [userRes, orgRes, branchRes] = await Promise.all([
        query('SELECT id, email, full_name, two_factor_enabled FROM users WHERE id = $1', [userId]),
        query('SELECT id, name, portal_slug, employees_can_submit_timesheets FROM organisations WHERE id = $1', [orgId]),
        query('SELECT id, name, address, timezone, is_active FROM locations WHERE org_id = $1 AND id = ANY($2::uuid[]) ORDER BY name ASC', [orgId, access.branchIds]),
    ]);
    const org = orgRes.rows[0];
    return {
        user: userRes.rows[0],
        organisation: { id: org.id, name: org.name, portal_slug: org.portal_slug },
        role: access.role,
        permissions: Array.from(ROLE_PERMISSIONS[access.role]),
        branches: branchRes.rows,
        ...(access.role === 'EMPLOYEE' ? { employee_capabilities: { can_submit_timesheets: org.employees_can_submit_timesheets } } : {}),
    };
}

/**
 * Final login step, shared by every path (password, suspicious-login verification, 2FA).
 * Access is resolved again here, so a session is only ever created for an OWNER or an
 * assigned BRANCH_ADMIN of the target organisation.
 */
async function completeLogin(user: any, orgId: string, clientInfo: ClientInfo, authMethod: string, status: 'SUCCESS' | 'CHALLENGE_VERIFIED') {
    const access = await resolveAccess(user.id, orgId);
    if (!access) return null;

    const session = await createSession(user.id, orgId, clientInfo);
    await recordLoginAttempt({ userId: user.id, orgId, email: user.email, status, clientInfo, authMethod, sessionId: session.sessionId });
    await writeAudit({
        orgId, actorId: user.id, action: 'LOGIN_SUCCESS', entityType: 'auth', entityId: session.sessionId,
        details: `Signed in from ${clientInfo.approxLocation}`, ip: clientInfo.ip
    });

    const description = await describeAccess(user.id, orgId);
    return { token: generateToken({ sub: user.id, sid: session.sessionId }), ...description };
}

/**
 * POST /api/auth/login
 * { email, password, organisation_slug }
 *
 * Sign-in only happens through an organisation's own portal link (/login/:slug), so the slug is
 * required. There is deliberately no generic sign-in: no organisation picker, no sign-in by
 * organisation id, and nothing that reveals which organisations an email belongs to. Unknown
 * email, wrong password, inactive account, unknown organisation and "no access to that
 * organisation" all produce the same response.
 */
router.post('/login', checkRateLimit, async (req: RateLimitedRequest, res: Response) => {
    const { email, password, organisation_slug } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_FAILED', message: 'Email and password are required.' } });
    }
    if (typeof organisation_slug !== 'string' || !organisation_slug.trim()) {
        return res.status(400).json({ success: false, error: { code: 'ORGANISATION_PORTAL_REQUIRED', message: 'Sign in using your organisation\'s sign-in link.' } });
    }

    const cleanEmail = email.trim().toLowerCase();
    const clientInfo = parseClientInfo(req);
    const fail = async (userId?: string) => {
        recordFailedAttempt(req.rateLimitKey);
        await recordLoginAttempt({ userId, email: cleanEmail, status: 'FAILED', clientInfo, authMethod: 'password' });
        return res.status(401).json(INVALID_CREDENTIALS);
    };

    try {
        const userRes = await query('SELECT * FROM users WHERE LOWER(email) = $1', [cleanEmail]);
        const user = userRes.rows[0];
        const passwordOk = await comparePassword(password, user?.password_hash || await dummyPasswordHash);
        if (!user || !user.is_active || !user.password_hash || !passwordOk) {
            return fail(user?.id);
        }

        // The organisation is named by the portal URL only; access to it is then checked like any other.
        const orgId = (await findOrganisationBySlug(organisation_slug))?.id;
        if (!orgId) return fail(user.id);

        if (!(await resolveAccess(user.id, orgId))) {
            return fail(user.id);
        }

        // The suspicious-login email challenge and 2FA codes both need working email. While email
        // is off, neither can be completed, so both are skipped rather than locking the account
        // out — the attempt is still written to the audit log so the Owner can review it.
        const risk = await assessLoginRisk(user.id, clientInfo, req);
        if (risk.isSuspicious) {
            if (!isEmailSendingEnabled()) {
                await writeAudit({ orgId, actorId: user.id, action: 'LOGIN_SUSPICIOUS_CHALLENGE_SKIPPED', entityType: 'auth', entityId: user.id, details: `Skipped, email is off: ${risk.reason}`, ip: clientInfo.ip });
            } else {
                const challenge = await createLoginChallenge(user.id, orgId, clientInfo);
                const template = buildSuspiciousLoginVerificationTemplate({
                    recipientEmail: user.email,
                    verifyLink: `${publicBaseUrl()}/verify-login?token=${challenge.token}`,
                    verificationCode: challenge.code,
                    approxLocation: clientInfo.approxLocation,
                    deviceInfo: clientInfo.deviceInfo
                });
                const emailResult = await sendTransactionalEmail({ to: user.email, subject: template.subject, html: template.html, text: template.text });
                if (!emailResult.success) {
                    return res.status(503).json({ success: false, error: { code: 'EMAIL_DELIVERY_FAILED', message: 'We could not send your verification email. Please try again shortly.' } });
                }
                await recordLoginAttempt({ userId: user.id, orgId, email: cleanEmail, status: 'CHALLENGE_REQUIRED', clientInfo, authMethod: 'password' });
                await writeAudit({ orgId, actorId: user.id, action: 'LOGIN_SUSPICIOUS_CHALLENGE', entityType: 'auth', entityId: challenge.challengeId, details: risk.reason, ip: clientInfo.ip });
                return res.json({
                    success: true,
                    require_login_verification: true,
                    challenge_id: challenge.challengeId,
                    masked_email: maskEmail(user.email),
                    message: 'Sign-in from a new location requires confirmation. Please check your email inbox.'
                });
            }
        }

        if (user.two_factor_enabled === true) {
            if (!isEmailSendingEnabled()) {
                await writeAudit({ orgId, actorId: user.id, action: 'LOGIN_2FA_SKIPPED', entityType: 'auth', entityId: user.id, details: 'Two-step verification skipped, email is off', ip: clientInfo.ip });
            } else {
                const step = await beginTwoFactorStep(user, orgId);
                return res.status(step.status).json(step.body);
            }
        }

        const data = await completeLogin(user, orgId, clientInfo, 'password', 'SUCCESS');
        if (!data) return fail(user.id);
        clearRateLimit(req.rateLimitKey);
        res.json({ success: true, data });
    } catch (err) {
        sendError(res, err, 'LOGIN ERROR');
    }
});

/**
 * POST /api/auth/verify-login
 * Confirms a suspicious-login challenge, bound to one specific challenge by either the emailed
 * single-use `token`, or `challenge_id` + the emailed 6-digit `code`. A bare code is never
 * accepted. Success leads to the 2FA step when the account has 2FA enabled.
 */
router.post('/verify-login', checkRateLimit, async (req: RateLimitedRequest, res: Response) => {
    const { token, code, challenge_id } = req.body || {};
    const clientInfo = parseClientInfo(req);
    const invalidChallenge = () => res.status(400).json({
        success: false,
        error: { code: 'INVALID_CHALLENGE', message: 'This verification request is invalid, expired or already used. Please sign in again.' }
    });
    const locked = () => res.status(429).json({
        success: false,
        error: { code: 'CHALLENGE_LOCKED', message: 'Too many incorrect attempts. Please sign in again.' }
    });

    try {
        let challenge: any = null;

        if (typeof token === 'string' && token.trim()) {
            const found = await query(
                'SELECT * FROM login_verification_challenges WHERE token_hash = $1 AND consumed = false AND expires_at > NOW()',
                [sha256Hex(token.trim())]
            );
            challenge = found.rows[0] || null;
            if (!challenge) {
                recordFailedAttempt(req.rateLimitKey);
                return invalidChallenge();
            }
        } else if (isUuid(challenge_id) && typeof code === 'string' && /^\d{6}$/.test(code.trim())) {
            const found = await query(
                'SELECT * FROM login_verification_challenges WHERE id = $1 AND consumed = false AND expires_at > NOW()',
                [challenge_id]
            );
            challenge = found.rows[0] || null;
            if (!challenge) {
                recordFailedAttempt(req.rateLimitKey);
                return invalidChallenge();
            }

            const attempts = Number(challenge.attempts || 0);
            if (attempts >= 5) {
                await query('UPDATE login_verification_challenges SET consumed = true WHERE id = $1', [challenge.id]);
                return locked();
            }
            if (!hashesEqual(challenge.verification_code, sha256Hex(code.trim()))) {
                const nextAttempts = attempts + 1;
                await query(
                    'UPDATE login_verification_challenges SET attempts = $1, consumed = $2 WHERE id = $3',
                    [nextAttempts, nextAttempts >= 5, challenge.id]
                );
                recordFailedAttempt(req.rateLimitKey);
                if (nextAttempts >= 5) return locked();
                const remaining = 5 - nextAttempts;
                return res.status(400).json({
                    success: false,
                    error: { code: 'INVALID_CODE', message: `Incorrect verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` }
                });
            }
        } else {
            return res.status(400).json({
                success: false,
                error: { code: 'CHALLENGE_REQUIRED', message: 'Open the link in your email, or enter the 6-digit code on the sign-in page that requested it.' }
            });
        }

        // Atomic single use: only one request can consume the challenge.
        const consumed = await query(
            'UPDATE login_verification_challenges SET consumed = true WHERE id = $1 AND consumed = false RETURNING id',
            [challenge.id]
        );
        if (consumed.rows.length === 0 || !challenge.org_id) return invalidChallenge();
        clearRateLimit(req.rateLimitKey);

        const userRes = await query('SELECT * FROM users WHERE id = $1 AND is_active = true', [challenge.user_id]);
        const user = userRes.rows[0];
        if (!user) return invalidChallenge();

        // The suspicious-login check never replaces the second factor — except while email is off,
        // when neither can be completed by email, so 2FA is skipped the same way login does it.
        if (user.two_factor_enabled === true) {
            if (!isEmailSendingEnabled()) {
                await writeAudit({ orgId: challenge.org_id, actorId: user.id, action: 'LOGIN_2FA_SKIPPED', entityType: 'auth', entityId: user.id, details: 'Two-step verification skipped, email is off', ip: clientInfo.ip });
            } else {
                const step = await beginTwoFactorStep(user, challenge.org_id);
                return res.status(step.status).json(step.body);
            }
        }

        const data = await completeLogin(user, challenge.org_id, clientInfo, 'suspicious_verify', 'CHALLENGE_VERIFIED');
        if (!data) return invalidChallenge();
        res.json({ success: true, data });
    } catch (err) {
        sendError(res, err, 'VERIFY LOGIN ERROR');
    }
});

/**
 * POST /api/auth/verify-2fa
 */
router.post('/verify-2fa', checkRateLimit, async (req: RateLimitedRequest, res: Response) => {
    const { temp_token, code } = req.body || {};
    if (typeof temp_token !== 'string' || typeof code !== 'string') {
        return res.status(400).json({ success: false, error: { message: 'Verification session and code are required.' } });
    }

    let pending: { sub: string; org: string };
    try {
        pending = verifyTempToken(temp_token);
    } catch {
        return res.status(401).json({ success: false, error: { message: 'Verification session expired. Please sign in again.' } });
    }

    const clientInfo = parseClientInfo(req);
    try {
        const userRes = await query('SELECT * FROM users WHERE id = $1 AND is_active = true', [pending.sub]);
        const user = userRes.rows[0];
        if (!user) {
            return res.status(401).json({ success: false, error: { message: 'Verification session expired. Please sign in again.' } });
        }

        const codeRes = await query(
            'SELECT * FROM two_factor_codes WHERE user_id = $1 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
            [user.id]
        );
        const record = codeRes.rows[0];
        if (!record) {
            return res.status(400).json({ success: false, error: { message: 'Verification code expired or invalid. Please request a new code.' } });
        }
        if (record.attempts >= 5) {
            await query('DELETE FROM two_factor_codes WHERE user_id = $1', [user.id]);
            return res.status(429).json({ success: false, error: { message: 'Too many incorrect attempts. Please sign in again to receive a fresh code.' } });
        }
        if (!hashesEqual(record.code_hash, sha256Hex(code.trim()))) {
            const nextAttempts = record.attempts + 1;
            await query('UPDATE two_factor_codes SET attempts = $1 WHERE id = $2', [nextAttempts, record.id]);
            recordFailedAttempt(req.rateLimitKey);
            const remaining = Math.max(0, 5 - nextAttempts);
            return res.status(400).json({
                success: false,
                error: {
                    message: remaining > 0
                        ? `Incorrect verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
                        : 'Too many incorrect attempts. Please sign in again.'
                }
            });
        }

        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [user.id]);
        const data = await completeLogin(user, pending.org, clientInfo, '2fa', 'SUCCESS');
        if (!data) {
            return res.status(401).json(INVALID_CREDENTIALS);
        }
        clearRateLimit(req.rateLimitKey);
        clearRateLimit(`email:${user.email.toLowerCase()}`);
        res.json({ success: true, data });
    } catch (err) {
        sendError(res, err, 'VERIFY 2FA ERROR');
    }
});

/**
 * POST /api/auth/resend-2fa
 * A resend keeps the attempt count of the code it replaces, so resending cannot be used to
 * get unlimited guesses.
 */
router.post('/resend-2fa', checkRateLimit, async (req: RateLimitedRequest, res: Response) => {
    const { temp_token } = req.body || {};
    let pending: { sub: string; org: string };
    try {
        pending = verifyTempToken(String(temp_token || ''));
    } catch {
        return res.status(401).json({ success: false, error: { message: 'Verification session expired. Please sign in again.' } });
    }

    try {
        const userRes = await query('SELECT id, email FROM users WHERE id = $1 AND is_active = true', [pending.sub]);
        const user = userRes.rows[0];
        if (!user) {
            return res.status(401).json({ success: false, error: { message: 'Verification session expired. Please sign in again.' } });
        }

        const existing = await query('SELECT attempts, created_at > NOW() - INTERVAL \'30 seconds\' AS recent FROM two_factor_codes WHERE user_id = $1', [user.id]);
        if (existing.rows[0]?.recent) {
            return res.status(429).json({ success: false, error: { message: 'Please wait at least 30 seconds before requesting another code.' } });
        }
        const carriedAttempts = Number(existing.rows[0]?.attempts || 0);
        if (carriedAttempts >= 5) {
            return res.status(429).json({ success: false, error: { message: 'Too many incorrect attempts. Please sign in again.' } });
        }

        const { code, hash } = newSixDigitCode();
        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [user.id]);
        await query(
            'INSERT INTO two_factor_codes (id, user_id, code_hash, expires_at, attempts) VALUES ($1, $2, $3, $4, $5)',
            [crypto.randomUUID(), user.id, hash, new Date(Date.now() + 10 * 60 * 1000).toISOString(), carriedAttempts]
        );

        const template = buildTwoFactorEmailTemplate({ code, recipientEmail: user.email });
        const emailResult = await sendTransactionalEmail({ to: user.email, subject: template.subject, html: template.html, text: template.text });
        if (!emailResult.success) {
            return res.status(503).json({ success: false, error: { code: 'EMAIL_DELIVERY_FAILED', message: 'We could not send your verification code. Please try again shortly.' } });
        }
        res.json({ success: true, message: 'A fresh verification code has been sent to your email.' });
    } catch (err) {
        sendError(res, err, 'RESEND 2FA ERROR');
    }
});

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
router.post('/keep-alive', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        await touchSession(req.auth!.sessionId, true);
        res.json({ success: true, message: 'Session refreshed successfully.', timeout_seconds: 900 });
    } catch (err) {
        sendError(res, err, 'KEEP-ALIVE ERROR');
    }
});

router.post('/logout', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        await revokeSession(ctx.sessionId);
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'LOGOUT', entityType: 'sessions', entityId: ctx.sessionId, details: 'Signed out' });
        res.json({ success: true, message: 'Signed out successfully.' });
    } catch (err) {
        sendError(res, err, 'LOGOUT ERROR');
    }
});

/** GET /api/auth/me — the single source the frontend builds navigation and controls from. */
router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const description = await describeAccess(req.auth!.userId, req.auth!.orgId);
        res.json({ success: true, data: description });
    } catch (err) {
        sendError(res, err, 'GET ME ERROR');
    }
});

router.put('/me', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
        if (!fullName || fullName.length > 120) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_FAILED', message: 'Name is required (120 characters at most).' } });
        }
        await query('UPDATE users SET full_name = $1 WHERE id = $2', [fullName, req.auth!.userId]);
        res.json({ success: true, data: { full_name: fullName } });
    } catch (err) {
        sendError(res, err, 'UPDATE ME ERROR');
    }
});

router.get('/organisations', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const orgs = await listAccessibleOrganisations(req.auth!.userId);
        res.json({ success: true, data: orgs.map(o => ({ ...o, is_current: o.id === req.auth!.orgId })) });
    } catch (err) {
        sendError(res, err, 'GET ORGANISATIONS ERROR');
    }
});

/**
 * POST /api/auth/switch-organisation
 * Ends the current session and starts a new one bound to the target organisation.
 */
router.post('/switch-organisation', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { organisation_id } = req.body || {};
        if (!isUuid(organisation_id) || !(await resolveAccess(ctx.userId, organisation_id))) {
            return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You do not have access to that organisation.' } });
        }

        const clientInfo = parseClientInfo(req);
        await revokeSession(ctx.sessionId);
        const data = await completeLogin({ id: ctx.userId, email: ctx.email }, organisation_id, clientInfo, 'organisation_switch', 'SUCCESS');
        res.json({ success: true, data });
    } catch (err) {
        sendError(res, err, 'SWITCH ORGANISATION ERROR');
    }
});

// ---------------------------------------------------------------------------
// Account security (own account only)
// ---------------------------------------------------------------------------
router.get('/security/activity', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { userId, sessionId } = req.auth!;
        const lastLoginRes = await query(
            `SELECT approx_location, device_info, created_at FROM login_history
              WHERE user_id = $1 AND status IN ('SUCCESS', 'CHALLENGE_VERIFIED')
              ORDER BY created_at DESC LIMIT 2`,
            [userId]
        );
        // Index 0 is the current login; index 1 is the previous one when it exists.
        const previousLogin = lastLoginRes.rows[1] || lastLoginRes.rows[0] || null;
        const activeSessions = await getActiveUserSessions(userId, sessionId);
        const recentHistoryRes = await query(
            `SELECT id, approx_location, device_info, status, auth_method, created_at FROM login_history
              WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
            [userId]
        );

        res.json({
            success: true,
            data: {
                last_login: previousLogin ? {
                    approx_location: previousLogin.approx_location,
                    device_info: previousLogin.device_info,
                    timestamp: previousLogin.created_at
                } : null,
                active_sessions: activeSessions,
                recent_history: recentHistoryRes.rows
            }
        });
    } catch (err) {
        sendError(res, err, 'SECURITY ACTIVITY ERROR');
    }
});

router.post('/security/revoke-session', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { session_id } = req.body || {};
        const owned = isUuid(session_id)
            ? await query('SELECT id FROM sessions WHERE id = $1 AND user_id = $2', [session_id, req.auth!.userId])
            : { rows: [] };
        if (owned.rows.length === 0) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found.' } });
        }
        await revokeSession(session_id);
        res.json({ success: true, message: 'Session revoked successfully.' });
    } catch (err) {
        sendError(res, err, 'REVOKE SESSION ERROR');
    }
});

router.post('/security/revoke-other-sessions', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        await revokeAllUserSessions(req.auth!.userId, req.auth!.sessionId);
        res.json({ success: true, message: 'All other active sessions have been terminated.' });
    } catch (err) {
        sendError(res, err, 'REVOKE OTHER SESSIONS ERROR');
    }
});

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------
router.post('/forgot-password', throttle, async (req: RateLimitedRequest, res: Response) => {
    const { email, organisation_slug } = req.body || {};
    if (typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({ success: false, error: { message: 'Email required' } });
    }
    // Same message regardless of whether the account exists, so this never reveals that — but
    // while email is off, no reset can be emailed to anyone, so that fact alone is safe to state.
    if (!isEmailSendingEnabled()) {
        return res.json({ success: true, message: 'Password reset by email is currently turned off. Ask your organisation owner to generate a reset link for you from Branch Admins.' });
    }
    const generic = { success: true, message: 'If an account exists, a reset link was sent.' };

    try {
        const userRes = await query('SELECT id, email FROM users WHERE LOWER(email) = $1 AND is_active = true', [email.trim().toLowerCase()]);
        const user = userRes.rows[0];
        if (!user) return res.json(generic);

        // The portal the request came from, kept only when this account really belongs there, so the
        // completed reset can send the user back to that organisation's own sign-in page.
        let orgId: string | null = null;
        if (typeof organisation_slug === 'string' && organisation_slug.trim()) {
            const org = await findOrganisationBySlug(organisation_slug);
            if (org && await resolveAccess(user.id, org.id)) orgId = org.id;
        }

        const token = newSecretToken();
        await query('DELETE FROM reset_tokens WHERE user_id = $1', [user.id]);
        await query(
            'INSERT INTO reset_tokens (token_hash, user_id, expires_at, org_id) VALUES ($1, $2, $3, $4)',
            [token.hash, user.id, new Date(Date.now() + 3600000).toISOString(), orgId]
        );

        const template = buildPasswordResetEmailTemplate({ resetLink: `${publicBaseUrl()}/reset-password?token=${token.raw}`, recipientEmail: user.email });
        await sendTransactionalEmail({ to: user.email, subject: template.subject, html: template.html, text: template.text });
        res.json(generic);
    } catch (err) {
        sendError(res, err, 'FORGOT PASSWORD ERROR');
    }
});

router.get('/verify-reset-token', async (req, res: Response) => {
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (!token) {
        return res.status(400).json({ success: false, valid: false, message: 'Token required.' });
    }
    try {
        const tokenRes = await query(
            'SELECT u.email FROM reset_tokens rt JOIN users u ON u.id = rt.user_id WHERE rt.token_hash = $1 AND rt.expires_at > NOW()',
            [sha256Hex(token)]
        );
        if (tokenRes.rows.length === 0) {
            return res.status(400).json({ success: false, valid: false, message: 'Invalid or expired password reset link.' });
        }
        res.json({ success: true, valid: true, email: maskEmail(tokenRes.rows[0].email) });
    } catch (err) {
        sendError(res, err, 'VERIFY RESET TOKEN ERROR');
    }
});

router.post('/reset-password', checkRateLimit, async (req: RateLimitedRequest, res: Response) => {
    const { token, password } = req.body || {};
    if (typeof token !== 'string' || !token.trim() || !password) {
        return res.status(400).json({ success: false, error: { message: 'Token and new password required' } });
    }
    const strength = isStrongPassword(password);
    if (!strength.valid) {
        return res.status(400).json({ success: false, error: { message: strength.reason } });
    }

    try {
        // Single use: the token row is consumed by the same statement that validates it.
        const tokenRes = await query(
            'DELETE FROM reset_tokens WHERE token_hash = $1 AND expires_at > NOW() RETURNING user_id, org_id',
            [sha256Hex(token.trim())]
        );
        if (tokenRes.rows.length === 0) {
            recordFailedAttempt(req.rateLimitKey);
            return res.status(400).json({ success: false, error: { message: 'Invalid or expired token' } });
        }

        const userId = tokenRes.rows[0].user_id;
        await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(password), userId]);
        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [userId]);
        await revokeAllUserSessions(userId);
        clearRateLimit(req.rateLimitKey);

        res.json({
            success: true,
            data: { login_path: await portalLoginPath(userId, tokenRes.rows[0].org_id) },
            message: 'Password updated successfully. You can now sign in.'
        });
    } catch (err) {
        sendError(res, err, 'RESET PASSWORD ERROR');
    }
});

// ---------------------------------------------------------------------------
// Two-step verification settings (own account only)
// ---------------------------------------------------------------------------
router.get('/2fa/status', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const userRes = await query('SELECT email, two_factor_enabled FROM users WHERE id = $1', [req.auth!.userId]);
        res.json({ success: true, data: { enabled: Boolean(userRes.rows[0].two_factor_enabled), email: userRes.rows[0].email } });
    } catch (err) {
        sendError(res, err, '2FA STATUS ERROR');
    }
});

router.post('/2fa/send-setup-code', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { userId, email } = req.auth!;
        if (!isEmailSendingEnabled()) {
            return res.status(503).json({ success: false, error: { code: 'EMAIL_DISABLED', message: 'Two-step verification needs email, which is currently turned off.' } });
        }
        const { code, hash } = newSixDigitCode();
        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [userId]);
        await query(
            'INSERT INTO two_factor_codes (id, user_id, code_hash, expires_at, attempts) VALUES ($1, $2, $3, $4, 0)',
            [crypto.randomUUID(), userId, hash, new Date(Date.now() + 10 * 60 * 1000).toISOString()]
        );

        const template = buildTwoFactorEmailTemplate({ code, recipientEmail: email });
        const emailResult = await sendTransactionalEmail({ to: email, subject: template.subject, html: template.html, text: template.text });
        if (!emailResult.success) {
            return res.status(503).json({ success: false, error: { code: 'EMAIL_DELIVERY_FAILED', message: 'We could not send your setup code. Please try again shortly.' } });
        }
        res.json({ success: true, message: 'Setup code sent to your email.' });
    } catch (err) {
        sendError(res, err, '2FA SETUP SEND ERROR');
    }
});

router.post('/2fa/enable', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { code, password } = req.body || {};
        if (typeof code !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ success: false, error: { message: 'Verification code and current password required.' } });
        }

        const userRes = await query('SELECT password_hash FROM users WHERE id = $1', [ctx.userId]);
        if (!(await comparePassword(password, userRes.rows[0].password_hash))) {
            return res.status(401).json({ success: false, error: { message: 'Invalid current password.' } });
        }

        const codeRes = await query('SELECT * FROM two_factor_codes WHERE user_id = $1 AND expires_at > NOW()', [ctx.userId]);
        const stored = codeRes.rows[0];
        if (!stored || stored.attempts >= 5) {
            await query('DELETE FROM two_factor_codes WHERE user_id = $1', [ctx.userId]);
            return res.status(400).json({ success: false, error: { message: 'Verification code expired or not found. Please request a new code.' } });
        }
        if (!hashesEqual(stored.code_hash, sha256Hex(code.trim()))) {
            await query('UPDATE two_factor_codes SET attempts = attempts + 1 WHERE id = $1', [stored.id]);
            return res.status(400).json({ success: false, error: { message: 'Invalid verification code.' } });
        }

        await query('UPDATE users SET two_factor_enabled = true WHERE id = $1', [ctx.userId]);
        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [ctx.userId]);
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: '2FA_ENABLED', entityType: 'users', entityId: ctx.userId, details: 'Two-step verification enabled' });
        res.json({ success: true, message: 'Two-Step Verification successfully enabled.' });
    } catch (err) {
        sendError(res, err, '2FA ENABLE ERROR');
    }
});

router.post('/2fa/disable', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { password } = req.body || {};
        if (typeof password !== 'string' || !password) {
            return res.status(400).json({ success: false, error: { message: 'Current password required to disable 2FA.' } });
        }
        const userRes = await query('SELECT password_hash FROM users WHERE id = $1', [ctx.userId]);
        if (!(await comparePassword(password, userRes.rows[0].password_hash))) {
            return res.status(401).json({ success: false, error: { message: 'Invalid password.' } });
        }

        await query('UPDATE users SET two_factor_enabled = false WHERE id = $1', [ctx.userId]);
        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [ctx.userId]);
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: '2FA_DISABLED', entityType: 'users', entityId: ctx.userId, details: 'Two-step verification disabled' });
        res.json({ success: true, message: 'Two-Step Verification disabled.' });
    } catch (err) {
        sendError(res, err, '2FA DISABLE ERROR');
    }
});

export default router;
