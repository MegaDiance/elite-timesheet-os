import crypto from 'crypto';
import { query, withTransaction } from './db';
import { comparePassword, hashPassword } from './auth';
import { ClientInfo } from './securityService';
import { accountRateLimitKey, clearRateLimit, isRateLimited, isValidEmail, publicBaseUrl, recordFailedAttempt, sha256Hex } from './authUtils';
import { issuePortalLink } from './portalLink';
import { writeAudit } from './policy';
import { recordLoginAttempt } from './sessionService';
import { buildLoginLinkRecoveredEmailTemplate, isEmailSendingEnabled, sendTransactionalEmail } from './emailService';

/**
 * Owner-only recovery of an organisation's private sign-in link.
 *
 * There is deliberately no sign-in here and no session is created. The only way to get the link
 * back is to prove three things together — the Organisation Owner's email, the organisation's
 * name, and that owner's password — and what comes back is a NEW link (the previous one is
 * replaced, which revokes it), never the old one.
 *
 * Everything that could distinguish "no such organisation" from "wrong password" is avoided:
 *   - one indexed lookup by (owner email, organisation name), then a bcrypt comparison that always
 *     runs, against a dummy hash when nothing matched;
 *   - every check (password, owner active, organisation active, exactly one match) is evaluated
 *     before the outcome is chosen, and every failure is the same response;
 *   - the rate-limit keys are built only from what the caller submitted, never from what exists.
 */

const dummyPasswordHash = hashPassword(crypto.randomUUID());

export const NAME_MAX_LENGTH = 120; // the same limit as signup and settings
const PASSWORD_MAX_LENGTH = 1024;

// ---------------------------------------------------------------------------
// Progressive lockout
// ---------------------------------------------------------------------------

interface Bucket { failures: number; strikes: number; lockedUntil: number; touched: number }

const IP_FAILURES_BEFORE_LOCK = 10; // an office can share one address, so this is looser than the per-target limit
const TARGET_FAILURES_BEFORE_LOCK = 5;
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

/** The submitted values, normalised the way they are compared — the same for real and made-up organisations. */
export function normaliseOrganisationName(raw: string): string {
    return raw.trim();
}

/**
 * The same comparison in SQL: edge whitespace removed (as `trim()` does), case folded, nothing else.
 * Inner whitespace is never collapsed. Used by recovery and by the duplicate-name checks so that
 * "the same name" means one thing everywhere.
 */
export const SQL_NAME_KEY = (column: string) => `LOWER(regexp_replace(${column}, '^\\s+|\\s+$', '', 'g'))`;

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

/** Two spellings of the same name — case, Unicode compatibility forms, edge whitespace — count as one target. */
const foldForKey = (value: string) => normaliseOrganisationName(value).normalize('NFKC').toLowerCase();

const limitKeys = (ip: string, email: string, orgName: string) => ({
    ip: `recover:ip:${ipLimitKey(ip)}`,
    // One organisation name for one email: the pair being guessed at.
    target: `recover:target:${sha256Hex(`${email}\n${foldForKey(orgName)}`)}`,
    // The email alone, so trying many organisation names against one email escalates too.
    email: `recover:email:${sha256Hex(email)}`,
    // The sign-in page's per-account budget, shared so recovery cannot guess faster than it.
    account: accountRateLimitKey(email),
});

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export type RecoveryOutcome =
    | { kind: 'rate-limited' }
    | { kind: 'unverified' }
    | { kind: 'recovered'; loginPath: string; loginUrl: string; expiresAt: string | null };

type FailureReason = 'NOT_FOUND' | 'AMBIGUOUS_NAME' | 'PASSWORD_INCORRECT' | 'OWNER_INACTIVE' | 'ORGANISATION_INACTIVE' | 'OWNERSHIP_CHANGED';

const describeClient = (c: ClientInfo) => `${c.deviceInfo}, ${c.approxLocation}`;

/**
 * True when `ownerId` already owns an organisation called `name` (compared the way recovery
 * compares names). Recovery names its target by owner email + organisation name, so one owner
 * must not have two organisations that answer to the same name.
 */
