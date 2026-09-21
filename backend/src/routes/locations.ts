import { Router, Response } from 'express';
import crypto from 'crypto';
import { query, withTransaction } from '../services/db';
import { hashPassword, verifyToken } from '../services/auth';
import { validateSession } from '../services/sessionService';
import { requireAuth, requireTenantContext, requireOrgOwner, requireAnyPermission, Permission, AuthRequest } from '../middleware/auth';
import { sendTransactionalEmail } from '../services/emailService';

const router = Router();

/**
 * Public: Verify a location invitation token
 */
router.get(['/invitations/verify', '/verify-invite'], async (req: any, res: Response) => {
    try {
        const token = (req.query.token as string || '').trim();
        if (!token) {
            return res.status(400).json({ success: false, error: { message: 'Invitation token is required.' } });
        }

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const inviteRes = await query(
            `SELECT li.*, l.name as location_name, o.name as org_name, o.slug as org_slug, o.portal_slug
             FROM location_invitations li
             JOIN locations l ON li.location_id = l.id
             JOIN organisations o ON li.org_id = o.id
             WHERE li.token_hash = $1
             LIMIT 1`,
            [tokenHash]
        );

        if (inviteRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Invalid invitation token.' } });
        }

        const invite = inviteRes.rows[0];

        if (invite.accepted_at) {
            return res.status(400).json({ success: false, error: { code: 'INVITATION_ALREADY_ACCEPTED', message: 'This invitation has already been accepted.' } });
        }

        if (invite.cancelled_at) {
            return res.status(400).json({ success: false, error: { code: 'INVITATION_CANCELLED', message: 'This invitation has been revoked.' } });
        }

        if (new Date(invite.expires_at) < new Date()) {
            return res.status(400).json({ success: false, error: { code: 'INVITATION_EXPIRED', message: 'This invitation has expired.' } });
        }

        let userExists = false;
        let userName = null;
        try {
            const userRes = await query("SELECT id FROM users WHERE LOWER(email) = $1 AND password_hash IS NOT NULL AND password_hash <> 'PENDING_SETUP'", [invite.email.toLowerCase()]);
            userExists = userRes.rows.length > 0;
            if (userExists) {
                const empRes = await query('SELECT full_name FROM employees WHERE user_id = $1', [userRes.rows[0].id]);
                userName = empRes.rows[0]?.full_name || null;
            }
        } catch {}

        res.json({
            success: true,
            data: {
                email: invite.email,
                role: invite.role,
                location_name: invite.location_name,
                org_name: invite.org_name,
                org_slug: invite.portal_slug || invite.org_slug,
                user_exists: userExists,
                user_name: userName
            }
        });
    } catch (err: any) {
        console.error('[LOCATIONS VERIFY INVITE ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to verify invitation.' } });
    }
});

/**
 * Resolves the signed-in user from the Authorization header, requiring a live server session.
 * Returns null when the request is not authenticated.
 */
async function sessionUserFromRequest(req: any): Promise<{ id: string; email: string } | null> {
    const header = req.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) return null;
    let decoded: any;
    try {
        decoded = verifyToken(header.slice(7));
    } catch {
        return null;
    }
    if (!decoded?.id || !decoded?.session_id || decoded.scope === '2fa_pending') return null;
    const validation = await validateSession(decoded.session_id);
    if (!validation.valid || validation.session?.user_id !== decoded.id) return null;
    const userRes = await query('SELECT id, email FROM users WHERE id = $1 AND is_active = true', [decoded.id]);
    return userRes.rows[0] || null;
}

/**
 * Public: Accept a location invitation.
 *
 * Possessing the invitation token never authenticates anyone:
 * - If an account already exists for the invited email, the caller must already be signed in
 *   as that account (live session); otherwise 401 SIGN_IN_REQUIRED.
 * - If no usable account exists, the caller sets a password and must then sign in normally.
 * No login token is ever returned from this endpoint.
 */
