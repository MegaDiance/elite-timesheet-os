/**
 * Authentication: login through the private organisation link, generic failures, organisation
 * choice, two-step verification, sessions, password reset. Real PostgreSQL, real sessions.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { getTestOutbox, clearTestOutbox } from '../src/services/emailService';
import { connectTestDb, resetTestDb, closeTestDb, sql } from './helpers/testDb';
import { PASSWORD, World, bearer, buildWorld, createUser } from './helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    clearTestOutbox();
    w = await buildWorld();
});

/** Signs in through ABC Health's portal link unless `extra` names another (or no) organisation. */
const login = (email: string, password = PASSWORD, extra: object = { organisation_slug: w.abc.portalSlug }) =>
    request(app).post('/api/auth/login').send({ email, password, ...extra });
const lastMailTo = (to: string) => [...getTestOutbox()].reverse().find(m => m.to === to)!;

describe('login', () => {
    it('the Owner signs in through the private link and gets OWNER over every branch', async () => {
        const res = await login(w.users.owner.email, PASSWORD, { organisation_slug: w.abc.portalSlug });
        expect(res.status).toBe(200);
        expect(res.body.data.role).toBe('OWNER');
        expect(res.body.data.branches.map((b: any) => b.name).sort()).toEqual(['Geelong', 'Melbourne', 'Richmond']);
    });

    it('a Branch Admin gets BRANCH_ADMIN over their assigned branches only', async () => {
        const res = await login(w.users.sarah.email, PASSWORD, { organisation_slug: w.abc.portalSlug });
        expect(res.body.data.role).toBe('BRANCH_ADMIN');
        expect(res.body.data.branches.map((b: any) => b.name).sort()).toEqual(['Melbourne', 'Richmond']);
        expect(res.body.data.permissions).not.toContain('branch_admins.manage');
    });

    it('the token carries identity only: no role, organisation or branch', async () => {
        const res = await login(w.users.owner.email, PASSWORD, { organisation_slug: w.abc.portalSlug });
        const claims = jwt.decode(res.body.data.token) as any;
        expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'sid', 'sub']);
    });

    it('wrong password, unknown email, no access to that organisation and an unknown link all look the same', async () => {
        const responses = [
            await login(w.users.owner.email, 'WrongPassword1', { organisation_slug: w.abc.portalSlug }),
            await login('nobody@abc.test', PASSWORD, { organisation_slug: w.abc.portalSlug }),
            await login(w.users.xavier.email, PASSWORD, { organisation_slug: w.abc.portalSlug }),
            await login(w.users.owner.email, PASSWORD, { organisation_slug: 'not-a-real-link' }),
        ];
        for (const res of responses) {
            expect(res.status).toBe(401);
            expect(res.body).toEqual({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } });
        }
    });

    it('an account with no organisation access, or a deactivated account, cannot sign in', async () => {
        await createUser('orphan@abc.test');
        expect((await login('orphan@abc.test')).status).toBe(401);
        await sql('UPDATE users SET is_active = false WHERE id = $1', [w.users.sarah.id]);
        expect((await login(w.users.sarah.email)).status).toBe(401);
    });

    it('there is no generic sign-in: without a portal link the login is refused, and no organisation is listed', async () => {
        const noSlug = await login(w.users.owner.email, PASSWORD, {});
        expect(noSlug.status).toBe(400);
        expect(noSlug.body.error.code).toBe('ORGANISATION_PORTAL_REQUIRED');
        expect(noSlug.body.organisations).toBeUndefined();
        expect(noSlug.body.data).toBeUndefined();

        // Naming the organisation by id (the old picker's request) is not a way in either.
        const byId = await login(w.users.owner.email, PASSWORD, { organisation_id: w.abc.id });
        expect(byId.status).toBe(400);
        expect(byId.body.error.code).toBe('ORGANISATION_PORTAL_REQUIRED');

        // The same answer for an unknown email, so it reveals nothing about accounts.
        const unknown = await login('nobody@abc.test', PASSWORD, {});
        expect(unknown.status).toBe(400);
        expect(unknown.body).toEqual(noSlug.body);
    });

    it('someone with access to two organisations signs in to whichever portal link they use', async () => {
        await sql('INSERT INTO branch_admins (org_id, location_id, user_id) VALUES ($1, $2, $3)', [w.xyz.id, w.xyz.sydney, w.users.greg.id]);
        const abc = await login(w.users.greg.email, PASSWORD, { organisation_slug: w.abc.portalSlug });
        expect(abc.body.data.organisation.name).toBe('ABC Health');
        const xyz = await login(w.users.greg.email, PASSWORD, { organisation_slug: w.xyz.portalSlug });
        expect(xyz.body.data.organisation.name).toBe('XYZ Care');
        expect(xyz.body.require_organisation_selection).toBeUndefined();
    });

    it("another organisation's portal link never signs a user into it", async () => {
        // Sarah is a Branch Admin of ABC only; XYZ's real link must fail exactly like a wrong password.
        const res = await login(w.users.sarah.email, PASSWORD, { organisation_slug: w.xyz.portalSlug });
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('five failed attempts lock the email out for 15 minutes', async () => {
        for (let i = 0; i < 5; i++) await login(w.users.owner.email, 'WrongPassword1');
        expect((await login(w.users.owner.email)).status).toBe(429);
    });
});

