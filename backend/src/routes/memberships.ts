import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import {
    requireAuth,
    requireTenantContext,
    requirePermission,
    AuthRequest,
    Permission,
    OrgRole,
    BranchRole
} from '../middleware/auth';
import {
    normalizeOrgRole,
    normalizeBranchRole,
    logSecurityAuditEvent
} from '../services/permissionService';

const router = Router();

// =========================================================================
// ORGANISATION MEMBERSHIP ENDPOINTS
// =========================================================================

/**
 * GET /api/organisation/members
 * List all members of the current organisation, their organisation-level role,
 * and their assigned branch memberships.
 */
router.get(
    '/organisation/members',
    requireAuth,
    requireTenantContext,
    requirePermission(Permission.ORGANISATION_VIEW),
    async (req: AuthRequest, res: Response) => {
        try {
            const orgId = req.user?.organisation_id!;

            // Fetch organisation members joined with user accounts
            const membersRes = await query(
                `SELECT om.id as membership_id, om.user_id, om.role as org_role, om.is_active,
                        u.email, u.is_active as user_active,
                        e.full_name, e.department
                 FROM organisation_members om
                 JOIN users u ON om.user_id = u.id
                 LEFT JOIN employees e ON e.user_id = u.id AND e.org_id = $1 AND e.deleted_at IS NULL
                 WHERE om.organisation_id = $1
                 ORDER BY om.created_at ASC`,
                [orgId]
            );

            // Fetch all branch memberships in this organisation
            const branchMemRes = await query(
                `SELECT lm.user_id, lm.location_id, lm.role as branch_role, lm.is_active,
                        l.name as branch_name
                 FROM location_memberships lm
                 JOIN locations l ON lm.location_id = l.id
                 WHERE l.org_id = $1 AND (lm.is_active = true OR lm.is_active IS NULL)
                 ORDER BY l.name ASC`,
                [orgId]
            );

            const branchMap = new Map<string, any[]>();
            for (const bm of branchMemRes.rows) {
                const list = branchMap.get(bm.user_id) || [];
                list.push({
                    branch_id: bm.location_id,
                    branch_name: bm.branch_name,
                    role: normalizeBranchRole(bm.branch_role) || bm.branch_role,
                    is_active: bm.is_active !== false,
                });
                branchMap.set(bm.user_id, list);
            }

            const data = membersRes.rows.map((m: any) => ({
                membership_id: m.membership_id,
                user_id: m.user_id,
                email: m.email,
                full_name: m.full_name || m.email.split('@')[0],
                department: m.department || null,
                organisation_role: normalizeOrgRole(m.org_role) || m.org_role,
                is_active: m.is_active !== false && m.user_active !== false,
                branches: branchMap.get(m.user_id) || [],
            }));

            res.json({ success: true, data });
        } catch (err: any) {
            console.error('[GET ORG MEMBERS ERROR]', err);
            res.status(500).json({ success: false, error: { message: 'Failed to retrieve organisation members.' } });
        }
    }
);

/**
 * POST /api/organisation/members/invite
 * Invite a user to the organisation with a specified organisation role.
 * Anti-Privilege Escalation:
 * - Requires ORGANISATION_MANAGE_USERS.
 * - Caller cannot assign a role higher than their own.
 */
