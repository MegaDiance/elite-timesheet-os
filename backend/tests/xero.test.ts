import request from 'supertest';
import app from '../src/index';
import { newDb, DataType } from 'pg-mem';
import { setPool } from '../src/services/db';
import { generateToken, hashPassword } from '../src/services/auth';
import { buildXeroAuthUrl, transformPayrollToXeroTimesheets } from '../src/services/xeroService';
import { PayrollReport } from '../src/services/reportService';
import crypto from 'crypto';

describe('Xero Integration Foundation Tests', () => {
    let companyAdminToken: string;
    let employeeToken: string;
    const orgId = '666e4567-e89b-12d3-a456-000000000001';
    const adminUserId = '666e4567-e89b-12d3-a456-000000000002';
    const empUserId = '666e4567-e89b-12d3-a456-000000000003';
    const empRecordId = '666e4567-e89b-12d3-a456-000000000004';
    const startDate = '2026-03-30';

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

        // Seed Org
        db.public.none(`INSERT INTO organisations (id, name) VALUES ('${orgId}', 'Xero Ready Corp');`);

        // Seed Users
        const pw = await hashPassword('password123');
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${adminUserId}', '${orgId}', 'admin@xeroready.com', '${pw}', 'Company Admin');`);
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${empUserId}', '${orgId}', 'emp@xeroready.com', '${pw}', 'Employee');`);

        // Org Members
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgId}', '${adminUserId}', 'Company Admin');`);
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgId}', '${empUserId}', 'Employee');`);

        // Employee Record
        db.public.none(`INSERT INTO employees (id, org_id, full_name, department, email, user_id, contracted_hours) VALUES ('${empRecordId}', '${orgId}', 'David Miller', 'Finance', 'emp@xeroready.com', '${empUserId}', 76);`);

        // Daily shift
        const recId = crypto.randomUUID();
        db.public.none(`INSERT INTO daily_records (id, org_id, employee_id, record_date, has_actuals) VALUES ('${recId}', '${orgId}', '${empRecordId}', '2026-03-31', true);`);
        db.public.none(`INSERT INTO shift_segments (id, record_id, segment_type, roster_in, roster_out, roster_hours, actual_in, actual_out, actual_hours, actual_segment_type) VALUES ('${crypto.randomUUID()}', '${recId}', 'WORK', '09:00', '17:00', 7.5, '09:00', '17:00', 7.5, 'WORK');`);

        companyAdminToken = generateToken({ id: adminUserId, email: 'admin@xeroready.com', organisation_id: orgId, role: 'Company Admin' });
        employeeToken = generateToken({ id: empUserId, email: 'emp@xeroready.com', organisation_id: orgId, role: 'Employee' });

        const pool = {
            query: (text: string, params: any[]) => {
                let p = params || [];
                let sql = text;
                p.forEach((val, idx) => {
                    const ph = new RegExp('\\$' + (idx + 1), 'g');
                    sql = sql.replace(ph, typeof val === 'string' ? `'${val}'` : (val === null ? 'NULL' : val));
                });
                try {
                    const rows = db.public.many(sql);
                    return Promise.resolve({ rows });
                } catch (e: any) {
                    if (e.message?.includes('no result') || e.message?.includes('not found')) {
                        return Promise.resolve({ rows: [] });
                    }
                    try {
                        db.public.none(sql);
                        return Promise.resolve({ rows: [] });
                    } catch (e2: any) {
                        return Promise.reject(e2);
                    }
                }
            }
        };

        setPool(pool as any);
    });

    test('buildXeroAuthUrl generates compliant OAuth 2.0 URL', () => {
        const url = buildXeroAuthUrl(orgId);
        expect(url).toContain('https://login.xero.com/identity/connect/authorize');
        expect(url).toContain('response_type=code');
        expect(url).toContain('accounting.payroll.au');
    });

    test('transformPayrollToXeroTimesheets formats payroll report into Xero earnings lines without multipliers', () => {
        const mockReport: PayrollReport = {
            org_id: orgId,
            org_name: 'Test Org',
            fortnight_start: '2026-03-30',
            fortnight_end: '2026-04-12',
            generated_at: new Date().toISOString(),
            employees: [
                {
                    employee_id: 'emp-101',
                    full_name: 'Sarah Connor',
                    department: 'Operations',
                    contracted_hours: 76,
                    rostered_hours: 76,
                    actual_hours: 80,
                    variance_hours: 4,
                    normal_hours: 68,
                    saturday_hours: 6,
                    sunday_hours: 4,
                    public_holiday_hours: 2,
                    sick_hours: 0,
                    annual_hours: 0,
                    til_hours: 0,
                    unplanned_hours: 0,
                    submission_status: 'Approved'
                }
            ],
            totals: {} as any
        };

        const timesheets = transformPayrollToXeroTimesheets(mockReport);
        expect(timesheets.length).toBe(1);
        expect(timesheets[0].employee_name).toBe('Sarah Connor');
        expect(timesheets[0].status).toBe('APPROVED');
        expect(timesheets[0].lines).toEqual([
            { earnings_rate: 'Ordinary Hours', tracking_category: 'Operations', number_of_units: 68 },
            { earnings_rate: 'Saturday Ordinary Hours', tracking_category: 'Operations', number_of_units: 6 },
            { earnings_rate: 'Sunday Ordinary Hours', tracking_category: 'Operations', number_of_units: 4 },
            { earnings_rate: 'Public Holiday Worked', tracking_category: 'Operations', number_of_units: 2 }
        ]);
        expect(timesheets[0].total_hours).toBe(80);
    });

    test('GET /api/xero/status returns disconnected status initially', async () => {
        const res = await request(app)
            .get('/api/xero/status')
            .set('Authorization', `Bearer ${companyAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.connected).toBe(false);
    });

    test('POST /api/xero/mock-connect establishes connection for tenant', async () => {
        const res = await request(app)
            .post('/api/xero/mock-connect')
            .set('Authorization', `Bearer ${companyAdminToken}`)
            .send({ tenant_name: 'Acme Test Payroll (AU)' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.tenant_name).toBe('Acme Test Payroll (AU)');
    });

    test('GET /api/xero/status returns connected after connection', async () => {
        const res = await request(app)
            .get('/api/xero/status')
            .set('Authorization', `Bearer ${companyAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.connected).toBe(true);
        expect(res.body.data.tenant_name).toBe('Acme Test Payroll (AU)');
    });

    test('GET /api/xero/preview provides timesheets mapped for Xero', async () => {
        const res = await request(app)
            .get(`/api/xero/preview?start_date=${startDate}`)
            .set('Authorization', `Bearer ${companyAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.is_xero_connected).toBe(true);
        expect(res.body.data.timesheet_count).toBe(1);
        expect(res.body.data.timesheets[0].employee_name).toBe('David Miller');
        expect(res.body.data.timesheets[0].lines[0].earnings_rate).toBe('Ordinary Hours');
    });

    test('POST /api/xero/disconnect cleans up tenant credentials', async () => {
        const res = await request(app)
            .post('/api/xero/disconnect')
            .set('Authorization', `Bearer ${companyAdminToken}`);

        expect(res.status).toBe(200);

        const statusRes = await request(app)
            .get('/api/xero/status')
            .set('Authorization', `Bearer ${companyAdminToken}`);
        expect(statusRes.body.data.connected).toBe(false);
    });
});
