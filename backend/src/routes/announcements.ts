import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { requireAuth, Permission, AuthRequest, sendError } from '../middleware/auth';
import { AccessContext, Role, badRequest, forbidden, hasPermission, isUuid, notFound, writeAudit } from '../services/policy';

/**
 * Management noticeboard.
 *
 * The audience is the organisation's accounts: the Organisation Owner and its Branch Admins.
 * Posts, reactions and threaded replies are organisation-wide. Any authenticated account may
 * read, post, react and reply. Authors may delete their own posts and replies; deleting someone
 * else's requires announcements.moderate.
 */
const router = Router();
router.use(requireAuth);

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 5000;
const MAX_EMOJI_LENGTH = 32;

/** Denormalised label stored with each post / reply. Display only — never used for authorisation. */
const ROLE_LABELS: Record<Role, string> = {
    OWNER: 'Organisation Owner',
    BRANCH_ADMIN: 'Branch Admin',
};

interface ReactionSummary {
    emoji: string;
    count: number;
    user_reacted: boolean;
    users: string[];
}

const authorName = (ctx: AccessContext) => ctx.fullName || ctx.email;
const canModerate = (ctx: AccessContext) => hasPermission(ctx, Permission.ANNOUNCEMENTS_MODERATE);
const canDelete = (ctx: AccessContext, authorId: string | null) => canModerate(ctx) || authorId === ctx.userId;

function readContent(value: unknown, emptyMessage: string): string {
    const content = typeof value === 'string' ? value.trim() : '';
    if (!content) throw badRequest('VALIDATION_FAILED', emptyMessage);
    if (content.length > MAX_CONTENT_LENGTH) {
        throw badRequest('VALIDATION_FAILED', `Messages can be ${MAX_CONTENT_LENGTH} characters at most.`);
    }
    return content;
}

function readTitle(value: unknown): string | null {
    const title = typeof value === 'string' ? value.trim() : '';
    if (title.length > MAX_TITLE_LENGTH) {
        throw badRequest('VALIDATION_FAILED', `Titles can be ${MAX_TITLE_LENGTH} characters at most.`);
    }
    return title || null;
}

/** Groups raw reaction rows into per-announcement emoji summaries. */
function aggregateReactions(rows: any[], currentUserId: string): Record<string, ReactionSummary[]> {
    const result: Record<string, ReactionSummary[]> = {};
    for (const row of rows) {
        const summaries = result[row.announcement_id] || (result[row.announcement_id] = []);
        let summary = summaries.find(s => s.emoji === row.emoji);
        if (!summary) {
            summary = { emoji: row.emoji, count: 0, user_reacted: false, users: [] };
            summaries.push(summary);
        }
        summary.count += 1;
        if (row.user_name) summary.users.push(row.user_name);
        if (row.user_id === currentUserId) summary.user_reacted = true;
    }
    return result;
}

/** Loads a post of the caller's organisation. Anything else (bad id, other tenant) is a 404. */
async function loadAnnouncement(ctx: AccessContext, id: unknown): Promise<{ id: string; author_id: string | null; title: string | null }> {
    if (!isUuid(id)) throw notFound('Announcement');
    const res = await query('SELECT id, author_id, title FROM organisation_announcements WHERE id = $1 AND org_id = $2', [id, ctx.orgId]);
    if (res.rows.length === 0) throw notFound('Announcement');
    return res.rows[0];
}

/**
 * GET /api/announcements
 * The latest 50 posts with their reactions and replies.
 */
