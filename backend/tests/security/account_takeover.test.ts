/**
 * A login is global — one person, one account, possibly in several organisations and roles — so
 * nothing an organisation's Owner or Branch Admin can do to "their" worker or admin may reach
 * further than that organisation grants them. Each case below reproduces a concrete attack found
 * in the tenant/branch audit and proves it is closed.
 */
import request from 'supertest';
import app from '../../src/index';
import { clearAllRateLimits } from '../../src/services/authUtils';
import { getTestOutbox, clearTestOutbox } from '../../src/services/emailService';
import { connectTestDb, resetTestDb, closeTestDb, sql } from '../helpers/testDb';
import { PASSWORD, World, bearer, buildWorld, createWorker, linkEmployeeLogin } from '../helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    clearTestOutbox();
    w = await buildWorld();
});

const resetLinkForWorker = (token: string, workerId: string) =>
    request(app).post(`/api/employee-accounts/${workerId}/reset-password-link`).set(bearer(token));
const resetTokenCount = async (userId: string) => (await sql('SELECT COUNT(*)::int AS n FROM reset_tokens WHERE user_id = $1', [userId])).rows[0].n;

describe('reset links can never reach beyond what the caller controls', () => {
    it("a Branch Admin cannot reset the Owner's login through a worker record linked to it", async () => {
        const ownerAsWorker = await createWorker(w.abc.id, w.abc.melbourne, 'Olivia Also Works Shifts');
        await linkEmployeeLogin(ownerAsWorker, w.users.owner.id);

        const res = await resetLinkForWorker(w.tokens.sarah, ownerAsWorker);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('ACCOUNT_HAS_OTHER_ACCESS');
        expect(res.body.data).toBeUndefined();
        expect(await resetTokenCount(w.users.owner.id)).toBe(0);
    });

    it("a Branch Admin cannot reset another organisation's Owner who is also their worker", async () => {
        const xavierAsWorker = await createWorker(w.abc.id, w.abc.melbourne, 'Xavier Casual');
        await linkEmployeeLogin(xavierAsWorker, w.users.xavier.id);
        expect((await resetLinkForWorker(w.tokens.sarah, xavierAsWorker)).status).toBe(409);
        expect(await resetTokenCount(w.users.xavier.id)).toBe(0);
    });

    it('a Branch Admin cannot reset a fellow Branch Admin of the same organisation via a worker record', async () => {
        const gregAsWorker = await createWorker(w.abc.id, w.abc.melbourne, 'Greg Casual');
        await linkEmployeeLogin(gregAsWorker, w.users.greg.id);
        expect((await resetLinkForWorker(w.tokens.sarah, gregAsWorker)).status).toBe(409);
    });

    it('an ordinary employee-only login can still be given a reset link by their manager', async () => {
        const res = await resetLinkForWorker(w.tokens.sarah, w.workers.mel);
        expect(res.status).toBe(200);
        expect(res.body.data.reset_link).toMatch(/reset-password\?token=[a-f0-9]{64}$/);
    });

    it("an Owner cannot reset a Branch Admin's login when that login also has access in another organisation", async () => {
        await sql('INSERT INTO branch_admins (org_id, location_id, user_id) VALUES ($1, $2, $3)', [w.xyz.id, w.xyz.sydney, w.users.greg.id]);
        const res = await request(app).post(`/api/branch-admins/${w.users.greg.id}/reset-password-link`).set(bearer(w.tokens.owner));
        expect(res.status).toBe(409);
        expect(await resetTokenCount(w.users.greg.id)).toBe(0);

        // Sarah's login only has access here, so her Owner can still help her back in.
        expect((await request(app).post(`/api/branch-admins/${w.users.sarah.id}/reset-password-link`).set(bearer(w.tokens.owner))).status).toBe(200);
    });
});

describe('removing portal access only ends portal access', () => {
    it("does not sign out the same login's Branch Admin sessions", async () => {
        const sarahAsWorker = await createWorker(w.abc.id, w.abc.melbourne, 'Sarah Casual');
        await linkEmployeeLogin(sarahAsWorker, w.users.sarah.id);
        expect((await request(app).delete(`/api/employee-accounts/${sarahAsWorker}`).set(bearer(w.tokens.owner))).status).toBe(200);
        expect((await request(app).get('/api/auth/me').set(bearer(w.tokens.sarah))).status).toBe(200);
    });

    it('does sign out an employee-only login', async () => {
        expect((await request(app).delete(`/api/employee-accounts/${w.workers.mel}`).set(bearer(w.tokens.owner))).status).toBe(200);
        expect((await request(app).get('/api/auth/me').set(bearer(w.tokens.melEmployee))).status).toBe(401);
    });
});

describe('accepting an invitation is not a password oracle', () => {
    it('wrong passwords count against the account like sign-in does, whatever email the body claims', async () => {
        // A Branch Admin points a worker at the Owner's email and invites them, holding the link.
        const worker = await createWorker(w.abc.id, w.abc.melbourne, 'Decoy');
        await sql('UPDATE employees SET email = $1 WHERE id = $2', [w.users.owner.email, worker]);
        await request(app).post(`/api/employee-accounts/${worker}/invitations`).set(bearer(w.tokens.sarah));
        const mail = [...getTestOutbox()].reverse().find(m => m.to === w.users.owner.email)!;
        const token = /token=([a-f0-9]{64})/.exec(mail.text || '')![1];

        for (let i = 0; i < 5; i++) {
            const res = await request(app).post('/api/employee-accounts/invitations/accept')
                .send({ token, password: `Guess${i}xyz1`, email: `rotate-${i}@example.test` });
            expect(res.status).toBe(401);
        }
        // Even the right password is now refused, and so is the sign-in page itself.
        const sixth = await request(app).post('/api/employee-accounts/invitations/accept').send({ token, password: PASSWORD, email: 'rotate-6@example.test' });
        expect(sixth.status).toBe(429);
        const login = await request(app).post('/api/auth/login').send({ email: w.users.owner.email, password: PASSWORD, organisation_slug: w.abc.portalSlug });
        expect(login.status).toBe(429);
        expect((await sql('SELECT user_id FROM employees WHERE id = $1', [worker])).rows[0].user_id).toBeNull();
    });
});

describe('leave requests follow the worker', () => {
    it('after a worker moves branch, the old branch admin no longer sees their requests and the new one does', async () => {
        await request(app).post('/api/portal/leave-requests').set(bearer(w.tokens.melEmployee))
            .send({ leave_type: 'Sick', start_date: '2026-04-06', end_date: '2026-04-06', hours: 7.6, reason: 'medical' });
        await request(app).put(`/api/employees/${w.workers.mel}`).set(bearer(w.tokens.owner)).send({ full_name: 'Mel Worker', location_id: w.abc.geelong });

        const sarahView = await request(app).get('/api/leave-requests').set(bearer(w.tokens.sarah));
        expect(sarahView.body.data).toEqual([]);
        const gregView = await request(app).get('/api/leave-requests').set(bearer(w.tokens.greg));
        expect(gregView.body.data.map((r: any) => [r.employee_name, r.location_name])).toEqual([['Mel Worker', 'Geelong']]);
    });
});