router.post(['/invitations/accept', '/accept-invite'], async (req: any, res: Response) => {
    try {
        const { token, password } = req.body || {};
        if (!token || typeof token !== 'string') {
            return res.status(400).json({ success: false, error: { message: 'Invitation token is required.' } });
        }

        const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
        const inviteRes = await query(
            `SELECT li.*, l.name as location_name
             FROM location_invitations li
             JOIN locations l ON li.location_id = l.id AND l.org_id = li.org_id
             WHERE li.token_hash = $1
             LIMIT 1`,
            [tokenHash]
        );

        if (inviteRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Invalid invitation token.' } });
        }

        const invite = inviteRes.rows[0];

        if (invite.accepted_at) {
            return res.status(400).json({ success: false, error: { code: 'INVITATION_ALREADY_ACCEPTED', message: 'This invitation has already been accepted.' } });
        }
        if (invite.cancelled_at) {
            return res.status(400).json({ success: false, error: { code: 'INVITATION_CANCELLED', message: 'This invitation has been revoked.' } });
        }
        if (new Date(invite.expires_at) < new Date()) {
            return res.status(400).json({ success: false, error: { code: 'INVITATION_EXPIRED', message: 'This invitation has expired.' } });
        }

        const cleanEmail = invite.email.trim().toLowerCase();
        const existingUserRes = await query('SELECT id, password_hash FROM users WHERE LOWER(email) = $1', [cleanEmail]);
        const existingUser = existingUserRes.rows[0];
        const hasUsableAccount = Boolean(existingUser && existingUser.password_hash && existingUser.password_hash !== 'PENDING_SETUP');

        let targetUserId: string;
        let newPasswordHash: string | null = null;

        if (hasUsableAccount) {
            const sessionUser = await sessionUserFromRequest(req);
            if (!sessionUser) {
                return res.status(401).json({
                    success: false,
                    error: { code: 'SIGN_IN_REQUIRED', message: 'An account already exists for this email. Sign in to that account, then open the invitation link again.' }
                });
            }
            if (sessionUser.id !== existingUser.id) {
                return res.status(403).json({
                    success: false,
                    error: { code: 'INVITATION_EMAIL_MISMATCH', message: 'This invitation was sent to a different email address than the account you are signed in with.' }
                });
            }
            targetUserId = existingUser.id;
        } else {
            if (!password || typeof password !== 'string' || password.length < 8) {
                return res.status(400).json({ success: false, error: { message: 'A secure password of at least 8 characters is required.' } });
            }
            newPasswordHash = await hashPassword(password);
            targetUserId = existingUser ? existingUser.id : crypto.randomUUID();
        }

        const accepted = await withTransaction(async (tx) => {
            // Atomic single use: the first request to flip accepted_at wins.
            const claim = await tx(
                `UPDATE location_invitations SET accepted_at = NOW()
                 WHERE id = $1 AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at > NOW()
                 RETURNING id`,
                [invite.id]
            );
            if (claim.rows.length === 0) return false;

            const legacyOrgRole = invite.role === 'manager' ? 'Manager' : 'Employee';
            if (!existingUser) {
                await tx(
                    `INSERT INTO users (id, org_id, email, password_hash, role, is_active)
                     VALUES ($1, $2, $3, $4, $5, true)`,
                    [targetUserId, invite.org_id, cleanEmail, newPasswordHash, legacyOrgRole]
                );
            } else if (newPasswordHash) {
                await tx('UPDATE users SET password_hash = $1, is_active = true WHERE id = $2', [newPasswordHash, targetUserId]);
            }

            await tx(
                `INSERT INTO organisation_members (id, organisation_id, user_id, role)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (organisation_id, user_id) DO NOTHING`,
                [crypto.randomUUID(), invite.org_id, targetUserId, legacyOrgRole]
            );

            await tx(
                `INSERT INTO location_memberships (id, location_id, user_id, role, is_active)
                 VALUES ($1, $2, $3, $4, true)
                 ON CONFLICT (location_id, user_id) DO UPDATE SET role = EXCLUDED.role, is_active = true`,
                [crypto.randomUUID(), invite.location_id, targetUserId, invite.role]
            );

            await tx(
                `INSERT INTO audit_logs (id, org_id, location_id, timestamp, actor_id, action, entity_type, entity_id, details)
                 VALUES ($1, $2, $3, NOW(), $4, 'LOCATION_INVITATION_ACCEPTED', 'location_membership', $5, $6)`,
                [crypto.randomUUID(), invite.org_id, invite.location_id, targetUserId, invite.location_id,
                 `User ${cleanEmail} joined ${invite.location_name} as ${invite.role}`]
            );
            return true;
        });

        if (!accepted) {
            return res.status(400).json({ success: false, error: { code: 'INVITATION_NOT_AVAILABLE', message: 'This invitation is no longer available.' } });
        }

        res.json({
            success: true,
            data: { requires_sign_in: !hasUsableAccount, location_name: invite.location_name },
            message: hasUsableAccount
                ? `You have joined ${invite.location_name}.`
                : `Your account is ready. Sign in to continue.`
        });
    } catch (err: any) {
        console.error('[LOCATIONS ACCEPT INVITE ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to accept invitation.' } });
    }
});

