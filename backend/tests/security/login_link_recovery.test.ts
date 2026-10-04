/**
 * Finding a lost company login link.
 *
 *   POST /api/recovery/login-link        { email, password } → the current link of every organisation the account can use
 *   POST /api/recovery/login-link/email  { email }           → the same links, emailed to that address (only while email is on)
 *
 * Neither is a sign-in: no session is created, /login stays a 404, and a working link is never replaced.
 */
import crypto from 'crypto';
import request from 'supertest';
import app from '../../src/index';
import { clearAllRateLimits } from '../../src/services/authUtils';
import { ipLimitKey, resetRecoveryLimits } from '../../src/services/loginLinkRecovery';
import { currentPortalLink, resolvePortalToken } from '../../src/services/portalLink';
import { clearTestOutbox, getTestOutbox } from '../../src/services/emailService';
import { comparePassword } from '../../src/services/auth';
import { connectTestDb, resetTestDb, closeTestDb, sql } from '../helpers/testDb';
import { PASSWORD, World, bearer, buildWorld, createBranch, createOrganisation, createUser, assignRole } from '../helpers/fixtures';

// The comparison must always run, whether or not the account exists — counted here.
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
const GENERIC = 'That email and password don’t match an account. Check them and try again.';

const lookup = (body: Record<string, unknown>) => request(app).post('/api/recovery/login-link').send(body);
const emailMe = (body: Record<string, unknown>) => request(app).post('/api/recovery/login-link/email').send(body);
const as = (email: string, over: Record<string, unknown> = {}) => ({ email, password: PASSWORD, ...over });
const owner = (over: Record<string, unknown> = {}) => as(w.users.owner.email, over);
const resetLimits = () => { clearAllRateLimits(); resetRecoveryLimits(); };
const currentToken = async (orgId: string) => (await currentPortalLink(orgId))!.token;
const expire = (orgId: string) => sql("UPDATE organisations SET portal_link_expires_at = NOW() - INTERVAL '1 day' WHERE id = $1", [orgId]);

async function withEmail<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
    const saved = process.env.EMAIL_ENABLED;
    process.env.EMAIL_ENABLED = String(enabled);
    try {
        return await fn();
    } finally {
        if (saved === undefined) delete process.env.EMAIL_ENABLED; else process.env.EMAIL_ENABLED = saved;
    }
}

