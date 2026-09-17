const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

// Simple in-memory rate limiter for login
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function checkRateLimit(req, res, next) {
    const email = req.body.email || 'unknown';
    const key = `ratelimit:${email}`;
    
    const attempts = loginAttempts.get(key) || { count: 0, firstAttempt: Date.now() };
    
    // Reset if lockout period has passed
    if (Date.now() - attempts.firstAttempt > LOCKOUT_MS) {
        attempts.count = 0;
        attempts.firstAttempt = Date.now();
    }
    
    if (attempts.count >= MAX_ATTEMPTS) {
        return res.status(429).json({ success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts. Please try again later.', requestId: req.requestId }});
    }
    
    req.rateLimitKey = key;
    req.rateLimitAttempts = attempts;
    next();
}

function recordFailedLogin(req) {
    if (req.rateLimitKey && req.rateLimitAttempts) {
        req.rateLimitAttempts.count++;
        loginAttempts.set(req.rateLimitKey, req.rateLimitAttempts);
    }
}

function clearLoginAttempts(req) {
    if (req.rateLimitKey) {
        loginAttempts.delete(req.rateLimitKey);
    }
}

router.post('/login', checkRateLimit, async (req, res, next) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Email and password required.', requestId: req.requestId }});
        }

        const user = await db.getAsync('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
            console.log(`[AUTH] Failed login attempt for email=${email} req_id=${req.requestId}`);
            recordFailedLogin(req);
            return res.status(401).json({ success: false, error: { code: 'AUTH_FAILED', message: 'Invalid credentials.', requestId: req.requestId }});
        }

        if (user.is_active === 0) {
            console.log(`[AUTH] Failed login attempt for deactivated user_id=${user.id} req_id=${req.requestId}`);
            recordFailedLogin(req);
            return res.status(401).json({ success: false, error: { code: 'AUTH_FAILED', message: 'Invalid credentials.', requestId: req.requestId }});
        }

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            console.log(`[AUTH] Failed login attempt for user_id=${user.id} req_id=${req.requestId}`);
            recordFailedLogin(req);
            return res.status(401).json({ success: false, error: { code: 'AUTH_FAILED', message: 'Invalid credentials.', requestId: req.requestId }});
        }

        clearLoginAttempts(req);

        const token = jwt.sign(
            { userId: user.id, orgId: user.org_id, role: user.role },
            JWT_SECRET,
            { expiresIn: '12h' }
        );

        console.log(`[AUTH] Successful login for user_id=${user.id} req_id=${req.requestId}`);
        res.json({
            success: true,
            data: {
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role
                }
            }
        });
    } catch (err) {
        next(err);
    }
});

router.post('/reset-request', async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Email required.', requestId: req.requestId }});
        }

        const user = await db.getAsync('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);
        if (user) {
            const token = crypto.randomBytes(32).toString('hex');
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins
            
            await db.runAsync('INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [tokenHash, user.id, expiresAt]);
            
            // Mock email sending
            console.log(`\n========================================`);
            console.log(`MOCK EMAIL SENT TO: ${email}`);
            console.log(`SUBJECT: Password Reset Request`);
            console.log(`BODY: Click the link below to reset your password:`);
            console.log(`http://localhost:3003/?reset=${token}`);
            console.log(`========================================\n`);
        }
        
        // Generic success to prevent enumeration
        res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
    } catch (err) {
        next(err);
    }
});

router.post('/reset-password', async (req, res, next) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) {
            return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Token and new password required.', requestId: req.requestId }});
        }

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        
        // Find token and ensure not expired
        const record = await db.getAsync('SELECT * FROM reset_tokens WHERE token_hash = ?', [tokenHash]);
        
        if (!record || new Date(record.expires_at) < new Date()) {
            return res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'The reset link is invalid or has expired.', requestId: req.requestId }});
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        
        await db.runAsync('BEGIN TRANSACTION');
        try {
            await db.runAsync('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, record.user_id]);
            await db.runAsync('DELETE FROM reset_tokens WHERE token_hash = ?', [tokenHash]);
            await db.runAsync('COMMIT');
            res.json({ success: true, message: 'Password has been reset successfully.' });
        } catch (err) {
            await db.runAsync('ROLLBACK');
            throw err;
        }
    } catch (err) {
        next(err);
    }
});

router.post('/accept-invitation', async (req, res, next) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) {
            return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Token and password required.', requestId: req.requestId }});
        }

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        
        const record = await db.getAsync('SELECT * FROM invitation_tokens WHERE token_hash = ?', [tokenHash]);
        
        if (!record || new Date(record.expires_at) < new Date()) {
            return res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'The invitation link is invalid or has expired.', requestId: req.requestId }});
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        
        await db.runAsync('BEGIN TRANSACTION');
        try {
            await db.runAsync('UPDATE users SET password_hash = ?, is_active = 1 WHERE id = ?', [passwordHash, record.user_id]);
            await db.runAsync('DELETE FROM invitation_tokens WHERE token_hash = ?', [tokenHash]);
            await db.runAsync('COMMIT');
            res.json({ success: true, message: 'Account setup complete.' });
        } catch (err) {
            await db.runAsync('ROLLBACK');
            throw err;
        }
    } catch (err) {
        next(err);
    }
});

router.get('/me', requireAuth, async (req, res, next) => {
    try {
        const user = await db.getAsync('SELECT id, email, role, org_id, is_active FROM users WHERE id = ?', [req.user.userId]);
        if (!user || user.is_active === 0) {
            return res.status(401).json({ success: false, error: { code: 'AUTH_FAILED', message: 'User not found or deactivated.', requestId: req.requestId }});
        }
        res.json({ success: true, data: user });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
