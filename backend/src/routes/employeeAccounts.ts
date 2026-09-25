import { Router, Response } from 'express';
import crypto from 'crypto';
import { query, withTransaction } from '../services/db';
import { comparePassword, hashPassword } from '../services/auth';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { assertResettableLogin, resolveAccess, AccessContext, HttpError, badRequest, isUuid, loadWorker, notFound, writeAudit } from '../services/policy';
import { revokeUserSessionsInOrganisation } from '../services/sessionService';
import { sendTransactionalEmail, buildEmployeeInviteEmailTemplate, isEmailSendingEnabled } from '../services/emailService';
import { accountRateLimitKey, isRateLimited, TOO_MANY_ATTEMPTS,
    RateLimitedRequest, checkRateLimit, recordFailedAttempt, clearRateLimit,
    isStrongPassword, newSecretToken, publicBaseUrl, sha256Hex
} from '../services/authUtils';
import { usablePortalPath } from '../services/portalLink';

/**
 * Employee portal accounts.
 *
 * A worker (the `employees` table) is an operational record. It optionally gains an
 * employee-portal login via `employees.user_id` — one login per worker app-wide, enforced by a
 * partial unique index. Only the Organisation Owner or the worker's own Branch Admin may invite
 * or revoke it (the same `WORKERS_MANAGE` permission and branch scope that already governs
 * everything else about a worker).
 *
 * Modeled directly on branchAdmins.ts's invitation flow: the token is random, stored hashed,
 * expires after 7 days, is single use, and never creates a session — after accepting, the
 * person signs in normally through the organisation's private sign-in link. While email is
 * turned off, the link is handed back to the inviter to copy and share, exactly as branch admin
 * invitations already work.
 */

const router = Router();

const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const INVALID_INVITE = { success: false, error: { code: 'INVALID_INVITATION', message: 'This invitation is no longer valid. Ask your employer to send a new one.' } };

async function findOpenInvitation(rawToken: unknown) {
    if (typeof rawToken !== 'string' || !rawToken.trim()) return null;
    const res = await query(
        `SELECT i.*, o.name AS organisation_name, e.full_name AS employee_name
           FROM employee_invitations i
           JOIN organisations o ON o.id = i.org_id AND o.is_active = true
           JOIN employees e ON e.id = i.employee_id
          WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW()`,
        [sha256Hex(rawToken.trim())]
    );
    return res.rows[0] || null;
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
                employee_name: invitation.employee_name,
                account_exists: existing.rows.length > 0,
            }
        });
    } catch (err) {
        sendError(res, err, 'EMPLOYEE INVITATION VERIFY ERROR');
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

        const userRes = await query('SELECT id, password_hash, is_active FROM users WHERE LOWER(email) = $1', [invitation.email]);
        const existingUser = userRes.rows[0];
        let newPasswordHash: string | null = null;

        if (existingUser) {
            // The invitation attaches portal access to an existing account only once that account has authenticated.
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
            // One login maps to at most one worker record app-wide.
            const alreadyLinked = await query('SELECT 1 FROM employees WHERE user_id = $1', [existingUser.id]);
            if (alreadyLinked.rows.length > 0) {
                return res.status(409).json({ success: false, error: { code: 'ALREADY_LINKED', message: 'This account is already linked to a different worker record.' } });
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
                `UPDATE employee_invitations SET accepted_at = NOW()
                  WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
                  RETURNING id`,
                [invitation.id]
            );
            if (claim.rows.length === 0) return null;

            let userId: string = existingUser?.id;
            if (!userId) {
                userId = crypto.randomUUID();
                const name = typeof full_name === 'string' && full_name.trim() ? full_name.trim().slice(0, 120) : invitation.employee_name;
                await tx(
                    'INSERT INTO users (id, email, password_hash, full_name, is_active) VALUES ($1, $2, $3, $4, true)',
                    [userId, invitation.email, newPasswordHash, name || null]
                );
            }

            // NULL guard re-checks "not already linked" atomically (the earlier check has a TOCTOU gap).
            const linked = await tx('UPDATE employees SET user_id = $1 WHERE id = $2 AND user_id IS NULL RETURNING id', [userId, invitation.employee_id]);
            if (linked.rows.length === 0) return null;

            await tx('UPDATE employee_invitations SET accepted_user_id = $1 WHERE id = $2', [userId, invitation.id]);
            return userId;
        });

        if (!accepted) return res.status(400).json(INVALID_INVITE);
        clearRateLimit(req.rateLimitKey);

        await writeAudit({
            orgId: invitation.org_id, actorId: accepted, action: 'EMPLOYEE_INVITATION_ACCEPTED', entityType: 'employee_invitation',
            entityId: invitation.id, targetUserId: accepted,
        });

        // No session is issued here. The person signs in through the organisation's sign-in page.
        res.json({ success: true, data: { login_path: await usablePortalPath(invitation.org_id) }, message: 'Invitation accepted. You can now sign in.' });
    } catch (err) {
        sendError(res, err, 'EMPLOYEE INVITATION ACCEPT ERROR');
    }
});

