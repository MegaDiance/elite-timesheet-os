/**
 * Employee portal accounts: invite, verify, accept, resend, revoke, reset-password-link, and
 * removing portal access — mirroring branchAdmins.ts's invitation flow (tests/accounts.test.ts,
 * tests/security/critical_hotfixes.test.ts C2) adapted for a worker-scoped login.
 */
import request from 'supertest';
import crypto from 'crypto';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { getTestOutbox, clearTestOutbox } from '../src/services/emailService';
import { connectTestDb, resetTestDb, closeTestDb, sql } from './helpers/testDb';
import { PASSWORD, World, bearer, buildWorld, createWorker } from './helpers/fixtures';

const tokenFrom = (text: string) => /token=([a-f0-9]{64})/.exec(text)?.[1] as string;
const lastEmailTo = (address: string) => [...getTestOutbox()].reverse().find(m => m.to === address)!;

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    clearTestOutbox();
    w = await buildWorld();
});

async function giveEmail(employeeId: string, email: string) {
    await sql('UPDATE employees SET email = $1 WHERE id = $2', [email, employeeId]);
}

async function invite(token: string, employeeId: string) {
    return request(app).post(`/api/employee-accounts/${employeeId}/invitations`).set(bearer(token)).send();
}

describe('inviting a worker to the portal', () => {
    // mel and rich already have portal access from buildWorld()'s employee persona (used by the
    // authorisation-matrix lockout tests), so invite-flow tests use gee, syd, or a freshly
    // created worker instead — none of which start out linked.

    it('an Owner can invite a worker with an email, and only the token hash is stored', async () => {
        await giveEmail(w.workers.gee, 'gee.new@abc.test');
        const res = await invite(w.tokens.owner, w.workers.gee);
        expect(res.status).toBe(201);
        expect(JSON.stringify(res.body)).not.toMatch(/[a-f0-9]{64}/);

        const token = tokenFrom(lastEmailTo('gee.new@abc.test').text || '');
        const stored = (await sql('SELECT token_hash FROM employee_invitations')).rows[0].token_hash;
        expect(stored).toBe(crypto.createHash('sha256').update(token).digest('hex'));
        expect(stored).not.toBe(token);
    });

    it('a Branch Admin can invite a worker in their own branch, but not in another branch or organisation', async () => {
        const newMelWorker = await createWorker(w.abc.id, w.abc.melbourne, 'New Mel Worker');
        await giveEmail(newMelWorker, 'newmel@abc.test');
        await giveEmail(w.workers.gee, 'gee.new@abc.test');
        await giveEmail(w.workers.syd, 'syd.new@xyz.test');
        expect((await invite(w.tokens.sarah, newMelWorker)).status).toBe(201); // Sarah manages Melbourne
        expect((await invite(w.tokens.sarah, w.workers.gee)).status).toBe(403); // Geelong is Greg's
        expect((await invite(w.tokens.sarah, w.workers.syd)).status).toBe(404); // another organisation
    });

    it('refuses a worker with no email, and a worker who already has portal access', async () => {
        const noEmail = await invite(w.tokens.owner, w.workers.gee);
        expect(noEmail.status).toBe(400);
        expect(noEmail.body.error.code).toBe('VALIDATION_FAILED');

        // mel already has portal access from buildWorld().
        const already = await invite(w.tokens.owner, w.workers.mel);
        expect(already.status).toBe(409);
        expect(already.body.error.code).toBe('ALREADY_LINKED');
    });

    it('a new invitation replaces (revokes) a previous open one for the same worker', async () => {
        await giveEmail(w.workers.gee, 'gee.new@abc.test');
        await invite(w.tokens.owner, w.workers.gee);
        const firstToken = tokenFrom(lastEmailTo('gee.new@abc.test').text || '');
        await invite(w.tokens.owner, w.workers.gee);
        const secondToken = tokenFrom(lastEmailTo('gee.new@abc.test').text || '');

        expect((await request(app).post('/api/employee-accounts/invitations/accept').send({ token: firstToken, password: 'GeeAccount123' })).status).toBe(400);
        expect((await request(app).post('/api/employee-accounts/invitations/accept').send({ token: secondToken, password: 'GeeAccount123' })).status).toBe(200);
    });
});

