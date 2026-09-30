/**
 * Owner-only recovery of a lost private login link (POST /api/recovery/login-link).
 *
 *   organisation name + owner email + owner password → new private link (the old one is revoked)
 *
 * It is not a sign-in: no session is created, /login stays a 404, and no other role can use it.
 */
import crypto from 'crypto';
import request from 'supertest';
import app from '../../src/index';
import { clearAllRateLimits } from '../../src/services/authUtils';
import { resetRecoveryLimits } from '../../src/services/loginLinkRecovery';
import { currentPortalLink, resolvePortalToken, hashPortalToken } from '../../src/services/portalLink';
import { clearTestOutbox, getTestOutbox } from '../../src/services/emailService';
import { comparePassword } from '../../src/services/auth';
import { connectTestDb, resetTestDb, closeTestDb, sql } from '../helpers/testDb';
import { PASSWORD, World, assignRole, bearer, buildWorld, createBranch, createOrganisation, createRole, createUser, signIn } from '../helpers/fixtures';

// The comparison must always run, whether or not the organisation exists — counted here.
jest.mock('../../src/services/auth', () => {
    const actual = jest.requireActual('../../src/services/auth');
    return { ...actual, comparePassword: jest.fn(actual.comparePassword) };
});

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    resetRecoveryLimits();
    clearTestOutbox();
    w = await buildWorld();
});
afterEach(() => jest.restoreAllMocks());

const WRONG = 'Wrong12345';
const GENERIC = 'The details provided could not be verified. Check the organisation name, owner email, and password and try again.';

const recover = (body: Record<string, unknown>) => request(app).post('/api/recovery/login-link').send(body);
const owner = (over: Record<string, unknown> = {}) => ({ organisation_name: 'ABC Health', email: w.users.owner.email, password: PASSWORD, ...over });
const resetLimits = () => { clearAllRateLimits(); resetRecoveryLimits(); };
const currentToken = async (orgId: string) => (await currentPortalLink(orgId))!.token;