// ---------------------------------------------------------------------------
// Management (Owner, or the worker's own Branch Admin) from here
// ---------------------------------------------------------------------------
router.use(requireAuth);

interface InvitationDelivery {
    delivered: boolean;
    /** The raw link, present only when email is off and the caller must copy it themselves. */
    link?: string;
}

/** Mirrors branchAdmins.ts's deliverInvitation exactly. */
async function deliverInvitation(invitationId: string, email: string, rawToken: string, organisationName: string): Promise<InvitationDelivery> {
    const link = `${publicBaseUrl()}/accept-employee-invite?token=${rawToken}`;
    if (!isEmailSendingEnabled()) {
        await query('UPDATE employee_invitations SET delivery_status = $1, last_error = NULL WHERE id = $2', ['link', invitationId]);
        return { delivered: true, link };
    }
    const template = buildEmployeeInviteEmailTemplate({ inviteLink: link, recipientEmail: email, organisationName });
    const result = await sendTransactionalEmail({ to: email, subject: template.subject, html: template.html, text: template.text });
    await query(
        'UPDATE employee_invitations SET delivery_status = $1, last_error = $2 WHERE id = $3',
        [result.success ? 'sent' : 'failed', result.success ? null : result.error || 'UNKNOWN', invitationId]
    );
    return { delivered: result.success };
}

