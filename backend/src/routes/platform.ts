import { Router, Response } from 'express';
import crypto from 'crypto';
import { query, seedOrgDefaults } from '../services/db';
import { hashPassword } from '../services/auth';
import { sendTransactionalEmail, buildOrgInviteEmailTemplate } from '../services/emailService';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// Public route to verify an org invite token
router.get(['/verify-invite', '/verify/invite'], async (req: any, res: Response) => {
    try {
        const { token } = req.query;
        if (!token) return res.status(400).json({ success: false, error: { message: 'Token required.' } });

        const tokenRes = await query('SELECT email FROM org_invitation_tokens WHERE token = $1 AND used = false', [token]);
        if (tokenRes.rows.length === 0) {
            return res.status(400).json({ success: false, error: { message: 'Invalid or expired organization invite token.' } });
        }

        res.json({ success: true, data: { email: tokenRes.rows[0].email } });
    } catch (err: any) {
        console.error('[PLATFORM VERIFY INVITE ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to verify organization invite token.' } });
    }
});

// Public route to claim an org invite
router.post('/claim-invite', async (req: any, res: Response) => {
    try {
        const { 
            token, 
            name, 
            admin_email, 
            admin_password,
            roster_lock_password,
            timesheet_lock_password,
            enable_2fa,
            break_mins_weekday,
            break_mins_weekend,
            break_threshold_hours
        } = req.body;

        if (!token || !name || !admin_email || !admin_password) {
            return res.status(400).json({ 
                success: false, 
                error: { message: 'All required fields (token, name, admin email, password) must be provided.' } 
            });
        }

        const tokenRes = await query('SELECT id, email, used FROM org_invitation_tokens WHERE token = $1', [token]);
        if (tokenRes.rows.length === 0) {
            return res.status(400).json({ success: false, error: { message: 'Invalid or expired organization invite token.' } });
        }
        if (tokenRes.rows[0].used) {
            return res.status(400).json({ success: false, error: { message: 'This invitation token has already been claimed.' } });
        }

        const normalizedInviteEmail = tokenRes.rows[0].email.trim().toLowerCase();
        const normalizedInputEmail = admin_email.trim().toLowerCase();

        // Enforce that only the email the invitation was sent to can claim it
        if (normalizedInviteEmail !== normalizedInputEmail) {
            return res.status(403).json({ 
                success: false, 
                error: { message: `This invitation was issued to ${normalizedInviteEmail}. Only this email can claim the invitation.` } 
            });
        }

        // Check if a user with this email already exists
        const existingUser = await query('SELECT id FROM users WHERE LOWER(email) = $1', [normalizedInputEmail]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ 
                success: false, 
                error: { message: `An account with email ${normalizedInputEmail} already exists. Please log in or use a different email.` } 
            });
        }

        // Mark token used
        await query('UPDATE org_invitation_tokens SET used = true WHERE token = $1', [token]);

        const orgId = crypto.randomUUID();
        const rosterLockHash = roster_lock_password ? await hashPassword(roster_lock_password) : null;
        const timesheetLockHash = timesheet_lock_password ? await hashPassword(timesheet_lock_password) : null;

        let hasSlug = false;
        try {
            await query('SELECT slug FROM organisations LIMIT 1');
            hasSlug = true;
        } catch {
            hasSlug = false;
        }

        if (hasSlug) {
            const baseSlug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'org';
            let slug = baseSlug;
            let suffix = 1;
            while (true) {
                const existingSlug = await query('SELECT id FROM organisations WHERE slug = $1', [slug]);
                if (existingSlug.rows.length === 0) break;
                slug = `${baseSlug}-${suffix++}`;
            }

            await query(
                `INSERT INTO organisations (id, name, slug, display_name, break_mins_weekday, break_mins_weekend, break_threshold_hours, roster_lock_password_hash, timesheet_lock_password_hash)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    orgId, 
                    name.trim(),
                    slug,
                    name.trim(),
                    break_mins_weekday !== undefined ? Number(break_mins_weekday) : 30,
                    break_mins_weekend !== undefined ? Number(break_mins_weekend) : 0,
                    break_threshold_hours !== undefined ? Number(break_threshold_hours) : 6,
                    rosterLockHash,
                    timesheetLockHash
                ]
            );
        } else {
            await query(
                `INSERT INTO organisations (id, name, break_mins_weekday, break_mins_weekend, break_threshold_hours, roster_lock_password_hash, timesheet_lock_password_hash)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    orgId, 
                    name.trim(),
                    break_mins_weekday !== undefined ? Number(break_mins_weekday) : 30,
                    break_mins_weekend !== undefined ? Number(break_mins_weekend) : 0,
                    break_threshold_hours !== undefined ? Number(break_threshold_hours) : 6,
                    rosterLockHash,
                    timesheetLockHash
                ]
            );
        }

        const userId = crypto.randomUUID();
        const hash = await hashPassword(admin_password);
        const twoFactorEnabled = Boolean(enable_2fa);

        await query('INSERT INTO users (id, org_id, email, password_hash, role, two_factor_enabled) VALUES ($1, $2, $3, $4, $5, $6)', [
            userId, orgId, normalizedInputEmail, hash, 'Company Admin', twoFactorEnabled
        ]);
        await query('INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ($1, $2, $3, $4)', [
            crypto.randomUUID(), orgId, userId, 'Company Admin'
        ]);

        await seedOrgDefaults(orgId);

        res.json({ success: true, data: { id: orgId, admin_id: userId } });
    } catch (err: any) {
        console.error('[PLATFORM CLAIM INVITE ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to claim organization invite.' } });
    }
});

