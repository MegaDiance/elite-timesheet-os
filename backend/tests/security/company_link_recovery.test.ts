/**
 * Recovering a lost company link with the company name and the company recovery password.
 *
 *   PUT  /api/organisation/recovery-password  { current_password, new_recovery_password | null }  (Owner only)
 *   POST /api/recovery/company-link           { company_name, password }  → the company's current link
 *
 * Not a sign-in: no session is created, and a working link is never replaced.
 */
import request from 'supertest';
import app from '../../src/index';
import { clearAllRateLimits } from '../../src/services/authUtils';
import { resetRecoveryLimits } from '../../src/services/loginLinkRecovery';
import { currentPortalLink, resolvePortalToken } from '../../src/services/portalLink';
import { comparePasswordUniform } from '../../src/services/auth';
import { connectTestDb, resetTestDb, closeTestDb, sql } from '../helpers/testDb';
import { PASSWORD, World, bearer, buildWorld, createOrganisation, createUser, signIn } from '../helpers/fixtures';

jest.mock('../../src/services/auth', () => {
    const actual = jest.requireActual('../../src/services/auth');
    return { ...actual, comparePasswordUniform: jest.fn(actual.comparePasswordUniform) };
});

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    resetRecoveryLimits();
    w = await buildWorld();
});
afterEach(() => jest.restoreAllMocks());

const RECOVERY = 'Recover2026abc';
const GENERIC = 'Company name or recovery password is incorrect.';

const recover = (body: Record<string, unknown>) => request(app).post('/api/recovery/company-link').send(body);
const setRecovery = (token: string, body: Record<string, unknown>) =>
    request(app).put('/api/organisation/recovery-password').set(bearer(token)).send(body);
const ownerSets = (password: string | null = RECOVERY) => setRecovery(w.tokens.owner, { current_password: PASSWORD, new_recovery_password: password });
const resetLimits = () => { clearAllRateLimits(); resetRecoveryLimits(); };

describe('setting the company recovery password', () => {
    it('lets the Owner set it, stores only a hash, and reports only when it was set', async () => {
        const res = await ownerSets();
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Recovery password saved');
        const row = (await sql('SELECT recovery_password_hash, recovery_password_set_at FROM organisations WHERE id = $1', [w.abc.id])).rows[0];
        expect(row.recovery_password_hash).toMatch(/^\$argon2id\$/);
        expect(row.recovery_password_hash).not.toContain(RECOVERY);
        expect(row.recovery_password_set_at).not.toBeNull();

        const me = await request(app).get('/api/organisation/me').set(bearer(w.tokens.owner));
        expect(me.body.data.recovery_password_set_at).toEqual(expect.any(String));
        expect(JSON.stringify(me.body)).not.toMatch(/argon2|recovery_password_hash/);
        // An Admin doesn't even learn whether one is set.
        const admin = await request(app).get('/api/organisation/me').set(bearer(w.tokens.sarah));
        expect(admin.body.data.recovery_password_set_at).toBeUndefined();

        const audit = await sql("SELECT action FROM audit_logs WHERE org_id = $1 AND action LIKE 'RECOVERY_PASSWORD_%'", [w.abc.id]);
        expect(audit.rows.map(r => r.action)).toEqual(['RECOVERY_PASSWORD_SET']);
    });

    it('is Owner only, even for someone holding security.manage', async () => {
        const { createRole, assignRole } = await import('../helpers/fixtures');
        const sec = await createUser('sec@abc.test');
        await assignRole(w.abc.id, sec.id, await createRole(w.abc.id, 'Security', ['security.manage']), 'all');
        for (const token of [w.tokens.sarah, w.tokens.melEmployee, await signIn(sec.id, w.abc.id)]) {
            const res = await setRecovery(token, { current_password: PASSWORD, new_recovery_password: RECOVERY });
            expect(res.status).toBe(403);
        }
        expect((await sql('SELECT recovery_password_hash FROM organisations WHERE id = $1', [w.abc.id])).rows[0].recovery_password_hash).toBeNull();
    });

    it('needs the account password and a strong recovery password', async () => {
        expect((await setRecovery(w.tokens.owner, { current_password: 'Wrong12345', new_recovery_password: RECOVERY })).status).toBe(403);
        for (const weak of ['short1', 'lettersonly', '1234567890', '', 42]) {
            resetLimits();
            const res = await setRecovery(w.tokens.owner, { current_password: PASSWORD, new_recovery_password: weak });
            expect({ weak, status: res.status }).toEqual({ weak, status: 400 });
        }
        expect((await sql('SELECT recovery_password_hash FROM organisations WHERE id = $1', [w.abc.id])).rows[0].recovery_password_hash).toBeNull();
    });

    it('can be removed, after which recovery stops working', async () => {
        await ownerSets();
        expect((await recover({ company_name: 'ABC Health', password: RECOVERY })).status).toBe(200);
        const removed = await ownerSets(null);
        expect(removed.status).toBe(200);
        expect(removed.body.data.recovery_password_set_at).toBeNull();
        const res = await recover({ company_name: 'ABC Health', password: RECOVERY });
        expect(res.status).toBe(401);
    });

    it('is cleared when ownership is transferred', async () => {
        await ownerSets();
        const transfer = await request(app).post('/api/organisation/transfer-ownership').set(bearer(w.tokens.owner))
            .send({ user_id: w.users.sarah.id, current_password: PASSWORD });
        expect(transfer.status).toBe(200);
        expect((await recover({ company_name: 'ABC Health', password: RECOVERY })).status).toBe(401);
    });
});