// Authenticated Location Routes
router.use(requireAuth, requireTenantContext);

/**
 * GET /api/locations
 * Returns locations based on caller's role:
 * - Organisation Owner: all locations in the organization
 * - Location Manager / Employee: only locations where caller has membership
 */
router.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const userId = req.user?.id!;
        const includeInactive = req.query.include_inactive === 'true';

        // Check if caller is owner
        let isOwner = false;
        try {
            const orgCheck = await query('SELECT owner_user_id FROM organisations WHERE id = $1', [orgId]);
            if (orgCheck.rows[0]?.owner_user_id === userId || req.user?.role === 'Owner' || req.user?.role === 'Platform Admin') {
                isOwner = true;
            }
        } catch {}

        let locations: any[] = [];

        if (isOwner) {
            const sql = includeInactive
                ? 'SELECT * FROM locations WHERE org_id = $1 ORDER BY name ASC'
                : 'SELECT * FROM locations WHERE org_id = $1 AND is_active = true ORDER BY name ASC';
            const result = await query(sql, [orgId]);
            locations = result.rows;
        } else {
            // Location member: only locations assigned in location_memberships
            const result = await query(
                `SELECT l.*, lm.role as user_role
                 FROM locations l
                 JOIN location_memberships lm ON l.id = lm.location_id
                 WHERE l.org_id = $1 AND lm.user_id = $2 AND l.is_active = true AND lm.is_active = true
                 ORDER BY l.name ASC`,
                [orgId, userId]
            );
            locations = result.rows;
        }

        // Attach counts for each location
        for (const loc of locations) {
            try {
                const staffCountRes = await query(
                    'SELECT COUNT(*) as count FROM employees WHERE org_id = $1 AND location_id = $2 AND is_active = true AND deleted_at IS NULL',
                    [orgId, loc.id]
                );
                loc.active_staff_count = Number(staffCountRes.rows[0]?.count || 0);

                const managerRes = await query(
                    `SELECT u.id, u.email, lm.role
                     FROM location_memberships lm
                     JOIN users u ON lm.user_id = u.id
                     WHERE lm.location_id = $1 AND lm.role IN ('manager', 'admin') AND lm.is_active = true`,
                    [loc.id]
                );
                loc.managers = managerRes.rows;
            } catch {
                loc.active_staff_count = 0;
                loc.managers = [];
            }
        }

        res.json({
            success: true,
            data: locations
        });
    } catch (err: any) {
        console.error('[LOCATIONS LIST ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to retrieve locations.' } });
    }
});

/**
 * POST /api/locations
 * Create a new location (Organisation Owner only)
 */
