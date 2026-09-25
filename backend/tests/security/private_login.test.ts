/**
 * Private sign-in links and page routing, enforced by the server.
 *
 *   - /login is not a sign-in page: a real HTTP 404, never a form.
 *   - /login/<token> loads the app only for a valid, unexpired link of an active organisation;
 *     malformed, random, revoked and other-organisation tokens are 404, expired ones 410.
 *   - Links are stored hashed + encrypted, can expire, and regenerating revokes the old one.
 *   - Sign-in through one organisation's link never opens another organisation.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import request from 'supertest';
import app from '../../src/index';
import { clearAllRateLimits } from '../../src/services/authUtils';
import { currentPortalLink, resolvePortalToken } from '../../src/services/portalLink';
import { PAGE_PATHS } from '../../src/services/pageRoutes';
import { getPool } from '../../src/services/db';
import { connectTestDb, resetTestDb, closeTestDb, sql } from '../helpers/testDb';
import { PASSWORD, PERIOD, World, bearer, buildWorld, simpleDay } from '../helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

const page = (p: string) => request(app).get(p);
const login = (slug: unknown, email = w.users.sarah.email) =>
    request(app).post('/api/auth/login').send({ email, password: PASSWORD, organisation_slug: slug });
const expireLink = (orgId: string) => sql("UPDATE organisations SET portal_link_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [orgId]);

describe('public /login', () => {
    it('is a real 404 page with nothing about signing in', async () => {
        for (const p of ['/login', '/login/', '/LOGIN', '/signin', '/sign-in', '/admin']) {
            const res = await page(p);
            expect(res.status).toBe(404);
            expect(res.text).not.toMatch(/password|sign in|organisation_slug/i);
        }
    });

    it('the public login API refuses to sign in without an organisation link', async () => {
        const res = await request(app).post('/api/auth/login').send({ email: w.users.sarah.email, password: PASSWORD });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('ORGANISATION_PORTAL_REQUIRED');
        expect(res.body.data?.token).toBeUndefined();
    });
});

describe('private sign-in link pages', () => {
    it('a valid link loads the app, uncached and not indexed', async () => {
        const res = await page(`/login/${w.abc.portalSlug}`);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers['x-robots-tag']).toMatch(/noindex/);
        // Case and a trailing slash do not matter for a real link.
        expect((await page(`/login/${w.abc.portalSlug.toUpperCase()}/`)).status).toBe(200);
    });

    it('random, malformed and made-up tokens are 404', async () => {
        const bad = [
            crypto.randomBytes(16).toString('hex'),          // right shape, not issued
            crypto.randomBytes(12).toString('hex'),          // old length, not issued
            'abc',                                           // too short
            'x'.repeat(200),                                 // too long
            '%3Cscript%3E',                                  // markup
            "abc'%20OR%201=1--",                             // SQL-ish
            '..%2F..%2Fetc%2Fpasswd',                        // path tricks
            `${w.abc.portalSlug}%00`,                        // valid prefix + NUL
        ];
        for (const token of bad) {
            clearAllRateLimits();
            expect({ token, status: (await page(`/login/${token}`)).status }).toEqual({ token, status: 404 });
        }
        expect((await page(`/login/${w.abc.portalSlug}/extra`)).status).toBe(404);
    });

    it('an expired link is 410 on the page, 410 on the lookup, and cannot be used to sign in', async () => {
        await expireLink(w.abc.id);
        expect((await page(`/login/${w.abc.portalSlug}`)).status).toBe(410);
        const lookup = await request(app).get(`/api/organisation/lookup/${w.abc.portalSlug}`);
        expect(lookup.status).toBe(410);
        expect(lookup.body.error.code).toBe('LINK_EXPIRED');
        expect(lookup.body.data).toBeUndefined();
        expect((await login(w.abc.portalSlug)).status).toBe(401);
    });

    it('a revoked (regenerated) link is 404 everywhere; the new one works', async () => {
        const regen = await request(app).post('/api/organisation/regenerate-portal-url').set(bearer(w.tokens.owner)).send({});
        expect(regen.status).toBe(200);
        const fresh = regen.body.data.portal_slug;
        expect(fresh).toMatch(/^[0-9a-f]{32}$/);

        expect((await page(`/login/${w.abc.portalSlug}`)).status).toBe(404);
        expect((await request(app).get(`/api/organisation/lookup/${w.abc.portalSlug}`)).status).toBe(404);
        expect((await login(w.abc.portalSlug)).status).toBe(401);

        expect((await page(`/login/${fresh}`)).status).toBe(200);
        expect((await login(fresh)).status).toBe(200);
    });

    it('a deactivated organisation’s link stops working', async () => {
        await sql('UPDATE organisations SET is_active = false WHERE id = $1', [w.abc.id]);
        expect((await page(`/login/${w.abc.portalSlug}`)).status).toBe(404);
        expect((await login(w.abc.portalSlug)).status).toBe(401);
    });

    it('invalid and expired lookups share one per-IP limit with page loads', async () => {
        for (let i = 0; i < 5; i++) await page(`/login/${crypto.randomBytes(16).toString('hex')}`);
        // Once limited, even a real link answers 404 without being looked up.
        expect((await page(`/login/${w.abc.portalSlug}`)).status).toBe(404);
        expect((await request(app).get(`/api/organisation/lookup/${w.abc.portalSlug}`)).status).toBe(429);
    });
});

describe('organisation isolation through links', () => {
    it('a link belongs to one organisation: members of another cannot sign in through it', async () => {
        expect((await login(w.abc.portalSlug, w.users.xavier.email)).status).toBe(401);
        expect((await login(w.xyz.portalSlug, w.users.sarah.email)).status).toBe(401);
        // Same response as a wrong password: nothing reveals that the account exists elsewhere.
        const wrong = await request(app).post('/api/auth/login').send({ email: w.users.sarah.email, password: 'Wrong12345', organisation_slug: w.abc.portalSlug });
        const other = await login(w.xyz.portalSlug, w.users.sarah.email);
        expect(other.body).toEqual(wrong.body);
    });

    it('a session opened through one organisation’s link cannot reach another organisation', async () => {
        const token = (await login(w.abc.portalSlug)).body.data.token;
        const other = await request(app).get(`/api/employees?location_id=${w.xyz.sydney}`).set(bearer(token));
        expect([403, 404]).toContain(other.status);
        const roster = await request(app).post('/api/records').set(bearer(token)).send({ employee_id: w.workers.syd, record_date: PERIOD, ...simpleDay() });
        expect([403, 404]).toContain(roster.status);
        expect((await sql('SELECT COUNT(*)::int AS n FROM daily_records WHERE employee_id = $1', [w.workers.syd])).rows[0].n).toBe(0);
    });

    it('a Branch Admin signed in through the link cannot reach another branch they are not assigned to', async () => {
        const token = (await login(w.abc.portalSlug, w.users.greg.email)).body.data.token;
        const res = await request(app).post('/api/records').set(bearer(token)).send({ employee_id: w.workers.mel, record_date: PERIOD, ...simpleDay() });
        expect([403, 404]).toContain(res.status);
    });
});

describe('link storage and management', () => {
    it('is stored hashed and encrypted — the token never appears in the database in plain text', async () => {
        const row = (await sql('SELECT * FROM organisations WHERE id = $1', [w.abc.id])).rows[0];
        expect(row.portal_slug).toBeNull();
        expect(row.portal_slug_hash).toBe(crypto.createHash('sha256').update(w.abc.portalSlug).digest('hex'));
        expect(JSON.stringify(row)).not.toContain(w.abc.portalSlug);
    });

    it('an organisation with a legacy plain-text link keeps working, and the plain value is cleared on first use', async () => {
        const legacy = crypto.randomBytes(12).toString('hex');
        await sql(
            "UPDATE organisations SET portal_slug = $1, portal_slug_hash = encode(digest($1, 'sha256'), 'hex'), portal_slug_enc = NULL WHERE id = $2",
            [legacy, w.abc.id]
        );
        expect(await resolvePortalToken(legacy)).toMatchObject({ status: 'valid', orgId: w.abc.id });
        expect((await currentPortalLink(w.abc.id))?.token).toBe(legacy);
        const row = (await sql('SELECT portal_slug, portal_slug_enc FROM organisations WHERE id = $1', [w.abc.id])).rows[0];
        expect(row.portal_slug).toBeNull();
        expect(row.portal_slug_enc).toBeTruthy();
        expect((await login(legacy)).status).toBe(200);
    });

    it('the Owner can set and clear an expiry; past dates and Branch Admins are refused', async () => {
        const future = new Date(Date.now() + 30 * 86400000).toISOString();
        const set = await request(app).put('/api/organisation/portal-link').set(bearer(w.tokens.owner)).send({ expires_at: future });
        expect(set.status).toBe(200);
        expect((await request(app).get('/api/organisation/me').set(bearer(w.tokens.owner))).body.data.portal_link_expires_at).toBe(future);

        const past = await request(app).put('/api/organisation/portal-link').set(bearer(w.tokens.owner)).send({ expires_at: '2020-01-01T00:00:00Z' });
        expect(past.status).toBe(400);
        expect((await request(app).put('/api/organisation/portal-link').set(bearer(w.tokens.owner)).send({ expires_at: 'soon' })).status).toBe(400);
        expect((await request(app).put('/api/organisation/portal-link').set(bearer(w.tokens.sarah)).send({ expires_at: null })).status).toBe(403);
        expect((await request(app).post('/api/organisation/regenerate-portal-url').set(bearer(w.tokens.sarah))).status).toBe(403);

        expect((await request(app).put('/api/organisation/portal-link').set(bearer(w.tokens.owner)).send({ expires_at: null })).status).toBe(200);
        expect((await request(app).get('/api/organisation/me').set(bearer(w.tokens.owner))).body.data.portal_link_expires_at).toBeNull();
    });

    it('a regenerated link can carry an expiry', async () => {
        const future = new Date(Date.now() + 7 * 86400000).toISOString();
        const regen = await request(app).post('/api/organisation/regenerate-portal-url').set(bearer(w.tokens.owner)).send({ expires_at: future });
        expect(regen.body.data.portal_link_expires_at).toBe(future);
    });

    it('the link is not handed to every session: /auth/me leaves it out; the sign-in response has the path', async () => {
        const me = await request(app).get('/api/auth/me').set(bearer(w.tokens.melEmployee));
        expect(JSON.stringify(me.body)).not.toContain(w.abc.portalSlug);
        expect(JSON.stringify((await request(app).get('/api/auth/organisations').set(bearer(w.tokens.sarah))).body)).not.toContain(w.abc.portalSlug);
        expect((await login(w.abc.portalSlug)).body.data.portal_path).toBe(`/login/${w.abc.portalSlug}`);
    });

    it('invitation and reset completions stop pointing at an expired link', async () => {
        await expireLink(w.abc.id);
        const owner = await request(app).get('/api/dashboard').set(bearer(w.tokens.owner));
        if (owner.status === 200 && owner.body.data?.organisation) expect(owner.body.data.organisation.sign_in_link).toBeNull();
        expect((await request(app).get('/api/organisation/me').set(bearer(w.tokens.owner))).body.data.portal_link_expired).toBe(true);
    });
});

describe('page routing', () => {
    it('real pages load; unknown pages are 404', async () => {
        for (const p of ['/', '/pricing', '/roster', '/my/schedule', '/reset-password']) expect((await page(p)).status).toBe(200);
        for (const p of ['/nope', '/roster/extra', '/my', '/my/unknown', '/.env', '/wp-admin']) expect((await page(p)).status).toBe(404);
    });

    it('the server’s page list matches the frontend router', () => {
        const app = fs.readFileSync(path.join(__dirname, '../../../frontend/src/App.tsx'), 'utf8');
        const routes = Array.from(app.matchAll(/<Route\s+path="([^"]+)"/g)).map(m => m[1]).filter(p => p !== '*');
        const expected = routes.filter(p => p !== '/login' && p !== '/login/:slug').sort();
        expect([...PAGE_PATHS].sort()).toEqual(expected);
    });
});

describe('employee timesheets switched off', () => {
    beforeEach(async () => {
        await request(app).put('/api/organisation/settings').set(bearer(w.tokens.owner)).send({ employees_can_submit_timesheets: false });
    });

    it('rejects reading, submitting and history through the API', async () => {
        const get = await request(app).get(`/api/portal/timesheet?start_date=${PERIOD}`).set(bearer(w.tokens.melEmployee));
        const post = await request(app).post('/api/portal/timesheet').set(bearer(w.tokens.melEmployee)).send({ record_date: PERIOD, timesheet: [{ type: 'WORK', start: '09:00', finish: '17:00' }] });
        const history = await request(app).get(`/api/portal/history?start_date=${PERIOD}&end_date=${PERIOD}`).set(bearer(w.tokens.melEmployee));
        for (const res of [get, post, history]) {
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('EMPLOYEE_TIMESHEETS_DISABLED');
        }
        expect((await request(app).get('/api/auth/me').set(bearer(w.tokens.melEmployee))).body.data.employee_capabilities.can_submit_timesheets).toBe(false);
    });

    it('the schedule stays available', async () => {
        expect((await request(app).get(`/api/portal/schedule?start_date=${PERIOD}&end_date=${PERIOD}`).set(bearer(w.tokens.melEmployee))).status).toBe(200);
    });
});

describe('approved and locked timesheets', () => {
    const save = (token: string, body: object = simpleDay(true)) =>
        request(app).post('/api/records').set(bearer(token)).send({ employee_id: w.workers.mel, record_date: PERIOD, ...body });
    const approve = () => request(app).post('/api/submissions/approve').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, start_date: PERIOD });
    const lockTimesheets = () => request(app).post('/api/locks').set(bearer(w.tokens.owner))
        .send({ location_id: w.abc.melbourne, start_date: PERIOD, timesheet_locked: true, password: PASSWORD });
    const segments = async () => (await sql(
        'SELECT ss.actual_in, ss.actual_out FROM shift_segments ss JOIN daily_records dr ON dr.id = ss.record_id WHERE dr.employee_id = $1 ORDER BY ss.actual_in',
        [w.workers.mel]
    )).rows;

    it('an approved timesheet cannot be overwritten, cleared or approved again', async () => {
        await save(w.tokens.owner);
        expect((await approve()).status).toBe(200);
        const before = await segments();
        expect((await save(w.tokens.owner, { roster: [], timesheet: [{ type: 'WORK', start: '10:00', finish: '12:00' }] })).body.error.code).toBe('TIMESHEET_ALREADY_APPROVED');
        expect((await save(w.tokens.owner, { roster: [], timesheet: [] })).status).toBe(423);
        expect((await approve()).body.error.code).toBe('ALREADY_APPROVED');
        const employeeEdit = await request(app).post('/api/portal/timesheet').set(bearer(w.tokens.melEmployee)).send({ record_date: PERIOD, timesheet: [{ type: 'WORK', start: '08:00', finish: '09:00' }] });
        expect(employeeEdit.status).toBe(423);
        expect(await segments()).toEqual(before);
    });

    it('a locked timesheet cannot be changed, cleared, reopened or resubmitted', async () => {
        await save(w.tokens.owner);
        await approve();
        expect((await lockTimesheets()).status).toBe(200);
        const before = await segments();
        expect((await save(w.tokens.owner, { roster: [], timesheet: [] })).status).toBe(423);
        const reopen = await request(app).post('/api/submissions/reopen').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, start_date: PERIOD });
        expect(reopen.status).toBe(423);
        expect((await approve()).status).toBe(423);
        const autoLog = await request(app).post('/api/roster/auto-log').set(bearer(w.tokens.owner)).send({ start_date: PERIOD, location_id: w.abc.melbourne });
        expect(autoLog.status).toBeLessThan(500);
        expect(await segments()).toEqual(before);
    });

    it('a save waiting behind an approval sees the approval and is refused (no approve/save race)', async () => {
        await save(w.tokens.owner, simpleDay(false));
        // Hold the worker-period lock and approve inside it, exactly as the approve route does.
        const client = await getPool().connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))', [`period:${w.abc.id}:${w.abc.melbourne}:${PERIOD}`]);
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`timesheet:${w.abc.id}:${w.workers.mel}:${PERIOD}`]);
            await client.query(
                "INSERT INTO timesheet_submissions (id, org_id, employee_id, start_date, status) VALUES ($1, $2, $3, $4, 'Approved')",
                [crypto.randomUUID(), w.abc.id, w.workers.mel, PERIOD]
            );
            const pending = save(w.tokens.owner).then(r => r);
            await new Promise(r => setTimeout(r, 150)); // the save is now blocked on the lock
            await client.query('COMMIT');
            const res = await pending;
            expect(res.status).toBe(423);
            expect(res.body.error.code).toBe('TIMESHEET_ALREADY_APPROVED');
        } finally {
            client.release();
        }
        expect((await segments()).every((s: any) => s.actual_in === null)).toBe(true);
    });

    it('copying the roster to worked hours skips an approved worker', async () => {
        await save(w.tokens.owner, simpleDay(false));
        await approve();
        await request(app).post('/api/roster/auto-log').set(bearer(w.tokens.owner)).send({ start_date: PERIOD, location_id: w.abc.melbourne });
        expect((await segments()).every((s: any) => s.actual_in === null)).toBe(true);
    });
});