router.use(requireAuth, requireRole(['Platform Admin']));

router.get('/organisations', async (_req: AuthRequest, res: Response) => {
    try {
        const orgsResult = await query('SELECT id, name, is_active, created_at FROM organisations ORDER BY created_at DESC');
        const usersResult = await query('SELECT id, org_id, email, role FROM users');

        const orgs = orgsResult.rows.map((org: any) => {
            const orgUsers = usersResult.rows.filter((u: any) => u.org_id === org.id);
            const adminUser = orgUsers.find((u: any) => u.role === 'Company Admin') || orgUsers.find((u: any) => u.role === 'Platform Admin');
            return {
                ...org,
                user_count: orgUsers.length,
                admin_email: adminUser ? adminUser.email : null,
                admin_role: adminUser ? adminUser.role : null
            };
        });

        res.json({ success: true, data: orgs });
    } catch (err: any) {
        console.error('[PLATFORM GET ORGS ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list organizations.' } });
    }
});

router.get('/invitations', async (_req: AuthRequest, res: Response) => {
    try {
        const result = await query('SELECT id, email, token, created_at, used, delivery_status, last_error FROM org_invitation_tokens ORDER BY created_at DESC');
        res.json({ success: true, data: result.rows });
    } catch (err: any) {
        console.error('[PLATFORM GET INVITATIONS ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list invitations.' } });
    }
});