router.post(
    '/organisation/members/invite',
    requireAuth,
    requireTenantContext,
    requirePermission(Permission.ORGANISATION_MANAGE_USERS),
    async (req: AuthRequest, res: Response) => {
        try {
            const orgId = req.user?.organisation_id!;
            const actorId = req.user?.id!;
            const { email, role } = req.body;

            if (!email || !email.trim() || !email.includes('@')) {
                return res.status(400).json({ success: false, error: { message: 'A valid email is required.' } });
            }

            const cleanEmail = email.trim().toLowerCase();
            const targetRole = normalizeOrgRole(role) || OrgRole.ORG_MANAGER;

            // Privilege check: cannot assign OWNER unless caller is OWNER or Platform Admin
            const callerOrgRole = req.securityContext?.orgRole;
            if (targetRole === OrgRole.OWNER && callerOrgRole !== OrgRole.OWNER && !req.securityContext?.isPlatformAdmin) {
                return res.status(403).json({
                    success: false,
                    code: 'PRIVILEGE_ESCALATION_DENIED',
                    error: { message: 'Only an organisation owner can invite or appoint another owner.' }
                });
            }

            // Find or create user
            let targetUserId: string;
            const existingUser = await query('SELECT id FROM users WHERE LOWER(email) = $1', [cleanEmail]);

            if (existingUser.rows.length > 0) {
                targetUserId = existingUser.rows[0].id;
            } else {
                targetUserId = crypto.randomUUID();
                await query(
                    `INSERT INTO users (id, org_id, email, password_hash, role, is_active)
                     VALUES ($1, $2, $3, 'PENDING_SETUP', $4, true)`,
                    [targetUserId, orgId, cleanEmail, targetRole]
                );
            }

            // Add or update organisation membership
            const existingMem = await query(
                'SELECT id, role FROM organisation_members WHERE organisation_id = $1 AND user_id = $2',
                [orgId, targetUserId]
            );

            let prevRole: string | null = null;
            if (existingMem.rows.length > 0) {
                prevRole = existingMem.rows[0].role;
                await query(
                    'UPDATE organisation_members SET role = $1, is_active = true WHERE organisation_id = $2 AND user_id = $3',
                    [targetRole, orgId, targetUserId]
                );
            } else {
                await query(
                    `INSERT INTO organisation_members (id, organisation_id, user_id, role, is_active)
                     VALUES ($1, $2, $3, $4, true)`,
                    [crypto.randomUUID(), orgId, targetUserId, targetRole]
                );
            }

            // Audit log
            await logSecurityAuditEvent({
                actorId,
                orgId,
                action: 'USER_INVITED',
                targetUserId,
                previousValue: prevRole,
                newValue: targetRole,
                details: `Invited/assigned ${cleanEmail} as ${targetRole}`
            });

            res.status(201).json({
                success: true,
                data: {
                    user_id: targetUserId,
                    email: cleanEmail,
                    role: targetRole
                },
                message: `User ${cleanEmail} has been granted organisation role ${targetRole}.`
            });
        } catch (err: any) {
            console.error('[INVITE ORG MEMBER ERROR]', err);
            res.status(500).json({ success: false, error: { message: 'Failed to invite organisation member.' } });
        }
    }
);

/**
 * PUT /api/organisation/members/:userId/role
 * Change a user's organisation-level role.
 * Anti-Privilege Escalation:
 * - A user CANNOT change their own role.
 * - Non-owners cannot promote someone to OWNER.
 * - Non-owners cannot modify an existing OWNER's role.
 */
