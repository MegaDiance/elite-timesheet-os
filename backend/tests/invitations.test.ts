import request from 'supertest';
import app from '../src/index';
import { newDb, DataType } from 'pg-mem';
import { setPool } from '../src/services/db';
import { generateToken, hashPassword } from '../src/services/auth';

describe('Organization & User Invitation Integration Tests', () => {
    let platformAdminToken: string;
    let companyAdminToken: string;
    const platformAdminOrgId = '123e4567-e89b-12d3-a456-222222222222';
    const platformAdminUserId = '123e4567-e89b-12d3-a456-111111111111';

    beforeAll(async () => {
        const db = newDb();
        db.public.registerFunction({
            name: 'gen_random_uuid',
            args: [],
            returns: DataType.uuid,
            implementation: () => '123e4567-e89b-12d3-a456-' + Math.floor(Math.random() * 10000000),
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

            CREATE TABLE roster_templates (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                employee_id UUID NOT NULL,
                day_index INTEGER NOT NULL,
                segment_type TEXT NOT NULL,
                roster_in TEXT,
                roster_out TEXT,
                roster_hours NUMERIC DEFAULT 0
            );

            CREATE TABLE audit_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT NOW(),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                actor_id UUID,
                action TEXT NOT NULL,
                entity_id UUID,
                details TEXT,
                snapshot TEXT
            );

            CREATE TABLE invitation_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id UUID NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL
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

            CREATE TABLE reset_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id UUID NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL
            );
        `);

        const hash = await hashPassword('password123');
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${platformAdminUserId}', '${platformAdminOrgId}', 'admin@elite.local', '${hash}', 'Platform Admin')`);
        db.public.none(`INSERT INTO organisations (id, name) VALUES ('${platformAdminOrgId}', 'Elite Corp')`);
        db.public.none(`INSERT INTO organisation_members (organisation_id, user_id, role) VALUES ('${platformAdminOrgId}', '${platformAdminUserId}', 'Platform Admin')`);

        const PgPool = db.adapters.createPg().Pool;
        setPool(new PgPool());

        platformAdminToken = generateToken({
            id: platformAdminUserId,
            email: 'admin@elite.local',
            organisation_id: platformAdminOrgId,
            role: 'Platform Admin'
        });

        companyAdminToken = generateToken({
            id: platformAdminUserId,
            email: 'admin@elite.local',
            organisation_id: platformAdminOrgId,
            role: 'Company Admin'
        });

        process.env.EMAIL_PROVIDER = 'dev-mock';
    });

    describe('Platform Org Invite Workflow', () => {
        let inviteToken: string;
        const targetEmail = 'neworg@example.com';

        it('should require authentication to generate an org invite', async () => {
            const res = await request(app)
                .post('/api/platform/send-invite')
                .send({ email: targetEmail });
            expect(res.status).toBe(401);
        });

        it('should generate an org invitation link and save to org_invitation_tokens without column errors', async () => {
            const res = await request(app)
                .post('/api/platform/send-invite')
                .set('Authorization', `Bearer ${platformAdminToken}`)
                .send({ email: targetEmail });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.inviteLink).toBeDefined();
            expect(res.body.data.inviteLink).toContain('/setup-org?token=');

            inviteToken = res.body.data.inviteLink.split('token=')[1];
            expect(inviteToken).toBeTruthy();
        });

        it('should verify the organization invite token successfully', async () => {
            const res = await request(app)
                .get(`/api/platform/verify-invite?token=${inviteToken}`);

            if (res.status !== 200) {
                console.error('[VERIFY INVITE FAILED]', res.status, res.body, 'inviteToken:', inviteToken);
            }
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.email).toBe(targetEmail);
        });

        it('should reject invalid tokens in verify-invite', async () => {
            const res = await request(app)
                .get('/api/platform/verify-invite?token=non-existent-token');

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('should successfully claim the org invite and create tenant + admin account', async () => {
            const res = await request(app)
                .post('/api/platform/claim-invite')
                .send({
                    token: inviteToken,
                    name: 'Test Tenant Ltd',
                    admin_email: targetEmail,
                    admin_password: 'Password123!'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBeDefined();
            expect(res.body.data.admin_id).toBeDefined();
        });

        it('should reject claiming an invitation with a different email than the one it was sent to', async () => {
            // Generate a fresh invite
            const inviteRes = await request(app)
                .post('/api/platform/send-invite')
                .set('Authorization', `Bearer ${platformAdminToken}`)
                .send({ email: 'restricted@example.com' });
            
            const freshToken = inviteRes.body.data.inviteLink.split('token=')[1];

            const mismatchRes = await request(app)
                .post('/api/platform/claim-invite')
                .send({
                    token: freshToken,
                    name: 'Hacker Org',
                    admin_email: 'someoneelse@example.com',
                    admin_password: 'Password123!'
                });

            expect(mismatchRes.status).toBe(403);
            expect(mismatchRes.body.success).toBe(false);
            expect(mismatchRes.body.error.message).toContain('Only this email can claim the invitation');
        });

        it('should reject generating an invite if the email already belongs to an existing user', async () => {
            const res = await request(app)
                .post('/api/platform/send-invite')
                .set('Authorization', `Bearer ${platformAdminToken}`)
                .send({ email: targetEmail }); // targetEmail was already claimed above

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error.message).toContain('already exists');
        });

        it('should return organisations with admin_email, user_count, and status in GET /organisations', async () => {
            const res = await request(app)
                .get('/api/platform/organisations')
                .set('Authorization', `Bearer ${platformAdminToken}`);

            expect(res.status).toBe(200);
            if (res.body.success !== true) {
                console.error('[GET /api/platform/organisations FAILED]', res.status, res.body);
            }
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);

            const tenant = res.body.data.find((o: any) => o.name === 'Test Tenant Ltd');
            expect(tenant).toBeDefined();
            expect(tenant.admin_email).toBe(targetEmail);
            expect(tenant.user_count).toBeGreaterThanOrEqual(1);
        });

        it('should list all organisation invitations in GET /platform/invitations', async () => {
            const res = await request(app)
                .get('/api/platform/invitations')
                .set('Authorization', `Bearer ${platformAdminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);

            const targetInv = res.body.data.find((i: any) => i.email === targetEmail);
            expect(targetInv).toBeDefined();
            expect(targetInv.used).toBe(true);
            expect(targetInv.delivery_status).toBe('sent');
        });

        it('should allow platform admin to resend an organization invitation email', async () => {
            // Send fresh invite
            const freshRes = await request(app)
                .post('/api/platform/send-invite')
                .set('Authorization', `Bearer ${platformAdminToken}`)
                .send({ email: 'resend_target@example.com' });

            expect(freshRes.status).toBe(200);
            const inviteId = freshRes.body.data.id;

            // Resend invite
            const resendRes = await request(app)
                .post('/api/platform/resend-invite')
                .set('Authorization', `Bearer ${platformAdminToken}`)
                .send({ id: inviteId });

            expect(resendRes.status).toBe(200);
            expect(resendRes.body.success).toBe(true);
            expect(resendRes.body.data.delivery_status).toBe('sent');
            expect(resendRes.body.data.recipient).toBe('resend_target@example.com');
        });

        it('should return 502 with clear error details when email delivery fails', async () => {
            const originalProvider = process.env.EMAIL_PROVIDER;
            const originalKey = process.env.RESEND_API_KEY;

            // Force provider to fail
            process.env.EMAIL_PROVIDER = 'resend';
            delete process.env.RESEND_API_KEY;

            try {
                const failRes = await request(app)
                    .post('/api/platform/send-invite')
                    .set('Authorization', `Bearer ${platformAdminToken}`)
                    .send({ email: 'delivery_fail@example.com' });

                expect(failRes.status).toBe(502);
                expect(failRes.body.success).toBe(false);
                expect(failRes.body.error.message).toContain('Email could not be sent');
                expect(failRes.body.data.delivery_status).toBe('failed');
            } finally {
                process.env.EMAIL_PROVIDER = originalProvider;
                if (originalKey) process.env.RESEND_API_KEY = originalKey;
            }
        });

        it('should not allow reusing the same token', async () => {
            const verifyRes = await request(app)
                .get(`/api/platform/verify-invite?token=${inviteToken}`);
            expect(verifyRes.status).toBe(400);

            const claimRes = await request(app)
                .post('/api/platform/claim-invite')
                .send({
                    token: inviteToken,
                    name: 'Duplicate Tenant',
                    admin_email: targetEmail,
                    admin_password: 'Password123!'
                });
            expect(claimRes.status).toBe(400);
        });
    });

    describe('Employee Invite & Account Setup Workflow', () => {
        let employeeId: string;
        let empInviteToken: string;
        const employeeEmail = 'staff@example.com';

        it('should create an employee and generate invite link when create_account is true', async () => {
            const res = await request(app)
                .post('/api/employees')
                .set('Authorization', `Bearer ${companyAdminToken}`)
                .send({
                    full_name: 'Alice Employee',
                    email: employeeEmail,
                    create_account: true,
                    role: 'Employee'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBeDefined();
            expect(res.body.data.user_id).toBeDefined();
            expect(res.body.data.inviteLink).toBeDefined();

            employeeId = res.body.data.id;
            empInviteToken = res.body.data.inviteLink.split('token=')[1];
            expect(empInviteToken).toBeTruthy();
        });

        it('should verify the employee invitation token via /api/auth/invitation', async () => {
            const res = await request(app)
                .get(`/api/auth/invitation?token=${empInviteToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.email).toBe(employeeEmail);
        });

        it('should allow resending an invite and invalidate the previous token', async () => {
            const res = await request(app)
                .post(`/api/employees/${employeeId}/send-invitation`)
                .set('Authorization', `Bearer ${companyAdminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.inviteLink).toBeDefined();

            const newInviteToken = res.body.data.inviteLink.split('token=')[1];
            expect(newInviteToken).not.toBe(empInviteToken);

            // Old token should now be invalid
            const oldVerify = await request(app)
                .get(`/api/auth/invitation?token=${empInviteToken}`);
            expect(oldVerify.status).toBe(400);

            // New token should be valid
            const newVerify = await request(app)
                .get(`/api/auth/invitation?token=${newInviteToken}`);
            expect(newVerify.status).toBe(200);
            expect(newVerify.body.data.email).toBe(employeeEmail);

            empInviteToken = newInviteToken;
        });

        it('should claim invitation and activate account with password', async () => {
            const res = await request(app)
                .post('/api/auth/claim-invitation')
                .send({
                    token: empInviteToken,
                    password: 'StaffPassword123!'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            // Employee should now be able to log in
            const loginRes = await request(app)
                .post('/api/auth/login')
                .send({
                    email: employeeEmail,
                    password: 'StaffPassword123!'
                });

            expect(loginRes.status).toBe(200);
            expect(loginRes.body.success).toBe(true);
            expect(loginRes.body.data.token).toBeDefined();
        });
    });
});
