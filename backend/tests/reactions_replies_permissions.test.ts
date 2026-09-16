import request from 'supertest';
import app from '../src/index';
import crypto from 'crypto';
import { newDb, DataType } from 'pg-mem';
import { setPool } from '../src/services/db';
import { generateToken } from '../src/services/auth';

describe('Announcements Reactions, Replies & Admin Permissions Tests', () => {
    const orgAId = '11111111-1111-1111-1111-111111111111';
    const orgBId = '22222222-2222-2222-2222-222222222222';
    const empAUserId = '33333333-3333-3333-3333-333333333333';
    const empBUserId = '44444444-4444-4444-4444-444444444444';
    const adminAUserId = '55555555-5555-5555-5555-555555555555';

    let empAToken: string;
    let empBToken: string;
    let adminAToken: string;

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
                allow_employee_chat BOOLEAN DEFAULT true,
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
                created_at TIMESTAMPTZ DEFAULT NOW()
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

            CREATE TABLE announcement_reactions (
                id UUID PRIMARY KEY,
                announcement_id UUID NOT NULL,
                org_id UUID NOT NULL,
                user_id UUID NOT NULL,
                user_name TEXT NOT NULL,
                emoji TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(announcement_id, user_id, emoji)
            );

            CREATE TABLE announcement_replies (
                id UUID PRIMARY KEY,
                announcement_id UUID NOT NULL,
                org_id UUID NOT NULL,
                author_id UUID NOT NULL,
                author_name TEXT NOT NULL,
                author_role TEXT,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // Seed Organizations
        db.public.none(`INSERT INTO organisations (id, name, slug, allow_employee_chat) VALUES ('${orgAId}', 'Alpha Corp', 'alpha-corp', true)`);
        db.public.none(`INSERT INTO organisations (id, name, slug, allow_employee_chat) VALUES ('${orgBId}', 'Beta Logistics', 'beta-logistics', true)`);

        // Seed Users
        db.public.none(`INSERT INTO users (id, org_id, email, role) VALUES ('${empAUserId}', '${orgAId}', 'alice@alpha.com', 'Employee')`);
        db.public.none(`INSERT INTO users (id, org_id, email, role) VALUES ('${empBUserId}', '${orgBId}', 'bob@beta.com', 'Employee')`);
        db.public.none(`INSERT INTO users (id, org_id, email, role) VALUES ('${adminAUserId}', '${orgAId}', 'admin@alpha.com', 'Company Admin')`);

        // Seed Employees
        db.public.none(`INSERT INTO employees (id, org_id, user_id, full_name, email) VALUES ('${crypto.randomUUID()}', '${orgAId}', '${empAUserId}', 'Alice Smith', 'alice@alpha.com')`);
        db.public.none(`INSERT INTO employees (id, org_id, user_id, full_name, email) VALUES ('${crypto.randomUUID()}', '${orgBId}', '${empBUserId}', 'Bob Jones', 'bob@beta.com')`);

        const PgPool = db.adapters.createPg().Pool;
        setPool(new PgPool());

        empAToken = generateToken({ id: empAUserId, email: 'alice@alpha.com', role: 'Employee', organisation_id: orgAId });
        empBToken = generateToken({ id: empBUserId, email: 'bob@beta.com', role: 'Employee', organisation_id: orgBId });
        adminAToken = generateToken({ id: adminAUserId, email: 'admin@alpha.com', role: 'Company Admin', organisation_id: orgAId });
    });

    let announcementAId: string;

    test('1. Admin publishes an announcement in Org A', async () => {
        const res = await request(app)
            .post('/api/announcements')
            .set('Authorization', `Bearer ${adminAToken}`)
            .send({
                title: 'Welcome to Q3',
                content: 'Great work team! Keep up the momentum.'
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.id).toBeDefined();
        announcementAId = res.body.data.id;
    });

    test('2. Employee in Org A reacts with emoji (toggle on/off)', async () => {
        // First reaction: toggle ON
        const reactRes1 = await request(app)
            .post(`/api/announcements/${announcementAId}/reactions`)
            .set('Authorization', `Bearer ${empAToken}`)
            .send({ emoji: '👍' });

        expect(reactRes1.status).toBe(200);
        expect(reactRes1.body.success).toBe(true);
        expect(reactRes1.body.data.reactions).toHaveLength(1);
        expect(reactRes1.body.data.reactions[0].emoji).toBe('👍');
        expect(reactRes1.body.data.reactions[0].count).toBe(1);
        expect(reactRes1.body.data.reactions[0].user_reacted).toBe(true);
        expect(reactRes1.body.data.reactions[0].users).toContain('Alice Smith');

        // Second reaction with same emoji: toggle OFF
        const reactRes2 = await request(app)
            .post(`/api/announcements/${announcementAId}/reactions`)
            .set('Authorization', `Bearer ${empAToken}`)
            .send({ emoji: '👍' });

        expect(reactRes2.status).toBe(200);
        expect(reactRes2.body.data.reactions).toHaveLength(0);

        // React with ❤️ to keep for subsequent tests
        await request(app)
            .post(`/api/announcements/${announcementAId}/reactions`)
            .set('Authorization', `Bearer ${empAToken}`)
            .send({ emoji: '❤️' });
    });

    let replyAId: string;

    test('3. Employee posts a threaded reply and resolves verified name', async () => {
        const res = await request(app)
            .post(`/api/announcements/${announcementAId}/replies`)
            .set('Authorization', `Bearer ${empAToken}`)
            .send({ content: 'Thanks for the update! Excited for Q3.' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.author_name).toBe('Alice Smith');
        expect(res.body.data.content).toBe('Thanks for the update! Excited for Q3.');
        replyAId = res.body.data.id;
    });

    test('4. GET /api/announcements returns reactions, replies, and permissions', async () => {
        const res = await request(app)
            .get('/api/announcements')
            .set('Authorization', `Bearer ${empAToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].id).toBe(announcementAId);
        expect(res.body.data[0].reply_count).toBe(1);
        expect(res.body.data[0].replies[0].content).toBe('Thanks for the update! Excited for Q3.');
        expect(res.body.data[0].reactions[0].emoji).toBe('❤️');
        expect(res.body.permissions.allow_employee_chat).toBe(true);
        expect(res.body.permissions.can_post).toBe(true);
    });

    test('5. Employee cannot delete another user\'s reply, but author can delete own reply', async () => {
        // Admin posts another reply
        const adminReplyRes = await request(app)
            .post(`/api/announcements/${announcementAId}/replies`)
            .set('Authorization', `Bearer ${adminAToken}`)
            .send({ content: 'Let us make it the best quarter yet.' });
        const adminReplyId = adminReplyRes.body.data.id;

        // Employee attempts to delete Admin's reply -> 403 Forbidden
        const delRes403 = await request(app)
            .delete(`/api/announcements/${announcementAId}/replies/${adminReplyId}`)
            .set('Authorization', `Bearer ${empAToken}`);

        expect(delRes403.status).toBe(403);

        // Employee deletes own reply -> 200 OK
        const delOwnRes = await request(app)
            .delete(`/api/announcements/${announcementAId}/replies/${replyAId}`)
            .set('Authorization', `Bearer ${empAToken}`);

        expect(delOwnRes.status).toBe(200);
        expect(delOwnRes.body.success).toBe(true);
    });

    test('6. Admin adjusts permissions: Disabling employee chat restricts employee talking', async () => {
        // Admin disables employee chat
        const permRes = await request(app)
            .patch('/api/announcements/permissions')
            .set('Authorization', `Bearer ${adminAToken}`)
            .send({ allow_employee_chat: false });

        expect(permRes.status).toBe(200);
        expect(permRes.body.allow_employee_chat).toBe(false);

        // Employee attempts to post new announcement -> 403 Forbidden
        const postAnnRes = await request(app)
            .post('/api/announcements')
            .set('Authorization', `Bearer ${empAToken}`)
            .send({ content: 'Can I talk here?' });

        expect(postAnnRes.status).toBe(403);
        expect(postAnnRes.body.error.code).toBe('CHAT_DISABLED');

        // Employee attempts to reply -> 403 Forbidden
        const replyRes = await request(app)
            .post(`/api/announcements/${announcementAId}/replies`)
            .set('Authorization', `Bearer ${empAToken}`)
            .send({ content: 'Trying to reply while muted.' });

        expect(replyRes.status).toBe(403);
        expect(replyRes.body.error.code).toBe('CHAT_DISABLED');

        // Admin can still post announcement and reply
        const adminPostRes = await request(app)
            .post('/api/announcements')
            .set('Authorization', `Bearer ${adminAToken}`)
            .send({ title: 'Notice', content: 'Management update while employee chat is paused.' });

        expect(adminPostRes.status).toBe(200);

        // Admin re-enables employee chat
        const reEnableRes = await request(app)
            .patch('/api/announcements/permissions')
            .set('Authorization', `Bearer ${adminAToken}`)
            .send({ allow_employee_chat: true });

        expect(reEnableRes.status).toBe(200);
        expect(reEnableRes.body.allow_employee_chat).toBe(true);

        // Employee can post again
        const employeeAllowedRes = await request(app)
            .post('/api/announcements')
            .set('Authorization', `Bearer ${empAToken}`)
            .send({ content: 'Back online!' });

        expect(employeeAllowedRes.status).toBe(200);
    });

    test('7. Cross-tenant isolation: User in Org B cannot access Org A announcements/reactions/replies', async () => {
        // Org B employee tries to react to Org A announcement
        const crossReactRes = await request(app)
            .post(`/api/announcements/${announcementAId}/reactions`)
            .set('Authorization', `Bearer ${empBToken}`)
            .send({ emoji: '🎉' });

        expect(crossReactRes.status).toBe(404);

        // Org B employee tries to reply to Org A announcement
        const crossReplyRes = await request(app)
            .post(`/api/announcements/${announcementAId}/replies`)
            .set('Authorization', `Bearer ${empBToken}`)
            .send({ content: 'I am from another company!' });

        expect(crossReplyRes.status).toBe(404);

        // Org B GET /api/announcements does not show Org A announcements
        const listBRes = await request(app)
            .get('/api/announcements')
            .set('Authorization', `Bearer ${empBToken}`);

        expect(listBRes.status).toBe(200);
        expect(listBRes.body.data.find((a: any) => a.id === announcementAId)).toBeUndefined();
    });
});
