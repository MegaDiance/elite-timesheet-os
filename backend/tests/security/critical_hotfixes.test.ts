/**
 * Regression tests for the four critical findings (C1–C4) of the 2026-09-21 security audit,
 * re-stated for the two-role model.
 *
 *   C1  Only the Organisation Owner creates privileged accounts; no endpoint accepts a role.
 *   C2  Possessing an invitation token never authenticates anyone.
 *   C3  Login verification is bound to one challenge; a bare code authenticates nobody.
 *   C4  Email is never rerouted and fails closed.
 */
import request from 'supertest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import app from '../../src/index';
import { clearAllRateLimits } from '../../src/services/authUtils';
import { sendTransactionalEmail, getTestOutbox, clearTestOutbox, isEmailDeliveryConfigured } from '../../src/services/emailService';
import { connectTestDb, resetTestDb, closeTestDb, sql } from '../helpers/testDb';
import { PASSWORD, World, bearer, buildWorld } from '../helpers/fixtures';

function lastEmailTo(address: string) {
    const mail = [...getTestOutbox()].reverse().find(m => m.to === address);
    if (!mail) throw new Error(`no email to ${address}`);
    return mail;
}
const tokenFrom = (text: string) => /token=([a-f0-9]{64})/.exec(text)?.[1] as string;

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    clearTestOutbox();
    w = await buildWorld();
});

describe('C1: only the Organisation Owner creates privileged accounts', () => {
    it('creating a worker never creates an account, whatever role fields are sent', async () => {
        const users = (await sql('SELECT COUNT(*)::int AS n FROM users')).rows[0].n;
        const res = await request(app).post('/api/employees').set(bearer(w.tokens.owner)).send({
            full_name: 'Worker Only', email: 'worker@abc.test', location_id: w.abc.melbourne,
            role: 'OWNER', user_id: w.users.greg.id, password: 'Password123',
        });
        expect(res.status).toBe(201);
        expect((await sql('SELECT COUNT(*)::int AS n FROM users')).rows[0].n).toBe(users);
        expect(await sql('SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name IN ($2, $3)', ['employees', 'user_id', 'role'])).toMatchObject({ rows: [] });
    });

    it('a Branch Admin cannot invite, assign or remove Branch Admins', async () => {
        const invite = await request(app).post('/api/branch-admins/invitations').set(bearer(w.tokens.sarah)).send({ email: 'friend@abc.test', location_ids: [w.abc.melbourne] });
        const assign = await request(app).put(`/api/branch-admins/${w.users.sarah.id}/branches`).set(bearer(w.tokens.sarah)).send({ location_ids: [w.abc.melbourne, w.abc.richmond, w.abc.geelong] });
        const remove = await request(app).delete(`/api/branch-admins/${w.users.greg.id}`).set(bearer(w.tokens.sarah));
        expect([invite.status, assign.status, remove.status]).toEqual([403, 403, 403]);
        expect((await sql('SELECT COUNT(*)::int AS n FROM branch_admin_invitations')).rows[0].n).toBe(0);
        expect((await sql('SELECT COUNT(*)::int AS n FROM branch_admins WHERE user_id = $1', [w.users.sarah.id])).rows[0].n).toBe(2);
    });

    it('a Branch Admin cannot take or give ownership', async () => {
        const res = await request(app).post('/api/organisation/transfer-ownership').set(bearer(w.tokens.sarah)).send({ user_id: w.users.sarah.id, current_password: PASSWORD });
        expect(res.status).toBe(403);
        expect((await sql('SELECT owner_user_id FROM organisations WHERE id = $1', [w.abc.id])).rows[0].owner_user_id).toBe(w.users.owner.id);
    });

    it('the database refuses an active organisation without an owner, and deleting the owner', async () => {
        await expect(sql('UPDATE organisations SET owner_user_id = NULL WHERE id = $1', [w.abc.id])).rejects.toThrow(/organisations_active_has_owner/);
        await expect(sql('DELETE FROM users WHERE id = $1', [w.users.owner.id])).rejects.toThrow(/organisations_owner_user_id_fkey/);
    });

    it('there is no platform-wide account or console', async () => {
        expect((await request(app).post('/api/auth/platform-login').send({ email: 'a@b.test', password: 'x' })).status).toBe(404);
        expect((await request(app).get('/api/platform/organisations').set(bearer(w.tokens.owner))).status).toBe(404);
    });
});

