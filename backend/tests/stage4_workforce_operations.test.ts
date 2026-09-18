import request from 'supertest';
import app from '../src/index';
import { newDb, DataType } from 'pg-mem';
import { setPool, query } from '../src/services/db';
import { generateToken, hashPassword } from '../src/services/auth';
import crypto from 'crypto';

describe('Stage 4: Workforce Operations, Timesheets, Leave & Reporting', () => {
    let orgAId: string;
    let orgBId: string;
    let managerAToken: string;
    let employeeAToken: string;
    let managerBToken: string;

    let managerAUserId: string;
    let employeeAUserId: string;
    let employeeAEmpId: string;

    let managerBUserId: string;
    let employeeBUserId: string;
    let employeeBEmpId: string;

    const fortnightStart = '2026-03-29'; // Sunday

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

        const adapter = db.adapters.createPg();
        setPool(new adapter.Pool());

        // Setup Org A
        const orgARes = await query("INSERT INTO organisations (name, slug) VALUES ('Acme Corp', 'acme') RETURNING id");
        orgAId = orgARes.rows[0].id;

        // Setup Org B
        const orgBRes = await query("INSERT INTO organisations (name, slug) VALUES ('Beta LLC', 'beta') RETURNING id");
        orgBId = orgBRes.rows[0].id;

        const defaultHash = await hashPassword('SecurePass123!');

        // Manager A
        const mgrARes = await query(
            "INSERT INTO users (org_id, email, password_hash, role) VALUES ($1, 'manager@acme.com', $2, 'Manager') RETURNING id",
            [orgAId, defaultHash]
        );
        managerAUserId = mgrARes.rows[0].id;
        await query("INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'Manager')", [orgAId, managerAUserId]);
        managerAToken = generateToken({ id: managerAUserId, email: 'manager@acme.com', organisation_id: orgAId, role: 'Manager' });

        // Employee A (= Formula injection payload test for CSV)
        const empAUserRes = await query(
            "INSERT INTO users (org_id, email, password_hash, role) VALUES ($1, 'alice@acme.com', $2, 'Employee') RETURNING id",
            [orgAId, defaultHash]
        );
        employeeAUserId = empAUserRes.rows[0].id;
        await query("INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'Employee')", [orgAId, employeeAUserId]);
        const empARes = await query(
            "INSERT INTO employees (org_id, full_name, department, email, user_id, contracted_hours) VALUES ($1, '=cmd|'' /C calc''!A0', '+Engineering', 'alice@acme.com', $2, 76) RETURNING id",
            [orgAId, employeeAUserId]
        );
        employeeAEmpId = empARes.rows[0].id;
        employeeAToken = generateToken({ id: employeeAUserId, email: 'alice@acme.com', organisation_id: orgAId, role: 'Employee' });

        // Manager B
        const mgrBRes = await query(
            "INSERT INTO users (org_id, email, password_hash, role) VALUES ($1, 'manager@beta.com', $2, 'Manager') RETURNING id",
            [orgBId, defaultHash]
        );
        managerBUserId = mgrBRes.rows[0].id;
        await query("INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'Manager')", [orgBId, managerBUserId]);
        managerBToken = generateToken({ id: managerBUserId, email: 'manager@beta.com', organisation_id: orgBId, role: 'Manager' });

        // Employee B
        const empBUserRes = await query(
            "INSERT INTO users (org_id, email, password_hash, role) VALUES ($1, 'bob@beta.com', $2, 'Employee') RETURNING id",
            [orgBId, defaultHash]
        );
        employeeBUserId = empBUserRes.rows[0].id;
        await query("INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ($1, $2, 'Employee')", [orgBId, employeeBUserId]);
        const empBRes = await query(
            "INSERT INTO employees (org_id, full_name, department, email, user_id, contracted_hours) VALUES ($1, 'Bob Builder', 'Logistics', 'bob@beta.com', $2, 76) RETURNING id",
            [orgBId, employeeBUserId]
        );
        employeeBEmpId = empBRes.rows[0].id;

        // Initialize unlocked fortnight lock for Org A
        await query(
            "INSERT INTO fortnight_locks (org_id, start_date, timesheet_locked, roster_locked, is_published) VALUES ($1, $2, false, false, true)",
            [orgAId, fortnightStart]
        );

        // Populate a completed shift record for Employee A on 2026-03-30
        const recRes = await query(
            "INSERT INTO daily_records (org_id, employee_id, record_date, has_actuals) VALUES ($1, $2, '2026-03-30', true) RETURNING id",
            [orgAId, employeeAEmpId]
        );
        await query(
            "INSERT INTO shift_segments (record_id, segment_type, roster_in, roster_out, roster_hours, actual_in, actual_out, actual_hours) VALUES ($1, 'WORK', '09:00', '17:00', 7.5, '09:00', '17:30', 8.0)",
            [recRes.rows[0].id]
        );
    });

    describe('1. Timesheet Submission & Segment Completeness', () => {
        it('rejects submission if shift segment has partial actual time (e.g. actual_in without actual_out)', async () => {
            // Add incomplete shift segment
            const recRes = await query(
                "INSERT INTO daily_records (org_id, employee_id, record_date, has_actuals) VALUES ($1, $2, '2026-03-31', true) RETURNING id",
                [orgAId, employeeAEmpId]
            );
            const segRes = await query(
                "INSERT INTO shift_segments (record_id, segment_type, actual_in, actual_out) VALUES ($1, 'WORK', '09:00', NULL) RETURNING id",
                [recRes.rows[0].id]
            );

            try {
                const res = await request(app)
                    .post('/api/submissions/submit')
                    .set('Authorization', `Bearer ${employeeAToken}`)
                    .send({ start_date: fortnightStart });

                expect(res.status).toBe(400);
                expect(res.body.error.message).toMatch(/incomplete shift segment/i);
            } finally {
                // Clean up the incomplete segment for subsequent tests
                await query("DELETE FROM shift_segments WHERE id = $1", [segRes.rows[0].id]);
                await query("DELETE FROM daily_records WHERE id = $1", [recRes.rows[0].id]);
            }
        });

        it('rejects submission if the fortnight is timesheet locked', async () => {
            // Lock fortnight for Org A
            await query(
                "UPDATE fortnight_locks SET timesheet_locked = true WHERE org_id = $1 AND start_date = $2",
                [orgAId, fortnightStart]
            );

            try {
                const res = await request(app)
                    .post('/api/submissions/submit')
                    .set('Authorization', `Bearer ${employeeAToken}`)
                    .send({ start_date: fortnightStart });

                expect(res.status).toBe(403);
                expect(res.body.error.message).toMatch(/locked/i);
            } finally {
                // Unlock fortnight for normal operations
                await query(
                    "UPDATE fortnight_locks SET timesheet_locked = false WHERE org_id = $1 AND start_date = $2",
                    [orgAId, fortnightStart]
                );
            }
        });

        it('successfully submits timesheet with valid segments and transitions to Submitted', async () => {
            const res = await request(app)
                .post('/api/submissions/submit')
                .set('Authorization', `Bearer ${employeeAToken}`)
                .send({ start_date: fortnightStart });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('Submitted');

            const subCheck = await query(
                "SELECT status, submitted_at FROM timesheet_submissions WHERE org_id = $1 AND employee_id = $2 AND start_date = $3",
                [orgAId, employeeAEmpId, fortnightStart]
            );
            expect(subCheck.rows.length).toBe(1);
            expect(subCheck.rows[0].status).toBe('Submitted');
            expect(subCheck.rows[0].submitted_at).toBeDefined();
        });
    });

    describe('2. Manager Review, Approval & Rejection with Mandatory Reason', () => {
        let submissionId: string;

        beforeAll(async () => {
            const subRes = await query(
                "SELECT id FROM timesheet_submissions WHERE org_id = $1 AND employee_id = $2 AND start_date = $3",
                [orgAId, employeeAEmpId, fortnightStart]
            );
            expect(subRes.rows.length).toBe(1);
            submissionId = subRes.rows[0].id;
        });

        it('rejects rejection request without mandatory reason', async () => {
            const res = await request(app)
                .post('/api/submissions/reject')
                .set('Authorization', `Bearer ${managerAToken}`)
                .send({
                    submission_id: submissionId,
                    employee_id: employeeAEmpId,
                    start_date: fortnightStart,
                    rejection_reason: '   '
                });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/rejection reason is required/i);
        });

        it('successfully rejects timesheet with valid reason and records feedback', async () => {
            const res = await request(app)
                .post('/api/submissions/reject')
                .set('Authorization', `Bearer ${managerAToken}`)
                .send({
                    submission_id: submissionId,
                    employee_id: employeeAEmpId,
                    start_date: fortnightStart,
                    rejection_reason: 'Please clarify the extra 30 minutes on Monday.'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const subCheck = await query("SELECT status, rejection_reason FROM timesheet_submissions WHERE id = $1", [submissionId]);
            expect(subCheck.rows[0].status).toBe('Rejected');
            expect(subCheck.rows[0].rejection_reason).toBe('Please clarify the extra 30 minutes on Monday.');
        });

        it('employee can view rejection feedback and resubmit', async () => {
            // Employee checks portal
            const portalRes = await request(app)
                .get(`/api/portal/my-timesheet?start_date=${fortnightStart}`)
                .set('Authorization', `Bearer ${employeeAToken}`);

            expect(portalRes.status).toBe(200);
            expect(portalRes.body.data.submission.status).toBe('Rejected');
            expect(portalRes.body.data.submission.rejection_reason).toBe('Please clarify the extra 30 minutes on Monday.');

            // Employee resubmits
            const resubmitRes = await request(app)
                .post('/api/submissions/submit')
                .set('Authorization', `Bearer ${employeeAToken}`)
                .send({ start_date: fortnightStart });

            expect(resubmitRes.status).toBe(200);
            expect(resubmitRes.body.data.status).toBe('Submitted');
        });

        it('manager approves the resubmitted timesheet', async () => {
            const res = await request(app)
                .post('/api/submissions/approve')
                .set('Authorization', `Bearer ${managerAToken}`)
                .send({
                    submission_id: submissionId,
                    employee_id: employeeAEmpId,
                    start_date: fortnightStart
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const subCheck = await query("SELECT status, reviewed_by FROM timesheet_submissions WHERE id = $1", [submissionId]);
            expect(subCheck.rows[0].status).toBe('Approved');
            expect(subCheck.rows[0].reviewed_by).toBe(managerAUserId);
        });

        it('blocks modifying daily records for an approved timesheet period', async () => {
            const res = await request(app)
                .post('/api/records')
                .set('Authorization', `Bearer ${managerAToken}`)
                .send({
                    employee_id: employeeAEmpId,
                    record_date: '2026-03-30',
                    segments: [
                        { segment_type: 'WORK', roster_in: '09:00', roster_out: '17:00' }
                    ]
                });

            expect(res.status).toBe(403);
            expect(res.body.error.message).toMatch(/approved.*timesheet|approved shifts/i);
        });
    });

    describe('3. Bulk Timesheet Approval & Tenant Isolation', () => {
        let subAId: string;
        let subBId: string;

        beforeAll(async () => {
            // Reset Org A submission to Submitted
            await query("UPDATE timesheet_submissions SET status = 'Submitted' WHERE employee_id = $1 AND start_date = $2", [employeeAEmpId, fortnightStart]);
            const subARes = await query("SELECT id FROM timesheet_submissions WHERE employee_id = $1 AND start_date = $2", [employeeAEmpId, fortnightStart]);
            subAId = subARes.rows[0].id;

            // Create Org B submission in Submitted status
            const subBRes = await query(
                "INSERT INTO timesheet_submissions (org_id, employee_id, start_date, status, submitted_at) VALUES ($1, $2, $3, 'Submitted', NOW()) RETURNING id",
                [orgBId, employeeBEmpId, fortnightStart]
            );
            subBId = subBRes.rows[0].id;
        });

        it('manager A bulk-approves Org A timesheet and cannot approve Org B timesheet (cross-tenant protection)', async () => {
            const res = await request(app)
                .post('/api/submissions/bulk-approve')
                .set('Authorization', `Bearer ${managerAToken}`)
                .send({
                    start_date: fortnightStart,
                    submission_ids: [subAId, subBId] // Attempting to include Org B's submission
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            // Only 1 timesheet should be approved (Org A's)
            expect(res.body.data.approved_count).toBe(1);

            // Verify Org A is Approved
            const aCheck = await query("SELECT status FROM timesheet_submissions WHERE id = $1", [subAId]);
            expect(aCheck.rows[0].status).toBe('Approved');

            // Verify Org B is STILL Submitted (unaffected)
            const bCheck = await query("SELECT status FROM timesheet_submissions WHERE id = $1", [subBId]);
            expect(bCheck.rows[0].status).toBe('Submitted');
        });
    });

    describe('4. Leave Request Validation & Review Integrity', () => {
        let leaveId: string;

        it('rejects leave request where end_date is before start_date', async () => {
            const res = await request(app)
                .post('/api/portal/leave-requests')
                .set('Authorization', `Bearer ${employeeAToken}`)
                .send({
                    leave_type: 'Annual',
                    start_date: '2026-04-10',
                    end_date: '2026-04-05',
                    hours: 7.6
                });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/end date cannot be (before|earlier than) start date/i);
        });

        it('rejects leave request with invalid hours (<= 0 or > 336)', async () => {
            const res = await request(app)
                .post('/api/portal/leave-requests')
                .set('Authorization', `Bearer ${employeeAToken}`)
                .send({
                    leave_type: 'Sick',
                    start_date: '2026-04-10',
                    end_date: '2026-04-10',
                    hours: 0
                });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/greater than 0/i);
        });

        it('successfully submits valid leave request', async () => {
            const res = await request(app)
                .post('/api/portal/leave-requests')
                .set('Authorization', `Bearer ${employeeAToken}`)
                .send({
                    leave_type: 'Annual',
                    start_date: '2026-04-10',
                    end_date: '2026-04-12',
                    hours: 22.8,
                    reason: 'Family vacation'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            leaveId = res.body.data.id;
        });

        it('rejects duplicate pending leave request for the exact same date', async () => {
            const res = await request(app)
                .post('/api/portal/leave-requests')
                .set('Authorization', `Bearer ${employeeAToken}`)
                .send({
                    leave_type: 'Annual',
                    start_date: '2026-04-10',
                    end_date: '2026-04-12',
                    hours: 22.8
                });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('DUPLICATE_REQUEST');
        });

        it('requires non-empty rejection reason when declining leave request', async () => {
            const res = await request(app)
                .post(`/api/organisation/leave-requests/${leaveId}/review`)
                .set('Authorization', `Bearer ${managerAToken}`)
                .send({
                    status: 'Rejected',
                    rejection_reason: '  '
                });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toMatch(/rejection reason is required/i);
        });

        it('manager declines leave request with valid reason', async () => {
            const res = await request(app)
                .post(`/api/organisation/leave-requests/${leaveId}/review`)
                .set('Authorization', `Bearer ${managerAToken}`)
                .send({
                    status: 'Rejected',
                    rejection_reason: 'Insufficient team coverage during Easter.'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const leaveCheck = await query("SELECT status, rejection_reason FROM leave_requests WHERE id = $1", [leaveId]);
            expect(leaveCheck.rows[0].status).toBe('Rejected');
            expect(leaveCheck.rows[0].rejection_reason).toBe('Insufficient team coverage during Easter.');
        });

        it('blocks re-reviewing an already reviewed leave request', async () => {
            const res = await request(app)
                .post(`/api/organisation/leave-requests/${leaveId}/review`)
                .set('Authorization', `Bearer ${managerAToken}`)
                .send({
                    status: 'Approved'
                });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('ALREADY_REVIEWED');
        });
    });

    describe('5. Reports & Safe CSV Export (Formula Injection Neutralization)', () => {
        it('generates payroll summary JSON with live calculated hours', async () => {
            const res = await request(app)
                .get(`/api/reports/payroll?start_date=${fortnightStart}`)
                .set('Authorization', `Bearer ${managerAToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.org_name).toBe('Acme Corp');
            expect(res.body.data.employees.length).toBeGreaterThan(0);
            expect(res.body.data.totals.total_actual).toBeGreaterThan(0);
        });

        it('neutralizes CSV formula injection characters (=, +, -, @) with prepended single quote', async () => {
            const res = await request(app)
                .get(`/api/reports/export/csv?start_date=${fortnightStart}`)
                .set('Authorization', `Bearer ${managerAToken}`);

            expect(res.status).toBe(200);
            expect(res.header['content-type']).toMatch(/text\/csv/);

            const csvText = res.text;
            // Employee name was '=cmd|'' /C calc''!A0' -> should be escaped to "'=cmd..."
            expect(csvText).toContain("\"'=cmd");
            // Department was '+Engineering' -> should be escaped to "'+Engineering"
            expect(csvText).toContain("\"'+Engineering\"");
        });

        it('prevents Manager A from accessing Org B payroll report', async () => {
            // Manager A queries Org A report
            const resA = await request(app)
                .get(`/api/reports/payroll?start_date=${fortnightStart}`)
                .set('Authorization', `Bearer ${managerAToken}`);

            expect(resA.body.data.org_name).toBe('Acme Corp');

            // Org B data should not be present
            const empNames = resA.body.data.employees.map((e: any) => e.full_name);
            expect(empNames).not.toContain('Bob Builder');
        });
    });
});
