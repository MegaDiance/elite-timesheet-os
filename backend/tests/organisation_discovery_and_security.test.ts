import request from 'supertest';
import app from '../src/index';
import { newDb, DataType } from 'pg-mem';
import { setPool } from '../src/services/db';
import { generateToken, generateTempToken, hashPassword } from '../src/services/auth';
import crypto from 'crypto';

describe('Organisation Discovery & Security Hardening Tests', () => {
    let orgAId: string;
    let orgBId: string;
    let orgAAdminToken: string;
    let tempPending2FAToken: string;
    let sharedUserId: string;

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
                display_name TEXT,
                logo_url TEXT,
                is_public_searchable BOOLEAN DEFAULT true,
                break_mins_weekday NUMERIC DEFAULT 30,
                break_mins_weekend NUMERIC DEFAULT 0,
                break_threshold_hours NUMERIC DEFAULT 6,
                roster_lock_password_hash TEXT,
                timesheet_lock_password_hash TEXT,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                role TEXT DEFAULT 'Employee',
                two_factor_enabled BOOLEAN DEFAULT false,
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
                phone TEXT,
                user_id UUID,
                contracted_hours NUMERIC DEFAULT 76,
                is_active BOOLEAN DEFAULT true,
                deleted_at TIMESTAMPTZ
            );

            CREATE TABLE roster_templates (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                employee_id UUID NOT NULL,
                day_index INTEGER NOT NULL,
                segment_type TEXT NOT NULL,
                roster_in TEXT,
                roster_out TEXT,
                roster_hours NUMERIC DEFAULT 0
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

            CREATE TABLE invitation_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id UUID NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL
            );

            CREATE TABLE reset_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id UUID NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL
            );

            CREATE TABLE two_factor_codes (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                code_hash TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                attempts INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE audit_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT NOW(),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                actor_id UUID,
                action TEXT NOT NULL,
                entity_type TEXT,
                entity_id UUID,
                details TEXT,
                snapshot TEXT
            );
        `);

        const hash = await hashPassword('password123');
        orgAId = crypto.randomUUID();
        orgBId = crypto.randomUUID();
        const adminAId = crypto.randomUUID();
        sharedUserId = crypto.randomUUID();

        // Seed Org A & Org B
        db.public.none(`
            INSERT INTO organisations (id, name, slug, display_name, roster_lock_password_hash)
            VALUES ('${orgAId}', 'Apex Logistics Solutions', 'apex-logistics', 'Apex Logistics', 'secret_hash');

            INSERT INTO organisations (id, name, slug, display_name, roster_lock_password_hash)
            VALUES ('${orgBId}', 'Beacon Health Care', 'beacon-health', 'Beacon Health', 'secret_hash');
        `);

        // Seed Users & Memberships
        db.public.none(`
            INSERT INTO users (id, org_id, email, password_hash, role)
            VALUES ('${adminAId}', '${orgAId}', 'admin@apex.local', '${hash}', 'Company Admin');

            INSERT INTO organisation_members (id, organisation_id, user_id, role)
            VALUES ('${crypto.randomUUID()}', '${orgAId}', '${adminAId}', 'Company Admin');

            INSERT INTO users (id, org_id, email, password_hash, role)
            VALUES ('${sharedUserId}', '${orgAId}', 'contractor@multicompany.com', '${hash}', 'Employee');

            INSERT INTO organisation_members (id, organisation_id, user_id, role)
            VALUES ('${crypto.randomUUID()}', '${orgAId}', '${sharedUserId}', 'Employee');

            INSERT INTO organisation_members (id, organisation_id, user_id, role)
            VALUES ('${crypto.randomUUID()}', '${orgBId}', '${sharedUserId}', 'Employee');
        `);

        setPool(new (db.adapters.createPg().Pool)());

        orgAAdminToken = generateToken({
            id: adminAId,
            email: 'admin@apex.local',
            organisation_id: orgAId,
            role: 'Company Admin'
        });

        tempPending2FAToken = generateTempToken({
            id: adminAId,
            email: 'admin@apex.local',
            organisation_id: orgAId,
            role: 'Company Admin'
        });
    });

    describe('Public Safe Organisation Discovery', () => {
        it('rejects searches with fewer than 2 characters', async () => {
            const res = await request(app).get('/api/organisation/discover?q=a');
            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('QUERY_TOO_SHORT');
        });

        it('returns matching organisations safely with zero credential leaks', async () => {
            const res = await request(app).get('/api/organisation/discover?q=apex');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.length).toBeGreaterThanOrEqual(1);

            const match = res.body.data[0];
            expect(match.name).toBe('Apex Logistics');
            expect(match.slug).toBe('apex-logistics');
            expect(match.id).toBe(orgAId);

            // Verify security: internal sensitive columns MUST NOT be returned
            expect(match.roster_lock_password_hash).toBeUndefined();
            expect(match.timesheet_lock_password_hash).toBeUndefined();
            expect(match.break_mins_weekday).toBeUndefined();
        });

        it('resolves organisation by slug lookup', async () => {
            const res = await request(app).get('/api/organisation/lookup/apex-logistics');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.name).toBe('Apex Logistics');
            expect(res.body.data.slug).toBe('apex-logistics');
        });

        it('returns 404 for unknown slug', async () => {
            const res = await request(app).get('/api/organisation/lookup/non-existent-org');
            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });

    describe('Security Boundaries & 2FA Bypass Protection', () => {
        it('rejects 2fa_pending temporary token on authenticated routes', async () => {
            const res = await request(app)
                .get('/api/organisation/me')
                .set('Authorization', `Bearer ${tempPending2FAToken}`);

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
        });

        it('blocks access to tenant routes when token lacks organisation_id', async () => {
            const noTenantToken = generateToken({
                id: crypto.randomUUID(),
                email: 'standalone@test.local',
                role: 'Employee'
                // organisation_id omitted
            });

            const res = await request(app)
                .get('/api/employees')
                .set('Authorization', `Bearer ${noTenantToken}`);

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
        });
    });

    describe('Cross-Tenant Data Isolation on Deletion', () => {
        it('deleting an employee in Org A does not destroy their membership in Org B', async () => {
            // First create an employee profile for shared user in Org A
            const empARes = await request(app)
                .post('/api/employees')
                .set('Authorization', `Bearer ${orgAAdminToken}`)
                .send({
                    full_name: 'Multi Org Contractor',
                    email: 'contractor@multicompany.com'
                });

            expect(empARes.status).toBe(200);
            const empAId = empARes.body.data.id;

            // Delete employee in Org A
            const deleteRes = await request(app)
                .delete(`/api/employees/${empAId}`)
                .set('Authorization', `Bearer ${orgAAdminToken}`);

            expect(deleteRes.status).toBe(200);
            expect(deleteRes.body.success).toBe(true);

            // Verify that the user still exists and retains membership in Org B
            const { query } = require('../src/services/db');
            const userCheck = await query('SELECT * FROM users WHERE id = $1', [sharedUserId]);
            expect(userCheck.rows.length).toBe(1);

            const membershipB = await query('SELECT * FROM organisation_members WHERE user_id = $1 AND organisation_id = $2', [sharedUserId, orgBId]);
            expect(membershipB.rows.length).toBe(1);

            // Membership in Org A should be gone
            const membershipA = await query('SELECT * FROM organisation_members WHERE user_id = $1 AND organisation_id = $2', [sharedUserId, orgAId]);
            expect(membershipA.rows.length).toBe(0);
        });
    });

    describe('Dedicated Organisation Login Enforcement', () => {
        it('allows login to a specific organisation when user is a member', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'contractor@multicompany.com',
                    password: 'password123',
                    organisation_slug: 'beacon-health'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.user.organisation_id).toBe(orgBId);
            expect(res.body.data.token).toBeDefined();
        });

        it('rejects login to an organisation when user is not a member', async () => {
            // Note: Org A membership was deleted in previous test
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'contractor@multicompany.com',
                    password: 'password123',
                    organisation_slug: 'apex-logistics'
                });

            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('NO_ORGANISATION_ACCESS');
        });
    });
});
