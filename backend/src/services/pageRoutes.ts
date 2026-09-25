import { Request, Response } from 'express';
import { parseClientInfo } from './securityService';
import { isRateLimited, recordFailedAttempt } from './authUtils';
import { resolvePortalToken } from './portalLink';

/**
 * Which browser (non-API) paths exist, decided on the server.
 *
 * The frontend is a single-page app, so every real page is the same index.html. What the server
 * controls is the HTTP status: real pages get 200; everything else — including `/login`, which is
 * deliberately NOT a sign-in page, and any `/login/<token>` that is not a valid, unexpired
 * private sign-in link — gets 404 (410 for an expired link). The browser then shows the matching
 * not-found / link-not-valid screen. Keep this list in step with frontend/src/App.tsx (a test
 * compares them).
 */
export const PAGE_PATHS: readonly string[] = [
    // Public website
    '/', '/features', '/pricing',
    // Account set-up flows that arrive by emailed / shared link
    '/verify-login', '/forgot-password', '/reset-password', '/signup', '/setup-organisation',
    '/accept-invite', '/accept-employee-invite',
    // Signed-in application (the API authorises every request; these only need to load the app)
    '/app', '/dashboard', '/roster', '/timesheets', '/leave-requests', '/workers', '/reports',
    '/branches', '/branch-admins', '/audit', '/announcements', '/settings',
    '/my/schedule', '/my/timesheet', '/my/history', '/my/leave',
];

const pageSet = new Set(PAGE_PATHS);
const PORTAL_PATH = /^\/login\/([^/]+)\/?$/;

export type PageDecision = { status: 200 | 404 | 410; kind: 'page' | 'portal' | 'not-found' };

export async function classifyPage(req: Request): Promise<PageDecision> {
    const path = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
    if (pageSet.has(path)) return { status: 200, kind: 'page' };

    const portal = PORTAL_PATH.exec(req.path);
    if (!portal) return { status: 404, kind: 'not-found' };

    // Guessing links through page loads counts against the same per-IP limit as the lookup API.
    const ipKey = `ip:${parseClientInfo(req).ip || '127.0.0.1'}`;
    if (isRateLimited(ipKey)) return { status: 404, kind: 'not-found' };

    let raw: string;
    try { raw = decodeURIComponent(portal[1]); } catch { raw = ''; }
    const link = await resolvePortalToken(raw);
    if (link.status === 'valid') return { status: 200, kind: 'portal' };
    recordFailedAttempt(ipKey);
    return { status: link.status === 'expired' ? 410 : 404, kind: 'portal' };
}

/** Sends the app shell with the decided status. Sign-in pages are never cached or indexed. */
export async function sendPage(req: Request, res: Response, indexFile: string) {
    const decision = await classifyPage(req);
    if (decision.kind !== 'page') {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }
    res.status(decision.status).sendFile(indexFile);
}