// Send org invite token
router.post('/send-invite', async (req: AuthRequest, res: Response) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, error: { message: 'Recipient email is required.' } });

        const normalizedEmail = email.trim().toLowerCase();

        // Check if user already exists
        const existingUser = await query('SELECT id FROM users WHERE LOWER(email) = $1', [normalizedEmail]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ success: false, error: { message: `A user with email ${normalizedEmail} already exists.` } });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const inviteId = crypto.randomUUID();
        await query('INSERT INTO org_invitation_tokens (id, email, token, delivery_status, last_error, created_at, used) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
            inviteId, normalizedEmail, token, 'pending', null, new Date().toISOString(), false
        ]);

        const origin = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:3000';
        const inviteLink = `${origin}/setup-org?token=${token}`;

        // Build branded email & dispatch
        const emailTemplate = buildOrgInviteEmailTemplate({ inviteLink, recipientEmail: normalizedEmail });
        const deliveryResult = await sendTransactionalEmail({
            to: normalizedEmail,
            subject: emailTemplate.subject,
            html: emailTemplate.html,
            text: emailTemplate.text
        });

        // Update org_invitation_tokens delivery status
        await query(
            'UPDATE org_invitation_tokens SET delivery_status = $1, last_error = $2 WHERE id = $3',
            [deliveryResult.success ? 'sent' : 'failed', deliveryResult.error || null, inviteId]
        );

        // Audit log invitation event with delivery status
        await query(
            `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, details) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                crypto.randomUUID(), 
                req.user?.organisation_id || '123e4567-e89b-12d3-a456-222222222222', 
                new Date().toISOString(), 
                req.user?.id, 
                deliveryResult.success ? 'INVITE_SENT' : 'INVITE_FAILED', 
                `Dispatched organisation invitation to ${normalizedEmail} (provider: ${deliveryResult.provider}, status: ${deliveryResult.success ? 'delivered' : deliveryResult.error})`
            ]
        );

        if (!deliveryResult.success) {
            return res.status(502).json({
                success: false,
                error: {
                    message: `Email could not be sent: ${deliveryResult.error || 'Provider delivery error'}`
                },
                data: {
                    id: inviteId,
                    recipient: normalizedEmail,
                    delivery_status: 'failed',
                    provider: deliveryResult.provider,
                    error: deliveryResult.error
                }
            });
        }

        res.json({ 
            success: true, 
            data: { 
                id: inviteId,
                recipient: normalizedEmail,
                delivery_status: 'sent',
                provider: deliveryResult.provider,
                message: `Invitation email sent to ${normalizedEmail}`,
                // Only provide raw link in automated test mode so test suites can inspect tokens
                ...(process.env.NODE_ENV === 'test' ? { inviteLink } : {})
            } 
        });
    } catch (err: any) {
        console.error('[PLATFORM SEND INVITE ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to dispatch organisation invitation.' } });
    }
});

// Resend / retry org invitation email
router.post('/resend-invite', async (req: AuthRequest, res: Response) => {
    try {
        const { id, email } = req.body;
        if (!id && !email) {
            return res.status(400).json({ success: false, error: { message: 'Invitation ID or recipient email is required.' } });
        }

        let inviteRes;
        if (id) {
            inviteRes = await query('SELECT * FROM org_invitation_tokens WHERE id = $1 AND used = false', [id]);
        } else {
            inviteRes = await query('SELECT * FROM org_invitation_tokens WHERE LOWER(email) = $1 AND used = false ORDER BY created_at DESC LIMIT 1', [email.trim().toLowerCase()]);
        }

        if (inviteRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'No pending invitation found for this recipient.' } });
        }

        const invite = inviteRes.rows[0];
        const origin = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:3000';
        const inviteLink = `${origin}/setup-org?token=${invite.token}`;

        const emailTemplate = buildOrgInviteEmailTemplate({ inviteLink, recipientEmail: invite.email });
        const deliveryResult = await sendTransactionalEmail({
            to: invite.email,
            subject: emailTemplate.subject,
            html: emailTemplate.html,
            text: emailTemplate.text
        });

        await query(
            'UPDATE org_invitation_tokens SET delivery_status = $1, last_error = $2 WHERE id = $3',
            [deliveryResult.success ? 'sent' : 'failed', deliveryResult.error || null, invite.id]
        );

        await query(
            `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, details) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                crypto.randomUUID(),
                req.user?.organisation_id || '123e4567-e89b-12d3-a456-222222222222',
                new Date().toISOString(),
                req.user?.id,
                deliveryResult.success ? 'INVITE_RESENT' : 'INVITE_RETRY_FAILED',
                `Retried organisation invitation to ${invite.email} (provider: ${deliveryResult.provider}, status: ${deliveryResult.success ? 'delivered' : deliveryResult.error})`
            ]
        );

        if (!deliveryResult.success) {
            return res.status(502).json({
                success: false,
                error: { message: `Email could not be sent: ${deliveryResult.error}` },
                data: { id: invite.id, recipient: invite.email, delivery_status: 'failed', provider: deliveryResult.provider }
            });
        }

        res.json({
            success: true,
            data: {
                id: invite.id,
                recipient: invite.email,
                delivery_status: 'sent',
                provider: deliveryResult.provider,
                message: `Invitation email resent to ${invite.email}`
            }
        });
    } catch (err: any) {
        console.error('[PLATFORM RESEND INVITE ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to resend organisation invitation.' } });
    }
});

router.post('/organisations', async (req: AuthRequest, res: Response) => {
    try {
        const { 
            name, 
            admin_email, 
            admin_password,
            roster_lock_password,
            timesheet_lock_password,
            enable_2fa,
            break_mins_weekday,
            break_mins_weekend,
            break_threshold_hours
        } = req.body;
        if (!name || !admin_email || !admin_password) {
            return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Organization name, admin email, and password required.' } });
        }

        const orgId = crypto.randomUUID();
        const rosterLockHash = roster_lock_password ? await hashPassword(roster_lock_password) : null;
        const timesheetLockHash = timesheet_lock_password ? await hashPassword(timesheet_lock_password) : null;

        await query(
            `INSERT INTO organisations (id, name, break_mins_weekday, break_mins_weekend, break_threshold_hours, roster_lock_password_hash, timesheet_lock_password_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                orgId, 
                name.trim(),
                break_mins_weekday !== undefined ? Number(break_mins_weekday) : 30,
                break_mins_weekend !== undefined ? Number(break_mins_weekend) : 0,
                break_threshold_hours !== undefined ? Number(break_threshold_hours) : 6,
                rosterLockHash,
                timesheetLockHash
            ]
        );

        const userId = crypto.randomUUID();
        const hash = await hashPassword(admin_password);
        const twoFactorEnabled = Boolean(enable_2fa);

        await query('INSERT INTO users (id, org_id, email, password_hash, role, two_factor_enabled) VALUES ($1, $2, $3, $4, $5, $6)', [
            userId, orgId, admin_email.trim().toLowerCase(), hash, 'Company Admin', twoFactorEnabled
        ]);
        await query('INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ($1, $2, $3, $4)', [
            crypto.randomUUID(), orgId, userId, 'Company Admin'
        ]);

        await seedOrgDefaults(orgId);

        res.json({ success: true, data: { id: orgId, admin_id: userId } });
    } catch (err: any) {
        console.error('[PLATFORM CREATE ORG ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create organization.' } });
    }
});

export default router;