router.put(
    '/organisation/members/:userId/role',
    requireAuth,
    requireTenantContext,
    requirePermission(Permission.ORGANISATION_MANAGE_USERS),
    async (req: AuthRequest, res: Response) => {
        try {
            const orgId = req.user?.organisation_id!;
            const actorId = req.user?.id!;
            const targetUserId = req.params.userId as string;
            const { role } = req.body;

            // Self-modification protection
            if (actorId === targetUserId) {
                return res.status(403).json({
                    success: false,
                    code: 'SELF_ESCALATION_PROHIBITED',
                    error: { message: 'You cannot modify your own organisation role.' }
                });
            }

            const newRole = normalizeOrgRole(role);
            if (!newRole) {
                return res.status(400).json({ success: false, error: { message: 'Valid organisation role is required (OWNER, ORG_ADMIN, ORG_MANAGER).' } });
            }

            const callerOrgRole = req.securityContext?.orgRole;
            const isPlatformAdmin = req.securityContext?.isPlatformAdmin;

            // Prevent non-owners from assigning OWNER
            if (newRole === OrgRole.OWNER && callerOrgRole !== OrgRole.OWNER && !isPlatformAdmin) {
                return res.status(403).json({
                    success: false,
                    code: 'PRIVILEGE_ESCALATION_DENIED',
                    error: { message: 'Only an organisation owner can grant the OWNER role.' }
                });
            }

            // Check existing target membership
            const targetMem = await query(
                'SELECT id, role FROM organisation_members WHERE organisation_id = $1 AND user_id = $2',
                [orgId, targetUserId]
            );

            if (targetMem.rows.length === 0) {
                return res.status(404).json({ success: false, error: { message: 'User is not a member of this organisation.' } });
            }

            const prevRole = targetMem.rows[0].role;
            const normPrevRole = normalizeOrgRole(prevRole);

            // Prevent modifying an OWNER if caller is not an OWNER or Platform Admin
            if (normPrevRole === OrgRole.OWNER && callerOrgRole !== OrgRole.OWNER && !isPlatformAdmin) {
                return res.status(403).json({
                    success: false,
                    code: 'INSUFFICIENT_HIERARCHY',
                    error: { message: 'Only an owner can modify another owner.' }
                });
            }

            // Update membership role
            await query(
                'UPDATE organisation_members SET role = $1, is_active = true WHERE organisation_id = $2 AND user_id = $3',
                [newRole, orgId, targetUserId]
            );

            // Audit log
            await logSecurityAuditEvent({
                actorId,
                orgId,
                action: 'ORG_ROLE_CHANGED',
                targetUserId,
                previousValue: prevRole,
                newValue: newRole,
                details: `Changed organisation role for user ${targetUserId} from ${prevRole} to ${newRole}`
            });

            res.json({
                success: true,
                data: {
                    user_id: targetUserId,
                    organisation_role: newRole,
                    previous_role: prevRole
                },
                message: `Organisation role updated to ${newRole}.`
            });
        } catch (err: any) {
            console.error('[UPDATE ORG MEMBER ROLE ERROR]', err);
            res.status(500).json({ success: false, error: { message: 'Failed to update organisation role.' } });
        }
    }
);

/**
 * DELETE /api/organisation/members/:userId
 * Remove a user from the organisation and revoke all branch access in this tenant.
 * Anti-Privilege Escalation:
 * - A user CANNOT remove themselves.
 * - The primary organisation owner CANNOT be removed.
 */
router.delete(
    '/organisation/members/:userId',
    requireAuth,
    requireTenantContext,
    requirePermission(Permission.ORGANISATION_MANAGE_USERS),
    async (req: AuthRequest, res: Response) => {
        try {
            const orgId = req.user?.organisation_id!;
            const actorId = req.user?.id!;
            const targetUserId = req.params.userId as string;

            // Self-removal protection
            if (actorId === targetUserId) {
                return res.status(403).json({
                    success: false,
                    code: 'SELF_REMOVAL_PROHIBITED',
                    error: { message: 'You cannot remove your own organisation membership.' }
                });
            }

            // Check if user is primary owner
            const orgCheck = await query('SELECT owner_user_id FROM organisations WHERE id = $1', [orgId]);
            if (orgCheck.rows[0]?.owner_user_id === targetUserId) {
                return res.status(403).json({
                    success: false,
                    code: 'OWNER_REMOVAL_PROHIBITED',
                    error: { message: 'The primary organisation owner cannot be removed.' }
                });
            }

            const memCheck = await query(
                'SELECT role FROM organisation_members WHERE organisation_id = $1 AND user_id = $2',
                [orgId, targetUserId]
            );

            if (memCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: { message: 'User is not a member of this organisation.' } });
            }

            const prevRole = memCheck.rows[0].role;

            // 1. Delete from organisation_members
            await query('DELETE FROM organisation_members WHERE organisation_id = $1 AND user_id = $2', [orgId, targetUserId]);

            // 2. Revoke all branch memberships in this organisation
            await query(
                `DELETE FROM location_memberships
                 WHERE user_id = $1 AND location_id IN (SELECT id FROM locations WHERE org_id = $2)`,
                [targetUserId, orgId]
            );

            // 3. Revoke active sessions for this user in this tenant
            await query('UPDATE sessions SET is_active = false, revoked_at = NOW() WHERE user_id = $1 AND org_id = $2', [targetUserId, orgId]);

            // Audit log
            await logSecurityAuditEvent({
                actorId,
                orgId,
                action: 'USER_REMOVED',
                targetUserId,
                previousValue: prevRole,
                newValue: null,
                details: `Removed user ${targetUserId} from organisation ${orgId}`
            });

            res.json({
                success: true,
                message: 'User has been removed from the organisation and all associated branches.'
            });
        } catch (err: any) {
            console.error('[REMOVE ORG MEMBER ERROR]', err);
            res.status(500).json({ success: false, error: { message: 'Failed to remove organisation member.' } });
        }
    }
);

