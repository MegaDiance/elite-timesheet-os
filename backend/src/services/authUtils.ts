import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { parseClientInfo } from './securityService';

// ---------------------------------------------------------------------------
// Rate limiting (per email when one is supplied, otherwise per client IP)
// ---------------------------------------------------------------------------
const rateLimits = new Map<string, { count: number; firstAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface RateLimitedRequest extends Request {
    rateLimitKey?: string;
}

export function checkRateLimit(req: RateLimitedRequest, res: Response, next: NextFunction) {
    const rawEmail = req.body?.email;
    const key = typeof rawEmail === 'string' && rawEmail.trim()
        ? `email:${rawEmail.trim().toLowerCase()}`
        : `ip:${parseClientInfo(req).ip || '127.0.0.1'}`;

    const attempts = rateLimits.get(key);
    if (attempts && Date.now() - attempts.firstAttempt > LOCKOUT_MS) {
        rateLimits.delete(key);
    } else if (attempts && attempts.count >= MAX_ATTEMPTS) {
        return res.status(429).json({
            success: false,
            error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please try again in 15 minutes.' }
        });
    }

    req.rateLimitKey = key;
    next();
}

/** Counts every call (not only failures). For unauthenticated endpoints that send email. */
export function throttle(req: RateLimitedRequest, res: Response, next: NextFunction) {
    checkRateLimit(req, res, () => {
        recordFailedAttempt(req.rateLimitKey);
        next();
    });
}

export function recordFailedAttempt(key?: string) {
    if (!key) return;
    const attempts = rateLimits.get(key) || { count: 0, firstAttempt: Date.now() };
    attempts.count++;
    rateLimits.set(key, attempts);
}

export function clearRateLimit(key?: string) {
    if (key) rateLimits.delete(key);
}

export function clearAllRateLimits() {
    rateLimits.clear();
}

// ---------------------------------------------------------------------------
// Passwords, tokens, links
// ---------------------------------------------------------------------------
export function isStrongPassword(password: unknown): { valid: boolean; reason?: string } {
    if (typeof password !== 'string' || password.length < 8) {
        return { valid: false, reason: 'Password must be at least 8 characters long.' };
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        return { valid: false, reason: 'Password must contain both letters and numbers.' };
    }
    return { valid: true };
}

export function sha256Hex(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

export function hashesEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a || '', 'utf8');
    const bufB = Buffer.from(b || '', 'utf8');
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/** A 256-bit single-use token. Only the hash is ever stored; the raw value is only ever emailed. */
export function newSecretToken(): { raw: string; hash: string } {
    const raw = crypto.randomBytes(32).toString('hex');
    return { raw, hash: sha256Hex(raw) };
}

/** Identifier in an organisation's private sign-in link. An entry point only — it grants nothing. */
export function newPortalSlug(): string {
    return crypto.randomBytes(12).toString('hex');
}

export function newSixDigitCode(): { code: string; hash: string } {
    const code = (100000 + crypto.randomInt(900000)).toString();
    return { code, hash: sha256Hex(code) };
}

/**
 * Base URL for links placed in emails. Always from server configuration — never from the
 * request's Origin/Host headers, which the requester controls.
 */
export function publicBaseUrl(): string {
    const configured = process.env.PUBLIC_URL
        || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined)
        || process.env.FRONTEND_URL
        || 'http://localhost:3000';
    return configured.replace(/\/+$/, '');
}

export function maskEmail(email: string): string {
    if (!email || !email.includes('@')) return 'your email';
    const [name, domain] = email.split('@');
    if (name.length <= 2) {
        return `${name[0]}***@${domain}`;
    }
    return `${name.slice(0, 2)}***${name.slice(-1)}@${domain}`;
}

export function isValidEmail(email: unknown): email is string {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.length <= 254;
}

export function escapeHtml(value: string): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
