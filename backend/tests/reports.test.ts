import request from 'supertest';
import app from '../src/index';
import { newDb, DataType } from 'pg-mem';
import { setPool } from '../src/services/db';
import { generateToken, hashPassword } from '../src/services/auth';
import { convertReportToCsv, PayrollReport } from '../src/services/reportService';
import crypto from 'crypto';

describe('Payroll Reporting & Export Integration Tests', () => {
    let companyAdminToken: string;
    let employeeToken: string;
    const orgId = '888e4567-e89b-12d3-a456-000000000001';
    const adminUserId = '888e4567-e89b-12d3-a456-000000000002';
    const empUserId = '888e4567-e89b-12d3-a456-000000000003';
    const empRecordId = '888e4567-e89b-12d3-a456-000000000004';
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
        `);

        // Seed Org
        db.public.none(`INSERT INTO organisations (id, name) VALUES ('${orgId}', 'Acme Payroll Corp');`);

        // Seed Users
        const pw = await hashPassword('password123');
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${adminUserId}', '${orgId}', 'admin@acmepayroll.com', '${pw}', 'Company Admin');`);
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${empUserId}', '${orgId}', 'emp@acmepayroll.com', '${pw}', 'Employee');`);

        // Org Members
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgId}', '${adminUserId}', 'Company Admin');`);
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgId}', '${empUserId}', 'Employee');`);

        // Employee Record
        db.public.none(`INSERT INTO employees (id, org_id, full_name, department, email, user_id, contracted_hours) VALUES ('${empRecordId}', '${orgId}', 'Alice Springs', 'Logistics', 'emp@acmepayroll.com', '${empUserId}', 76);`);

        // Public holiday
        db.public.none(`INSERT INTO public_holidays (id, org_id, holiday_date, name) VALUES ('${crypto.randomUUID()}', '${orgId}', '2026-04-06', 'Easter Monday');`);

        // Seed a shift
        const recId = crypto.randomUUID();
        db.public.none(`INSERT INTO daily_records (id, org_id, employee_id, record_date, has_actuals) VALUES ('${recId}', '${orgId}', '${empRecordId}', '2026-03-31', true);`);
        db.public.none(`INSERT INTO shift_segments (id, record_id, segment_type, roster_in, roster_out, roster_hours, actual_in, actual_out, actual_hours, actual_segment_type) VALUES ('${crypto.randomUUID()}', '${recId}', 'WORK', '09:00', '17:00', 7.5, '09:00', '17:00', 7.5, 'WORK');`);

        companyAdminToken = generateToken({ id: adminUserId, email: 'admin@acmepayroll.com', organisation_id: orgId, role: 'Company Admin' });
        employeeToken = generateToken({ id: empUserId, email: 'emp@acmepayroll.com', organisation_id: orgId, role: 'Employee' });

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

    test('convertReportToCsv formats valid CSV with headers and totals', () => {
        const mockReport: PayrollReport = {
            org_id: orgId,
            org_name: 'Test Org',
            fortnight_start: '2026-03-30',
            fortnight_end: '2026-04-12',
            generated_at: new Date().toISOString(),
            employees: [
                {
                    employee_id: 'emp-1',
                    full_name: 'Jane Doe',
                    department: 'Engineering',
                    contracted_hours: 76,
                    rostered_hours: 76,
                    actual_hours: 80,
                    variance_hours: 4,
                    normal_hours: 72,
                    saturday_hours: 8,
                    sunday_hours: 0,
                    public_holiday_hours: 0,
                    sick_hours: 0,
                    annual_hours: 0,
                    til_hours: 0,
                    unplanned_hours: 0,
                    submission_status: 'Approved'
                }
            ],
            totals: {
                total_contracted: 76,
                total_rostered: 76,
                total_actual: 80,
                total_variance: 4,
                total_normal: 72,
                total_saturday: 8,
                total_sunday: 0,
                total_public_holiday: 0,
                total_sick: 0,
                total_annual: 0,
                total_til: 0,
                total_unplanned: 0
            }
        };

        const csv = convertReportToCsv(mockReport);
        expect(csv).toContain('Employee Name,Department,Contracted (h)');
        expect(csv).toContain('"Jane Doe","Engineering",76.00,76.00,80.00,4.00,72.00,8.00');
        expect(csv).toContain('"TOTALS"');
    });

    test('GET /api/reports/payroll requires manager role and returns structured report data', async () => {
        // Employee should get 403
        const forbiddenRes = await request(app)
            .get(`/api/reports/payroll?start_date=${startDate}`)
            .set('Authorization', `Bearer ${employeeToken}`);
        expect(forbiddenRes.status).toBe(403);

        // Manager should get 200 with report
        const res = await request(app)
            .get(`/api/reports/payroll?start_date=${startDate}`)
            .set('Authorization', `Bearer ${companyAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.org_name).toBe('Acme Payroll Corp');
        expect(res.body.data.employees.length).toBe(1);
        expect(res.body.data.employees[0].full_name).toBe('Alice Springs');
        expect(res.body.data.employees[0].normal_hours).toBe(7.5);
    });

    test('GET /api/reports/export/csv streams CSV download attachment', async () => {
        const res = await request(app)
            .get(`/api/reports/export/csv?start_date=${startDate}`)
            .set('Authorization', `Bearer ${companyAdminToken}`);

        if (res.status !== 200) {
            console.error('[REPORTS CSV FAILED]', res.status, res.body, res.text);
        }
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-disposition']).toContain('attachment; filename=');
        expect(res.text).toContain('Alice Springs');
        expect(res.text).toContain('Logistics');
    });

    test('GET /api/reports/export/pdf returns printable HTML document', async () => {
        const res = await request(app)
            .get(`/api/reports/export/pdf?start_date=${startDate}`)
            .set('Authorization', `Bearer ${companyAdminToken}`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.text).toContain('<!DOCTYPE html>');
        expect(res.text).toContain('Acme Payroll Corp');
        expect(res.text).toContain('Alice Springs');
        expect(res.text).toContain('window.print()');
    });
});
