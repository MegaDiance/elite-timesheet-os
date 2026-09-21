import { Request } from 'express';
import crypto from 'crypto';
import { query } from './db';

export interface ClientInfo {
    ip: string;
    userAgent: string;
    approxLocation: string;
    deviceInfo: string;
}

export interface RiskAssessment {
    isSuspicious: boolean;
    reason?: string;
    trigger?: 'UNRECOGNIZED_LOCATION' | 'UNRECOGNIZED_DEVICE' | 'SIMULATED_SUSPICIOUS';
}

/**
 * Returns the client IP as determined by Express.
 *
 * X-Forwarded-For is client-controlled, so it is only honoured through Express's
 * `trust proxy` setting (configured in index.ts from TRUST_PROXY; on by default in
 * production, where Railway adds exactly one proxy hop). Reading the header directly
 * would let any client choose its own rate-limit key.
 */
export function extractClientIp(req: Request): string {
    return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Resolves an IP to a conservative City, Region, Country location.
 * Does not use GPS. Strictly server-side heuristic.
 */
export function resolveApproximateLocation(ip: string, req?: Request): string {
    // 1. Check for loopback & private subnets (RFC 1918)
    const cleanIp = ip.replace(/^::ffff:/, '');
    if (
        cleanIp === '127.0.0.1' ||
        cleanIp === '::1' ||
        cleanIp.startsWith('10.') ||
        cleanIp.startsWith('192.168.') ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(cleanIp)
    ) {
        return 'Melbourne, Victoria, Australia';
    }

    // 2. Check if platform headers provide geo data
    if (req) {
        const country = (req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country']) as string;
        const city = (req.headers['x-vercel-ip-city'] || req.headers['x-city']) as string;
        const region = (req.headers['x-vercel-ip-country-region'] || req.headers['x-region']) as string;

        if (country && city) {
            return `${city}, ${region || ''}, ${country}`.replace(', ,', ',');
        }
    }

    // Conservative default for this application's target jurisdiction
    return 'Melbourne, Victoria, Australia';
}

/**
 * Parses user agent to a clean, human-readable summary
 */
export function parseDeviceSummary(userAgent?: string): string {
    if (!userAgent || typeof userAgent !== 'string') {
        return 'Unknown Device';
    }

    const ua = userAgent.toLowerCase();

    let os = 'Unknown OS';
    if (ua.includes('macintosh') || ua.includes('mac os')) os = 'macOS';
    else if (ua.includes('windows')) os = 'Windows';
    else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
    else if (ua.includes('android')) os = 'Android';
    else if (ua.includes('linux')) os = 'Linux';

    let browser = 'Browser';
    if (ua.includes('edg/')) browser = 'Edge';
    else if (ua.includes('chrome/') && !ua.includes('edg/')) browser = 'Chrome';
    else if (ua.includes('safari/') && !ua.includes('chrome/')) browser = 'Safari';
    else if (ua.includes('firefox/')) browser = 'Firefox';

    return `${browser} on ${os}`;
}

/**
 * Gathers complete client connection and device metadata
 */
export function parseClientInfo(req: Request): ClientInfo {
    const ip = extractClientIp(req);
    const userAgent = (req.headers['user-agent'] as string) || '';
    const approxLocation = resolveApproximateLocation(ip, req);
    const deviceInfo = parseDeviceSummary(userAgent);

    return {
        ip,
        userAgent,
        approxLocation,
        deviceInfo
    };
}

/**
 * Analyzes previous successful logins to detect anomalous or suspicious context.
 * Does not trigger on normal IP drift within the same metro/region.
 */
export async function assessLoginRisk(
    userId: string,
    clientInfo: ClientInfo,
    req?: Request
): Promise<RiskAssessment> {
    // 1. Test-only hook to force the challenge path. Ignored outside NODE_ENV=test.
    if (process.env.NODE_ENV === 'test' && req?.headers['x-test-simulate-suspicious'] === 'true') {
        return {
            isSuspicious: true,
            reason: 'Simulated suspicious login condition for testing',
            trigger: 'SIMULATED_SUSPICIOUS'
        };
    }

    try {
        // Query recent successful logins for this user (up to 15)
        const historyRes = await query(
            `SELECT ip_address, approx_location, device_info, created_at 
             FROM login_history 
             WHERE user_id = $1 AND status = 'SUCCESS' 
             ORDER BY created_at DESC 
             LIMIT 15`,
            [userId]
        );

        const history = historyRes.rows;

        // If no prior logins, establish baseline without blocking
        if (history.length === 0) {
            return { isSuspicious: false };
        }

        // Check known locations and devices
        const knownLocations = new Set(history.map((h: any) => (h.approx_location || '').toLowerCase().trim()));
        const knownDevices = new Set(history.map((h: any) => (h.device_info || '').toLowerCase().trim()));

        const currentLoc = clientInfo.approxLocation.toLowerCase().trim();
        const currentDev = clientInfo.deviceInfo.toLowerCase().trim();

        const isKnownLocation = knownLocations.has(currentLoc);
        const isKnownDevice = knownDevices.has(currentDev);

        // If location is completely new AND device is new, flag as suspicious
        if (!isKnownLocation && !isKnownDevice && history.length >= 2) {
            return {
                isSuspicious: true,
                reason: `New login location (${clientInfo.approxLocation}) and unrecognized device (${clientInfo.deviceInfo})`,
                trigger: 'UNRECOGNIZED_LOCATION'
            };
        }

        return { isSuspicious: false };
    } catch (err: any) {
        if (err.message && err.message.includes('relation "login_history" does not exist')) {
            return { isSuspicious: false };
        }
        console.error('[RISK ASSESSMENT ERROR]', err);
        return { isSuspicious: false };
    }
}

/**
 * Creates a single-use login verification challenge
 */
export async function createLoginChallenge(
    userId: string,
    orgId: string | undefined,
    role: string | undefined,
    clientInfo: ClientInfo
): Promise<{ token: string; code: string; challengeId: string }> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const code = Math.floor(100000 + crypto.randomInt(900000)).toString();
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const challengeId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

    try {
        await query(
            `INSERT INTO login_verification_challenges 
                (id, user_id, org_id, role, token_hash, verification_code, ip_address, approx_location, user_agent, device_info, expires_at, consumed, attempts)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, 0)`,
            [
                challengeId,
                userId,
                orgId || null,
                role || null,
                tokenHash,
                codeHash,
                clientInfo.ip,
                clientInfo.approxLocation,
                clientInfo.userAgent,
                clientInfo.deviceInfo,
                expiresAt
            ]
        );
    } catch {
        // Fallback for mock schemas missing the attempts column
        await query(
            `INSERT INTO login_verification_challenges 
                (id, user_id, org_id, role, token_hash, verification_code, ip_address, approx_location, user_agent, device_info, expires_at, consumed)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false)`,
            [
                challengeId,
                userId,
                orgId || null,
                role || null,
                tokenHash,
                codeHash,
                clientInfo.ip,
                clientInfo.approxLocation,
                clientInfo.userAgent,
                clientInfo.deviceInfo,
                expiresAt
            ]
        );
    }

    return { token: rawToken, code, challengeId };
}