router.post('/', requireAnyPermission([Permission.ORGANISATION_MANAGE_BRANCHES]), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const { name, address, timezone } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: { message: 'Location name is required.' } });
        }

        const trimmedName = name.trim();
        const existing = await query('SELECT id FROM locations WHERE org_id = $1 AND LOWER(name) = $2', [orgId, trimmedName.toLowerCase()]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ success: false, error: { message: `A location named "${trimmedName}" already exists.` } });
        }

        const locationId = crypto.randomUUID();
        const result = await query(
            `INSERT INTO locations (id, org_id, name, address, timezone, is_active)
             VALUES ($1, $2, $3, $4, $5, true)
             RETURNING *`,
            [locationId, orgId, trimmedName, address?.trim() || null, timezone?.trim() || 'Australia/Melbourne']
        );

        await query(
            `INSERT INTO audit_logs (id, org_id, location_id, timestamp, actor_id, action, entity_type, entity_id, details)
             VALUES ($1, $2, $3, NOW(), $4, 'LOCATION_CREATED', 'location', $3, $5)`,
            [crypto.randomUUID(), orgId, locationId, req.user?.id, `Created location "${trimmedName}"`]
        ).catch(() => {});

        res.status(201).json({
            success: true,
            data: result.rows[0],
            message: `Location "${trimmedName}" created successfully.`
        });
    } catch (err: any) {
        console.error('[LOCATION CREATE ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to create location.' } });
    }
});

/**
 * GET /api/locations/:id
 * Retrieve a specific location's details
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const userId = req.user?.id!;
        const locationId = req.params.id;

        const locRes = await query('SELECT * FROM locations WHERE id = $1 AND org_id = $2', [locationId, orgId]);
        if (locRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Location not found.' } });
        }

        // Check if user is owner or has membership
        let hasAccess = req.user?.role === 'Platform Admin';
        if (!hasAccess) {
            const orgCheck = await query('SELECT owner_user_id FROM organisations WHERE id = $1', [orgId]);
            if (orgCheck.rows[0]?.owner_user_id === userId || req.user?.role === 'Owner') {
                hasAccess = true;
            } else {
                const memCheck = await query('SELECT id FROM location_memberships WHERE location_id = $1 AND user_id = $2 AND is_active = true', [locationId, userId]);
                if (memCheck.rows.length > 0) {
                    hasAccess = true;
                }
            }
        }

        if (!hasAccess) {
            return res.status(403).json({ success: false, code: 'LOCATION_FORBIDDEN', message: 'You do not have permission to view this location.' });
        }

        res.json({ success: true, data: locRes.rows[0] });
    } catch (err: any) {
        console.error('[LOCATION GET ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to retrieve location.' } });
    }
});

/**
 * PUT /api/locations/:id
 * Update location details (Organisation Owner only)
 */
router.put('/:id', requireAnyPermission([Permission.ORGANISATION_MANAGE_BRANCHES, Permission.BRANCH_UPDATE], { branchParam: 'id' }), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const locationId = req.params.id;
        const { name, address, timezone } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: { message: 'Location name is required.' } });
        }

        const locRes = await query('SELECT id, name FROM locations WHERE id = $1 AND org_id = $2', [locationId, orgId]);
        if (locRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Location not found.' } });
        }

        const trimmedName = name.trim();
        const updated = await query(
            `UPDATE locations 
             SET name = $1, address = $2, timezone = $3, updated_at = NOW()
             WHERE id = $4 AND org_id = $5
             RETURNING *`,
            [trimmedName, address?.trim() || null, timezone?.trim() || 'Australia/Melbourne', locationId, orgId]
        );

        await query(
            `INSERT INTO audit_logs (id, org_id, location_id, timestamp, actor_id, action, entity_type, entity_id, details)
             VALUES ($1, $2, $3, NOW(), $4, 'LOCATION_UPDATED', 'location', $3, $5)`,
            [crypto.randomUUID(), orgId, locationId, req.user?.id, `Updated location "${trimmedName}"`]
        ).catch(() => {});

        res.json({
            success: true,
            data: updated.rows[0],
            message: 'Location updated successfully.'
        });
    } catch (err: any) {
        console.error('[LOCATION UPDATE ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to update location.' } });
    }
});

