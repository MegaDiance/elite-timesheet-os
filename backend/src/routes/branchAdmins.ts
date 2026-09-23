import { Router, Response } from 'express';
import crypto from 'crypto';
import { query, withTransaction } from '../services/db';
import { comparePassword, hashPassword } from '../services/auth';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { AccessContext, HttpError, badRequest, isUuid, notFound, writeAudit } from '../services/policy';
import { revokeUserSessionsInOrganisation } from '../services/sessionService';
import { sendTransactionalEmail, buildBranchAdminInviteEmailTemplate, isEmailSendingEnabled } from '../services/emailService';
import {
    RateLimitedRequest, checkRateLimit, recordFailedAttempt, clearRateLimit,
    isStrongPassword, isValidEmail, newSecretToken, publicBaseUrl, sha256Hex
} from '../services/authUtils';

/**
 * Branch Admin accounts.
 *
 * Only the Organisation Owner creates, assigns and removes Branch Admins. A Branch Admin is an
 * account with one or more rows in branch_admins; one account may hold many branches and may be
 * a Branch Admin (or Owner) in other organisations too.
 *
 * New people are added by invitation. The invitation token is random, stored hashed, expires
 * after 7 days, is single use, and never creates a session: after accepting, the person signs in
 * normally. An invitation for an email that already has an account only attaches branch access
 * after that account's password has been verified.
 *
 * While email is turned off (EMAIL_ENABLED), the invitation link is handed straight back to the
 * Owner who just created it — never emailed, never returned by any other endpoint — so they can
 * copy and share it themselves. The link is exactly as secure either way: random, single-use,
 * expiring, revocable, and a fresh invite or resend always invalidates the previous one.
 */
const router = Router();

const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const INVALID_INVITE = { success: false, error: { code: 'INVALID_INVITATION', message: 'This invitation is no longer valid. Ask the organisation owner to send a new one.' } };

async function findOpenInvitation(rawToken: unknown) {
    if (typeof rawToken !== 'string' || !rawToken.trim()) return null;
    const res = await query(
        `SELECT i.*, o.name AS organisation_name, o.portal_slug
           FROM branch_admin_invitations i
           JOIN organisations o ON o.id = i.org_id AND o.is_active = true
          WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW()`,
        [sha256Hex(rawToken.trim())]
    );
    return res.rows[0] || null;
}

async function invitationBranches(invitationId: string) {
    const res = await query(
        `SELECT l.id, l.name
           FROM branch_admin_invitation_branches b
           JOIN locations l ON l.id = b.location_id AND l.org_id = b.org_id AND l.is_active = true
          WHERE b.invitation_id = $1 ORDER BY l.name ASC`,
        [invitationId]
    );
    return res.rows as Array<{ id: string; name: string }>;
}

// ---------------------------------------------------------------------------
// Public: verify and accept an invitation
// ---------------------------------------------------------------------------
router.get('/invitations/verify', checkRateLimit, async (req: RateLimitedRequest, res: Response) => {
    try {
        const invitation = await findOpenInvitation(req.query.token);
        if (!invitation) {
            recordFailedAttempt(req.rateLimitKey);
            return res.status(400).json(INVALID_INVITE);
        }
        const existing = await query('SELECT 1 FROM users WHERE LOWER(email) = $1', [invitation.email]);
        res.json({
            success: true,
            data: {
                email: invitation.email,
                organisation_name: invitation.organisation_name,
                branches: (await invitationBranches(invitation.id)).map(b => b.name),
                account_exists: existing.rows.length > 0,
            }
        });
    } catch (err) {
        sendError(res, err, 'INVITATION VERIFY ERROR');
    }
});

