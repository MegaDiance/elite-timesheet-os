import argon2 from 'argon2';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

/**
 * Passwords are hashed with Argon2id at OWASP's recommended settings (19 MiB, 2 passes, 1 lane).
 * Hashes made before that are bcrypt; they still verify, and are replaced with an Argon2id hash
 * the next time the person signs in (needsRehash).
 */
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const isArgon2 = (hash: string) => hash.startsWith('$argon2');
if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'super_secret_jwt_key_for_local_dev') {
        throw new Error('FATAL SECURITY ERROR: JWT_SECRET environment variable must be set to a secure secret in production.');
    }
}
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_for_local_dev';

export async function hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
    if (typeof hash !== 'string' || !hash) return false;
    try {
        return isArgon2(hash) ? await argon2.verify(hash, password) : await bcrypt.compare(password, hash);
    } catch {
        return false; // a malformed stored hash never matches
    }
}

/** True for a hash that should be replaced with a current Argon2id hash (an older bcrypt one, or weaker settings). */
export function needsRehash(hash: string): boolean {
    if (!isArgon2(hash)) return true;
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
}

/**
 * Session token. Carries identity only: the user (`sub`) and the server session (`sid`).
 * Organisation, role and branch scope are resolved from the database on every request.
 */
export function generateToken(payload: { sub: string; sid: string }, expiresIn: string = '24h'): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn as any });
}

export function verifyToken(token: string): any {
    return jwt.verify(token, JWT_SECRET);
}

/**
 * Short-lived token for the second login step. `org` records which organisation the first
 * step was for; access to it is re-resolved before any session is created.
 */
export function generateTempToken(payload: { sub: string; org: string }, expiresIn: string = '10m'): string {
    return jwt.sign({ ...payload, scope: '2fa_pending' }, JWT_SECRET, { expiresIn: expiresIn as any });
}

export function verifyTempToken(token: string): { sub: string; org: string } {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (decoded?.scope !== '2fa_pending' || !decoded.sub || !decoded.org) {
        throw new Error('Invalid token scope for two-factor verification');
    }
    return decoded;
}
