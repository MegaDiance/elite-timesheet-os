import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { requireAuth, requireTenantContext, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(requireAuth, requireTenantContext);

interface ReactionSummary {
    emoji: string;
    count: number;
    user_reacted: boolean;
    users: string[];
}

/**
 * Aggregates raw reaction rows into grouped summaries with user details
 */
function aggregateReactions(rows: any[], currentUserId?: string): Record<string, ReactionSummary[]> {
    const map: Record<string, Record<string, { count: number; user_reacted: boolean; users: string[] }>> = {};
    for (const r of rows) {
        if (!map[r.announcement_id]) {
            map[r.announcement_id] = {};
        }
        if (!map[r.announcement_id][r.emoji]) {
            map[r.announcement_id][r.emoji] = { count: 0, user_reacted: false, users: [] };
        }
        map[r.announcement_id][r.emoji].count += 1;
        if (r.user_name) {
            map[r.announcement_id][r.emoji].users.push(r.user_name);
        }
        if (r.user_id === currentUserId) {
            map[r.announcement_id][r.emoji].user_reacted = true;
        }
    }

    const result: Record<string, ReactionSummary[]> = {};
    for (const [annId, emojis] of Object.entries(map)) {
        result[annId] = Object.entries(emojis).map(([emoji, meta]) => ({
            emoji,
            count: meta.count,
            user_reacted: meta.user_reacted,
            users: meta.users
        }));
    }
    return result;
}

/**
 * GET /api/announcements
 * Lists announcements with reactions, replies count, attached replies, and tenant chat permissions.
 */
router.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        if (!orgId) {
            return res.status(400).json({ success: false, error: { message: 'Organisation context required.' } });
        }

        const role = req.user?.role || 'Employee';
        const isMgmt = ['Admin', 'Company Admin', 'Platform Admin', 'Manager'].includes(role);

        // Fetch announcements
        const annRes = await query(
            `SELECT id, org_id, author_id, author_name, author_role, title, content, is_system, announcement_type, created_at
             FROM organisation_announcements 
             WHERE org_id = $1 
             ORDER BY created_at DESC 
             LIMIT 50`,
            [orgId]
        );

        // Fetch reactions
        let reactionsMap: Record<string, ReactionSummary[]> = {};
        try {
            const reactRes = await query(
                `SELECT announcement_id, emoji, user_id, user_name 
                 FROM announcement_reactions 
                 WHERE org_id = $1`,
                [orgId]
            );
            reactionsMap = aggregateReactions(reactRes.rows, req.user?.id);
        } catch {
            // fallback if reactions table is being initialized
        }

        // Fetch replies
        let repliesMap: Record<string, any[]> = {};
        try {
            const repliesRes = await query(
                `SELECT id, announcement_id, org_id, author_id, author_name, author_role, content, created_at
                 FROM announcement_replies
                 WHERE org_id = $1
                 ORDER BY created_at ASC`,
                [orgId]
            );
            for (const reply of repliesRes.rows) {
                if (!repliesMap[reply.announcement_id]) {
                    repliesMap[reply.announcement_id] = [];
                }
                repliesMap[reply.announcement_id].push(reply);
            }
        } catch {
            // fallback
        }

        // Fetch chat permissions
        let allowEmployeeChat = true;
        try {
            const orgRes = await query('SELECT allow_employee_chat FROM organisations WHERE id = $1', [orgId]);
            if (orgRes.rows.length > 0 && orgRes.rows[0].allow_employee_chat !== null && orgRes.rows[0].allow_employee_chat !== undefined) {
                allowEmployeeChat = Boolean(orgRes.rows[0].allow_employee_chat);
            }
        } catch {}

        const announcements = annRes.rows.map((ann: any) => {
            const replies = repliesMap[ann.id] || [];
            return {
                ...ann,
                reactions: reactionsMap[ann.id] || [],
                replies,
                reply_count: replies.length
            };
        });

        res.json({
            success: true,
            data: announcements,
            permissions: {
                allow_employee_chat: allowEmployeeChat,
                can_post: isMgmt || allowEmployeeChat
            }
        });
    } catch (err: any) {
        console.error('[ANNOUNCEMENTS GET ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve announcements.' } });
    }
});

