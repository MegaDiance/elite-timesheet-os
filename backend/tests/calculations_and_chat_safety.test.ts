import request from 'supertest';
import app from '../src/index';
import crypto from 'crypto';
import { newDb, DataType } from 'pg-mem';
import { setPool, query } from '../src/services/db';
import { generateToken, hashPassword } from '../src/services/auth';
import { calcHours, parseSmartTime } from '../src/services/timeParser';
import { classifyShiftHours, getWeekdayName, addDaysToIso, timeToMinutes } from '../src/services/classificationService';

describe('Calculations Accuracy, Team Chat & Multi-Tenant Safety Integration Tests', () => {
    const orgAId = '11111111-1111-1111-1111-111111111111';
    const orgBId = '22222222-2222-2222-2222-222222222222';
    const empAUserId = '33333333-3333-3333-3333-333333333333';
    const empBUserId = '44444444-4444-4444-4444-444444444444';
    const mgrAUserId = '55555555-5555-5555-5555-555555555555';

    let empAToken: string;
    let empBToken: string;
    let mgrAToken: string;

    beforeAll(async () => {
        const db = newDb();
        db.public.registerFunction({
            name: 'gen_random_uuid',
            args: [],
            returns: DataType.uuid,
            implementation: () => crypto.randomUUID(),
        });

        db.public.none(`
            CREATE TABLE organisations (
                id UUID PRIMARY KEY,
                name TEXT NOT NULL,
                slug TEXT UNIQUE,
                break_mins_weekday NUMERIC DEFAULT 30,
                break_mins_weekend NUMERIC DEFAULT 0,
                break_threshold_hours NUMERIC DEFAULT 6,
                roster_lock_password_hash TEXT,
                timesheet_lock_password_hash TEXT,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE users (
                id UUID PRIMARY KEY,
                org_id UUID,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                role TEXT DEFAULT 'Employee',
                two_factor_enabled BOOLEAN DEFAULT false,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE organisation_members (
                id UUID PRIMARY KEY,
                organisation_id UUID NOT NULL,
                user_id UUID NOT NULL,
                role TEXT NOT NULL,
                UNIQUE(organisation_id, user_id)
            );

            CREATE TABLE employees (
                id UUID PRIMARY KEY,
                org_id UUID NOT NULL,
                user_id UUID,
                full_name TEXT NOT NULL,
                department TEXT,
                email TEXT,
                is_active BOOLEAN DEFAULT true,
                deleted_at TIMESTAMPTZ
            );

            CREATE TABLE organisation_announcements (
                id UUID PRIMARY KEY,
                org_id UUID NOT NULL,
                author_id UUID,
                author_name TEXT NOT NULL,
                author_role TEXT,
                title TEXT,
                content TEXT NOT NULL,
                is_system BOOLEAN DEFAULT false,
                announcement_type TEXT DEFAULT 'general',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE fortnight_locks (
                id UUID PRIMARY KEY,
                org_id UUID NOT NULL,
                start_date TEXT NOT NULL,
                roster_locked BOOLEAN DEFAULT false,
                timesheet_locked BOOLEAN DEFAULT false,
                is_published BOOLEAN DEFAULT false,
                published_at TIMESTAMPTZ,
                published_by UUID,
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(org_id, start_date)
            );

            CREATE TABLE timesheet_submissions (
                id UUID PRIMARY KEY,
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

            CREATE TABLE public_holidays (
                id UUID PRIMARY KEY,
                org_id UUID NOT NULL,
                holiday_date TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(org_id, holiday_date)
            );

            CREATE TABLE audit_logs (
                id UUID PRIMARY KEY,
                org_id UUID NOT NULL,
                actor_id UUID,
                action TEXT NOT NULL,
                entity_type TEXT,
                entity_id UUID,
                details TEXT,
                timestamp TIMESTAMPTZ DEFAULT NOW(),
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // Seed Org A & Org B
        db.public.none(`
            INSERT INTO organisations (id, name, slug) VALUES ('${orgAId}', 'Alpha Corp', 'alpha-corp');
            INSERT INTO organisations (id, name, slug) VALUES ('${orgBId}', 'Beta Industries', 'beta-ind');

            INSERT INTO users (id, org_id, email, role) VALUES ('${empAUserId}', '${orgAId}', 'dennis@alpha.com', 'Employee');
            INSERT INTO users (id, org_id, email, role) VALUES ('${empBUserId}', '${orgBId}', 'sarah@beta.com', 'Employee');
            INSERT INTO users (id, org_id, email, role) VALUES ('${mgrAUserId}', '${orgAId}', 'manager@alpha.com', 'Manager');

            INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgAId}', '${empAUserId}', 'Employee');
            INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgBId}', '${empBUserId}', 'Employee');
            INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('${crypto.randomUUID()}', '${orgAId}', '${mgrAUserId}', 'Manager');

            INSERT INTO employees (id, org_id, user_id, full_name, department, email)
            VALUES ('123e4567-e89b-12d3-a456-000000000001', '${orgAId}', '${empAUserId}', 'Dennis Chen', 'Education', 'dennis@alpha.com');

            INSERT INTO employees (id, org_id, user_id, full_name, department, email)
            VALUES ('123e4567-e89b-12d3-a456-000000000002', '${orgBId}', '${empBUserId}', 'Sarah Connor', 'Operations', 'sarah@beta.com');

            INSERT INTO public_holidays (id, org_id, holiday_date, name)
            VALUES ('${crypto.randomUUID()}', '${orgAId}', '2026-04-25', 'ANZAC Day');
        `);

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
                    return Promise.resolve({ rows, rowCount: rows.length });
                } catch (e: any) {
                    if (e.message?.includes('no result') || e.message?.includes('not found')) {
                        return Promise.resolve({ rows: [], rowCount: 0 });
                    }
                    try {
                        db.public.none(sql);
                        return Promise.resolve({ rows: [], rowCount: 1 });
                    } catch (e2: any) {
                        return Promise.reject(e2);
                    }
                }
            }
        };

        setPool(pool as any);

        empAToken = generateToken({ id: empAUserId, email: 'dennis@alpha.com', organisation_id: orgAId, role: 'Employee' });
        empBToken = generateToken({ id: empBUserId, email: 'sarah@beta.com', organisation_id: orgBId, role: 'Employee' });
        mgrAToken = generateToken({ id: mgrAUserId, email: 'manager@alpha.com', organisation_id: orgAId, role: 'Manager' });
    });

    describe('Team Chat Employee Enablement & Safety', () => {
        let empAMsgId: string;

        it('allows employee to post to Team Chat with verified full name', async () => {
            const res = await request(app)
                .post('/api/announcements')
                .set('Authorization', `Bearer ${empAToken}`)
                .send({
                    content: 'Can someone swap shift with me on Friday?'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.author_name).toBe('Dennis Chen');
            expect(res.body.data.author_role).toBe('Employee');
            expect(res.body.data.content).toBe('Can someone swap shift with me on Friday?');
            empAMsgId = res.body.data.id;
        });

        it('allows employee to delete their own message', async () => {
            const postRes = await request(app)
                .post('/api/announcements')
                .set('Authorization', `Bearer ${empAToken}`)
                .send({ content: 'Message to delete' });

            const msgId = postRes.body.data.id;

            const delRes = await request(app)
                .delete(`/api/announcements/${msgId}`)
                .set('Authorization', `Bearer ${empAToken}`);

            expect(delRes.status).toBe(200);
            expect(delRes.body.success).toBe(true);
        });

        it('prevents an employee from deleting another members message in same org', async () => {
            const mgrPost = await request(app)
                .post('/api/announcements')
                .set('Authorization', `Bearer ${mgrAToken}`)
                .send({ content: 'Official roster published' });

            const mgrMsgId = mgrPost.body.data.id;

            const delRes = await request(app)
                .delete(`/api/announcements/${mgrMsgId}`)
                .set('Authorization', `Bearer ${empAToken}`);

            expect(delRes.status).toBe(403);
            expect(delRes.body.success).toBe(false);
        });

        it('enforces strict cross-tenant isolation in Team Chat', async () => {
            const orgBPost = await request(app)
                .post('/api/announcements')
                .set('Authorization', `Bearer ${empBToken}`)
                .send({ content: 'Org B private memo' });

            const orgBMsgId = orgBPost.body.data.id;

            const orgAFeed = await request(app)
                .get('/api/announcements')
                .set('Authorization', `Bearer ${empAToken}`);

            expect(orgAFeed.status).toBe(200);
            const foundInA = orgAFeed.body.data.find((m: any) => m.id === orgBMsgId);
            expect(foundInA).toBeUndefined();

            const delAcrossOrg = await request(app)
                .delete(`/api/announcements/${orgBMsgId}`)
                .set('Authorization', `Bearer ${empAToken}`);

            expect(delAcrossOrg.status).toBe(404);
        });
    });

    describe('Hours and Time Calculations Mathematical Precision', () => {
        it('calculates standard day hours with 0.5h unpaid break', () => {
            expect(calcHours('09:00', '17:00')).toBe(7.5);
            expect(calcHours('08:30', '16:30')).toBe(7.5);
        });

        it('does not deduct lunch break for shifts under 6 hours', () => {
            expect(calcHours('09:00', '14:00')).toBe(5);
            expect(calcHours('10:00', '13:30')).toBe(3.5);
        });

        it('calculates overnight shifts across midnight accurately', () => {
            expect(calcHours('21:00', '05:00')).toBe(7.5);
            expect(calcHours('23:00', '07:00')).toBe(7.5);
            expect(calcHours('22:00', '02:00')).toBe(4);
        });

        it('handles custom break settings and precision rounding', () => {
            expect(calcHours('09:00', '17:15', { breakMins: 45, breakThresholdHours: 6 })).toBe(7.5);
            expect(calcHours('09:00', '17:00', { breakMins: 0 })).toBe(8);
        });

        it('classifies public holiday hours correctly', async () => {
            const slices = await classifyShiftHours(orgAId, '2026-04-25', '09:00', '17:00', 'WORK');
            expect(slices.length).toBe(1);
            expect(slices[0].isPublicHoliday).toBe(true);
            expect(slices[0].holidayName).toBe('ANZAC Day');
            expect(slices[0].publicHolidayHours).toBe(7.5);
            expect(slices[0].normalHours).toBe(0);
        });
    });

    describe('Timesheet Submission 1-Click Workflow', () => {
        it('allows employee to submit their own timesheet for active fortnight', async () => {
            const res = await request(app)
                .post('/api/submissions/submit')
                .set('Authorization', `Bearer ${empAToken}`)
                .send({
                    start_date: '2026-03-29'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('Submitted');
        });

        it('prevents non-manager employee from submitting on behalf of another employee', async () => {
            const res = await request(app)
                .post('/api/submissions/submit')
                .set('Authorization', `Bearer ${empAToken}`)
                .send({
                    start_date: '2026-03-29',
                    employee_id: '123e4567-e89b-12d3-a456-000000000002'
                });

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });
});
