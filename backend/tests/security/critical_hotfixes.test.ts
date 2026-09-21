/**
 * Phase 3B regression tests for the four critical findings (C1-C4) in
 * docs/security/hierarchy-audit-and-design.md. Runs on real PostgreSQL.
 */
import request from 'supertest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import app from '../../src/index';
import { hashPassword } from '../../src/services/auth';
import { clearAllRateLimits } from '../../src/routes/auth';
import { sendTransactionalEmail, getTestOutbox, clearTestOutbox, isEmailDeliveryConfigured } from '../../src/services/emailService';
import { connectTestDb, resetTestDb, closeTestDb, sql } from '../helpers/testDb';

const PASSWORD = 'CorrectHorse9';

async function createOrg(name: string) {
    const id = crypto.randomUUID();
    await sql(`INSERT INTO organisations (id, name, slug, is_active) VALUES ($1, $2, $3, true)`, [id, name, `${name.toLowerCase().replace(/\W+/g, '-')}-${id.slice(0, 6)}`]);
    return id;
}

async function createUser(orgId: string | null, email: string, role: string, opts: { twoFactor?: boolean; memberRole?: string } = {}) {
    const id = crypto.randomUUID();
    await sql(
        `INSERT INTO users (id, org_id, email, password_hash, role, is_active, two_factor_enabled) VALUES ($1, $2, $3, $4, $5, true, $6)`,
        [id, orgId, email, await hashPassword(PASSWORD), role, Boolean(opts.twoFactor)]
    );
    if (orgId) {
        await sql(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ($1, $2, $3, $4)`, [crypto.randomUUID(), orgId, id, opts.memberRole || role]);
    }
    return id;
}

async function login(email: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    const req = request(app).post('/api/auth/login');
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    return req.send({ email, password: PASSWORD, ...extra });
}

async function sessionToken(email: string): Promise<string> {
    const res = await login(email);
    expect(res.status).toBe(200);
    expect(res.body.data?.token).toBeTruthy();
    return res.body.data.token;
}

function lastEmailTo(address: string) {
    const all = getTestOutbox().filter((m) => m.to === address);
    return all[all.length - 1];
}

beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    clearTestOutbox();
});

describe('C1: tenant users cannot create or promote Platform Admins', () => {
    let orgId: string;
    let ownerToken: string;

    beforeEach(async () => {
        orgId = await createOrg('Acme Health');
        await createUser(orgId, 'owner@acme.test', 'Company Admin');
        ownerToken = await sessionToken('owner@acme.test');
    });

    it('rejects role "Platform Admin" on employee create and writes no user', async () => {
        const res = await request(app)
            .post('/api/employees')
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ full_name: 'Mallory', email: 'mallory@acme.test', create_account: true, role: 'Platform Admin' });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_ROLE');
        const users = await sql(`SELECT 1 FROM users WHERE email = 'mallory@acme.test'`);
        expect(users.rows).toHaveLength(0);
        const admins = await sql(`SELECT 1 FROM users WHERE role = 'Platform Admin'`);
        expect(admins.rows).toHaveLength(0);
    });

    it('rejects arbitrary unknown role strings', async () => {
        const res = await request(app)
            .post('/api/employees')
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ full_name: 'Eve', email: 'eve@acme.test', create_account: true, role: 'platform admin ' });
        expect(res.status).toBe(400);
        expect((await sql(`SELECT 1 FROM users WHERE email = 'eve@acme.test'`)).rows).toHaveLength(0);
    });

    it('rejects "Platform Admin" when an existing employee is given a login via update', async () => {
        const empId = crypto.randomUUID();
        await sql(`INSERT INTO employees (id, org_id, full_name, email) VALUES ($1, $2, 'Trent', 'trent@acme.test')`, [empId, orgId]);
        const res = await request(app)
            .put(`/api/employees/${empId}`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ full_name: 'Trent', email: 'trent@acme.test', create_account: true, role: 'Platform Admin' });
        expect(res.status).toBe(400);
        expect((await sql(`SELECT 1 FROM users WHERE role = 'Platform Admin'`)).rows).toHaveLength(0);
    });

    it('still allows creating a normal employee login', async () => {
        const res = await request(app)
            .post('/api/employees')
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ full_name: 'Grace', email: 'grace@acme.test', create_account: true });
        expect(res.status).toBe(200);
        const u = await sql(`SELECT role FROM users WHERE email = 'grace@acme.test'`);
        expect(u.rows[0].role).toBe('Employee');
    });
});

describe('C2: accepting a branch invitation never authenticates by token possession', () => {
    let orgId: string;
    let locationId: string;
    let ownerToken: string;

    async function inviteAndGetToken(email: string, role = 'employee'): Promise<string> {
        const res = await request(app)
            .post(`/api/locations/${locationId}/invite`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ email, role });
        expect(res.status).toBe(200);
        // The API response must never carry the token or link.
        expect(JSON.stringify(res.body)).not.toMatch(/token=|"token"|invite_url/);
        const mail = lastEmailTo(email);
        expect(mail).toBeTruthy();
        const match = /token=([a-f0-9]{64})/.exec(mail.text || mail.html);
        expect(match).toBeTruthy();
        return match![1];
    }

    beforeEach(async () => {
        orgId = await createOrg('Branchy');
        const ownerId = await createUser(orgId, 'owner@branchy.test', 'Company Admin');
        await sql(`UPDATE organisations SET owner_user_id = $1 WHERE id = $2`, [ownerId, orgId]);
        locationId = crypto.randomUUID();
        await sql(`INSERT INTO locations (id, org_id, name) VALUES ($1, $2, 'Richmond')`, [locationId, orgId]);
        ownerToken = await sessionToken('owner@branchy.test');
    });

    it('existing account: unauthenticated accept is refused and returns no token', async () => {
        const otherOrg = await createOrg('Elsewhere');
        await createUser(otherOrg, 'victim@elsewhere.test', 'Company Admin');
        const token = await inviteAndGetToken('victim@elsewhere.test');

        const res = await request(app).post('/api/locations/invitations/accept').send({ token });
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('SIGN_IN_REQUIRED');
        expect(res.body.data?.token).toBeUndefined();
        const mem = await sql(`SELECT 1 FROM location_memberships WHERE location_id = $1`, [locationId]);
        expect(mem.rows).toHaveLength(0);
    });

    it('existing account: a password in the body is not accepted as authentication', async () => {
        const otherOrg = await createOrg('Elsewhere');
        await createUser(otherOrg, 'victim@elsewhere.test', 'Employee');
        const token = await inviteAndGetToken('victim@elsewhere.test');
        const res = await request(app).post('/api/locations/invitations/accept').send({ token, password: PASSWORD });
        expect(res.status).toBe(401);
    });

    it('existing account: signed in as a different user is refused', async () => {
        const otherOrg = await createOrg('Elsewhere');
        await createUser(otherOrg, 'victim@elsewhere.test', 'Employee');
        const token = await inviteAndGetToken('victim@elsewhere.test');
        const res = await request(app)
            .post('/api/locations/invitations/accept')
            .set('Authorization', `Bearer ${ownerToken}`)
            .send({ token });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('INVITATION_EMAIL_MISMATCH');
    });

    it('existing account: signed in as the invited user attaches the membership once', async () => {
        const otherOrg = await createOrg('Elsewhere');
        await createUser(otherOrg, 'sam@elsewhere.test', 'Employee');
        const token = await inviteAndGetToken('sam@elsewhere.test');
        const samToken = await sessionToken('sam@elsewhere.test');

        const res = await request(app)
            .post('/api/locations/invitations/accept')
            .set('Authorization', `Bearer ${samToken}`)
            .send({ token });
        expect(res.status).toBe(200);
        expect(res.body.data.token).toBeUndefined();

        const replay = await request(app)
            .post('/api/locations/invitations/accept')
            .set('Authorization', `Bearer ${samToken}`)
            .send({ token });
        expect(replay.status).toBe(400);
    });

    it('new account: sets a password but issues no login token', async () => {
        const token = await inviteAndGetToken('newbie@branchy.test');
        const res = await request(app).post('/api/locations/invitations/accept').send({ token, password: 'BrandNew123' });
        expect(res.status).toBe(200);
        expect(res.body.data.requires_sign_in).toBe(true);
        expect(JSON.stringify(res.body)).not.toMatch(/"token"/);
    });

    it('the stored hash is not accepted in place of the token', async () => {
        const token = await inviteAndGetToken('hashy@branchy.test');
        const hash = crypto.createHash('sha256').update(token).digest('hex');
        const res = await request(app).post('/api/locations/invitations/accept').send({ token: hash, password: 'BrandNew123' });
        expect(res.status).toBe(404);
    });
});

describe('C3: suspicious-login verification is bound to one challenge', () => {
    let orgId: string;

    async function startChallenge(email: string) {
        const res = await login(email, {}, { 'x-test-simulate-suspicious': 'true' });
        expect(res.status).toBe(200);
        expect(res.body.require_login_verification).toBe(true);
        expect(res.body.challenge_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(res.body.data?.token).toBeUndefined();
        const mail = lastEmailTo(email);
        const code = /\b(\d{6})\b/.exec(mail.text || '')?.[1];
        const linkToken = /token=([a-f0-9]{64})/.exec(mail.text || mail.html)?.[1];
        expect(code).toBeTruthy();
        expect(linkToken).toBeTruthy();
        return { challengeId: res.body.challenge_id as string, code: code!, linkToken: linkToken! };
    }

    beforeEach(async () => {
        orgId = await createOrg('Verify Co');
        await createUser(orgId, 'alice@verify.test', 'Employee');
        await createUser(orgId, 'bob@verify.test', 'Employee');
    });

    it('rejects a bare code with no challenge reference', async () => {
        const { code } = await startChallenge('alice@verify.test');
        const res = await request(app).post('/api/auth/verify-login').send({ code });
        expect(res.status).toBe(400);
        expect(res.body.data?.token).toBeUndefined();
    });

    it('rejects email + code (not bound to a challenge)', async () => {
        const { code } = await startChallenge('alice@verify.test');
        const res = await request(app).post('/api/auth/verify-login').send({ email: 'alice@verify.test', code });
        expect(res.status).toBe(400);
        expect(res.body.data?.token).toBeUndefined();
    });

    it("Alice's code cannot complete Bob's challenge", async () => {
        const alice = await startChallenge('alice@verify.test');
        clearAllRateLimits();
        const bob = await startChallenge('bob@verify.test');
        if (alice.code === bob.code) return; // 1-in-900000 collision: nothing to assert
        const res = await request(app).post('/api/auth/verify-login').send({ challenge_id: bob.challengeId, code: alice.code });
        expect(res.status).toBe(400);
        expect(res.body.data?.token).toBeUndefined();
    });

    it('accepts challenge_id + correct code once, then rejects replay', async () => {
        const { challengeId, code } = await startChallenge('alice@verify.test');
        const ok = await request(app).post('/api/auth/verify-login').send({ challenge_id: challengeId, code });
        expect(ok.status).toBe(200);
        expect(ok.body.data.token).toBeTruthy();
        const replay = await request(app).post('/api/auth/verify-login').send({ challenge_id: challengeId, code });
        expect(replay.status).toBe(400);
    });

    it('accepts the emailed link token', async () => {
        const { linkToken } = await startChallenge('alice@verify.test');
        const ok = await request(app).post('/api/auth/verify-login').send({ token: linkToken });
        expect(ok.status).toBe(200);
        expect(ok.body.data.token).toBeTruthy();
    });

    it('locks the challenge after 5 wrong codes', async () => {
        const { challengeId, code } = await startChallenge('alice@verify.test');
        const wrong = code === '111111' ? '222222' : '111111';
        let last: request.Response | undefined;
        for (let i = 0; i < 5; i++) {
            clearAllRateLimits();
            last = await request(app).post('/api/auth/verify-login').send({ challenge_id: challengeId, code: wrong });
        }
        expect(last!.status).toBe(429);
        clearAllRateLimits();
        const after = await request(app).post('/api/auth/verify-login').send({ challenge_id: challengeId, code });
        expect(after.status).toBe(400);
        expect(after.body.data?.token).toBeUndefined();
    });

    it('does not skip two-factor authentication', async () => {
        await createUser(orgId, 'carol@verify.test', 'Employee', { twoFactor: true });
        const { challengeId, code } = await startChallenge('carol@verify.test');
        const res = await request(app).post('/api/auth/verify-login').send({ challenge_id: challengeId, code });
        expect(res.status).toBe(200);
        expect(res.body.require_2fa).toBe(true);
        expect(res.body.temp_token).toBeTruthy();
        expect(res.body.data?.token).toBeUndefined();
    });

    it('ignores a spoofed X-Forwarded-For header for rate limiting', async () => {
        for (let i = 0; i < 5; i++) {
            await request(app).post('/api/auth/verify-login').set('X-Forwarded-For', `10.0.0.${i}`).send({ challenge_id: crypto.randomUUID(), code: '123456' });
        }
        const blocked = await request(app).post('/api/auth/verify-login').set('X-Forwarded-For', '10.0.0.99').send({ challenge_id: crypto.randomUUID(), code: '123456' });
        expect(blocked.status).toBe(429);
    });
});

describe('C4: email is never rerouted', () => {
    const saved = { ...process.env };
    const originalFetch = global.fetch;

    afterEach(() => {
        process.env = { ...saved };
        global.fetch = originalFetch;
    });

    it('source contains no hard-coded personal fallback recipient', () => {
        const src = fs.readFileSync(path.join(__dirname, '../../src/services/emailService.ts'), 'utf8');
        expect(src).not.toMatch(/@gmail\.com/i);
        expect(src).not.toMatch(/RESEND_TEST_RECIPIENT|reroute/i);
    });

    it('a Resend 403 fails the send without a second delivery attempt', async () => {
        process.env.EMAIL_PROVIDER = 'resend';
        process.env.RESEND_API_KEY = 're_test_fake';
        const fetchMock = jest.fn().mockResolvedValue({
            ok: false,
            status: 403,
            json: async () => ({ message: 'You can only send testing emails to your own email address (attacker@evil.test).' }),
        });
        global.fetch = fetchMock as any;

        const result = await sendTransactionalEmail({ to: 'employee@acme.test', subject: 'Reset', html: '<p>link</p>' });

        expect(result.success).toBe(false);
        expect(result.error).toBe('PROVIDER_REJECTED');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.to).toBe('employee@acme.test');
        expect(JSON.stringify(result)).not.toMatch(/attacker|evil/);
    });

    it('a network error fails with a generic code', async () => {
        process.env.EMAIL_PROVIDER = 'resend';
        process.env.RESEND_API_KEY = 're_test_fake';
        global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET secret-internal-detail')) as any;
        const result = await sendTransactionalEmail({ to: 'employee@acme.test', subject: 'x', html: 'x' });
        expect(result).toEqual({ success: false, provider: 'resend', error: 'NETWORK_ERROR' });
    });

    it('production with no provider configured refuses to send and reports not configured', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.EMAIL_PROVIDER;
        delete process.env.RESEND_API_KEY;
        delete process.env.POSTMARK_SERVER_TOKEN;
        expect(isEmailDeliveryConfigured()).toBe(false);
        const result = await sendTransactionalEmail({ to: 'a@acme.test', subject: 'x', html: 'x' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('NOT_CONFIGURED');
    });

    it('production refuses the mock transport even if requested', async () => {
        process.env.NODE_ENV = 'production';
        process.env.EMAIL_PROVIDER = 'mock';
        expect(isEmailDeliveryConfigured()).toBe(false);
        const result = await sendTransactionalEmail({ to: 'a@acme.test', subject: 'x', html: 'x' });
        expect(result.success).toBe(false);
    });

    it('login 2FA returns 503 (not a token) when the code email cannot be sent', async () => {
        const orgId = await createOrg('Mailless');
        await createUser(orgId, 'dana@mailless.test', 'Employee', { twoFactor: true });
        process.env.EMAIL_PROVIDER = 'resend';
        process.env.RESEND_API_KEY = 're_test_fake';
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }) as any;
        const res = await login('dana@mailless.test');
        expect(res.status).toBe(503);
        expect(res.body.temp_token).toBeUndefined();
        expect(res.body.data?.token).toBeUndefined();
    });
});
