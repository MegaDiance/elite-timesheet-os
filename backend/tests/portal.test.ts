/**
 * Employee self-service portal: schedule, timesheet and history reads, all scoped to the
 * caller's own worker record (req.auth.employeeId), never a client-supplied id.
 */
import request from 'supertest';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { connectTestDb, resetTestDb, closeTestDb, sql } from './helpers/testDb';
import { PERIOD, World, bearer, buildWorld, simpleDay } from './helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

describe('GET /portal/schedule', () => {
    it('returns only the caller\'s own rostered shifts, never the timesheet side', async () => {
        await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, record_date: PERIOD, ...simpleDay(true) });
        const res = await request(app).get(`/api/portal/schedule?start_date=${PERIOD}&end_date=${PERIOD}`).set(bearer(w.tokens.melEmployee));
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([{ record_date: PERIOD, roster: [{ type: 'WORK', start: '09:00', finish: '17:00', hours: 8, has_break: true }] }]);
        expect(JSON.stringify(res.body)).not.toMatch(/timesheet/);
    });

    it('never returns another worker\'s data, even in the same branch', async () => {
        await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.rich, record_date: PERIOD, ...simpleDay() });
        const res = await request(app).get(`/api/portal/schedule?start_date=${PERIOD}&end_date=${PERIOD}`).set(bearer(w.tokens.melEmployee));
        expect(res.body.data).toEqual([]);
    });

    it('rejects a range over the cap, and requires valid dates', async () => {
        expect((await request(app).get(`/api/portal/schedule?start_date=${PERIOD}&end_date=2026-06-01`).set(bearer(w.tokens.melEmployee))).status).toBe(400);
        expect((await request(app).get('/api/portal/schedule?start_date=not-a-date&end_date=2026-04-01').set(bearer(w.tokens.melEmployee))).status).toBe(400);
    });

    it('an Owner or Branch Admin token is refused (this route is employee-only)', async () => {
        expect((await request(app).get(`/api/portal/schedule?start_date=${PERIOD}&end_date=${PERIOD}`).set(bearer(w.tokens.owner))).status).toBe(403);
        expect((await request(app).get(`/api/portal/schedule?start_date=${PERIOD}&end_date=${PERIOD}`).set(bearer(w.tokens.sarah))).status).toBe(403);
    });
});

describe('GET /portal/timesheet', () => {
    it('returns the caller\'s own roster and timesheet for one fortnight', async () => {
        await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, record_date: PERIOD, ...simpleDay(true) });
        const res = await request(app).get(`/api/portal/timesheet?start_date=${PERIOD}`).set(bearer(w.tokens.melEmployee));
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([{
            record_date: PERIOD,
            roster: [{ type: 'WORK', start: '09:00', finish: '17:00', hours: 8, has_break: true }],
            timesheet: [{ type: 'WORK', start: '09:00', finish: '17:00', hours: 8, has_break: true }],
            note: null,
        }]);
    });

    it('requires start_date to be a fortnight start', async () => {
        expect((await request(app).get('/api/portal/timesheet?start_date=2026-04-01').set(bearer(w.tokens.melEmployee))).status).toBe(400);
    });
});

describe('GET /portal/history', () => {
    it('reports Draft, then Approved, then Locked as the fortnight progresses', async () => {
        await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, record_date: PERIOD, ...simpleDay(true) });
        const draft = await request(app).get(`/api/portal/history?start_date=${PERIOD}&end_date=${PERIOD}`).set(bearer(w.tokens.melEmployee));
        expect(draft.body.data).toEqual([{ start_date: PERIOD, status: 'Draft', actual_hours: 8 }]);

        await request(app).post('/api/submissions/approve').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, start_date: PERIOD });
        const approved = await request(app).get(`/api/portal/history?start_date=${PERIOD}&end_date=${PERIOD}`).set(bearer(w.tokens.melEmployee));
        expect(approved.body.data[0].status).toBe('Approved');

        await sql(`INSERT INTO fortnight_locks (org_id, location_id, start_date, roster_locked, timesheet_locked) VALUES ($1, $2, $3, true, true)`, [w.abc.id, w.abc.melbourne, PERIOD]);
        const locked = await request(app).get(`/api/portal/history?start_date=${PERIOD}&end_date=${PERIOD}`).set(bearer(w.tokens.melEmployee));
        expect(locked.body.data[0].status).toBe('Locked');
    });

    it('never reveals another worker\'s status', async () => {
        await request(app).post('/api/submissions/approve').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.rich, start_date: PERIOD });
        const res = await request(app).get(`/api/portal/history?start_date=${PERIOD}&end_date=${PERIOD}`).set(bearer(w.tokens.melEmployee));
        expect(res.body.data[0].status).toBe('Draft');
    });
});

