import { Router, Response } from 'express';
import { query, withTransaction } from '../services/db';
import { comparePassword, hashPassword } from '../services/auth';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { badRequest, forbidden, isUuid, notFound, writeAudit } from '../services/policy';
import { revokeUserSessionsInOrganisation } from '../services/sessionService';
import { RateLimitedRequest, checkRateLimit, recordFailedAttempt, publicBaseUrl } from '../services/authUtils';
import { currentPortalLink, issuePortalLink, parseExpiry, resolvePortalToken } from '../services/portalLink';

const router = Router();

export const LINK_INVALID = { success: false, error: { code: 'LINK_INVALID', message: 'This sign-in link is not valid. Ask your manager for your organisation\'s sign-in link.' } };
export const LINK_EXPIRED = { success: false, error: { code: 'LINK_EXPIRED', message: 'This sign-in link has expired. Ask your manager for the new sign-in link.' } };

/**
 * GET /api/organisation/lookup/:slug  (public)
 * Lets the private sign-in page show which organisation it belongs to. Resolves by the token's
 * hash only and returns the organisation's name only — no ids, counts or settings. Unknown,
 * malformed and revoked links are one response; failures count towards the per-IP limit.
 */
router.get('/lookup/:slug', checkRateLimit, async (req: RateLimitedRequest, res: Response) => {
    try {
        const link = await resolvePortalToken(req.params.slug);
        if (link.status !== 'valid') {
            recordFailedAttempt(req.rateLimitKey);
            return link.status === 'expired' ? res.status(410).json(LINK_EXPIRED) : res.status(404).json(LINK_INVALID);
        }
        res.json({ success: true, data: { name: link.name } });
    } catch (err) {
        sendError(res, err, 'ORGANISATION LOOKUP ERROR');
    }
});

/** Organisation profile. Both roles can read it; only the Owner sees the private sign-in link. */
router.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const result = await query(
            `SELECT id, name,
                    break_mins_weekday, break_mins_weekend, break_threshold_hours,
                    employees_can_submit_timesheets, automatically_merge_leave_with_roster, leave_requests_require_approval,
                    roster_lock_password_hash IS NOT NULL AS has_roster_lock_password,
                    timesheet_lock_password_hash IS NOT NULL AS has_timesheet_lock_password
               FROM organisations WHERE id = $1`,
            [ctx.orgId]
        );
        const org = result.rows[0];
        const isOwner = ctx.role === 'OWNER';
        const link = isOwner ? await currentPortalLink(ctx.orgId) : null;

        res.json({
            success: true,
            data: {
                id: org.id,
                name: org.name,
                is_owner: isOwner,
                portal_slug: link?.token,
                portal_url: link ? `${publicBaseUrl()}${link.path}` : undefined,
                portal_link_expires_at: link?.expiresAt,
                portal_link_expired: link?.expired,
                break_mins_weekday: Number(org.break_mins_weekday ?? 30),
                break_mins_weekend: Number(org.break_mins_weekend ?? 0),
                break_threshold_hours: Number(org.break_threshold_hours ?? 6),
                employees_can_submit_timesheets: org.employees_can_submit_timesheets,
                automatically_merge_leave_with_roster: org.automatically_merge_leave_with_roster,
                leave_requests_require_approval: org.leave_requests_require_approval,
                has_roster_lock_password: org.has_roster_lock_password,
                has_timesheet_lock_password: org.has_timesheet_lock_password
            }
        });
    } catch (err) {
        sendError(res, err, 'ORGANISATION GET ERROR');
    }
});

/**
 * PUT /api/organisation/settings
 *
 * Two authorisation tiers in one route: the original organisation-wide fields (break rules,
 * name) stay Owner-only, exactly as `organisation.manage` always meant. The three workforce
 * booleans below them are policy toggles a Branch Admin also needs day-to-day, so they check
 * role directly instead — deliberately not via `Permission.ORGANISATION_MANAGE` (Owner-only)
 * or a new branch-scoped Permission (they are organisation-wide, not per-branch). Each tier is
 * checked before any update is built, so a Branch Admin can never smuggle an Owner-only field
 * into the same request as a workforce boolean.
 */