describe('accepting an invitation', () => {
    async function inviteAndGetToken(employeeId: string, email: string) {
        await giveEmail(employeeId, email);
        await invite(w.tokens.owner, employeeId);
        return tokenFrom(lastEmailTo(email).text || '');
    }

    it('GET verify reports the email, organisation and worker name without authenticating', async () => {
        const token = await inviteAndGetToken(w.workers.gee, 'gee.new@abc.test');
        const res = await request(app).get(`/api/employee-accounts/invitations/verify?token=${token}`);
        expect(res.body.data).toEqual({ email: 'gee.new@abc.test', organisation_name: 'ABC Health', employee_name: 'Gee Worker', account_exists: false });
    });

    it('new account: sets a password, links exactly this worker, and issues no session', async () => {
        const token = await inviteAndGetToken(w.workers.gee, 'gee.new@abc.test');
        const res = await request(app).post('/api/employee-accounts/invitations/accept').send({ token, password: 'GeeAccount123' });
        expect(res.status).toBe(200);
        expect(res.body.data.token).toBeUndefined();
        expect(res.body.data.login_path).toBe(`/login/${w.abc.portalSlug}`);
        expect((await sql('SELECT user_id FROM employees WHERE id = $1', [w.workers.gee])).rows[0].user_id).not.toBeNull();

        const login = await request(app).post('/api/auth/login').send({ email: 'gee.new@abc.test', password: 'GeeAccount123', organisation_slug: w.abc.portalSlug });
        expect(login.body.data.role).toBe('EMPLOYEE');
        expect(login.body.data.permissions).toEqual([]);
        expect(login.body.data.employee_capabilities).toEqual({ can_submit_timesheets: true });

        const replay = await request(app).post('/api/employee-accounts/invitations/accept').send({ token, password: 'GeeAccount123' });
        expect(replay.status).toBe(400);
    });

    it('existing account: the invitation is refused without that account’s password and links nothing', async () => {
        const token = await inviteAndGetToken(w.workers.gee, w.users.xavier.email);
        const res = await request(app).post('/api/employee-accounts/invitations/accept').send({ token, password: 'WrongPassword1' });
        expect(res.status).toBe(401);
        expect((await sql('SELECT user_id FROM employees WHERE id = $1', [w.workers.gee])).rows[0].user_id).toBeNull();
    });

    it('existing account: the right password links it, and account_exists is reported on verify', async () => {
        const token = await inviteAndGetToken(w.workers.gee, w.users.xavier.email);
        expect((await request(app).get(`/api/employee-accounts/invitations/verify?token=${token}`)).body.data.account_exists).toBe(true);

        const res = await request(app).post('/api/employee-accounts/invitations/accept').send({ token, password: PASSWORD });
        expect(res.status).toBe(200);
        expect((await sql('SELECT user_id FROM employees WHERE id = $1', [w.workers.gee])).rows[0].user_id).toBe(w.users.xavier.id);
    });

    it('an account already linked to a different worker cannot be linked again', async () => {
        // Mel's fixture user is already linked to the mel worker record by buildWorld().
        const token = await inviteAndGetToken(w.workers.gee, w.users.melEmployee.email);
        const res = await request(app).post('/api/employee-accounts/invitations/accept').send({ token, password: PASSWORD });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('ALREADY_LINKED');
    });

    it('an expired invitation is refused', async () => {
        const token = await inviteAndGetToken(w.workers.gee, 'gee.new@abc.test');
        await sql("UPDATE employee_invitations SET expires_at = NOW() - INTERVAL '1 minute'");
        const res = await request(app).post('/api/employee-accounts/invitations/accept').send({ token, password: 'GeeAccount123' });
        expect(res.status).toBe(400);
    });
});

describe('resend and revoke', () => {
    it('resend rotates the token; the old one stops working and the new one works', async () => {
        await giveEmail(w.workers.gee, 'gee.new@abc.test');
        await invite(w.tokens.owner, w.workers.gee);
        const firstToken = tokenFrom(lastEmailTo('gee.new@abc.test').text || '');

        const resent = await request(app).post(`/api/employee-accounts/${w.workers.gee}/invitations/resend`).set(bearer(w.tokens.owner));
        expect(resent.status).toBe(200);
        const secondToken = tokenFrom(lastEmailTo('gee.new@abc.test').text || '');
        expect(secondToken).not.toBe(firstToken);

        expect((await request(app).post('/api/employee-accounts/invitations/accept').send({ token: firstToken, password: 'GeeAccount123' })).status).toBe(400);
        expect((await request(app).post('/api/employee-accounts/invitations/accept').send({ token: secondToken, password: 'GeeAccount123' })).status).toBe(200);
    });

    it('revoking an open invitation makes its token unusable', async () => {
        await giveEmail(w.workers.gee, 'gee.new@abc.test');
        await invite(w.tokens.owner, w.workers.gee);
        const token = tokenFrom(lastEmailTo('gee.new@abc.test').text || '');

        expect((await request(app).delete(`/api/employee-accounts/${w.workers.gee}/invitations`).set(bearer(w.tokens.owner))).status).toBe(200);
        expect((await request(app).post('/api/employee-accounts/invitations/accept').send({ token, password: 'GeeAccount123' })).status).toBe(400);
    });
});

describe('reset-password-link and removing portal access', () => {
    it('generates a one-hour, single-use reset link for a linked employee', async () => {
        const res = await request(app).post(`/api/employee-accounts/${w.workers.mel}/reset-password-link`).set(bearer(w.tokens.owner));
        expect(res.status).toBe(200);
        expect(res.body.data.reset_link).toMatch(/\/reset-password\?token=[a-f0-9]{64}/);
    });

    it('refuses a reset link for a worker with no portal access yet', async () => {
        const res = await request(app).post(`/api/employee-accounts/${w.workers.gee}/reset-password-link`).set(bearer(w.tokens.owner));
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('NO_PORTAL_ACCESS');
    });

    it('removes portal access without touching the worker record, and signs out existing sessions', async () => {
        const before = await request(app).get('/api/auth/me').set(bearer(w.tokens.melEmployee));
        expect(before.status).toBe(200);

        const res = await request(app).delete(`/api/employee-accounts/${w.workers.mel}`).set(bearer(w.tokens.owner));
        expect(res.status).toBe(200);
        expect((await sql('SELECT user_id, full_name, is_active FROM employees WHERE id = $1', [w.workers.mel])).rows[0]).toEqual(
            { user_id: null, full_name: 'Mel Worker', is_active: true }
        );

        const after = await request(app).get('/api/auth/me').set(bearer(w.tokens.melEmployee));
        expect(after.status).toBe(401);
    });
});
