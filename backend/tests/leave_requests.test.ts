/**
 * Leave requests: creation, overlap rejection, review (approve/reject), and materialization into
 * shift_segments through the shared writeDayRecord pipeline.
 */
import request from 'supertest';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { connectTestDb, resetTestDb, closeTestDb, sql } from './helpers/testDb';
import { PERIOD, World, bearer, buildWorld, entry } from './helpers/fixtures';

// Weekday dates inside PERIOD's fortnight (PERIOD itself, 2026-03-29, is a Sunday).
const MONDAY = '2026-03-30';
const TUESDAY = '2026-03-31';
const WEDNESDAY = '2026-04-01';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

const createRequest = (token: string, body: object) => request(app).post('/api/portal/leave-requests').set(bearer(token)).send(body);
const review = (token: string, id: string, body: object) => request(app).post(`/api/leave-requests/${id}/review`).set(bearer(token)).send(body);

describe('creating a leave request', () => {
    it('a whole-day request needs hours and starts Pending (approval required by default)', async () => {
        const res = await createRequest(w.tokens.melEmployee, { leave_type: 'Annual', start_date: MONDAY, end_date: TUESDAY, hours: 15.2, reason: 'Trip' });
        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe('Pending');
        const row = (await sql('SELECT leave_type, start_date, end_date, hours::float, reason, status FROM leave_requests WHERE id = $1', [res.body.data.id])).rows[0];
        expect(row).toEqual({ leave_type: 'Annual', start_date: MONDAY, end_date: TUESDAY, hours: 15.2, reason: 'Trip', status: 'Pending' });
    });

    it('rejects a whole-day request with no hours, and a partial-day request spanning more than one day', async () => {
        expect((await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY })).status).toBe(400);
        expect((await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: TUESDAY, start_time: '09:00', end_time: '10:00' })).status).toBe(400);
    });

    it('rejects leave_type WORK and an invalid time range', async () => {
        expect((await createRequest(w.tokens.melEmployee, { leave_type: 'WORK', start_date: MONDAY, end_date: MONDAY, hours: 8 })).status).toBe(400);
        expect((await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, start_time: '10:00', end_time: '09:00' })).status).toBe(400);
    });

    it('rejects an overlap with another Pending or Approved request, but not with a Rejected one', async () => {
        const first = await createRequest(w.tokens.melEmployee, { leave_type: 'Annual', start_date: MONDAY, end_date: TUESDAY, hours: 15 });
        const overlap = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: TUESDAY, end_date: WEDNESDAY, hours: 15 });
        expect(overlap.status).toBe(400);
        expect(overlap.body.error.code).toBe('LEAVE_OVERLAP');

        await review(w.tokens.owner, first.body.data.id, { decision: 'reject' });
        const afterReject = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: TUESDAY, end_date: WEDNESDAY, hours: 15 });
        expect(afterReject.status).toBe(201);
    });

    it('two same-day partial requests at different times do not overlap', async () => {
        const first = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, start_time: '09:00', end_time: '10:00' });
        expect(first.status).toBe(201);
        const second = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, start_time: '14:00', end_time: '15:00' });
        expect(second.status).toBe(201);
        const overlapping = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, start_time: '09:30', end_time: '11:00' });
        expect(overlapping.status).toBe(400);
    });

    it('an Owner or Branch Admin token is refused (portal is employee-only)', async () => {
        expect((await createRequest(w.tokens.owner, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, hours: 8 })).status).toBe(403);
    });
});

