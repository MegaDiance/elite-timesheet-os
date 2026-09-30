/**
 * Account lifecycle: organisation sign-up (becoming an Owner), team invitations and role
 * assignments, and ownership transfer.
 */
import request from 'supertest';
import crypto from 'crypto';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { getTestOutbox, clearTestOutbox } from '../src/services/emailService';
import { connectTestDb, resetTestDb, closeTestDb, sql } from './helpers/testDb';
import { PASSWORD, World, bearer, buildWorld, systemRoleId } from './helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    clearTestOutbox();
    w = await buildWorld();
});

const lastTokenTo = (to: string) => /token=([a-f0-9]{64})/.exec([...getTestOutbox()].reverse().find(m => m.to === to)!.text || '')![1];

describe('organisation sign-up', () => {
    const complete = (token: string, extra: object = {}) => request(app).post('/api/signup/complete')
        .send({ token, organisation_name: 'New Clinic', password: 'Founder123', branch_name: 'Carlton', ...extra });

    it('creates the organisation, its first branch and its Owner — and no session', async () => {
        const requested = await request(app).post('/api/signup/request').send({ email: 'founder@new.test' });
        expect(requested.body).toEqual({ success: true, message: 'Check your email for a link to set up your organisation.' });
        const token = lastTokenTo('founder@new.test');
        expect((await sql('SELECT token_hash FROM organisation_signups')).rows[0].token_hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));

        expect((await request(app).get(`/api/signup/verify?token=${token}`)).body.data.email).toBe('founder@new.test');
        const done = await complete(token);
        expect(done.status).toBe(201);
        expect(done.body.data.token).toBeUndefined();

        const org = (await sql("SELECT o.portal_slug, o.portal_slug_hash, o.portal_slug_enc, u.email FROM organisations o JOIN users u ON u.id = o.owner_user_id WHERE o.name = 'New Clinic'")).rows[0];
        expect(org.email).toBe('founder@new.test');
        const linkToken = String(done.body.data.login_path).replace('/login/', '');
        expect(linkToken).toMatch(/^[0-9a-f]{32}$/);
        // The sign-in link is stored only as a hash (for lookup) and an encrypted copy — never in plain text.
        expect(org.portal_slug).toBeNull();
        expect(org.portal_slug_hash).toBe(crypto.createHash('sha256').update(linkToken).digest('hex'));
        expect(org.portal_slug_enc).not.toContain(linkToken);
        expect((await sql("SELECT l.name FROM locations l JOIN organisations o ON o.id = l.org_id WHERE o.name = 'New Clinic'")).rows).toEqual([{ name: 'Carlton' }]);

        const login = await request(app).post('/api/auth/login').send({ email: 'founder@new.test', password: 'Founder123', organisation_slug: linkToken });
        expect(login.body.data.roles.map((r: any) => r.name)).toEqual(['Owner']);
        expect(login.body.data.is_owner).toBe(true);
    });

    it('the link is single use and expires; weak passwords are refused', async () => {
        await request(app).post('/api/signup/request').send({ email: 'founder@new.test' });
        const token = lastTokenTo('founder@new.test');
        expect((await complete(token, { password: 'short' })).status).toBe(400);
        expect((await complete(token)).status).toBe(201);
        expect((await complete(token)).status).toBe(400);

        await request(app).post('/api/signup/request').send({ email: 'late@new.test' });
        await sql("UPDATE organisation_signups SET expires_at = NOW() - INTERVAL '1 minute' WHERE email = 'late@new.test'");
        expect((await complete(lastTokenTo('late@new.test'))).status).toBe(400);
    });

    it('an existing account must prove its password to own a new organisation', async () => {
        await request(app).post('/api/signup/request').send({ email: w.users.sarah.email });
        const token = lastTokenTo(w.users.sarah.email);
        expect((await complete(token, { password: 'WrongPassword1' })).status).toBe(401);
        expect((await complete(token, { password: PASSWORD })).status).toBe(201);
        await request(app).post('/api/auth/reauthenticate').set(bearer(w.tokens.sarah)).send({ password: PASSWORD });
        const orgs = await request(app).get('/api/auth/organisations').set(bearer(w.tokens.sarah));
        expect(orgs.body.data.map((o: any) => [o.name, o.roles]).sort()).toEqual([['ABC Health', ['Admin']], ['New Clinic', ['Owner']]]);
    });
});

/** The assignment of `roleName` held by `userId`, as GET /api/team reports it. */
async function assignmentOf(token: string, userId: string, roleName: string) {
    const list = await request(app).get('/api/team').set(bearer(token));
    const member = list.body.data.members.find((m: any) => m.user_id === userId);
    return member?.assignments.find((a: any) => a.role_name === roleName);
}