/**
 * POST /api/locations/:id/deactivate
 * Deactivates a location without deleting historical timesheets or rosters (Owner only)
 */
router.post('/:id/deactivate', requireOrgOwner, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const locationId = req.params.id;

        const locRes = await query('SELECT id, name, is_active FROM locations WHERE id = $1 AND org_id = $2', [locationId, orgId]);
        if (locRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Location not found.' } });
        }

        try {
            await query('UPDATE locations SET is_active = false, updated_at = NOW() WHERE id = $1 AND org_id = $2', [locationId, orgId]);
        } catch {
            await query('UPDATE locations SET is_active = false WHERE id = $1 AND org_id = $2', [locationId, orgId]);
        }

        await query(
            `INSERT INTO audit_logs (id, org_id, location_id, timestamp, actor_id, action, entity_type, entity_id, details)
             VALUES ($1, $2, $3, NOW(), $4, 'LOCATION_DEACTIVATED', 'location', $3, $5)`,
            [crypto.randomUUID(), orgId, locationId, req.user?.id, `Deactivated location "${locRes.rows[0].name}" (historical records preserved)`]
        ).catch(() => {});

        res.json({
            success: true,
            message: `Location "${locRes.rows[0].name}" has been deactivated. Historical records remain preserved.`
        });
    } catch (err: any) {
        console.error('[LOCATION DEACTIVATE ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to deactivate location.' } });
    }
});

/**
 * POST /api/locations/:id/reactivate
 * Reactivates an inactive location (Owner only)
 */
router.post('/:id/reactivate', requireOrgOwner, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const locationId = req.params.id;

        const locRes = await query('SELECT id, name FROM locations WHERE id = $1 AND org_id = $2', [locationId, orgId]);
        if (locRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Location not found.' } });
        }

        try {
            await query('UPDATE locations SET is_active = true, updated_at = NOW() WHERE id = $1 AND org_id = $2', [locationId, orgId]);
        } catch {
            await query('UPDATE locations SET is_active = true WHERE id = $1 AND org_id = $2', [locationId, orgId]);
        }

        await query(
            `INSERT INTO audit_logs (id, org_id, location_id, timestamp, actor_id, action, entity_type, entity_id, details)
             VALUES ($1, $2, $3, NOW(), $4, 'LOCATION_REACTIVATED', 'location', $3, $5)`,
            [crypto.randomUUID(), orgId, locationId, req.user?.id, `Reactivated location "${locRes.rows[0].name}"`]
        ).catch(() => {});

        res.json({
            success: true,
            message: `Location "${locRes.rows[0].name}" has been reactivated.`
        });
    } catch (err: any) {
        console.error('[LOCATION REACTIVATE ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to reactivate location.' } });
    }
});

/**
 * POST /api/locations/:id/invite
 * Invite a Location Manager or Staff Member (Owner only)
 */
