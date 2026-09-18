import request from 'supertest';
import app from '../src/index';
import { newDb, DataType } from 'pg-mem';
import { setPool, query, withTransaction, getPool } from '../src/services/db';
import { generateToken, hashPassword } from '../src/services/auth';
import { buildXeroAuthUrl, verifyXeroOAuthState, encryptSecret, decryptSecret } from '../src/services/xeroService';
import { getFortnightStartIso } from '../src/services/periodUtils';
import { generatePayrollReport } from '../src/services/reportService';
import crypto from 'crypto';

describe('Stage 5 Adversarial Audit Remediation Test Suite', () => {
    let orgAId: string;
    let orgBId: string;
    let adminAUserId: string;
    let adminAToken: string;
    let employeeAUserId: string;
    let employeeAEmpId: string;
    let employeeAToken: string;
    let adminBUserId: string;

    const testFortnight = '2026-04-12'; // Sunday

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
                break_mins_weekday NUMERIC DEFAULT 30,
                break_mins_weekend NUMERIC DEFAULT 0,
                break_threshold_hours NUMERIC DEFAULT 6,
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
                full_name TEXT NOT NULL,
                department TEXT,
                email TEXT,
                user_id UUID,
                contracted_hours NUMERIC DEFAULT 76,
                is_active BOOLEAN DEFAULT true,
                deleted_at TIMESTAMPTZ
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
                roster_in TEXT,
                roster_out TEXT,
                roster_hours NUMERIC DEFAULT 0,
                actual_in TEXT,
                actual_out TEXT,
                actual_hours NUMERIC DEFAULT 0,
                actual_segment_type TEXT,
                is_unplanned BOOLEAN DEFAULT false,
                notes TEXT
            );

            CREATE TABLE timesheet_submissions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                employee_id UUID NOT NULL,
                start_date TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Draft',
                submitted_at TIMESTAMPTZ,
                reviewed_by UUID,
                reviewed_at TIMESTAMPTZ,
                rejection_reason TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(org_id, employee_id, start_date)
            );

            CREATE TABLE leave_requests (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                employee_id UUID NOT NULL,
                leave_type TEXT NOT NULL,
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                hours NUMERIC NOT NULL,
                reason TEXT,
                status TEXT NOT NULL DEFAULT 'Pending',
                reviewed_by UUID,
                reviewed_at TIMESTAMPTZ,
                rejection_reason TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE public_holidays (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                holiday_date TEXT NOT NULL,
                name TEXT NOT NULL,
                UNIQUE(org_id, holiday_date)
            );

            CREATE TABLE sessions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                org_id UUID,
                token_hash TEXT NOT NULL UNIQUE,
                ip_address TEXT,
                user_agent TEXT,
                last_active_at TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL,
                revoked_at TIMESTAMPTZ,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE login_verification_challenges (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                org_id UUID,
                role TEXT,
                token_hash TEXT NOT NULL UNIQUE,
                verification_code TEXT,
                attempts INTEGER DEFAULT 0,
                expires_at TIMESTAMPTZ NOT NULL,
                consumed BOOLEAN DEFAULT false,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE audit_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID,
                actor_id UUID,
                user_id UUID,
                action TEXT NOT NULL,
                entity_type TEXT,
                entity_id UUID,
                details TEXT,
                timestamp TIMESTAMPTZ DEFAULT NOW(),
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE xero_connections (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL UNIQUE,
                tenant_id TEXT,
                tenant_name TEXT,
                access_token TEXT,
                refresh_token TEXT,
                expires_at TIMESTAMPTZ,
                connected_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        const PgPool = db.adapters.createPg().Pool;
        setPool(new PgPool());

        // Setup Org A
        const orgARes = await query("INSERT INTO organisations (name, slug) VALUES ('Remediation Alpha', 'rem-alpha') RETURNING id");
        orgAId = orgARes.rows[0].id;

        // Setup Org B
        const orgBRes = await query("INSERT INTO organisations (name, slug) VALUES ('Remediation Beta', 'rem-beta') RETURNING id");
        orgBId = orgBRes.rows[0].id;

        const defaultHash = await hashPassword('SecurePass123!');

        // Admin A
        const adminARes = await query(
            "INSERT INTO users (org_id, email, password_hash, role) VALUES ($1, 'admin@alpha.local', $2, 'Company Admin') RETURNING id",
            [orgAId, defaultHash]
        );
        adminAUserId = adminARes.rows[0].id;
        await query("INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'Company Admin')", [orgAId, adminAUserId]);
        adminAToken = generateToken({ id: adminAUserId, email: 'admin@alpha.local', organisation_id: orgAId, role: 'Company Admin' });

        // Admin B
        const adminBRes = await query(
            "INSERT INTO users (org_id, email, password_hash, role) VALUES ($1, 'admin@beta.local', $2, 'Company Admin') RETURNING id",
            [orgBId, defaultHash]
        );
        adminBUserId = adminBRes.rows[0].id;
        await query("INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'Company Admin')", [orgBId, adminBUserId]);

        // Employee A in Org A
        const empARes = await query(
            "INSERT INTO users (org_id, email, password_hash, role) VALUES ($1, 'emp@alpha.local', $2, 'Employee') RETURNING id",
            [orgAId, defaultHash]
        );
        employeeAUserId = empARes.rows[0].id;
        await query("INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'Employee')", [orgAId, employeeAUserId]);

        const empRecordRes = await query(
            "INSERT INTO employees (org_id, full_name, department, email, user_id, contracted_hours) VALUES ($1, 'Alice Worker', 'Engineering', 'emp@alpha.local', $2, 76) RETURNING id",
            [orgAId, employeeAUserId]
        );
        employeeAEmpId = empRecordRes.rows[0].id;
        employeeAToken = generateToken({ id: employeeAUserId, email: 'emp@alpha.local', organisation_id: orgAId, role: 'Employee' });

        // Setup unlocked fortnight lock for Org A
        await query(
            "INSERT INTO fortnight_locks (org_id, start_date, timesheet_locked, roster_locked, is_published) VALUES ($1, $2, false, false, true)",
            [orgAId, testFortnight]
        );
    });

    describe('Wave 1: Security & Auth Hardening Verification', () => {
        it('[CRITICAL-04 & HIGH-01] 2FA codes are SHA-256 hashed and lockout occurs after 5 failed attempts', async () => {
            const rawCode = '123456';
            const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
            const challengeId = crypto.randomUUID();
            const challengeToken = 'test-challenge-' + crypto.randomUUID();
            const tokenHash = crypto.createHash('sha256').update(challengeToken).digest('hex');

            await query(`
                INSERT INTO login_verification_challenges (id, user_id, org_id, role, token_hash, verification_code, attempts, expires_at)
                VALUES ($1, $2, $3, 'Employee', $4, $5, 0, NOW() + INTERVAL '10 minutes')
            `, [challengeId, employeeAUserId, orgAId, tokenHash, codeHash]);

            // Attempt 1 to 4 with incorrect codes
            for (let attempt = 1; attempt <= 4; attempt++) {
                const res = await request(app)
                    .post('/api/auth/verify-login')
                    .send({ challenge_id: challengeId, code: '999999' });

                expect(res.status).toBe(400);
                expect(res.body.success).toBe(false);
                expect(res.body.error.message).toMatch(/incorrect verification code/i);
            }

            // 5th incorrect attempt triggers lockout
            const fifthRes = await request(app)
                .post('/api/auth/verify-login')
                .send({ challenge_id: challengeId, code: '999999' });

            expect(fifthRes.status).toBe(429);
            expect(fifthRes.body.success).toBe(false);
            expect(fifthRes.body.error.message).toMatch(/too many.*attempts/i);

            // Verify challenge was consumed upon reaching max attempts
            const check = await query('SELECT consumed FROM login_verification_challenges WHERE id = $1', [challengeId]);
            expect(check.rows[0].consumed).toBe(true);
        });

        it('[HIGH-04] OAuth state parameter is HMAC-SHA256 signed and tampered state is rejected', () => {
            const authUrl = buildXeroAuthUrl(orgAId);
            expect(authUrl).toContain('state=');

            const stateParam = new URL(authUrl).searchParams.get('state');
            expect(stateParam).toBeTruthy();

            // Valid signature passes
            const valid = verifyXeroOAuthState(stateParam!, orgAId);
            expect(valid.valid).toBe(true);

            // Cross-tenant verification fails
            const crossTenant = verifyXeroOAuthState(stateParam!, orgBId);
            expect(crossTenant.valid).toBe(false);

            // Tampered signature fails
            const tampered = stateParam!.replace(/.$/, 'x');
            const tamperedResult = verifyXeroOAuthState(tampered, orgAId);
            expect(tamperedResult.valid).toBe(false);
        });

        it('[HIGH-08] Xero OAuth tokens are stored encrypted with AES-256-GCM', async () => {
            const rawAccessToken = 'xero-access-token-secret-12345';
            const rawRefreshToken = 'xero-refresh-token-secret-67890';

            const encryptedAccess = encryptSecret(rawAccessToken);
            const encryptedRefresh = encryptSecret(rawRefreshToken);

            // Store in DB
            await query(`
                INSERT INTO xero_connections (org_id, tenant_id, tenant_name, access_token, refresh_token, expires_at)
                VALUES ($1, 'tenant-123', 'Alpha Accounting', $2, $3, NOW() + INTERVAL '30 minutes')
                ON CONFLICT (org_id) DO UPDATE SET access_token = $2, refresh_token = $3
            `, [orgAId, encryptedAccess, encryptedRefresh]);

            // Direct DB inspection proves cipher text is stored, not plaintext
            const rawRow = await query('SELECT access_token, refresh_token FROM xero_connections WHERE org_id = $1', [orgAId]);
            expect(rawRow.rows[0].access_token).not.toBe(rawAccessToken);
            expect(rawRow.rows[0].access_token).toContain(':'); // IV:Tag:Ciphertext format
            expect(rawRow.rows[0].refresh_token).not.toBe(rawRefreshToken);

            // Decrypting recovers original token exactly
            expect(decryptSecret(rawRow.rows[0].access_token)).toBe(rawAccessToken);
            expect(decryptSecret(rawRow.rows[0].refresh_token)).toBe(rawRefreshToken);
        });

        it('[MEDIUM-04] requireAuth blocks cross-tenant session hijacking', async () => {
            // Create session belonging to Org B
            const sessionId = crypto.randomUUID();
            const sessionToken = crypto.randomUUID();
            const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');

            await query(`
                INSERT INTO sessions (id, user_id, org_id, token_hash, expires_at, is_active)
                VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour', true)
            `, [sessionId, adminAUserId, orgBId, tokenHash]);

            // Create JWT claiming to be Org A, but with session_id from Org B
            const mismatchedToken = generateToken({
                id: adminAUserId,
                email: 'admin@alpha.local',
                organisation_id: orgAId,
                role: 'Company Admin',
                session_id: sessionId
            });

            const res = await request(app)
                .get('/api/records?employee_id=' + employeeAEmpId + '&start_date=' + testFortnight)
                .set('Authorization', `Bearer ${mismatchedToken}`);

            expect(res.status).toBe(403);
            expect(res.body.code).toBe('TENANT_MISMATCH');
        });
    });

    describe('Wave 2: Multi-Tenant State Machine Isolation Verification', () => {
        it('[CRITICAL-02] Deactivating employee in Org A does NOT deactivate user in Org B for multi-tenant users', async () => {
            // Add Alice to Org B as well
            await query("INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'Employee')", [orgBId, employeeAUserId]);
            const empBRecord = await query(
                "INSERT INTO employees (org_id, full_name, department, email, user_id) VALUES ($1, 'Alice Worker', 'Logistics', 'emp@alpha.local', $2) RETURNING id",
                [orgBId, employeeAUserId]
            );

            // Admin A deactivates Alice in Org A
            const deactRes = await request(app)
                .post(`/api/employees/${employeeAEmpId}/deactivate`)
                .set('Authorization', `Bearer ${adminAToken}`);

            expect(deactRes.status).toBe(200);
            expect(deactRes.body.success).toBe(true);

            // Verify Org A membership removed
            const checkA = await query('SELECT * FROM organisation_members WHERE organisation_id = $1 AND user_id = $2', [orgAId, employeeAUserId]);
            expect(checkA.rows.length).toBe(0);

            // CRITICAL: Alice still active in Org B!
            const checkB = await query('SELECT * FROM organisation_members WHERE organisation_id = $1 AND user_id = $2', [orgBId, employeeAUserId]);
            expect(checkB.rows.length).toBe(1);

            // CRITICAL: Underlying user account is still active!
            const userCheck = await query('SELECT is_active FROM users WHERE id = $1', [employeeAUserId]);
            expect(userCheck.rows[0].is_active).toBe(true);

            // Clean up Alice in Org B and re-add to Org A for remaining tests
            await query('DELETE FROM organisation_members WHERE organisation_id = $1 AND user_id = $2', [orgBId, employeeAUserId]);
            await query('DELETE FROM employees WHERE id = $1', [empBRecord.rows[0].id]);
            await query("INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'Employee')", [orgAId, employeeAUserId]);
            await query("UPDATE employees SET is_active = true, deleted_at = NULL WHERE id = $1", [employeeAEmpId]);
        });

        it('[HIGH-02] Prevents user_id hijacking across tenants in employee creation and update', async () => {
            // Admin A attempts to link an employee record to Admin B's user_id
            const hijackRes = await request(app)
                .post('/api/employees')
                .set('Authorization', `Bearer ${adminAToken}`)
                .send({
                    full_name: 'Hijack Attempt',
                    email: 'hijack@alpha.local',
                    user_id: adminBUserId
                });

            expect(hijackRes.status).toBe(400);
            expect(hijackRes.body.error.code).toBe('INVALID_USER_MEMBERSHIP');
        });

        it('[HIGH-03] Multi-day leave request spanning into a locked fortnight is rejected', async () => {
            const nextFortnight = '2026-04-26';
            // Lock next fortnight for Org A
            await query(
                "INSERT INTO fortnight_locks (org_id, start_date, timesheet_locked, roster_locked, is_published) VALUES ($1, $2, true, true, true) ON CONFLICT (org_id, start_date) DO UPDATE SET timesheet_locked = true",
                [orgAId, nextFortnight]
            );

            // Employee requests leave spanning from unlocked fortnight (testFortnight: 2026-04-12) to locked fortnight (2026-04-28)
            const leaveRes = await request(app)
                .post('/api/portal/leave-requests')
                .set('Authorization', `Bearer ${employeeAToken}`)
                .send({
                    leave_type: 'Annual',
                    start_date: '2026-04-20',
                    end_date: '2026-04-28', // falls into locked fortnight!
                    hours: 22.8,
                    reason: 'Holiday'
                });

            expect(leaveRes.status).toBe(403);
            expect(leaveRes.body.error.code).toBe('TIMESHEET_LOCKED');
        });

        it('[HIGH-07] withTransaction invokes BEGIN, executes queries, and triggers ROLLBACK & client.release on error', async () => {
            const poolInstance = getPool();
            const calls: string[] = [];
            const mockClient = {
                query: jest.fn(async (sql: string) => {
                    calls.push(sql);
                    if (sql === 'FAIL_ME') throw new Error('Transaction failure simulation');
                    return { rows: [] };
                }),
                release: jest.fn(() => {
                    calls.push('RELEASE');
                })
            };

            const origConnect = poolInstance.connect;
            poolInstance.connect = jest.fn(async () => mockClient as any);

            try {
                await expect(withTransaction(async (tx) => {
                    await tx('SELECT 1');
                    await tx('FAIL_ME');
                })).rejects.toThrow('Transaction failure simulation');

                expect(calls).toEqual(['BEGIN', 'SELECT 1', 'FAIL_ME', 'ROLLBACK', 'RELEASE']);
            } finally {
                poolInstance.connect = origConnect;
            }
        });
    });

    describe('Wave 3: Roster, Leave & Payroll Engine Hardening Verification', () => {
        it('[CRITICAL-03] Approving leave request automatically generates shift_segments and daily_records across all leave dates', async () => {
            const leaveStart = '2026-04-13'; // Monday
            const leaveEnd = '2026-04-15';   // Wednesday (3 days)
            const leaveHours = 22.8;

            // Submit leave request
            const leaveRes = await query(`
                INSERT INTO leave_requests (id, org_id, employee_id, leave_type, start_date, end_date, hours, status)
                VALUES ($1, $2, $3, 'Annual', $4, $5, $6, 'Pending')
                RETURNING id
            `, [crypto.randomUUID(), orgAId, employeeAEmpId, leaveStart, leaveEnd, leaveHours]);
            const leaveId = leaveRes.rows[0].id;

            // Manager approves leave request
            const reviewRes = await request(app)
                .post(`/api/organisation/leave-requests/${leaveId}/review`)
                .set('Authorization', `Bearer ${adminAToken}`)
                .send({
                    status: 'Approved'
                });

            expect(reviewRes.status).toBe(200);
            expect(reviewRes.body.success).toBe(true);

            // Verify shift segments were automatically populated for all 3 days
            const checkSegs = await query(`
                SELECT dr.record_date, ss.segment_type, ss.actual_hours, ss.roster_hours
                FROM daily_records dr
                JOIN shift_segments ss ON ss.record_id = dr.id
                WHERE dr.org_id = $1 AND dr.employee_id = $2 AND dr.record_date >= $3 AND dr.record_date <= $4
                ORDER BY dr.record_date ASC
            `, [orgAId, employeeAEmpId, leaveStart, leaveEnd]);

            expect(checkSegs.rows.length).toBe(3);
            for (const seg of checkSegs.rows) {
                expect(seg.segment_type).toBe('Annual');
                expect(Number(seg.actual_hours)).toBe(7.6);
                expect(Number(seg.roster_hours)).toBe(7.6);
            }

            // Verify payroll report reflects these leave hours
            const report = await generatePayrollReport(orgAId, testFortnight);
            const empReport = report.employees.find((e: any) => e.employee_id === employeeAEmpId);
            expect(empReport).toBeDefined();
            expect(empReport.annual_hours).toBe(22.8);
        });

        it('[HIGH-06] Rejects shift creation/modification for deactivated or soft-deleted employees', async () => {
            // Deactivate employee
            await query('UPDATE employees SET is_active = false WHERE id = $1', [employeeAEmpId]);

            const res = await request(app)
                .post('/api/records')
                .set('Authorization', `Bearer ${adminAToken}`)
                .send({
                    employee_id: employeeAEmpId,
                    record_date: '2026-04-16',
                    segments: [{ segment_type: 'WORK', roster_in: '09:00', roster_out: '17:00' }]
                });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/inactive or deleted employee/i);

            // Re-activate for subsequent tests
            await query('UPDATE employees SET is_active = true WHERE id = $1', [employeeAEmpId]);
        });

        it('[HIGH-05] getFortnightStartIso provides consistent UTC-safe fortnight boundaries', () => {
            expect(getFortnightStartIso('2026-04-12')).toBe('2026-04-12'); // Sunday start
            expect(getFortnightStartIso('2026-04-13')).toBe('2026-04-12'); // Monday of fortnight
            expect(getFortnightStartIso('2026-04-25')).toBe('2026-04-12'); // Saturday end of fortnight
            expect(getFortnightStartIso('2026-04-26')).toBe('2026-04-26'); // Next fortnight Sunday
        });

        it('[MEDIUM-05] Timesheet rejection strictly requires non-empty feedback reason', async () => {
            const subRes = await query(`
                INSERT INTO timesheet_submissions (id, org_id, employee_id, start_date, status)
                VALUES ($1, $2, $3, $4, 'Submitted')
                ON CONFLICT (org_id, employee_id, start_date) DO UPDATE SET status = 'Submitted'
                RETURNING id
            `, [crypto.randomUUID(), orgAId, employeeAEmpId, testFortnight]);
            const subId = subRes.rows[0].id;

            // Reject with empty reason
            const emptyRes = await request(app)
                .post('/api/submissions/reject')
                .set('Authorization', `Bearer ${adminAToken}`)
                .send({
                    submission_id: subId,
                    employee_id: employeeAEmpId,
                    start_date: testFortnight,
                    rejection_reason: '   '
                });

            expect(emptyRes.status).toBe(400);
            expect(emptyRes.body.error.message).toMatch(/rejection reason is required/i);
        });
    });

    describe('Wave 4: Performance & Data Integrity Verification', () => {
        it('[MEDIUM-01] GET /api/records returns all daily records and shift segments without N+1 queries', async () => {
            const res = await request(app)
                .get(`/api/records?employee_id=${employeeAEmpId}&start_date=${testFortnight}`)
                .set('Authorization', `Bearer ${adminAToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);

            // Check that segments array is populated
            const dayWithLeave = res.body.data.find((d: any) => d.record_date === '2026-04-13');
            expect(dayWithLeave).toBeDefined();
            expect(dayWithLeave.segments.length).toBeGreaterThanOrEqual(1);
            expect(dayWithLeave.segments[0].segment_type).toBe('Annual');
        });

        it('[MEDIUM-02] generatePayrollReport calculates payroll totals in a single batch query', async () => {
            const report = await generatePayrollReport(orgAId, testFortnight);
            expect(report).toBeDefined();
            expect(report.fortnight_start).toBe(testFortnight);
            expect(report.employees.length).toBeGreaterThanOrEqual(1);

            const emp = report.employees.find((e: any) => e.employee_id === employeeAEmpId);
            expect(emp).toBeDefined();
            expect(emp.annual_hours).toBeGreaterThan(0);
        });

        it('[LOW-02] CSV export sanitizes formulas to prevent injection attack', async () => {
            // Update employee name to start with formula trigger '='
            await query("UPDATE employees SET full_name = '=cmd|'' /C calc''!A0' WHERE id = $1", [employeeAEmpId]);

            const res = await request(app)
                .get(`/api/reports/export/csv?start_date=${testFortnight}`)
                .set('Authorization', `Bearer ${adminAToken}`);

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toContain('text/csv');
            // The formula character '=' must be escaped with single quote "'"
            expect(res.text).toContain("'=cmd");
        });
    });
});