/**
 * POST /api/announcements
 * Allows organisation members to post, respecting allow_employee_chat permissions.
 */
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { title, content } = req.body;

        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, error: { message: 'Announcement content is required.' } });
        }

        const role = req.user?.role || 'Employee';
        const isMgmt = ['Admin', 'Company Admin', 'Platform Admin', 'Manager'].includes(role);

        // Check if employee chat is permitted
        if (!isMgmt) {
            try {
                const orgRes = await query('SELECT allow_employee_chat FROM organisations WHERE id = $1', [orgId]);
                if (orgRes.rows.length > 0 && orgRes.rows[0].allow_employee_chat === false) {
                    return res.status(403).json({
                        success: false,
                        error: {
                            code: 'CHAT_DISABLED',
                            message: 'Team chat has been restricted to management by administrators.'
                        }
                    });
                }
            } catch {}
        }

        let authorName = req.user?.email ? req.user.email.split('@')[0] : 'Team Member';
        try {
            const emp = await query('SELECT full_name FROM employees WHERE user_id = $1 AND org_id = $2', [req.user?.id, orgId]);
            if (emp.rows.length > 0 && emp.rows[0].full_name) {
                authorName = emp.rows[0].full_name;
            }
        } catch {}

        const id = crypto.randomUUID();
        const isEmployee = role === 'Employee';

        await query(
            `INSERT INTO organisation_announcements (id, org_id, author_id, author_name, author_role, title, content, is_system, announcement_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                id,
                orgId,
                req.user?.id,
                authorName,
                role,
                title?.trim() || null,
                content.trim(),
                false,
                isEmployee ? 'team_message' : 'general'
            ]
        );

        res.json({
            success: true,
            data: {
                id,
                org_id: orgId,
                title: title?.trim() || null,
                content: content.trim(),
                author_id: req.user?.id,
                author_name: authorName,
                author_role: role,
                announcement_type: isEmployee ? 'team_message' : 'general',
                is_system: false,
                reactions: [],
                replies: [],
                reply_count: 0,
                created_at: new Date().toISOString()
            }
        });
    } catch (err: any) {
        console.error('[ANNOUNCEMENTS POST ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to publish announcement.' } });
    }
});

/**
 * POST /api/announcements/:id/reactions
 * Toggles an emoji reaction on an announcement (adds if not exists, removes if exists).
 */
router.post('/:id/reactions', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { id } = req.params;
        const { emoji } = req.body;

        if (!emoji || typeof emoji !== 'string' || !emoji.trim()) {
            return res.status(400).json({ success: false, error: { message: 'Valid emoji is required.' } });
        }

        const cleanEmoji = emoji.trim();

        // Verify announcement exists in organisation
        const ann = await query('SELECT id FROM organisation_announcements WHERE id = $1 AND org_id = $2', [id, orgId]);
        if (ann.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Announcement not found.' } });
        }

        // Check if user already reacted with this emoji
        const existing = await query(
            'SELECT id FROM announcement_reactions WHERE announcement_id = $1 AND org_id = $2 AND user_id = $3 AND emoji = $4',
            [id, orgId, req.user?.id, cleanEmoji]
        );

        if (existing.rows.length > 0) {
            // Toggle off: remove reaction
            await query('DELETE FROM announcement_reactions WHERE id = $1', [existing.rows[0].id]);
        } else {
            // Toggle on: add reaction
            let userName = req.user?.email ? req.user.email.split('@')[0] : 'Colleague';
            try {
                const emp = await query('SELECT full_name FROM employees WHERE user_id = $1 AND org_id = $2', [req.user?.id, orgId]);
                if (emp.rows.length > 0 && emp.rows[0].full_name) {
                    userName = emp.rows[0].full_name;
                }
            } catch {}

            await query(
                `INSERT INTO announcement_reactions (id, announcement_id, org_id, user_id, user_name, emoji)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [crypto.randomUUID(), id, orgId, req.user?.id, userName, cleanEmoji]
            );
        }

        // Return updated reactions for this announcement
        const updatedRows = await query(
            'SELECT announcement_id, emoji, user_id, user_name FROM announcement_reactions WHERE announcement_id = $1 AND org_id = $2',
            [id, orgId]
        );
        const announcementId = String(id);
        const aggregated = aggregateReactions(updatedRows.rows, req.user?.id)[announcementId] || [];

        res.json({
            success: true,
            data: {
                announcement_id: announcementId,
                reactions: aggregated
            }
        });
    } catch (err: any) {
        console.error('[ANNOUNCEMENTS REACTION ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update reaction.' } });
    }
});

/**
 * GET /api/announcements/:id/replies
 * Retrieves threaded replies for a specific announcement.
 */
router.get('/:id/replies', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { id } = req.params;

        const ann = await query('SELECT id FROM organisation_announcements WHERE id = $1 AND org_id = $2', [id, orgId]);
        if (ann.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Announcement not found.' } });
        }

        const replies = await query(
            `SELECT id, announcement_id, org_id, author_id, author_name, author_role, content, created_at
             FROM announcement_replies
             WHERE announcement_id = $1 AND org_id = $2
             ORDER BY created_at ASC`,
            [id, orgId]
        );

        res.json({ success: true, data: replies.rows });
    } catch (err: any) {
        console.error('[ANNOUNCEMENTS GET REPLIES ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve replies.' } });
    }
});

/**
 * POST /api/announcements/:id/replies
 * Adds a reply to an announcement thread.
 */
