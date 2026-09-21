import request from 'supertest';
import app from '../src/index';
import { newDb, DataType } from 'pg-mem';
import { setPool, query } from '../src/services/db';
import { generateToken, hashPassword } from '../src/services/auth';
import crypto from 'crypto';

describe('SimpleHours: Organisation, Locations, Roles & Custom URLs Architecture Tests', () => {
    let orgAId: string;
    let orgBId: string;
    let orgASlug: string = 'apex-corp';
    let orgAPortalSlug: string = 'apex777xyz';
    let loc1Id: string;
    let loc2Id: string;

    let ownerAUserId: string;
    let ownerAToken: string;

    let managerLoc1UserId: string;
    let managerLoc1Token: string;

    let multiLocManagerUserId: string;
    let multiLocManagerToken: string;

    let employeeLoc1UserId: string;
    let employeeLoc1EmpId: string;
    let employeeLoc1Token: string;

    let employeeLoc2UserId: string;
    let employeeLoc2EmpId: string;

    let platformAdminToken: string;

    const testFortnight = '2026-04-12';

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
                allow_employee_chat BOOLEAN DEFAULT true,
                timesheet_entry_mode TEXT DEFAULT 'employee',
                owner_user_id UUID,
                logo_url TEXT,
                break_mins_weekday NUMERIC DEFAULT 30,
                break_mins_weekend NUMERIC DEFAULT 0,
                break_threshold_hours NUMERIC DEFAULT 6,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE locations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                name TEXT NOT NULL,
                address TEXT,
                timezone TEXT DEFAULT 'Australia/Sydney',
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

            CREATE TABLE roster_templates (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                employee_id UUID NOT NULL,
                day_index INTEGER NOT NULL,
                roster_in TEXT,
                roster_out TEXT,
                roster_hours NUMERIC DEFAULT 0,
                segment_type TEXT DEFAULT 'Work'
            );

            CREATE TABLE public_holidays (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                holiday_date TEXT NOT NULL,
                name TEXT NOT NULL,
                UNIQUE(org_id, holiday_date)
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
                action TEXT NOT NULL,
                entity_id UUID,
                entity_type TEXT,
                details TEXT,
                scope TEXT NOT NULL DEFAULT 'organisation',
                ip_address TEXT
            );
        `);

        const PgPool = db.adapters.createPg().Pool;
        setPool(new PgPool());

        const pwHash = await hashPassword('Password123!');

        // 1. Create Org A and Org B
        orgAId = crypto.randomUUID();
        await query(
            `INSERT INTO organisations (id, name, slug, portal_slug, timesheet_entry_mode)
             VALUES ($1, 'Apex Enterprises', $2, $3, 'employee')`,
            [orgAId, orgASlug, orgAPortalSlug]
        );

        orgBId = crypto.randomUUID();
        await query(
            `INSERT INTO organisations (id, name, slug, portal_slug, timesheet_entry_mode)
             VALUES ($1, 'Beacon Health', 'beacon-health', 'beacon123', 'employee')`,
            [orgBId]
        );

        // 2. Locations for Org A
        loc1Id = crypto.randomUUID();
        await query(`INSERT INTO locations (id, org_id, name, address, timezone) VALUES ($1, $2, 'Downtown HQ', '100 Main St', 'Australia/Sydney')`, [loc1Id, orgAId]);

        loc2Id = crypto.randomUUID();
        await query(`INSERT INTO locations (id, org_id, name, address, timezone) VALUES ($1, $2, 'Westside Branch', '200 West St', 'Australia/Melbourne')`, [loc2Id, orgAId]);

        // 3. Org Owner for Org A
        ownerAUserId = crypto.randomUUID();
        await query(
            `INSERT INTO users (id, org_id, email, password_hash, role) VALUES ($1, $2, 'owner@apex.com', $3, 'Company Admin')`,
            [ownerAUserId, orgAId, pwHash]
        );
        await query(
            `INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'Company Admin')`,
            [orgAId, ownerAUserId]
        );
        await query(`UPDATE organisations SET owner_user_id = $1 WHERE id = $2`, [ownerAUserId, orgAId]);
        ownerAToken = generateToken({ id: ownerAUserId, organisation_id: orgAId, role: 'Company Admin', email: 'owner@apex.com' });

        // 4. Location 1 Manager
        managerLoc1UserId = crypto.randomUUID();
        await query(
            `INSERT INTO users (id, org_id, email, password_hash, role) VALUES ($1, $2, 'manager1@apex.com', $3, 'Manager')`,
            [managerLoc1UserId, orgAId, pwHash]
        );
        await query(
            `INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'Manager')`,
            [orgAId, managerLoc1UserId]
        );
        await query(
            `INSERT INTO location_memberships (user_id, location_id, role) VALUES ($1, $2, 'manager')`,
            [managerLoc1UserId, loc1Id]
        );
        managerLoc1Token = generateToken({
            id: managerLoc1UserId,
            organisation_id: orgAId,
            location_id: loc1Id,
            role: 'Manager',
            email: 'manager1@apex.com'
        });

        // 5. Multi-Location Manager (Loc 1 + Loc 2)
        multiLocManagerUserId = crypto.randomUUID();
        await query(
            `INSERT INTO users (id, org_id, email, password_hash, role) VALUES ($1, $2, 'multimanager@apex.com', $3, 'Manager')`,
            [multiLocManagerUserId, orgAId, pwHash]
        );
        await query(
            `INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'Manager')`,
            [orgAId, multiLocManagerUserId]
        );
        await query(`INSERT INTO location_memberships (user_id, location_id, role) VALUES ($1, $2, 'manager')`, [multiLocManagerUserId, loc1Id]);
        await query(`INSERT INTO location_memberships (user_id, location_id, role) VALUES ($1, $2, 'manager')`, [multiLocManagerUserId, loc2Id]);
        multiLocManagerToken = generateToken({
            id: multiLocManagerUserId,
            organisation_id: orgAId,
            location_id: loc1Id,
            role: 'Manager',
            email: 'multimanager@apex.com'
        });

        // 6. Employee in Location 1
        employeeLoc1UserId = crypto.randomUUID();
        employeeLoc1EmpId = crypto.randomUUID();
        await query(
            `INSERT INTO users (id, org_id, email, password_hash, role) VALUES ($1, $2, 'emp1@apex.com', $3, 'Employee')`,
            [employeeLoc1UserId, orgAId, pwHash]
        );
        await query(`INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'Employee')`, [orgAId, employeeLoc1UserId]);
        await query(
            `INSERT INTO employees (id, org_id, location_id, full_name, department, email, user_id, contracted_hours)
             VALUES ($1, $2, $3, 'Alice LocOne', 'Operations', 'emp1@apex.com', $4, 76)`,
            [employeeLoc1EmpId, orgAId, loc1Id, employeeLoc1UserId]
        );
        employeeLoc1Token = generateToken({
            id: employeeLoc1UserId,
            organisation_id: orgAId,
            location_id: loc1Id,
            role: 'Employee',
            email: 'emp1@apex.com'
        });

        // 7. Employee in Location 2
        employeeLoc2UserId = crypto.randomUUID();
        employeeLoc2EmpId = crypto.randomUUID();
        await query(
            `INSERT INTO users (id, org_id, email, password_hash, role) VALUES ($1, $2, 'emp2@apex.com', $3, 'Employee')`,
            [employeeLoc2UserId, orgAId, pwHash]
        );
        await query(`INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'Employee')`, [orgAId, employeeLoc2UserId]);
        await query(
            `INSERT INTO employees (id, org_id, location_id, full_name, department, email, user_id, contracted_hours)
             VALUES ($1, $2, $3, 'Bob LocTwo', 'Logistics', 'emp2@apex.com', $4, 76)`,
            [employeeLoc2EmpId, orgAId, loc2Id, employeeLoc2UserId]
        );

        // 8. Platform Admin Token
        const platformAdminId = crypto.randomUUID();
        platformAdminToken = generateToken({
            id: platformAdminId,
            organisation_id: null,
            role: 'Platform Admin',
            email: 'superadmin@platform.system'
        });
    });

    describe('A. Strict Location Isolation', () => {
        it('Manager of Location 1 only sees employees in Location 1 in GET /api/employees', async () => {
            const res = await request(app)
                .get('/api/employees')
                .set('Authorization', `Bearer ${managerLoc1Token}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            const empIds = res.body.data.map((e: any) => e.id);
            expect(empIds).toContain(employeeLoc1EmpId);
            expect(empIds).not.toContain(employeeLoc2EmpId);
        });

        it('Manager of Location 1 is forbidden (403) from modifying an employee in Location 2', async () => {
            const res = await request(app)
                .put(`/api/employees/${employeeLoc2EmpId}`)
                .set('Authorization', `Bearer ${managerLoc1Token}`)
                .send({ full_name: 'Bob Modified' });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('LOCATION_FORBIDDEN');
        });

        it('Manager of Location 1 is forbidden (403) from deactivating an employee in Location 2', async () => {
            const res = await request(app)
                .post(`/api/employees/${employeeLoc2EmpId}/deactivate`)
                .set('Authorization', `Bearer ${managerLoc1Token}`);

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('LOCATION_FORBIDDEN');
        });

        it('Manager of Location 1 cannot record shifts for an employee in Location 2 (403)', async () => {
            const res = await request(app)
                .post('/api/records')
                .set('Authorization', `Bearer ${managerLoc1Token}`)
                .send({
                    employee_id: employeeLoc2EmpId,
                    record_date: '2026-04-13',
                    segments: [{ segment_type: 'Work', actual_in: '09:00', actual_out: '17:00' }]
                });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('LOCATION_FORBIDDEN');
        });
    });

    describe('B. Strict Role Separation & Organisation Overview', () => {
        it('Organisation Owner without active location context receives owner overview with org statistics', async () => {
            const res = await request(app)
                .get('/api/dashboard/today')
                .set('Authorization', `Bearer ${ownerAToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.is_owner_view).toBe(true);
            expect(res.body.data.metrics.total_locations).toBe(2);
            expect(res.body.data.metrics.total_employees).toBeGreaterThanOrEqual(2);
            expect(res.body.data.organisation.entry_mode).toBe('employee');
        });
    });

    describe('C. Location Switching for Multi-Location Managers', () => {
        it('Manager with multiple locations can switch active location context', async () => {
            const res = await request(app)
                .post('/api/auth/select-location')
                .set('Authorization', `Bearer ${multiLocManagerToken}`)
                .send({ location_id: loc2Id });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.location.id).toBe(loc2Id);
            expect(res.body.data.token).toBeDefined();

            // Verify the new token grants access to Location 2 employees
            const switchedToken = res.body.data.token;
            const empRes = await request(app)
                .get('/api/employees')
                .set('Authorization', `Bearer ${switchedToken}`);

            expect(empRes.status).toBe(200);
            const ids = empRes.body.data.map((e: any) => e.id);
            expect(ids).toContain(employeeLoc2EmpId);
            expect(ids).not.toContain(employeeLoc1EmpId);
        });

        it('Rejects location switch (403) when user does not hold membership in target location', async () => {
            const fakeLocId = crypto.randomUUID();
            const res = await request(app)
                .post('/api/auth/select-location')
                .set('Authorization', `Bearer ${managerLoc1Token}`)
                .send({ location_id: fakeLocId });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('LOCATION_FORBIDDEN');
        });
    });

    describe('D. Single Active Organisation Context', () => {
        it('Returns 409 SESSION_ORG_CONFLICT when logging into Org B while bearer token is for Org A', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .set('Authorization', `Bearer ${ownerAToken}`)
                .send({
                    email: 'owner@apex.com',
                    password: 'Password123!',
                    organisation_slug: 'beacon-health'
                });

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('SESSION_ORG_CONFLICT');
            expect(res.body.message).toMatch(/authenticated in another organisation/i);
        });
    });

    describe('E. Custom Portal URLs & Regeneration', () => {
        it('Owner can view organisation settings and custom portal URL', async () => {
            const res = await request(app)
                .get('/api/organisation/me')
                .set('Authorization', `Bearer ${ownerAToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.portal_slug).toBe(orgAPortalSlug);
            expect(res.body.data.portal_url).toContain(orgAPortalSlug);
        });

        it('Owner can regenerate custom portal URL slug', async () => {
            const res = await request(app)
                .post('/api/organisation/regenerate-portal-url')
                .set('Authorization', `Bearer ${ownerAToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.portal_slug).toBeDefined();
            expect(res.body.data.portal_slug).not.toBe(orgAPortalSlug);
            orgAPortalSlug = res.body.data.portal_slug;
        });

        it('Non-owner manager is forbidden (403) from regenerating portal URL', async () => {
            const res = await request(app)
                .post('/api/organisation/regenerate-portal-url')
                .set('Authorization', `Bearer ${managerLoc1Token}`);

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('OWNER_REQUIRED');
        });
    });

    describe('F. Portal Slug Public Lookup', () => {
        it('Resolves organisation details via portal slug without sensitive fields', async () => {
            const res = await request(app)
                .get(`/api/organisation/lookup/${orgAPortalSlug}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.name).toBe('Apex Enterprises');
            expect(res.body.data.portal_slug).toBe(orgAPortalSlug);
            expect(res.body.data.timesheet_entry_mode).toBe('employee');
            // Security check: must not expose passwords or secrets
            expect(res.body.data.roster_lock_password_hash).toBeUndefined();
            expect(res.body.data.owner_id).toBeUndefined();
        });

        it('Returns 404 for non-existent portal slug', async () => {
            const res = await request(app)
                .get('/api/organisation/lookup/non-existent-portal-slug-999');

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });

    describe('G & H. Timesheet Entry Modes Enforcement', () => {
        it('In Employee Entry mode, employee can submit timesheet directly', async () => {
            const res = await request(app)
                .post('/api/submissions/submit')
                .set('Authorization', `Bearer ${employeeLoc1Token}`)
                .send({
                    start_date: testFortnight,
                    employee_id: employeeLoc1EmpId
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('Submitted');
        });

        it('Owner switches organisation to Manager Entry mode', async () => {
            const res = await request(app)
                .put('/api/organisation/settings')
                .set('Authorization', `Bearer ${ownerAToken}`)
                .send({ timesheet_entry_mode: 'manager' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.timesheet_entry_mode).toBe('manager');
        });

        it('In Manager Entry mode, employee direct submission is rejected (403 TIMESHEET_MODE_MANAGER_ONLY)', async () => {
            // First unlock/reset timesheet status
            await query(`DELETE FROM timesheet_submissions WHERE employee_id = $1 AND start_date = $2`, [employeeLoc1EmpId, '2026-04-26']);

            const res = await request(app)
                .post('/api/submissions/submit')
                .set('Authorization', `Bearer ${employeeLoc1Token}`)
                .send({
                    start_date: '2026-04-26',
                    employee_id: employeeLoc1EmpId
                });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('TIMESHEET_MODE_MANAGER_ONLY');
        });

        it('In Manager Entry mode, Manager can submit timesheet on behalf of employee in their location', async () => {
            const res = await request(app)
                .post('/api/submissions/submit')
                .set('Authorization', `Bearer ${managerLoc1Token}`)
                .send({
                    start_date: '2026-04-26',
                    employee_id: employeeLoc1EmpId
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('I. Location CRUD & Manager Invitations Flow', () => {
        let newLocationId: string;
        let inviteToken: string;

        it('Owner creates a new location', async () => {
            const res = await request(app)
                .post('/api/locations')
                .set('Authorization', `Bearer ${ownerAToken}`)
                .send({
                    name: 'North Shore Hub',
                    address: '500 Northern Way, Sydney',
                    timezone: 'Australia/Sydney'
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.name).toBe('North Shore Hub');
            newLocationId = res.body.data.id;
        });

        it('Owner invites a manager to the newly created location', async () => {
            const res = await request(app)
                .post(`/api/locations/${newLocationId}/invite`)
                .set('Authorization', `Bearer ${ownerAToken}`)
                .send({
                    email: 'northmanager@apex.com',
                    role: 'manager'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.invite_url).toBeDefined();
            expect(res.body.data.token).toBeDefined();
            inviteToken = res.body.data.token;
        });

        it('Invited manager verifies token via GET /api/locations/verify-invite', async () => {
            const res = await request(app)
                .get(`/api/locations/verify-invite?token=${inviteToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.email).toBe('northmanager@apex.com');
            expect(res.body.data.location_name).toBe('North Shore Hub');
        });

        it('Invited manager completes setup via POST /api/locations/accept-invite', async () => {
            const res = await request(app)
                .post('/api/locations/accept-invite')
                .send({
                    token: inviteToken,
                    password: 'SecurePassword123!'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.token).toBeDefined();
            expect(res.body.data.user.role).toBe('Manager');
            expect(res.body.data.user.location_id).toBe(newLocationId);
        });

        it('Owner deactivates and reactivates location', async () => {
            // Deactivate
            const deact = await request(app)
                .post(`/api/locations/${newLocationId}/deactivate`)
                .set('Authorization', `Bearer ${ownerAToken}`);
            expect(deact.status).toBe(200);
            expect(deact.body.success).toBe(true);

            // Verify is_active = false
            const check = await request(app)
                .get('/api/locations?include_inactive=true')
                .set('Authorization', `Bearer ${ownerAToken}`);
            const target = check.body.data.find((l: any) => l.id === newLocationId);
            expect(target.is_active).toBe(false);

            // Reactivate
            const react = await request(app)
                .post(`/api/locations/${newLocationId}/reactivate`)
                .set('Authorization', `Bearer ${ownerAToken}`);
            expect(react.status).toBe(200);
            expect(react.body.success).toBe(true);
        });
    });

    describe('J. Distinct Audit Scopes', () => {
        it('Organisation audit logs are scoped to organisation and filtered from platform audits', async () => {
            await query(
                `INSERT INTO audit_logs (id, org_id, location_id, actor_id, action, scope, details)
                 VALUES ($1, $2, $3, $4, 'LOCATION_UPDATED', 'organisation', 'Updated North Shore Hub')`,
                [crypto.randomUUID(), orgAId, loc1Id, ownerAUserId]
            );

            await query(
                `INSERT INTO audit_logs (id, org_id, actor_id, action, scope, details)
                 VALUES ($1, NULL, $2, 'TENANT_PROVISIONED', 'platform', 'Provisioned tenant Apex Enterprises')`,
                [crypto.randomUUID(), ownerAUserId]
            );

            // Org Audit endpoint returns organisation scoped logs
            const orgLogsRes = await request(app)
                .get('/api/audit')
                .set('Authorization', `Bearer ${ownerAToken}`);

            expect(orgLogsRes.status).toBe(200);
            expect(orgLogsRes.body.success).toBe(true);
            const actions = orgLogsRes.body.data.map((l: any) => l.action);
            expect(actions).toContain('LOCATION_UPDATED');
            expect(actions).not.toContain('TENANT_PROVISIONED');

            // Platform audit endpoint returns platform scoped logs
            const platLogsRes = await request(app)
                .get('/api/platform/audit-logs')
                .set('Authorization', `Bearer ${platformAdminToken}`);

            expect(platLogsRes.status).toBe(200);
            expect(platLogsRes.body.success).toBe(true);
            const platActions = platLogsRes.body.data.map((l: any) => l.action);
            expect(platActions).toContain('TENANT_PROVISIONED');
            expect(platActions).not.toContain('LOCATION_UPDATED');
        });
    });

    describe('K. Location Isolation in Timesheet Approval/Rejection', () => {
        beforeAll(async () => {
            // Submit timesheet for Location 2 employee
            await query(
                `INSERT INTO timesheet_submissions (id, org_id, employee_id, start_date, status)
                 VALUES ($1, $2, $3, $4, 'Submitted')`,
                [crypto.randomUUID(), orgAId, employeeLoc2EmpId, testFortnight]
            );
        });

        it('Manager of Location 1 cannot approve timesheet for employee in Location 2 (403)', async () => {
            const res = await request(app)
                .post('/api/submissions/approve')
                .set('Authorization', `Bearer ${managerLoc1Token}`)
                .send({
                    employee_id: employeeLoc2EmpId,
                    start_date: testFortnight
                });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('LOCATION_FORBIDDEN');
        });

        it('Manager of Location 1 cannot reject timesheet for employee in Location 2 (403)', async () => {
            const res = await request(app)
                .post('/api/submissions/reject')
                .set('Authorization', `Bearer ${managerLoc1Token}`)
                .send({
                    employee_id: employeeLoc2EmpId,
                    start_date: testFortnight,
                    reason: 'Not my location'
                });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('LOCATION_FORBIDDEN');
        });
    });
});