router.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;

        const posts = await query(
            `SELECT id, org_id, author_id, author_name, author_role, title, content, created_at
               FROM organisation_announcements
              WHERE org_id = $1
              ORDER BY created_at DESC
              LIMIT 50`,
            [ctx.orgId]
        );
        const postIds = posts.rows.map((p: any) => p.id);

        const [reactions, replies] = await Promise.all([
            query(
                `SELECT announcement_id, emoji, user_id, user_name
                   FROM announcement_reactions
                  WHERE org_id = $1 AND announcement_id = ANY($2::uuid[])
                  ORDER BY created_at ASC`,
                [ctx.orgId, postIds]
            ),
            query(
                `SELECT id, announcement_id, org_id, author_id, author_name, author_role, content, created_at
                   FROM announcement_replies
                  WHERE org_id = $1 AND announcement_id = ANY($2::uuid[])
                  ORDER BY created_at ASC`,
                [ctx.orgId, postIds]
            ),
        ]);

        const reactionsByPost = aggregateReactions(reactions.rows, ctx.userId);
        const repliesByPost: Record<string, any[]> = {};
        for (const reply of replies.rows) {
            (repliesByPost[reply.announcement_id] || (repliesByPost[reply.announcement_id] = []))
                .push({ ...reply, can_delete: canDelete(ctx, reply.author_id) });
        }

        const data = posts.rows.map((post: any) => {
            const postReplies = repliesByPost[post.id] || [];
            return {
                ...post,
                can_delete: canDelete(ctx, post.author_id),
                reactions: reactionsByPost[post.id] || [],
                replies: postReplies,
                reply_count: postReplies.length,
            };
        });

        res.json({
            success: true,
            data,
            permissions: { can_post: true, can_moderate: canModerate(ctx) },
        });
    } catch (err) {
        sendError(res, err, 'ANNOUNCEMENTS LIST ERROR');
    }
});

/**
 * POST /api/announcements  { title?, content }
 */
router.post('/', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const title = readTitle(req.body?.title);
        const content = readContent(req.body?.content, 'Announcement content is required.');

        const inserted = await query(
            `INSERT INTO organisation_announcements (id, org_id, author_id, author_name, author_role, title, content)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, org_id, author_id, author_name, author_role, title, content, created_at`,
            [crypto.randomUUID(), ctx.orgId, ctx.userId, authorName(ctx), ROLE_LABELS[ctx.role], title, content]
        );

        res.status(201).json({
            success: true,
            data: { ...inserted.rows[0], can_delete: true, reactions: [], replies: [], reply_count: 0 },
        });
    } catch (err) {
        sendError(res, err, 'ANNOUNCEMENTS POST ERROR');
    }
});

/**
 * POST /api/announcements/:id/reactions  { emoji }
 * Toggles the caller's reaction: removes it when present, adds it otherwise.
 */
router.post('/:id/reactions', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const announcement = await loadAnnouncement(ctx, req.params.id);

        const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim() : '';
        if (!emoji || emoji.length > MAX_EMOJI_LENGTH) throw badRequest('VALIDATION_FAILED', 'Valid emoji is required.');

        const removed = await query(
            'DELETE FROM announcement_reactions WHERE announcement_id = $1 AND org_id = $2 AND user_id = $3 AND emoji = $4 RETURNING id',
            [announcement.id, ctx.orgId, ctx.userId, emoji]
        );
        if (removed.rows.length === 0) {
            await query(
                `INSERT INTO announcement_reactions (id, announcement_id, org_id, user_id, user_name, emoji)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (announcement_id, user_id, emoji) DO NOTHING`,
                [crypto.randomUUID(), announcement.id, ctx.orgId, ctx.userId, authorName(ctx), emoji]
            );
        }

        const updated = await query(
            `SELECT announcement_id, emoji, user_id, user_name
               FROM announcement_reactions
              WHERE announcement_id = $1 AND org_id = $2
              ORDER BY created_at ASC`,
            [announcement.id, ctx.orgId]
        );

        res.json({
            success: true,
            data: {
                announcement_id: announcement.id,
                reactions: aggregateReactions(updated.rows, ctx.userId)[announcement.id] || [],
            },
        });
    } catch (err) {
        sendError(res, err, 'ANNOUNCEMENTS REACTION ERROR');
    }
});

/**
 * GET /api/announcements/:id/replies
 */