router.post('/invitations/accept', checkRateLimit, async (req: RateLimitedRequest, res: Response) => {
    try {
        const { token, password, full_name } = req.body || {};
        const invitation = await findOpenInvitation(token);
        if (!invitation || typeof password !== 'string' || !password) {
            recordFailedAttempt(req.rateLimitKey);
            return res.status(400).json(INVALID_INVITE);
        }

        const branches = await invitationBranches(invitation.id);
        if (branches.length === 0) {
            return res.status(400).json(INVALID_INVITE);
        }

        const userRes = await query('SELECT id, password_hash, is_active FROM users WHERE LOWER(email) = $1', [invitation.email]);
        const existingUser = userRes.rows[0];
        let newPasswordHash: string | null = null;

        if (existingUser) {
            // The invitation attaches access to an existing account only once that account has authenticated.
            const ok = existingUser.is_active && existingUser.password_hash
                && await comparePassword(password, existingUser.password_hash);
            if (!ok) {
                recordFailedAttempt(req.rateLimitKey);
                return res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Enter the current password for this account to accept the invitation.' } });
            }
        } else {
            const strength = isStrongPassword(password);
            if (!strength.valid) {
                return res.status(400).json({ success: false, error: { code: 'WEAK_PASSWORD', message: strength.reason } });
            }
            newPasswordHash = await hashPassword(password);
        }

        const accepted = await withTransaction(async (tx) => {
            // Single use: only one request can claim the invitation.
            const claim = await tx(
                `UPDATE branch_admin_invitations SET accepted_at = NOW()
                  WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
                  RETURNING id`,
                [invitation.id]
            );
            if (claim.rows.length === 0) return null;

            let userId: string = existingUser?.id;
            if (!userId) {
                userId = crypto.randomUUID();
                const name = typeof full_name === 'string' && full_name.trim() ? full_name.trim().slice(0, 120) : invitation.full_name;
                await tx(
                    'INSERT INTO users (id, email, password_hash, full_name, is_active) VALUES ($1, $2, $3, $4, true)',
                    [userId, invitation.email, newPasswordHash, name || null]
                );
            }

            for (const branch of branches) {
                await tx(
                    `INSERT INTO branch_admins (org_id, location_id, user_id, assigned_by)
                     VALUES ($1, $2, $3, $4) ON CONFLICT (location_id, user_id) DO NOTHING`,
                    [invitation.org_id, branch.id, userId, invitation.invited_by]
                );
            }
            await tx('UPDATE branch_admin_invitations SET accepted_user_id = $1 WHERE id = $2', [userId, invitation.id]);
            return userId;
        });

        if (!accepted) return res.status(400).json(INVALID_INVITE);
        clearRateLimit(req.rateLimitKey);

        await writeAudit({
            orgId: invitation.org_id, actorId: accepted, action: 'BRANCH_ADMIN_INVITATION_ACCEPTED', entityType: 'branch_admin_invitation',
            entityId: invitation.id, targetUserId: accepted, newValue: branches.map(b => b.name).join(', ')
        });

        // No session is issued here. The person signs in through the organisation's sign-in page.
        res.json({ success: true, data: { login_path: `/login/${invitation.portal_slug}` }, message: 'Invitation accepted. You can now sign in.' });
    } catch (err) {
        sendError(res, err, 'INVITATION ACCEPT ERROR');
    }
});

// ---------------------------------------------------------------------------
// Owner only from here
// ---------------------------------------------------------------------------
router.use(requireAuth, requirePermission(Permission.BRANCH_ADMINS_MANAGE));

/** Validates that every id is an active branch of the caller's organisation. Ids come from the client, so they are checked, never trusted. */
async function resolveOwnBranches(ctx: AccessContext, locationIds: unknown): Promise<Array<{ id: string; name: string }>> {
    if (!Array.isArray(locationIds) || locationIds.some(id => !isUuid(id))) {
        throw badRequest('VALIDATION_FAILED', 'location_ids must be a list of branch ids.');
    }
    const unique = Array.from(new Set(locationIds as string[]));
    if (unique.length === 0) return [];
    const res = await query(
        'SELECT id, name FROM locations WHERE org_id = $1 AND is_active = true AND id = ANY($2::uuid[]) ORDER BY name ASC',
        [ctx.orgId, unique]
    );
    if (res.rows.length !== unique.length) {
        throw new HttpError(404, 'NOT_FOUND', 'One or more branches were not found.');
    }
    return res.rows;
}

interface InvitationDelivery {
    /** True once the person has a way to get the link: either it was emailed, or it is being handed back for copying. */
    delivered: boolean;
    /** The raw link, present only when email is off and the caller (the Owner who made the request) must copy it themselves. */
    link?: string;
}