describe('reviewing a request (approve/reject)', () => {
    it('a Branch Admin can approve a request from a worker in their own branch', async () => {
        const created = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, hours: 8 });
        const res = await review(w.tokens.sarah, created.body.data.id, { decision: 'approve' });
        expect(res.status).toBe(200);
        expect((await sql('SELECT status FROM leave_requests WHERE id = $1', [created.body.data.id])).rows[0].status).toBe('Approved');
    });

    it('a Branch Admin outside the worker\'s branch cannot review it', async () => {
        const created = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, hours: 8 });
        expect((await review(w.tokens.greg, created.body.data.id, { decision: 'approve' })).status).toBe(403);
    });

    it("another organisation's owner cannot see or review it (404, existence not confirmed)", async () => {
        const created = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, hours: 8 });
        expect((await review(w.tokens.xavier, created.body.data.id, { decision: 'approve' })).status).toBe(404);
        const list = await request(app).get('/api/leave-requests').set(bearer(w.tokens.xavier));
        expect(list.body.data).toEqual([]);
        expect((await sql('SELECT status FROM leave_requests WHERE id = $1', [created.body.data.id])).rows[0].status).toBe('Pending');
    });

    it('rejecting records a reason and never touches shift_segments', async () => {
        const created = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, hours: 8 });
        const res = await review(w.tokens.owner, created.body.data.id, { decision: 'reject', rejection_reason: 'Short-staffed that day' });
        expect(res.status).toBe(200);
        const row = (await sql('SELECT status, rejection_reason FROM leave_requests WHERE id = $1', [created.body.data.id])).rows[0];
        expect(row).toEqual({ status: 'Rejected', rejection_reason: 'Short-staffed that day' });
        expect((await sql('SELECT COUNT(*)::int AS n FROM daily_records WHERE employee_id = $1', [w.workers.mel])).rows[0].n).toBe(0);
    });

    it('a request already reviewed cannot be reviewed again', async () => {
        const created = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, hours: 8 });
        await review(w.tokens.owner, created.body.data.id, { decision: 'approve' });
        expect((await review(w.tokens.owner, created.body.data.id, { decision: 'reject' })).status).toBe(400);
    });
});

describe('materialization on approval', () => {
    it('whole-day: retypes an existing WORK entry to the leave type, at the same times', async () => {
        await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, record_date: MONDAY, roster: [entry('09:00', '17:00')], timesheet: [] });
        const created = await createRequest(w.tokens.melEmployee, { leave_type: 'Annual', start_date: MONDAY, end_date: MONDAY, hours: 7.5 });
        const res = await review(w.tokens.owner, created.body.data.id, { decision: 'approve' });
        expect(res.status).toBe(200);
        expect(res.body.data.applied).toEqual([MONDAY]);

        const row = (await sql('SELECT segment_type, roster_in, roster_out FROM shift_segments ss JOIN daily_records dr ON dr.id = ss.record_id WHERE dr.employee_id = $1', [w.workers.mel])).rows[0];
        expect(row.segment_type).toBe('Annual');
        expect(row.roster_in.slice(0, 5)).toBe('09:00');
    });

    it('whole-day: a day with nothing recorded gets an hours-only fallback entry (total hours ÷ days)', async () => {
        const created = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: TUESDAY, hours: 15 });
        const res = await review(w.tokens.owner, created.body.data.id, { decision: 'approve' });
        expect(res.body.data.applied.sort()).toEqual([MONDAY, TUESDAY].sort());

        const rows = (await sql('SELECT record_date, roster_hours::float FROM shift_segments ss JOIN daily_records dr ON dr.id = ss.record_id WHERE dr.employee_id = $1 ORDER BY record_date', [w.workers.mel])).rows;
        expect(rows.every((r: any) => r.roster_hours === 7.5)).toBe(true);
    });

    it('partial-day: merges as a segment via the normal write pipeline; rejected as OVERLAP if it collides and merge is off', async () => {
        await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, record_date: MONDAY, roster: [entry('09:00', '17:00')], timesheet: [] });
        const created = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, start_time: '10:00', end_time: '11:00' });
        const res = await review(w.tokens.owner, created.body.data.id, { decision: 'approve' });
        expect(res.status).toBe(200);
        // automatically_merge_leave_with_roster defaults to false, so the overlapping day is skipped, not silently dropped.
        expect(res.body.data.applied).toEqual([]);
        expect(res.body.data.skipped).toEqual([{ date: MONDAY, reason: 'OVERLAP' }]);
        // The request itself is still marked Approved even though materialization needs manual follow-up.
        expect((await sql('SELECT status FROM leave_requests WHERE id = $1', [created.body.data.id])).rows[0].status).toBe('Approved');
    });

    it('partial-day: with automatically_merge_leave_with_roster on, the shift is split around the leave instead of rejected', async () => {
        await request(app).put('/api/organisation/settings').set(bearer(w.tokens.owner)).send({ automatically_merge_leave_with_roster: true });
        await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, record_date: MONDAY, roster: [entry('09:00', '17:00')], timesheet: [] });
        const created = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, start_time: '10:00', end_time: '11:00' });
        const res = await review(w.tokens.owner, created.body.data.id, { decision: 'approve' });
        expect(res.status).toBe(200);
        expect(res.body.data.applied).toEqual([MONDAY]);

        const rows = (await sql(
            `SELECT segment_type, roster_in, roster_out, roster_hours::float FROM shift_segments ss JOIN daily_records dr ON dr.id = ss.record_id
              WHERE dr.employee_id = $1 ORDER BY roster_in`, [w.workers.mel]
        )).rows;
        expect(rows.map((r: any) => [r.segment_type, r.roster_in.slice(0, 5), r.roster_out.slice(0, 5)])).toEqual([
            ['WORK', '09:00', '10:00'],
            ['Sick', '10:00', '11:00'],
            ['WORK', '11:00', '17:00'],
        ]);
    });

    it('an approved fortnight is skipped rather than silently failing the whole request', async () => {
        await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, record_date: MONDAY, roster: [entry('09:00', '17:00')], timesheet: [] });
        await request(app).post('/api/submissions/approve').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, start_date: PERIOD });
        const created = await createRequest(w.tokens.melEmployee, { leave_type: 'Annual', start_date: MONDAY, end_date: MONDAY, hours: 7.5 });
        const res = await review(w.tokens.owner, created.body.data.id, { decision: 'approve' });
        expect(res.body.data.applied).toEqual([]);
        expect(res.body.data.skipped).toEqual([{ date: MONDAY, reason: 'TIMESHEET_ALREADY_APPROVED' }]);
    });
});