describe('two-step verification', () => {
    it('requires the emailed code; the pending token cannot call the API', async () => {
        await sql('UPDATE users SET two_factor_enabled = true WHERE id = $1', [w.users.sarah.id]);
        const first = await login(w.users.sarah.email, PASSWORD, { organisation_slug: w.abc.portalSlug });
        expect(first.body.require_2fa).toBe(true);
        expect((await request(app).get('/api/auth/me').set(bearer(first.body.temp_token))).status).toBe(401);

        const code = /\b(\d{6})\b/.exec(lastMailTo(w.users.sarah.email).text || '')![1];
        const wrong = await request(app).post('/api/auth/verify-2fa').send({ temp_token: first.body.temp_token, code: code === '000000' ? '111111' : '000000' });
        expect(wrong.status).toBe(400);
        const ok = await request(app).post('/api/auth/verify-2fa').send({ temp_token: first.body.temp_token, code });
        expect(ok.status).toBe(200);
        expect(ok.body.data.role).toBe('BRANCH_ADMIN');
    });

    it('a code is refused once the account has lost access in between', async () => {
        await sql('UPDATE users SET two_factor_enabled = true WHERE id = $1', [w.users.greg.id]);
        const first = await login(w.users.greg.email, PASSWORD, { organisation_slug: w.abc.portalSlug });
        await sql('DELETE FROM branch_admins WHERE user_id = $1', [w.users.greg.id]);
        const code = /\b(\d{6})\b/.exec(lastMailTo(w.users.greg.email).text || '')![1];
        const res = await request(app).post('/api/auth/verify-2fa').send({ temp_token: first.body.temp_token, code });
        expect(res.status).toBe(401);
    });
});

describe('sessions', () => {
    it('sign-out revokes the server session', async () => {
        await request(app).post('/api/auth/logout').set(bearer(w.tokens.sarah));
        expect((await request(app).get('/api/auth/me').set(bearer(w.tokens.sarah))).status).toBe(401);
    });

    it('15 minutes of inactivity ends the session', async () => {
        const { sid } = jwt.decode(w.tokens.sarah) as any;
        await sql("UPDATE sessions SET last_active_at = NOW() - INTERVAL '16 minutes' WHERE id = $1", [sid]);
        const res = await request(app).get('/api/auth/me').set(bearer(w.tokens.sarah));
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('SESSION_EXPIRED');
    });

    it('switching organisation needs access there and replaces the session', async () => {
        expect((await request(app).post('/api/auth/switch-organisation').set(bearer(w.tokens.sarah)).send({ organisation_id: w.xyz.id })).status).toBe(403);
        await sql('INSERT INTO branch_admins (org_id, location_id, user_id) VALUES ($1, $2, $3)', [w.xyz.id, w.xyz.sydney, w.users.sarah.id]);
        const res = await request(app).post('/api/auth/switch-organisation').set(bearer(w.tokens.sarah)).send({ organisation_id: w.xyz.id });
        expect(res.status).toBe(200);
        expect(res.body.data.organisation.name).toBe('XYZ Care');
        expect((await request(app).get('/api/auth/me').set(bearer(w.tokens.sarah))).status).toBe(401);
    });

    it('you can revoke only your own sessions', async () => {
        const { sid } = jwt.decode(w.tokens.greg) as any;
        expect((await request(app).post('/api/auth/security/revoke-session').set(bearer(w.tokens.sarah)).send({ session_id: sid })).status).toBe(404);
        expect((await request(app).get('/api/auth/me').set(bearer(w.tokens.greg))).status).toBe(200);
    });
});

