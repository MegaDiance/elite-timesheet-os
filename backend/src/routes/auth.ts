import { Router, Response } from 'express';
import { query } from '../services/db';
import { comparePassword, generateToken, generateTempToken, verifyToken, verifyTempToken, hashPassword } from '../services/auth';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { resolveUserSecurityContext } from '../services/permissionService';
import { sendTransactionalEmail, buildPasswordResetEmailTemplate, buildTwoFactorEmailTemplate, buildSuspiciousLoginVerificationTemplate } from '../services/emailService';
import { createSession, touchSession, revokeSession, revokeAllUserSessions, getActiveUserSessions, recordLoginAttempt } from '../services/sessionService';
import { parseClientInfo, assessLoginRisk, createLoginChallenge } from '../services/securityService';
import crypto from 'crypto';

const router = Router();

// Rate limiting state: key -> { count, firstAttempt }
const rateLimits = new Map<string, { count: number, firstAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function normalizeRateLimitKey(key: string): string {
    if (!key) return 'ip:127.0.0.1';
    if (key.startsWith('email:') || key.startsWith('ip:')) return key;
    if (key.includes('@')) return `email:${key.trim().toLowerCase()}`;
    return `ip:${key.trim()}`;
}

function checkRateLimit(req: any, res: any, next: any) {
    const rawEmail = req.body?.email;
    let key: string;
    if (rawEmail && typeof rawEmail === 'string' && rawEmail.trim()) {
        key = `email:${rawEmail.trim().toLowerCase()}`;
    } else {
        const clientInfo = parseClientInfo(req);
        key = `ip:${clientInfo.ip || '127.0.0.1'}`;
    }
    key = normalizeRateLimitKey(key);
    const attempts = rateLimits.get(key) || { count: 0, firstAttempt: Date.now() };
    
    if (Date.now() - attempts.firstAttempt > LOCKOUT_MS) {
        attempts.count = 0;
        attempts.firstAttempt = Date.now();
    }
    
    if (attempts.count >= MAX_ATTEMPTS) {
        return res.status(429).json({
            success: false,
            error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please try again in 15 minutes.' }
        });
    }
    
    req.rateLimitKey = key;
    req.rateLimitAttempts = attempts;
    next();
}

function recordFailedAttempt(key: string, attempts: any) {
    const normKey = normalizeRateLimitKey(key);
    if (!attempts) {
        attempts = rateLimits.get(normKey) || { count: 0, firstAttempt: Date.now() };
    }
    attempts.count++;
    rateLimits.set(normKey, attempts);
}

function clearRateLimit(key: string) {
    const normKey = normalizeRateLimitKey(key);
    rateLimits.delete(normKey);
}

export function clearAllRateLimits() {
    rateLimits.clear();
}

function isStrongPassword(password: string): { valid: boolean; reason?: string } {
    if (!password || password.length < 8) {
        return { valid: false, reason: 'Password must be at least 8 characters long.' };
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        return { valid: false, reason: 'Password must contain both letters and numbers.' };
    }
    return { valid: true };
}

function maskEmail(email: string): string {
    if (!email || !email.includes('@')) return 'your email';
    const [name, domain] = email.split('@');
    if (name.length <= 2) {
        return `${name[0]}***@${domain}`;
    }
    return `${name.slice(0, 2)}***${name.slice(-1)}@${domain}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sha256Hex(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function hashesEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a || '', 'utf8');
    const bufB = Buffer.from(b || '', 'utf8');
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Issues an email one-time code and a short-lived 2fa_pending token bound to this user.
 * Used by every path that has verified the password (login, suspicious-login verification)
 * so that no path can reach a full session without the second factor.
 */
async function beginTwoFactorStep(user: any, orgId: string | undefined, role: string | undefined): Promise<{ status: number; body: any }> {
    const code = Math.floor(100000 + crypto.randomInt(900000)).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await query('DELETE FROM two_factor_codes WHERE user_id = $1', [user.id]);
    await query(
        'INSERT INTO two_factor_codes (id, user_id, code_hash, expires_at, attempts) VALUES ($1, $2, $3, $4, 0)',
        [crypto.randomUUID(), user.id, sha256Hex(code), expiresAt]
    );

    const emailTemplate = buildTwoFactorEmailTemplate({ code, recipientEmail: user.email });
    const emailResult = await sendTransactionalEmail({
        to: user.email,
        subject: emailTemplate.subject,
        html: emailTemplate.html,
        text: emailTemplate.text
    });

    if (!emailResult.success) {
        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [user.id]).catch(() => {});
        return {
            status: 503,
            body: { success: false, error: { code: 'EMAIL_DELIVERY_FAILED', message: 'We could not send your verification code. Please try again shortly.' } }
        };
    }

    const tempToken = generateTempToken({ id: user.id, email: user.email, organisation_id: orgId, role });
    return {
        status: 200,
        body: { success: true, require_2fa: true, temp_token: tempToken, masked_email: maskEmail(user.email) }
    };
}

async function getUserOrganisations(userId: string, currentOrgId?: string, userRole?: string): Promise<any[]> {
    try {
        if (userRole === 'Platform Admin') {
            const allOrgs = await query('SELECT id, name, slug FROM organisations WHERE is_active = true ORDER BY name ASC');
            return allOrgs.rows.map((o: any) => ({
                id: o.id,
                name: o.name,
                slug: o.slug || o.id,
                role: 'Platform Admin',
                is_current: o.id === currentOrgId
            }));
        }

        try {
            const orgsRes = await query(`
                SELECT DISTINCT o.id, o.name, o.slug, COALESCE(om.role, u.role) as role
                FROM organisations o
                LEFT JOIN organisation_members om ON om.organisation_id = o.id AND om.user_id = $1
                LEFT JOIN users u ON u.id = $1
                WHERE (om.user_id = $1 OR (u.id = $1 AND u.org_id = o.id))
                  AND o.is_active = true
                ORDER BY o.name ASC
            `, [userId]);

            return orgsRes.rows.map((o: any) => ({
                id: o.id,
                name: o.name,
                slug: o.slug || o.id,
                role: o.role || 'Employee',
                is_current: o.id === currentOrgId
            }));
        } catch (dbErr) {
            const orgsResFallback = await query(`
                SELECT o.id, o.name, o.slug, om.role
                FROM organisation_members om
                JOIN organisations o ON om.organisation_id = o.id
                WHERE om.user_id = $1 AND o.is_active = true
            `, [userId]);

            return orgsResFallback.rows.map((o: any) => ({
                id: o.id,
                name: o.name,
                slug: o.slug || o.id,
                role: o.role,
                is_current: o.id === currentOrgId
            }));
        }
    } catch (err) {
        return [];
    }
}

export async function getUserLocations(userId: string, orgId: string, userRole?: string): Promise<any[]> {
    try {
        if (userRole === 'Platform Admin') {
            try {
                const allLocs = await query(
                    'SELECT id, name, address, timezone, is_active, \'BRANCH_ADMIN\' as role FROM locations WHERE (org_id = $1 OR organisation_id = $1) AND is_active = true ORDER BY name ASC',
                    [orgId]
                );
                return allLocs.rows;
            } catch {
                const allLocs = await query(
                    'SELECT id, name, is_active, \'BRANCH_ADMIN\' as role FROM locations WHERE org_id = $1 ORDER BY name ASC',
                    [orgId]
                );
                return allLocs.rows;
            }
        }

        let locs: any[] = [];
        try {
            const locRes = await query(`
                SELECT l.id, l.name, l.address, l.timezone, l.is_active, lm.role
                FROM location_memberships lm
                JOIN locations l ON lm.location_id = l.id
                WHERE lm.user_id = $1 AND (l.org_id = $2 OR l.organisation_id = $2) AND l.is_active = true
                ORDER BY l.name ASC
            `, [userId, orgId]);
            locs = locRes.rows;
        } catch {
            try {
                const locRes = await query(`
                    SELECT l.id, l.name, l.is_active, lm.role
                    FROM location_memberships lm
                    JOIN locations l ON lm.location_id = l.id
                    WHERE lm.user_id = $1 AND l.org_id = $2
                    ORDER BY l.name ASC
                `, [userId, orgId]);
                locs = locRes.rows;
            } catch {
                locs = [];
            }
        }

        if (locs.length === 0) {
            try {
                const empLocRes = await query(`
                    SELECT l.id, l.name, l.address, l.timezone, l.is_active, 'Employee' as role
                    FROM employees e
                    JOIN locations l ON e.location_id = l.id
                    WHERE e.user_id = $1 AND e.org_id = $2 AND l.is_active = true AND e.is_active = true AND e.deleted_at IS NULL
                    ORDER BY l.name ASC
                `, [userId, orgId]);
                if (empLocRes.rows.length > 0) {
                    locs = empLocRes.rows;
                }
            } catch {}
        }

        return locs;
    } catch (err) {
        return [];
    }
}

/**
 * POST /api/auth/login
 * Validates credentials, checks for suspicious context / 2FA, creates server-backed session.
 */
router.post('/login', checkRateLimit, async (req: any, res: any) => {
    const { email, password, organisation_slug, organisation_id } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const clientInfo = parseClientInfo(req);

    try {
        const result = await query('SELECT * FROM users WHERE LOWER(email) = $1', [cleanEmail]);
        const user = result.rows[0];

        if (!user || !user.is_active || !user.password_hash) {
            recordFailedAttempt(cleanEmail, req.rateLimitAttempts);
            await recordLoginAttempt({
                email: cleanEmail,
                status: 'FAILED',
                clientInfo,
                authMethod: 'password'
            });
            await query(
                `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_type, details)
                 VALUES ($1, $2, NOW(), $3, 'LOGIN_FAILED', 'auth', $4)`,
                [crypto.randomUUID(), user?.org_id || '123e4567-e89b-12d3-a456-000000000000', user?.id || null, `Failed login attempt for email: ${cleanEmail}`]
            ).catch(() => {});
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const valid = await comparePassword(password, user.password_hash);
        if (!valid) {
            recordFailedAttempt(cleanEmail, req.rateLimitAttempts);
            await recordLoginAttempt({
                userId: user.id,
                orgId: user.org_id,
                email: cleanEmail,
                status: 'FAILED',
                clientInfo,
                authMethod: 'password'
            });
            await query(
                `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_type, details)
                 VALUES ($1, $2, NOW(), $3, 'LOGIN_FAILED', 'auth', $4)`,
                [crypto.randomUUID(), user.org_id || '123e4567-e89b-12d3-a456-000000000000', user.id, `Failed password attempt for ${cleanEmail}`]
            ).catch(() => {});
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check if an organisation was specified for dedicated workplace login
        let targetOrg: any = null;
        if (organisation_id) {
            try {
                const orgRes = await query('SELECT id, name, slug, portal_slug, is_active FROM organisations WHERE id = $1', [organisation_id]);
                targetOrg = orgRes.rows[0];
            } catch {}
        } else if (organisation_slug) {
            const cleanSlug = organisation_slug.trim().toLowerCase();
            try {
                const orgRes = await query('SELECT id, name, slug, portal_slug, is_active FROM organisations WHERE portal_slug = $1 OR LOWER(slug) = $1', [cleanSlug]);
                if (orgRes.rows.length > 0) {
                    targetOrg = orgRes.rows[0];
                } else {
                    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanSlug);
                    if (isUuid) {
                        const orgById = await query('SELECT id, name, slug, is_active FROM organisations WHERE id = $1', [cleanSlug]);
                        targetOrg = orgById.rows[0];
                    }
                }
            } catch {
                try {
                    const orgRes = await query('SELECT id, name, slug, is_active FROM organisations WHERE LOWER(slug) = $1', [cleanSlug]);
                    if (orgRes.rows.length > 0) {
                        targetOrg = orgRes.rows[0];
                    } else {
                        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanSlug);
                        if (isUuid) {
                            const orgById = await query('SELECT id, name, slug, is_active FROM organisations WHERE id = $1', [cleanSlug]);
                            targetOrg = orgById.rows[0];
                        }
                    }
                } catch {}
            }
        }

        // Cross-Organisation Conflict Check: If client is already authenticated in another organisation, require sign-out first
        const existingAuthHeader = req.headers.authorization;
        if (existingAuthHeader && existingAuthHeader.startsWith('Bearer ')) {
            try {
                const decodedOld = verifyToken(existingAuthHeader.split(' ')[1]);
                if (decodedOld?.organisation_id && targetOrg && decodedOld.organisation_id !== targetOrg.id) {
                    return res.status(409).json({
                        success: false,
                        code: 'SESSION_ORG_CONFLICT',
                        message: 'You are currently authenticated in another organisation. Please sign out first before accessing this workspace.'
                    });
                }
            } catch {}
        }

        if ((organisation_id || organisation_slug) && !targetOrg) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'ORGANISATION_NOT_FOUND',
                    message: 'The specified organisation could not be found.'
                }
            });
        }

        if (targetOrg && targetOrg.is_active === false) {
            return res.status(403).json({
                success: false,
                error: { message: 'This workplace organisation is currently deactivated.' }
            });
        }

        let effectiveOrgId = user.org_id;
        let effectiveRole = user.role;

        if (targetOrg) {
            let memberRes: any = { rows: [] };
            try {
                memberRes = await query(
                    'SELECT role FROM organisation_members WHERE organisation_id = $1 AND user_id = $2',
                    [targetOrg.id, user.id]
                );
            } catch {
                memberRes = { rows: [] };
            }

            if (memberRes.rows.length > 0) {
                effectiveRole = memberRes.rows[0].role;
                effectiveOrgId = targetOrg.id;
            } else if (user.role === 'Platform Admin') {
                effectiveRole = 'Platform Admin';
                effectiveOrgId = targetOrg.id;
            } else {
                let empRes: any = { rows: [] };
                try {
                    empRes = await query(
                        'SELECT id FROM employees WHERE org_id = $1 AND user_id = $2 AND is_active = true AND deleted_at IS NULL',
                        [targetOrg.id, user.id]
                    );
                } catch {
                    empRes = { rows: [] };
                }

                if (empRes.rows.length > 0) {
                    effectiveRole = user.role;
                    effectiveOrgId = targetOrg.id;
                } else {
                    recordFailedAttempt(cleanEmail, req.rateLimitAttempts);
                    return res.status(403).json({
                        success: false,
                        error: {
                            code: 'NO_ORGANISATION_ACCESS',
                            message: `Your account does not have access to ${targetOrg.name}. Please locate your correct organisation portal.`
                        }
                    });
                }
            }
        }

        // Suspicious Login Risk Assessment
        const risk = await assessLoginRisk(user.id, clientInfo, req);
        if (risk.isSuspicious) {
            const challenge = await createLoginChallenge(user.id, effectiveOrgId, effectiveRole, clientInfo);
            const origin = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:3000';
            const verifyLink = `${origin}/verify-login?token=${challenge.token}`;

            const emailTemplate = buildSuspiciousLoginVerificationTemplate({
                recipientEmail: user.email,
                verifyLink,
                verificationCode: challenge.code,
                approxLocation: clientInfo.approxLocation,
                deviceInfo: clientInfo.deviceInfo
            });

            await sendTransactionalEmail({
                to: user.email,
                subject: emailTemplate.subject,
                html: emailTemplate.html,
                text: emailTemplate.text
            });

            await recordLoginAttempt({
                userId: user.id,
                orgId: effectiveOrgId,
                email: cleanEmail,
                status: 'CHALLENGE_REQUIRED',
                clientInfo,
                authMethod: 'password'
            });

            await query(
                `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_type, entity_id, details)
                 VALUES ($1, $2, NOW(), $3, 'LOGIN_SUSPICIOUS_CHALLENGE', 'auth', $4, $5)`,
                [
                    crypto.randomUUID(),
                    effectiveOrgId || '123e4567-e89b-12d3-a456-000000000000',
                    user.id,
                    challenge.challengeId,
                    `Suspicious login challenge issued: ${risk.reason}`
                ]
            ).catch(() => {});

            return res.json({
                success: true,
                require_login_verification: true,
                challenge_id: challenge.challengeId,
                masked_email: maskEmail(user.email),
                message: 'Sign-in from a new location requires confirmation. Please check your email inbox.'
            });
        }

        // Gracefully detect if two_factor_codes table is available in the current database
        let has2FATable = true;
        try {
            await query('SELECT 1 FROM two_factor_codes LIMIT 1');
        } catch {
            has2FATable = false;
        }

        // Two-Step Verification Check (default: disabled until user explicitly enables it)
        const is2FAEnabled = has2FATable && user.two_factor_enabled === true;
        if (is2FAEnabled) {
            const step = await beginTwoFactorStep(user, effectiveOrgId, effectiveRole);
            return res.status(step.status).json(step.body);
        }

        const userLocations = await getUserLocations(user.id, effectiveOrgId, effectiveRole);
        let activeLocationId: string | null = null;
        if (req.body.location_id) {
            const hasLocationAccess = effectiveRole === 'Platform Admin' || userLocations.some(l => l.id === req.body.location_id);
            if (!hasLocationAccess) {
                return res.status(403).json({
                    success: false,
                    error: {
                        code: 'LOCATION_FORBIDDEN',
                        message: 'You do not have access to the specified location.'
                    }
                });
            }
            activeLocationId = req.body.location_id;
        } else {
            if (effectiveRole === 'Owner') {
                activeLocationId = userLocations.length === 1 ? userLocations[0].id : null;
            } else if (userLocations.length === 1) {
                activeLocationId = userLocations[0].id;
            } else {
                activeLocationId = null;
            }
        }

        // Successful Standard Authentication -> Create Server Session
        clearRateLimit(cleanEmail);
        const session = await createSession(user.id, effectiveOrgId, clientInfo, activeLocationId || undefined);

        const orgs = await getUserOrganisations(user.id, effectiveOrgId, effectiveRole);
        const token = generateToken({
            id: user.id,
            email: user.email,
            organisation_id: effectiveOrgId,
            location_id: activeLocationId || undefined,
            role: effectiveRole,
            session_id: session.sessionId
        });

        await recordLoginAttempt({
            userId: user.id,
            orgId: effectiveOrgId,
            email: cleanEmail,
            status: 'SUCCESS',
            clientInfo,
            authMethod: 'password',
            sessionId: session.sessionId
        });

        await query(
            `INSERT INTO audit_logs (id, org_id, location_id, timestamp, actor_id, action, entity_type, entity_id, details, scope)
             VALUES ($1, $2, $3, NOW(), $4, 'LOGIN_SUCCESS', 'auth', $5, $6, 'organisation')`,
            [crypto.randomUUID(), effectiveOrgId || '123e4567-e89b-12d3-a456-000000000000', activeLocationId, user.id, session.sessionId, `User logged in from ${clientInfo.approxLocation}`]
        ).catch(() => {});

        res.json({
            success: true,
            data: {
                token,
                session_id: session.sessionId,
                user: {
                    id: user.id,
                    email: user.email,
                    role: effectiveRole,
                    organisation_id: effectiveOrgId,
                    location_id: activeLocationId,
                    organisations: orgs,
                    locations: userLocations
                },
                require_location_selection: !activeLocationId && userLocations.length > 1,
                available_locations: userLocations
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/auth/verify-login
 * Confirms a suspicious-login challenge.
 *
 * The request must be bound to one specific challenge, by either:
 *   - `token`: the 256-bit single-use token from the emailed link, or
 *   - `challenge_id` + `code`: the id returned to the client that passed the password step,
 *     plus the 6-digit code from the email.
 * A bare code (or email + code) is never accepted, codes are compared by hash only, each
 * challenge allows 5 attempts and is consumed atomically. If the user has two-factor
 * authentication enabled, success leads to the 2FA step, not directly to a session.
 */
router.post('/verify-login', checkRateLimit, async (req: any, res: Response) => {
    const { token, code, challenge_id } = req.body || {};
    const clientInfo = parseClientInfo(req);
    const invalidChallenge = () => res.status(400).json({
        success: false,
        error: { code: 'INVALID_CHALLENGE', message: 'This verification request is invalid, expired or already used. Please sign in again.' }
    });

    try {
        let challenge: any = null;

        if (typeof token === 'string' && token.trim()) {
            const found = await query(
                `SELECT * FROM login_verification_challenges
                 WHERE token_hash = $1 AND consumed = false AND expires_at > NOW()`,
                [sha256Hex(token.trim())]
            );
            challenge = found.rows[0] || null;
            if (!challenge) {
                recordFailedAttempt(req.rateLimitKey, req.rateLimitAttempts);
                return invalidChallenge();
            }
        } else if (typeof challenge_id === 'string' && UUID_PATTERN.test(challenge_id) && typeof code === 'string' && /^\d{6}$/.test(code.trim())) {
            const found = await query(
                `SELECT * FROM login_verification_challenges
                 WHERE id = $1 AND consumed = false AND expires_at > NOW()`,
                [challenge_id]
            );
            challenge = found.rows[0] || null;
            if (!challenge) {
                recordFailedAttempt(req.rateLimitKey, req.rateLimitAttempts);
                return invalidChallenge();
            }

            const attempts = Number(challenge.attempts || 0);
            if (attempts >= 5) {
                await query('UPDATE login_verification_challenges SET consumed = true WHERE id = $1', [challenge.id]);
                return res.status(429).json({
                    success: false,
                    error: { code: 'CHALLENGE_LOCKED', message: 'Too many incorrect attempts. Please sign in again.' }
                });
            }

            if (!hashesEqual(challenge.verification_code, sha256Hex(code.trim()))) {
                const nextAttempts = attempts + 1;
                await query(
                    'UPDATE login_verification_challenges SET attempts = $1, consumed = $2 WHERE id = $3',
                    [nextAttempts, nextAttempts >= 5, challenge.id]
                );
                recordFailedAttempt(req.rateLimitKey, req.rateLimitAttempts);
                if (nextAttempts >= 5) {
                    return res.status(429).json({
                        success: false,
                        error: { code: 'CHALLENGE_LOCKED', message: 'Too many incorrect attempts. Please sign in again.' }
                    });
                }
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
        if (consumed.rows.length === 0) {
            return invalidChallenge();
        }
        clearRateLimit(req.rateLimitKey);

        const userRes = await query('SELECT * FROM users WHERE id = $1 AND is_active = true', [challenge.user_id]);
        if (userRes.rows.length === 0) {
            return invalidChallenge();
        }
        const user = userRes.rows[0];

        const effectiveRole = challenge.role || user.role;
        const effectiveOrgId = challenge.org_id || user.org_id;

        // The suspicious-login check never replaces the second factor.
        if (user.two_factor_enabled === true) {
            const step = await beginTwoFactorStep(user, effectiveOrgId, effectiveRole);
            return res.status(step.status).json(step.body);
        }

        const userLocations = await getUserLocations(user.id, effectiveOrgId, effectiveRole);
        const activeLocationId = userLocations.length === 1 ? userLocations[0].id : null;

        const session = await createSession(user.id, effectiveOrgId, clientInfo, activeLocationId || undefined);

        const orgs = await getUserOrganisations(user.id, effectiveOrgId, effectiveRole);
        const authToken = generateToken({
            id: user.id,
            email: user.email,
            organisation_id: effectiveOrgId,
            location_id: activeLocationId || undefined,
            role: effectiveRole,
            session_id: session.sessionId
        });

        await recordLoginAttempt({
            userId: user.id,
            orgId: effectiveOrgId,
            email: user.email,
            status: 'CHALLENGE_VERIFIED',
            clientInfo,
            authMethod: 'suspicious_verify',
            sessionId: session.sessionId
        });

        await query(
            `INSERT INTO audit_logs (id, org_id, location_id, timestamp, actor_id, action, entity_type, entity_id, details, scope)
             VALUES ($1, $2, $3, NOW(), $4, 'SUSPICIOUS_LOGIN_VERIFIED', 'auth', $5, $6, 'organisation')`,
            [crypto.randomUUID(), effectiveOrgId, activeLocationId, user.id, session.sessionId, `Suspicious login verified from ${clientInfo.approxLocation}`]
        ).catch(() => {});

        res.json({
            success: true,
            data: {
                token: authToken,
                session_id: session.sessionId,
                user: {
                    id: user.id,
                    email: user.email,
                    role: effectiveRole,
                    organisation_id: effectiveOrgId,
                    location_id: activeLocationId,
                    organisations: orgs,
                    locations: userLocations
                },
                require_location_selection: !activeLocationId && userLocations.length > 1,
                available_locations: userLocations
            }
        });
    } catch (err: any) {
        console.error('Verify login error:', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Sign-in verification failed. Please try again.' } });
    }
});

/**
 * POST /api/auth/platform-login
 * Secret administrative gateway for Platform Superadministrators.
 */
router.post('/platform-login', checkRateLimit, async (req: any, res: any) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, error: { message: 'Email and password required' } });
    }

    const cleanEmail = email.trim().toLowerCase();
    const clientInfo = parseClientInfo(req);

    try {
        const result = await query('SELECT * FROM users WHERE LOWER(email) = $1', [cleanEmail]);
        const user = result.rows[0];

        if (!user || !user.is_active || !user.password_hash) {
            recordFailedAttempt(cleanEmail, req.rateLimitAttempts);
            await recordLoginAttempt({ email: cleanEmail, status: 'FAILED', clientInfo, authMethod: 'platform_password' });
            return res.status(401).json({ success: false, error: { message: 'Invalid administrative credentials' } });
        }

        const valid = await comparePassword(password, user.password_hash);
        if (!valid) {
            recordFailedAttempt(cleanEmail, req.rateLimitAttempts);
            await recordLoginAttempt({ userId: user.id, orgId: user.org_id, email: cleanEmail, status: 'FAILED', clientInfo, authMethod: 'platform_password' });
            return res.status(401).json({ success: false, error: { message: 'Invalid administrative credentials' } });
        }

        if (user.role !== 'Platform Admin') {
            recordFailedAttempt(cleanEmail, req.rateLimitAttempts);
            return res.status(403).json({
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: 'Access Denied: Account does not possess Platform Administrator clearance.'
                }
            });
        }

        // Check 2FA
        let has2FATable = true;
        try {
            await query('SELECT 1 FROM two_factor_codes LIMIT 1');
        } catch {
            has2FATable = false;
        }

        const is2FAEnabled = has2FATable && user.two_factor_enabled === true;
        if (is2FAEnabled) {
            const code = Math.floor(100000 + crypto.randomInt(900000)).toString();
            const codeHash = crypto.createHash('sha256').update(code).digest('hex');
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

            await query('DELETE FROM two_factor_codes WHERE user_id = $1', [user.id]);
            await query(
                'INSERT INTO two_factor_codes (id, user_id, code_hash, expires_at, attempts) VALUES ($1, $2, $3, $4, 0)',
                [crypto.randomUUID(), user.id, codeHash, expiresAt]
            );

            const emailTemplate = buildTwoFactorEmailTemplate({ code, recipientEmail: user.email });
            await sendTransactionalEmail({
                to: user.email,
                subject: emailTemplate.subject,
                html: emailTemplate.html,
                text: emailTemplate.text
            });

            const tempToken = generateTempToken({
                id: user.id,
                email: user.email,
                organisation_id: user.org_id,
                role: 'Platform Admin'
            });

            return res.json({
                success: true,
                require_2fa: true,
                temp_token: tempToken,
                masked_email: maskEmail(user.email)
            });
        }

        clearRateLimit(cleanEmail);
        const session = await createSession(user.id, user.org_id, clientInfo);

        const orgs = await getUserOrganisations(user.id, user.org_id, 'Platform Admin');
        const token = generateToken({
            id: user.id,
            email: user.email,
            organisation_id: user.org_id,
            role: 'Platform Admin',
            session_id: session.sessionId
        });

        await recordLoginAttempt({
            userId: user.id,
            orgId: user.org_id,
            email: cleanEmail,
            status: 'SUCCESS',
            clientInfo,
            authMethod: 'platform_password',
            sessionId: session.sessionId
        });

        await query(
            'INSERT INTO audit_logs (id, org_id, actor_id, action, entity_type, entity_id, details, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())',
            [crypto.randomUUID(), user.org_id, user.id, 'PLATFORM_LOGIN_SUCCESS', 'users', user.id, `Platform Admin logged in: ${user.email}`]
        ).catch(() => {});

        res.json({
            success: true,
            data: {
                token,
                session_id: session.sessionId,
                user: {
                    id: user.id,
                    email: user.email,
                    role: 'Platform Admin',
                    organisation_id: user.org_id,
                    organisations: orgs
                }
            }
        });
    } catch (err) {
        console.error('Platform login error:', err);
        res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
});

/**
 * POST /api/auth/verify-2fa
 * Validates the 6-digit OTP code against the hashed record in two_factor_codes.
 */
router.post('/verify-2fa', async (req: any, res: any) => {
    const { temp_token, code } = req.body;
    if (!temp_token || !code) {
        return res.status(400).json({ success: false, error: { message: 'Verification session and code are required.' } });
    }

    let decoded: any;
    try {
        decoded = verifyTempToken(temp_token);
    } catch (err: any) {
        return res.status(401).json({ success: false, error: { message: 'Verification session expired. Please sign in again.' } });
    }

    const clientInfo = parseClientInfo(req);

    try {
        const userId = decoded.id;
        const userRes = await query('SELECT * FROM users WHERE id = $1 AND is_active = true', [userId]);
        if (userRes.rows.length === 0) {
            return res.status(401).json({ success: false, error: { message: 'User account not found or inactive.' } });
        }
        const user = userRes.rows[0];

        const codeRes = await query(
            'SELECT * FROM two_factor_codes WHERE user_id = $1 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
            [userId]
        );

        if (codeRes.rows.length === 0) {
            return res.status(400).json({ success: false, error: { message: 'Verification code expired or invalid. Please request a new code.' } });
        }

        const record = codeRes.rows[0];

        if (record.attempts >= 5) {
            await query('DELETE FROM two_factor_codes WHERE user_id = $1', [userId]);
            return res.status(429).json({ success: false, error: { message: 'Too many incorrect attempts. Please sign in again to receive a fresh code.' } });
        }

        const submittedHash = crypto.createHash('sha256').update(code.trim()).digest('hex');
        if (submittedHash !== record.code_hash) {
            const nextAttempts = record.attempts + 1;
            await query('UPDATE two_factor_codes SET attempts = $1 WHERE id = $2', [nextAttempts, record.id]);
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

        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [userId]);
        clearRateLimit(user.email.toLowerCase());

        const effectiveOrgId = decoded.organisation_id || user.org_id;
        const effectiveRole = decoded.role || user.role;

        const userLocations = await getUserLocations(user.id, effectiveOrgId, effectiveRole);
        const activeLocationId = userLocations.length === 1 ? userLocations[0].id : null;

        // Create server-side session
        const session = await createSession(user.id, effectiveOrgId, clientInfo, activeLocationId || undefined);

        if (user.org_id) {
            await query(
                'INSERT INTO audit_logs (id, org_id, location_id, actor_id, action, entity_type, entity_id, details, timestamp, scope) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), \'organisation\')',
                [crypto.randomUUID(), user.org_id, activeLocationId, user.id, 'LOGIN_2FA_SUCCESS', 'users', user.id, `2FA verified for ${user.email}`]
            ).catch(() => {});
        }

        await recordLoginAttempt({
            userId: user.id,
            orgId: effectiveOrgId,
            email: user.email,
            status: 'SUCCESS',
            clientInfo,
            authMethod: '2fa',
            sessionId: session.sessionId
        });

        const orgs = await getUserOrganisations(user.id, effectiveOrgId, effectiveRole);
        const token = generateToken({
            id: user.id,
            email: user.email,
            organisation_id: effectiveOrgId,
            location_id: activeLocationId || undefined,
            role: effectiveRole,
            session_id: session.sessionId
        });

        res.json({
            success: true,
            data: {
                token,
                session_id: session.sessionId,
                user: {
                    id: user.id,
                    email: user.email,
                    role: effectiveRole,
                    organisation_id: effectiveOrgId,
                    location_id: activeLocationId,
                    organisations: orgs,
                    locations: userLocations
                },
                require_location_selection: !activeLocationId && userLocations.length > 1,
                available_locations: userLocations
            }
        });
    } catch (err: any) {
        console.error('Verify 2FA error:', err);
        res.status(500).json({ success: false, error: { message: 'Failed to verify authentication code.' } });
    }
});

/**
 * POST /api/auth/resend-2fa
 */
router.post('/resend-2fa', async (req: any, res: any) => {
    const { temp_token } = req.body;
    if (!temp_token) {
        return res.status(400).json({ success: false, error: { message: 'Verification session required.' } });
    }

    let decoded: any;
    try {
        decoded = verifyTempToken(temp_token);
    } catch (err: any) {
        return res.status(401).json({ success: false, error: { message: 'Verification session expired. Please sign in again.' } });
    }

    try {
        const userId = decoded.id;
        const userRes = await query('SELECT * FROM users WHERE id = $1 AND is_active = true', [userId]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'User not found.' } });
        }
        const user = userRes.rows[0];

        const recentCode = await query(
            'SELECT created_at FROM two_factor_codes WHERE user_id = $1 AND created_at > NOW() - INTERVAL \'30 seconds\'',
            [userId]
        );
        if (recentCode.rows.length > 0) {
            return res.status(429).json({ success: false, error: { message: 'Please wait at least 30 seconds before requesting another code.' } });
        }

        const code = Math.floor(100000 + crypto.randomInt(900000)).toString();
        const codeHash = crypto.createHash('sha256').update(code).digest('hex');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [userId]);
        await query(
            'INSERT INTO two_factor_codes (id, user_id, code_hash, expires_at, attempts) VALUES ($1, $2, $3, $4, 0)',
            [crypto.randomUUID(), userId, codeHash, expiresAt]
        );

        const emailTemplate = buildTwoFactorEmailTemplate({ code, recipientEmail: user.email });
        await sendTransactionalEmail({
            to: user.email,
            subject: emailTemplate.subject,
            html: emailTemplate.html,
            text: emailTemplate.text
        });

        res.json({ 
            success: true, 
            message: 'A fresh verification code has been dispatched to your email.'
        });
    } catch (err: any) {
        console.error('Resend 2FA error:', err);
        res.status(500).json({ success: false, error: { message: 'Failed to dispatch verification code.' } });
    }
});

/**
 * POST /api/auth/keep-alive
 * Extends the 15-minute inactivity session timer on explicit user activity.
 */
router.post('/keep-alive', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        if (req.user?.session_id) {
            await touchSession(req.user.session_id, true);
        }
        res.json({
            success: true,
            message: 'Session refreshed successfully.',
            timeout_seconds: 900
        });
    } catch (err: any) {
        console.error('Keep-alive error:', err);
        res.status(500).json({ success: false, error: { message: 'Failed to refresh session.' } });
    }
});

/**
 * GET /api/auth/session/status
 * Returns current session health & last activity timestamp.
 */
router.get('/session/status', requireAuth, async (req: AuthRequest, res: Response) => {
    res.json({
        success: true,
        data: {
            session_id: req.user?.session_id,
            is_active: true,
            approx_location: req.session?.approx_location || 'Local Network',
            device_info: req.session?.device_info || 'Current Device',
            last_active_at: req.session?.last_active_at
        }
    });
});

/**
 * POST /api/auth/logout
 * Immediately terminates and revokes the active server session.
 */
router.post('/logout', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        if (req.user?.session_id) {
            await revokeSession(req.user.session_id);
        }
        await query(
            `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_type, entity_id, details)
             VALUES ($1, $2, NOW(), $3, 'LOGOUT', 'sessions', $4, 'User logged out and revoked active session')`,
            [crypto.randomUUID(), req.user?.organisation_id || '123e4567-e89b-12d3-a456-000000000000', req.user?.id, req.user?.session_id || null]
        ).catch(() => {});

        res.json({ success: true, message: 'Signed out successfully.' });
    } catch (err: any) {
        console.error('Logout error:', err);
        res.status(500).json({ success: false, error: { message: 'Failed to complete logout.' } });
    }
});

/**
 * GET /api/auth/security/activity
 * Provides account security overview: Last login, active sessions, and recent logins.
 */
router.get('/security/activity', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id!;

        // 1. Fetch last login
        const lastLoginRes = await query(
            `SELECT approx_location, device_info, created_at
             FROM login_history
             WHERE user_id = $1 AND status IN ('SUCCESS', 'CHALLENGE_VERIFIED')
             ORDER BY created_at DESC
             LIMIT 2`,
            [userId]
        );

        // Current login is index 0, previous login is index 1 (if available)
        const previousLogin = lastLoginRes.rows[1] || lastLoginRes.rows[0] || null;

        // 2. Fetch active sessions
        const activeSessions = await getActiveUserSessions(userId, req.user?.session_id);

        // 3. Fetch recent login attempts (last 10)
        const recentHistoryRes = await query(
            `SELECT id, approx_location, device_info, status, auth_method, created_at
             FROM login_history
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT 10`,
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
    } catch (err: any) {
        console.error('Security activity error:', err);
        res.status(500).json({ success: false, error: { message: 'Failed to retrieve security activity.' } });
    }
});

/**
 * POST /api/auth/security/revoke-session
 * Allows a user to terminate a specific session.
 */
router.post('/security/revoke-session', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { session_id } = req.body;
        if (!session_id) {
            return res.status(400).json({ success: false, error: { message: 'session_id is required.' } });
        }

        // Verify session belongs to requesting user
        const sessRes = await query('SELECT id FROM sessions WHERE id = $1 AND user_id = $2', [session_id, req.user?.id]);
        if (sessRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Session not found or does not belong to your account.' } });
        }

        await revokeSession(session_id);
        res.json({ success: true, message: 'Session revoked successfully.' });
    } catch (err: any) {
        console.error('Revoke session error:', err);
        res.status(500).json({ success: false, error: { message: 'Failed to revoke session.' } });
    }
});

/**
 * POST /api/auth/security/revoke-other-sessions
 * Logs out all other active devices.
 */
router.post('/security/revoke-other-sessions', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id!;
        const currentSessionId = req.user?.session_id;

        await revokeAllUserSessions(userId, currentSessionId);
        res.json({ success: true, message: 'All other active sessions have been terminated.' });
    } catch (err: any) {
        console.error('Revoke other sessions error:', err);
        res.status(500).json({ success: false, error: { message: 'Failed to revoke other sessions.' } });
    }
});

/**
 * POST /api/auth/forgot-password
 * Generates single-use reset token and emails hashed link.
 */
router.post('/forgot-password', async (req: any, res: any) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const cleanEmail = email.trim().toLowerCase();

    try {
        const userRes = await query('SELECT id, email FROM users WHERE LOWER(email) = $1 AND is_active = true', [cleanEmail]);
        
        // Prevent user enumeration: always return the same generic success message
        if (userRes.rowCount === 0) {
            return res.json({ success: true, message: 'If an account exists, a reset link was sent.' });
        }

        const user = userRes.rows[0];
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour

        // Clear any old reset tokens for this user
        await query('DELETE FROM reset_tokens WHERE user_id = $1', [user.id]);
        await query('INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, user.id, expiresAt]);

        const origin = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:3000';
        const resetLink = `${origin}/reset-password?token=${rawToken}`;

        const template = buildPasswordResetEmailTemplate({ resetLink, recipientEmail: user.email });
        await sendTransactionalEmail({
            to: user.email,
            subject: template.subject,
            html: template.html,
            text: template.text
        });

        res.json({ 
            success: true, 
            message: 'If an account exists, a reset link was sent.'
        });
    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/auth/verify-reset-token
 * Validates whether a reset token is valid before showing the form.
 */
router.get('/verify-reset-token', async (req: any, res: any) => {
    const { token } = req.query;
    if (!token) {
        return res.status(400).json({ success: false, valid: false, message: 'Token required.' });
    }

    try {
        const tokenHash = crypto.createHash('sha256').update(String(token).trim()).digest('hex');
        const tokenRes = await query(
            'SELECT rt.user_id, u.email FROM reset_tokens rt JOIN users u ON u.id = rt.user_id WHERE (rt.token_hash = $1 OR rt.token_hash = $2) AND rt.expires_at > NOW()',
            [tokenHash, String(token).trim()]
        );

        if (tokenRes.rows.length === 0) {
            return res.status(400).json({ success: false, valid: false, message: 'Invalid or expired password reset link.' });
        }

        res.json({ success: true, valid: true, email: maskEmail(tokenRes.rows[0].email) });
    } catch (err: any) {
        console.error('Verify reset token error:', err);
        res.status(500).json({ success: false, valid: false, message: 'Failed to verify reset token.' });
    }
});

/**
 * POST /api/auth/reset-password
 * Validates complexity, updates password hash, revokes all sessions.
 */
router.post('/reset-password', checkRateLimit, async (req: any, res: any) => {
    const { token, password } = req.body;
    if (!token || !password) {
        return res.status(400).json({ success: false, error: { message: 'Token and new password required' } });
    }

    const strength = isStrongPassword(password);
    if (!strength.valid) {
        return res.status(400).json({ success: false, error: { message: strength.reason } });
    }

    try {
        const tokenHash = crypto.createHash('sha256').update(String(token).trim()).digest('hex');
        const tokenRes = await query(
            'SELECT user_id FROM reset_tokens WHERE (token_hash = $1 OR token_hash = $2) AND expires_at > NOW()',
            [tokenHash, String(token).trim()]
        );

        if (tokenRes.rowCount === 0) {
            recordFailedAttempt(req.rateLimitKey, req.rateLimitAttempts);
            return res.status(400).json({ success: false, error: { message: 'Invalid or expired token' } });
        }

        const userId = tokenRes.rows[0].user_id;
        const passwordHash = await hashPassword(password);

        await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
        await query('DELETE FROM reset_tokens WHERE user_id = $1', [userId]);
        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [userId]).catch(() => {});

        // Immediately revoke all existing sessions upon password reset
        await revokeAllUserSessions(userId);
        clearRateLimit(req.rateLimitKey);

        await query(
            `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_type, entity_id, details)
             VALUES ($1, '123e4567-e89b-12d3-a456-000000000000', NOW(), $2, 'PASSWORD_RESET_COMPLETED', 'users', $2, 'Password reset completed and all sessions revoked')`,
            [crypto.randomUUID(), userId]
        ).catch(() => {});

        res.json({ success: true, message: 'Password updated successfully. You can now sign in.' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
});

router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id!;
        const orgId = req.user?.organisation_id;

        let context = req.securityContext;
        if (orgId && !context) {
            context = await resolveUserSecurityContext(userId, orgId, req.user?.location_id, req.user?.role);
        }

        res.json({
            success: true,
            data: {
                id: userId,
                email: req.user?.email,
                organisation_id: orgId || null,
                role: req.user?.role || 'Employee',
                location_id: req.user?.location_id || null,
                security_context: context ? {
                    org_role: context.orgRole,
                    active_branch_id: context.activeBranchId,
                    active_branch_role: context.activeBranchRole,
                    permissions: Array.from(context.effectivePermissions),
                    branch_memberships: context.branchMemberships
                } : null
            }
        });
    } catch (err: any) {
        console.error('Get me error:', err);
        res.status(500).json({ success: false, error: { message: 'Failed to retrieve profile' } });
    }
});

router.get('/organisations', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id!;
        const orgs = await getUserOrganisations(userId, req.user?.organisation_id, req.user?.role);
        res.json({ success: true, data: orgs });
    } catch (err: any) {
        console.error('Get organisations error:', err);
        res.status(500).json({ success: false, error: { message: 'Failed to fetch organisations' } });
    }
});

router.post('/select-location', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id!;
        const orgId = req.user?.organisation_id!;
        const { location_id } = req.body;

        if (!location_id) {
            return res.status(400).json({ success: false, error: { message: 'location_id is required' } });
        }

        const userLocations = await getUserLocations(userId, orgId, req.user?.role);
        const hasAccess = req.user?.role === 'Platform Admin'
            ? true
            : userLocations.some(l => l.id === location_id);

        if (!hasAccess) {
            await query(
                `INSERT INTO audit_logs (id, org_id, location_id, timestamp, actor_id, action, entity_type, entity_id, details, scope)
                 VALUES ($1, $2, $3, NOW(), $4, 'LOCATION_ACCESS_DENIED', 'location', $5, $6, 'organisation')`,
                [crypto.randomUUID(), orgId, location_id, userId, location_id, `User attempted unauthorized location switch to ${location_id}`]
            ).catch(() => {});

            return res.status(403).json({
                success: false,
                error: {
                    code: 'LOCATION_FORBIDDEN',
                    message: 'You do not have access to this location.'
                }
            });
        }

        const selectedLoc = userLocations.find(l => l.id === location_id) || { id: location_id, name: 'Location', slug: location_id };

        if (req.user?.session_id) {
            await query('UPDATE sessions SET location_id = $1 WHERE id = $2', [location_id, req.user.session_id]).catch(() => {});
        }

        const newToken = generateToken({
            id: userId,
            email: req.user?.email!,
            organisation_id: orgId,
            location_id: location_id,
            role: req.user?.role || 'Employee',
            session_id: req.user?.session_id
        });

        await query(
            `INSERT INTO audit_logs (id, org_id, location_id, timestamp, actor_id, action, entity_type, entity_id, details, scope)
             VALUES ($1, $2, $3, NOW(), $4, 'LOCATION_SELECTED', 'location', $5, $6, 'organisation')`,
            [crypto.randomUUID(), orgId, location_id, userId, location_id, `User switched active location to ${selectedLoc.name || location_id}`]
        ).catch(() => {});

        res.json({
            success: true,
            data: {
                token: newToken,
                location: selectedLoc,
                user: {
                    id: userId,
                    email: req.user?.email,
                    role: req.user?.role,
                    organisation_id: orgId,
                    location_id: location_id
                }
            }
        });
    } catch (err: any) {
        console.error('Select location error:', err);
        res.status(500).json({ success: false, error: { message: 'Failed to select location' } });
    }
});

router.post('/switch-organisation', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id!;
        const { organisation_id } = req.body;

        if (!organisation_id) {
            return res.status(400).json({ success: false, error: { message: 'organisation_id is required' } });
        }

        let membershipRes: any = { rows: [] };
        const isPlatformAdmin = req.user?.role === 'Platform Admin';

        try {
            if (isPlatformAdmin) {
                membershipRes = await query('SELECT id, name, \'Platform Admin\' as role FROM organisations WHERE id = $1 AND is_active = true', [organisation_id]);
            } else {
                membershipRes = await query(`
                    SELECT o.id, o.name, COALESCE(om.role, u.role) as role
                    FROM organisations o
                    LEFT JOIN organisation_members om ON om.organisation_id = o.id AND om.user_id = $1
                    LEFT JOIN users u ON u.id = $1
                    WHERE o.id = $2 AND (om.user_id = $1 OR (u.id = $1 AND u.org_id = o.id))
                      AND o.is_active = true
                `, [userId, organisation_id]);
            }
        } catch (dbErr) {
            membershipRes = { rows: [] };
        }

        if (membershipRes.rows.length === 0) {
            return res.status(403).json({ success: false, error: { message: 'Not authorized to access this organisation' } });
        }

        const orgInfo = membershipRes.rows[0];
        const newRole = orgInfo.role || req.user?.role || 'Employee';

        const newLocations = await getUserLocations(userId, organisation_id, newRole);
        let newLocationId: string | null = null;
        if (newRole === 'Owner') {
            newLocationId = newLocations.length === 1 ? newLocations[0].id : null;
        } else if (newLocations.length === 1) {
            newLocationId = newLocations[0].id;
        }

        if (req.user?.session_id) {
            await query('UPDATE sessions SET org_id = $1, location_id = $2 WHERE id = $3', [organisation_id, newLocationId, req.user.session_id]).catch(() => {});
        }

        const newToken = generateToken({
            id: userId,
            email: req.user?.email!,
            organisation_id: organisation_id,
            location_id: newLocationId || undefined,
            role: newRole,
            session_id: req.user?.session_id
        });

        await query(
            `INSERT INTO audit_logs (id, org_id, location_id, timestamp, actor_id, action, entity_type, entity_id, details, scope)
             VALUES ($1, $2, $3, NOW(), $4, 'ORGANISATION_SWITCHED', 'organisation', $5, $6, 'organisation')`,
            [crypto.randomUUID(), organisation_id, newLocationId, userId, organisation_id, `User switched active organisation to ${orgInfo.name}`]
        ).catch(() => {});

        res.json({
            success: true,
            data: {
                token: newToken,
                user: {
                    id: userId,
                    email: req.user?.email,
                    role: newRole,
                    organisation_id: organisation_id,
                    organisation_name: orgInfo.name,
                    location_id: newLocationId,
                    locations: newLocations
                },
                require_location_selection: !newLocationId && newLocations.length > 1,
                available_locations: newLocations
            }
        });
    } catch (err: any) {
        console.error('Switch organisation error:', err);
        res.status(500).json({ success: false, error: { message: 'Failed to switch organisation' } });
    }
});

router.get('/invitation', async (req: any, res: any) => {
    const token = req.query.token;
    if (!token) return res.status(400).json({ success: false, error: { message: 'Token required' } });

    try {
        const tokenHash = crypto.createHash('sha256').update(String(token).trim()).digest('hex');
        const tokenRes = await query(`
            SELECT it.user_id, u.email 
            FROM invitation_tokens it
            JOIN users u ON u.id = it.user_id
            WHERE (it.token_hash = $1 OR it.token_hash = $2) AND it.expires_at > NOW()
        `, [tokenHash, String(token).trim()]);

        if (tokenRes.rowCount === 0) {
            return res.status(400).json({ success: false, error: { message: 'Invalid or expired invitation token' } });
        }

        res.json({ success: true, data: { email: tokenRes.rows[0].email } });
    } catch (err) {
        console.error('Invitation lookup error:', err);
        res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
});

router.post('/claim-invitation', async (req: any, res: any) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ success: false, error: { message: 'Token and password required' } });

    const strength = isStrongPassword(password);
    if (!strength.valid) {
        return res.status(400).json({ success: false, error: { message: strength.reason } });
    }

    try {
        const tokenHash = crypto.createHash('sha256').update(String(token).trim()).digest('hex');
        const tokenRes = await query(
            'SELECT user_id FROM invitation_tokens WHERE (token_hash = $1 OR token_hash = $2) AND expires_at > NOW()',
            [tokenHash, String(token).trim()]
        );
        if (tokenRes.rowCount === 0) {
            return res.status(400).json({ success: false, error: { message: 'Invalid or expired token' } });
        }

        const userId = tokenRes.rows[0].user_id;
        const passwordHash = await hashPassword(password);

        await query('UPDATE users SET password_hash = $1, is_active = true WHERE id = $2', [passwordHash, userId]);
        await query('UPDATE employees SET is_active = true WHERE user_id = $1', [userId]);
        await query('DELETE FROM invitation_tokens WHERE user_id = $1', [userId]);

        await revokeAllUserSessions(userId);

        res.json({ success: true });
    } catch (err) {
        console.error('Claim invitation error:', err);
        res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
});

/**
 * GET /api/auth/2fa/status
 */
router.get('/2fa/status', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const userRes = await query('SELECT email, two_factor_enabled FROM users WHERE id = $1', [req.user?.id]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'User not found' } });
        }
        const user = userRes.rows[0];
        res.json({
            success: true,
            data: {
                enabled: Boolean(user.two_factor_enabled),
                email: user.email
            }
        });
    } catch (err: any) {
        console.error('[2FA STATUS ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to retrieve 2FA status' } });
    }
});

/**
 * POST /api/auth/2fa/send-setup-code
 */
router.post('/2fa/send-setup-code', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const userRes = await query('SELECT email FROM users WHERE id = $1', [req.user?.id]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'User not found' } });
        }
        const user = userRes.rows[0];

        const code = Math.floor(100000 + crypto.randomInt(900000)).toString();
        const codeHash = crypto.createHash('sha256').update(code).digest('hex');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [req.user?.id]);
        await query(
            'INSERT INTO two_factor_codes (id, user_id, code_hash, expires_at, attempts) VALUES ($1, $2, $3, $4, 0)',
            [crypto.randomUUID(), req.user?.id, codeHash, expiresAt]
        );

        const emailTemplate = buildTwoFactorEmailTemplate({ code, recipientEmail: user.email });
        await sendTransactionalEmail({
            to: user.email,
            subject: emailTemplate.subject,
            html: emailTemplate.html,
            text: emailTemplate.text
        });

        res.json({
            success: true,
            message: 'Setup code dispatched to your email.'
        });
    } catch (err: any) {
        console.error('[2FA SETUP SEND ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to send 2FA setup code' } });
    }
});

/**
 * POST /api/auth/2fa/enable
 */
router.post('/2fa/enable', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { code, password } = req.body;
        if (!code || !password) {
            return res.status(400).json({ success: false, error: { message: 'Verification code and current password required.' } });
        }

        const userRes = await query('SELECT password_hash FROM users WHERE id = $1', [req.user?.id]);
        if (userRes.rows.length === 0 || !(await comparePassword(password, userRes.rows[0].password_hash))) {
            return res.status(401).json({ success: false, error: { message: 'Invalid current password.' } });
        }

        const codeRes = await query('SELECT * FROM two_factor_codes WHERE user_id = $1 AND expires_at > NOW()', [req.user?.id]);
        if (codeRes.rows.length === 0) {
            return res.status(400).json({ success: false, error: { message: 'Verification code expired or not found. Please request a new code.' } });
        }

        const storedCode = codeRes.rows[0];
        const inputHash = crypto.createHash('sha256').update(code.trim()).digest('hex');

        if (storedCode.code_hash !== inputHash) {
            return res.status(400).json({ success: false, error: { message: 'Invalid verification code.' } });
        }

        await query('UPDATE users SET two_factor_enabled = true WHERE id = $1', [req.user?.id]);
        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [req.user?.id]);

        await query(
            `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_type, entity_id, details)
             VALUES ($1, $2, NOW(), $3, '2FA_ENABLED', 'users', $3, 'Two-Factor Authentication activated')`,
            [crypto.randomUUID(), req.user?.organisation_id || '123e4567-e89b-12d3-a456-000000000000', req.user?.id]
        ).catch(() => {});

        res.json({ success: true, message: 'Two-Step Verification successfully enabled.' });
    } catch (err: any) {
        console.error('[2FA ENABLE ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to enable 2FA' } });
    }
});

/**
 * POST /api/auth/2fa/disable
 */
router.post('/2fa/disable', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ success: false, error: { message: 'Current password required to disable 2FA.' } });
        }

        const userRes = await query('SELECT password_hash FROM users WHERE id = $1', [req.user?.id]);
        if (userRes.rows.length === 0 || !(await comparePassword(password, userRes.rows[0].password_hash))) {
            return res.status(401).json({ success: false, error: { message: 'Invalid password.' } });
        }

        await query('UPDATE users SET two_factor_enabled = false WHERE id = $1', [req.user?.id]);
        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [req.user?.id]);

        await query(
            `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, entity_type, entity_id, details)
             VALUES ($1, $2, NOW(), $3, '2FA_DISABLED', 'users', $3, 'Two-Factor Authentication deactivated')`,
            [crypto.randomUUID(), req.user?.organisation_id || '123e4567-e89b-12d3-a456-000000000000', req.user?.id]
        ).catch(() => {});

        res.json({ success: true, message: 'Two-Step Verification disabled.' });
    } catch (err: any) {
        console.error('[2FA DISABLE ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to disable 2FA' } });
    }
});

export default router;