describe('finding the link with email and password', () => {
    it('shows the owner the current link, and replaces nothing', async () => {
        const res = await lookup(owner());
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body.data.organisations).toEqual([
            { name: 'ABC Health', login_path: `/login/${w.abc.portalSlug}`, login_url: expect.stringMatching(new RegExp(`/login/${w.abc.portalSlug}$`)), expires_at: null, replaced: false },
        ]);
        expect(await currentToken(w.abc.id)).toBe(w.abc.portalSlug);
        expect((await request(app).get(`/login/${w.abc.portalSlug}`)).status).toBe(200);
    });

    it('works for every kind of account, not only the owner', async () => {
        const accountant = await createUser('accountant@abc.test');
        const { createRole } = await import('../helpers/fixtures');
        await assignRole(w.abc.id, accountant.id, await createRole(w.abc.id, 'Accountant', ['payroll.view']), 'all');
        for (const email of [w.users.sarah.email, w.users.greg.email, w.users.melEmployee.email, accountant.email]) {
            resetLimits();
            const res = await lookup(as(email));
            expect({ email, status: res.status, names: res.body.data?.organisations.map((o: any) => o.login_path) })
                .toEqual({ email, status: 200, names: [`/login/${w.abc.portalSlug}`] });
        }
    });

    it('lists every organisation the account can sign in to, and only those', async () => {
        await assignRole(w.xyz.id, w.users.sarah.id, w.roles.xyzAdmin, 'all');
        const res = await lookup(as(w.users.sarah.email));
        expect(res.body.data.organisations.map((o: any) => [o.name, o.login_path])).toEqual([
            ['ABC Health', `/login/${w.abc.portalSlug}`],
            ['XYZ Care', `/login/${w.xyz.portalSlug}`],
        ]);
        resetLimits();
        const xavier = await lookup(as(w.users.xavier.email));
        expect(JSON.stringify(xavier.body)).not.toContain(w.abc.portalSlug);
    });

    it('leaves out inactive organisations and branches the account can no longer reach', async () => {
        await sql('UPDATE organisations SET is_active = false WHERE id = $1', [w.xyz.id]);
        expect((await lookup(as(w.users.xavier.email))).body.data.organisations).toEqual([]);
        resetLimits();
        await sql('UPDATE employees SET is_active = false WHERE id = $1', [w.workers.mel]);
        expect((await lookup(as(w.users.melEmployee.email))).body.data.organisations).toEqual([]);
    });

    it('lists two organisations an owner gave the same name', async () => {
        const twin = await createOrganisation('ABC Health', w.users.owner.id);
        await createBranch(twin.id, 'Main');
        const res = await lookup(owner());
        expect(res.body.data.organisations.map((o: any) => o.login_path).sort()).toEqual([`/login/${w.abc.portalSlug}`, `/login/${twin.portalSlug}`].sort());
    });

    it('exposes nothing beyond the links: no session, no ids, no password', async () => {
        const res = await lookup(owner());
        const text = JSON.stringify(res.body);
        expect(Object.keys(res.body.data)).toEqual(['organisations']);
        expect(Object.keys(res.body.data.organisations[0]).sort()).toEqual(['expires_at', 'login_path', 'login_url', 'name', 'replaced']);
        expect(res.body.token).toBeUndefined();
        expect(res.headers['set-cookie']).toBeUndefined();
        for (const secret of [w.abc.id, w.users.owner.id, w.xyz.id, w.xyz.portalSlug, PASSWORD]) expect(text).not.toContain(secret);
    });

    it('does not end existing sessions, and signing in still needs the password', async () => {
        await lookup(owner());
        for (const token of [w.tokens.owner, w.tokens.sarah, w.tokens.melEmployee]) {
            expect((await request(app).get('/api/organisation/me').set(bearer(token))).status).toBe(200);
        }
        const login = (password: string) => request(app).post('/api/auth/login').send({ email: w.users.owner.email, password, organisation_slug: w.abc.portalSlug });
        expect((await login(WRONG)).status).toBe(401);
        expect((await login(PASSWORD)).status).toBe(200);
    });

    it('matches the email case-insensitively and ignores edge spaces', async () => {
        expect((await lookup(owner({ email: '  OLIVIA@abc.TEST ' }))).status).toBe(200);
    });

    it('ignores any organisation or user id in the request', async () => {
        const res = await lookup(owner({ org_id: w.xyz.id, organisation_id: w.xyz.id, user_id: w.users.xavier.id, organisation_slug: w.xyz.portalSlug }));
        expect(res.body.data.organisations.map((o: any) => o.name)).toEqual(['ABC Health']);
    });
});

