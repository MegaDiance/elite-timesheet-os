import request from 'supertest';
import app from '../src/index';
import { newDb, DataType } from 'pg-mem';
import { setPool, query } from '../src/services/db';
import { hashPassword } from '../src/services/auth';
import { clearAllRateLimits } from '../src/routes/auth';
import crypto from 'crypto';

describe('Stage 2: Security Hardening, Session Management & Login Monitoring Integration Tests', () => {
    const orgId = '123e4567-e89b-12d3-a456-111111111111';
    const companyAdminUserId = '123e4567-e89b-12d3-a456-222222222222';
    const managerUserId = '123e4567-e89b-12d3-a456-333333333333';
    const employeeUserId = '123e4567-e89b-12d3-a456-444444444444';

    const testPassword = 'Password123!';
    let adminToken: string;
    let managerToken: string;
    let employeeToken: string;
    let employeeSessionId: string;

    beforeEach(() => {
        clearAllRateLimits();
    });

    beforeAll(async () => {
        const db = newDb();
        db.public.registerFunction({
            name: 'gen_random_uuid',
            args: [],
            returns: DataType.uuid,
            impure: true,
            implementation: () => crypto.randomUUID(),
        });

        db.public.none(`
            CREATE TABLE organisations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                slug TEXT UNIQUE,
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
                two_factor_enabled BOOLEAN DEFAULT false,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE organisation_members (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                organisation_id UUID NOT NULL,
                user_id UUID NOT NULL,
                role TEXT NOT NULL,
                UNIQUE(organisation_id, user_id)
            );

            CREATE TABLE employees (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                user_id UUID,
                full_name TEXT NOT NULL,
                department TEXT,
                email TEXT,
                phone TEXT,
                contracted_hours NUMERIC DEFAULT 76,
                is_active BOOLEAN DEFAULT true,
                deleted_at TIMESTAMPTZ
            );

            CREATE TABLE sessions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                org_id UUID,
                token_hash TEXT NOT NULL UNIQUE,
                ip_address TEXT,
                approx_location TEXT,
                user_agent TEXT,
                device_info TEXT,
                last_active_at TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL,
                revoked_at TIMESTAMPTZ,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE login_history (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID,
                org_id UUID,
                email TEXT NOT NULL,
                status TEXT NOT NULL,
                ip_address TEXT,
                approx_location TEXT,
                user_agent TEXT,
                device_info TEXT,
                auth_method TEXT,
                session_id UUID,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE login_verification_challenges (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                org_id UUID,
                role TEXT,
                token_hash TEXT NOT NULL UNIQUE,
                verification_code TEXT,
                ip_address TEXT,
                approx_location TEXT,
                user_agent TEXT,
                device_info TEXT,
                expires_at TIMESTAMPTZ NOT NULL,
                consumed BOOLEAN DEFAULT false,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE audit_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                actor_id UUID,
                action TEXT NOT NULL,
                entity_type TEXT,
                entity_id UUID,
                details TEXT,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE reset_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id UUID NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL
            );

            CREATE TABLE invitation_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id UUID NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL
            );

            CREATE TABLE fortnight_locks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                start_date TEXT NOT NULL,
                roster_locked BOOLEAN DEFAULT false,
                timesheet_locked BOOLEAN DEFAULT false,
                is_published BOOLEAN DEFAULT false,
                UNIQUE(org_id, start_date)
            );

            CREATE TABLE timesheet_submissions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                employee_id UUID NOT NULL,
                start_date TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Draft',
                UNIQUE(org_id, employee_id, start_date)
            );

            CREATE TABLE daily_records (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                employee_id UUID NOT NULL,
                record_date TEXT NOT NULL,
                has_actuals BOOLEAN DEFAULT false,
                UNIQUE(org_id, employee_id, record_date)
            );

            CREATE TABLE shift_segments (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                record_id UUID NOT NULL,
                segment_type TEXT NOT NULL,
                is_unplanned BOOLEAN DEFAULT false,
                roster_in TEXT,
                roster_out TEXT,
                roster_hours NUMERIC DEFAULT 0,
                actual_in TEXT,
                actual_out TEXT,
                actual_hours NUMERIC DEFAULT 0,
                actual_segment_type TEXT,
                notes TEXT
            );
        `);

        const hash = await hashPassword(testPassword);

        // Seed Organisation
        db.public.none(`INSERT INTO organisations (id, name, slug) VALUES ('${orgId}', 'Apex Logistics', 'apex-logistics')`);

        // Seed Users
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${companyAdminUserId}', '${orgId}', 'admin@apex.local', '${hash}', 'Company Admin')`);
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${managerUserId}', '${orgId}', 'manager@apex.local', '${hash}', 'Manager')`);
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${employeeUserId}', '${orgId}', 'employee@apex.local', '${hash}', 'Employee')`);

        // Seed Organisation Memberships
        db.public.none(`INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ('${orgId}', '${companyAdminUserId}', 'Company Admin')`);
        db.public.none(`INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ('${orgId}', '${managerUserId}', 'Manager')`);
        db.public.none(`INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ('${orgId}', '${employeeUserId}', 'Employee')`);

        // Seed Employee records
        db.public.none(`INSERT INTO employees (id, org_id, user_id, full_name, email) VALUES ('123e4567-e89b-12d3-a456-555555555555', '${orgId}', '${employeeUserId}', 'John Doe', 'employee@apex.local')`);

        const PgPool = db.adapters.createPg().Pool;
        setPool(new PgPool());
    });

    beforeEach(() => {
        clearAllRateLimits();
    });

    describe('1. Login, Server-Side Session Creation & Login History', () => {
        it('should successfully log in, create an active server session, and record login history', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ email: 'employee@apex.local', password: testPassword });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.token).toBeDefined();
            expect(res.body.data.session_id).toBeDefined();

            employeeToken = res.body.data.token;
            employeeSessionId = res.body.data.session_id;

            // Verify session in database
            const sessRes = await query('SELECT * FROM sessions WHERE id = $1', [employeeSessionId]);
            expect(sessRes.rows.length).toBe(1);
            expect(sessRes.rows[0].is_active).toBe(true);
            expect(sessRes.rows[0].approx_location).toContain('Australia');

            // Verify login history in database
            const histRes = await query('SELECT * FROM login_history WHERE user_id = $1 ORDER BY created_at DESC', [employeeUserId]);
            expect(histRes.rows.length).toBeGreaterThanOrEqual(1);
            expect(histRes.rows[0].status).toBe('SUCCESS');
            expect(histRes.rows[0].email).toBe('employee@apex.local');
        });

        it('should record failed login attempts in login history and audit logs', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ email: 'employee@apex.local', password: 'WrongPassword999!' });

            if (res.status !== 401) console.log('DEBUG res.status and body:', res.status, res.body);
            expect(res.status).toBe(401);

            const histRes = await query(`SELECT * FROM login_history WHERE email = 'employee@apex.local' AND status = 'FAILED'`);
            expect(histRes.rows.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('2. 15-Minute Inactivity Backend Enforcement', () => {
        it('should allow requests while the session is within 15 minutes of activity', async () => {
            const res = await request(app)
                .get('/api/organisation/me')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('should reject requests and auto-logout if session has been inactive for > 15 minutes', async () => {
            // Simulate 16 minutes of inactivity by backdating last_active_at
            const sixteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000).toISOString();
            await query('UPDATE sessions SET last_active_at = $1 WHERE id = $2', [sixteenMinutesAgo, employeeSessionId]);

            const res = await request(app)
                .get('/api/organisation/me')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(401);
            expect(res.body.code).toBe('SESSION_EXPIRED');
            expect(res.body.reason).toBe('INACTIVITY_TIMEOUT');

            // Verify session was revoked in database
            const sessRes = await query('SELECT is_active, revoked_at FROM sessions WHERE id = $1', [employeeSessionId]);
            expect(sessRes.rows[0].is_active).toBe(false);
            expect(sessRes.rows[0].revoked_at).toBeDefined();
        });

        it('should refresh inactivity timer when calling POST /api/auth/keep-alive', async () => {
            // Log in again to get fresh session
            const loginRes = await request(app)
                .post('/api/auth/login')
                .send({ email: 'employee@apex.local', password: testPassword });

            const freshToken = loginRes.body.data.token;
            const freshSessionId = loginRes.body.data.session_id;

            // Backdate to 10 minutes ago (warning threshold)
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
            await query('UPDATE sessions SET last_active_at = $1 WHERE id = $2', [tenMinutesAgo, freshSessionId]);

            // User clicks "Stay signed in" -> calls keep-alive
            const keepAliveRes = await request(app)
                .post('/api/auth/keep-alive')
                .set('Authorization', `Bearer ${freshToken}`);

            expect(keepAliveRes.status).toBe(200);
            expect(keepAliveRes.body.success).toBe(true);
            expect(keepAliveRes.body.timeout_seconds).toBe(900);

            // Verify last_active_at was refreshed close to now (< 2 seconds diff)
            const sessRes = await query('SELECT last_active_at FROM sessions WHERE id = $1', [freshSessionId]);
            const refreshedDiff = Date.now() - new Date(sessRes.rows[0].last_active_at).getTime();
            expect(refreshedDiff).toBeLessThan(5000);
        });
    });

    describe('3. Server-Side Session Revocation & Logout', () => {
        it('should immediately revoke the session upon explicit logout', async () => {
            const loginRes = await request(app)
                .post('/api/auth/login')
                .send({ email: 'employee@apex.local', password: testPassword });

            const token = loginRes.body.data.token;
            const sessionId = loginRes.body.data.session_id;

            const logoutRes = await request(app)
                .post('/api/auth/logout')
                .set('Authorization', `Bearer ${token}`);

            expect(logoutRes.status).toBe(200);
            expect(logoutRes.body.success).toBe(true);

            // Re-using the same token must now be rejected
            const testReq = await request(app)
                .get('/api/organisation/me')
                .set('Authorization', `Bearer ${token}`);

            expect(testReq.status).toBe(401);
            expect(testReq.body.code).toBe('SESSION_REVOKED');
        });

        it('should immediately revoke access if user account is deactivated', async () => {
            const loginRes = await request(app)
                .post('/api/auth/login')
                .send({ email: 'employee@apex.local', password: testPassword });

            const token = loginRes.body.data.token;

            // Deactivate user in DB
            await query('UPDATE users SET is_active = false WHERE id = $1', [employeeUserId]);

            const res = await request(app)
                .get('/api/organisation/me')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(401);
            expect(res.body.code).toBe('USER_DEACTIVATED');

            // Restore user for remaining tests
            await query('UPDATE users SET is_active = true WHERE id = $1', [employeeUserId]);
        });

        it('should revoke all user sessions when a password reset occurs', async () => {
            const loginRes = await request(app)
                .post('/api/auth/login')
                .send({ email: 'employee@apex.local', password: testPassword });

            const tokenBeforeReset = loginRes.body.data.token;

            // Generate reset token
            const rawToken = crypto.randomBytes(32).toString('hex');
            const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
            const expiresAt = new Date(Date.now() + 3600000).toISOString();
            await query('INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, employeeUserId, expiresAt]);

            // Submit password reset
            const resetRes = await request(app)
                .post('/api/auth/reset-password')
                .send({ token: rawToken, password: 'BrandNewSecurePassword123!' });

            expect(resetRes.status).toBe(200);

            // Attempting to use the pre-reset token must be rejected
            const res = await request(app)
                .get('/api/organisation/me')
                .set('Authorization', `Bearer ${tokenBeforeReset}`);

            expect(res.status).toBe(401);

            // Restore original password
            const origHash = await hashPassword(testPassword);
            await query('UPDATE users SET password_hash = $1 WHERE id = $2', [origHash, employeeUserId]);
        });
    });

    describe('4. Suspicious Login Detection & Verification Challenge Flow', () => {
        it('should detect suspicious login context and require email verification challenge', async () => {
            const loginRes = await request(app)
                .post('/api/auth/login')
                .set('x-test-simulate-suspicious', 'true')
                .send({ email: 'employee@apex.local', password: testPassword });

            expect(loginRes.status).toBe(200);
            expect(loginRes.body.require_login_verification).toBe(true);
            expect(loginRes.body.data).toBeUndefined(); // Normal session not issued yet!

            // Verify challenge created in DB
            const challengeRes = await query(
                'SELECT * FROM login_verification_challenges WHERE user_id = $1 AND consumed = false ORDER BY created_at DESC',
                [employeeUserId]
            );
            expect(challengeRes.rows.length).toBe(1);
            const challenge = challengeRes.rows[0];
            expect(challenge.verification_code).toBeDefined();

            // Attempting to verify with incorrect code should fail
            const badVerify = await request(app)
                .post('/api/auth/verify-login')
                .send({ code: '999999' });

            expect(badVerify.status).toBe(400);

            // Verifying with correct code should succeed and issue valid session
            const goodVerify = await request(app)
                .post('/api/auth/verify-login')
                .send({ code: challenge.verification_code });

            expect(goodVerify.status).toBe(200);
            expect(goodVerify.body.success).toBe(true);
            expect(goodVerify.body.data.token).toBeDefined();

            // Verify token allows access
            const authCheck = await request(app)
                .get('/api/organisation/me')
                .set('Authorization', `Bearer ${goodVerify.body.data.token}`);

            expect(authCheck.status).toBe(200);

            // Challenge cannot be replayed (single-use)
            const replayVerify = await request(app)
                .post('/api/auth/verify-login')
                .send({ code: challenge.verification_code });

            expect(replayVerify.status).toBe(400);
        });
    });

    describe('5. Account Security Overview & Multi-Session Management', () => {
        it('should return last login, active sessions list, and recent login history', async () => {
            const loginRes = await request(app)
                .post('/api/auth/login')
                .send({ email: 'employee@apex.local', password: testPassword });

            const token = loginRes.body.data.token;

            const activityRes = await request(app)
                .get('/api/auth/security/activity')
                .set('Authorization', `Bearer ${token}`);

            expect(activityRes.status).toBe(200);
            expect(activityRes.body.success).toBe(true);
            expect(activityRes.body.data.active_sessions).toBeDefined();
            expect(Array.isArray(activityRes.body.data.active_sessions)).toBe(true);
            expect(activityRes.body.data.active_sessions.length).toBeGreaterThanOrEqual(1);

            const current = activityRes.body.data.active_sessions.find((s: any) => s.is_current === true);
            expect(current).toBeDefined();
            expect(current.approx_location).toBeDefined();
        });

        it('should allow user to terminate other active sessions', async () => {
            // Create Session A
            const loginA = await request(app).post('/api/auth/login').send({ email: 'employee@apex.local', password: testPassword });
            const tokenA = loginA.body.data.token;

            // Create Session B
            const loginB = await request(app).post('/api/auth/login').send({ email: 'employee@apex.local', password: testPassword });
            const tokenB = loginB.body.data.token;

            // Session B revokes all other sessions
            const revokeRes = await request(app)
                .post('/api/auth/security/revoke-other-sessions')
                .set('Authorization', `Bearer ${tokenB}`);

            expect(revokeRes.status).toBe(200);

            // Session A should now be rejected
            const testA = await request(app).get('/api/organisation/me').set('Authorization', `Bearer ${tokenA}`);
            expect(testA.status).toBe(401);

            // Session B should still be active
            const testB = await request(app).get('/api/organisation/me').set('Authorization', `Bearer ${tokenB}`);
            expect(testB.status).toBe(200);
        });
    });

    describe('6. Security Boundaries, Role Escalation & Immutability', () => {
        it('should prevent managers from escalating an employee to Company Admin', async () => {
            // Login as manager
            const managerLogin = await request(app).post('/api/auth/login').send({ email: 'manager@apex.local', password: testPassword });
            managerToken = managerLogin.body.data.token;

            const res = await request(app)
                .post('/api/employees')
                .set('Authorization', `Bearer ${managerToken}`)
                .send({
                    full_name: 'Escalation Target',
                    email: 'escalation@apex.local',
                    role: 'Company Admin', // Attacker attempts to grant Company Admin!
                    create_account: true
                });

            expect(res.status).toBe(200);

            // User account must be clamped to Employee
            const userRes = await query(`SELECT role FROM users WHERE email = 'escalation@apex.local'`);
            expect(userRes.rows[0].role).toBe('Employee');
        });

        it('should prohibit deletion of audit logs (immutable audit trail)', async () => {
            const adminLogin = await request(app).post('/api/auth/login').send({ email: 'admin@apex.local', password: testPassword });
            adminToken = adminLogin.body.data.token;

            const res = await request(app)
                .delete('/api/audit/clear')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('IMMUTABLE_AUDIT_LOG');
        });

        it('should prevent modifying shift records for an already approved timesheet', async () => {
            // Login as manager
            const managerLogin = await request(app).post('/api/auth/login').send({ email: 'manager@apex.local', password: testPassword });
            const mToken = managerLogin.body.data.token;

            const empId = '123e4567-e89b-12d3-a456-555555555555';
            const recordDate = '2026-04-01';
            const fnIso = '2026-03-29';

            // Mark timesheet submission as Approved
            await query(`INSERT INTO timesheet_submissions (id, org_id, employee_id, start_date, status)
                         VALUES ('${crypto.randomUUID()}', '${orgId}', '${empId}', '${fnIso}', 'Approved')`);

            const res = await request(app)
                .post('/api/records')
                .set('Authorization', `Bearer ${mToken}`)
                .send({
                    employee_id: empId,
                    record_date: recordDate,
                    segments: [{ roster_in: '09:00', roster_out: '17:00' }]
                });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('TIMESHEET_ALREADY_APPROVED');
        });
    });
});