/**
 * Emails the invitation link, or — while email is off — reports it back to be copied instead.
 * Either way `branch_admin_invitations.delivery_status` records what actually happened ('sent',
 * 'link' or 'failed'), and the API response is worded to match: it never says "sent" unless an
 * email really was sent.
 */
async function deliverInvitation(ctx: AccessContext, invitationId: string, email: string, rawToken: string, branchNames: string[]): Promise<InvitationDelivery> {
    const link = `${publicBaseUrl()}/accept-invite?token=${rawToken}`;
    if (!isEmailSendingEnabled()) {
        await query('UPDATE branch_admin_invitations SET delivery_status = $1, last_error = NULL WHERE id = $2', ['link', invitationId]);
        return { delivered: true, link };
    }

    const orgRes = await query('SELECT name FROM organisations WHERE id = $1', [ctx.orgId]);
    const template = buildBranchAdminInviteEmailTemplate({
        inviteLink: link,
        recipientEmail: email,
        organisationName: orgRes.rows[0].name,
        branchNames,
    });
    const result = await sendTransactionalEmail({ to: email, subject: template.subject, html: template.html, text: template.text });
    await query(
        'UPDATE branch_admin_invitations SET delivery_status = $1, last_error = $2 WHERE id = $3',
        [result.success ? 'sent' : 'failed', result.success ? null : result.error || 'UNKNOWN', invitationId]
    );
    return { delivered: result.success };
}

router.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const admins = await query(
            `SELECT u.id, u.email, u.full_name, u.is_active, u.two_factor_enabled,
                    json_agg(json_build_object('id', l.id, 'name', l.name, 'is_active', l.is_active) ORDER BY l.name) AS branches
               FROM branch_admins ba
               JOIN users u ON u.id = ba.user_id
               JOIN locations l ON l.id = ba.location_id
              WHERE ba.org_id = $1
              GROUP BY u.id
              ORDER BY u.email ASC`,
            [ctx.orgId]
        );
        const invitations = await query(
            `SELECT i.id, i.email, i.full_name, i.expires_at, i.delivery_status, i.created_at,
                    COALESCE((SELECT json_agg(json_build_object('id', l.id, 'name', l.name) ORDER BY l.name)
                                FROM branch_admin_invitation_branches b JOIN locations l ON l.id = b.location_id
                               WHERE b.invitation_id = i.id), '[]'::json) AS branches
               FROM branch_admin_invitations i
              WHERE i.org_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW()
              ORDER BY i.created_at DESC`,
            [ctx.orgId]
        );
        res.json({ success: true, data: { branch_admins: admins.rows, invitations: invitations.rows } });
    } catch (err) {
        sendError(res, err, 'BRANCH ADMIN LIST ERROR');
    }
});