describe('C2: an invitation token never authenticates anyone', () => {
    async function invite(email: string) {
        const res = await request(app).post('/api/branch-admins/invitations').set(bearer(w.tokens.owner)).send({ email, location_ids: [w.abc.melbourne] });
        expect(res.status).toBe(201);
        expect(JSON.stringify(res.body)).not.toMatch(/[a-f0-9]{64}/);
        return tokenFrom(lastEmailTo(email).text || '');
    }

    it('only the SHA-256 hash of the token is stored', async () => {
        const token = await invite('new@abc.test');
        const stored = (await sql('SELECT token_hash FROM branch_admin_invitations')).rows[0].token_hash;
        expect(stored).toBe(crypto.createHash('sha256').update(token).digest('hex'));
        expect(stored).not.toBe(token);
    });

    it('existing account: the invitation is refused without that account’s password and attaches nothing', async () => {
        const token = await invite(w.users.xavier.email);
        const res = await request(app).post('/api/branch-admins/invitations/accept').send({ token, password: 'WrongPassword1' });
        expect(res.status).toBe(401);
        expect(JSON.stringify(res.body)).not.toMatch(/eyJ/); // no JWT of any kind
        expect((await sql('SELECT COUNT(*)::int AS n FROM branch_admins WHERE user_id = $1', [w.users.xavier.id])).rows[0].n).toBe(0);
    });

    it('existing account: the right password attaches the branch once and still issues no session', async () => {
        const token = await invite(w.users.xavier.email);
        const ok = await request(app).post('/api/branch-admins/invitations/accept').send({ token, password: PASSWORD });
        expect(ok.status).toBe(200);
        expect(ok.body.data.token).toBeUndefined();
        expect(ok.body.data.login_path).toBe(`/login/${w.abc.portalSlug}`);
        expect((await sql('SELECT location_id FROM branch_admins WHERE user_id = $1 AND org_id = $2', [w.users.xavier.id, w.abc.id])).rows).toEqual([{ location_id: w.abc.melbourne }]);
        const replay = await request(app).post('/api/branch-admins/invitations/accept').send({ token, password: PASSWORD });
        expect(replay.status).toBe(400);
    });

    it('new account: sets a password, grants exactly the invited branch, issues no session', async () => {
        const token = await invite('newcomer@abc.test');
        const res = await request(app).post('/api/branch-admins/invitations/accept').send({ token, password: 'Newcomer123', full_name: 'New Comer' });
        expect(res.status).toBe(200);
        expect(res.body.data.token).toBeUndefined();
        const rows = await sql('SELECT ba.location_id FROM branch_admins ba JOIN users u ON u.id = ba.user_id WHERE u.email = $1', ['newcomer@abc.test']);
        expect(rows.rows).toEqual([{ location_id: w.abc.melbourne }]);
    });

    it('the stored hash, an expired, a revoked or a replaced token are all refused', async () => {
        const token = await invite('a@abc.test');
        const hash = crypto.createHash('sha256').update(token).digest('hex');
        expect((await request(app).post('/api/branch-admins/invitations/accept').send({ token: hash, password: 'Newcomer123' })).status).toBe(400);

        await sql("UPDATE branch_admin_invitations SET expires_at = NOW() - INTERVAL '1 minute'");
        expect((await request(app).post('/api/branch-admins/invitations/accept').send({ token, password: 'Newcomer123' })).status).toBe(400);

        const second = await invite('b@abc.test');
        const id = (await sql('SELECT id FROM branch_admin_invitations WHERE email = $1', ['b@abc.test'])).rows[0].id;
        await request(app).delete(`/api/branch-admins/invitations/${id}`).set(bearer(w.tokens.owner));
        expect((await request(app).post('/api/branch-admins/invitations/accept').send({ token: second, password: 'Newcomer123' })).status).toBe(400);

        const third = await invite('c@abc.test');
        const cId = (await sql('SELECT id FROM branch_admin_invitations WHERE email = $1', ['c@abc.test'])).rows[0].id;
        await request(app).post(`/api/branch-admins/invitations/${cId}/resend`).set(bearer(w.tokens.owner));
        expect((await request(app).post('/api/branch-admins/invitations/accept').send({ token: third, password: 'Newcomer123' })).status).toBe(400);
        const rotated = tokenFrom(lastEmailTo('c@abc.test').text || '');
        expect((await request(app).post('/api/branch-admins/invitations/accept').send({ token: rotated, password: 'Newcomer123' })).status).toBe(200);
    });
});

