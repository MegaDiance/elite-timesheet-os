/**
 * Employees (workers): operational records managed by OWNER/BRANCH_ADMIN, never authenticated
 * accounts themselves. Create, edit, deactivate/reactivate, move between branches, and the
 * historical-record preservation rules around all of that. Real PostgreSQL, real sessions.
 */
import request from 'supertest';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { connectTestDb, resetTestDb, closeTestDb, sql } from './helpers/testDb';
import { PASSWORD, PERIOD, World, bearer, buildWorld, simpleDay } from './helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

describe('creating a worker', () => {
    it('creates a worker with the given fields, defaulting contracted hours', async () => {
        const res = await request(app).post('/api/employees').set(bearer(w.tokens.owner)).send({
            full_name: 'New Worker', location_id: w.abc.melbourne, department: 'Clinic', email: 'nw@abc.test', phone: '0400 000 000',
        });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ full_name: 'New Worker', location_id: w.abc.melbourne, department: 'Clinic', is_active: true });
        expect(Number(res.body.data.contracted_hours)).toBe(76);
    });

    it('rejects a missing name, a missing branch, a bad email, and a bad phone', async () => {
        const base = { full_name: 'X', location_id: w.abc.melbourne };
        const create = (body: object) => request(app).post('/api/employees').set(bearer(w.tokens.owner)).send(body);
        expect((await create({ location_id: w.abc.melbourne })).status).toBe(400);
        expect((await create({ full_name: 'No Branch' })).status).toBe(400);
        expect((await create({ ...base, email: 'not-an-email' })).status).toBe(400);
        expect((await create({ ...base, phone: 'call me maybe' })).status).toBe(400);
    });

    it('refuses a duplicate name in the same organisation, but allows it in a different one', async () => {
        const dup = await request(app).post('/api/employees').set(bearer(w.tokens.owner)).send({ full_name: 'Mel Worker', location_id: w.abc.richmond });
        expect(dup.status).toBe(409);
        const elsewhere = await request(app).post('/api/employees').set(bearer(w.tokens.xavier)).send({ full_name: 'Mel Worker', location_id: w.xyz.sydney });
        expect(elsewhere.status).toBe(201);
    });

    it('a Branch Admin cannot create a worker in a branch they are not assigned to', async () => {
        const res = await request(app).post('/api/employees').set(bearer(w.tokens.sarah)).send({ full_name: 'Out Of Scope', location_id: w.abc.geelong });
        expect(res.status).toBe(403);
    });

    it('never creates a login account: no user row, no password, for the new worker', async () => {
        const res = await request(app).post('/api/employees').set(bearer(w.tokens.owner)).send({ full_name: 'No Login', location_id: w.abc.melbourne });
        const asUser = await sql('SELECT 1 FROM users WHERE id = $1', [res.body.data.id]);
        expect(asUser.rows).toEqual([]);
        // Nothing accepts a worker id as a session subject: it simply is not a user, anywhere auth is checked.
        expect((await request(app).get('/api/auth/me').set(bearer(`Bearer ${res.body.data.id}`))).status).not.toBe(200);
    });
});

describe('editing a worker', () => {
    it('updates the given fields', async () => {
        const res = await request(app).put(`/api/employees/${w.workers.mel}`).set(bearer(w.tokens.owner))
            .send({ full_name: 'Mel Changed', location_id: w.abc.melbourne, department: 'Reception', contracted_hours: 60 });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ full_name: 'Mel Changed', department: 'Reception', contracted_hours: '60' });
    });

    it('a Branch Admin cannot edit a worker outside their branches, and a worker in another organisation 404s', async () => {
        expect((await request(app).put(`/api/employees/${w.workers.gee}`).set(bearer(w.tokens.sarah)).send({ full_name: 'x', location_id: w.abc.geelong })).status).toBe(403);
        expect((await request(app).put(`/api/employees/${w.workers.syd}`).set(bearer(w.tokens.owner)).send({ full_name: 'x', location_id: w.xyz.sydney })).status).toBe(404);
    });
});

describe('moving a worker between branches', () => {
    it('moves the worker and audits it, with no historical records to warn about yet', async () => {
        const res = await request(app).put(`/api/employees/${w.workers.mel}`).set(bearer(w.tokens.owner))
            .send({ full_name: 'Mel Worker', location_id: w.abc.richmond });
        expect(res.status).toBe(200);
        expect(res.body.data.location_id).toBe(w.abc.richmond);
        expect(res.body.data.historical_records_affected).toBe(0);
        const audit = await request(app).get('/api/audit').set(bearer(w.tokens.owner));
        expect(audit.body.data.some((a: any) => a.action === 'WORKER_MOVED')).toBe(true);
    });

    it('never touches the worker’s own past roster/timesheet rows, and reports how many exist', async () => {
        await request(app).post('/api/records').set(bearer(w.tokens.sarah))
            .send({ employee_id: w.workers.mel, record_date: '2026-03-30', ...simpleDay(true) });

        const before = await sql('SELECT id, employee_id FROM daily_records WHERE employee_id = $1', [w.workers.mel]);
        expect(before.rows).toHaveLength(1);

        const moved = await request(app).put(`/api/employees/${w.workers.mel}`).set(bearer(w.tokens.owner))
            .send({ full_name: 'Mel Worker', location_id: w.abc.richmond });
        expect(moved.body.data.historical_records_affected).toBe(1);

        // The row itself is untouched — same id, same employee_id, still there.
        const after = await sql('SELECT id, employee_id FROM daily_records WHERE employee_id = $1', [w.workers.mel]);
        expect(after.rows).toEqual(before.rows);
    });

    it('a Branch Admin cannot move a worker into a branch they are not assigned to', async () => {
        const res = await request(app).put(`/api/employees/${w.workers.mel}`).set(bearer(w.tokens.sarah))
            .send({ full_name: 'Mel Worker', location_id: w.abc.geelong });
        expect(res.status).toBe(403);
        expect((await sql('SELECT location_id FROM employees WHERE id = $1', [w.workers.mel])).rows[0].location_id).toBe(w.abc.melbourne);
    });

    it('sending the worker’s current branch is a no-op move (not audited as a move)', async () => {
        const res = await request(app).put(`/api/employees/${w.workers.mel}`).set(bearer(w.tokens.owner))
            .send({ full_name: 'Mel Worker', location_id: w.abc.melbourne });
        expect(res.body.data.historical_records_affected).toBe(0);
        const audit = await request(app).get('/api/audit').set(bearer(w.tokens.owner));
        expect(audit.body.data.some((a: any) => a.action === 'WORKER_MOVED')).toBe(false);
    });
});

