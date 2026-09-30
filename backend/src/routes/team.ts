import { Router, Response } from 'express';
import crypto from 'crypto';
import { query, withTransaction } from '../services/db';
import { comparePassword, hashPassword } from '../services/auth';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { AccessContext, HttpError, assertResettableLogin, badRequest, isUuid, notFound, writeAudit } from '../services/policy';
import { revokeUserSessionsInOrganisation } from '../services/sessionService';
import { sendTransactionalEmail, buildTeamInviteEmailTemplate, isEmailSendingEnabled } from '../services/emailService';
import { accountRateLimitKey, isRateLimited, TOO_MANY_ATTEMPTS,
    RateLimitedRequest, checkRateLimit, recordFailedAttempt, clearRateLimit,
    isStrongPassword, isValidEmail, newSecretToken, publicBaseUrl, sha256Hex
} from '../services/authUtils';
import { usablePortalPath } from '../services/portalLink';
import { isOrganisationLevel } from '../services/permissions';
import {
    RoleRecord, ScopeInput, assertCanChangeUser, assertCovers, assertCoversUser, assignmentsOf,
    isMemberOfOrganisation, loadRole, readScope,
} from '../services/roleAdmin';

/**
 * The team: who has access to this organisation, with which roles, and where.
 *
 * Access is a set of assignments — one person holding one role, within a scope (the entire
 * organisation, or chosen branches). Effective access is the union of a person's assignments
 * (services/policy.ts). This file creates, changes and removes assignments, and invites new people.
 *
 * Everything needs users.manage, and everything the caller does is limited to access the caller
 * holds themselves (services/roleAdmin.ts): you can't hand out, change or take away what you don't
 * have, you can't change your own access, and the owner's access can't be assigned or removed.
 *
 * New people are added by invitation. The invitation token is random, stored hashed, expires
 * after 7 days, is single use, and never creates a session: after accepting, the person signs in
 * normally. An invitation for an email that already has an account only attaches access after that
 * account's password has been verified.
 *
 * While email is turned off (EMAIL_ENABLED), the invitation link is handed straight back to the
 * person who just created it — never emailed, never returned by any other endpoint — so they can
 * copy and share it themselves. The link is exactly as secure either way: random, single-use,
 * expiring, revocable, and a fresh invite or resend always invalidates the previous one.
 */

const router = Router();

const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const INVALID_INVITE = { success: false, error: { code: 'INVALID_INVITATION', message: 'This invitation is no longer valid. Ask the person who invited you to send a new one.' } };