router.put('/settings', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const body = req.body || {};
        const updates: string[] = [];
        const params: any[] = [];

        const numeric: Array<[string, number, number]> = [
            ['break_mins_weekday', 0, 240],
            ['break_mins_weekend', 0, 240],
            ['break_threshold_hours', 0, 24],
        ];
        const ownerFieldsPresent = numeric.some(([field]) => body[field] !== undefined) || body.name !== undefined;
        if (ownerFieldsPresent && ctx.role !== 'OWNER') throw forbidden();

        const workforceBooleans = ['employees_can_submit_timesheets', 'automatically_merge_leave_with_roster', 'leave_requests_require_approval'];
        const workforceFieldsPresent = workforceBooleans.some(field => body[field] !== undefined);
        if (workforceFieldsPresent && ctx.role !== 'OWNER' && ctx.role !== 'BRANCH_ADMIN') throw forbidden();

        for (const [field, min, max] of numeric) {
            if (body[field] === undefined) continue;
            const value = Number(body[field]);
            if (!Number.isFinite(value) || value < min || value > max) {
                throw badRequest('VALIDATION_FAILED', `${field} must be between ${min} and ${max}.`);
            }
            params.push(value);
            updates.push(`${field} = $${params.length}`);
        }
        if (body.name !== undefined) {
            const name = typeof body.name === 'string' ? body.name.trim() : '';
            if (!name || name.length > 120) throw badRequest('VALIDATION_FAILED', 'Organisation name is required (120 characters at most).');
            params.push(name);
            updates.push(`name = $${params.length}`);
        }
        for (const field of workforceBooleans) {
            if (body[field] === undefined) continue;
            if (typeof body[field] !== 'boolean') throw badRequest('VALIDATION_FAILED', `${field} must be true or false.`);
            params.push(body[field]);
            updates.push(`${field} = $${params.length}`);
        }

        if (updates.length > 0) {
            params.push(ctx.orgId);
            await query(`UPDATE organisations SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
            await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'ORGANISATION_SETTINGS_UPDATED', entityType: 'organisation', entityId: ctx.orgId, details: `Updated: ${updates.map(u => u.split(' ')[0]).join(', ')}` });
        }
        res.json({ success: true, message: 'Settings saved successfully.' });
    } catch (err) {
        sendError(res, err, 'ORGANISATION SETTINGS ERROR');
    }
});

/**
 * POST /api/organisation/regenerate-portal-url  { expires_at?: ISO date | null }
 * Replaces the private sign-in link, optionally with an expiry. The previous link stops working
 * immediately (this is how a link is revoked).
 */
router.post('/regenerate-portal-url', requireAuth, requirePermission(Permission.SECURITY_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const expiresAt = parseExpiry(req.body?.expires_at) ?? null;
        const link = await issuePortalLink(ctx.orgId, expiresAt);
        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'PORTAL_URL_REGENERATED', entityType: 'organisation', entityId: ctx.orgId,
            details: `Private sign-in link regenerated${link.expiresAt ? `, expires ${link.expiresAt}` : ', no expiry'}`
        });
        res.json({
            success: true,
            data: { portal_slug: link.token, portal_url: `${publicBaseUrl()}${link.path}`, portal_link_expires_at: link.expiresAt },
            message: 'The sign-in link has been regenerated. The previous link no longer works.'
        });
    } catch (err) {
        sendError(res, err, 'REGENERATE PORTAL URL ERROR');
    }
});

/**
 * PUT /api/organisation/portal-link  { expires_at: ISO date | null }
 * Sets or clears the expiry of the current link without changing the link itself.
 */
router.put('/portal-link', requireAuth, requirePermission(Permission.SECURITY_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const expiresAt = parseExpiry(req.body?.expires_at);
        if (expiresAt === undefined) throw badRequest('VALIDATION_FAILED', 'Choose an expiry date, or none.');
        await query('UPDATE organisations SET portal_link_expires_at = $1 WHERE id = $2', [expiresAt ? expiresAt.toISOString() : null, ctx.orgId]);
        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'PORTAL_LINK_EXPIRY_CHANGED', entityType: 'organisation', entityId: ctx.orgId,
            newValue: expiresAt ? expiresAt.toISOString() : 'never'
        });
        res.json({
            success: true,
            data: { portal_link_expires_at: expiresAt ? expiresAt.toISOString() : null },
            message: expiresAt ? 'The sign-in link now has an expiry date.' : 'The sign-in link no longer expires.'
        });
    } catch (err) {
        sendError(res, err, 'PORTAL LINK EXPIRY ERROR');
    }
});

async function requireCurrentPassword(userId: string, password: unknown) {
    const userRes = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (typeof password !== 'string' || !password || !(await comparePassword(password, userRes.rows[0].password_hash))) {
        throw forbidden('Your current password is incorrect.');
    }
}

router.put('/lock-passwords', requireAuth, requirePermission(Permission.SECURITY_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { current_password, new_roster_lock_password, new_timesheet_lock_password } = req.body || {};
        await requireCurrentPassword(ctx.userId, current_password);

        const updates: string[] = [];
        const params: any[] = [];
        const fields: Array<[string, unknown]> = [
            ['roster_lock_password_hash', new_roster_lock_password],
            ['timesheet_lock_password_hash', new_timesheet_lock_password],
        ];
        for (const [column, value] of fields) {
            if (value === undefined) continue;
            if (value !== null && value !== '' && (typeof value !== 'string' || value.length < 4)) {
                throw badRequest('VALIDATION_FAILED', 'Lock passwords must be at least 4 characters.');
            }
            params.push(value ? await hashPassword(value as string) : null);
            updates.push(`${column} = $${params.length}`);
        }

        if (updates.length > 0) {
            params.push(ctx.orgId);
            await query(`UPDATE organisations SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
            await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'LOCK_PASSWORDS_UPDATED', entityType: 'organisation', entityId: ctx.orgId });
        }
        res.json({ success: true, message: 'Lock passwords updated successfully.' });
    } catch (err) {
        sendError(res, err, 'ORGANISATION LOCK PASSWORDS ERROR');
    }
});

