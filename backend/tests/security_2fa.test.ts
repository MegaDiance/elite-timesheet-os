import request from 'supertest';
import app from '../src/index';
import { newDb, DataType } from 'pg-mem';
import { setPool, query } from '../src/services/db';
import { hashPassword } from '../src/services/auth';
import crypto from 'crypto';

describe('Two-Step Verification (2FA), Password Reset, & Security Hardening Integration Tests', () => {
    const testOrgId = '123e4567-e89b-12d3-a456-777777777777';
    const testUserId = '123e4567-e89b-12d3-a456-888888888888';
    const testEmail = 'secure_user@elite.local';
    const testPassword = 'InitialSecurePassword123!';

    beforeAll(async () => {
        const db = newDb();
        db.public.registerFunction({
            name: 'gen_random_uuid',
            args: [],
            returns: DataType.uuid,
            implementation: () => '123e4567-e89b-12d3-a456-' + Math.floor(Math.random() * 10000000),
        });

        db.public.none(`
            CREATE TABLE organisations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                role TEXT DEFAULT 'Employee',
                is_active BOOLEAN DEFAULT true,
                two_factor_enabled BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE organisation_members (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                organisation_id UUID NOT NULL,
                user_id UUID NOT NULL,
                role TEXT NOT NULL,
                UNIQUE(organisation_id, user_id)
            );

            CREATE TABLE two_factor_codes (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                code_hash TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                attempts INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE reset_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id UUID NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL
            );

            CREATE TABLE audit_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID,
                timestamp TIMESTAMPTZ DEFAULT NOW(),
                actor_id UUID,
                action TEXT NOT NULL,
                entity_type TEXT,
                entity_id UUID,
                details TEXT
            );
        `);

        const hash = await hashPassword(testPassword);
        db.public.none(`INSERT INTO organisations (id, name) VALUES ('${testOrgId}', 'Security Test Corp')`);
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role, two_factor_enabled) VALUES ('${testUserId}', '${testOrgId}', '${testEmail}', '${hash}', 'Manager', true)`);
        db.public.none(`INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ('${testOrgId}', '${testUserId}', 'Manager')`);

        const PgPool = db.adapters.createPg().Pool;
        setPool(new PgPool());
    });

    describe('Two-Step Verification (2FA) Workflow', () => {
        let tempToken: string;

        it('should require 2FA on login with valid credentials and dispatch an OTP', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: testEmail,
                    password: testPassword
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.require_2fa).toBe(true);
            expect(res.body.temp_token).toBeDefined();
            expect(res.body.masked_email).toContain('@');

            tempToken = res.body.temp_token;

            // Verify two_factor_codes table has an active OTP hash
            const dbCheck = await query('SELECT * FROM two_factor_codes WHERE user_id = $1', [testUserId]);
            expect(dbCheck.rows.length).toBe(1);
            expect(dbCheck.rows[0].attempts).toBe(0);
        });

        it('should reject 2FA verification with an incorrect OTP code', async () => {
            const res = await request(app)
                .post('/api/auth/verify-2fa')
                .send({
                    temp_token: tempToken,
                    code: '000000' // wrong code
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.message).toContain('remaining');

            // Verify attempt counter was incremented
            const dbCheck = await query('SELECT attempts FROM two_factor_codes WHERE user_id = $1', [testUserId]);
            expect(dbCheck.rows[0].attempts).toBe(1);
        });

        it('should successfully complete 2FA verification with the correct OTP code and issue session token', async () => {
            // Generate known OTP and store in DB
            const correctCode = '654321';
            const codeHash = crypto.createHash('sha256').update(correctCode).digest('hex');
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

            await query('DELETE FROM two_factor_codes WHERE user_id = $1', [testUserId]);
            await query('INSERT INTO two_factor_codes (id, user_id, code_hash, expires_at, attempts) VALUES ($1, $2, $3, $4, 0)', [
                crypto.randomUUID(), testUserId, codeHash, expiresAt
            ]);

            const res = await request(app)
                .post('/api/auth/verify-2fa')
                .send({
                    temp_token: tempToken,
                    code: correctCode
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.token).toBeDefined();
            expect(res.body.data.user.email).toBe(testEmail);
            expect(res.body.data.user.role).toBe('Manager');

            // Verify the used OTP code was deleted
            const dbCheck = await query('SELECT * FROM two_factor_codes WHERE user_id = $1', [testUserId]);
            expect(dbCheck.rows.length).toBe(0);
        });
    });

    describe('Password Reset Workflow', () => {
        let resetToken: string;

        it('should accept forgot-password request and store single-use reset token', async () => {
            const res = await request(app)
                .post('/api/auth/forgot-password')
                .send({ email: testEmail });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toContain('sent');

            const tokenRes = await query('SELECT token_hash FROM reset_tokens WHERE user_id = $1', [testUserId]);
            expect(tokenRes.rows.length).toBe(1);
            resetToken = tokenRes.rows[0].token_hash;
        });

        it('should verify that the reset token is valid via GET /api/auth/verify-reset-token', async () => {
            const res = await request(app)
                .get(`/api/auth/verify-reset-token?token=${resetToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.valid).toBe(true);
            expect(res.body.email).toBeDefined();
        });

        it('should reject weak passwords during password reset', async () => {
            // Less than 8 chars
            const shortRes = await request(app)
                .post('/api/auth/reset-password')
                .send({ token: resetToken, password: 'short' });
            expect(shortRes.status).toBe(400);

            // Numbers only
            const numRes = await request(app)
                .post('/api/auth/reset-password')
                .send({ token: resetToken, password: '123456789' });
            expect(numRes.status).toBe(400);
        });

        it('should reset password with strong credentials and invalidate reset token', async () => {
            const newPassword = 'BrandNewSecurePassword2026!';
            const res = await request(app)
                .post('/api/auth/reset-password')
                .send({
                    token: resetToken,
                    password: newPassword
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            // Verify reset token was deleted
            const tokenCheck = await query('SELECT * FROM reset_tokens WHERE token_hash = $1', [resetToken]);
            expect(tokenCheck.rows.length).toBe(0);

            // Verify new password can be used to authenticate
            const loginRes = await request(app)
                .post('/api/auth/login')
                .send({
                    email: testEmail,
                    password: newPassword
                });

            expect(loginRes.status).toBe(200);
            expect(loginRes.body.require_2fa).toBe(true);
        });
    });

    describe('Security Response Headers & Sanitization', () => {
        it('should include enterprise security headers on all responses', async () => {
            const res = await request(app).get('/api/auth/verify-reset-token');
            expect(res.headers['x-content-type-options']).toBe('nosniff');
            expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
            expect(res.headers['x-xss-protection']).toBe('1; mode=block');
            expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
        });
    });
});