describe('C3: login verification is bound to one challenge', () => {
    async function startChallenge(email: string) {
        const res = await request(app).post('/api/auth/login').set('x-test-simulate-suspicious', 'true')
            .send({ email, password: PASSWORD, organisation_slug: w.abc.portalSlug });
        expect(res.status).toBe(200);
        expect(res.body.require_login_verification).toBe(true);
        expect(res.body.data?.token).toBeUndefined();
        const mail = lastEmailTo(email);
        return {
            challengeId: res.body.challenge_id as string,
            code: /\b(\d{6})\b/.exec(mail.text || '')![1],
            linkToken: tokenFrom(mail.text || ''),
        };
    }

    it('rejects a bare code, and email + code', async () => {
        const { code } = await startChallenge(w.users.sarah.email);
        expect((await request(app).post('/api/auth/verify-login').send({ code })).status).toBe(400);
        expect((await request(app).post('/api/auth/verify-login').send({ email: w.users.sarah.email, code })).status).toBe(400);
    });

    it("one account's code cannot complete another account's challenge", async () => {
        const sarah = await startChallenge(w.users.sarah.email);
        clearAllRateLimits();
        const greg = await startChallenge(w.users.greg.email);
        if (sarah.code === greg.code) return; // 1-in-900000 collision: nothing to assert
        const res = await request(app).post('/api/auth/verify-login').send({ challenge_id: greg.challengeId, code: sarah.code });
        expect(res.status).toBe(400);
        expect(res.body.data?.token).toBeUndefined();
    });

    it('accepts challenge_id + code once, then rejects replay; the session is for the challenged organisation', async () => {
        const { challengeId, code } = await startChallenge(w.users.sarah.email);
        const ok = await request(app).post('/api/auth/verify-login').send({ challenge_id: challengeId, code });
        expect(ok.status).toBe(200);
        expect(ok.body.data.organisation.id).toBe(w.abc.id);
        expect(ok.body.data.role).toBe('BRANCH_ADMIN');
        expect((await request(app).post('/api/auth/verify-login').send({ challenge_id: challengeId, code })).status).toBe(400);
    });

    it('accepts the emailed link token', async () => {
        const { linkToken } = await startChallenge(w.users.sarah.email);
        const ok = await request(app).post('/api/auth/verify-login').send({ token: linkToken });
        expect(ok.status).toBe(200);
        expect(ok.body.data.token).toBeTruthy();
    });

    it('locks the challenge after 5 wrong codes', async () => {
        const { challengeId, code } = await startChallenge(w.users.sarah.email);
        const wrong = code === '111111' ? '222222' : '111111';
        let last: request.Response | undefined;
        for (let i = 0; i < 5; i++) {
            clearAllRateLimits();
            last = await request(app).post('/api/auth/verify-login').send({ challenge_id: challengeId, code: wrong });
        }
        expect(last!.status).toBe(429);
        clearAllRateLimits();
        expect((await request(app).post('/api/auth/verify-login').send({ challenge_id: challengeId, code })).status).toBe(400);
    });

    it('does not skip two-factor authentication', async () => {
        await sql('UPDATE users SET two_factor_enabled = true WHERE id = $1', [w.users.sarah.id]);
        const { challengeId, code } = await startChallenge(w.users.sarah.email);
        const res = await request(app).post('/api/auth/verify-login').send({ challenge_id: challengeId, code });
        expect(res.status).toBe(200);
        expect(res.body.require_2fa).toBe(true);
        expect(res.body.data?.token).toBeUndefined();
    });

    it('a challenge is refused once the account has lost access to the organisation', async () => {
        const { challengeId, code } = await startChallenge(w.users.greg.email);
        await sql('DELETE FROM branch_admins WHERE user_id = $1', [w.users.greg.id]);
        const res = await request(app).post('/api/auth/verify-login').send({ challenge_id: challengeId, code });
        expect(res.status).toBe(400);
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

describe('C4: email is never rerouted and fails closed', () => {
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

    it('a provider 403 fails the send without a second attempt and without reading addresses from the response', async () => {
        process.env.EMAIL_PROVIDER = 'resend';
        process.env.RESEND_API_KEY = 're_test_fake';
        const fetchMock = jest.fn().mockResolvedValue({
            ok: false, status: 403,
            json: async () => ({ message: 'You can only send testing emails to your own email address (attacker@evil.test).' }),
        });
        global.fetch = fetchMock as any;
        const result = await sendTransactionalEmail({ to: 'admin@acme.test', subject: 'Reset', html: '<p>link</p>' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('PROVIDER_REJECTED');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toBe('admin@acme.test');
        expect(JSON.stringify(result)).not.toMatch(/attacker|evil/);
    });

    it('a network error fails with a generic code', async () => {
        process.env.EMAIL_PROVIDER = 'resend';
        process.env.RESEND_API_KEY = 're_test_fake';
        global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET secret-internal-detail')) as any;
        expect(await sendTransactionalEmail({ to: 'a@acme.test', subject: 'x', html: 'x' })).toEqual({ success: false, provider: 'resend', error: 'NETWORK_ERROR' });
    });

    it('production with no provider, or with the mock provider, refuses to send', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.EMAIL_PROVIDER;
        delete process.env.RESEND_API_KEY;
        delete process.env.POSTMARK_SERVER_TOKEN;
        expect(isEmailDeliveryConfigured()).toBe(false);
        expect((await sendTransactionalEmail({ to: 'a@acme.test', subject: 'x', html: 'x' })).error).toBe('NOT_CONFIGURED');
        process.env.EMAIL_PROVIDER = 'mock';
        expect((await sendTransactionalEmail({ to: 'a@acme.test', subject: 'x', html: 'x' })).success).toBe(false);
    });

    it('a 2FA login returns 503 (never a token) when the code email cannot be sent', async () => {
        await sql('UPDATE users SET two_factor_enabled = true WHERE id = $1', [w.users.owner.id]);
        process.env.EMAIL_PROVIDER = 'resend';
        process.env.RESEND_API_KEY = 're_test_fake';
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }) as any;
        const res = await request(app).post('/api/auth/login').send({ email: w.users.owner.email, password: PASSWORD, organisation_slug: w.abc.portalSlug });
        expect(res.status).toBe(503);
        expect(res.body.temp_token).toBeUndefined();
        expect(res.body.data?.token).toBeUndefined();
    });

    it('email links use the configured public URL, never the request Origin', async () => {
        process.env.PUBLIC_URL = 'https://app.simplehours.test';
        // Passed the old `startsWith('http://localhost:')` CORS check; the link must still ignore it.
        const sent = await request(app).post('/api/auth/forgot-password').set('Origin', 'http://localhost:1@evil.test').send({ email: w.users.owner.email });
        expect(sent.status).toBe(200);
        expect(sent.headers['access-control-allow-origin']).toBeUndefined();
        const mail = lastEmailTo(w.users.owner.email);
        expect(mail.text).toContain('https://app.simplehours.test/reset-password?token=');
        expect(mail.text).not.toContain('evil.test');
    });
});

describe('Invited emails that already own the organisation', () => {
    it('the owner cannot invite themselves as a Branch Admin', async () => {
        const res = await request(app).post('/api/branch-admins/invitations').set(bearer(w.tokens.owner)).send({ email: w.users.owner.email, location_ids: [w.abc.melbourne] });
        expect(res.status).toBe(400);
    });

    it('an existing Branch Admin is changed through assignments, not a second invitation', async () => {
        const res = await request(app).post('/api/branch-admins/invitations').set(bearer(w.tokens.owner)).send({ email: w.users.sarah.email, location_ids: [w.abc.geelong] });
        expect(res.status).toBe(409);
    });
});
