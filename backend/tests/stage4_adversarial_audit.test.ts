import request from 'supertest';
import app from '../src/index';
import { newDb, DataType } from 'pg-mem';
import { setPool, query } from '../src/services/db';
import { generateToken, hashPassword } from '../src/services/auth';
import { classifyShiftHours } from '../src/services/classificationService';
import crypto from 'crypto';

describe('Stage 4 Adversarial Audit Verification Tests', () => {
    let companyAdminToken: string;
    let employeeToken: string;
    const orgId = '111e4567-e89b-12d3-a456-000000000001';
    const adminUserId = '111e4567-e89b-12d3-a456-000000000002';
    const empUserId = '111e4567-e89b-12d3-a456-000000000003';
    const empRecordId = '111e4567-e89b-12d3-a456-000000000004';
    const fortnightStart = '2026-03-29';

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
                slug TEXT,
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

            CREATE TABLE audit_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID,
                actor_id UUID,
                user_id UUID,
                action TEXT NOT NULL,
                entity_type TEXT,
                entity_id UUID,
                details JSONB,
                ip_address TEXT,
                timestamp TIMESTAMPTZ DEFAULT NOW(),
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE public_holidays (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                holiday_date TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(org_id, holiday_date)
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

            CREATE TABLE daily_records (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                employee_id UUID NOT NULL,
                record_date TEXT NOT NULL,
                has_actuals BOOLEAN DEFAULT false,
                is_unplanned BOOLEAN DEFAULT false,
                notes TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
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

            CREATE TABLE roster_templates (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                employee_id UUID NOT NULL,
                day_index INT NOT NULL,
                roster_in TEXT,
                roster_out TEXT,
                roster_hours NUMERIC,
                segment_type TEXT DEFAULT 'WORK'
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

            CREATE TABLE session_records (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                session_token TEXT UNIQUE NOT NULL,
                ip_address TEXT,
                user_agent TEXT,
                last_active_at TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 day',
                is_revoked BOOLEAN DEFAULT false
            );
        `);

        // Seed Org
        db.public.none(`INSERT INTO organisations (id, name, slug, break_mins_weekday, break_threshold_hours) VALUES ('${orgId}', 'Audit Test Org', 'audit-test', 30, 6);`);

        // Seed Users
        const pw = await hashPassword('password123');
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${adminUserId}', '${orgId}', 'admin@audit.com', '${pw}', 'Company Admin');`);
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${empUserId}', '${orgId}', 'emp@audit.com', '${pw}', 'Employee');`);

        // Org Members
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgId}', '${adminUserId}', 'Company Admin');`);
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgId}', '${empUserId}', 'Employee');`);

        // Employee Record
        db.public.none(`INSERT INTO employees (id, org_id, full_name, department, email, user_id, contracted_hours) VALUES ('${empRecordId}', '${orgId}', 'Audit Employee', 'Engineering', 'emp@audit.com', '${empUserId}', 76);`);

        // Fortnight lock (unlocked, published)
        db.public.none(`INSERT INTO fortnight_locks (org_id, start_date, roster_locked, timesheet_locked, is_published) VALUES ('${orgId}', '${fortnightStart}', false, false, true);`);

        companyAdminToken = generateToken({ id: adminUserId, email: 'admin@audit.com', organisation_id: orgId, role: 'Company Admin' });
        employeeToken = generateToken({ id: empUserId, email: 'emp@audit.com', organisation_id: orgId, role: 'Employee' });

        const PgPool = db.adapters.createPg().Pool;
        setPool(new PgPool());
    });

    describe('1. State Machine Guard Rails (C1 & C2)', () => {
        it('blocks approving unsubmitted Draft timesheet directly (Draft -> Approved blocked)', async () => {
            const res = await request(app)
                .post('/api/submissions/approve')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    employee_id: empRecordId,
                    start_date: fortnightStart
                });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_TRANSITION');
            expect(res.body.error.message).toMatch(/has not been submitted|must be submitted/i);
        });

        it('blocks moving unsubmitted Draft timesheet to Under Review (Draft -> Review blocked)', async () => {
            const res = await request(app)
                .post('/api/submissions/review')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    employee_id: empRecordId,
                    start_date: fortnightStart
                });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/missing submission identification or submission does not exist/i);
        });

        it('blocks rejecting unsubmitted Draft timesheet directly (Draft -> Rejected blocked)', async () => {
            const res = await request(app)
                .post('/api/submissions/reject')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    employee_id: empRecordId,
                    start_date: fortnightStart,
                    reason: 'Premature rejection'
                });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_TRANSITION');
            expect(res.body.error.message).toMatch(/has not been submitted/i);
        });

        it('allows normal employee submission (Draft -> Submitted)', async () => {
            const res = await request(app)
                .post('/api/submissions/submit')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({ start_date: fortnightStart });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('Submitted');
        });

        it('allows rejecting a submitted timesheet with reason (Submitted -> Rejected)', async () => {
            const res = await request(app)
                .post('/api/submissions/reject')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    employee_id: empRecordId,
                    start_date: fortnightStart,
                    reason: 'Incomplete segment info'
                });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('Rejected');
        });

        it('blocks approving a Rejected timesheet without resubmission (Rejected -> Approved blocked)', async () => {
            const res = await request(app)
                .post('/api/submissions/approve')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    employee_id: empRecordId,
                    start_date: fortnightStart
                });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('INVALID_TRANSITION');
            expect(res.body.error.message).toMatch(/must be submitted before approval/i);
        });

        it('employee resubmits the timesheet (Rejected -> Submitted)', async () => {
            const res = await request(app)
                .post('/api/submissions/submit')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({ start_date: fortnightStart });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('Submitted');
        });

        it('manager approves the resubmitted timesheet (Submitted -> Approved)', async () => {
            const res = await request(app)
                .post('/api/submissions/approve')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    employee_id: empRecordId,
                    start_date: fortnightStart
                });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('Approved');
        });

        it('blocks moving Approved timesheet to Under Review (Approved -> Review blocked)', async () => {
            const res = await request(app)
                .post('/api/submissions/review')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    employee_id: empRecordId,
                    start_date: fortnightStart
                });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('TIMESHEET_ALREADY_APPROVED');
        });

        it('blocks rejecting an Approved timesheet by direct submission_id (Approved -> Rejected blocked)', async () => {
            const subRes = await query('SELECT id FROM timesheet_submissions WHERE employee_id = $1 AND start_date = $2', [empRecordId, fortnightStart]);
            const subId = subRes.rows[0].id;

            const res = await request(app)
                .post('/api/submissions/reject')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    submission_id: subId,
                    reason: 'Trying to reject finalized timesheet'
                });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('TIMESHEET_ALREADY_APPROVED');
        });

        it('blocks resubmitting an Approved timesheet (Approved -> Submitted blocked)', async () => {
            const res = await request(app)
                .post('/api/submissions/submit')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({ start_date: fortnightStart });

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('TIMESHEET_ALREADY_APPROVED');
        });
    });

    describe('2. Approved Period Immutability Protections (C3 & C4)', () => {
        it('auto-roster preserves approved timesheet shifts without overwriting', async () => {
            // Setup a template for the employee
            await query(`
                INSERT INTO roster_templates (employee_id, day_index, roster_in, roster_out, roster_hours)
                VALUES ($1, 0, '08:00', '16:00', 7.5)
            `, [empRecordId]);

            // Add an approved shift for day 0 (2026-03-29)
            const recRes = await query(`
                INSERT INTO daily_records (org_id, employee_id, record_date, has_actuals)
                VALUES ($1, $2, '2026-03-29', true)
                ON CONFLICT (org_id, employee_id, record_date) DO UPDATE SET has_actuals = true
                RETURNING id
            `, [orgId, empRecordId]);
            const recId = recRes.rows[0].id;

            await query(`
                INSERT INTO shift_segments (record_id, segment_type, roster_in, roster_out, roster_hours, actual_in, actual_out, actual_hours)
                VALUES ($1, 'WORK', '10:00', '18:00', 7.5, '10:00', '18:00', 7.5)
            `, [recId]);

            // Attempt auto-roster for this fortnight
            const autoRes = await request(app)
                .post('/api/roster/auto-roster')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({ start_date: fortnightStart, selected_days: [0] });

            expect(autoRes.status).toBe(200);

            // Verify original shift segment was NOT modified or replaced by the template
            const segCheck = await query('SELECT roster_in, roster_out FROM shift_segments WHERE record_id = $1', [recId]);
            expect(segCheck.rows.length).toBe(1);
            expect(segCheck.rows[0].roster_in).toBe('10:00'); // Preserved original, NOT 08:00
        });

        it('auto-log preserves approved timesheet shifts without overwriting actuals', async () => {
            const autoLogRes = await request(app)
                .post('/api/roster/auto-log')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({ start_date: fortnightStart, selected_days: [0] });

            expect(autoLogRes.status).toBe(200);

            // Verify actuals remain intact
            const recRes = await query("SELECT id FROM daily_records WHERE employee_id = $1 AND record_date = '2026-03-29'", [empRecordId]);
            const segCheck = await query('SELECT actual_in, actual_out FROM shift_segments WHERE record_id = $1', [recRes.rows[0].id]);
            expect(segCheck.rows[0].actual_in).toBe('10:00');
            expect(segCheck.rows[0].actual_out).toBe('18:00');
        });

        it('blocks DELETE /api/employees/:id for employee with approved timesheet (C4)', async () => {
            const delRes = await request(app)
                .delete(`/api/employees/${empRecordId}`)
                .set('Authorization', `Bearer ${companyAdminToken}`);

            expect(delRes.status).toBe(403);
            expect(delRes.body.error.code).toBe('EMPLOYEE_HAS_APPROVED_PAYROLL');
            expect(delRes.body.error.message).toMatch(/cannot permanently delete an employee with approved timesheets/i);

            // Verify employee still exists
            const empCheck = await query('SELECT id FROM employees WHERE id = $1', [empRecordId]);
            expect(empCheck.rows.length).toBe(1);
        });
    });

    describe('3. Parameterized Query Integrity & Org Break Config', () => {
        it('portal team-roster functions cleanly with parameterized bounds', async () => {
            // Ensure fortnight is published and roster locked for employee viewing
            await query("UPDATE fortnight_locks SET is_published = true, roster_locked = true WHERE org_id = $1 AND start_date = $2", [orgId, fortnightStart]);

            const res = await request(app)
                .get(`/api/portal/team-roster?start_date=${fortnightStart}`)
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.team.length).toBe(1);
            expect(res.body.data.team[0].id).toBe(empRecordId);
        });

        it('classifyShiftHours respects org break configurations', async () => {
            // Default org setting is 30m break when shift >= 6h
            const slices = await classifyShiftHours(orgId, '2026-03-30', '09:00', '17:00', 'WORK');
            expect(slices.length).toBe(1);
            expect(slices[0].normalHours).toBe(7.5); // 8h minus 0.5h break
        });
    });
});