async function findOpenInvitation(rawToken: unknown) {
    if (typeof rawToken !== 'string' || !rawToken.trim()) return null;
    const res = await query(
        `SELECT i.*, o.name AS organisation_name, r.name AS role_name, r.system_key AS role_system_key
           FROM branch_admin_invitations i
           JOIN organisations o ON o.id = i.org_id AND o.is_active = true
           JOIN roles r ON r.id = i.role_id AND r.org_id = i.org_id
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
                role_name: invitation.role_name,
                all_branches: invitation.scope_all === true,
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
        // Built-in Owner/Employee access is never handed out by invitation.
        if (invitation.role_system_key === 'OWNER' || invitation.role_system_key === 'EMPLOYEE') {
            return res.status(400).json(INVALID_INVITE);
        }

        const branches = await invitationBranches(invitation.id);
        if (invitation.scope_all !== true && branches.length === 0) {
            return res.status(400).json(INVALID_INVITE);
        }

        const userRes = await query('SELECT id, password_hash, is_active FROM users WHERE LOWER(email) = $1', [invitation.email]);
        const existingUser = userRes.rows[0];
        let newPasswordHash: string | null = null;

        if (existingUser) {
            // The invitation attaches access to an existing account only once that account has authenticated.
            // Failures count against the account itself, exactly like the sign-in page.
            const accountKey = accountRateLimitKey(invitation.email);
            if (isRateLimited(accountKey)) return res.status(429).json(TOO_MANY_ATTEMPTS);
            const ok = existingUser.is_active && existingUser.password_hash
                && await comparePassword(password, existingUser.password_hash);
            if (!ok) {
                recordFailedAttempt(req.rateLimitKey);
                recordFailedAttempt(accountKey);
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

            // Accepting never widens access the person already holds: an existing assignment of this role keeps its scope.
            const assignment = await tx(
                `INSERT INTO user_roles (org_id, user_id, role_id, scope_all, assigned_by)
                 VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, role_id) DO NOTHING RETURNING id`,
                [invitation.org_id, userId, invitation.role_id, invitation.scope_all === true, invitation.invited_by]
            );
            if (assignment.rows.length > 0 && invitation.scope_all !== true) {
                for (const branch of branches) {
                    await tx('INSERT INTO user_role_branches (user_role_id, org_id, location_id) VALUES ($1, $2, $3)', [assignment.rows[0].id, invitation.org_id, branch.id]);
                }
            }
            await tx('UPDATE branch_admin_invitations SET accepted_user_id = $1 WHERE id = $2', [userId, invitation.id]);
            return userId;
        });

        if (!accepted) return res.status(400).json(INVALID_INVITE);
        clearRateLimit(req.rateLimitKey);

        await writeAudit({
            orgId: invitation.org_id, actorId: accepted, action: 'TEAM_INVITATION_ACCEPTED', entityType: 'invitation',
            entityId: invitation.id, targetUserId: accepted,
            newValue: `${invitation.role_name}: ${invitation.scope_all ? 'entire organisation' : branches.map(b => b.name).join(', ')}`
        });

        // No session is issued here. The person signs in through the organisation's sign-in page.
        res.json({ success: true, data: { login_path: await usablePortalPath(invitation.org_id) }, message: 'Invitation accepted. You can now sign in.' });
    } catch (err) {
        sendError(res, err, 'INVITATION ACCEPT ERROR');
    }
});

// ---------------------------------------------------------------------------
// users.manage from here
// ---------------------------------------------------------------------------
router.use(requireAuth, requirePermission(Permission.USERS_MANAGE));

interface InvitationDelivery {
    /** True once the person has a way to get the link: either it was emailed, or it is being handed back for copying. */
    delivered: boolean;
    /** The raw link, present only when email is off and the caller (who just made the request) must copy it themselves. */
    link?: string;
}

/**
 * Emails the invitation link, or — while email is off — reports it back to be copied instead.
 * Either way `branch_admin_invitations.delivery_status` records what actually happened ('sent',
 * 'link' or 'failed'), and the API response is worded to match: it never says "sent" unless an
 * email really was sent.
 */
async function deliverInvitation(ctx: AccessContext, invitationId: string, email: string, rawToken: string, roleName: string, branchNames: string[]): Promise<InvitationDelivery> {
    const link = `${publicBaseUrl()}/accept-invite?token=${rawToken}`;
    if (!isEmailSendingEnabled()) {
        await query('UPDATE branch_admin_invitations SET delivery_status = $1, last_error = NULL WHERE id = $2', ['link', invitationId]);
        return { delivered: true, link };
    }

    const orgRes = await query('SELECT name FROM organisations WHERE id = $1', [ctx.orgId]);
    const template = buildTeamInviteEmailTemplate({
        inviteLink: link,
        recipientEmail: email,
        organisationName: orgRes.rows[0].name,
        roleName,
        branchNames,
    });
    const result = await sendTransactionalEmail({ to: email, subject: template.subject, html: template.html, text: template.text });
    await query(
        'UPDATE branch_admin_invitations SET delivery_status = $1, last_error = $2 WHERE id = $3',
        [result.success ? 'sent' : 'failed', result.success ? null : result.error || 'UNKNOWN', invitationId]
    );
    return { delivered: result.success };
}

/** A role someone can be given. Owner and Employee access come from ownership and the worker record, never from an assignment. */
function assertAssignable(role: RoleRecord) {
    if (role.systemKey === 'OWNER' || role.systemKey === 'EMPLOYEE') {
        throw badRequest('ROLE_NOT_ASSIGNABLE', role.systemKey === 'OWNER'
            ? 'The Owner role can’t be assigned. Use “Transfer ownership” to hand the organisation over.'
            : 'The Employee role comes from a worker’s sign-in. Invite them from the Workers page.');
    }
}

/** A role that is only organisation-level permissions does nothing on chosen branches, so it must be organisation-wide. */
function assertScopeFitsRole(role: RoleRecord, scope: ScopeInput) {
    if (!scope.all && role.permissions.length > 0 && role.permissions.every(isOrganisationLevel)) {
        throw badRequest('SCOPE_NOT_SUPPORTED', `“${role.name}” only works across the entire organisation. Choose the entire organisation.`);
    }
}

const scopeText = (scope: { all: boolean; branches: Array<{ name: string }> }) =>
    scope.all ? 'entire organisation' : scope.branches.map(b => b.name).join(', ') || 'no branches';

async function scopeWithNames(orgId: string, scope: ScopeInput) {
    if (scope.all) return { all: true, branches: [] as Array<{ id: string; name: string }> };
    const res = await query('SELECT id, name FROM locations WHERE org_id = $1 AND id = ANY($2::uuid[]) ORDER BY name ASC', [orgId, scope.branchIds]);
    return { all: false, branches: res.rows as Array<{ id: string; name: string }> };
}

/** GET /api/team — everyone with access, their roles and where those apply, plus open invitations. */
router.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const [people, assignments, workers, invitations, branches] = await Promise.all([
            query(
                `SELECT u.id, u.email, u.full_name, u.is_active, u.two_factor_enabled, (o.owner_user_id = u.id) AS is_owner
                   FROM organisations o
                   JOIN users u ON u.id IN (
                        SELECT o.owner_user_id
                        UNION SELECT ur.user_id FROM user_roles ur WHERE ur.org_id = o.id
                        UNION SELECT e.user_id FROM employees e WHERE e.org_id = o.id AND e.user_id IS NOT NULL AND e.is_active = true)
                  WHERE o.id = $1
                  ORDER BY lower(COALESCE(u.full_name, u.email)) ASC`,
                [ctx.orgId]
            ),
            query(
                `SELECT ur.id, ur.user_id, ur.role_id, r.name AS role_name, r.system_key, ur.scope_all,
                        COALESCE(json_agg(json_build_object('id', l.id, 'name', l.name, 'is_active', l.is_active) ORDER BY l.name) FILTER (WHERE l.id IS NOT NULL), '[]'::json) AS branches
                   FROM user_roles ur
                   JOIN roles r ON r.id = ur.role_id AND r.org_id = ur.org_id
                   LEFT JOIN user_role_branches urb ON urb.user_role_id = ur.id
                   LEFT JOIN locations l ON l.id = urb.location_id
                  WHERE ur.org_id = $1
                  GROUP BY ur.id, r.id
                  ORDER BY r.name ASC`,
                [ctx.orgId]
            ),
            query(
                `SELECT e.user_id, e.id AS worker_id, e.full_name, l.id AS branch_id, l.name AS branch_name
                   FROM employees e JOIN locations l ON l.id = e.location_id
                  WHERE e.org_id = $1 AND e.user_id IS NOT NULL AND e.is_active = true`,
                [ctx.orgId]
            ),
            query(
                `SELECT i.id, i.email, i.full_name, i.expires_at, i.delivery_status, i.created_at, i.role_id, r.name AS role_name, i.scope_all,
                        COALESCE((SELECT json_agg(json_build_object('id', l.id, 'name', l.name) ORDER BY l.name)
                                    FROM branch_admin_invitation_branches b JOIN locations l ON l.id = b.location_id
                                   WHERE b.invitation_id = i.id), '[]'::json) AS branches
                   FROM branch_admin_invitations i
                   JOIN roles r ON r.id = i.role_id AND r.org_id = i.org_id
                  WHERE i.org_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW()
                  ORDER BY i.created_at DESC`,
                [ctx.orgId]
            ),
            query('SELECT id, name, is_active FROM locations WHERE org_id = $1 AND is_active = true ORDER BY name ASC', [ctx.orgId]),
        ]);

        const byUser = new Map<string, any[]>();
        for (const a of assignments.rows) {
            const list = byUser.get(a.user_id) || [];
            list.push({
                id: a.id, role_id: a.role_id, role_name: a.role_name, system_key: a.system_key,
                scope: { all: a.scope_all, branches: a.branches },
            });
            byUser.set(a.user_id, list);
        }
        const workerOf = new Map<string, any>(workers.rows.map((w: any) => [w.user_id, { id: w.worker_id, branch_id: w.branch_id, branch_name: w.branch_name }]));

        res.json({
            success: true,
            data: {
                members: people.rows.map((p: any) => ({
                    user_id: p.id, email: p.email, full_name: p.full_name, is_owner: p.is_owner, is_self: p.id === ctx.userId,
                    status: p.is_active ? 'active' : 'disabled', two_factor_enabled: p.two_factor_enabled,
                    worker: workerOf.get(p.id) ?? null,
                    assignments: byUser.get(p.id) ?? [],
                })),
                invitations: invitations.rows,
                branches: branches.rows,
            },
        });
    } catch (err) {
        sendError(res, err, 'TEAM LIST ERROR');
    }
});

/**
 * POST /api/team/invitations  { email, full_name?, role_id, scope: { all: true } | { branch_ids: [...] } }
 */
router.post('/invitations', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { email, full_name } = req.body || {};
        if (!isValidEmail(email)) throw badRequest('VALIDATION_FAILED', 'A valid email address is required.');
        const cleanEmail = email.trim().toLowerCase();
        if (cleanEmail === ctx.email.toLowerCase()) throw badRequest('VALIDATION_FAILED', 'You already have access to this organisation.');

        const role = await loadRole(ctx.orgId, req.body?.role_id);
        assertAssignable(role);
        const scope = await readScope(ctx.orgId, req.body?.scope);
        assertScopeFitsRole(role, scope);
        await assertCovers(ctx, role.permissions, scope, `invite ${cleanEmail} as ${role.name}`, null);

        const already = await query(
            `SELECT 1 FROM users u
              WHERE LOWER(u.email) = $2
                AND (u.id = (SELECT owner_user_id FROM organisations WHERE id = $1)
                     OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.org_id = $1 AND ur.user_id = u.id))
              LIMIT 1`,
            [ctx.orgId, cleanEmail]
        );
        if (already.rows.length > 0) {
            return res.status(409).json({ success: false, error: { code: 'ALREADY_TEAM_MEMBER', message: 'This person already has access here. Add or change their roles from the People list instead.' } });
        }

        const branchNames = scope.all ? [] : (await scopeWithNames(ctx.orgId, scope)).branches.map(b => b.name);
        const token = newSecretToken();
        const invitationId = crypto.randomUUID();
        await withTransaction(async (tx) => {
            // One open invitation per email: a new one replaces (revokes) the old link.
            await tx(
                'UPDATE branch_admin_invitations SET revoked_at = NOW() WHERE org_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL',
                [ctx.orgId, cleanEmail]
            );
            await tx(
                `INSERT INTO branch_admin_invitations (id, org_id, email, full_name, token_hash, invited_by, expires_at, role_id, scope_all)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [invitationId, ctx.orgId, cleanEmail, typeof full_name === 'string' && full_name.trim() ? full_name.trim().slice(0, 120) : null,
                    token.hash, ctx.userId, new Date(Date.now() + INVITE_LIFETIME_MS).toISOString(), role.id, scope.all]
            );
            for (const branchId of scope.all ? [] : scope.branchIds) {
                await tx('INSERT INTO branch_admin_invitation_branches (invitation_id, org_id, location_id) VALUES ($1, $2, $3)', [invitationId, ctx.orgId, branchId]);
            }
        });

        const delivery = await deliverInvitation(ctx, invitationId, cleanEmail, token.raw, role.name, branchNames);
        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'TEAM_MEMBER_INVITED', entityType: 'invitation', entityId: invitationId,
            newValue: `${role.name}: ${scope.all ? 'entire organisation' : branchNames.join(', ')}`,
            details: delivery.link ? `Invited ${cleanEmail} (link copied, email is off)` : `Invited ${cleanEmail}`
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
        sendError(res, err, 'TEAM INVITE ERROR');
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
              RETURNING id, email, role_id`,
            [token.hash, new Date(Date.now() + INVITE_LIFETIME_MS).toISOString(), req.params.id, ctx.orgId]
        );
        if (updated.rows.length === 0) throw notFound('Invitation');

        const branches = await invitationBranches(updated.rows[0].id);
        const role = await loadRole(ctx.orgId, updated.rows[0].role_id);
        const delivery = await deliverInvitation(ctx, updated.rows[0].id, updated.rows[0].email, token.raw, role.name, branches.map(b => b.name));
        res.json({
            success: delivery.delivered,
            data: {
                delivery_status: delivery.link ? 'link' : delivery.delivered ? 'sent' : 'failed',
                ...(delivery.link ? { invite_link: delivery.link } : {}),
            },
            message: delivery.link ? 'The link was regenerated. Email is currently turned off — copy the new link below.' : delivery.delivered ? 'Invitation re-sent.' : 'The email could not be delivered.'
        });
    } catch (err) {
        sendError(res, err, 'TEAM RESEND ERROR');
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
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'TEAM_INVITATION_REVOKED', entityType: 'invitation', entityId: req.params.id, details: `Revoked invitation for ${revoked.rows[0].email}` });
        res.json({ success: true, message: 'Invitation revoked.' });
    } catch (err) {
        sendError(res, err, 'TEAM REVOKE ERROR');
    }
});

/**
 * POST /api/team/:userId/reset-password-link
 *
 * The no-email way for a locked-out team member to get back in: a secure, single-use, expiring link
 * (the same one `POST /auth/forgot-password` would otherwise email) that the caller copies to the
 * person themselves. Because a reset is a way into someone's account, it is only allowed for people
 * whose access the caller could hand out themselves — never the owner, never oneself.
 */
router.post('/:userId/reset-password-link', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const targetUserId = req.params.userId;
        if (!isUuid(targetUserId)) throw notFound('Team member');
        await assertCanChangeUser(ctx, targetUserId);

        const member = await query(
            `SELECT DISTINCT u.id, u.email FROM user_roles ur JOIN users u ON u.id = ur.user_id
              WHERE ur.org_id = $1 AND ur.user_id = $2`,
            [ctx.orgId, targetUserId]
        );
        if (member.rows.length === 0) throw notFound('Team member');
        await assertCoversUser(ctx, targetUserId, `reset the password of ${member.rows[0].email}`);
        await assertResettableLogin(targetUserId, ctx.orgId, { allowTeamMemberHere: true });

        const token = newSecretToken();
        await query('DELETE FROM reset_tokens WHERE user_id = $1', [targetUserId]);
        await query(
            'INSERT INTO reset_tokens (token_hash, user_id, expires_at, org_id) VALUES ($1, $2, $3, $4)',
            [token.hash, targetUserId, new Date(Date.now() + 3600000).toISOString(), ctx.orgId]
        );

        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'TEAM_PASSWORD_RESET_LINK_CREATED',
            entityType: 'user', entityId: targetUserId, targetUserId, details: `Generated a password reset link for ${member.rows[0].email}`
        });

        res.json({
            success: true,
            data: { reset_link: `${publicBaseUrl()}/reset-password?token=${token.raw}` },
            message: 'Copy this link and share it with them yourself. It works once and expires in 1 hour.'
        });
    } catch (err) {
        sendError(res, err, 'TEAM RESET LINK ERROR');
    }
});

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

/** After a change: someone left with no access here at all has their sessions here ended straight away. */
async function endSessionsIfNoAccess(orgId: string, userId: string) {
    const res = await query(
        `SELECT (o.owner_user_id = $2
                 OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.org_id = o.id AND ur.user_id = $2)
                 OR EXISTS (SELECT 1 FROM employees e WHERE e.org_id = o.id AND e.user_id = $2 AND e.is_active = true)) AS has_access
           FROM organisations o WHERE o.id = $1`,
        [orgId, userId]
    );
    if (res.rows[0] && res.rows[0].has_access !== true) await revokeUserSessionsInOrganisation(userId, orgId);
}

/** POST /api/team/:userId/roles  { role_id, scope } — give an existing team member (or worker with a sign-in) another role. */
router.post('/:userId/roles', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const targetUserId = req.params.userId;
        if (!isUuid(targetUserId)) throw notFound('Person');
        await assertCanChangeUser(ctx, targetUserId);
        if (!(await isMemberOfOrganisation(ctx.orgId, targetUserId))) throw notFound('Person');

        const role = await loadRole(ctx.orgId, req.body?.role_id);
        assertAssignable(role);
        const scope = await readScope(ctx.orgId, req.body?.scope);
        assertScopeFitsRole(role, scope);
        await assertCovers(ctx, role.permissions, scope, `give ${role.name} to another person`);

        const duplicate = await query('SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2', [targetUserId, role.id]);
        if (duplicate.rows.length > 0) {
            throw new HttpError(409, 'ALREADY_ASSIGNED', `They already have the ${role.name} role. Change where it applies instead.`);
        }

        const id = crypto.randomUUID();
        await withTransaction(async (tx) => {
            await tx('INSERT INTO user_roles (id, org_id, user_id, role_id, scope_all, assigned_by) VALUES ($1, $2, $3, $4, $5, $6)',
                [id, ctx.orgId, targetUserId, role.id, scope.all, ctx.userId]);
            for (const branchId of scope.all ? [] : scope.branchIds) {
                await tx('INSERT INTO user_role_branches (user_role_id, org_id, location_id) VALUES ($1, $2, $3)', [id, ctx.orgId, branchId]);
            }
        });
        const named = await scopeWithNames(ctx.orgId, scope);
        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'ROLE_ASSIGNED', entityType: 'user_role', entityId: id, targetUserId,
            newValue: `${role.name}: ${scopeText(named)}`, details: `Gave the ${role.name} role (${scopeText(named)})`,
        });
        res.status(201).json({ success: true, data: { id }, message: `${role.name} role added.` });
    } catch (err) {
        sendError(res, err, 'ROLE ASSIGN ERROR');
    }
});

async function loadAssignment(ctx: AccessContext, userId: string, assignmentId: unknown) {
    if (!isUuid(assignmentId)) throw notFound('Role assignment');
    const found = (await assignmentsOf(ctx.orgId, userId)).find(a => a.id === assignmentId);
    if (!found) throw notFound('Role assignment');
    return found;
}

/** PUT /api/team/:userId/roles/:assignmentId  { scope } — change where a role applies. */
router.put('/:userId/roles/:assignmentId', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const targetUserId = req.params.userId;
        if (!isUuid(targetUserId)) throw notFound('Person');
        await assertCanChangeUser(ctx, targetUserId);
        const current = await loadAssignment(ctx, targetUserId, req.params.assignmentId);
        const role = await loadRole(ctx.orgId, current.roleId);
        assertAssignable(role);

        const scope = await readScope(ctx.orgId, req.body?.scope);
        assertScopeFitsRole(role, scope);
        // The caller must be able to administer both where the role applied and where it will apply.
        await assertCovers(ctx, role.permissions, current.scope, `change where ${role.name} applies`);
        await assertCovers(ctx, role.permissions, scope, `change where ${role.name} applies`);

        await withTransaction(async (tx) => {
            await tx('UPDATE user_roles SET scope_all = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3', [scope.all, current.id, ctx.orgId]);
            await tx('DELETE FROM user_role_branches WHERE user_role_id = $1', [current.id]);
            for (const branchId of scope.all ? [] : scope.branchIds) {
                await tx('INSERT INTO user_role_branches (user_role_id, org_id, location_id) VALUES ($1, $2, $3)', [current.id, ctx.orgId, branchId]);
            }
        });
        const [before, after] = await Promise.all([scopeWithNames(ctx.orgId, current.scope), scopeWithNames(ctx.orgId, scope)]);
        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'ROLE_SCOPE_CHANGED', entityType: 'user_role', entityId: current.id, targetUserId,
            previousValue: `${role.name}: ${scopeText(before)}`, newValue: `${role.name}: ${scopeText(after)}`,
            details: `Changed where ${role.name} applies`,
        });
        res.json({ success: true, message: 'Access updated.' });
    } catch (err) {
        sendError(res, err, 'ROLE SCOPE ERROR');
    }
});

/** DELETE /api/team/:userId/roles/:assignmentId — take a role away from someone. */
router.delete('/:userId/roles/:assignmentId', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const targetUserId = req.params.userId;
        if (!isUuid(targetUserId)) throw notFound('Person');
        await assertCanChangeUser(ctx, targetUserId);
        const current = await loadAssignment(ctx, targetUserId, req.params.assignmentId);
        await assertCovers(ctx, current.permissions, current.scope, `remove ${current.roleName}`);

        await query('DELETE FROM user_roles WHERE id = $1 AND org_id = $2', [current.id, ctx.orgId]);
        const before = await scopeWithNames(ctx.orgId, current.scope);
        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'ROLE_REMOVED', entityType: 'user_role', entityId: current.id, targetUserId,
            previousValue: `${current.roleName}: ${scopeText(before)}`, details: `Removed the ${current.roleName} role`,
        });
        await endSessionsIfNoAccess(ctx.orgId, targetUserId);
        res.json({ success: true, message: `${current.roleName} role removed.` });
    } catch (err) {
        sendError(res, err, 'ROLE REMOVE ERROR');
    }
});

/** DELETE /api/team/:userId — remove all of someone's roles here. Their account stays; workers keep their own employee sign-in. */
router.delete('/:userId', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const targetUserId = req.params.userId;
        if (!isUuid(targetUserId)) throw notFound('Person');
        await assertCanChangeUser(ctx, targetUserId);
        const assignments = await assignmentsOf(ctx.orgId, targetUserId);
        if (assignments.length === 0) throw notFound('Person');
        await assertCoversUser(ctx, targetUserId, 'remove all access');

        await query('DELETE FROM user_roles WHERE org_id = $1 AND user_id = $2', [ctx.orgId, targetUserId]);
        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'USER_ACCESS_REMOVED', entityType: 'user', entityId: targetUserId, targetUserId,
            previousValue: assignments.map(a => a.roleName).join(', '), details: `Removed ${assignments.length} role(s)`,
        });
        await endSessionsIfNoAccess(ctx.orgId, targetUserId);
        res.json({ success: true, message: 'Access removed.' });
    } catch (err) {
        sendError(res, err, 'TEAM REMOVE ERROR');
    }
});

export default router;