// =========================================================================
// BRANCH MEMBERSHIP ENDPOINTS
// =========================================================================

/**
 * GET /api/locations/:id/members
 * List all users holding memberships in the specified branch.
 */
router.get(
    '/locations/:id/members',
    requireAuth,
    requireTenantContext,
    requirePermission(Permission.BRANCH_VIEW),
    async (req: AuthRequest, res: Response) => {
        try {
            const orgId = req.user?.organisation_id!;
            const locationId = req.params.id as string;

            // Verify location exists in tenant
            const locCheck = await query('SELECT id, name FROM locations WHERE id = $1 AND org_id = $2', [locationId, orgId]);
            if (locCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: { message: 'Location not found in this organisation.' } });
            }

            const membersRes = await query(
                `SELECT lm.id as membership_id, lm.user_id, lm.role as branch_role, lm.is_active, lm.created_at,
                        u.email, u.is_active as user_active,
                        e.full_name, e.department
                 FROM location_memberships lm
                 JOIN users u ON lm.user_id = u.id
                 LEFT JOIN employees e ON e.user_id = u.id AND e.org_id = $1 AND e.deleted_at IS NULL
                 WHERE lm.location_id = $2 AND (lm.is_active = true OR lm.is_active IS NULL)
                 ORDER BY lm.created_at ASC`,
                [orgId, locationId]
            );

            const data = membersRes.rows.map((m: any) => ({
                membership_id: m.membership_id,
                user_id: m.user_id,
                email: m.email,
                full_name: m.full_name || m.email.split('@')[0],
                department: m.department || null,
                branch_role: normalizeBranchRole(m.branch_role) || m.branch_role,
                is_active: m.is_active !== false && m.user_active !== false,
            }));

            res.json({ success: true, data });
        } catch (err: any) {
            console.error('[GET BRANCH MEMBERS ERROR]', err);
            res.status(500).json({ success: false, error: { message: 'Failed to retrieve branch members.' } });
        }
    }
);

/**
 * POST /api/locations/:id/members
 * Assign a user to a branch with a branch role (BRANCH_ADMIN, BRANCH_MANAGER, EMPLOYEE).
 * Anti-Privilege Escalation:
 * - Requires BRANCH_MANAGE_USERS (or ORGANISATION_MANAGE_USERS).
 * - A user CANNOT assign themselves to another branch.
 * - Target user must be a member of the organisation.
 */