router.get('/:id/replies', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const announcement = await loadAnnouncement(ctx, req.params.id);

        const replies = await query(
            `SELECT id, announcement_id, org_id, author_id, author_name, author_role, content, created_at
               FROM announcement_replies
              WHERE announcement_id = $1 AND org_id = $2
              ORDER BY created_at ASC`,
            [announcement.id, ctx.orgId]
        );

        res.json({
            success: true,
            data: replies.rows.map((reply: any) => ({ ...reply, can_delete: canDelete(ctx, reply.author_id) })),
        });
    } catch (err) {
        sendError(res, err, 'ANNOUNCEMENTS REPLIES ERROR');
    }
});

/**
 * POST /api/announcements/:id/replies  { content }
 */
router.post('/:id/replies', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const announcement = await loadAnnouncement(ctx, req.params.id);
        const content = readContent(req.body?.content, 'Reply content cannot be empty.');

        const inserted = await query(
            `INSERT INTO announcement_replies (id, announcement_id, org_id, author_id, author_name, author_role, content)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, announcement_id, org_id, author_id, author_name, author_role, content, created_at`,
            [crypto.randomUUID(), announcement.id, ctx.orgId, ctx.userId, authorName(ctx), ROLE_LABELS[ctx.role], content]
        );

        res.status(201).json({ success: true, data: { ...inserted.rows[0], can_delete: true } });
    } catch (err) {
        sendError(res, err, 'ANNOUNCEMENTS REPLY ERROR');
    }
});

/**
 * DELETE /api/announcements/:id/replies/:replyId
 * Authors delete their own replies; anyone else's needs announcements.moderate.
 */
router.delete('/:id/replies/:replyId', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { id, replyId } = req.params;
        if (!isUuid(id) || !isUuid(replyId)) throw notFound('Reply');

        const existing = await query(
            'SELECT id, author_id FROM announcement_replies WHERE id = $1 AND announcement_id = $2 AND org_id = $3',
            [replyId, id, ctx.orgId]
        );
        const reply = existing.rows[0];
        if (!reply) throw notFound('Reply');
        if (!canDelete(ctx, reply.author_id)) throw forbidden('You can only delete your own replies.');

        await query('DELETE FROM announcement_replies WHERE id = $1 AND org_id = $2', [reply.id, ctx.orgId]);
        if (reply.author_id !== ctx.userId) {
            await writeAudit({
                orgId: ctx.orgId, actorId: ctx.userId, action: 'ANNOUNCEMENT_REPLY_MODERATED', entityType: 'announcement_reply',
                entityId: reply.id, targetUserId: reply.author_id, details: 'Removed a reply written by another account',
            });
        }

        res.json({ success: true, message: 'Reply deleted.' });
    } catch (err) {
        sendError(res, err, 'ANNOUNCEMENTS REPLY DELETE ERROR');
    }
});

/**
 * DELETE /api/announcements/:id
 * Authors delete their own posts; anyone else's needs announcements.moderate.
 * Reactions and replies go with the post (ON DELETE CASCADE).
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const announcement = await loadAnnouncement(ctx, req.params.id);
        if (!canDelete(ctx, announcement.author_id)) throw forbidden('You can only delete your own messages.');

        await query('DELETE FROM organisation_announcements WHERE id = $1 AND org_id = $2', [announcement.id, ctx.orgId]);
        if (announcement.author_id !== ctx.userId) {
            await writeAudit({
                orgId: ctx.orgId, actorId: ctx.userId, action: 'ANNOUNCEMENT_MODERATED', entityType: 'announcement',
                entityId: announcement.id, targetUserId: announcement.author_id,
                details: `Removed a post written by another account${announcement.title ? `: "${announcement.title}"` : ''}`,
            });
        }

        res.json({ success: true, message: 'Announcement deleted.' });
    } catch (err) {
        sendError(res, err, 'ANNOUNCEMENTS DELETE ERROR');
    }
});

export default router;