router.post('/:id/replies', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { id } = req.params;
        const { content } = req.body;

        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, error: { message: 'Reply content cannot be empty.' } });
        }

        // Verify announcement exists in tenant
        const ann = await query('SELECT id FROM organisation_announcements WHERE id = $1 AND org_id = $2', [id, orgId]);
        if (ann.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Announcement not found.' } });
        }

        const role = req.user?.role || 'Employee';
        const isMgmt = ['Admin', 'Company Admin', 'Platform Admin', 'Manager'].includes(role);

        // Check if employee chat is permitted
        if (!isMgmt) {
            try {
                const orgRes = await query('SELECT allow_employee_chat FROM organisations WHERE id = $1', [orgId]);
                if (orgRes.rows.length > 0 && orgRes.rows[0].allow_employee_chat === false) {
                    return res.status(403).json({
                        success: false,
                        error: {
                            code: 'CHAT_DISABLED',
                            message: 'Team chat has been restricted to management by administrators.'
                        }
                    });
                }
            } catch {}
        }

        let authorName = req.user?.email ? req.user.email.split('@')[0] : 'Team Member';
        try {
            const emp = await query('SELECT full_name FROM employees WHERE user_id = $1 AND org_id = $2', [req.user?.id, orgId]);
            if (emp.rows.length > 0 && emp.rows[0].full_name) {
                authorName = emp.rows[0].full_name;
            }
        } catch {}

        const replyId = crypto.randomUUID();
        await query(
            `INSERT INTO announcement_replies (id, announcement_id, org_id, author_id, author_name, author_role, content)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [replyId, id, orgId, req.user?.id, authorName, role, content.trim()]
        );

        res.json({
            success: true,
            data: {
                id: replyId,
                announcement_id: id,
                org_id: orgId,
                author_id: req.user?.id,
                author_name: authorName,
                author_role: role,
                content: content.trim(),
                created_at: new Date().toISOString()
            }
        });
    } catch (err: any) {
        console.error('[ANNOUNCEMENTS POST REPLY ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to post reply.' } });
    }
});

/**
 * DELETE /api/announcements/:id/replies/:replyId
 * Deletes a reply (authors can delete own replies; management can moderate all replies).
 */
router.delete('/:id/replies/:replyId', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { id, replyId } = req.params;
        const userRole = req.user?.role || 'Employee';
        const isMgmt = ['Admin', 'Company Admin', 'Platform Admin', 'Manager'].includes(userRole);

        const existing = await query(
            'SELECT author_id FROM announcement_replies WHERE id = $1 AND announcement_id = $2 AND org_id = $3',
            [replyId, id, orgId]
        );

        if (existing.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Reply not found.' } });
        }

        if (!isMgmt && existing.rows[0].author_id !== req.user?.id) {
            return res.status(403).json({ success: false, error: { message: 'You can only delete your own replies.' } });
        }

        await query('DELETE FROM announcement_replies WHERE id = $1 AND org_id = $2', [replyId, orgId]);

        res.json({ success: true, message: 'Reply deleted.' });
    } catch (err: any) {
        console.error('[ANNOUNCEMENTS DELETE REPLY ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete reply.' } });
    }
});

/**
 * PATCH /api/announcements/permissions
 * Allows administrators and managers to toggle whether employees can participate in chat.
 */
router.patch('/permissions', requireAuth, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { allow_employee_chat } = req.body;

        const val = allow_employee_chat !== false;
        await query('UPDATE organisations SET allow_employee_chat = $1 WHERE id = $2', [val, orgId]);

        res.json({
            success: true,
            allow_employee_chat: val,
            message: val ? 'Employee chat is now enabled.' : 'Employee chat has been restricted.'
        });
    } catch (err: any) {
        console.error('[ANNOUNCEMENTS PERMISSIONS ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update permissions.' } });
    }
});

/**
 * DELETE /api/announcements/:id
 * Allows managers/admins to delete any announcement, or employees to delete their own messages.
 */
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { id } = req.params;
        const userRole = req.user?.role || 'Employee';
        const isMgmt = ['Admin', 'Company Admin', 'Platform Admin', 'Manager'].includes(userRole);

        const existing = await query('SELECT author_id FROM organisation_announcements WHERE id = $1 AND org_id = $2', [id, orgId]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Announcement not found.' } });
        }

        if (!isMgmt && existing.rows[0].author_id !== req.user?.id) {
            return res.status(403).json({ success: false, error: { message: 'You can only delete your own messages.' } });
        }

        // Delete cascade replies and reactions
        try {
            await query('DELETE FROM announcement_reactions WHERE announcement_id = $1 AND org_id = $2', [id, orgId]);
            await query('DELETE FROM announcement_replies WHERE announcement_id = $1 AND org_id = $2', [id, orgId]);
        } catch {}

        await query('DELETE FROM organisation_announcements WHERE id = $1 AND org_id = $2', [id, orgId]);

        res.json({ success: true, message: 'Announcement deleted.' });
    } catch (err: any) {
        console.error('[ANNOUNCEMENTS DELETE ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete announcement.' } });
    }
});

export default router;
