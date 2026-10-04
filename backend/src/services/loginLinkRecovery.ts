import crypto from 'crypto';
import { query, withTransaction } from './db';
import { comparePassword, hashPassword } from './auth';
import { ClientInfo } from './securityService';
import { accountRateLimitKey, clearRateLimit, isRateLimited, isValidEmail, publicBaseUrl, recordFailedAttempt, sha256Hex } from './authUtils';
import { currentPortalLink, issuePortalLink } from './portalLink';
import { listAccessibleOrganisations, writeAudit } from './policy';
import { recordLoginAttempt } from './sessionService';
import {
    buildLoginLinkRecoveredEmailTemplate, buildLoginLinksEmailTemplate, isEmailSendingEnabled, sendTransactionalEmail,
} from './emailService';

/**
 * "I've lost my company's login link" — for anyone with a SimpleHours account.
 *
 * The login link only chooses which organisation's sign-in page to show; it grants nothing by
 * itself. The password is the secret. So the link can be given back to whoever proves the
 * account's email and password — exactly what signing in through the link would need anyway —
 * without making anything weaker. Two ways:
 *
 *   1. Email + password, answered on screen: the current link of every organisation the account
 *      can sign in to. Works while email is off. Nothing is replaced, so bookmarks keep working.
 *      The one exception: an Organisation Owner whose link has expired or can't be shown gets a
 *      fresh one (the old one already doesn't work, so nobody loses a working bookmark).
 *   2. Email only, answered by email (only while email is on): the same links, sent to that
 *      address if it belongs to an account. The response never says whether it does.
 *
 * Neither creates a session. Failures look the same whatever was wrong, a password comparison
 * always runs (against a dummy hash when there is no such account), and every rate-limit key is
 * built only from what was submitted.
 */

const dummyPasswordHash = hashPassword(crypto.randomUUID());
const PASSWORD_MAX_LENGTH = 1024;

// ---------------------------------------------------------------------------
// Progressive lockout
// ---------------------------------------------------------------------------

interface Bucket { failures: number; strikes: number; lockedUntil: number; touched: number }

const IP_FAILURES_BEFORE_LOCK = 10; // an office can share one address, so this is looser than the per-email limit
const EMAIL_FAILURES_BEFORE_LOCK = 5;
const EMAILS_SENT_BEFORE_LOCK = 3; // per address, so the email option can't be used to flood an inbox
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;
const FORGET_AFTER_MS = 24 * 60 * 60 * 1000; // a quiet day clears the failure count and the escalation
const MAX_BUCKETS = 20_000;

const buckets = new Map<string, Bucket>();

function bucketFor(key: string, now: number): Bucket {
    let bucket = buckets.get(key);
    if (bucket && now - bucket.touched > FORGET_AFTER_MS && bucket.lockedUntil <= now) {
        buckets.delete(key);
        bucket = undefined;
    }
    if (!bucket) {
        if (buckets.size >= MAX_BUCKETS) {
            // Keys come from request input, so the table is bounded: forget what has gone quiet.
            for (const [k, b] of buckets) if (b.lockedUntil <= now && now - b.touched > FORGET_AFTER_MS) buckets.delete(k);
        }
        bucket = { failures: 0, strikes: 0, lockedUntil: 0, touched: now };
        buckets.set(key, bucket);
    }
    return bucket;
}

function isLocked(key: string): boolean {
    const bucket = buckets.get(key);
    return Boolean(bucket && bucket.lockedUntil > Date.now());
}

/** Counts a failure. Returns true when this failure started a lockout, which lasts 15 min, then 30, 60 … up to a day. */
function recordFailure(key: string, threshold: number): boolean {
    const now = Date.now();
    const bucket = bucketFor(key, now);
    bucket.touched = now;
    bucket.failures++;
    if (bucket.failures < threshold) return false;
    bucket.failures = 0;
    bucket.strikes++;
    bucket.lockedUntil = now + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (bucket.strikes - 1));
    return true;
}

export function resetRecoveryLimits(): void {
    buckets.clear();
}

/**
 * The address the IP limit counts. An IPv4-mapped IPv6 address counts as its IPv4 address, and an
 * IPv6 address counts as its /64 — a single subscriber routinely controls a whole /64, so
 * counting single addresses would let one machine rotate through billions of them.
 */
