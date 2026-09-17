import request from 'supertest';
import app from '../src/index';
import crypto from 'crypto';
import { newDb, DataType } from 'pg-mem';
import { setPool, query, initDB } from '../src/services/db';
import { hashPassword } from '../src/services/auth';
import { clearAllRateLimits } from '../src/routes/auth';

describe('Secret Platform Admin Login (POST /api/auth/platform-login) Tests', () => {
    const platformEmail = 'superadmin@platform.system';
    const platformPassword = 'PlatformPassword2026!';
    const employeeEmail = 'employee@acme.corp';
    const employeePassword = 'EmployeePassword2026!';
    const companyAdminEmail = 'admin@acme.corp';
    const companyAdminPassword = 'CompanyAdminPassword2026!';

    const orgId = '11111111-1111-1111-1111-111111111111';
    const platformUserId = '99999999-9999-9999-9999-999999999999';
    const employeeUserId = '88888888-8888-8888-8888-888888888888';
    const companyAdminUserId = '77777777-7777-7777-7777-777777777777';

    beforeAll(async () => {
        clearAllRateLimits();
        const db = newDb();
        db.public.registerFunction({
            name: 'gen_random_uuid',
            args: [],
            returns: DataType.uuid,
            implementation: () => crypto.randomUUID(),
        });

        db.public.none(`
            CREATE TABLE organisations (
                id UUID PRIMARY KEY,
                name TEXT NOT NULL,
                slug TEXT UNIQUE,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE users (
                id UUID PRIMARY KEY,
                org_id UUID,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                role TEXT DEFAULT 'Employee',
                two_factor_enabled BOOLEAN DEFAULT false,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE organisation_members (
                id UUID PRIMARY KEY,
                organisation_id UUID NOT NULL,
                user_id UUID NOT NULL,
                role TEXT NOT NULL,
                UNIQUE(organisation_id, user_id)
            );

            CREATE TABLE two_factor_codes (
                id UUID PRIMARY KEY,
                user_id UUID NOT NULL,
                code_hash TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                attempts INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE audit_logs (
                id UUID PRIMARY KEY,
                org_id UUID,
                actor_id UUID,
                action TEXT NOT NULL,
                entity_type TEXT,
                entity_id UUID,
                details TEXT,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        const pHash = await hashPassword(platformPassword);
        const eHash = await hashPassword(employeePassword);
        const caHash = await hashPassword(companyAdminPassword);

        db.public.none(`INSERT INTO organisations (id, name, slug) VALUES ('${orgId}', 'Acme Corporation', 'acme-corp')`);

        // Platform Admin User
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role, two_factor_enabled) VALUES ('${platformUserId}', '${orgId}', '${platformEmail}', '${pHash}', 'Platform Admin', false)`);
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgId}', '${platformUserId}', 'Platform Admin')`);

        // Company Admin User
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role, two_factor_enabled) VALUES ('${companyAdminUserId}', '${orgId}', '${companyAdminEmail}', '${caHash}', 'Company Admin', false)`);
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgId}', '${companyAdminUserId}', 'Company Admin')`);

        // Regular Employee User
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role, two_factor_enabled) VALUES ('${employeeUserId}', '${orgId}', '${employeeEmail}', '${eHash}', 'Employee', false)`);
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgId}', '${employeeUserId}', 'Employee')`);

        const PgPool = db.adapters.createPg().Pool;
        setPool(new PgPool());
    });

    afterAll(async () => {
        clearAllRateLimits();
        await initDB('memory');
    });

    it('1. Rejects missing credentials with 400 Bad Request', async () => {
        const res = await request(app)
            .post('/api/auth/platform-login')
            .send({ email: platformEmail });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('2. Rejects invalid credentials with 401 Unauthorized', async () => {
        const res = await request(app)
            .post('/api/auth/platform-login')
            .send({
                email: platformEmail,
                password: 'WrongPassword123!'
            });

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it('3. Rejects regular Employee credentials with 403 Forbidden (Strict Role Enforcement)', async () => {
        const res = await request(app)
            .post('/api/auth/platform-login')
            .send({
                email: employeeEmail,
                password: employeePassword
            });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(res.body.error.message).toContain('Platform Administrator');
    });

    it('4. Rejects Company Admin credentials with 403 Forbidden (Strict Role Enforcement)', async () => {
        const res = await request(app)
            .post('/api/auth/platform-login')
            .send({
                email: companyAdminEmail,
                password: companyAdminPassword
            });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('5. Successfully authenticates valid Platform Admin credentials and issues platform session', async () => {
        const res = await request(app)
            .post('/api/auth/platform-login')
            .send({
                email: platformEmail,
                password: platformPassword
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.token).toBeDefined();
        expect(res.body.data.user.role).toBe('Platform Admin');
        expect(res.body.data.user.email).toBe(platformEmail);

        // Verify audit log was recorded
        const auditRes = await query(
            "SELECT * FROM audit_logs WHERE action = 'PLATFORM_LOGIN_SUCCESS' AND actor_id = $1",
            [platformUserId]
        );
        expect(auditRes.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('6. Supports Two-Factor Authentication (2FA) workflow for Platform Admin', async () => {
        // Enable 2FA on platform user
        await query('UPDATE users SET two_factor_enabled = true WHERE id = $1', [platformUserId]);

        const res = await request(app)
            .post('/api/auth/platform-login')
            .send({
                email: platformEmail,
                password: platformPassword
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.require_2fa).toBe(true);
        expect(res.body.temp_token).toBeDefined();

        const tempToken = res.body.temp_token;

        // Verify active OTP exists in DB
        const otpRecord = await query('SELECT * FROM two_factor_codes WHERE user_id = $1', [platformUserId]);
        expect(otpRecord.rows.length).toBe(1);

        // Verify OTP via /api/auth/verify-2fa with known code
        const knownCode = '765432';
        const codeHash = crypto.createHash('sha256').update(knownCode).digest('hex');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await query('DELETE FROM two_factor_codes WHERE user_id = $1', [platformUserId]);
        await query('INSERT INTO two_factor_codes (id, user_id, code_hash, expires_at, attempts) VALUES ($1, $2, $3, $4, 0)', [
            crypto.randomUUID(), platformUserId, codeHash, expiresAt
        ]);

        const verifyRes = await request(app)
            .post('/api/auth/verify-2fa')
            .send({
                temp_token: tempToken,
                code: knownCode
            });

        expect(verifyRes.status).toBe(200);
        expect(verifyRes.body.success).toBe(true);
        expect(verifyRes.body.data.token).toBeDefined();
        expect(verifyRes.body.data.user.role).toBe('Platform Admin');
    });
});