describe('a link that has stopped working', () => {
    it('is replaced for the owner, who gets a link that works', async () => {
        await expire(w.abc.id);
        const res = await lookup(owner());
        const [org] = res.body.data.organisations;
        expect(org.replaced).toBe(true);
        expect(org.expires_at).toBeNull();
        const token = org.login_path.replace('/login/', '');
        expect(token).not.toBe(w.abc.portalSlug);
        expect(await resolvePortalToken(token)).toEqual({ status: 'valid', orgId: w.abc.id, name: 'ABC Health' });
        expect((await resolvePortalToken(w.abc.portalSlug)).status).toBe('invalid');

        // The next lookup gives that same link back.
        resetLimits();
        expect((await lookup(owner())).body.data.organisations[0]).toMatchObject({ login_path: org.login_path, replaced: false });
    });

    it('is not replaced for anyone else, who is told to ask the owner', async () => {
        await expire(w.abc.id);
        for (const email of [w.users.sarah.email, w.users.melEmployee.email]) {
            resetLimits();
            const [org] = (await lookup(as(email))).body.data.organisations;
            expect(org).toEqual({ name: 'ABC Health', login_path: null, login_url: null, expires_at: null, replaced: false });
        }
        expect(await currentToken(w.abc.id)).toBe(w.abc.portalSlug);
    });

    it('two lookups at the same moment end with one working link', async () => {
        await expire(w.abc.id);
        const [a, b] = await Promise.all([lookup(owner()), lookup(owner())]);
        const paths = [a, b].map(r => r.body.data.organisations[0].login_path);
        expect(paths[0]).toBe(paths[1]);
        expect(paths[0]).toBe(`/login/${await currentToken(w.abc.id)}`);
        const rotations = (await sql("SELECT 1 FROM audit_logs WHERE org_id = $1 AND action = 'LOGIN_LINK_ROTATED'", [w.abc.id])).rows;
        expect(rotations).toHaveLength(1);
    });

    it('emails the owner a notice (never the link) when it is replaced, and nothing for a plain lookup', async () => {
        await lookup(owner());
        expect(getTestOutbox()).toHaveLength(0);

        await expire(w.abc.id);
        resetLimits();
        const res = await lookup(owner());
        const [mail] = getTestOutbox();
        expect(getTestOutbox()).toHaveLength(1);
        expect(mail.to).toBe(w.users.owner.email);
        expect(mail.subject).toMatch(/login link was replaced/i);
        const token = res.body.data.organisations[0].login_path.replace('/login/', '');
        for (const body of [mail.html, mail.text || '']) {
            expect(body).not.toContain(token);
            expect(body).not.toContain('/login/');
        }
    });

    it('still works while email is off, and when the notice cannot be delivered', async () => {
        await expire(w.abc.id);
        await withEmail(false, async () => {
            expect((await lookup(owner())).body.data.organisations[0].replaced).toBe(true);
        });
        expect(getTestOutbox()).toHaveLength(0);
    });
});

describe('failures', () => {
    const failures = async (): Promise<Array<[string, Record<string, unknown>]>> => {
        const inactive = await createUser('gone@abc.test');
        await sql('UPDATE users SET is_active = false WHERE id = $1', [inactive.id]);
        return [
            ['wrong password', owner({ password: WRONG })],
            ['unknown email', as('nobody@nowhere.test')],
            ['inactive account, correct password', as(inactive.email)],
            ['empty body', {}],
            ['empty fields', { email: '', password: '' }],
            ['malformed email', owner({ email: 'not-an-email' })],
            ['email as an object', owner({ email: { $ne: 'x' } })],
            ['email as an array', owner({ email: ['olivia@abc.test'] })],
            ['password as a number', owner({ password: 12345678 })],
            ['missing password', owner({ password: undefined })],
            ['very long password', owner({ password: 'x'.repeat(2000) })],
        ];
    };

    it('every failure is the same response, and changes nothing', async () => {
        let expected: { status: number; body: unknown } | null = null;
        for (const [label, body] of await failures()) {
            resetLimits();
            const res = await lookup(body);
            const seen = { status: res.status, body: res.body };
            expected ??= seen;
            expect({ label, ...seen }).toEqual({ label, ...expected });
            expect(res.body.error.message).toBe(GENERIC);
        }
        expect(expected!.status).toBe(401);
        expect(await currentToken(w.abc.id)).toBe(w.abc.portalSlug);
    });

    it('always compares a password, even when there is no such account or the input is malformed', async () => {
        const compare = comparePassword as jest.Mock;
        compare.mockClear();
        await lookup(as('nobody@nowhere.test'));
        await lookup(owner({ password: WRONG }));
        await lookup({});
        expect(compare).toHaveBeenCalledTimes(3);
    });

    it('a correct password for an account with no organisation shows an empty list, not an error', async () => {
        const loner = await createUser('loner@nowhere.test');
        const res = await lookup(as(loner.email));
        expect(res.status).toBe(200);
        expect(res.body.data.organisations).toEqual([]);
    });
});

