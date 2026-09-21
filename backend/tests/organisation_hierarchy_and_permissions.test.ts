import request from 'supertest';
import app from '../src/index';
import { newDb, DataType } from 'pg-mem';
import { setPool, query } from '../src/services/db';
import { generateToken, hashPassword } from '../src/services/auth';
import crypto from 'crypto';

/**
 * SimpleHours: Organisation Hierarchy & Permissions Revamp
 *
 * Exhaustive authorisation coverage for the canonical permission model:
 *  - Organisation isolation (multi-tenant)
 *  - Branch isolation
 *  - THE CRITICAL RULE: organisation roles do NOT inherit branch timesheet access
 *  - Anti-privilege escalation (self role change, self branch assignment)
 *  - Cross-organisation manipulation
 *  - ID tampering
 *  - Structured security audit logging with previous/new values
 */
describe('SimpleHours: Organisation Hierarchy, Memberships & Permissions', () => {
    // Org A
    let orgAId: string;
    let melbourneId: string;
    let richmondId: string;
    let geelongId: string;

    let ownerAId: string;
    let ownerAToken: string;

    let orgManagerAId: string;
    let orgManagerAToken: string;

    // Sarah: ORG_MANAGER + BRANCH_MANAGER (Melbourne only)
    let sarahId: string;
    let sarahToken: string;

    // Richmond branch admin
    let richAdminId: string;
    let richAdminToken: string;

    // Plain org member with no branch membership
    let plainMemberId: string;

    // Employees
    let melbEmployeeId: string;
    let richEmployeeId: string;

    // Org B
    let orgBId: string;
    let ownerBId: string;
    let ownerBToken: string;
    let orgBLocationId: string;
    let orgBEmployeeId: string;

    const fortnight = '2026-04-12';

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
                portal_slug TEXT UNIQUE,
                display_name TEXT,
                timesheet_entry_mode TEXT DEFAULT 'employee',
                owner_user_id UUID,
                break_mins_weekday NUMERIC DEFAULT 30,
                break_mins_weekend NUMERIC DEFAULT 0,
                break_threshold_hours NUMERIC DEFAULT 6,
                allow_employee_chat BOOLEAN DEFAULT true,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE locations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                name TEXT NOT NULL,
                address TEXT,
                timezone TEXT DEFAULT 'Australia/Melbourne',
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(org_id, name)
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
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(organisation_id, user_id)
            );

            CREATE TABLE location_memberships (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                location_id UUID NOT NULL,
                role TEXT NOT NULL DEFAULT 'manager',
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(user_id, location_id)
            );

            CREATE TABLE location_invitations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                location_id UUID NOT NULL,
                email TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'manager',
                token TEXT NOT NULL UNIQUE,
                token_hash TEXT,
                delivery_status TEXT DEFAULT 'pending',
                last_error TEXT,
                created_by UUID,
                expires_at TIMESTAMPTZ NOT NULL,
                accepted_at TIMESTAMPTZ,
                cancelled_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE invitation_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id UUID NOT NULL,
                org_id UUID,
                email TEXT,
                expires_at TIMESTAMPTZ,
                used_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE employees (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                location_id UUID,
                full_name TEXT NOT NULL,
                department TEXT,
                email TEXT,
                phone TEXT,
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

            CREATE TABLE sessions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                org_id UUID,
                location_id UUID,
                token_hash TEXT NOT NULL UNIQUE,
                ip_address TEXT,
                user_agent TEXT,
                last_active_at TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL,
                revoked_at TIMESTAMPTZ,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE audit_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID,
                location_id UUID,
                timestamp TIMESTAMPTZ DEFAULT NOW(),
                actor_id UUID,
                user_id UUID,
                target_user_id UUID,
                action TEXT NOT NULL,
                entity_id UUID,
                entity_type TEXT,
                details TEXT,
                previous_value TEXT,
                new_value TEXT,
                scope TEXT NOT NULL DEFAULT 'organisation',
                ip_address TEXT
            );
        `);

        const PgPool = db.adapters.createPg().Pool;
        setPool(new PgPool());

        const pw = await hashPassword('Password123!');

        // ---------------- Org A ----------------
        orgAId = crypto.randomUUID();
        await query(
            `INSERT INTO organisations (id, name, slug, portal_slug) VALUES ($1, 'Vertex Clinics', 'vertex-clinics', 'vertex991')`,
            [orgAId]
        );

        melbourneId = crypto.randomUUID();
        richmondId = crypto.randomUUID();
        geelongId = crypto.randomUUID();
        await query(`INSERT INTO locations (id, org_id, name) VALUES ($1, $2, 'Melbourne')`, [melbourneId, orgAId]);
        await query(`INSERT INTO locations (id, org_id, name) VALUES ($1, $2, 'Richmond')`, [richmondId, orgAId]);
        await query(`INSERT INTO locations (id, org_id, name) VALUES ($1, $2, 'Geelong')`, [geelongId, orgAId]);

        // Owner (no branch memberships at all)
        ownerAId = crypto.randomUUID();
        await query(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ($1, $2, 'owner@vertex.com', $3, 'Company Admin')`, [ownerAId, orgAId, pw]);
        await query(`INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'OWNER')`, [orgAId, ownerAId]);
        await query(`UPDATE organisations SET owner_user_id = $1 WHERE id = $2`, [ownerAId, orgAId]);
        ownerAToken = generateToken({ id: ownerAId, organisation_id: orgAId, role: 'Company Admin', email: 'owner@vertex.com' });

        // Org manager, no branch memberships
        orgManagerAId = crypto.randomUUID();
        await query(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ($1, $2, 'orgmanager@vertex.com', $3, 'Manager')`, [orgManagerAId, orgAId, pw]);
        await query(`INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'ORG_MANAGER')`, [orgAId, orgManagerAId]);
        orgManagerAToken = generateToken({ id: orgManagerAId, organisation_id: orgAId, role: 'Manager', email: 'orgmanager@vertex.com' });

        // Sarah: ORG_MANAGER + BRANCH_MANAGER of Melbourne only
        sarahId = crypto.randomUUID();
        await query(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ($1, $2, 'sarah@vertex.com', $3, 'Manager')`, [sarahId, orgAId, pw]);
        await query(`INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'ORG_MANAGER')`, [orgAId, sarahId]);
        await query(`INSERT INTO location_memberships (user_id, location_id, role) VALUES ($1, $2, 'BRANCH_MANAGER')`, [sarahId, melbourneId]);
        sarahToken = generateToken({ id: sarahId, organisation_id: orgAId, location_id: melbourneId, role: 'Manager', email: 'sarah@vertex.com' });

        // Richmond branch admin
        richAdminId = crypto.randomUUID();
        await query(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ($1, $2, 'richadmin@vertex.com', $3, 'Manager')`, [richAdminId, orgAId, pw]);
        await query(`INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'ORG_MANAGER')`, [orgAId, richAdminId]);
        await query(`INSERT INTO location_memberships (user_id, location_id, role) VALUES ($1, $2, 'BRANCH_ADMIN')`, [richAdminId, richmondId]);
        richAdminToken = generateToken({ id: richAdminId, organisation_id: orgAId, location_id: richmondId, role: 'Manager', email: 'richadmin@vertex.com' });

        // Plain organisation member, no branch membership
        plainMemberId = crypto.randomUUID();
        await query(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ($1, $2, 'plain@vertex.com', $3, 'Employee')`, [plainMemberId, orgAId, pw]);
        await query(`INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'EMPLOYEE')`, [orgAId, plainMemberId]);

        // Employees in each branch, with submitted timesheets
        melbEmployeeId = crypto.randomUUID();
        await query(
            `INSERT INTO employees (id, org_id, location_id, full_name, email) VALUES ($1, $2, $3, 'Mia Melbourne', 'mia@vertex.com')`,
            [melbEmployeeId, orgAId, melbourneId]
        );
        richEmployeeId = crypto.randomUUID();
        await query(
            `INSERT INTO employees (id, org_id, location_id, full_name, email) VALUES ($1, $2, $3, 'Rory Richmond', 'rory@vertex.com')`,
            [richEmployeeId, orgAId, richmondId]
        );

        await query(
            `INSERT INTO timesheet_submissions (id, org_id, employee_id, start_date, status, submitted_at)
             VALUES ($1, $2, $3, $4, 'Submitted', NOW())`,
            [crypto.randomUUID(), orgAId, melbEmployeeId, fortnight]
        );
        await query(
            `INSERT INTO timesheet_submissions (id, org_id, employee_id, start_date, status, submitted_at)
             VALUES ($1, $2, $3, $4, 'Submitted', NOW())`,
            [crypto.randomUUID(), orgAId, richEmployeeId, fortnight]
        );

        // ---------------- Org B ----------------
        orgBId = crypto.randomUUID();
        await query(
            `INSERT INTO organisations (id, name, slug, portal_slug) VALUES ($1, 'Northstar Dental', 'northstar-dental', 'north772')`,
            [orgBId]
        );
        orgBLocationId = crypto.randomUUID();
        await query(`INSERT INTO locations (id, org_id, name) VALUES ($1, $2, 'Northstar Central')`, [orgBLocationId, orgBId]);

        ownerBId = crypto.randomUUID();
        await query(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ($1, $2, 'owner@northstar.com', $3, 'Company Admin')`, [ownerBId, orgBId, pw]);
        await query(`INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'OWNER')`, [orgBId, ownerBId]);
        await query(`UPDATE organisations SET owner_user_id = $1 WHERE id = $2`, [ownerBId, orgBId]);
        ownerBToken = generateToken({ id: ownerBId, organisation_id: orgBId, role: 'Company Admin', email: 'owner@northstar.com' });

        orgBEmployeeId = crypto.randomUUID();
        await query(
            `INSERT INTO employees (id, org_id, location_id, full_name, email) VALUES ($1, $2, $3, 'Ben Beta', 'ben@northstar.com')`,
            [orgBEmployeeId, orgBId, orgBLocationId]
        );
    });

    // =====================================================================
    describe('1. Permission resolution surface (/api/auth/me)', () => {
        it('reports canonical org role and zero branch permissions for an owner with no branch membership', async () => {
            const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ownerAToken}`);
            expect(res.status).toBe(200);
            const ctx = res.body.data.security_context;
            expect(ctx).toBeTruthy();
            expect(ctx.org_role).toBe('OWNER');
            expect(ctx.branch_memberships).toEqual([]);
            expect(ctx.permissions).toContain('ORGANISATION_MANAGE_BRANCHES');
            expect(ctx.permissions).not.toContain('TIMESHEET_VIEW');
            expect(ctx.permissions).not.toContain('TIMESHEET_APPROVE');
            expect(ctx.permissions).not.toContain('ROSTER_VIEW');
        });

        it('reports both the organisation role and the Melbourne branch role for Sarah', async () => {
            const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${sarahToken}`);
            expect(res.status).toBe(200);
            const ctx = res.body.data.security_context;
            expect(ctx.org_role).toBe('ORG_MANAGER');
            expect(ctx.active_branch_id).toBe(melbourneId);
            expect(ctx.active_branch_role).toBe('BRANCH_MANAGER');
            expect(ctx.permissions).toContain('TIMESHEET_VIEW');
            expect(ctx.permissions).toContain('TIMESHEET_APPROVE');
            expect(ctx.permissions).not.toContain('ORGANISATION_UPDATE');
            expect(ctx.branch_memberships.map((b: any) => b.branchId)).toEqual([melbourneId]);
        });

        it('normalises legacy branch role strings into canonical branch roles', async () => {
            const legacyUserId = crypto.randomUUID();
            await query(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ($1, $2, 'legacy@vertex.com', 'x', 'Manager')`, [legacyUserId, orgAId]);
            await query(`INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'Manager')`, [orgAId, legacyUserId]);
            await query(`INSERT INTO location_memberships (user_id, location_id, role) VALUES ($1, $2, 'manager')`, [legacyUserId, geelongId]);
            const legacyToken = generateToken({ id: legacyUserId, organisation_id: orgAId, location_id: geelongId, role: 'Manager', email: 'legacy@vertex.com' });

            const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${legacyToken}`);
            expect(res.status).toBe(200);
            expect(res.body.data.security_context.org_role).toBe('ORG_MANAGER');
            expect(res.body.data.security_context.active_branch_role).toBe('BRANCH_MANAGER');
        });
    });

    // =====================================================================
    describe('2. THE CRITICAL RULE: organisation roles do not inherit branch timesheet access', () => {
        it('blocks an OWNER without branch membership from listing timesheets (403)', async () => {
            const res = await request(app)
                .get(`/api/submissions?start_date=${fortnight}`)
                .set('Authorization', `Bearer ${ownerAToken}`);
            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
        });

        it('blocks an ORG_MANAGER without branch membership from listing timesheets (403)', async () => {
            const res = await request(app)
                .get(`/api/submissions?start_date=${fortnight}`)
                .set('Authorization', `Bearer ${orgManagerAToken}`);
            expect(res.status).toBe(403);
        });

        it('blocks an OWNER without branch membership from approving a timesheet (403)', async () => {
            const res = await request(app)
                .post('/api/submissions/approve')
                .set('Authorization', `Bearer ${ownerAToken}`)
                .send({ employee_id: melbEmployeeId, start_date: fortnight });
            expect(res.status).toBe(403);
        });

        it('blocks an ORG_MANAGER without branch membership from reviewing a timesheet (403)', async () => {
            const res = await request(app)
                .post('/api/submissions/review')
                .set('Authorization', `Bearer ${orgManagerAToken}`)
                .send({ employee_id: melbEmployeeId, start_date: fortnight });
            expect(res.status).toBe(403);
        });

        it('blocks an OWNER without branch membership from rostering (403)', async () => {
            const res = await request(app)
                .post('/api/roster/auto-roster')
                .set('Authorization', `Bearer ${ownerAToken}`)
                .send({ start_date: fortnight });
            expect(res.status).toBe(403);
        });

        it('still grants organisation-level capability to the OWNER (branch management)', async () => {
            const res = await request(app)
                .get('/api/organisation/members')
                .set('Authorization', `Bearer ${ownerAToken}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    // =====================================================================
    describe('3. Branch isolation for a combined ORG_MANAGER + BRANCH_MANAGER', () => {
        it('allows Sarah to list Melbourne timesheets (200) and only sees Melbourne staff', async () => {
            const res = await request(app)
                .get(`/api/submissions?start_date=${fortnight}&location_id=${melbourneId}`)
                .set('Authorization', `Bearer ${sarahToken}`);
            expect(res.status).toBe(200);
            const ids = res.body.data.map((r: any) => r.employee_id);
            expect(ids).toContain(melbEmployeeId);
            expect(ids).not.toContain(richEmployeeId);
        });

        it('denies Sarah access to Richmond timesheets (403)', async () => {
            const res = await request(app)
                .get(`/api/submissions?start_date=${fortnight}&location_id=${richmondId}`)
                .set('Authorization', `Bearer ${sarahToken}`);
            expect(res.status).toBe(403);
        });

        it('denies Sarah access to Geelong, where she holds no membership (403)', async () => {
            const res = await request(app)
                .get(`/api/submissions?start_date=${fortnight}&location_id=${geelongId}`)
                .set('Authorization', `Bearer ${sarahToken}`);
            expect(res.status).toBe(403);
        });

        it('denies Sarah approval of a Richmond employee timesheet (403)', async () => {
            const res = await request(app)
                .post('/api/submissions/approve')
                .set('Authorization', `Bearer ${sarahToken}`)
                .send({ employee_id: richEmployeeId, start_date: fortnight });
            expect(res.status).toBe(403);
        });

        it('denies Sarah bulk-approval of a Richmond employee timesheet', async () => {
            const res = await request(app)
                .post('/api/submissions/bulk-approve')
                .set('Authorization', `Bearer ${sarahToken}`)
                .send({ employee_ids: [richEmployeeId], start_date: fortnight });
            expect([403, 404]).toContain(res.status);
        });

        it('allows Sarah to approve a Melbourne employee timesheet (200)', async () => {
            const res = await request(app)
                .post('/api/submissions/approve')
                .set('Authorization', `Bearer ${sarahToken}`)
                .send({ employee_id: melbEmployeeId, start_date: fortnight });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('denies Sarah organisation settings updates (403) - branch role is not an org role', async () => {
            const res = await request(app)
                .put('/api/organisation/settings')
                .set('Authorization', `Bearer ${sarahToken}`)
                .send({ display_name: 'Hijacked Name' });
            expect(res.status).toBe(403);
        });
    });

    // =====================================================================
    describe('4. Anti-privilege escalation', () => {
        it('blocks Sarah from changing her own organisation role (403)', async () => {
            const res = await request(app)
                .put(`/api/organisation/members/${sarahId}/role`)
                .set('Authorization', `Bearer ${sarahToken}`)
                .send({ role: 'OWNER' });
            expect(res.status).toBe(403);
        });

        it('blocks a branch manager from changing another user organisation role (403)', async () => {
            const res = await request(app)
                .put(`/api/organisation/members/${plainMemberId}/role`)
                .set('Authorization', `Bearer ${sarahToken}`)
                .send({ role: 'ORG_ADMIN' });
            expect(res.status).toBe(403);
        });

        it('blocks Sarah from assigning herself to another branch (403)', async () => {
            const res = await request(app)
                .post(`/api/locations/${geelongId}/members`)
                .set('Authorization', `Bearer ${sarahToken}`)
                .send({ user_id: sarahId, role: 'BRANCH_ADMIN' });
            expect(res.status).toBe(403);
        });

        it('blocks Sarah from assigning anyone to a branch she does not administer (403)', async () => {
            const res = await request(app)
                .post(`/api/locations/${richmondId}/members`)
                .set('Authorization', `Bearer ${sarahToken}`)
                .send({ user_id: plainMemberId, role: 'BRANCH_MANAGER' });
            expect(res.status).toBe(403);
        });

        it('blocks a branch manager from escalating their own branch role (403)', async () => {
            const res = await request(app)
                .put(`/api/locations/${melbourneId}/members/${sarahId}`)
                .set('Authorization', `Bearer ${sarahToken}`)
                .send({ role: 'BRANCH_ADMIN' });
            expect(res.status).toBe(403);
        });

        it('blocks a branch manager from revoking their own branch membership (403)', async () => {
            const res = await request(app)
                .delete(`/api/locations/${melbourneId}/members/${sarahId}`)
                .set('Authorization', `Bearer ${sarahToken}`);
            expect(res.status).toBe(403);
        });

        it('blocks the owner from removing themselves from the organisation (403)', async () => {
            const res = await request(app)
                .delete(`/api/organisation/members/${ownerAId}`)
                .set('Authorization', `Bearer ${ownerAToken}`);
            expect(res.status).toBe(403);
        });

        it('blocks a non-owner from granting the OWNER role', async () => {
            // Richmond BRANCH_ADMIN is only ORG_MANAGER at org level: no ORGANISATION_MANAGE_USERS
            const res = await request(app)
                .put(`/api/organisation/members/${plainMemberId}/role`)
                .set('Authorization', `Bearer ${richAdminToken}`)
                .send({ role: 'OWNER' });
            expect(res.status).toBe(403);
        });
    });

    // =====================================================================
    describe('5. Organisation (tenant) isolation', () => {
        it('never leaks Org A members to an Org B owner', async () => {
            const res = await request(app)
                .get('/api/organisation/members')
                .set('Authorization', `Bearer ${ownerBToken}`);
            expect(res.status).toBe(200);
            const userIds = res.body.data.map((m: any) => m.user_id);
            expect(userIds).toContain(ownerBId);
            expect(userIds).not.toContain(ownerAId);
            expect(userIds).not.toContain(sarahId);
        });

        it('blocks an Org B owner from listing members of an Org A branch', async () => {
            const res = await request(app)
                .get(`/api/locations/${melbourneId}/members`)
                .set('Authorization', `Bearer ${ownerBToken}`);
            expect([403, 404]).toContain(res.status);
        });

        it('blocks an Org B owner from assigning a user to an Org A branch', async () => {
            const res = await request(app)
                .post(`/api/locations/${melbourneId}/members`)
                .set('Authorization', `Bearer ${ownerBToken}`)
                .send({ user_id: ownerBId, role: 'BRANCH_ADMIN' });
            expect([400, 403, 404]).toContain(res.status);
        });

        it('blocks an Org B owner from changing an Org A member role', async () => {
            const res = await request(app)
                .put(`/api/organisation/members/${sarahId}/role`)
                .set('Authorization', `Bearer ${ownerBToken}`)
                .send({ role: 'OWNER' });
            expect([403, 404]).toContain(res.status);

            const check = await query('SELECT role FROM organisation_members WHERE organisation_id = $1 AND user_id = $2', [orgAId, sarahId]);
            expect(check.rows[0].role).not.toBe('OWNER');
        });

        it('blocks an Org B owner from updating an Org A branch', async () => {
            const res = await request(app)
                .put(`/api/locations/${melbourneId}`)
                .set('Authorization', `Bearer ${ownerBToken}`)
                .send({ name: 'Stolen Branch' });
            expect([403, 404]).toContain(res.status);
        });
    });

    // =====================================================================
    describe('6. ID tampering protections', () => {
        it('rejects a forged location_id belonging to another organisation', async () => {
            const res = await request(app)
                .get(`/api/submissions?start_date=${fortnight}&location_id=${orgBLocationId}`)
                .set('Authorization', `Bearer ${sarahToken}`);
            expect(res.status).toBe(403);
        });

        it('rejects approving a foreign-organisation employee id', async () => {
            const res = await request(app)
                .post('/api/submissions/approve')
                .set('Authorization', `Bearer ${sarahToken}`)
                .send({ employee_id: orgBEmployeeId, start_date: fortnight });
            expect([403, 404]).toContain(res.status);
        });

        it('rejects a random non-existent branch id', async () => {
            const res = await request(app)
                .get(`/api/submissions?start_date=${fortnight}&location_id=${crypto.randomUUID()}`)
                .set('Authorization', `Bearer ${sarahToken}`);
            expect(res.status).toBe(403);
        });

        it('rejects switching the active location to a branch without membership', async () => {
            const res = await request(app)
                .post('/api/auth/select-location')
                .set('Authorization', `Bearer ${sarahToken}`)
                .send({ location_id: richmondId });
            expect(res.status).toBe(403);
        });

        it('rejects switching the active location to another organisation branch', async () => {
            const res = await request(app)
                .post('/api/auth/select-location')
                .set('Authorization', `Bearer ${sarahToken}`)
                .send({ location_id: orgBLocationId });
            expect(res.status).toBe(403);
        });
    });

    // =====================================================================
    describe('7. Membership management & structured audit logging', () => {
        it('lets the owner grant branch access and records BRANCH_ACCESS_GRANTED with previous/new values', async () => {
            const res = await request(app)
                .post(`/api/locations/${geelongId}/members`)
                .set('Authorization', `Bearer ${ownerAToken}`)
                .send({ user_id: plainMemberId, role: 'BRANCH_MANAGER' });
            expect(res.status).toBe(201);
            expect(res.body.data.branch_role).toBe('BRANCH_MANAGER');

            const logs = await query(
                `SELECT * FROM audit_logs WHERE org_id = $1 AND action = 'BRANCH_ACCESS_GRANTED' AND target_user_id = $2`,
                [orgAId, plainMemberId]
            );
            expect(logs.rows.length).toBeGreaterThan(0);
            expect(logs.rows[0].new_value).toBe('BRANCH_MANAGER');
            expect(logs.rows[0].location_id).toBe(geelongId);
            expect(logs.rows[0].actor_id).toBe(ownerAId);
        });

        it('lets the owner change a branch role and records BRANCH_ROLE_CHANGED with previous/new values', async () => {
            const res = await request(app)
                .put(`/api/locations/${geelongId}/members/${plainMemberId}`)
                .set('Authorization', `Bearer ${ownerAToken}`)
                .send({ role: 'BRANCH_ADMIN' });
            expect(res.status).toBe(200);

            const logs = await query(
                `SELECT * FROM audit_logs WHERE org_id = $1 AND action = 'BRANCH_ROLE_CHANGED' AND target_user_id = $2`,
                [orgAId, plainMemberId]
            );
            expect(logs.rows.length).toBeGreaterThan(0);
            expect(logs.rows[0].previous_value).toBe('BRANCH_MANAGER');
            expect(logs.rows[0].new_value).toBe('BRANCH_ADMIN');
        });

        it('lets the owner change an organisation role and records ORG_ROLE_CHANGED with previous/new values', async () => {
            const res = await request(app)
                .put(`/api/organisation/members/${richAdminId}/role`)
                .set('Authorization', `Bearer ${ownerAToken}`)
                .send({ role: 'ORG_ADMIN' });
            expect(res.status).toBe(200);
            expect(res.body.data.organisation_role).toBe('ORG_ADMIN');

            const logs = await query(
                `SELECT * FROM audit_logs WHERE org_id = $1 AND action = 'ORG_ROLE_CHANGED' AND target_user_id = $2`,
                [orgAId, richAdminId]
            );
            expect(logs.rows.length).toBeGreaterThan(0);
            expect(logs.rows[0].previous_value).toBe('ORG_MANAGER');
            expect(logs.rows[0].new_value).toBe('ORG_ADMIN');
        });

        it('lets the owner revoke branch access and records BRANCH_ACCESS_REVOKED', async () => {
            const res = await request(app)
                .delete(`/api/locations/${geelongId}/members/${plainMemberId}`)
                .set('Authorization', `Bearer ${ownerAToken}`);
            expect(res.status).toBe(200);

            const logs = await query(
                `SELECT * FROM audit_logs WHERE org_id = $1 AND action = 'BRANCH_ACCESS_REVOKED' AND target_user_id = $2`,
                [orgAId, plainMemberId]
            );
            expect(logs.rows.length).toBeGreaterThan(0);

            const membership = await query('SELECT * FROM location_memberships WHERE location_id = $1 AND user_id = $2', [geelongId, plainMemberId]);
            expect(membership.rows.length).toBe(0);
        });

        it('refuses to assign a user who is not a member of the organisation', async () => {
            const res = await request(app)
                .post(`/api/locations/${geelongId}/members`)
                .set('Authorization', `Bearer ${ownerAToken}`)
                .send({ user_id: ownerBId, role: 'BRANCH_MANAGER' });
            expect(res.status).toBe(400);
        });

        it('lists branch members for an authorised branch administrator', async () => {
            const res = await request(app)
                .get(`/api/locations/${richmondId}/members`)
                .set('Authorization', `Bearer ${richAdminToken}`);
            expect(res.status).toBe(200);
            const ids = res.body.data.map((m: any) => m.user_id);
            expect(ids).toContain(richAdminId);
        });
    });

    // =====================================================================
    describe('8. Branch access granted on demand takes effect immediately', () => {
        it('gives the owner Melbourne timesheet access only after an explicit branch membership is granted', async () => {
            const before = await request(app)
                .get(`/api/submissions?start_date=${fortnight}&location_id=${melbourneId}`)
                .set('Authorization', `Bearer ${ownerAToken}`);
            expect(before.status).toBe(403);

            await query(
                `INSERT INTO location_memberships (user_id, location_id, role) VALUES ($1, $2, 'BRANCH_MANAGER')`,
                [ownerAId, melbourneId]
            );

            const after = await request(app)
                .get(`/api/submissions?start_date=${fortnight}&location_id=${melbourneId}`)
                .set('Authorization', `Bearer ${ownerAToken}`);
            expect(after.status).toBe(200);

            // Richmond remains forbidden: access is per-branch, never organisation-wide
            const richmond = await request(app)
                .get(`/api/submissions?start_date=${fortnight}&location_id=${richmondId}`)
                .set('Authorization', `Bearer ${ownerAToken}`);
            expect(richmond.status).toBe(403);
        });

        it('revokes access again when the branch membership is deactivated', async () => {
            await query(
                `UPDATE location_memberships SET is_active = false WHERE user_id = $1 AND location_id = $2`,
                [ownerAId, melbourneId]
            );

            const res = await request(app)
                .get(`/api/submissions?start_date=${fortnight}&location_id=${melbourneId}`)
                .set('Authorization', `Bearer ${ownerAToken}`);
            expect(res.status).toBe(403);
        });
    });
});