describe('recovering the link', () => {
    beforeEach(async () => { await ownerSets(); });

    it('shows the current link for the right name and password, case-insensitively, and replaces nothing', async () => {
        for (const name of ['ABC Health', 'abc health', '  ABC HEALTH  ']) {
            const res = await recover({ company_name: name, password: RECOVERY });
            expect(res.status).toBe(200);
            expect(res.headers['cache-control']).toBe('no-store');
            expect(res.body.data.organisations).toEqual([
                { name: 'ABC Health', login_path: `/login/${w.abc.portalSlug}`, login_url: expect.stringMatching(new RegExp(`/login/${w.abc.portalSlug}$`)), expires_at: null, replaced: false },
            ]);
        }
        // The existing link still works and is unchanged.
        expect((await currentPortalLink(w.abc.id))!.token).toBe(w.abc.portalSlug);
        expect((await resolvePortalToken(w.abc.portalSlug)).status).toBe('valid');
        expect((await request(app).get(`/login/${w.abc.portalSlug}`)).status).toBe(200);
    });

    it('is not a sign-in: no session, no token, nothing else about the company', async () => {
        const before = (await sql('SELECT COUNT(*)::int AS n FROM sessions')).rows[0].n;
        const res = await recover({ company_name: 'ABC Health', password: RECOVERY });
        expect(res.status).toBe(200);
        expect((await sql('SELECT COUNT(*)::int AS n FROM sessions')).rows[0].n).toBe(before);
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(Object.keys(res.body.data)).toEqual(['organisations']);
        expect(Object.keys(res.body.data.organisations[0]).sort()).toEqual(['expires_at', 'login_path', 'login_url', 'name', 'replaced']);
        expect(JSON.stringify(res.body)).not.toContain(w.abc.id);
    });

    it('gives the same answer for a wrong password, an unknown company, a company without one, and bad input', async () => {
        const cases: Array<Record<string, unknown>> = [
            { company_name: 'ABC Health', password: 'Wrong12345' },
            { company_name: 'Nobody Ltd', password: RECOVERY },
            { company_name: 'XYZ Care', password: RECOVERY },  // exists, no recovery password set
            { company_name: 'ABC Health', password: PASSWORD }, // the owner's account password is not the recovery password
            { company_name: '', password: RECOVERY },
            { company_name: 'ABC Health' },
            { company_name: 42, password: RECOVERY },
            { company_name: 'x'.repeat(121), password: RECOVERY },
            {},
        ];
        for (const body of cases) {
            resetLimits();
            const res = await recover(body);
            expect({ body, status: res.status, error: res.body.error }).toEqual({
                body, status: 401, error: { code: 'RECOVERY_NOT_VERIFIED', message: GENERIC },
            });
            expect(JSON.stringify(res.body)).not.toMatch(/login\/|ABC Health|XYZ Care/);
        }
    });

    it('always runs a password comparison, whether or not the company exists', async () => {
        const spy = comparePasswordUniform as jest.Mock;
        spy.mockClear();
        await recover({ company_name: 'Nobody Ltd', password: RECOVERY });
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockClear();
        await recover({ company_name: 'ABC Health', password: 'Wrong12345' });
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('never matches an inactive company', async () => {
        await sql('UPDATE organisations SET is_active = false WHERE id = $1', [w.abc.id]);
        expect((await recover({ company_name: 'ABC Health', password: RECOVERY })).status).toBe(401);
    });

    it('keeps same-named companies apart: each answers only to its own recovery password', async () => {
        const other = await createUser('other@owner.test');
        const twin = await createOrganisation('ABC Health', other.id);
        const otherToken = await signIn(other.id, twin.id);
        expect((await setRecovery(otherToken, { current_password: PASSWORD, new_recovery_password: 'TwinRecover99' })).status).toBe(200);

        const mine = await recover({ company_name: 'abc health', password: RECOVERY });
        expect(mine.body.data.organisations.map((o: any) => o.login_path)).toEqual([`/login/${w.abc.portalSlug}`]);
        const theirs = await recover({ company_name: 'abc health', password: 'TwinRecover99' });
        expect(theirs.body.data.organisations.map((o: any) => o.login_path)).toEqual([`/login/${twin.portalSlug}`]);
    });

    it('replaces a link that has stopped working, and audits the lookup', async () => {
        await sql("UPDATE organisations SET portal_link_expires_at = NOW() - INTERVAL '1 day' WHERE id = $1", [w.abc.id]);
        const res = await recover({ company_name: 'ABC Health', password: RECOVERY });
        expect(res.status).toBe(200);
        const [org] = res.body.data.organisations;
        expect(org.replaced).toBe(true);
        expect(org.login_path).not.toBe(`/login/${w.abc.portalSlug}`);
        expect((await resolvePortalToken(org.login_path.replace('/login/', ''))).status).toBe('valid');
        const audit = await sql("SELECT action FROM audit_logs WHERE org_id = $1 AND action IN ('LOGIN_LINK_LOOKUP', 'LOGIN_LINK_ROTATED') ORDER BY created_at", [w.abc.id]);
        expect(audit.rows.map(r => r.action).sort()).toEqual(['LOGIN_LINK_LOOKUP', 'LOGIN_LINK_ROTATED']);
    });

    it('never stores the submitted password anywhere', async () => {
        await recover({ company_name: 'ABC Health', password: 'Wrong-Secret-777' });
        await recover({ company_name: 'ABC Health', password: RECOVERY });
        for (const table of ['audit_logs', 'login_history']) {
            const dump = JSON.stringify((await sql(`SELECT * FROM ${table}`)).rows);
            expect({ table, leaked: dump.includes('Wrong-Secret-777') || dump.includes(RECOVERY) }).toEqual({ table, leaked: false });
        }
    });
});

describe('rate limiting', () => {
    beforeEach(async () => { await ownerSets(); });
    const wrong = (name = 'ABC Health') => recover({ company_name: name, password: 'Wrong12345' });

    it('locks a company name after 5 failures, even for the right password, real company or not', async () => {
        for (const name of ['ABC Health', 'Nobody Ltd']) {
            resetLimits();
            for (let i = 0; i < 5; i++) expect((await wrong(name)).status).toBe(401);
            const locked = await recover({ company_name: name, password: RECOVERY });
            expect(locked.status).toBe(429);
            expect(locked.body.error.code).toBe('TOO_MANY_REQUESTS');
        }
    });

    it('counts the name case-insensitively, so changing case does not dodge it', async () => {
        for (const name of ['ABC Health', 'abc health', 'ABC HEALTH', ' Abc Health', 'aBc HeAlTh']) await wrong(name);
        expect((await recover({ company_name: 'ABC Health', password: RECOVERY })).status).toBe(429);
    });

    it('locks real and made-up names on the same schedule', async () => {
        const timeline = async (name: string) => {
            resetLimits();
            const seen: number[] = [];
            for (let i = 0; i < 7; i++) seen.push((await wrong(name)).status);
            return seen;
        };
        expect(await timeline('ABC Health')).toEqual(await timeline('Nobody Ltd'));
    });

    it('limits one client address across different company names', async () => {
        for (let i = 0; i < 10; i++) expect((await wrong(`Company ${i}`)).status).toBe(401);
        const blocked = await request(app).post('/api/recovery/company-link').set('X-Forwarded-For', '203.0.113.9')
            .send({ company_name: 'ABC Health', password: RECOVERY });
        expect(blocked.status).toBe(429);
    });

    it('does not let parallel guesses get past the limit', async () => {
        const results = await Promise.all(Array.from({ length: 20 }, () => wrong()));
        expect(results.filter(r => r.status === 401).length).toBeLessThanOrEqual(5);
        expect((await recover({ company_name: 'ABC Health', password: RECOVERY })).status).toBe(429);
    });

    it('a success clears the name’s failure count', async () => {
        for (let i = 0; i < 4; i++) await wrong();
        expect((await recover({ company_name: 'ABC Health', password: RECOVERY })).status).toBe(200);
        for (let i = 0; i < 4; i++) expect((await wrong()).status).toBe(401);
    });
});