describe('POST /portal/timesheet (self-submit)', () => {
    it('records the employee\'s own worked hours, timesheet side only', async () => {
        const res = await request(app).post('/api/portal/timesheet').set(bearer(w.tokens.melEmployee))
            .send({ record_date: PERIOD, timesheet: [{ type: 'WORK', start: '09:00', finish: '17:00' }] });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ roster: [], timesheet: [{ type: 'WORK', start: '09:00', finish: '17:00', hours: 8, has_break: true }], note: null });
        expect((await sql('SELECT COUNT(*)::int AS n FROM daily_records WHERE employee_id = $1', [w.workers.mel])).rows[0].n).toBe(1);
    });

    it('refuses with 403 while employees_can_submit_timesheets is off, even with a valid session', async () => {
        await request(app).put('/api/organisation/settings').set(bearer(w.tokens.owner)).send({ employees_can_submit_timesheets: false });
        const res = await request(app).post('/api/portal/timesheet').set(bearer(w.tokens.melEmployee))
            .send({ record_date: PERIOD, timesheet: [{ type: 'WORK', start: '09:00', finish: '17:00' }] });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('EMPLOYEE_SUBMISSION_DISABLED');
        expect((await sql('SELECT COUNT(*)::int AS n FROM daily_records WHERE employee_id = $1', [w.workers.mel])).rows[0].n).toBe(0);
    });

    it('rejects a roster key outright rather than silently ignoring it', async () => {
        const res = await request(app).post('/api/portal/timesheet').set(bearer(w.tokens.melEmployee))
            .send({ record_date: PERIOD, roster: [{ type: 'WORK', start: '09:00', finish: '17:00' }], timesheet: [] });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('SCOPE_VIOLATION');
    });

    it('cannot submit once the fortnight is approved or the branch\'s timesheets are locked', async () => {
        await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, record_date: PERIOD, ...simpleDay() });
        await request(app).post('/api/submissions/approve').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, start_date: PERIOD });
        const approved = await request(app).post('/api/portal/timesheet').set(bearer(w.tokens.melEmployee))
            .send({ record_date: PERIOD, timesheet: [{ type: 'WORK', start: '09:00', finish: '17:00' }] });
        expect(approved.status).toBe(423);
        expect(approved.body.error.code).toBe('TIMESHEET_ALREADY_APPROVED');
    });

    it('an employee_id in the request body has no effect — it always writes to the caller\'s own record', async () => {
        const res = await request(app).post('/api/portal/timesheet').set(bearer(w.tokens.melEmployee))
            .send({ record_date: PERIOD, employee_id: w.workers.rich, timesheet: [{ type: 'WORK', start: '09:00', finish: '17:00' }] });
        expect(res.status).toBe(200);
        expect((await sql('SELECT COUNT(*)::int AS n FROM daily_records WHERE employee_id = $1', [w.workers.rich])).rows[0].n).toBe(0);
        expect((await sql('SELECT COUNT(*)::int AS n FROM daily_records WHERE employee_id = $1', [w.workers.mel])).rows[0].n).toBe(1);
    });

    it('GET /portal/timesheet reports whether the fortnight is currently editable', async () => {
        const before = await request(app).get(`/api/portal/timesheet?start_date=${PERIOD}`).set(bearer(w.tokens.melEmployee));
        expect(before.body).toMatchObject({ approved: false, timesheet_locked: false });

        await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, record_date: PERIOD, ...simpleDay(true) });
        await request(app).post('/api/submissions/approve').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, start_date: PERIOD });
        const after = await request(app).get(`/api/portal/timesheet?start_date=${PERIOD}`).set(bearer(w.tokens.melEmployee));
        expect(after.body.approved).toBe(true);
    });
});

describe('employee_id in the request is ignored, never used to read someone else\'s data', () => {
    it('a query string employee_id pointing at another worker has no effect', async () => {
        await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.rich, record_date: PERIOD, ...simpleDay() });
        const res = await request(app).get(`/api/portal/schedule?start_date=${PERIOD}&end_date=${PERIOD}&employee_id=${w.workers.rich}`).set(bearer(w.tokens.melEmployee));
        expect(res.body.data).toEqual([]);
    });
});
