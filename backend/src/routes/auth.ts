import { Router, Response } from 'express';
import { query } from '../services/db';
import { comparePassword, generateToken, generateTempToken, verifyTempToken, hashPassword } from '../services/auth';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { sendTransactionalEmail, buildPasswordResetEmailTemplate, buildTwoFactorEmailTemplate } from '../services/emailService';
import crypto from 'crypto';

const router = Router();

// Rate limiting state: email or IP -> { count, firstAttempt }
const rateLimits = new Map<string, { count: number, firstAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function checkRateLimit(req: any, res: any, next: any) {
    const rawEmail = req.body?.email;
    if (!rawEmail || typeof rawEmail !== 'string') {
        return next();
    }
    const key = rawEmail.trim().toLowerCase();
    const attempts = rateLimits.get(key) || { count: 0, firstAttempt: Date.now() };
    
    if (Date.now() - attempts.firstAttempt > LOCKOUT_MS) {
        attempts.count = 0;
        attempts.firstAttempt = Date.now();
    }
    
    if (attempts.count >= MAX_ATTEMPTS) {
        return res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please try again in 15 minutes.' }});
    }
    
    req.rateLimitKey = key;
    req.rateLimitAttempts = attempts;
    next();
}

function recordFailedAttempt(key: string, attempts: any) {
    attempts.count++;
    rateLimits.set(key, attempts);
}

function clearRateLimit(key: string) {
    rateLimits.delete(key);
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
    const [user, domain] = email.split('@');
    if (!domain) return email;
    if (user.length <= 2) return `${user[0]}*@${domain}`;
    return `${user[0]}${'*'.repeat(Math.min(user.length - 2, 5))}${user[user.length - 1]}@${domain}`;
}

async function getUserOrganisations(userId: string, userOrgId?: string, defaultRole?: string) {
    try {
        if (defaultRole === 'Platform Admin') {
            try {
                const allOrgs = await query(`
                    SELECT id, name, COALESCE(slug, id) as slug, logo_url, 'Platform Admin' as role
                    FROM organisations
                    ORDER BY name ASC
                `);
                return allOrgs.rows;
            } catch {
                const fallback = await query(`SELECT id, name, 'Platform Admin' as role FROM organisations ORDER BY name ASC`);
                return fallback.rows;
            }
        }

        try {
            const orgsRes = await query(`
                SELECT DISTINCT o.id, o.name, COALESCE(o.slug, o.id) as slug, o.logo_url, COALESCE(om.role, u.role) as role
                FROM organisations o
                LEFT JOIN organisation_members om ON om.organisation_id = o.id AND om.user_id = $1
                LEFT JOIN users u ON u.id = $1
                WHERE om.user_id = $1 OR (u.id = $1 AND u.org_id = o.id)
            `, [userId]);
            return orgsRes.rows;
        } catch {
            const orgsResFallback = await query(`
                SELECT DISTINCT o.id, o.name, COALESCE(om.role, u.role) as role
                FROM organisations o
                LEFT JOIN organisation_members om ON om.organisation_id = o.id AND om.user_id = $1
                LEFT JOIN users u ON u.id = $1
                WHERE om.user_id = $1 OR (u.id = $1 AND u.org_id = o.id)
            `, [userId]);
            return orgsResFallback.rows;
        }
    } catch (err) {
        return [];
    }
}

/**
 * POST /api/auth/login
 * Validates credentials. If 2FA is active, issues OTP and temporary token.
 */
router.post('/login', checkRateLimit, async (req: any, res: any) => {
    const { email, password, organisation_slug, organisation_id } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }

    const cleanEmail = email.trim().toLowerCase();

    try {
        const result = await query('SELECT * FROM users WHERE LOWER(email) = $1', [cleanEmail]);
        const user = result.rows[0];

        if (!user || !user.is_active || !user.password_hash) {
            recordFailedAttempt(cleanEmail, req.rateLimitAttempts);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const valid = await comparePassword(password, user.password_hash);
        if (!valid) {
            recordFailedAttempt(cleanEmail, req.rateLimitAttempts);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check if an organisation was specified for dedicated workplace login
        let targetOrg: any = null;
        if (organisation_id) {
            try {
                const orgRes = await query('SELECT id, name, slug, is_active FROM organisations WHERE id = $1', [organisation_id]);
                targetOrg = orgRes.rows[0];
            } catch {}
        } else if (organisation_slug) {
            const cleanSlug = organisation_slug.trim().toLowerCase();
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
            // Generate cryptographically secure 6-digit OTP
            const code = Math.floor(100000 + crypto.randomInt(900000)).toString();
            const codeHash = crypto.createHash('sha256').update(code).digest('hex');
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

            // Invalidate any previous 2FA codes for this user
            await query('DELETE FROM two_factor_codes WHERE user_id = $1', [user.id]);

            // Save new hashed 2FA code
            await query(
                'INSERT INTO two_factor_codes (id, user_id, code_hash, expires_at, attempts) VALUES ($1, $2, $3, $4, 0)',
                [crypto.randomUUID(), user.id, codeHash, expiresAt]
            );

            // Dispatch 2FA email
            const emailTemplate = buildTwoFactorEmailTemplate({ code, recipientEmail: user.email });
            const emailResult = await sendTransactionalEmail({
                to: user.email,
                subject: emailTemplate.subject,
                html: emailTemplate.html,
                text: emailTemplate.text
            });

            // Log for local/dev auditing
            if (emailResult.success) {
                console.log(`[2FA CODE] Verification code dispatched for ${cleanEmail} (provider: ${emailResult.provider}${emailResult.reroutedTo ? ', delivered to: ' + emailResult.reroutedTo : ''})`);
            } else {
                console.warn(`[2FA CODE WARNING] Failed to deliver email to ${cleanEmail}: ${emailResult.error}`);
            }
            console.log(`[2FA CODE FOR TESTING] Code for ${cleanEmail}: ${code}`);

            // Generate temporary verification session token (10m expiration)
            const tempToken = generateTempToken({
                id: user.id,
                email: user.email,
                organisation_id: effectiveOrgId,
                role: effectiveRole
            });

            let deliveryNotice = undefined;
            if (emailResult.reroutedTo) {
                deliveryNotice = `Dev Notice: Verification email delivered to your verified address (${emailResult.reroutedTo}).`;
            } else if (!emailResult.success && process.env.NODE_ENV !== 'production') {
                deliveryNotice = `Email Notice: ${emailResult.error} (Code printed to server console).`;
            }

            return res.json({
                success: true,
                require_2fa: true,
                temp_token: tempToken,
                masked_email: maskEmail(user.email),
                delivery_notice: deliveryNotice
            });
        }

        // Single-factor fallback if explicitly disabled
        clearRateLimit(cleanEmail);
        const orgs = await getUserOrganisations(user.id, effectiveOrgId, effectiveRole);
        const token = generateToken({
            id: user.id,
            email: user.email,
            organisation_id: effectiveOrgId,
            role: effectiveRole
        });

        res.json({
            success: true,
            data: {
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    role: effectiveRole,
                    organisation_id: effectiveOrgId,
                    organisations: orgs
                }
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/auth/platform-login
 * Secret endpoint for Platform Superadministrators.
 * Rejects any non-Platform Admin credentials with 403 Forbidden.
 */
router.post('/platform-login', checkRateLimit, async (req: any, res: any) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, error: { message: 'Email and password required' } });
    }

    const cleanEmail = email.trim().toLowerCase();

    try {
        const result = await query('SELECT * FROM users WHERE LOWER(email) = $1', [cleanEmail]);
        const user = result.rows[0];

        if (!user || !user.is_active || !user.password_hash) {
            recordFailedAttempt(cleanEmail, req.rateLimitAttempts);
            return res.status(401).json({ success: false, error: { message: 'Invalid administrative credentials' } });
        }

        const valid = await comparePassword(password, user.password_hash);
        if (!valid) {
            recordFailedAttempt(cleanEmail, req.rateLimitAttempts);
            return res.status(401).json({ success: false, error: { message: 'Invalid administrative credentials' } });
        }

        // STRICT ROLE ENFORCEMENT: Only Platform Admin role is allowed
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
            const emailResult = await sendTransactionalEmail({
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

            console.log(`[PLATFORM 2FA CODE FOR TESTING] Code for ${cleanEmail}: ${code}`);

            return res.json({
                success: true,
                require_2fa: true,
                temp_token: tempToken,
                masked_email: maskEmail(user.email),
                delivery_notice: emailResult.success ? undefined : `Notice: ${emailResult.error} (Code printed to server console)`
            });
        }

        clearRateLimit(cleanEmail);
        const orgs = await getUserOrganisations(user.id, user.org_id, 'Platform Admin');
        const token = generateToken({
            id: user.id,
            email: user.email,
            organisation_id: user.org_id,
            role: 'Platform Admin'
        });

        // Audit Log
        await query(
            'INSERT INTO audit_logs (id, org_id, actor_id, action, entity_type, entity_id, details, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())',
            [crypto.randomUUID(), user.org_id, user.id, 'PLATFORM_LOGIN_SUCCESS', 'users', user.id, `Platform Admin logged in: ${user.email}`]
        ).catch(() => {});

        res.json({
            success: true,
            data: {
                token,
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

    try {
        const userId = decoded.id;
        const userRes = await query('SELECT * FROM users WHERE id = $1 AND is_active = true', [userId]);
        if (userRes.rows.length === 0) {
            return res.status(401).json({ success: false, error: { message: 'User account not found or inactive.' } });
        }
        const user = userRes.rows[0];

        // Fetch active 2FA code record
        const codeRes = await query(
            'SELECT * FROM two_factor_codes WHERE user_id = $1 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
            [userId]
        );

        if (codeRes.rows.length === 0) {
            return res.status(400).json({ success: false, error: { message: 'Verification code expired or invalid. Please request a new code.' } });
        }

        const record = codeRes.rows[0];

        // Enforce maximum 5 attempts lockout
        if (record.attempts >= 5) {
            await query('DELETE FROM two_factor_codes WHERE user_id = $1', [userId]);
            return res.status(429).json({ success: false, error: { message: 'Too many incorrect attempts. Please sign in again to receive a fresh code.' } });
        }

        // Compare SHA-256 hash of submitted code
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

        // Correct code: delete OTP and issue full authentication session
        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [userId]);
        clearRateLimit(user.email.toLowerCase());

        // Audit log
        if (user.org_id) {
            await query(
                'INSERT INTO audit_logs (id, org_id, actor_id, action, entity_type, entity_id, details, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())',
                [crypto.randomUUID(), user.org_id, user.id, 'LOGIN_2FA_SUCCESS', 'users', user.id, `2FA verified for ${user.email}`]
            ).catch(() => {});
        }

        const effectiveOrgId = decoded.organisation_id || user.org_id;
        const effectiveRole = decoded.role || user.role;

        const orgs = await getUserOrganisations(user.id, effectiveOrgId, effectiveRole);
        const token = generateToken({
            id: user.id,
            email: user.email,
            organisation_id: effectiveOrgId,
            role: effectiveRole
        });

        res.json({
            success: true,
            data: {
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    role: effectiveRole,
                    organisation_id: effectiveOrgId,
                    organisations: orgs
                }
            }
        });
    } catch (err: any) {
        console.error('Verify 2FA error:', err);
        res.status(500).json({ success: false, error: { message: 'Failed to verify authentication code.' } });
    }
});

/**
 * POST /api/auth/resend-2fa
 * Resends a fresh 2FA code with cooldown protection.
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

        // Cooldown check (minimum 30 seconds between requests)
        const recentCode = await query(
            'SELECT created_at FROM two_factor_codes WHERE user_id = $1 AND created_at > NOW() - INTERVAL \'30 seconds\'',
            [userId]
        );
        if (recentCode.rows.length > 0) {
            return res.status(429).json({ success: false, error: { message: 'Please wait at least 30 seconds before requesting another code.' } });
        }

        // Generate fresh OTP
        const code = Math.floor(100000 + crypto.randomInt(900000)).toString();
        const codeHash = crypto.createHash('sha256').update(code).digest('hex');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [userId]);
        await query(
            'INSERT INTO two_factor_codes (id, user_id, code_hash, expires_at, attempts) VALUES ($1, $2, $3, $4, 0)',
            [crypto.randomUUID(), userId, codeHash, expiresAt]
        );

        const emailTemplate = buildTwoFactorEmailTemplate({ code, recipientEmail: user.email });
        const emailResult = await sendTransactionalEmail({
            to: user.email,
            subject: emailTemplate.subject,
            html: emailTemplate.html,
            text: emailTemplate.text
        });

        if (emailResult.success) {
            console.log(`[2FA CODE - RESENT] Fresh verification code for ${user.email} (provider: ${emailResult.provider}${emailResult.reroutedTo ? ', delivered to: ' + emailResult.reroutedTo : ''})`);
        } else {
            console.warn(`[2FA CODE - RESENT WARNING] Failed to deliver code to ${user.email}: ${emailResult.error}`);
        }
        console.log(`[2FA CODE FOR TESTING] Resent code for ${user.email}: ${code}`);

        let deliveryNotice = undefined;
        if (emailResult.reroutedTo) {
            deliveryNotice = `Dev Notice: Fresh code sent to verified email (${emailResult.reroutedTo}).`;
        } else if (!emailResult.success && process.env.NODE_ENV !== 'production') {
            deliveryNotice = `Email Notice: ${emailResult.error} (Code printed to server console).`;
        }

        res.json({ 
            success: true, 
            message: 'A fresh verification code has been dispatched to your email.',
            delivery_notice: deliveryNotice
        });
    } catch (err: any) {
        console.error('Resend 2FA error:', err);
        res.status(500).json({ success: false, error: { message: 'Failed to dispatch verification code.' } });
    }
});

/**
 * POST /api/auth/forgot-password
 * Generates single-use reset token and emails branded password reset link.
 */
router.post('/forgot-password', checkRateLimit, async (req: any, res: any) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const cleanEmail = email.trim().toLowerCase();

    try {
        const userRes = await query('SELECT id, email FROM users WHERE LOWER(email) = $1 AND is_active = true', [cleanEmail]);
        
        // Prevent user enumeration: always return the same success message
        if (userRes.rowCount === 0) {
            return res.json({ success: true, message: 'If an account exists, a reset link was sent.' });
        }

        const user = userRes.rows[0];
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour

        // Clear any old reset tokens for this user
        await query('DELETE FROM reset_tokens WHERE user_id = $1', [user.id]);
        await query('INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [token, user.id, expiresAt]);

        // Reliable origin resolution
        const origin = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:3000';
        const resetLink = `${origin}/reset-password?token=${token}`;

        // Build branded email and send
        const template = buildPasswordResetEmailTemplate({ resetLink, recipientEmail: user.email });
        const deliveryResult = await sendTransactionalEmail({
            to: user.email,
            subject: template.subject,
            html: template.html,
            text: template.text
        });

        if (deliveryResult.success) {
            console.log(`[PASSWORD RESET LINK] Sent reset link for ${user.email}: ${resetLink} (provider: ${deliveryResult.provider}${deliveryResult.reroutedTo ? ', delivered to: ' + deliveryResult.reroutedTo : ''})`);
        } else {
            console.warn(`[PASSWORD RESET WARNING] Failed to deliver reset link to ${user.email}: ${deliveryResult.error}`);
        }
        console.log(`[PASSWORD RESET FOR TESTING] Link: ${resetLink}`);

        let deliveryNotice = undefined;
        if (deliveryResult.reroutedTo) {
            deliveryNotice = `Dev Notice: Reset link was delivered to your verified address (${deliveryResult.reroutedTo}).`;
        } else if (!deliveryResult.success && process.env.NODE_ENV !== 'production') {
            deliveryNotice = `Email Notice: ${deliveryResult.error} (Link printed to server console).`;
        }

        res.json({ 
            success: true, 
            message: 'If an account exists, a reset link was sent.',
            delivery_notice: deliveryNotice
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
        const tokenRes = await query(
            'SELECT rt.user_id, u.email FROM reset_tokens rt JOIN users u ON u.id = rt.user_id WHERE rt.token_hash = $1 AND rt.expires_at > NOW()',
            [token]
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
 * Validates complexity, updates password hash, and purges all tokens.
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
        const tokenRes = await query('SELECT user_id FROM reset_tokens WHERE token_hash = $1 AND expires_at > NOW()', [token]);
        if (tokenRes.rowCount === 0) {
            return res.status(400).json({ success: false, error: { message: 'Invalid or expired token' } });
        }

        const userId = tokenRes.rows[0].user_id;
        const passwordHash = await hashPassword(password);

        await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
        await query('DELETE FROM reset_tokens WHERE user_id = $1', [userId]);
        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [userId]).catch(() => {});

        res.json({ success: true, message: 'Password updated successfully. You can now sign in.' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ success: false, error: { message: 'Internal server error' } });
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

        const newToken = generateToken({
            id: userId,
            email: req.user?.email!,
            organisation_id: organisation_id,
            role: newRole
        });

        res.json({
            success: true,
            data: {
                token: newToken,
                user: {
                    id: userId,
                    email: req.user?.email,
                    role: newRole,
                    organisation_id: organisation_id,
                    organisation_name: orgInfo.name
                }
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
        const tokenRes = await query(`
            SELECT it.user_id, u.email 
            FROM invitation_tokens it
            JOIN users u ON u.id = it.user_id
            WHERE it.token_hash = $1 AND it.expires_at > NOW()
        `, [token]);

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
        const tokenRes = await query('SELECT user_id FROM invitation_tokens WHERE token_hash = $1 AND expires_at > NOW()', [token]);
        if (tokenRes.rowCount === 0) {
            return res.status(400).json({ success: false, error: { message: 'Invalid or expired token' } });
        }

        const userId = tokenRes.rows[0].user_id;
        const passwordHash = await hashPassword(password);

        await query('UPDATE users SET password_hash = $1, is_active = true WHERE id = $2', [passwordHash, userId]);
        await query('UPDATE employees SET is_active = true WHERE user_id = $1', [userId]);
        await query('DELETE FROM invitation_tokens WHERE user_id = $1', [userId]);

        res.json({ success: true });
    } catch (err) {
        console.error('Claim invitation error:', err);
        res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
});

/**
 * GET /api/auth/2fa/status
 * Returns whether 2FA is currently enabled for the authenticated user.
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
 * Sends a test 2FA setup verification OTP to the user's email.
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
        const emailResult = await sendTransactionalEmail({
            to: user.email,
            subject: emailTemplate.subject,
            html: emailTemplate.html,
            text: emailTemplate.text
        });

        console.log(`[2FA SETUP CODE] Verification code for ${user.email}: ${code} (delivery: ${emailResult.provider}${emailResult.reroutedTo ? ', delivered to: ' + emailResult.reroutedTo : ''})`);

        res.json({
            success: true,
            message: 'Setup code dispatched to your email.',
            delivery_notice: emailResult.reroutedTo ? `Dev Notice: Code delivered to verified email (${emailResult.reroutedTo}).` : undefined
        });
    } catch (err: any) {
        console.error('[2FA SETUP SEND ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to send 2FA setup code' } });
    }
});

/**
 * POST /api/auth/2fa/enable
 * Verifies code & current password, then activates 2FA.
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

        res.json({ success: true, message: 'Two-Step Verification successfully enabled.' });
    } catch (err: any) {
        console.error('[2FA ENABLE ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to enable 2FA' } });
    }
});

/**
 * POST /api/auth/2fa/disable
 * Disables 2FA with password confirmation.
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

        res.json({ success: true, message: 'Two-Step Verification disabled.' });
    } catch (err: any) {
        console.error('[2FA DISABLE ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to disable 2FA' } });
    }
});

export default router;
