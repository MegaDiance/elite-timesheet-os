/**
 * The three workforce settings (employees_can_submit_timesheets, automatically_merge_leave_
 * with_roster, leave_requests_require_approval) are readable by any signed-in account and
 * writable by Owner or Branch Admin — unlike every other organisation setting, which stays
 * Owner-only. This is the one endpoint with two authorisation tiers in one request body.
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

const settings = async (token: string, body: object) => request(app).put('/api/organisation/settings').set(bearer(token)).send(body);

describe('reading the workforce settings', () => {
    it('defaults match the migration: submission on, merge and approval-required on their documented defaults', async () => {
        const res = await request(app).get('/api/organisation/me').set(bearer(w.tokens.owner));
        expect(res.body.data).toMatchObject({
            employees_can_submit_timesheets: true,
            automatically_merge_leave_with_roster: false,
            leave_requests_require_approval: true,
        });
    });

    it('an employee can read them too (the portal needs employees_can_submit_timesheets)', async () => {
        const res = await request(app).get('/api/organisation/me').set(bearer(w.tokens.melEmployee));
        expect(res.status).toBe(200);
        expect(res.body.data.employees_can_submit_timesheets).toBe(true);
    });
});

describe('writing the workforce settings', () => {
    it('an Owner can turn each one off', async () => {
        const res = await settings(w.tokens.owner, { employees_can_submit_timesheets: false, automatically_merge_leave_with_roster: true, leave_requests_require_approval: false });
        expect(res.status).toBe(200);
        const row = (await sql('SELECT employees_can_submit_timesheets, automatically_merge_leave_with_roster, leave_requests_require_approval FROM organisations WHERE id = $1', [w.abc.id])).rows[0];
        expect(row).toEqual({ employees_can_submit_timesheets: false, automatically_merge_leave_with_roster: true, leave_requests_require_approval: false });
    });

    it('a Branch Admin can also change them, unlike every other organisation setting', async () => {
        const res = await settings(w.tokens.sarah, { employees_can_submit_timesheets: false });
        expect(res.status).toBe(200);
        expect((await sql('SELECT employees_can_submit_timesheets FROM organisations WHERE id = $1', [w.abc.id])).rows[0].employees_can_submit_timesheets).toBe(false);
    });

    it('an employee cannot change them', async () => {
        const res = await settings(w.tokens.melEmployee, { employees_can_submit_timesheets: false });
        expect(res.status).toBe(403);
        expect((await sql('SELECT employees_can_submit_timesheets FROM organisations WHERE id = $1', [w.abc.id])).rows[0].employees_can_submit_timesheets).toBe(true);
    });

    it('a Branch Admin cannot smuggle an Owner-only field in alongside a workforce boolean — nothing is applied', async () => {
        const res = await settings(w.tokens.sarah, { employees_can_submit_timesheets: false, break_mins_weekday: 45 });
        expect(res.status).toBe(403);
        const row = (await sql('SELECT employees_can_submit_timesheets, break_mins_weekday FROM organisations WHERE id = $1', [w.abc.id])).rows[0];
        expect(row.employees_can_submit_timesheets).toBe(true);
        expect(Number(row.break_mins_weekday)).not.toBe(45);
    });

    it('a Branch Admin still cannot change Owner-only fields alone', async () => {
        const res = await settings(w.tokens.sarah, { break_mins_weekday: 45 });
        expect(res.status).toBe(403);
    });

    it('rejects a non-boolean value', async () => {
        const res = await settings(w.tokens.owner, { employees_can_submit_timesheets: 'false' });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('an outsider (another organisation) cannot reach in', async () => {
        const res = await settings(w.tokens.xavier, { employees_can_submit_timesheets: false });
        expect(res.status).toBe(200); // xavier is Owner of his own org — this only ever touches his own orgId
        expect((await sql('SELECT employees_can_submit_timesheets FROM organisations WHERE id = $1', [w.abc.id])).rows[0].employees_can_submit_timesheets).toBe(true);
    });
});
