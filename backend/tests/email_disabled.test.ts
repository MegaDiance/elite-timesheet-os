/**
 * "Email is off for the MVP" (EMAIL_ENABLED=false): every flow that would otherwise email
 * something falls back to a no-email alternative, or fails clearly — and the app never says an
 * email was sent when it wasn't. Real PostgreSQL, real sessions.
 */
import request from 'supertest';
import crypto from 'crypto';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { getTestOutbox, clearTestOutbox, isEmailSendingEnabled } from '../src/services/emailService';
import { connectTestDb, resetTestDb, closeTestDb, sql } from './helpers/testDb';
import { PASSWORD, World, bearer, buildWorld } from './helpers/fixtures';

const tokenFrom = (link: string) => /token=([a-f0-9]{64})/.exec(link)?.[1] as string;

let w: World;
let savedEmailEnabled: string | undefined;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    clearTestOutbox();
    w = await buildWorld();
    savedEmailEnabled = process.env.EMAIL_ENABLED;
    process.env.EMAIL_ENABLED = 'false';
});
afterEach(() => {
    if (savedEmailEnabled === undefined) delete process.env.EMAIL_ENABLED;
    else process.env.EMAIL_ENABLED = savedEmailEnabled;
});

it('the switch itself reports off, and the mail infrastructure still exists to turn back on', () => {
    expect(isEmailSendingEnabled()).toBe(false);
    process.env.EMAIL_ENABLED = 'true';
    expect(isEmailSendingEnabled()).toBe(true);
    process.env.EMAIL_ENABLED = 'false';
});

describe('Branch Admin invitations', () => {
    it('a new invitation returns a copyable link instead of emailing it, and no email is sent', async () => {
        const res = await request(app).post('/api/branch-admins/invitations').set(bearer(w.tokens.owner))
            .send({ email: 'newadmin@abc.test', location_ids: [w.abc.melbourne] });
        expect(res.status).toBe(201);
        expect(res.body.data.delivery_status).toBe('link');
        expect(res.body.data.invite_link).toMatch(/\/accept-invite\?token=[a-f0-9]{64}/);
        expect(res.body.message).not.toMatch(/sent/i);
        expect(getTestOutbox()).toHaveLength(0);

        // The link actually works.
        const token = tokenFrom(res.body.data.invite_link);
        const accept = await request(app).post('/api/branch-admins/invitations/accept').send({ token, password: 'Newcomer123' });
        expect(accept.status).toBe(200);
    });

    it('resend rotates the token and returns the new link the same way', async () => {
        const created = await request(app).post('/api/branch-admins/invitations').set(bearer(w.tokens.owner))
            .send({ email: 'newadmin@abc.test', location_ids: [w.abc.melbourne] });
        const firstToken = tokenFrom(created.body.data.invite_link);
        const id = (await sql('SELECT id FROM branch_admin_invitations WHERE email = $1', ['newadmin@abc.test'])).rows[0].id;

        const resent = await request(app).post(`/api/branch-admins/invitations/${id}/resend`).set(bearer(w.tokens.owner));
        expect(resent.body.data.delivery_status).toBe('link');
        const secondToken = tokenFrom(resent.body.data.invite_link);
        expect(secondToken).not.toBe(firstToken);
        expect(getTestOutbox()).toHaveLength(0);

        expect((await request(app).post('/api/branch-admins/invitations/accept').send({ token: firstToken, password: 'Newcomer123' })).status).toBe(400);
        expect((await request(app).post('/api/branch-admins/invitations/accept').send({ token: secondToken, password: 'Newcomer123' })).status).toBe(200);
    });

    it('the invite link never appears on any other endpoint, only on the request/resend response', async () => {
        await request(app).post('/api/branch-admins/invitations').set(bearer(w.tokens.owner))
            .send({ email: 'newadmin@abc.test', location_ids: [w.abc.melbourne] });
        const list = await request(app).get('/api/branch-admins').set(bearer(w.tokens.owner));
        expect(JSON.stringify(list.body)).not.toMatch(/token=/);
    });

    it('invitation actions are still audited while email is off', async () => {
        const res = await request(app).post('/api/branch-admins/invitations').set(bearer(w.tokens.owner))
            .send({ email: 'newadmin@abc.test', location_ids: [w.abc.melbourne] });
        const audit = await request(app).get('/api/audit').set(bearer(w.tokens.owner));
        const entry = audit.body.data.find((a: any) => a.action === 'BRANCH_ADMIN_INVITED');
        expect(entry).toBeTruthy();
        expect(JSON.stringify(entry)).not.toMatch(/token=/);
        expect(res.status).toBe(201);
    });
});

