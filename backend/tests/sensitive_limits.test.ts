/**
 * Gaps closed in the security review:
 *   - sign-in failures are also limited per address, so one password can't be sprayed over many accounts;
 *   - every step that re-checks a signed-in person's password (two-step verification, locks,
 *     security settings) shares the sign-in page's per-account budget;
 *   - every API response is marked no-store;
 *   - values that come from request headers are escaped in emails.
 */
import request from 'supertest';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { buildSuspiciousLoginVerificationTemplate } from '../src/services/emailService';
import { connectTestDb, resetTestDb, closeTestDb } from './helpers/testDb';
import { PASSWORD, PERIOD, World, bearer, buildWorld } from './helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

const WRONG = 'Wrong12345';

it('30 failed sign-ins from one address, across different emails, stop the next one, even with a right password', async () => {
    for (let i = 0; i < 30; i++) {
        const res = await request(app).post('/api/auth/login').send({ email: `nobody${i}@nowhere.test`, password: WRONG, organisation_slug: w.abc.portalSlug });
        expect(res.status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ email: w.users.sarah.email, password: PASSWORD, organisation_slug: w.abc.portalSlug });
    expect(blocked.status).toBe(429);
});

it('turning two-step verification off counts wrong passwords like the sign-in page does', async () => {
    const off = (password: string) => request(app).post('/api/auth/2fa/disable').set(bearer(w.tokens.sarah)).send({ password });
    for (let i = 0; i < 5; i++) expect((await off(WRONG)).status).toBe(401);
    expect((await off(PASSWORD)).status).toBe(429);
    // The sign-in page shares the same budget.
    const login = await request(app).post('/api/auth/login').send({ email: w.users.sarah.email, password: PASSWORD, organisation_slug: w.abc.portalSlug });
    expect(login.status).toBe(429);
});

it('lock changes count wrong passwords too', async () => {
    const lock = (password: string) => request(app).post('/api/locks').set(bearer(w.tokens.owner))
        .send({ location_id: w.abc.melbourne, start_date: PERIOD, timesheet_locked: true, password });
    for (let i = 0; i < 5; i++) expect((await lock(WRONG)).status).toBe(403);
    expect((await lock(PASSWORD)).status).toBe(429);
});

it('changing lock passwords counts wrong current passwords', async () => {
    const change = (current_password: string) => request(app).put('/api/organisation/lock-passwords').set(bearer(w.tokens.owner))
        .send({ current_password, new_roster_lock_password: 'roster-pass' });
    for (let i = 0; i < 5; i++) expect((await change(WRONG)).status).toBe(403);
    expect((await change(PASSWORD)).status).toBe(429);
});

it('every API response is marked no-store, including errors', async () => {
    for (const res of [
        await request(app).get('/api/auth/me').set(bearer(w.tokens.sarah)),
        await request(app).get('/api/employees').set(bearer(w.tokens.sarah)),
        await request(app).get('/api/organisation/me').set(bearer(w.tokens.owner)),
        await request(app).get('/api/employees'),
    ]) {
        expect(res.headers['cache-control']).toBe('no-store');
    }
});

it('the new-sign-in email escapes the location and device it was told about', () => {
    const mail = buildSuspiciousLoginVerificationTemplate({
        recipientEmail: 'a<b>@x.test', verifyLink: 'https://x.test/verify', verificationCode: '123456',
        approxLocation: '<img src=x onerror=alert(1)>', deviceInfo: '<script>alert(1)</script>',
    });
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).not.toContain('<script>alert');
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
});