export async function ownerHasOrganisationNamed(ownerId: string, name: string, exceptOrgId?: string): Promise<boolean> {
    const res = await query(
        `SELECT 1 FROM organisations
          WHERE owner_user_id = $1 AND ${SQL_NAME_KEY('name')} = LOWER($2) AND ($3::uuid IS NULL OR id <> $3::uuid)
          LIMIT 1`,
        [ownerId, normaliseOrganisationName(name), exceptOrgId ?? null]
    );
    return res.rows.length > 0;
}

export async function recoverLoginLink(
    input: { organisation_name?: unknown; email?: unknown; password?: unknown },
    client: ClientInfo
): Promise<RecoveryOutcome> {
    const { organisation_name: rawName, email: rawEmail, password } = input;
    const ip = client.ip || '127.0.0.1';

    // Malformed or missing input is not told apart from a wrong answer: it gets the same response,
    // takes about as long, and counts against the address. (The form checks these fields itself;
    // this only stops the API describing what a "well-formed" attempt looks like.)
    if (
        typeof rawName !== 'string' || !normaliseOrganisationName(rawName) || normaliseOrganisationName(rawName).length > NAME_MAX_LENGTH ||
        !isValidEmail(rawEmail) ||
        typeof password !== 'string' || !password || password.length > PASSWORD_MAX_LENGTH
    ) {
        const ipKey = `recover:ip:${ipLimitKey(ip)}`;
        if (isLocked(ipKey)) return { kind: 'rate-limited' };
        await comparePassword('x', await dummyPasswordHash);
        recordFailure(ipKey, IP_FAILURES_BEFORE_LOCK);
        return { kind: 'unverified' };
    }

    const email = rawEmail.trim().toLowerCase();
    const orgName = normaliseOrganisationName(rawName);
    const keys = limitKeys(ip, email, orgName);

    if (isLocked(keys.ip) || isLocked(keys.target) || isLocked(keys.email) || isRateLimited(keys.account)) {
        return { kind: 'rate-limited' };
    }

    // The owner of an organisation with this name and this email. Anyone who is not organisations.owner_user_id
    // (a Branch Admin, an Accountant, an Employee, any other role holder) cannot match this join.
    const found = await query(
        `SELECT o.id AS org_id, o.name AS org_name, o.is_active AS org_active,
                u.id AS user_id, u.email, u.is_active AS user_active, u.password_hash
           FROM users u
           JOIN organisations o ON o.owner_user_id = u.id
          WHERE LOWER(u.email) = $1 AND ${SQL_NAME_KEY('o.name')} = LOWER($2)`,
        [email, orgName]
    );
    const candidate = found.rows[0];

    // Always compare, so the time taken does not say whether the organisation or the email exists.
    const passwordOk = await comparePassword(password, candidate?.password_hash || await dummyPasswordHash);

    let reason: FailureReason | null = null;
    if (!candidate) reason = 'NOT_FOUND';
    else if (found.rows.length > 1) reason = 'AMBIGUOUS_NAME';
    else if (!candidate.password_hash || !passwordOk) reason = 'PASSWORD_INCORRECT';
    else if (!candidate.user_active) reason = 'OWNER_INACTIVE';
    else if (!candidate.org_active) reason = 'ORGANISATION_INACTIVE';

    let link: Awaited<ReturnType<typeof rotateLink>> = null;
    if (!reason) {
        link = await rotateLink(candidate.org_id, candidate.user_id);
        if (!link) reason = 'OWNERSHIP_CHANGED';
    }

    if (reason || !link) return fail(reason ?? 'OWNERSHIP_CHANGED', candidate, email, keys, client);

    // Verified. The failure counters for this target start again; the IP counter is left alone.
    buckets.delete(keys.target);
    buckets.delete(keys.email);
    clearRateLimit(keys.account);

    await writeAudit({
        orgId: candidate.org_id, actorId: candidate.user_id, action: 'LOGIN_LINK_RECOVERY_SUCCESS', entityType: 'organisation', entityId: candidate.org_id,
        details: `Owner recovered the private login link from ${describeClient(client)}`, ip: client.ip,
    });
    await writeAudit({
        orgId: candidate.org_id, actorId: candidate.user_id, action: 'LOGIN_LINK_ROTATED', entityType: 'organisation', entityId: candidate.org_id,
        details: `Private login link replaced during recovery; the previous link no longer works${link.expiresAt ? `, new link expires ${link.expiresAt}` : ', no expiry'}`, ip: client.ip,
    });
    await notifyOwner(candidate, client);

    return { kind: 'recovered', loginPath: link.path, loginUrl: `${publicBaseUrl()}${link.path}`, expiresAt: link.expiresAt };
}

