import request from 'supertest';
import app from '../src/index';
import { newDb, DataType } from 'pg-mem';
import { setPool } from '../src/services/db';
import { generateToken, hashPassword } from '../src/services/auth';
import crypto from 'crypto';

describe('Timesheet Submissions and Approvals Workflow Tests', () => {
    let companyAdminToken: string;
    let employeeToken: string;
    const orgId = '777e4567-e89b-12d3-a456-000000000001';
    const adminUserId = '777e4567-e89b-12d3-a456-000000000002';
    const empUserId = '777e4567-e89b-12d3-a456-000000000003';
    const empRecordId = '777e4567-e89b-12d3-a456-000000000004';
    const startDate = '2026-03-29';

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
                action TEXT NOT NULL,
                entity_type TEXT,
                entity_id UUID,
                details JSONB,
                timestamp TIMESTAMPTZ,
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
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE shift_segments (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                record_id UUID NOT NULL,
                segment_type TEXT NOT NULL,
                roster_in TEXT,
                roster_out TEXT,
                roster_hours NUMERIC,
                actual_in TEXT,
                actual_out TEXT,
                actual_hours NUMERIC,
                actual_segment_type TEXT,
                is_unplanned BOOLEAN DEFAULT false,
                notes TEXT
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
        `);

        // Seed Org
        db.public.none(`INSERT INTO organisations (id, name) VALUES ('${orgId}', 'Approval Corp');`);

        // Seed Users
        const pw = await hashPassword('password123');
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${adminUserId}', '${orgId}', 'admin@approval.com', '${pw}', 'Company Admin');`);
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${empUserId}', '${orgId}', 'emp@approval.com', '${pw}', 'Employee');`);

        // Org Members
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgId}', '${adminUserId}', 'Company Admin');`);
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgId}', '${empUserId}', 'Employee');`);

        // Employee Record
        db.public.none(`INSERT INTO employees (id, org_id, full_name, department, email, user_id, contracted_hours) VALUES ('${empRecordId}', '${orgId}', 'Bob Builder', 'Construction', 'emp@approval.com', '${empUserId}', 76);`);

        companyAdminToken = generateToken({ id: adminUserId, email: 'admin@approval.com', organisation_id: orgId, role: 'Company Admin' });
        employeeToken = generateToken({ id: empUserId, email: 'emp@approval.com', organisation_id: orgId, role: 'Employee' });

        const PgPool = db.adapters.createPg().Pool;
        setPool(new PgPool());
    });

    test('Employee can submit timesheet for active fortnight', async () => {
        const res = await request(app)
            .post('/api/submissions/submit')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({ start_date: startDate });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('Submitted');
    });

    test('Employee Portal returns submission status as Submitted', async () => {
        const res = await request(app)
            .get(`/api/portal/my-timesheet?start_date=${startDate}`)
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.employee.full_name).toBe('Bob Builder');
        expect(res.body.data.submission.status).toBe('Submitted');
    });

    test('Manager lists fortnight submissions across organization', async () => {
        const res = await request(app)
            .get(`/api/submissions?start_date=${startDate}`)
            .set('Authorization', `Bearer ${companyAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.length).toBe(1);
        expect(res.body.data[0].employee_id).toBe(empRecordId);
        expect(res.body.data[0].status).toBe('Submitted');
    });

    test('Manager can move submission to Under Review', async () => {
        const res = await request(app)
            .post('/api/submissions/review')
            .set('Authorization', `Bearer ${companyAdminToken}`)
            .send({ employee_id: empRecordId, start_date: startDate });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('Under Review');
    });

    test('Manager can reject submission with mandatory reason', async () => {
        // Without reason should fail 400
        const badRes = await request(app)
            .post('/api/submissions/reject')
            .set('Authorization', `Bearer ${companyAdminToken}`)
            .send({ employee_id: empRecordId, start_date: startDate, reason: '' });

        expect(badRes.status).toBe(400);

        // With valid reason
        const res = await request(app)
            .post('/api/submissions/reject')
            .set('Authorization', `Bearer ${companyAdminToken}`)
            .send({ employee_id: empRecordId, start_date: startDate, reason: 'Please verify Thursday shift actual hours' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('Rejected');
        expect(res.body.data.rejection_reason).toBe('Please verify Thursday shift actual hours');
    });

    test('Employee portal reflects rejection and reason', async () => {
        const res = await request(app)
            .get(`/api/portal/my-timesheet?start_date=${startDate}`)
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.submission.status).toBe('Rejected');
        expect(res.body.data.submission.rejection_reason).toBe('Please verify Thursday shift actual hours');
    });

    test('Employee can resubmit timesheet after review', async () => {
        const res = await request(app)
            .post('/api/submissions/submit')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({ start_date: startDate });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('Submitted');
    });

    test('Manager can approve timesheet', async () => {
        const res = await request(app)
            .post('/api/submissions/approve')
            .set('Authorization', `Bearer ${companyAdminToken}`)
            .send({ employee_id: empRecordId, start_date: startDate });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('Approved');
    });
});
