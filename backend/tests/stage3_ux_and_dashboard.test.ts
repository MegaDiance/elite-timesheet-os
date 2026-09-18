import request from 'supertest';
import app from '../src/index';
import { newDb, DataType } from 'pg-mem';
import { setPool, query } from '../src/services/db';
import { generateToken, hashPassword } from '../src/services/auth';
import crypto from 'crypto';

describe('Stage 3: Dashboard API, Tenant Isolation & Submissions Hardening', () => {
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

    const todayIso = '2026-03-30'; // Monday
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
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(org_id, holiday_date)
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
        `);

        // Setup Org A
        orgAId = crypto.randomUUID();
        db.public.none(`INSERT INTO organisations (id, name, slug) VALUES ('${orgAId}', 'Acme Logistics', 'acme');`);
        
        managerAUserId = crypto.randomUUID();
        employeeAUserId = crypto.randomUUID();
        employeeAEmpId = crypto.randomUUID();
        
        const pw = await hashPassword('password123');
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${managerAUserId}', '${orgAId}', 'manager@acme.com', '${pw}', 'Manager');`);
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${employeeAUserId}', '${orgAId}', 'emp@acme.com', '${pw}', 'Employee');`);
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgAId}', '${managerAUserId}', 'Manager');`);
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgAId}', '${employeeAUserId}', 'Employee');`);
        db.public.none(`INSERT INTO employees (id, org_id, full_name, department, email, phone, user_id, contracted_hours) VALUES ('${employeeAEmpId}', '${orgAId}', 'Alice Smith', 'Operations', 'emp@acme.com', '0412345678', '${employeeAUserId}', 76);`);

        // Setup Org B (Separate Tenant)
        orgBId = crypto.randomUUID();
        db.public.none(`INSERT INTO organisations (id, name, slug) VALUES ('${orgBId}', 'Beta Industries', 'beta');`);
        
        managerBUserId = crypto.randomUUID();
        employeeBUserId = crypto.randomUUID();
        employeeBEmpId = crypto.randomUUID();
        
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${managerBUserId}', '${orgBId}', 'manager@beta.com', '${pw}', 'Manager');`);
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${employeeBUserId}', '${orgBId}', 'emp@beta.com', '${pw}', 'Employee');`);
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgBId}', '${managerBUserId}', 'Manager');`);
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgBId}', '${employeeBUserId}', 'Employee');`);
        db.public.none(`INSERT INTO employees (id, org_id, full_name, department, email, phone, user_id, contracted_hours) VALUES ('${employeeBEmpId}', '${orgBId}', 'Bob Jones', 'Warehouse', 'emp@beta.com', '0487654321', '${employeeBUserId}', 80);`);

        // Published Fortnight Lock for Org A
        db.public.none(`INSERT INTO fortnight_locks (id, org_id, start_date, roster_locked, timesheet_locked, is_published) VALUES ('${crypto.randomUUID()}', '${orgAId}', '${fortnightStart}', true, false, true);`);

        // Scheduled shift for Alice in Org A on todayIso
        const drId = crypto.randomUUID();
        db.public.none(`INSERT INTO daily_records (id, org_id, employee_id, record_date, has_actuals) VALUES ('${drId}', '${orgAId}', '${employeeAEmpId}', '${todayIso}', false);`);
        db.public.none(`INSERT INTO shift_segments (id, record_id, segment_type, roster_in, roster_out, roster_hours) VALUES ('${crypto.randomUUID()}', '${drId}', 'WORK', '09:00', '17:00', 7.5);`);

        // Pending Leave Request in Org A
        db.public.none(`INSERT INTO leave_requests (id, org_id, employee_id, leave_type, start_date, end_date, hours, status, reason) VALUES ('${crypto.randomUUID()}', '${orgAId}', '${employeeAEmpId}', 'Annual', '2026-04-10', '2026-04-12', 24, 'Pending', 'Vacation');`);

        // Tokens
        managerAToken = generateToken({ id: managerAUserId, email: 'manager@acme.com', organisation_id: orgAId, role: 'Manager' });
        employeeAToken = generateToken({ id: employeeAUserId, email: 'emp@acme.com', organisation_id: orgAId, role: 'Employee' });
        managerBToken = generateToken({ id: managerBUserId, email: 'manager@beta.com', organisation_id: orgBId, role: 'Manager' });

        const PgPool = db.adapters.createPg().Pool;
        setPool(new PgPool());
    });

    describe('1. Command Centre API (GET /api/dashboard/today)', () => {
        it('should return manager overview with scheduled employees, floor count, pending submissions & leave', async () => {
            const res = await request(app)
                .get(`/api/dashboard/today?date=${todayIso}`)
                .set('Authorization', `Bearer ${managerAToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.role).toBe('Manager');
            expect(res.body.metrics).toBeDefined();
            expect(res.body.metrics.total_staff).toBe(1);
            expect(res.body.metrics.scheduled_today).toBe(1);
            expect(res.body.metrics.pending_leave).toBe(1);
            expect(res.body.scheduled_today.length).toBe(1);
            expect(res.body.scheduled_today[0].full_name).toBe('Alice Smith');
            expect(res.body.scheduled_today[0].phone).toBe('0412345678');
            expect(res.body.lock_status.roster_locked).toBe(true);
        });

        it('should return employee overview with personal shift and privacy-preserving team view', async () => {
            const res = await request(app)
                .get(`/api/dashboard/today?date=${todayIso}`)
                .set('Authorization', `Bearer ${employeeAToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.role).toBe('Employee');
            expect(res.body.employee.full_name).toBe('Alice Smith');
            expect(res.body.my_shifts.length).toBe(1);
            expect(res.body.my_shifts[0].roster_in).toBe('09:00');
            expect(res.body.my_shifts[0].roster_out).toBe('17:00');
            expect(res.body.my_leave.length).toBe(1);
            expect(res.body.timesheet_status.status).toBe('Draft');
        });
    });

    describe('2. Cross-Tenant IDOR Prevention & Hardening', () => {
        it('should block manager from accessing stats of an employee from a different organisation (GET /api/records/stats)', async () => {
            // Manager A tries to query stats for employee B in Org B
            const res = await request(app)
                .get(`/api/records/stats?employee_id=${employeeBEmpId}&start_date=${fortnightStart}`)
                .set('Authorization', `Bearer ${managerAToken}`);

            expect(res.status).toBe(404);
            expect(res.body.error.message).toContain('Employee not found in your organisation');
        });

        it('should block manager from creating a timesheet approval for an employee in another organisation', async () => {
            // Manager A tries to approve timesheet for employee B in Org B
            const res = await request(app)
                .post('/api/submissions/approve')
                .set('Authorization', `Bearer ${managerAToken}`)
                .send({ employee_id: employeeBEmpId, start_date: fortnightStart });

            expect(res.status).toBe(404);
            expect(res.body.error.message).toContain('Employee not found in your organisation');
        });

        it('should block manager from creating a timesheet rejection for an employee in another organisation', async () => {
            // Manager A tries to reject timesheet for employee B in Org B
            const res = await request(app)
                .post('/api/submissions/reject')
                .set('Authorization', `Bearer ${managerAToken}`)
                .send({ employee_id: employeeBEmpId, start_date: fortnightStart, reason: 'Invalid hours' });

            expect(res.status).toBe(404);
            expect(res.body.error.message).toContain('Employee not found in your organisation');
        });

        it('should block manager from modifying an employee of another organisation (PUT /api/employees/:id)', async () => {
            // Manager A attempts to update employee B in Org B
            const res = await request(app)
                .put(`/api/employees/${employeeBEmpId}`)
                .set('Authorization', `Bearer ${managerAToken}`)
                .send({ full_name: 'Hacked Name', contracted_hours: 100 });

            expect(res.status).toBe(404);
            expect(res.body.error.message).toContain('Employee not found');
        });
    });
});
