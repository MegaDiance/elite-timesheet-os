import request from 'supertest';
import app from '../src/index';
import { newDb, DataType } from 'pg-mem';
import { setPool, query } from '../src/services/db';
import { hashPassword, generateToken } from '../src/services/auth';

describe('Announcements, Assisted Setup, and Roster Publication Integration Tests', () => {
    const orgId = '123e4567-e89b-12d3-a456-999999999999';
    const adminId = '123e4567-e89b-12d3-a456-111111111111';
    const employeeId = '123e4567-e89b-12d3-a456-222222222222';
    let adminToken: string;
    let employeeToken: string;

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
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
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

            CREATE TABLE fortnight_locks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

            CREATE TABLE organisation_announcements (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

            CREATE TABLE org_invitation_tokens (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                email TEXT NOT NULL,
                token TEXT UNIQUE NOT NULL,
                delivery_status TEXT DEFAULT 'pending',
                last_error TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                used BOOLEAN DEFAULT false
            );

            CREATE TABLE employees (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                user_id UUID,
                full_name TEXT NOT NULL,
                department TEXT,
                email TEXT,
                is_active BOOLEAN DEFAULT true,
                deleted_at TIMESTAMPTZ
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

            CREATE TABLE public_holidays (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                holiday_date TEXT NOT NULL,
                name TEXT NOT NULL,
                UNIQUE(org_id, holiday_date)
            );
        `);

        const adminHash = await hashPassword('AdminPass123!');
        const rosterLockHash = await hashPassword('RosterLockPass456!');
        const timesheetLockHash = await hashPassword('TimesheetLockPass789!');
        const employeeHash = await hashPassword('EmpPass123!');

        db.public.none(`
            INSERT INTO organisations (id, name, break_mins_weekday, break_mins_weekend, break_threshold_hours, roster_lock_password_hash, timesheet_lock_password_hash)
            VALUES ('${orgId}', 'Apex Test Org', 30, 0, 6, '${rosterLockHash}', '${timesheetLockHash}')
        `);

        db.public.none(`
            INSERT INTO users (id, org_id, email, password_hash, role, two_factor_enabled)
            VALUES ('${adminId}', '${orgId}', 'manager@apextest.com', '${adminHash}', 'Company Admin', false)
        `);
        db.public.none(`
            INSERT INTO organisation_members (id, organisation_id, user_id, role)
            VALUES ('123e4567-e89b-12d3-a456-333333333333', '${orgId}', '${adminId}', 'Company Admin')
        `);

        db.public.none(`
            INSERT INTO users (id, org_id, email, password_hash, role, two_factor_enabled)
            VALUES ('${employeeId}', '${orgId}', 'employee@apextest.com', '${employeeHash}', 'Employee', false)
        `);
        db.public.none(`
            INSERT INTO organisation_members (id, organisation_id, user_id, role)
            VALUES ('123e4567-e89b-12d3-a456-444444444444', '${orgId}', '${employeeId}', 'Employee')
        `);

        db.public.none(`
            INSERT INTO employees (id, org_id, user_id, full_name, department, email)
            VALUES ('123e4567-e89b-12d3-a456-555555555555', '${orgId}', '${employeeId}', 'Alex Driver', 'Transport', 'employee@apextest.com')
        `);

        const PgPool = db.adapters.createPg().Pool;
        setPool(new PgPool());

        adminToken = generateToken({ id: adminId, email: 'manager@apextest.com', organisation_id: orgId, role: 'Company Admin' });
        employeeToken = generateToken({ id: employeeId, email: 'employee@apextest.com', organisation_id: orgId, role: 'Employee' });
    });

    describe('Dedicated Lock Passwords Workflow', () => {
        const testFortnight = '2026-03-29';

        it('should reject locking with an incorrect password', async () => {
            const res = await request(app)
                .post('/api/locks')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    start_date: testFortnight,
                    roster_locked: true,
                    password: 'WrongPassword!'
                });

            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
            expect(res.body.error.message).toContain('Invalid Roster Lock password');
        });

        it('should allow locking roster using dedicated roster lock password', async () => {
            const res = await request(app)
                .post('/api/locks')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    start_date: testFortnight,
                    roster_locked: true,
                    password: 'RosterLockPass456!'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const lockCheck = await query('SELECT * FROM fortnight_locks WHERE org_id = $1 AND start_date = $2', [orgId, testFortnight]);
            expect(lockCheck.rows[0].roster_locked).toBe(true);
        });

        it('should allow unlocking roster using admin master password fallback', async () => {
            const res = await request(app)
                .post('/api/locks')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    start_date: testFortnight,
                    roster_locked: false,
                    password: 'AdminPass123!'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const lockCheck = await query('SELECT * FROM fortnight_locks WHERE org_id = $1 AND start_date = $2', [orgId, testFortnight]);
            expect(lockCheck.rows[0].roster_locked).toBe(false);
        });
    });

    describe('Roster Finalisation & Automated Announcements', () => {
        const testFortnight = '2026-04-12';

        it('should reject publishing roster when roster is not locked', async () => {
            const res = await request(app)
                .post('/api/locks/publish')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    start_date: testFortnight,
                    is_published: true
                });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('ROSTER_NOT_LOCKED');
            expect(res.body.error.message).toContain('finalised before pushing');
        });

        it('should allow publishing roster after locking, and automatically create an announcement', async () => {
            // First lock the roster
            const lockRes = await request(app)
                .post('/api/locks')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    start_date: testFortnight,
                    roster_locked: true,
                    password: 'RosterLockPass456!'
                });

            if (lockRes.status !== 200) {
                console.error('[LOCK RES FAILED]', lockRes.status, lockRes.body);
            }

            // Now publish the roster
            const res = await request(app)
                .post('/api/locks/publish')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    start_date: testFortnight,
                    is_published: true
                });

            if (res.status !== 200) {
                console.error('[PUBLISH RES FAILED]', res.status, res.body);
            }

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.published).toBe(true);

            // Verify that an automated announcement was inserted
            const announcementsRes = await request(app)
                .get('/api/announcements')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(announcementsRes.status).toBe(200);
            expect(announcementsRes.body.data.length).toBeGreaterThanOrEqual(1);

            const rosterAlert = announcementsRes.body.data.find((a: any) => a.announcement_type === 'roster_alert' || a.announcement_type === 'roster_publish');
            expect(rosterAlert).toBeDefined();
            expect(rosterAlert.is_system).toBe(true);
            expect(rosterAlert.title).toContain('Roster');
            expect(rosterAlert.content).toContain('from 2026-04-12 to 2026-04-25');
        });

        it('should allow managers to post team announcements and employees to view them', async () => {
            const postRes = await request(app)
                .post('/api/announcements')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    title: 'Public Holiday Reminder',
                    content: 'Please submit your availability for next weeks shifts by Friday.'
                });

            expect(postRes.status).toBe(200);
            expect(postRes.body.success).toBe(true);
            expect(postRes.body.data.title).toBe('Public Holiday Reminder');

            // Employee views announcement feed
            const empFeedRes = await request(app)
                .get('/api/announcements')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(empFeedRes.status).toBe(200);
            const userPost = empFeedRes.body.data.find((a: any) => a.title === 'Public Holiday Reminder');
            expect(userPost).toBeDefined();
            expect(userPost.content).toContain('Friday');
        });

        it('should allow managers to delete an announcement', async () => {
            const listRes = await request(app)
                .get('/api/announcements')
                .set('Authorization', `Bearer ${adminToken}`);

            const target = listRes.body.data[0];
            expect(target).toBeDefined();

            const delRes = await request(app)
                .delete(`/api/announcements/${target.id}`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(delRes.status).toBe(200);
            expect(delRes.body.success).toBe(true);

            // Confirm deletion
            const postDelRes = await request(app)
                .get('/api/announcements')
                .set('Authorization', `Bearer ${adminToken}`);
            expect(postDelRes.body.data.find((a: any) => a.id === target.id)).toBeUndefined();
        });
    });

    describe('Staff Leave Requests Management for Admins', () => {
        let leaveRequestId: string;

        it('should allow employees to submit a leave request', async () => {
            const res = await request(app)
                .post('/api/portal/leave-requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    leave_type: 'Annual',
                    start_date: '2026-05-01',
                    end_date: '2026-05-05',
                    hours: 38,
                    reason: 'Family vacation'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBeDefined();
            expect(res.body.data.status).toBe('Pending');
            leaveRequestId = res.body.data.id;
        });

        it('should allow managers to retrieve all organization leave requests with employee details', async () => {
            const res = await request(app)
                .get('/api/organisation/leave-requests')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
            const found = res.body.data.find((r: any) => r.id === leaveRequestId);
            expect(found).toBeDefined();
            expect(found.employee_name).toBe('Alex Driver');
            expect(found.employee_department).toBe('Transport');
            expect(found.leave_type).toBe('Annual');
            expect(found.status).toBe('Pending');
        });

        it('should prevent employees from accessing organisation leave review endpoint', async () => {
            const res = await request(app)
                .get('/api/organisation/leave-requests')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(403);
        });

        it('should allow managers to approve a leave request', async () => {
            const res = await request(app)
                .post(`/api/organisation/leave-requests/${leaveRequestId}/review`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    status: 'Approved'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('Approved');
        });

        it('should allow managers to reject a leave request with a rejection reason', async () => {
            // Submit another leave request
            const submitRes = await request(app)
                .post('/api/portal/leave-requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    leave_type: 'Sick',
                    start_date: '2026-05-10',
                    end_date: '2026-05-11',
                    hours: 15.2,
                    reason: 'Doctor appointment'
                });
            const secondId = submitRes.body.data.id;

            const res = await request(app)
                .post(`/api/organisation/leave-requests/${secondId}/review`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    status: 'Rejected',
                    rejection_reason: 'Shortage of coverage on these dates'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('Rejected');
            expect(res.body.data.rejection_reason).toBe('Shortage of coverage on these dates');

            // Employee views their leave requests and sees the rejection reason
            const empRes = await request(app)
                .get('/api/portal/leave-requests')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(empRes.status).toBe(200);
            const empRecord = empRes.body.data.find((r: any) => r.id === secondId);
            expect(empRecord.status).toBe('Rejected');
            expect(empRecord.rejection_reason).toBe('Shortage of coverage on these dates');
        });
    });

    describe('Employee Full Team Roster Access (Without Timesheet)', () => {
        const rosterFortnight = '2026-04-12';

        beforeAll(async () => {
            // Seed a daily record with shift segments including timesheet actuals
            const recId = '123e4567-e89b-12d3-a456-666666666666';
            const empId = '123e4567-e89b-12d3-a456-555555555555';
            await query(
                `INSERT INTO daily_records (id, org_id, employee_id, record_date, has_actuals)
                 VALUES ($1, $2, $3, $4, true)`,
                [recId, orgId, empId, '2026-04-13']
            );

            await query(
                `INSERT INTO shift_segments (id, record_id, segment_type, roster_in, roster_out, roster_hours, actual_in, actual_out, actual_hours, actual_segment_type, notes)
                 VALUES ($1, $2, 'Work', '09:00', '17:00', 8, '09:05', '17:15', 8.16, 'Work', 'Clocked in 5m late')`,
                ['123e4567-e89b-12d3-a456-777777777777', recId]
            );
        });

        it('should return is_published false if the requested fortnight is unpublished', async () => {
            const res = await request(app)
                .get('/api/portal/team-roster?start_date=2026-05-24')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.is_published).toBe(false);
            expect(res.body.data.team).toEqual([]);
        });

        it('should return the full team roster for a published fortnight without any timesheet actuals', async () => {
            const res = await request(app)
                .get(`/api/portal/team-roster?start_date=${rosterFortnight}`)
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.is_published).toBe(true);
            expect(res.body.data.team.length).toBeGreaterThanOrEqual(1);

            const teamMember = res.body.data.team.find((m: any) => m.id === '123e4567-e89b-12d3-a456-555555555555');
            expect(teamMember).toBeDefined();
            expect(teamMember.full_name).toBe('Alex Driver');
            expect(teamMember.total_rostered_hours).toBe(8);

            const dayRecord = teamMember.days.find((d: any) => d.date === '2026-04-13');
            expect(dayRecord).toBeDefined();
            expect(dayRecord.rosteredHours).toBe(8);
            expect(dayRecord.segments.length).toBe(1);

            const seg = dayRecord.segments[0];
            // Verify roster fields exist
            expect(seg.roster_in).toBe('09:00');
            expect(seg.roster_out).toBe('17:00');
            expect(seg.roster_hours).toBe(8);
            expect(seg.segment_type).toBe('Work');

            // CRITICAL: Verify timesheet actuals are completely omitted
            expect((seg as any).actual_in).toBeUndefined();
            expect((seg as any).actual_out).toBeUndefined();
            expect((seg as any).actual_hours).toBeUndefined();
            expect((seg as any).actual_segment_type).toBeUndefined();
            expect((seg as any).notes).toBeUndefined();
        });
    });
});