router.post('/:id/invite', requireOrgOwner, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const locationId = req.params.id;
        const { email, role } = req.body;

        if (!email || !email.trim() || !email.includes('@')) {
            return res.status(400).json({ success: false, error: { message: 'Valid email is required.' } });
        }

        const assignRole = role === 'admin' ? 'admin' : role === 'employee' ? 'employee' : 'manager';

        const locRes = await query('SELECT id, name FROM locations WHERE id = $1 AND org_id = $2', [locationId, orgId]);
        if (locRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Location not found.' } });
        }
        const location = locRes.rows[0];

        const orgRes = await query('SELECT name, portal_slug, slug FROM organisations WHERE id = $1', [orgId]);
        const orgName = orgRes.rows[0]?.name || 'SimpleHours Workspace';

        const cleanEmail = email.trim().toLowerCase();
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

        const inviteId = crypto.randomUUID();
        try {
            await query(
                `INSERT INTO location_invitations (id, org_id, location_id, email, role, token, token_hash, created_by, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [inviteId, orgId, locationId, cleanEmail, assignRole, token, tokenHash, req.user?.id, expiresAt]
            );
        } catch {
            await query(
                `INSERT INTO location_invitations (id, org_id, location_id, email, role, token, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [inviteId, orgId, locationId, cleanEmail, assignRole, token, expiresAt]
            );
        }

        const origin = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:3001';
        const inviteUrl = `${origin}/accept-location-invite?token=${token}`;

        // Send invitation email
        let deliveryStatus = 'sent';
        let emailError: string | null = null;

        const emailResult = await sendTransactionalEmail({
            to: cleanEmail,
            subject: `You have been invited to manage ${location.name} on SimpleHours`,
            html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1e293b;">
                    <h2 style="color: #0f172a; margin-bottom: 12px;">Workforce Invitation</h2>
                    <p style="font-size: 15px; line-height: 1.5; color: #475569;">
                        You have been invited to join <strong>${orgName}</strong> as a <strong>${assignRole}</strong> for <strong>${location.name}</strong>.
                    </p>
                    <div style="margin: 28px 0;">
                        <a href="${inviteUrl}" style="background: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">
                            Accept Invitation & Set Up Account
                        </a>
                    </div>
                    <p style="font-size: 13px; color: #94a3b8;">
                        This invitation link is single-use and will expire in 7 days. If you did not expect this invitation, you can safely ignore this email.
                    </p>
                </div>
            `,
            text: `You have been invited to join ${orgName} as a ${assignRole} for ${location.name}.\n\nAccept invitation: ${inviteUrl}\n\nThis link expires in 7 days.`
        });

        if (!emailResult.success) {
            deliveryStatus = 'failed';
            emailError = emailResult.error || 'Failed to dispatch email';
            await query('UPDATE location_invitations SET delivery_status = $1, last_error = $2 WHERE id = $3', ['failed', emailError, inviteId]).catch(() => {});
        } else {
            await query('UPDATE location_invitations SET delivery_status = $1 WHERE id = $2', ['delivered', inviteId]).catch(() => {});
        }

        await query(
            `INSERT INTO audit_logs (id, org_id, location_id, timestamp, actor_id, action, entity_type, entity_id, details)
             VALUES ($1, $2, $3, NOW(), $4, 'LOCATION_MANAGER_INVITED', 'location_invitation', $5, $6)`,
            [crypto.randomUUID(), orgId, locationId, req.user?.id, inviteId, `Invited ${cleanEmail} to ${location.name} as ${assignRole}`]
        ).catch(() => {});

        res.status(200).json({
            success: true,
            data: {
                invite_id: inviteId,
                email: cleanEmail,
                role: assignRole,
                location_name: location.name,
                delivery_status: deliveryStatus
            },
            message: deliveryStatus === 'delivered' || deliveryStatus === 'sent'
                ? `Invitation sent to ${cleanEmail}.`
                : `Invitation created, but the email could not be delivered. Please try again later.`
        });
    } catch (err: any) {
        console.error('[LOCATION INVITE ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to invite manager.' } });
    }
});

/**
 * GET /api/locations/:id/invitations
 * View pending invitations for a location
 */
router.get('/:id/invitations', requireOrgOwner, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const locationId = req.params.id;

        const result = await query(
            `SELECT id, email, role, delivery_status, expires_at, created_at, accepted_at, cancelled_at
             FROM location_invitations
             WHERE org_id = $1 AND location_id = $2
             ORDER BY created_at DESC`,
            [orgId, locationId]
        );

        res.json({ success: true, data: result.rows });
    } catch (err: any) {
        console.error('[LOCATION GET INVITATIONS ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to list invitations.' } });
    }
});

export default router;