export function ipLimitKey(rawIp: string): string {
    const ip = (rawIp || '127.0.0.1').split('%')[0].toLowerCase().replace(/^::ffff:/, '');
    if (!ip.includes(':')) return ip;
    const [head, tail] = ip.split('::');
    const h = head ? head.split(':') : [];
    const t = ip.includes('::') && tail ? tail.split(':') : [];
    const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
    if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return ip;
    return `${groups.slice(0, 4).map(g => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

const limitKeys = (ip: string, email: string) => ({
    ip: `recover:ip:${ipLimitKey(ip)}`,
    email: `recover:email:${sha256Hex(email)}`,
    // The sign-in page's per-account budget, shared so passwords cannot be guessed faster here than there.
    account: accountRateLimitKey(email),
});

// ---------------------------------------------------------------------------
// The links an account can use
// ---------------------------------------------------------------------------

export interface FoundLink {
    organisationName: string;
    /** null when there is no working link to give: the Organisation Owner has to issue a new one. */
    loginPath: string | null;
    expiresAt: string | null;
    /** True when this lookup issued a new link because the old one had stopped working (owners only). */
    replaced: boolean;
}

const describeClient = (c: ClientInfo) => `${c.deviceInfo}, ${c.approxLocation}`;

/**
 * The working login link of each organisation `userId` can sign in to. With `replaceDeadLinks`
 * (on-screen lookup by the account's password only), an organisation this account OWNS whose link
 * has expired or can't be shown is given a fresh one.
 */
async function linksFor(userId: string, opts: { replaceDeadLinks: boolean; client: ClientInfo }): Promise<Array<FoundLink & { orgId: string }>> {
    const organisations = await listAccessibleOrganisations(userId);
    const found: Array<FoundLink & { orgId: string }> = [];
    for (const org of organisations) {
        // Read before the link itself, so a replacement made in between is never mistaken for the dead link.
        const seenHash = (await query('SELECT portal_slug_hash FROM organisations WHERE id = $1', [org.id])).rows[0]?.portal_slug_hash ?? null;
        let link = await currentPortalLink(org.id);
        let replaced = false;
        if ((!link || link.expired) && opts.replaceDeadLinks) {
            const fresh = await replaceOwnersDeadLink(org.id, userId, seenHash);
            if (fresh) {
                replaced = true;
                await writeAudit({
                    orgId: org.id, actorId: userId, action: 'LOGIN_LINK_ROTATED', entityType: 'organisation', entityId: org.id,
                    details: 'Private login link replaced while looking it up (the previous one had stopped working), no expiry', ip: opts.client.ip,
                });
            }
            // Either the new link, or the one a concurrent lookup issued first.
            link = await currentPortalLink(org.id);
        }
        const works = Boolean(link && !link.expired);
        found.push({
            orgId: org.id, organisationName: org.name, loginPath: works ? link!.path : null, expiresAt: works ? link!.expiresAt : null, replaced,
        });
    }
    return found;
}

/**
 * Issues a new link for an organisation `ownerId` owns, but only if the link is still the dead one
 * this lookup saw (`seenHash`). The row is locked and ownership and the hash are checked again in
 * the same transaction, so a concurrent ownership transfer can't interleave, and a second lookup
 * running at the same time finds the hash changed and leaves the first one's new link alone.
 */
async function replaceOwnersDeadLink(orgId: string, ownerId: string, seenHash: string | null) {
    return withTransaction(async (tx) => {
        const res = await tx(
            `SELECT 1 FROM organisations
              WHERE id = $1 AND owner_user_id = $2 AND is_active = true AND portal_slug_hash IS NOT DISTINCT FROM $3
              FOR UPDATE`,
            [orgId, ownerId, seenHash]
        );
        return res.rows[0] ? issuePortalLink(orgId, null, tx) : null;
    });
}

// ---------------------------------------------------------------------------
// 1. Email + password, answered on screen
// ---------------------------------------------------------------------------

export type LookupOutcome =
    | { kind: 'rate-limited' }
    | { kind: 'unverified' }
    | { kind: 'found'; links: Array<FoundLink & { loginUrl: string | null }> };

export async function findLoginLinks(input: { email?: unknown; password?: unknown }, client: ClientInfo): Promise<LookupOutcome> {
    const { email: rawEmail, password } = input;
    const ip = client.ip || '127.0.0.1';

    // Malformed or missing input is not told apart from a wrong answer: it gets the same response,
    // takes about as long, and counts against the address.
    if (!isValidEmail(rawEmail) || typeof password !== 'string' || !password || password.length > PASSWORD_MAX_LENGTH) {
        const ipKey = `recover:ip:${ipLimitKey(ip)}`;
        if (isLocked(ipKey)) return { kind: 'rate-limited' };
        await comparePassword('x', await dummyPasswordHash);
        recordFailure(ipKey, IP_FAILURES_BEFORE_LOCK);
        return { kind: 'unverified' };
    }

    const email = rawEmail.trim().toLowerCase();
    const keys = limitKeys(ip, email);
    if (isLocked(keys.ip) || isLocked(keys.email) || isRateLimited(keys.account)) return { kind: 'rate-limited' };

    const found = await query('SELECT id, email, is_active, password_hash FROM users WHERE LOWER(email) = $1', [email]);
    const user = found.rows[0];
    // Always compare, so the time taken does not say whether the account exists.
    const passwordOk = await comparePassword(password, user?.password_hash || await dummyPasswordHash);
    if (!user || !user.is_active || !user.password_hash || !passwordOk) return fail(user?.id, email, keys, client);

    buckets.delete(keys.email);
    clearRateLimit(keys.account);

    const links = await linksFor(user.id, { replaceDeadLinks: true, client });
    for (const link of links) {
        await writeAudit({
            orgId: link.orgId, actorId: user.id, action: 'LOGIN_LINK_LOOKUP', entityType: 'organisation', entityId: link.orgId,
            details: `Looked up the login link with email and password from ${describeClient(client)}`, ip: client.ip,
        });
    }
    if (links.some(l => l.replaced)) await notifyOwnerOfReplacement(user.email, links.filter(l => l.replaced), client);

    // The organisation's id stays on the server.
    return { kind: 'found', links: links.map(({ orgId: _orgId, ...l }) => ({ ...l, loginUrl: l.loginPath ? `${publicBaseUrl()}${l.loginPath}` : null })) };
}

async function fail(userId: string | undefined, email: string, keys: ReturnType<typeof limitKeys>, client: ClientInfo): Promise<LookupOutcome> {
    const ipLocked = recordFailure(keys.ip, IP_FAILURES_BEFORE_LOCK);
    const emailLocked = recordFailure(keys.email, EMAIL_FAILURES_BEFORE_LOCK);
    recordFailedAttempt(keys.account);

    // Every failed attempt goes to the sign-in security log, like a failed sign-in. It never stores
    // the password or anything derived from it.
    await recordLoginAttempt({ userId, email, status: 'FAILED', clientInfo: client, authMethod: 'login_link_recovery' });
    if (ipLocked || emailLocked) {
        await recordLoginAttempt({ userId, email, status: 'RATE_LIMITED', clientInfo: client, authMethod: 'login_link_recovery' });
    }
    return { kind: 'unverified' };
}

/**
 * Tells the owner, by email, that a dead login link was replaced. The message never contains the
 * link. While email is off nothing is sent, and a delivery failure never affects the lookup: the
 * audit log is the record either way.
 */
async function notifyOwnerOfReplacement(to: string, replaced: FoundLink[], client: ClientInfo): Promise<void> {
    if (!isEmailSendingEnabled()) return;
    for (const link of replaced) {
        try {
            const template = buildLoginLinkRecoveredEmailTemplate({
                organisationName: link.organisationName, when: new Date().toUTCString(), deviceInfo: client.deviceInfo, approxLocation: client.approxLocation,
            });
            const result = await sendTransactionalEmail({ to, subject: template.subject, html: template.html, text: template.text });
            if (!result.success) console.warn('[LOGIN LINK RECOVERY] notification not delivered:', result.error);
        } catch (err) {
            console.warn('[LOGIN LINK RECOVERY] notification failed:', err instanceof Error ? err.message : 'unknown error');
        }
    }
}

// ---------------------------------------------------------------------------
// 2. Email only, answered by email
// ---------------------------------------------------------------------------

export type EmailOutcome = { kind: 'email-off' } | { kind: 'rate-limited' } | { kind: 'accepted' };

/**
 * Emails the account's working login links to the account's own address. The answer is the same
 * whether or not the address has an account. Nothing is replaced here: an organisation without a
 * working link is listed with a note to ask its Owner (an Owner can use the password option).
 */
export async function emailLoginLinks(input: { email?: unknown }, client: ClientInfo): Promise<EmailOutcome> {
    if (!isEmailSendingEnabled()) return { kind: 'email-off' };
    const ipKey = `recover:ip:${ipLimitKey(client.ip || '127.0.0.1')}`;
    if (isLocked(ipKey)) return { kind: 'rate-limited' };
    if (!isValidEmail(input.email)) {
        recordFailure(ipKey, IP_FAILURES_BEFORE_LOCK);
        return { kind: 'accepted' };
    }

    const email = input.email.trim().toLowerCase();
    const sendKey = `recover:send:${sha256Hex(email)}`;
    if (isLocked(sendKey)) return { kind: 'rate-limited' };
    // Every request counts, real address or not, so the limiter can't be used to find real ones.
    recordFailure(sendKey, EMAILS_SENT_BEFORE_LOCK);
    recordFailure(ipKey, IP_FAILURES_BEFORE_LOCK);

    const found = await query('SELECT id, email FROM users WHERE LOWER(email) = $1 AND is_active = true', [email]);
    const user = found.rows[0];
    if (!user) return { kind: 'accepted' };
    const links = await linksFor(user.id, { replaceDeadLinks: false, client });
    if (links.length === 0) return { kind: 'accepted' };

    const template = buildLoginLinksEmailTemplate({
        recipientEmail: user.email,
        links: links.map(l => ({ organisationName: l.organisationName, url: l.loginPath ? `${publicBaseUrl()}${l.loginPath}` : null })),
    });
    const result = await sendTransactionalEmail({ to: user.email, subject: template.subject, html: template.html, text: template.text });
    if (!result.success) console.warn('[LOGIN LINK EMAIL] not delivered:', result.error);
    return { kind: 'accepted' };
}