describe('successful recovery', () => {
    it('gives the owner a new private link and revokes the old one', async () => {
        const res = await recover(owner());
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');

        const { login_path, login_url } = res.body.data;
        expect(login_path).toMatch(/^\/login\/[0-9a-f]{32}$/);
        expect(login_url.endsWith(login_path)).toBe(true);
        const token = login_path.replace('/login/', '');
        expect(token).not.toBe(w.abc.portalSlug);

        expect(await resolvePortalToken(token)).toEqual({ status: 'valid', orgId: w.abc.id, name: 'ABC Health' });
        expect((await resolvePortalToken(w.abc.portalSlug)).status).toBe('invalid');
        expect((await request(app).get(login_path)).status).toBe(200);
        expect((await request(app).get(`/login/${w.abc.portalSlug}`)).status).toBe(404);
        expect(await currentToken(w.abc.id)).toBe(token);
    });

    it('exposes nothing beyond the link: no session, no ids, no other organisation', async () => {
        const res = await recover(owner());
        const text = JSON.stringify(res.body);
        expect(Object.keys(res.body.data).sort()).toEqual(['expires_at', 'login_path', 'login_url']);
        expect(res.body.token).toBeUndefined();
        expect(res.body.data.token).toBeUndefined();
        for (const secret of [w.abc.id, w.users.owner.id, w.xyz.id, w.xyz.portalSlug, PASSWORD]) expect(text).not.toContain(secret);
    });

    it('does not end existing sessions, and the owner can sign in through the new link only', async () => {
        const res = await recover(owner());
        for (const token of [w.tokens.owner, w.tokens.sarah, w.tokens.melEmployee]) {
            expect((await request(app).get('/api/organisation/me').set(bearer(token))).status).toBe(200);
        }
        const login = (slug: string) => request(app).post('/api/auth/login').send({ email: w.users.owner.email, password: PASSWORD, organisation_slug: slug });
        expect((await login(w.abc.portalSlug)).status).toBe(401);
        expect((await login(res.body.data.login_path.replace('/login/', ''))).status).toBe(200);
    });

    it('matches the organisation name and the email case-insensitively', async () => {
        for (const name of ['ABC Health', 'abc health', 'ABC HEALTH', 'aBc hEaLtH', '  abc health  ']) {
            const res = await recover(owner({ organisation_name: name, email: name === 'ABC HEALTH' ? w.users.owner.email.toUpperCase() : w.users.owner.email }));
            expect({ name, status: res.status }).toEqual({ name, status: 200 });
        }
    });

    it('does not loosen whitespace or spelling', async () => {
        for (const name of ['ABC  Health', 'ABCHealth', 'ABC Health Pty', 'ABC-Health', 'ABC Healt']) {
            resetLimits();
            expect({ name, status: (await recover(owner({ organisation_name: name }))).status }).toEqual({ name, status: 401 });
        }
    });

    it('issues a different, unguessable link each time', async () => {
        const tokens = new Set<string>();
        for (let i = 0; i < 12; i++) tokens.add((await recover(owner())).body.data.login_path.replace('/login/', ''));
        expect(tokens.size).toBe(12);
        for (const t of tokens) expect(t).toMatch(/^[0-9a-f]{32}$/); // 128 random bits
    });

    it('stores the link only hashed and encrypted, never as plain text', async () => {
        const token = (await recover(owner())).body.data.login_path.replace('/login/', '');
        const row = (await sql('SELECT row_to_json(o)::text AS text, portal_slug, portal_slug_hash FROM organisations o WHERE id = $1', [w.abc.id])).rows[0];
        expect(row.text).not.toContain(token);
        expect(row.portal_slug).toBeNull();
        expect(row.portal_slug_hash).toBe(hashPortalToken(token));
    });

    it('keeps an expiry the owner chose while it is in the future', async () => {
        const expiry = new Date(Date.now() + 30 * 86400000).toISOString();
        await request(app).put('/api/organisation/portal-link').set(bearer(w.tokens.owner)).send({ expires_at: expiry });
        const res = await recover(owner());
        expect(res.body.data.expires_at).toBe(expiry);
    });

    it('replaces an expired link with one that works', async () => {
        await sql("UPDATE organisations SET portal_link_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [w.abc.id]);
        const res = await recover(owner());
        expect(res.status).toBe(200);
        expect(res.body.data.expires_at).toBeNull();
        expect((await request(app).get(res.body.data.login_path)).status).toBe(200);
    });
});

describe('who can recover', () => {
    const failures = async () => {
        const accountant = await createUser('accountant@abc.test');
        await assignRole(w.abc.id, accountant.id, await createRole(w.abc.id, 'Accountant', ['payroll.view', 'timesheets.view']), 'all');
        const inactiveOwner = await createUser('gone@inactive.test');
        await createOrganisation('Inactive Owner Co', inactiveOwner.id);
        await sql('UPDATE users SET is_active = false WHERE id = $1', [inactiveOwner.id]);
        const inactiveOrgOwner = await createUser('boss@dormant.test');
        const dormant = await createOrganisation('Dormant Co', inactiveOrgOwner.id);
        await sql('UPDATE organisations SET is_active = false WHERE id = $1', [dormant.id]);

        const cases: Array<[string, Record<string, unknown>]> = [
            ['wrong organisation name', owner({ organisation_name: 'Not ABC' })],
            ['nonexistent organisation', owner({ organisation_name: 'No Such Company', email: 'nobody@nowhere.test' })],
            ['wrong owner email', owner({ email: 'someone@else.test' })],
            ['wrong password', owner({ password: WRONG })],
            ['branch admin, correct password', owner({ email: w.users.sarah.email })],
            ['employee, correct password', owner({ email: w.users.melEmployee.email })],
            ['accountant, correct password', owner({ email: accountant.email })],
            ['another organisation\'s owner naming this organisation', owner({ email: w.users.xavier.email })],
            ['this owner naming another organisation', owner({ organisation_name: 'XYZ Care' })],
            ['inactive owner, correct details', { organisation_name: 'Inactive Owner Co', email: inactiveOwner.email, password: PASSWORD }],
            ['inactive organisation, correct details', { organisation_name: 'Dormant Co', email: inactiveOrgOwner.email, password: PASSWORD }],
        ];
        return cases;
    };

    it('every failure is the same response, and changes nothing', async () => {
        const before = await currentToken(w.abc.id);
        const beforeXyz = await currentToken(w.xyz.id);
        let expected: { status: number; body: unknown } | null = null;
        for (const [label, body] of await failures()) {
            resetLimits();
            const res = await recover(body);
            const seen = { status: res.status, body: res.body };
            expected ??= seen;
            expect({ label, ...seen }).toEqual({ label, ...expected });
            expect(res.body.error.message).toBe(GENERIC);
        }
        expect(expected!.status).toBe(401);
        expect(await currentToken(w.abc.id)).toBe(before);
        expect(await currentToken(w.xyz.id)).toBe(beforeXyz);
    });

    it('always compares the password, even when nothing matches', async () => {
        const compare = comparePassword as jest.Mock;
        compare.mockClear();
        await recover(owner({ organisation_name: 'No Such Company', email: 'nobody@nowhere.test' }));
        expect(compare).toHaveBeenCalledTimes(1);
        await recover(owner({ password: WRONG }));
        expect(compare).toHaveBeenCalledTimes(2);
    });

    it('cannot be used to learn which organisations or owners exist', async () => {
        const real = await recover(owner({ password: WRONG }));
        const madeUp = await recover(owner({ organisation_name: 'No Such Company', email: 'nobody@nowhere.test', password: WRONG }));
        expect(real.status).toBe(madeUp.status);
        expect(real.body).toEqual(madeUp.body);
        expect(real.headers['content-type']).toBe(madeUp.headers['content-type']);
    });

    it('two organisations owned by one person with the same name cannot be recovered by name', async () => {
        await createOrganisation('abc health', w.users.owner.id);
        const res = await recover(owner());
        expect(res.status).toBe(401);
        expect(await currentToken(w.abc.id)).toBe(w.abc.portalSlug);
    });

    it('an owner cannot give a second organisation the same name (signup or rename)', async () => {
        const second = await createOrganisation('Second Org', w.users.owner.id);
        await createBranch(second.id, 'Main');
        const token = await signIn(w.users.owner.id, second.id);
        const rename = await request(app).put('/api/organisation/settings').set(bearer(token)).send({ name: 'abc HEALTH' });
        expect(rename.status).toBe(400);
        expect(rename.body.error.code).toBe('ORGANISATION_NAME_IN_USE');
        expect((await request(app).put('/api/organisation/settings').set(bearer(token)).send({ name: 'Second Org Renamed' })).status).toBe(200);
    });
});

describe('input validation', () => {
    it('rejects missing, malformed and mistyped fields before touching any account', async () => {
        const bad: Array<Record<string, unknown>> = [
            {}, owner({ organisation_name: undefined }), owner({ email: undefined }), owner({ password: undefined }),
            owner({ organisation_name: '   ' }), owner({ password: '' }), owner({ email: 'not-an-email' }), owner({ email: 'a@b' }),
            owner({ organisation_name: { $ne: 'x' } }), owner({ email: ['olivia@abc.test'] }), owner({ password: 12345678 }),
            owner({ organisation_name: 'x'.repeat(121) }), owner({ password: 'x'.repeat(2000) }),
        ];
        const compare = comparePassword as jest.Mock;
        compare.mockClear();
        for (const body of bad) {
            const res = await recover(body);
            expect({ body, status: res.status, code: res.body.error?.code }).toEqual({ body, status: 400, code: 'VALIDATION_FAILED' });
        }
        expect(compare).not.toHaveBeenCalled();
    });

    it('ignores any organisation or user id in the request', async () => {
        const res = await recover(owner({ org_id: w.xyz.id, organisation_id: w.xyz.id, user_id: w.users.xavier.id, organisation_slug: w.xyz.portalSlug }));
        expect(res.status).toBe(200);
        const token = res.body.data.login_path.replace('/login/', '');
        expect((await resolvePortalToken(token) as any).orgId).toBe(w.abc.id);
        expect(await currentToken(w.xyz.id)).toBe(w.xyz.portalSlug);
    });
});

describe('rate limiting', () => {
    const attempt = () => recover(owner({ password: WRONG }));

    it('locks a target after repeated failures, even for the correct password, without revealing whether it exists', async () => {
        for (const target of [owner(), owner({ organisation_name: 'No Such Company', email: 'nobody@nowhere.test' })]) {
            resetLimits();
            for (let i = 0; i < 5; i++) expect((await recover({ ...target, password: WRONG })).status).toBe(401);
            const locked = await recover(target);
            expect(locked.status).toBe(429);
            expect(locked.body.error.code).toBe('TOO_MANY_REQUESTS');
        }
        expect(await currentToken(w.abc.id)).toBe(w.abc.portalSlug); // the correct password was refused while locked
    });

    it('locks for longer each time it is locked again', async () => {
        const realNow = Date.now.bind(Date);
        let offset = 0;
        jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
        const failFive = async () => { for (let i = 0; i < 5; i++) await attempt(); };

        await failFive();
        expect((await recover(owner())).status).toBe(429);
        offset += 16 * 60 * 1000;                                 // the first lock is 15 minutes
        await failFive();                                          // locked again
        offset += 16 * 60 * 1000;
        expect((await recover(owner())).status).toBe(429);         // the second is 30 minutes: still locked after 16
        offset += 15 * 60 * 1000;
        expect((await recover(owner())).status).toBe(200);         // free after 31
    });

    it('limits by client address across different targets, and X-Forwarded-For does not dodge it', async () => {
        for (let i = 0; i < 10; i++) {
            const res = await recover({ organisation_name: `Company ${i}`, email: `user${i}@nowhere.test`, password: WRONG });
            expect(res.status).toBe(401);
        }
        const blocked = await request(app).post('/api/recovery/login-link').set('X-Forwarded-For', '203.0.113.9').send(owner());
        expect(blocked.status).toBe(429);
    });

    it('shares the per-account budget with sign-in, so passwords cannot be guessed faster through recovery', async () => {
        for (let i = 0; i < 5; i++) await recover(owner({ organisation_name: `Company ${i}`, password: WRONG }));
        const login = await request(app).post('/api/auth/login').send({ email: w.users.owner.email, password: PASSWORD, organisation_slug: w.abc.portalSlug });
        expect(login.status).toBe(429);

        resetLimits();
        for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ email: w.users.owner.email, password: WRONG, organisation_slug: w.abc.portalSlug });
        expect((await recover(owner())).status).toBe(429);
    });

    it('a successful recovery starts the failure count again', async () => {
        for (let i = 0; i < 4; i++) await attempt();
        expect((await recover(owner())).status).toBe(200);
        for (let i = 0; i < 4; i++) expect((await attempt()).status).toBe(401);
    });
});