describe('leave_requests_require_approval = false', () => {
    it('materializes immediately, with no Pending state', async () => {
        await request(app).put('/api/organisation/settings').set(bearer(w.tokens.owner)).send({ leave_requests_require_approval: false });
        const res = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, hours: 8 });
        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe('Approved');
        expect(res.body.data.applied).toEqual([MONDAY]);
        expect((await sql('SELECT status FROM leave_requests WHERE id = $1', [res.body.data.id])).rows[0].status).toBe('Approved');
    });
});

describe('withdrawing a request', () => {
    it('the employee can withdraw their own Pending request, but not an already-reviewed one', async () => {
        const created = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, hours: 8 });
        await review(w.tokens.owner, created.body.data.id, { decision: 'approve' });
        expect((await request(app).delete(`/api/portal/leave-requests/${created.body.data.id}`).set(bearer(w.tokens.melEmployee))).status).toBe(400);

        const another = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: TUESDAY, end_date: TUESDAY, hours: 8 });
        expect((await request(app).delete(`/api/portal/leave-requests/${another.body.data.id}`).set(bearer(w.tokens.melEmployee))).status).toBe(200);
    });

    it('an employee cannot withdraw another employee\'s request', async () => {
        const created = await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, hours: 8 });
        expect((await request(app).delete(`/api/portal/leave-requests/${created.body.data.id}`).set(bearer(w.tokens.richEmployee))).status).toBe(400);
    });
});

describe('GET /leave-requests (admin) and GET /portal/leave-requests (employee)', () => {
    it('an admin sees requests only for workers in their branch scope', async () => {
        await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, hours: 8 });
        const sarahView = await request(app).get('/api/leave-requests').set(bearer(w.tokens.sarah));
        const gregView = await request(app).get('/api/leave-requests').set(bearer(w.tokens.greg));
        expect(sarahView.body.data).toHaveLength(1);
        expect(gregView.body.data).toHaveLength(0);
    });

    it('an employee only ever sees their own requests', async () => {
        await createRequest(w.tokens.melEmployee, { leave_type: 'Sick', start_date: MONDAY, end_date: MONDAY, hours: 8 });
        const res = await request(app).get('/api/portal/leave-requests').set(bearer(w.tokens.richEmployee));
        expect(res.body.data).toEqual([]);
    });
});

describe('reviewing is race-safe', () => {
    it('two simultaneous approvals: exactly one wins, and the leave is written once', async () => {
        const created = await request(app).post('/api/portal/leave-requests').set(bearer(w.tokens.melEmployee))
            .send({ leave_type: 'Annual', start_date: PERIOD, end_date: PERIOD, hours: 7.6 });
        const id = created.body.data.id;
        const review = () => request(app).post(`/api/leave-requests/${id}/review`).set(bearer(w.tokens.owner)).send({ decision: 'approve' });
        const results = await Promise.all([review(), review()]);
        expect(results.map(r => r.status).sort()).toEqual([200, 400]);
        const segs = await sql(`SELECT ss.segment_type FROM shift_segments ss JOIN daily_records dr ON dr.id = ss.record_id WHERE dr.employee_id = $1`, [w.workers.mel]);
        expect(segs.rows).toEqual([{ segment_type: 'Annual' }]);
    });
});