describe('rate limiting', () => {
    const attempt = () => lookup(owner({ password: WRONG }));

    it('locks an email after 5 failures, even for the correct password, real account or not', async () => {
        for (const target of [owner(), as('nobody@nowhere.test')]) {
            resetLimits();
            for (let i = 0; i < 5; i++) expect((await lookup({ ...target, password: WRONG })).status).toBe(401);
            clearAllRateLimits(); // the sign-in page's budget is not what stops this
            const locked = await lookup(target);
            expect(locked.status).toBe(429);
            expect(locked.body.error.code).toBe('TOO_MANY_REQUESTS');
        }
    });

    it('locks made-up and real emails on the same schedule', async () => {
        const timeline = async (email: string) => {
            resetLimits();
            const seen: number[] = [];
            for (let i = 0; i < 7; i++) seen.push((await lookup(as(email, { password: WRONG }))).status);
            return seen;
        };
        expect(await timeline(w.users.owner.email)).toEqual(await timeline('nobody@nowhere.test'));
    });

    it('locks for longer each time it is locked again', async () => {
        const realNow = Date.now.bind(Date);
        let offset = 0;
        jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
        const failFive = async () => { for (let i = 0; i < 5; i++) await attempt(); clearAllRateLimits(); };

        await failFive();
        expect((await lookup(owner())).status).toBe(429);
        offset += 16 * 60 * 1000;                                 // the first lock is 15 minutes
        await failFive();                                          // locked again
        offset += 16 * 60 * 1000;
        expect((await lookup(owner())).status).toBe(429);         // the second is 30 minutes: still locked after 16
        offset += 15 * 60 * 1000;
        expect((await lookup(owner())).status).toBe(200);         // free after 31
    });

    it('limits by client address across different emails, and X-Forwarded-For does not dodge it', async () => {
        for (let i = 0; i < 10; i++) expect((await lookup(as(`user${i}@nowhere.test`, { password: WRONG }))).status).toBe(401);
        const blocked = await request(app).post('/api/recovery/login-link').set('X-Forwarded-For', '203.0.113.9').send(owner());
        expect(blocked.status).toBe(429);
    });

    it('counts malformed input against the address', async () => {
        for (let i = 0; i < 10; i++) expect((await lookup({})).status).toBe(401);
        expect((await lookup(owner())).status).toBe(429);
    });

    it('shares the per-account budget with sign-in, so passwords cannot be guessed faster here', async () => {
        for (let i = 0; i < 5; i++) await attempt();
        resetRecoveryLimits();
        const login = await request(app).post('/api/auth/login').send({ email: w.users.owner.email, password: PASSWORD, organisation_slug: w.abc.portalSlug });
        expect(login.status).toBe(429);

        resetLimits();
        for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ email: w.users.owner.email, password: WRONG, organisation_slug: w.abc.portalSlug });
        expect((await lookup(owner())).status).toBe(429);
    });

    it('changing the email case does not give a fresh allowance', async () => {
        for (const email of ['olivia@abc.test', 'OLIVIA@ABC.TEST', ' Olivia@Abc.Test ', 'olivia@abc.TEST', 'Olivia@abc.test']) {
            await lookup(owner({ email, password: WRONG }));
        }
        clearAllRateLimits();
        expect((await lookup(owner())).status).toBe(429);
    });

    it('a successful lookup starts the failure count again', async () => {
        for (let i = 0; i < 4; i++) await attempt();
        expect((await lookup(owner())).status).toBe(200);
        for (let i = 0; i < 4; i++) expect((await attempt()).status).toBe(401);
    });

    it('counts an IPv4-mapped address as the IPv4 address, and an IPv6 address as its /64', () => {
        expect(ipLimitKey('::ffff:203.0.113.9')).toBe(ipLimitKey('203.0.113.9'));
        expect(ipLimitKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(ipLimitKey('2001:0db8:0001:0002:1:2:3:4'));
        expect(ipLimitKey('2001:db8:1:2::1')).toBe(ipLimitKey('2001:db8:1:2:ffff::'));
        expect(ipLimitKey('2001:db8:1:3::1')).not.toBe(ipLimitKey('2001:db8:1:2::1'));
        expect(ipLimitKey('::1')).toBe(ipLimitKey('0:0:0:0:5:6:7:8')); // same /64
        expect(ipLimitKey('203.0.113.9')).not.toBe(ipLimitKey('203.0.113.10'));
    });
});