describe('audit trail and logs', () => {
    const auditRows = async (orgId: string) => (await sql('SELECT * FROM audit_logs WHERE org_id = $1 ORDER BY created_at', [orgId])).rows;

    it('records a success and the rotation against the organisation and its owner', async () => {
        const res = await recover(owner());
        const rows = (await auditRows(w.abc.id)).filter(r => r.action.startsWith('LOGIN_LINK_'));
        expect(rows.map(r => r.action).sort()).toEqual(['LOGIN_LINK_RECOVERY_SUCCESS', 'LOGIN_LINK_ROTATED']);
        for (const row of rows) {
            expect(row.actor_id).toBe(w.users.owner.id);
            expect(row.org_id).toBe(w.abc.id);
            expect(row.ip_address).toBeTruthy();
            expect(row.created_at).toBeTruthy();
            expect(row.details).not.toContain(res.body.data.login_path.replace('/login/', ''));
        }
        // A recovery is not a sign-in: it must not become a "known device" for the suspicious-login check.
        const history = await sql("SELECT 1 FROM login_history WHERE auth_method = 'login_link_recovery' AND status = 'SUCCESS'");
        expect(history.rows).toHaveLength(0);
    });

    it('records failures: in the organisation trail when it names a real owner, and always in the sign-in log', async () => {
        await recover(owner({ password: WRONG }));
        await recover(owner({ organisation_name: 'No Such Company', email: 'nobody@nowhere.test', password: WRONG }));

        const audit = (await auditRows(w.abc.id)).filter(r => r.action === 'LOGIN_LINK_RECOVERY_FAILURE');
        expect(audit).toHaveLength(1);
        expect(audit[0].actor_id).toBeNull();
        expect(audit[0].target_user_id).toBe(w.users.owner.id);
        expect(audit[0].details).toContain('PASSWORD_INCORRECT');

        const log = (await sql("SELECT * FROM login_history WHERE auth_method = 'login_link_recovery' ORDER BY created_at")).rows;
        expect(log.map(r => [r.email, r.status, r.org_id === null])).toEqual([[w.users.owner.email, 'FAILED', false], ['nobody@nowhere.test', 'FAILED', true]]);
        expect(log.every(r => r.ip_address && r.user_agent !== undefined)).toBe(true);
    });

    it('records when a lockout starts', async () => {
        for (let i = 0; i < 5; i++) await recover(owner({ password: WRONG }));
        const rows = (await sql("SELECT status FROM login_history WHERE auth_method = 'login_link_recovery'")).rows.map(r => r.status);
        expect(rows.filter((s: string) => s === 'RATE_LIMITED')).toHaveLength(1);
    });

    it('never stores or prints the password or a login link', async () => {
        const printed: string[] = [];
        for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
            jest.spyOn(console, method).mockImplementation((...args: unknown[]) => { printed.push(args.map(String).join(' ')); });
        }
        const secretPassword = 'Zx9-Very-Secret-Pass';
        await sql('UPDATE users SET password_hash = $1 WHERE id = $2', [await (await import('../../src/services/auth')).hashPassword(secretPassword), w.users.owner.id]);

        await recover(owner({ password: 'Wrong-Secret-Attempt1' }));
        const ok = await recover(owner({ password: secretPassword }));
        const newToken = ok.body.data.login_path.replace('/login/', '');

        const stored = [
            ...(await sql('SELECT row_to_json(a)::text AS t FROM audit_logs a')).rows,
            ...(await sql('SELECT row_to_json(h)::text AS t FROM login_history h')).rows,
        ].map(r => r.t).join('\n');
        for (const secret of [secretPassword, 'Wrong-Secret-Attempt1', newToken, w.abc.portalSlug]) {
            expect(stored).not.toContain(secret);
            expect(printed.join('\n')).not.toContain(secret);
        }
    });
});