router.post('/:employeeId/invitations', requirePermission(Permission.WORKERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const worker = await loadWorker(ctx, Permission.WORKERS_MANAGE, req.params.employeeId);
        if (!worker.is_active) throw badRequest('WORKER_INACTIVE', 'This worker is deactivated.');
        if (worker.user_id) throw new HttpError(409, 'ALREADY_LINKED', 'This worker already has portal access.');
        if (!worker.email) throw badRequest('VALIDATION_FAILED', 'This worker needs an email address before they can be invited.');

        const orgRes = await query('SELECT name FROM organisations WHERE id = $1', [ctx.orgId]);

        const token = newSecretToken();
        const invitationId = crypto.randomUUID();
        await withTransaction(async (tx) => {
            // One open invitation per worker: a new one replaces (revokes) the old link.
            await tx('UPDATE employee_invitations SET revoked_at = NOW() WHERE employee_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL', [worker.id]);
            await tx(
                `INSERT INTO employee_invitations (id, org_id, employee_id, email, token_hash, invited_by, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [invitationId, ctx.orgId, worker.id, worker.email, token.hash, ctx.userId, new Date(Date.now() + INVITE_LIFETIME_MS).toISOString()]
            );
        });

        const delivery = await deliverInvitation(invitationId, worker.email, token.raw, orgRes.rows[0].name);
        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'EMPLOYEE_INVITED', entityType: 'employee_invitation', entityId: invitationId,
            branchId: worker.location_id, details: delivery.link ? `Invited ${worker.email} (link copied, email is off)` : `Invited ${worker.email}`
        });

        res.status(201).json({
            success: true,
            data: {
                id: invitationId, email: worker.email,
                delivery_status: delivery.link ? 'link' : delivery.delivered ? 'sent' : 'failed',
                ...(delivery.link ? { invite_link: delivery.link } : {}),
            },
            message: delivery.link
                ? `Invitation created for ${worker.email}. Email is currently turned off — copy the link below and share it with them.`
                : delivery.delivered
                    ? `Invitation sent to ${worker.email}.`
                    : 'The invitation was created but the email could not be delivered.'
        });
    } catch (err) {
        sendError(res, err, 'EMPLOYEE INVITE ERROR');
    }
});

router.post('/:employeeId/invitations/resend', requirePermission(Permission.WORKERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const worker = await loadWorker(ctx, Permission.WORKERS_MANAGE, req.params.employeeId);

        const token = newSecretToken();
        const updated = await query(
            `UPDATE employee_invitations SET token_hash = $1, expires_at = $2
              WHERE employee_id = $3 AND accepted_at IS NULL AND revoked_at IS NULL
              RETURNING id, email`,
            [token.hash, new Date(Date.now() + INVITE_LIFETIME_MS).toISOString(), worker.id]
        );
        if (updated.rows.length === 0) throw notFound('Invitation');

        const orgRes = await query('SELECT name FROM organisations WHERE id = $1', [ctx.orgId]);
        const delivery = await deliverInvitation(updated.rows[0].id, updated.rows[0].email, token.raw, orgRes.rows[0].name);
        res.json({
            success: delivery.delivered,
            data: {
                delivery_status: delivery.link ? 'link' : delivery.delivered ? 'sent' : 'failed',
                ...(delivery.link ? { invite_link: delivery.link } : {}),
            },
            message: delivery.link ? 'The link was regenerated. Email is currently turned off — copy the new link below.' : delivery.delivered ? 'Invitation re-sent.' : 'The email could not be delivered.'
        });
    } catch (err) {
        sendError(res, err, 'EMPLOYEE INVITE RESEND ERROR');
    }
});

router.delete('/:employeeId/invitations', requirePermission(Permission.WORKERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const worker = await loadWorker(ctx, Permission.WORKERS_MANAGE, req.params.employeeId);
        const revoked = await query(
            'UPDATE employee_invitations SET revoked_at = NOW() WHERE employee_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id',
            [worker.id]
        );
        if (revoked.rows.length === 0) throw notFound('Invitation');
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'EMPLOYEE_INVITATION_REVOKED', entityType: 'employee_invitation', entityId: revoked.rows[0].id, branchId: worker.location_id });
        res.json({ success: true, message: 'Invitation revoked.' });
    } catch (err) {
        sendError(res, err, 'EMPLOYEE INVITE REVOKE ERROR');
    }
});

/**
 * POST /api/employee-accounts/:employeeId/reset-password-link
 * The no-email way for a locked-out employee to get back in. Mirrors branchAdmins.ts's version.
 */
router.post('/:employeeId/reset-password-link', requirePermission(Permission.WORKERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const worker = await loadWorker(ctx, Permission.WORKERS_MANAGE, req.params.employeeId);
        if (!worker.user_id) throw badRequest('NO_PORTAL_ACCESS', 'This worker does not have portal access yet.');
        await assertResettableLogin(worker.user_id, ctx.orgId, { allowBranchAdminHere: false });

        const token = newSecretToken();
        await query('DELETE FROM reset_tokens WHERE user_id = $1', [worker.user_id]);
        await query('INSERT INTO reset_tokens (token_hash, user_id, expires_at, org_id) VALUES ($1, $2, $3, $4)', [token.hash, worker.user_id, new Date(Date.now() + 3600000).toISOString(), ctx.orgId]);

        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'EMPLOYEE_PASSWORD_RESET_LINK_CREATED',
            entityType: 'employee', entityId: worker.id, targetUserId: worker.user_id, branchId: worker.location_id,
        });

        res.json({
            success: true,
            data: { reset_link: `${publicBaseUrl()}/reset-password?token=${token.raw}` },
            message: 'Copy this link and share it with them yourself. It works once and expires in 1 hour.'
        });
    } catch (err) {
        sendError(res, err, 'EMPLOYEE RESET LINK ERROR');
    }
});

/**
 * DELETE /api/employee-accounts/:employeeId
 * Revokes portal access without touching the worker record itself (roster/timesheet history,
 * name, branch, etc. are untouched — only the login link is removed).
 */
router.delete('/:employeeId', requirePermission(Permission.WORKERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const worker = await loadWorker(ctx, Permission.WORKERS_MANAGE, req.params.employeeId);
        if (!worker.user_id) throw notFound('Employee account');

        const userId = worker.user_id;
        await query('UPDATE employees SET user_id = NULL WHERE id = $1', [worker.id]);
        // Only end their sessions here if this worker link was their only access to the organisation —
        // removing portal access must never sign out the same login's Owner/Branch Admin sessions.
        if (!(await resolveAccess(userId, ctx.orgId))) await revokeUserSessionsInOrganisation(userId, ctx.orgId);

        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'EMPLOYEE_ACCOUNT_REVOKED', entityType: 'employee', entityId: worker.id, targetUserId: userId, branchId: worker.location_id });
        res.json({ success: true, message: 'Employee portal access removed.' });
    } catch (err) {
        sendError(res, err, 'EMPLOYEE ACCOUNT REVOKE ERROR');
    }
});

export default router;