describe('deactivating and reactivating', () => {
    it('a deactivated worker drops out of the default list but keeps every past record', async () => {
        await request(app).post('/api/records').set(bearer(w.tokens.sarah))
            .send({ employee_id: w.workers.mel, record_date: '2026-03-30', ...simpleDay(true) });

        expect((await request(app).post(`/api/employees/${w.workers.mel}/deactivate`).set(bearer(w.tokens.sarah))).status).toBe(200);

        const active = await request(app).get('/api/employees').set(bearer(w.tokens.sarah));
        expect(active.body.data.map((e: any) => e.id)).not.toContain(w.workers.mel);

        const withInactive = await request(app).get('/api/employees?include_inactive=true').set(bearer(w.tokens.sarah));
        const mel = withInactive.body.data.find((e: any) => e.id === w.workers.mel);
        expect(mel).toMatchObject({ is_active: false, status: 'Inactive' });

        const records = await request(app).get(`/api/records?start_date=${PERIOD}&employee_id=${w.workers.mel}`).set(bearer(w.tokens.sarah));
        expect(records.body.data).toHaveLength(1);
    });

    it('reactivating brings the worker back into the default list', async () => {
        await request(app).post(`/api/employees/${w.workers.mel}/deactivate`).set(bearer(w.tokens.sarah));
        expect((await request(app).post(`/api/employees/${w.workers.mel}/reactivate`).set(bearer(w.tokens.sarah))).status).toBe(200);
        const active = await request(app).get('/api/employees').set(bearer(w.tokens.sarah));
        expect(active.body.data.map((e: any) => e.id)).toContain(w.workers.mel);
    });

    it('an inactive worker cannot be rostered or timesheeted', async () => {
        await request(app).post(`/api/employees/${w.workers.mel}/deactivate`).set(bearer(w.tokens.sarah));
        const res = await request(app).post('/api/records').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, record_date: '2026-03-30', ...simpleDay() });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('WORKER_INACTIVE');
    });
});

describe('deleting a worker', () => {
    it('permanently deletes a worker with no approved timesheets', async () => {
        const res = await request(app).delete(`/api/employees/${w.workers.gee}`).set(bearer(w.tokens.owner));
        expect(res.status).toBe(200);
        expect((await sql('SELECT 1 FROM employees WHERE id = $1', [w.workers.gee])).rows).toEqual([]);
    });

    it('refuses to delete a worker with an approved timesheet — deactivate instead', async () => {
        await request(app).post('/api/records').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, record_date: '2026-03-30', ...simpleDay(true) });
        await request(app).post('/api/submissions/approve').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, start_date: PERIOD });

        const res = await request(app).delete(`/api/employees/${w.workers.mel}`).set(bearer(w.tokens.sarah));
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('WORKER_HAS_APPROVED_TIMESHEETS');
        expect((await sql('SELECT 1 FROM employees WHERE id = $1', [w.workers.mel])).rows).toHaveLength(1);
    });
});

describe('employees are not accounts', () => {
    it('logging in as a worker’s email fails — there is no account, only a name on the worker record', async () => {
        await request(app).put(`/api/employees/${w.workers.mel}`).set(bearer(w.tokens.owner))
            .send({ full_name: 'Mel Worker', location_id: w.abc.melbourne, email: 'mel@abc.test' });
        const res = await request(app).post('/api/auth/login').send({ email: 'mel@abc.test', password: PASSWORD, organisation_slug: w.abc.portalSlug });
        expect(res.status).toBe(401);
    });

    it('a worker’s stored email column is separate from the users table entirely', async () => {
        const worker = await sql('SELECT email FROM employees WHERE id = $1', [w.workers.mel]);
        const asUser = await sql('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)', [worker.rows[0].email || 'mel-worker-has-no-email@abc.test']);
        expect(asUser.rows).toEqual([]);
    });
});

describe('workers appear throughout the product', () => {
    it('an active worker is available to roster, timesheets and the payroll report', async () => {
        expect((await request(app).get('/api/employees').set(bearer(w.tokens.sarah))).body.data.map((e: any) => e.id)).toContain(w.workers.mel);
        await request(app).post('/api/records').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, record_date: '2026-03-30', ...simpleDay(true) });
        const report = await request(app).get(`/api/reports/payroll?start_date=${PERIOD}`).set(bearer(w.tokens.sarah));
        expect(report.body.data.employees.some((r: any) => r.employee_id === w.workers.mel)).toBe(true);
        const dash = await request(app).get(`/api/dashboard/today?location_id=${w.abc.melbourne}&date=2026-03-30`).set(bearer(w.tokens.sarah));
        expect(dash.body.data.scheduled_today.some((s: any) => s.employee_id === w.workers.mel)).toBe(true);
    });
});