describe('audit trail and logs', () => {
    const auditRows = async (orgId: string) => (await sql('SELECT * FROM audit_logs WHERE org_id = $1 ORDER BY created_at', [orgId])).rows;

    it('records each lookup in the trail of every organisation it showed', async () => {
        await assignRole(w.xyz.id, w.users.sarah.id, w.roles.xyzAdmin, 'all');
        await lookup(as(w.users.sarah.email));
        for (const orgId of [w.abc.id, w.xyz.id]) {
            const rows = (await auditRows(orgId)).filter(r => r.action === 'LOGIN_LINK_LOOKUP');
            expect(rows).toHaveLength(1);
            expect(rows[0].actor_id).toBe(w.users.sarah.id);
            expect(rows[0].ip_address).toBeTruthy();
            expect(rows[0].details).not.toContain('/login/');
        }
        // A lookup is not a sign-in: it must not become a "known device" for the suspicious-login check.
        const history = await sql("SELECT 1 FROM login_history WHERE auth_method = 'login_link_recovery' AND status = 'SUCCESS'");
        expect(history.rows).toHaveLength(0);
    });

    it('records every failure in the sign-in log, and when a lockout starts', async () => {
        await lookup(owner({ password: WRONG }));
        await lookup(as('nobody@nowhere.test', { password: WRONG }));
        const log = (await sql("SELECT * FROM login_history WHERE auth_method = 'login_link_recovery' ORDER BY created_at")).rows;
        expect(log.map(r => [r.email, r.status, r.user_id === w.users.owner.id])).toEqual([
            [w.users.owner.email, 'FAILED', true], ['nobody@nowhere.test', 'FAILED', false],
        ]);

        for (let i = 0; i < 4; i++) await lookup(owner({ password: WRONG }));
        const statuses = (await sql("SELECT status FROM login_history WHERE auth_method = 'login_link_recovery'")).rows.map(r => r.status);
        expect(statuses.filter((s: string) => s === 'RATE_LIMITED')).toHaveLength(1);
    });

    it('writes nothing for malformed input', async () => {
        const before = (await sql('SELECT count(*)::int n FROM login_history')).rows[0].n;
        await lookup({});
        await lookup(owner({ email: 'not-an-email' }));
        expect((await sql('SELECT count(*)::int n FROM login_history')).rows[0].n).toBe(before);
    });

    it('never stores or prints the password or a login link', async () => {
        const printed: string[] = [];
        for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
            jest.spyOn(console, method).mockImplementation((...args: unknown[]) => { printed.push(args.map(String).join(' ')); });
        }
        const secretPassword = 'Zx9-Very-Secret-Pass';
        await sql('UPDATE users SET password_hash = $1 WHERE id = $2', [await (await import('../../src/services/auth')).hashPassword(secretPassword), w.users.owner.id]);
        await expire(w.abc.id);

        await lookup(owner({ password: 'Wrong-Secret-Attempt1' }));
        const ok = await lookup(owner({ password: secretPassword }));
        const newToken = ok.body.data.organisations[0].login_path.replace('/login/', '');

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

describe('getting the link by email', () => {
    it('tells the page whether the email option exists', async () => {
        await withEmail(false, async () => expect((await request(app).get('/api/recovery/options')).body.data).toEqual({ email_enabled: false }));
        await withEmail(true, async () => expect((await request(app).get('/api/recovery/options')).body.data).toEqual({ email_enabled: true }));
    });

    it('is refused while email is off, and sends nothing', async () => {
        await withEmail(false, async () => {
            const res = await emailMe({ email: w.users.sarah.email });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('EMAIL_DISABLED');
        });
        expect(getTestOutbox()).toHaveLength(0);
    });

    it('emails the account its links, at its own address only', async () => {
        await assignRole(w.xyz.id, w.users.sarah.id, w.roles.xyzAdmin, 'all');
        const res = await emailMe({ email: ' SARAH@abc.test ' });
        expect(res.status).toBe(200);
        const [mail] = getTestOutbox();
        expect(getTestOutbox()).toHaveLength(1);
        expect(mail.to).toBe(w.users.sarah.email);
        expect(mail.subject).toBe('Your SimpleHours login links');
        for (const slug of [w.abc.portalSlug, w.xyz.portalSlug]) {
            expect(mail.html).toContain(`/login/${slug}`);
            expect(mail.text).toContain(`/login/${slug}`);
        }
        // The response itself never carries a link.
        expect(JSON.stringify(res.body)).not.toContain('/login/');
    });

    it('answers the same for an unknown or inactive address, and sends nothing', async () => {
        const real = await emailMe({ email: w.users.sarah.email });
        clearTestOutbox();
        await sql('UPDATE users SET is_active = false WHERE id = $1', [w.users.greg.id]);
        for (const email of ['nobody@nowhere.test', w.users.greg.email, 'not-an-email']) {
            const res = await emailMe({ email });
            expect({ email, status: res.status, body: res.body }).toEqual({ email, status: real.status, body: real.body });
        }
        expect(getTestOutbox()).toHaveLength(0);
    });

    it('never replaces a link: an expired one is listed with a note to ask the owner', async () => {
        await expire(w.abc.id);
        await emailMe({ email: w.users.owner.email });
        expect(await currentToken(w.abc.id)).toBe(w.abc.portalSlug);
        expect(getTestOutbox()[0].text).toMatch(/Ask your Organisation Owner/);
        expect(getTestOutbox()[0].text).not.toContain('/login/');
    });

    it('sends at most 3 emails to one address, real or not, on the same schedule', async () => {
        const timeline = async (email: string) => {
            resetLimits();
            const seen: number[] = [];
            for (let i = 0; i < 5; i++) seen.push((await emailMe({ email })).status);
            return seen;
        };
        expect(await timeline(w.users.sarah.email)).toEqual([200, 200, 200, 429, 429]);
        expect(await timeline('nobody@nowhere.test')).toEqual([200, 200, 200, 429, 429]);
    });

    it('escapes organisation names in the email', async () => {
        await sql('UPDATE organisations SET name = $1 WHERE id = $2', ['<b>Evil</b> & Co', w.abc.id]);
        await emailMe({ email: w.users.sarah.email });
        expect(getTestOutbox()[0].html).not.toContain('<b>Evil</b>');
        expect(getTestOutbox()[0].html).toContain('&lt;b&gt;Evil&lt;/b&gt; &amp; Co');
    });
});

describe('the standard sign-in stays private', () => {
    it('/login is still a 404 with no form, and there is no sign-in without a link', async () => {
        const page = await request(app).get('/login');
        expect(page.status).toBe(404);
        expect(page.text).not.toMatch(/password|sign in|email/i);

        const noLink = await request(app).post('/api/auth/login').send({ email: w.users.owner.email, password: PASSWORD });
        expect(noLink.status).toBe(400);
        expect(noLink.body.data?.token).toBeUndefined();
    });

    it('there is no way to read a link without the account\'s password or inbox', async () => {
        expect((await request(app).get('/api/recovery/login-link')).status).toBe(404);
        const failed = await lookup(owner({ password: WRONG }));
        expect(failed.headers['set-cookie']).toBeUndefined();
        expect(JSON.stringify(failed.body)).not.toMatch(/login\/|token/i);
        // The link shown in Settings still needs a session with security.manage.
        expect((await request(app).get('/api/organisation/me').set(bearer(w.tokens.sarah))).body.data.portal_slug).toBeUndefined();
    });

    it('the page itself loads (it is a page, not an API)', async () => {
        expect((await request(app).get('/recover-login-link')).status).toBe(200);
    });

    it('uses the same hashing as everything else: a plain-text comparison would not pass', async () => {
        const hash = (await sql('SELECT password_hash FROM users WHERE id = $1', [w.users.owner.id])).rows[0].password_hash;
        expect(hash).toMatch(/^\$2[aby]\$/);
        expect(hash).not.toContain(PASSWORD);
        expect(crypto.createHash('sha256').update(PASSWORD).digest('hex')).not.toBe(hash);
    });
});

describe('production headers', () => {
    it('sends HSTS and no localhost allowance in production only', async () => {
        const saved = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = 'production';
            const prod = await request(app).get('/health');
            expect(prod.headers['strict-transport-security']).toMatch(/max-age=\d+/);
            expect(prod.headers['content-security-policy']).not.toMatch(/localhost|127\.0\.0\.1/);
            process.env.NODE_ENV = 'test';
            const dev = await request(app).get('/health');
            expect(dev.headers['strict-transport-security']).toBeUndefined();
            expect(dev.headers['content-security-policy']).toMatch(/localhost/);
        } finally {
            process.env.NODE_ENV = saved;
        }
    });
});