describe('security notification', () => {
    it('emails the owner (never the link) after a successful recovery, and nothing after a failure', async () => {
        await recover(owner({ password: WRONG }));
        expect(getTestOutbox()).toHaveLength(0);

        const res = await recover(owner());
        const [mail] = getTestOutbox();
        expect(getTestOutbox()).toHaveLength(1);
        expect(mail.to).toBe(w.users.owner.email);
        expect(mail.subject).toMatch(/login link was recovered/i);
        expect(mail.html).toContain('ABC Health');
        const token = res.body.data.login_path.replace('/login/', '');
        for (const body of [mail.html, mail.text || '']) {
            expect(body).not.toContain(token);
            expect(body).not.toContain('/login/');
        }
    });

    it('escapes the organisation name in the email', async () => {
        await sql("UPDATE organisations SET name = $1 WHERE id = $2", ['<b>Evil</b> & Co', w.abc.id]);
        await recover(owner({ organisation_name: '<b>Evil</b> & Co' }));
        expect(getTestOutbox()[0].html).not.toContain('<b>Evil</b>');
        expect(getTestOutbox()[0].html).toContain('&lt;b&gt;Evil&lt;/b&gt; &amp; Co');
    });

    it('recovers without email while email is off, and when delivery fails', async () => {
        const saved = { enabled: process.env.EMAIL_ENABLED, provider: process.env.EMAIL_PROVIDER };
        try {
            process.env.EMAIL_ENABLED = 'false';
            expect((await recover(owner())).status).toBe(200);
            expect(getTestOutbox()).toHaveLength(0);

            process.env.EMAIL_ENABLED = 'true';
            process.env.EMAIL_PROVIDER = 'resend'; // no API key in tests: delivery fails
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            jest.spyOn(console, 'warn').mockImplementation(() => undefined);
            expect((await recover(owner())).status).toBe(200);
        } finally {
            if (saved.enabled === undefined) delete process.env.EMAIL_ENABLED; else process.env.EMAIL_ENABLED = saved.enabled;
            process.env.EMAIL_PROVIDER = saved.provider;
        }
    });
});

