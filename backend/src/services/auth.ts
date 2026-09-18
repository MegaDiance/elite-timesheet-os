import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const SALT_ROUNDS = 10;
if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'super_secret_jwt_key_for_local_dev') {
        throw new Error('FATAL SECURITY ERROR: JWT_SECRET environment variable must be set to a secure secret in production.');
    }
}
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_for_local_dev';

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

export function generateToken(payload: object, expiresIn: string = '24h'): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn as any });
}

export function verifyToken(token: string): any {
    return jwt.verify(token, JWT_SECRET);
}

export function generateTempToken(payload: object, expiresIn: string = '10m'): string {
    return jwt.sign({ ...payload, scope: '2fa_pending' }, JWT_SECRET, { expiresIn: expiresIn as any });
}

export function verifyTempToken(token: string): any {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (decoded?.scope !== '2fa_pending') {
        throw new Error('Invalid token scope for two-factor verification');
    }
    return decoded;
}