router.post('/invitations', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { email, full_name, location_ids } = req.body || {};
        if (!isValidEmail(email)) throw badRequest('VALIDATION_FAILED', 'A valid email address is required.');
        const cleanEmail = email.trim().toLowerCase();
        if (cleanEmail === ctx.email.toLowerCase()) throw badRequest('VALIDATION_FAILED', 'You already own this organisation.');

        const branches = await resolveOwnBranches(ctx, location_ids);
        if (branches.length === 0) throw badRequest('VALIDATION_FAILED', 'Select at least one branch.');

        const already = await query(
            `SELECT 1 FROM branch_admins ba JOIN users u ON u.id = ba.user_id
              WHERE ba.org_id = $1 AND LOWER(u.email) = $2 LIMIT 1`,
            [ctx.orgId, cleanEmail]
        );
        if (already.rows.length > 0) {
            return res.status(409).json({ success: false, error: { code: 'ALREADY_BRANCH_ADMIN', message: 'This person is already a Branch Admin here. Change their branches instead.' } });
        }

        const token = newSecretToken();
        const invitationId = crypto.randomUUID();
        await withTransaction(async (tx) => {
            // One open invitation per email: a new one replaces (revokes) the old link.
            await tx(
                'UPDATE branch_admin_invitations SET revoked_at = NOW() WHERE org_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL',
                [ctx.orgId, cleanEmail]
            );
            await tx(
                `INSERT INTO branch_admin_invitations (id, org_id, email, full_name, token_hash, invited_by, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [invitationId, ctx.orgId, cleanEmail, typeof full_name === 'string' && full_name.trim() ? full_name.trim().slice(0, 120) : null,
                    token.hash, ctx.userId, new Date(Date.now() + INVITE_LIFETIME_MS).toISOString()]
            );
            for (const branch of branches) {
                await tx('INSERT INTO branch_admin_invitation_branches (invitation_id, org_id, location_id) VALUES ($1, $2, $3)', [invitationId, ctx.orgId, branch.id]);
            }
        });

        const delivery = await deliverInvitation(ctx, invitationId, cleanEmail, token.raw, branches.map(b => b.name));
        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'BRANCH_ADMIN_INVITED', entityType: 'branch_admin_invitation', entityId: invitationId,
            newValue: branches.map(b => b.name).join(', '), details: delivery.link ? `Invited ${cleanEmail} (link copied, email is off)` : `Invited ${cleanEmail}`
        });

        res.status(201).json({
            success: true,
            data: {
                id: invitationId, email: cleanEmail,
                delivery_status: delivery.link ? 'link' : delivery.delivered ? 'sent' : 'failed',
                // Only ever included when email is off: it is otherwise never returned by any endpoint, only emailed.
                ...(delivery.link ? { invite_link: delivery.link } : {}),
            },
            message: delivery.link
                ? `Invitation created for ${cleanEmail}. Email is currently turned off — copy the link below and share it with them.`
                : delivery.delivered
                    ? `Invitation sent to ${cleanEmail}.`
                    : 'The invitation was created but the email could not be delivered. Use Resend once email is working.'
        });
    } catch (err) {
        sendError(res, err, 'BRANCH ADMIN INVITE ERROR');
    }
});

router.post('/invitations/:id/resend', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        if (!isUuid(req.params.id)) throw notFound('Invitation');
        // Resending rotates the token, so the previously emailed link stops working.
        const token = newSecretToken();
        const updated = await query(
            `UPDATE branch_admin_invitations SET token_hash = $1, expires_at = $2
              WHERE id = $3 AND org_id = $4 AND accepted_at IS NULL AND revoked_at IS NULL
              RETURNING id, email`,
            [token.hash, new Date(Date.now() + INVITE_LIFETIME_MS).toISOString(), req.params.id, ctx.orgId]
        );
        if (updated.rows.length === 0) throw notFound('Invitation');

        const branches = await invitationBranches(updated.rows[0].id);
        const delivery = await deliverInvitation(ctx, updated.rows[0].id, updated.rows[0].email, token.raw, branches.map(b => b.name));
        res.json({
            success: delivery.delivered,
            data: {
                delivery_status: delivery.link ? 'link' : delivery.delivered ? 'sent' : 'failed',
                ...(delivery.link ? { invite_link: delivery.link } : {}),
            },
            message: delivery.link ? 'The link was regenerated. Email is currently turned off — copy the new link below.' : delivery.delivered ? 'Invitation re-sent.' : 'The email could not be delivered.'
        });
    } catch (err) {
        sendError(res, err, 'BRANCH ADMIN RESEND ERROR');
    }
});

router.delete('/invitations/:id', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        if (!isUuid(req.params.id)) throw notFound('Invitation');
        const revoked = await query(
            `UPDATE branch_admin_invitations SET revoked_at = NOW()
              WHERE id = $1 AND org_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING email`,
            [req.params.id, ctx.orgId]
        );
        if (revoked.rows.length === 0) throw notFound('Invitation');
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'BRANCH_ADMIN_INVITATION_REVOKED', entityType: 'branch_admin_invitation', entityId: req.params.id, details: `Revoked invitation for ${revoked.rows[0].email}` });
        res.json({ success: true, message: 'Invitation revoked.' });
    } catch (err) {
        sendError(res, err, 'BRANCH ADMIN REVOKE ERROR');
    }
});

/**
 * POST /api/branch-admins/:userId/reset-password-link
 *
 * The no-email way for a locked-out Branch Admin to get back in: the Owner generates a secure,
 * single-use, expiring link (the same link `POST /auth/forgot-password` would otherwise email)
 * and copies it to the person themselves. Works whether or not email is on — it is a convenience
 * either way — and is the one the Owner is pointed to while email is off.
 */
router.post('/:userId/reset-password-link', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const targetUserId = req.params.userId;
        if (!isUuid(targetUserId)) throw notFound('Branch Admin');

        const admin = await query(
            `SELECT DISTINCT u.id, u.email FROM branch_admins ba JOIN users u ON u.id = ba.user_id
              WHERE ba.org_id = $1 AND ba.user_id = $2`,
            [ctx.orgId, targetUserId]
        );
        if (admin.rows.length === 0) throw notFound('Branch Admin');

        const token = newSecretToken();
        await query('DELETE FROM reset_tokens WHERE user_id = $1', [targetUserId]);
        await query(
            'INSERT INTO reset_tokens (token_hash, user_id, expires_at, org_id) VALUES ($1, $2, $3, $4)',
            [token.hash, targetUserId, new Date(Date.now() + 3600000).toISOString(), ctx.orgId]
        );

        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'BRANCH_ADMIN_PASSWORD_RESET_LINK_CREATED',
            entityType: 'branch_admin', entityId: targetUserId, targetUserId, details: `Generated a password reset link for ${admin.rows[0].email}`
        });

        res.json({
            success: true,
            data: { reset_link: `${publicBaseUrl()}/reset-password?token=${token.raw}` },
            message: 'Copy this link and share it with them yourself. It works once and expires in 1 hour.'
        });
    } catch (err) {
        sendError(res, err, 'BRANCH ADMIN RESET LINK ERROR');
    }
});

/**
 * PUT /api/branch-admins/:userId/branches  { location_ids: [] }
 * Replaces the branch assignments of someone who is already a Branch Admin of this organisation.
 * (People who are not yet Branch Admins here are added by invitation, so they consent first.)
 * An empty list removes their access.
 */
router.put('/:userId/branches', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const targetUserId = req.params.userId;
        if (!isUuid(targetUserId)) throw notFound('Branch Admin');
        const branches = await resolveOwnBranches(ctx, req.body?.location_ids);

        const current = await query(
            `SELECT l.id, l.name FROM branch_admins ba JOIN locations l ON l.id = ba.location_id
              WHERE ba.org_id = $1 AND ba.user_id = $2 ORDER BY l.name ASC`,
            [ctx.orgId, targetUserId]
        );
        if (current.rows.length === 0) throw notFound('Branch Admin');

        await withTransaction(async (tx) => {
            await tx('DELETE FROM branch_admins WHERE org_id = $1 AND user_id = $2', [ctx.orgId, targetUserId]);
            for (const branch of branches) {
                await tx('INSERT INTO branch_admins (org_id, location_id, user_id, assigned_by) VALUES ($1, $2, $3, $4)', [ctx.orgId, branch.id, targetUserId, ctx.userId]);
            }
        });
        if (branches.length === 0) {
            await revokeUserSessionsInOrganisation(targetUserId, ctx.orgId);
        }

        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: branches.length === 0 ? 'BRANCH_ADMIN_REMOVED' : 'BRANCH_ADMIN_BRANCHES_CHANGED',
            entityType: 'branch_admin', entityId: targetUserId, targetUserId,
            previousValue: current.rows.map((b: any) => b.name).join(', '), newValue: branches.map(b => b.name).join(', ')
        });
        res.json({ success: true, data: { branches }, message: branches.length === 0 ? 'Branch Admin access removed.' : 'Branch assignments updated.' });
    } catch (err) {
        sendError(res, err, 'BRANCH ADMIN ASSIGN ERROR');
    }
});

router.delete('/:userId', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const targetUserId = req.params.userId;
        if (!isUuid(targetUserId)) throw notFound('Branch Admin');
        const removed = await query('DELETE FROM branch_admins WHERE org_id = $1 AND user_id = $2 RETURNING location_id', [ctx.orgId, targetUserId]);
        if (removed.rows.length === 0) throw notFound('Branch Admin');

        await revokeUserSessionsInOrganisation(targetUserId, ctx.orgId);
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'BRANCH_ADMIN_REMOVED', entityType: 'branch_admin', entityId: targetUserId, targetUserId, details: `Removed from ${removed.rows.length} branch(es)` });
        res.json({ success: true, message: 'Branch Admin access removed.' });
    } catch (err) {
        sendError(res, err, 'BRANCH ADMIN REMOVE ERROR');
    }
});

export default router;