router.post(
    '/locations/:id/members',
    requireAuth,
    requireTenantContext,
    async (req: AuthRequest, res: Response) => {
        try {
            const orgId = req.user?.organisation_id!;
            const actorId = req.user?.id!;
            const locationId = req.params.id as string;
            const { user_id, role } = req.body;

            if (!user_id) {
                return res.status(400).json({ success: false, error: { message: 'user_id is required.' } });
            }

            // Self-assignment protection: users cannot add themselves to branches
            if (actorId === user_id && !req.securityContext?.isPlatformAdmin && req.securityContext?.orgRole !== OrgRole.OWNER) {
                return res.status(403).json({
                    success: false,
                    code: 'SELF_ASSIGNMENT_PROHIBITED',
                    error: { message: 'You cannot assign yourself to another branch.' }
                });
            }

            // Verify permission: requires BRANCH_MANAGE_USERS in target location or ORGANISATION_MANAGE_USERS
            const canManageOrgUsers = req.securityContext?.effectivePermissions.has(Permission.ORGANISATION_MANAGE_USERS);
            const userBranchMembership = req.securityContext?.branchMemberships.find(bm => bm.branchId === locationId && bm.isActive);
            const canManageBranchUsers = userBranchMembership?.role === BranchRole.BRANCH_ADMIN;

            if (!canManageOrgUsers && !canManageBranchUsers && !req.securityContext?.isPlatformAdmin) {
                return res.status(403).json({
                    success: false,
                    code: 'INSUFFICIENT_BRANCH_PERMISSIONS',
                    error: { message: 'You do not have permission to manage users for this branch.' }
                });
            }

            // Verify location belongs to organisation
            const locCheck = await query('SELECT id, name FROM locations WHERE id = $1 AND org_id = $2', [locationId, orgId]);
            if (locCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: { message: 'Location not found in this organisation.' } });
            }

            // Verify target user belongs to this organisation
            const orgMemCheck = await query(
                'SELECT id FROM organisation_members WHERE organisation_id = $1 AND user_id = $2',
                [orgId, user_id]
            );
            if (orgMemCheck.rows.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: { message: 'Target user does not belong to this organisation. Invite them to the organisation first.' }
                });
            }

            const assignRole = normalizeBranchRole(role) || BranchRole.BRANCH_MANAGER;

            // Check if membership already exists
            const existingLocMem = await query(
                'SELECT id, role FROM location_memberships WHERE location_id = $1 AND user_id = $2',
                [locationId, user_id]
            );

            let prevRole: string | null = null;
            if (existingLocMem.rows.length > 0) {
                prevRole = existingLocMem.rows[0].role;
                await query(
                    'UPDATE location_memberships SET role = $1, is_active = true WHERE location_id = $2 AND user_id = $3',
                    [assignRole, locationId, user_id]
                );
            } else {
                await query(
                    `INSERT INTO location_memberships (id, location_id, user_id, role, is_active)
                     VALUES ($1, $2, $3, $4, true)`,
                    [crypto.randomUUID(), locationId, user_id, assignRole]
                );
            }

            // Audit log
            await logSecurityAuditEvent({
                actorId,
                orgId,
                action: 'BRANCH_ACCESS_GRANTED',
                targetUserId: user_id,
                branchId: locationId,
                previousValue: prevRole,
                newValue: assignRole,
                details: `Assigned user ${user_id} to branch ${locCheck.rows[0].name} (${locationId}) as ${assignRole}`
            });

            res.status(201).json({
                success: true,
                data: {
                    location_id: locationId,
                    user_id,
                    branch_role: assignRole
                },
                message: `User has been assigned to ${locCheck.rows[0].name} as ${assignRole}.`
            });
        } catch (err: any) {
            console.error('[ASSIGN BRANCH MEMBER ERROR]', err);
            res.status(500).json({ success: false, error: { message: 'Failed to assign branch membership.' } });
        }
    }
);

/**
 * PUT /api/locations/:id/members/:userId
 * Update a user's branch role within a specified branch.
 * Anti-Privilege Escalation:
 * - A user CANNOT modify their own branch role.
 */
router.put(
    '/locations/:id/members/:userId',
    requireAuth,
    requireTenantContext,
    async (req: AuthRequest, res: Response) => {
        try {
            const orgId = req.user?.organisation_id!;
            const actorId = req.user?.id!;
            const locationId = req.params.id as string;
            const targetUserId = req.params.userId as string;
            const { role } = req.body;

            // Self-modification protection
            if (actorId === targetUserId) {
                return res.status(403).json({
                    success: false,
                    code: 'SELF_ESCALATION_PROHIBITED',
                    error: { message: 'You cannot modify your own branch role.' }
                });
            }

            // Permission check: requires BRANCH_MANAGE_USERS in target location or ORGANISATION_MANAGE_USERS
            const canManageOrgUsers = req.securityContext?.effectivePermissions.has(Permission.ORGANISATION_MANAGE_USERS);
            const userBranchMembership = req.securityContext?.branchMemberships.find(bm => bm.branchId === locationId && bm.isActive);
            const canManageBranchUsers = userBranchMembership?.role === BranchRole.BRANCH_ADMIN;

            if (!canManageOrgUsers && !canManageBranchUsers && !req.securityContext?.isPlatformAdmin) {
                return res.status(403).json({
                    success: false,
                    code: 'INSUFFICIENT_BRANCH_PERMISSIONS',
                    error: { message: 'You do not have permission to manage users for this branch.' }
                });
            }

            const targetRole = normalizeBranchRole(role);
            if (!targetRole) {
                return res.status(400).json({ success: false, error: { message: 'Valid branch role is required (BRANCH_ADMIN, BRANCH_MANAGER, EMPLOYEE).' } });
            }

            // Verify membership exists
            const existingLocMem = await query(
                'SELECT id, role FROM location_memberships WHERE location_id = $1 AND user_id = $2',
                [locationId, targetUserId]
            );

            if (existingLocMem.rows.length === 0) {
                return res.status(404).json({ success: false, error: { message: 'User does not hold membership in this branch.' } });
            }

            const prevRole = existingLocMem.rows[0].role;

            await query(
                'UPDATE location_memberships SET role = $1, is_active = true WHERE location_id = $2 AND user_id = $3',
                [targetRole, locationId, targetUserId]
            );

            // Audit log
            await logSecurityAuditEvent({
                actorId,
                orgId,
                action: 'BRANCH_ROLE_CHANGED',
                targetUserId,
                branchId: locationId,
                previousValue: prevRole,
                newValue: targetRole,
                details: `Updated branch role for user ${targetUserId} in branch ${locationId} from ${prevRole} to ${targetRole}`
            });

            res.json({
                success: true,
                data: {
                    location_id: locationId,
                    user_id: targetUserId,
                    branch_role: targetRole,
                    previous_role: prevRole
                },
                message: `Branch role updated to ${targetRole}.`
            });
        } catch (err: any) {
            console.error('[UPDATE BRANCH ROLE ERROR]', err);
            res.status(500).json({ success: false, error: { message: 'Failed to update branch role.' } });
        }
    }
);