describe('team management', () => {
    it('lists people with their roles and scope, and pending invitations — never tokens', async () => {
        const admin = await systemRoleId(w.abc.id, 'ADMIN');
        await request(app).post('/api/team/invitations').set(bearer(w.tokens.owner)).send({ email: 'pending@abc.test', role_id: admin, scope: { branch_ids: [w.abc.geelong, w.abc.richmond] } });
        const res = await request(app).get('/api/team').set(bearer(w.tokens.owner));
        expect(res.status).toBe(200);
        const sarah = res.body.data.members.find((m: any) => m.user_id === w.users.sarah.id);
        expect(sarah.assignments).toHaveLength(1);
        expect(sarah.assignments[0].role_name).toBe('Admin');
        expect(sarah.assignments[0].scope.all).toBe(false);
        expect(sarah.assignments[0].scope.branches.map((b: any) => b.name)).toEqual(['Melbourne', 'Richmond']);
        expect(res.body.data.members.find((m: any) => m.is_owner).user_id).toBe(w.users.owner.id);
        expect(res.body.data.invitations[0].role_name).toBe('Admin');
        expect(res.body.data.invitations[0].branches.map((b: any) => b.name)).toEqual(['Geelong', 'Richmond']);
        expect(JSON.stringify(res.body)).not.toMatch(/token|[a-f0-9]{64}/);
    });

    it('a role can be applied to more branches, and the change takes effect on the next request', async () => {
        const greg = await assignmentOf(w.tokens.owner, w.users.greg.id, 'Admin');
        const res = await request(app).put(`/api/team/${w.users.greg.id}/roles/${greg.id}`).set(bearer(w.tokens.owner)).send({ scope: { branch_ids: [w.abc.geelong, w.abc.melbourne] } });
        expect(res.status).toBe(200);
        const list = await request(app).get('/api/employees').set(bearer(w.tokens.greg));
        expect(list.body.data.map((e: any) => e.full_name).sort()).toEqual(['Gee Worker', 'Mel Worker']);
    });

    it('roles cannot be given to someone who does not belong to the organisation (they must accept an invitation)', async () => {
        const admin = await systemRoleId(w.abc.id, 'ADMIN');
        const res = await request(app).post(`/api/team/${w.users.xavier.id}/roles`).set(bearer(w.tokens.owner)).send({ role_id: admin, scope: { branch_ids: [w.abc.melbourne] } });
        expect(res.status).toBe(404);
    });

    it('deactivated branches cannot be assigned', async () => {
        await request(app).post(`/api/locations/${w.abc.richmond}/deactivate`).set(bearer(w.tokens.owner));
        const greg = await assignmentOf(w.tokens.owner, w.users.greg.id, 'Admin');
        const res = await request(app).put(`/api/team/${w.users.greg.id}/roles/${greg.id}`).set(bearer(w.tokens.owner)).send({ scope: { branch_ids: [w.abc.richmond] } });
        expect(res.status).toBe(404);
    });

    it('the last active branch cannot be deactivated', async () => {
        await request(app).post(`/api/locations/${w.abc.richmond}/deactivate`).set(bearer(w.tokens.owner));
        await request(app).post(`/api/locations/${w.abc.geelong}/deactivate`).set(bearer(w.tokens.owner));
        const res = await request(app).post(`/api/locations/${w.abc.melbourne}/deactivate`).set(bearer(w.tokens.owner));
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('LAST_BRANCH');
    });

    it('assignment changes are audited with before and after', async () => {
        const sarah = await assignmentOf(w.tokens.owner, w.users.sarah.id, 'Admin');
        await request(app).put(`/api/team/${w.users.sarah.id}/roles/${sarah.id}`).set(bearer(w.tokens.owner)).send({ scope: { branch_ids: [w.abc.geelong] } });
        const row = (await sql("SELECT previous_value, new_value, target_user_id FROM audit_logs WHERE action = 'ROLE_SCOPE_CHANGED'")).rows[0];
        expect(row).toEqual({ previous_value: 'Admin: Melbourne, Richmond', new_value: 'Admin: Geelong', target_user_id: w.users.sarah.id });
    });
});

describe('ownership transfer', () => {
    it('needs the owner’s password and a current team member; the old owner keeps Admin access to every branch', async () => {
        const wrong = await request(app).post('/api/organisation/transfer-ownership').set(bearer(w.tokens.owner)).send({ user_id: w.users.sarah.id, current_password: 'WrongPassword1' });
        expect(wrong.status).toBe(403);
        const outsider = await request(app).post('/api/organisation/transfer-ownership').set(bearer(w.tokens.owner)).send({ user_id: w.users.xavier.id, current_password: PASSWORD });
        expect(outsider.status).toBe(404);

        const ok = await request(app).post('/api/organisation/transfer-ownership').set(bearer(w.tokens.owner)).send({ user_id: w.users.sarah.id, current_password: PASSWORD });
        expect(ok.status).toBe(200);
        expect((await sql('SELECT owner_user_id FROM organisations WHERE id = $1', [w.abc.id])).rows[0].owner_user_id).toBe(w.users.sarah.id);
        expect((await sql('SELECT COUNT(*)::int AS n FROM user_roles WHERE user_id = $1', [w.users.sarah.id])).rows[0].n).toBe(0);

        const me = await request(app).get('/api/auth/me').set(bearer(w.tokens.owner));
        expect(me.body.data.is_owner).toBe(false);
        expect(me.body.data.roles.map((r: any) => r.name)).toEqual(['Admin']);
        expect(me.body.data.branches).toHaveLength(3);
        expect((await request(app).put('/api/organisation/settings').set(bearer(w.tokens.owner)).send({ break_mins_weekday: 30 })).status).toBe(403);
    });

    it('the owner cannot transfer to themselves', async () => {
        const res = await request(app).post('/api/organisation/transfer-ownership').set(bearer(w.tokens.owner)).send({ user_id: w.users.owner.id, current_password: PASSWORD });
        expect(res.status).toBe(400);
    });
});