describe('Password reset', () => {
    it('self-service forgot-password gives a clear, honest, still-generic message and sends nothing', async () => {
        const known = await request(app).post('/api/auth/forgot-password').send({ email: w.users.sarah.email });
        const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@abc.test' });
        expect(known.body).toEqual(unknown.body); // still reveals nothing about which accounts exist
        expect(known.body.message).toMatch(/turned off/i);
        expect(known.body.message).not.toMatch(/sent/i);
        expect(getTestOutbox()).toHaveLength(0);
        expect((await sql('SELECT COUNT(*)::int AS n FROM reset_tokens')).rows[0].n).toBe(0);
    });

    it('the Owner can generate a reset link for a Branch Admin and hand it over directly', async () => {
        const res = await request(app).post(`/api/branch-admins/${w.users.sarah.id}/reset-password-link`).set(bearer(w.tokens.owner));
        expect(res.status).toBe(200);
        expect(res.body.data.reset_link).toMatch(/\/reset-password\?token=[a-f0-9]{64}/);
        expect(getTestOutbox()).toHaveLength(0);

        const token = tokenFrom(res.body.data.reset_link);
        const reset = await request(app).post('/api/auth/reset-password').send({ token, password: 'BrandNew123' });
        expect(reset.status).toBe(200);
        expect((await request(app).post('/api/auth/login').send({ email: w.users.sarah.email, password: 'BrandNew123', organisation_slug: w.abc.portalSlug })).status).toBe(200);

        const audit = await request(app).get('/api/audit').set(bearer(w.tokens.owner));
        expect(audit.body.data.some((a: any) => a.action === 'BRANCH_ADMIN_PASSWORD_RESET_LINK_CREATED')).toBe(true);
    });

    it('a Branch Admin cannot generate a reset link (Owner only), and a non-admin id is refused', async () => {
        expect((await request(app).post(`/api/branch-admins/${w.users.owner.id}/reset-password-link`).set(bearer(w.tokens.sarah))).status).toBe(403);
        expect((await request(app).post(`/api/branch-admins/${crypto.randomUUID()}/reset-password-link`).set(bearer(w.tokens.owner))).status).toBe(404);
    });
});

describe('Sign-in stays possible while email is off', () => {
    it('an account with two-step verification enabled can still sign in (2FA is skipped, not blocking)', async () => {
        await sql('UPDATE users SET two_factor_enabled = true WHERE id = $1', [w.users.sarah.id]);
        const res = await request(app).post('/api/auth/login').send({ email: w.users.sarah.email, password: PASSWORD, organisation_slug: w.abc.portalSlug });
        expect(res.status).toBe(200);
        expect(res.body.data.token).toBeTruthy();
        expect(res.body.require_2fa).toBeFalsy();
        expect(getTestOutbox()).toHaveLength(0);
        const audit = await request(app).get('/api/audit').set(bearer(w.tokens.owner));
        expect(audit.body.data.some((a: any) => a.action === 'LOGIN_2FA_SKIPPED')).toBe(true);
    });

    it('a suspicious-login challenge is skipped rather than blocking sign-in', async () => {
        const res = await request(app).post('/api/auth/login').set('x-test-simulate-suspicious', 'true')
            .send({ email: w.users.owner.email, password: PASSWORD, organisation_slug: w.abc.portalSlug });
        expect(res.status).toBe(200);
        expect(res.body.data?.token).toBeTruthy();
        expect(res.body.require_login_verification).toBeFalsy();
        expect(getTestOutbox()).toHaveLength(0);
        const audit = await request(app).get('/api/audit').set(bearer(w.tokens.owner));
        expect(audit.body.data.some((a: any) => a.action === 'LOGIN_SUSPICIOUS_CHALLENGE_SKIPPED')).toBe(true);
    });

    it('enabling two-step verification is refused outright, with a clear reason, rather than silently failing', async () => {
        const res = await request(app).post('/api/auth/2fa/send-setup-code').set(bearer(w.tokens.owner));
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe('EMAIL_DISABLED');
        expect(res.body.error.message).toMatch(/turned off/i);
    });
});

describe('Organisation sign-up', () => {
    it('is refused clearly rather than silently accepted with no way to complete it', async () => {
        const res = await request(app).post('/api/signup/request').send({ email: 'newowner@example.test' });
        expect(res.status).toBe(503);
        expect(getTestOutbox()).toHaveLength(0);
    });
});
