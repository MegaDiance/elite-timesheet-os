/**
 * Endpoints added for the usability work: navigation attention counts and walkthrough progress.
 * Both must respect the same scoping as everything else — counts only from branches the caller
 * may act in, progress only for the caller's own account.
 */
import request from 'supertest';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { connectTestDb, resetTestDb, closeTestDb, sql } from './helpers/testDb';
import { World, bearer, buildWorld } from './helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

const pendingLeave = (workerId: string, branchId: string) =>
    sql(`INSERT INTO leave_requests (org_id, employee_id, location_id, leave_type, start_date, end_date, hours, status)
         VALUES ($1, $2, $3, 'Annual', '2026-10-05', '2026-10-05', 7.6, 'Pending')`, [w.abc.id, workerId, branchId]);
const attention = (token: string, branchId?: string) =>
    request(app).get(`/api/dashboard/attention${branchId ? `?location_id=${branchId}` : ''}`).set(bearer(token));

describe('GET /dashboard/attention', () => {
    it('counts only the branches the caller manages', async () => {
        await pendingLeave(w.workers.mel, w.abc.melbourne);
        await pendingLeave(w.workers.gee, w.abc.geelong);

        const owner = await attention(w.tokens.owner);
        expect(owner.body.data.leave_pending).toBe(2);
        expect(owner.body.data.timesheets_waiting).toBe(3); // Mel, Rich, Gee — none approved

        const sarah = await attention(w.tokens.sarah); // Melbourne + Richmond
        expect(sarah.body.data.leave_pending).toBe(1);
        expect(sarah.body.data.timesheets_waiting).toBe(2);

        const greg = await attention(w.tokens.greg); // Geelong only
        expect(greg.body.data.leave_pending).toBe(1);
        expect(greg.body.data.timesheets_waiting).toBe(1);
    });

    it('a branch filter outside the caller’s branches is refused, not silently widened', async () => {
        expect((await attention(w.tokens.greg, w.abc.melbourne)).status).toBe(403);
        expect([403, 404]).toContain((await attention(w.tokens.sarah, w.xyz.sydney)).status);
    });

    it('employees and signed-out visitors get nothing', async () => {
        expect((await attention(w.tokens.melEmployee)).status).toBe(403);
        expect((await request(app).get('/api/dashboard/attention')).status).toBe(401);
    });

    it('an approved timesheet is no longer counted as waiting', async () => {
        const current = (await attention(w.tokens.owner)).body.data.fortnight_start;
        await sql("INSERT INTO timesheet_submissions (org_id, employee_id, start_date, status) VALUES ($1, $2, $3, 'Approved')", [w.abc.id, w.workers.mel, current]);
        expect((await attention(w.tokens.owner)).body.data.timesheets_waiting).toBe(2);
    });
});

describe('PUT /auth/me/tutorial', () => {
    it('records the walkthrough for the caller only, and /auth/me reports it', async () => {
        expect((await request(app).get('/api/auth/me').set(bearer(w.tokens.sarah))).body.data.user.tutorial_version).toBeNull();
        const res = await request(app).put('/api/auth/me/tutorial').set(bearer(w.tokens.sarah)).send({ version: 2 });
        expect(res.status).toBe(200);
        expect((await request(app).get('/api/auth/me').set(bearer(w.tokens.sarah))).body.data.user.tutorial_version).toBe(2);
        expect((await request(app).get('/api/auth/me').set(bearer(w.tokens.greg))).body.data.user.tutorial_version).toBeNull();
    });

    it('works for employees too, and rejects nonsense', async () => {
        expect((await request(app).put('/api/auth/me/tutorial').set(bearer(w.tokens.melEmployee)).send({ version: 2 })).status).toBe(200);
        for (const version of [0, -1, 1.5, '2', null, 100000]) {
            expect((await request(app).put('/api/auth/me/tutorial').set(bearer(w.tokens.sarah)).send({ version })).status).toBe(400);
        }
        expect((await request(app).put('/api/auth/me/tutorial').send({ version: 2 })).status).toBe(401);
    });
});