/**
 * POST /api/organisation/transfer-ownership  { user_id, current_password }
 *
 * Owner only, with password re-entry. The new owner must already be a Branch Admin of this
 * organisation (an account that has accepted an invitation here). The outgoing owner keeps
 * working access as a Branch Admin of every active branch; the new owner can remove it.
 * An organisation therefore always has exactly one owner.
 */
router.post('/transfer-ownership', requireAuth, requirePermission(Permission.SECURITY_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { user_id, current_password } = req.body || {};
        await requireCurrentPassword(ctx.userId, current_password);
        if (!isUuid(user_id) || user_id === ctx.userId) throw badRequest('VALIDATION_FAILED', 'Choose a Branch Admin to become the new owner.');

        const target = await query(
            `SELECT u.id, u.email FROM users u
              WHERE u.id = $1 AND u.is_active = true
                AND EXISTS (SELECT 1 FROM branch_admins ba WHERE ba.user_id = u.id AND ba.org_id = $2)`,
            [user_id, ctx.orgId]
        );
        if (target.rows.length === 0) throw notFound('Branch Admin');

        await withTransaction(async (tx) => {
            const moved = await tx('UPDATE organisations SET owner_user_id = $1 WHERE id = $2 AND owner_user_id = $3 RETURNING id', [user_id, ctx.orgId, ctx.userId]);
            if (moved.rows.length === 0) throw forbidden();
            await tx('DELETE FROM branch_admins WHERE org_id = $1 AND user_id = $2', [ctx.orgId, user_id]);
            await tx(
                `INSERT INTO branch_admins (org_id, location_id, user_id, assigned_by)
                 SELECT org_id, id, $2, $3 FROM locations WHERE org_id = $1 AND is_active = true
                 ON CONFLICT (location_id, user_id) DO NOTHING`,
                [ctx.orgId, ctx.userId, user_id]
            );
        });

        await revokeUserSessionsInOrganisation(user_id, ctx.orgId);
        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'OWNERSHIP_TRANSFERRED', entityType: 'organisation', entityId: ctx.orgId,
            targetUserId: user_id, previousValue: ctx.email, newValue: target.rows[0].email
        });
        res.json({ success: true, message: `${target.rows[0].email} is now the organisation owner.` });
    } catch (err) {
        sendError(res, err, 'OWNERSHIP TRANSFER ERROR');
    }
});

export default router;