describe('tenant isolation', () => {
    it('recovering one organisation never touches or reveals another', async () => {
        const xyzBefore = await currentToken(w.xyz.id);
        const res = await recover(owner());
        expect(JSON.stringify(res.body)).not.toContain(xyzBefore);
        expect(await currentToken(w.xyz.id)).toBe(xyzBefore);
        expect((await resolvePortalToken(xyzBefore)).status).toBe('valid');

        resetLimits();
        const xyz = await recover({ organisation_name: 'XYZ Care', email: w.users.xavier.email, password: PASSWORD });
        expect(xyz.status).toBe(200);
        const xyzToken = xyz.body.data.login_path.replace('/login/', '');
        expect((await resolvePortalToken(xyzToken) as any).orgId).toBe(w.xyz.id);
        expect(await currentToken(w.abc.id)).toBe(res.body.data.login_path.replace('/login/', ''));

        // Xavier's audit trail and Olivia's are separate.
        const abcAudit = (await sql("SELECT actor_id FROM audit_logs WHERE org_id = $1 AND action = 'LOGIN_LINK_RECOVERY_SUCCESS'", [w.abc.id])).rows;
        expect(abcAudit.map(r => r.actor_id)).toEqual([w.users.owner.id]);
    });
});

describe('the standard sign-in stays private', () => {
    it('/login is still a 404 with no form, and there is no email + password sign-in', async () => {
        const page = await request(app).get('/login');
        expect(page.status).toBe(404);
        expect(page.text).not.toMatch(/password|sign in|email/i);

        const noLink = await request(app).post('/api/auth/login').send({ email: w.users.owner.email, password: PASSWORD });
        expect(noLink.status).toBe(400);
        expect(noLink.body.data?.token).toBeUndefined();
    });

    it('recovery gives no session and no way to read a link without the owner\'s password', async () => {
        expect((await request(app).get('/api/recovery/login-link')).status).toBe(404);
        expect((await request(app).get('/api/organisation/me')).status).toBe(401);
        const failed = await recover(owner({ password: WRONG }));
        expect(failed.headers['set-cookie']).toBeUndefined();
        expect(JSON.stringify(failed.body)).not.toMatch(/login\/|token/i);
        // The link an owner is shown in Settings still needs a session with security.manage.
        expect((await request(app).get('/api/organisation/me').set(bearer(w.tokens.sarah))).body.data.portal_slug).toBeUndefined();
    });

    it('the recovery page itself loads (it is a page, not an API)', async () => {
        expect((await request(app).get('/recover-login-link')).status).toBe(200);
    });

    it('uses the same hashing as everything else: a plain-text comparison would not pass', async () => {
        const hash = (await sql('SELECT password_hash FROM users WHERE id = $1', [w.users.owner.id])).rows[0].password_hash;
        expect(hash).toMatch(/^\$2[aby]\$/);
        expect(hash).not.toContain(PASSWORD);
        expect(crypto.createHash('sha256').update(PASSWORD).digest('hex')).not.toBe(hash);
    });
});