describe('password reset', () => {
    it('the emailed token works once, only as the raw token, and ends every session', async () => {
        const generic = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@abc.test' });
        const real = await request(app).post('/api/auth/forgot-password').send({ email: w.users.sarah.email });
        expect(generic.body).toEqual(real.body);

        const token = /token=([a-f0-9]{64})/.exec(lastMailTo(w.users.sarah.email).text || '')![1];
        const hash = crypto.createHash('sha256').update(token).digest('hex');
        expect((await request(app).post('/api/auth/reset-password').send({ token: hash, password: 'NewPassword1' })).status).toBe(400);
        expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'short' })).status).toBe(400);
        expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'NewPassword1' })).status).toBe(200);
        expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'NewPassword2' })).status).toBe(400);

        expect((await request(app).get('/api/auth/me').set(bearer(w.tokens.sarah))).status).toBe(401);
        expect((await login(w.users.sarah.email, 'NewPassword1', { organisation_slug: w.abc.portalSlug })).status).toBe(200);
    });

    const resetVia = async (email: string, organisation_slug?: string) => {
        await request(app).post('/api/auth/forgot-password').send({ email, ...(organisation_slug ? { organisation_slug } : {}) });
        const token = /token=([a-f0-9]{64})/.exec(lastMailTo(email).text || '')![1];
        return request(app).post('/api/auth/reset-password').send({ token, password: 'NewPassword1' });
    };

    it('a completed reset sends the user back to their own organisation portal, never a generic page', async () => {
        const res = await resetVia(w.users.sarah.email);
        expect(res.status).toBe(200);
        expect(res.body.data.login_path).toBe(`/login/${w.abc.portalSlug}`);
    });

    it('with two organisations, the portal the reset was requested from wins; a foreign portal is ignored', async () => {
        await sql('INSERT INTO branch_admins (org_id, location_id, user_id) VALUES ($1, $2, $3)', [w.xyz.id, w.xyz.sydney, w.users.greg.id]);
        expect((await resetVia(w.users.greg.email, w.xyz.portalSlug)).body.data.login_path).toBe(`/login/${w.xyz.portalSlug}`);
        // No portal context and two organisations: ambiguous, so nothing is listed or guessed.
        expect((await resetVia(w.users.greg.email)).body.data.login_path).toBeNull();
        // Sarah has no access to XYZ, so naming XYZ's portal cannot bind her reset to it.
        expect((await resetVia(w.users.sarah.email, w.xyz.portalSlug)).body.data.login_path).toBe(`/login/${w.abc.portalSlug}`);
    });
});

describe('private sign-in link', () => {
    it('the public lookup returns display fields only, and a regenerated link stops working', async () => {
        const res = await request(app).get(`/api/organisation/lookup/${w.abc.portalSlug}`);
        expect(res.body.data).toEqual({ name: 'ABC Health' });

        const regen = await request(app).post('/api/organisation/regenerate-portal-url').set(bearer(w.tokens.owner));
        expect((await request(app).get(`/api/organisation/lookup/${w.abc.portalSlug}`)).status).toBe(404);
        expect((await login(w.users.sarah.email, PASSWORD, { organisation_slug: w.abc.portalSlug })).status).toBe(401);
        expect((await login(w.users.sarah.email, PASSWORD, { organisation_slug: regen.body.data.portal_slug })).status).toBe(200);
    });

    it('only the Owner is shown the private link', async () => {
        const owner = await request(app).get('/api/organisation/me').set(bearer(w.tokens.owner));
        const admin = await request(app).get('/api/organisation/me').set(bearer(w.tokens.sarah));
        expect(owner.body.data.portal_slug).toBe(w.abc.portalSlug);
        expect(admin.body.data.portal_slug).toBeUndefined();
    });
});