/**
 * DELETE /api/locations/:id/members/:userId
 * Revoke a user's access to a branch.
 * Anti-Privilege Escalation:
 * - A user CANNOT revoke their own branch membership.
 */
router.delete(
    '/locations/:id/members/:userId',
    requireAuth,
    requireTenantContext,
    async (req: AuthRequest, res: Response) => {
        try {
            const orgId = req.user?.organisation_id!;
            const actorId = req.user?.id!;
            const locationId = req.params.id as string;
            const targetUserId = req.params.userId as string;

            // Self-revocation protection
            if (actorId === targetUserId) {
                return res.status(403).json({
                    success: false,
                    code: 'SELF_REVOCATION_PROHIBITED',
                    error: { message: 'You cannot revoke your own branch membership.' }
                });
            }

            // Permission check: requires BRANCH_MANAGE_USERS in target location or ORGANISATION_MANAGE_USERS
            const canManageOrgUsers = req.securityContext?.effectivePermissions.has(Permission.ORGANISATION_MANAGE_USERS);
            const userBranchMembership = req.securityContext?.branchMemberships.find(bm => bm.branchId === locationId && bm.isActive);
            const canManageBranchUsers = userBranchMembership?.role === BranchRole.BRANCH_ADMIN;

            if (!canManageOrgUsers && !canManageBranchUsers && !req.securityContext?.isPlatformAdmin) {
                return res.status(403).json({
                    success: false,
                    code: 'INSUFFICIENT_BRANCH_PERMISSIONS',
                    error: { message: 'You do not have permission to manage users for this branch.' }
                });
            }

            const existingLocMem = await query(
                'SELECT id, role FROM location_memberships WHERE location_id = $1 AND user_id = $2',
                [locationId, targetUserId]
            );

            if (existingLocMem.rows.length === 0) {
                return res.status(404).json({ success: false, error: { message: 'User does not hold membership in this branch.' } });
            }

            const prevRole = existingLocMem.rows[0].role;

            await query(
                'DELETE FROM location_memberships WHERE location_id = $1 AND user_id = $2',
                [locationId, targetUserId]
            );

            // Audit log
            await logSecurityAuditEvent({
                actorId,
                orgId,
                action: 'BRANCH_ACCESS_REVOKED',
                targetUserId,
                branchId: locationId,
                previousValue: prevRole,
                newValue: null,
                details: `Revoked access for user ${targetUserId} from branch ${locationId}`
            });

            res.json({
                success: true,
                message: 'Branch access has been revoked.'
            });
        } catch (err: any) {
            console.error('[REVOKE BRANCH ACCESS ERROR]', err);
            res.status(500).json({ success: false, error: { message: 'Failed to revoke branch access.' } });
        }
    }
);

export default router;