/**
 * Replaces the organisation's link. The organisation row is locked and ownership is checked again
 * in the same transaction, so a concurrent ownership transfer or second recovery cannot interleave.
 * An expiry the Owner chose is kept while it is still in the future; an already-expired link (a
 * common reason to recover) is replaced by one with no expiry.
 */
async function rotateLink(orgId: string, ownerId: string) {
    return withTransaction(async (tx) => {
        const locked = await tx(
            'SELECT portal_link_expires_at FROM organisations WHERE id = $1 AND owner_user_id = $2 AND is_active = true FOR UPDATE',
            [orgId, ownerId]
        );
        const row = locked.rows[0];
        if (!row) return null;
        const expiry = row.portal_link_expires_at ? new Date(row.portal_link_expires_at) : null;
        return issuePortalLink(orgId, expiry && expiry.getTime() > Date.now() ? expiry : null, tx);
    });
}

async function fail(
    reason: FailureReason,
    candidate: { org_id: string; user_id: string } | undefined,
    email: string,
    keys: ReturnType<typeof limitKeys>,
    client: ClientInfo
): Promise<RecoveryOutcome> {
    const ipLocked = recordFailure(keys.ip, IP_FAILURES_BEFORE_LOCK);
    const targetLocked = recordFailure(keys.target, TARGET_FAILURES_BEFORE_LOCK);
    const emailLocked = recordFailure(keys.email, TARGET_FAILURES_BEFORE_LOCK);
    recordFailedAttempt(keys.account);

    // Every failed attempt goes to the sign-in security log (the organisation may not exist, so it
    // has no organisation). It never stores the password or anything derived from what was typed
    // besides the email address, exactly like a failed sign-in.
    await recordLoginAttempt({
        userId: candidate?.user_id, orgId: candidate?.org_id, email, status: 'FAILED', clientInfo: client, authMethod: 'login_link_recovery',
    });
    if (ipLocked || targetLocked || emailLocked) {
        await recordLoginAttempt({ userId: candidate?.user_id, orgId: candidate?.org_id, email, status: 'RATE_LIMITED', clientInfo: client, authMethod: 'login_link_recovery' });
    }

    // When the attempt names a real organisation and its owner, that organisation's audit trail shows it too.
    if (candidate) {
        await writeAudit({
            orgId: candidate.org_id, actorId: null, targetUserId: candidate.user_id, action: 'LOGIN_LINK_RECOVERY_FAILURE', entityType: 'organisation', entityId: candidate.org_id,
            details: `Login link recovery was not verified (${reason}) from ${describeClient(client)}`, ip: client.ip,
        });
    }
    return { kind: 'unverified' };
}

/**
 * Tells the owner, by email, that their login link was recovered and replaced. The message never
 * contains the link. While email is off (local development, MVP) nothing is sent, and a delivery
 * failure never affects the recovery: the audit log is the record either way.
 */
async function notifyOwner(owner: { email: string; org_id: string; org_name: string }, client: ClientInfo): Promise<void> {
    if (!isEmailSendingEnabled()) return;
    try {
        const template = buildLoginLinkRecoveredEmailTemplate({
            organisationName: owner.org_name, when: new Date().toUTCString(), deviceInfo: client.deviceInfo, approxLocation: client.approxLocation,
        });
        const result = await sendTransactionalEmail({ to: owner.email, subject: template.subject, html: template.html, text: template.text });
        if (!result.success) console.warn('[LOGIN LINK RECOVERY] notification not delivered:', result.error);
    } catch (err) {
        console.warn('[LOGIN LINK RECOVERY] notification failed:', err instanceof Error ? err.message : 'unknown error');
    }
}
