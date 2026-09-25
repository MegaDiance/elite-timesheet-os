import crypto from 'crypto';
import { query } from './db';
import { sha256Hex } from './authUtils';
import { badRequest } from './policy';

/**
 * The organisation's private sign-in link: /login/<token>.
 *
 * The token is an entry point only — it identifies which organisation's sign-in page to show and
 * grants nothing by itself (a password is still required, and access is still resolved per user).
 * It is still treated as a secret:
 *   - 128 random bits, generated with crypto.randomBytes.
 *   - Looked up only by its SHA-256 hash (`organisations.portal_slug_hash`).
 *   - A copy is kept AES-256-GCM encrypted (`portal_slug_enc`) so the server can show it to the
 *     Owner again and send people back to it after an invitation or password reset. The plain
 *     value is never stored by this module.
 *   - Optional expiry (`portal_link_expires_at`). Regenerating replaces it, which revokes the old one.
 *
 * Legacy: organisations created before migration 706 still have the plain `portal_slug` column
 * filled in. It is never used for lookups (the migration backfilled its hash), only to create the
 * encrypted copy the first time it is needed, after which the plain value is cleared.
 */

/** Anything outside this shape is rejected before touching the database. */
const TOKEN_SHAPE = /^[a-z0-9-]{8,128}$/;

export type PortalLinkStatus =
    | { status: 'valid'; orgId: string; name: string }
    | { status: 'expired' }
    | { status: 'invalid' };

export function normalisePortalToken(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const token = raw.trim().toLowerCase();
    return TOKEN_SHAPE.test(token) ? token : null;
}

export function hashPortalToken(token: string): string {
    return sha256Hex(token);
}

function encryptionKey(): Buffer {
    const secret = process.env.PORTAL_LINK_KEY || process.env.JWT_SECRET || 'super_secret_jwt_key_for_local_dev';
    return Buffer.from(crypto.hkdfSync('sha256', secret, 'simplehours', 'portal-link-v1', 32));
}

function encrypt(token: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

function decrypt(value: string): string | null {
    try {
        const [version, iv, tag, body] = value.split(':');
        if (version !== 'v1') return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
    } catch {
        return null; // wrong key (secret rotated) or tampered — the Owner can regenerate the link
    }
}

/** Resolves a token from a URL. Unknown, malformed, inactive-organisation and revoked tokens are all 'invalid'. */
export async function resolvePortalToken(raw: unknown): Promise<PortalLinkStatus> {
    const token = normalisePortalToken(raw);
    if (!token) return { status: 'invalid' };
    const res = await query(
        `SELECT id, name, portal_link_expires_at IS NOT NULL AND portal_link_expires_at <= NOW() AS expired
           FROM organisations WHERE is_active = true AND portal_slug_hash = $1`,
        [hashPortalToken(token)]
    );
    const org = res.rows[0];
    if (!org) return { status: 'invalid' };
    if (org.expired) return { status: 'expired' };
    return { status: 'valid', orgId: org.id, name: org.name };
}

export interface IssuedPortalLink { token: string; path: string; expiresAt: string | null }

/**
 * Creates a new link for an organisation, replacing (and so revoking) any previous one.
 * `run` lets callers issue the link inside their own transaction.
 */
export async function issuePortalLink(
    orgId: string,
    expiresAt: Date | null = null,
    run: (text: string, params?: any[]) => Promise<any> = query
): Promise<IssuedPortalLink> {
    const token = crypto.randomBytes(16).toString('hex');
    await run(
        `UPDATE organisations
            SET portal_slug = NULL, portal_slug_hash = $1, portal_slug_enc = $2,
                portal_link_expires_at = $3, portal_link_created_at = NOW()
          WHERE id = $4`,
        [hashPortalToken(token), encrypt(token), expiresAt ? expiresAt.toISOString() : null, orgId]
    );
    return { token, path: `/login/${token}`, expiresAt: expiresAt ? expiresAt.toISOString() : null };
}

export interface PortalLinkInfo { token: string; path: string; expiresAt: string | null; expired: boolean; createdAt: string | null }

/** The organisation's current link, or null when there is none that can be shown. */
export async function currentPortalLink(orgId: string): Promise<PortalLinkInfo | null> {
    const res = await query(
        `SELECT portal_slug, portal_slug_hash, portal_slug_enc, portal_link_expires_at, portal_link_created_at,
                portal_link_expires_at IS NOT NULL AND portal_link_expires_at <= NOW() AS expired
           FROM organisations WHERE id = $1 AND is_active = true`,
        [orgId]
    );
    const row = res.rows[0];
    if (!row || !row.portal_slug_hash) return null;

    let token = row.portal_slug_enc ? decrypt(row.portal_slug_enc) : null;
    if (!token && row.portal_slug && hashPortalToken(String(row.portal_slug).toLowerCase()) === row.portal_slug_hash) {
        // Legacy plain value: move it to the encrypted column and clear it. Guarded by the hash so a
        // concurrent regenerate is never overwritten.
        token = String(row.portal_slug).toLowerCase();
        await query(
            'UPDATE organisations SET portal_slug_enc = $1, portal_slug = NULL WHERE id = $2 AND portal_slug_hash = $3',
            [encrypt(token), orgId, row.portal_slug_hash]
        );
    }
    if (!token || hashPortalToken(token) !== row.portal_slug_hash) return null;

    return {
        token,
        path: `/login/${token}`,
        expiresAt: row.portal_link_expires_at ? new Date(row.portal_link_expires_at).toISOString() : null,
        expired: Boolean(row.expired),
        createdAt: row.portal_link_created_at ? new Date(row.portal_link_created_at).toISOString() : null,
    };
}

/** The sign-in path to send someone to after an invitation or reset — only while the link works. */
export async function usablePortalPath(orgId: string): Promise<string | null> {
    const link = await currentPortalLink(orgId);
    return link && !link.expired ? link.path : null;
}

/** Latest expiry an Owner can choose. Links are meant to be long-lived; this only rejects typos. */
const MAX_EXPIRY_MS = 5 * 366 * 24 * 60 * 60 * 1000;

/** Parses an optional expiry from a request body. undefined = not supplied, null = never expires. */
export function parseExpiry(value: unknown): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const date = typeof value === 'string' ? new Date(value) : new Date(NaN);
    if (Number.isNaN(date.getTime())) throw badRequest('VALIDATION_FAILED', 'Choose a valid expiry date.');
    if (date.getTime() <= Date.now()) throw badRequest('VALIDATION_FAILED', 'The expiry date must be in the future.');
    if (date.getTime() - Date.now() > MAX_EXPIRY_MS) throw badRequest('VALIDATION_FAILED', 'Choose an expiry date within the next five years.');
    return date;
}
