/**
 * Roster ↔ timesheet ↔ leave: applying a default roster, copying a day and an employee's own
 * timesheet never delete, shorten or overwrite leave or worked hours, and every day that could not
 * be changed is reported. Plus the break controls: explicit break lengths, the worked side's own
 * break, the default-roster break tools, and locks. Real PostgreSQL.
 */
import request from 'supertest';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { connectTestDb, resetTestDb, closeTestDb, sql } from './helpers/testDb';
import { PERIOD, World, bearer, buildWorld, entry } from './helpers/fixtures';

const MONDAY = '2026-03-30';      // day 1 of PERIOD
const TUESDAY = '2026-03-31';     // day 2
const WEDNESDAY = '2026-04-01';   // day 3

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

const save = (workerId: string, date: string, day: object, token = w.tokens.owner) =>
    request(app).post('/api/records').set(bearer(token)).send({ employee_id: workerId, record_date: date, ...day });
const dayOf = async (workerId: string, date: string) => {
    const res = await request(app).get(`/api/records?start_date=${date}&end_date=${date}&employee_id=${workerId}`).set(bearer(w.tokens.owner));
    return res.body.data[0] || { roster: [], timesheet: [], note: null };
};
const times = (list: any[]) => list.map(e => [e.type, e.start, e.finish, e.hours]);
const template = (templates: object[]) =>
    request(app).post(`/api/employees/${w.workers.mel}/templates`).set(bearer(w.tokens.owner)).send({ templates });
const applyDefault = (days: number[]) =>
    request(app).post('/api/roster/auto-roster').set(bearer(w.tokens.owner)).send({ start_date: PERIOD, selected_days: days, employee_id: w.workers.mel });
const approvedLeave = (leave_type: string, start_date: string, end_date: string, start_time: string | null = null, end_time: string | null = null) =>
    sql(`INSERT INTO leave_requests (org_id, employee_id, location_id, leave_type, start_date, end_date, start_time, end_time, hours, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Approved')`,
        [w.abc.id, w.workers.mel, w.abc.melbourne, leave_type, start_date, end_date, start_time, end_time, start_time ? null : 7.6]);

describe('Apply default roster keeps leave and worked hours', () => {
    beforeEach(async () => {
        await template([1, 2, 3].map(day_index => ({ day_index, roster_in: '09:00', roster_out: '17:00' })));
    });

    // The org's 30 min break applies once the DAY reaches 6 h (leave included) and only ever comes off work.
    it('timed leave on the roster is kept and the default shift is split around it', async () => {
        await save(w.workers.mel, MONDAY, { roster: [entry('09:00', '12:00', 'Sick')], timesheet: [] });
        const res = await applyDefault([1]);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ applied: 1, skipped: [] });
        expect(times((await dayOf(w.workers.mel, MONDAY)).roster)).toEqual([['Sick', '09:00', '12:00', 3], ['WORK', '12:00', '17:00', 4.5]]);
    });

    it('a whole-day (hours-only) leave day is left exactly as it was, and reported', async () => {
        await save(w.workers.mel, MONDAY, { roster: [entry(null, null, 'Annual', 7.6)], timesheet: [] });
        const res = await applyDefault([1, 2]);
        expect(res.body.data.applied).toBe(1);
        expect(res.body.data.skipped).toEqual([{ employee_id: w.workers.mel, date: MONDAY, reason: 'LEAVE_ON_DAY' }]);
        expect(times((await dayOf(w.workers.mel, MONDAY)).roster)).toEqual([['Annual', null, null, 7.6]]);
        expect(times((await dayOf(w.workers.mel, TUESDAY)).roster)).toEqual([['WORK', '09:00', '17:00', 7.5]]);
    });

    it('an approved whole-day leave request protects the day even when nothing is recorded on it', async () => {
        await approvedLeave('Annual', TUESDAY, WEDNESDAY);
        const res = await applyDefault([1, 2, 3]);
        expect(res.body.data.skipped.map((s: any) => [s.date, s.reason])).toEqual([[TUESDAY, 'APPROVED_LEAVE'], [WEDNESDAY, 'APPROVED_LEAVE']]);
        expect((await dayOf(w.workers.mel, TUESDAY)).roster).toEqual([]);
        expect(times((await dayOf(w.workers.mel, MONDAY)).roster)).toEqual([['WORK', '09:00', '17:00', 7.5]]);
    });

    it('an approved partial-day leave request is rostered as leave and the shift goes around it', async () => {
        await approvedLeave('Sick', MONDAY, MONDAY, '13:00', '17:00');
        await applyDefault([1]);
        expect(times((await dayOf(w.workers.mel, MONDAY)).roster)).toEqual([['WORK', '09:00', '13:00', 3.5], ['Sick', '13:00', '17:00', 4]]);
    });

    it('worked hours (including sick leave actually taken) are never changed', async () => {
        await save(w.workers.mel, MONDAY, { roster: [entry('08:00', '16:00')], timesheet: [entry('08:00', '12:00'), entry('12:00', '16:00', 'Sick')] });
        const before = (await dayOf(w.workers.mel, MONDAY)).timesheet;
        await applyDefault([1]);
        const after = await dayOf(w.workers.mel, MONDAY);
        expect(after.timesheet).toEqual(before);
        expect(times(after.roster)).toEqual([['WORK', '09:00', '17:00', 7.5]]);
    });

    it('a locked roster or an approved timesheet is never changed', async () => {
        await save(w.workers.mel, MONDAY, { roster: [entry('10:00', '14:00')], timesheet: [] });
        await sql('INSERT INTO fortnight_locks (org_id, location_id, start_date, roster_locked, timesheet_locked) VALUES ($1, $2, $3, true, false)', [w.abc.id, w.abc.melbourne, PERIOD]);
        expect((await applyDefault([1])).body.data.workers).toBe(0);
        expect(times((await dayOf(w.workers.mel, MONDAY)).roster)).toEqual([['WORK', '10:00', '14:00', 4]]);

        await sql('DELETE FROM fortnight_locks');
        await request(app).post('/api/submissions/approve').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, start_date: PERIOD });
        expect((await applyDefault([1])).body.data.workers).toBe(0);
        expect(times((await dayOf(w.workers.mel, MONDAY)).roster)).toEqual([['WORK', '10:00', '14:00', 4]]);
    });
});

describe('Copy a day keeps leave on the target day', () => {
    it('copies the shift around timed leave, and skips a whole-day leave day', async () => {
        await save(w.workers.mel, MONDAY, { roster: [entry('09:00', '17:00')], timesheet: [] });
        await save(w.workers.mel, TUESDAY, { roster: [entry('09:00', '11:00', 'Annual')], timesheet: [] });
        await save(w.workers.mel, WEDNESDAY, { roster: [entry(null, null, 'Sick', 7.6)], timesheet: [] });

        const res = await request(app).post('/api/records/copy-day').set(bearer(w.tokens.owner))
            .send({ employee_id: w.workers.mel, source_date: MONDAY, target_dates: [TUESDAY, WEDNESDAY] });
        expect(res.status).toBe(200);
        expect(res.body.data.copied).toEqual([{ employee_id: w.workers.mel, date: TUESDAY }]);
        expect(res.body.data.skipped).toEqual([{ employee_id: w.workers.mel, date: WEDNESDAY, reason: 'LEAVE_ON_DAY' }]);
        expect(times((await dayOf(w.workers.mel, TUESDAY)).roster)).toEqual([['Annual', '09:00', '11:00', 2], ['WORK', '11:00', '17:00', 5.5]]);
        expect(times((await dayOf(w.workers.mel, WEDNESDAY)).roster)).toEqual([['Sick', null, null, 7.6]]);
    });
});

describe("an employee's own timesheet never removes or overlaps leave", () => {
    const submit = (timesheet: object[], date = MONDAY) =>
        request(app).post('/api/portal/timesheet').set(bearer(w.tokens.melEmployee)).send({ record_date: date, timesheet });

    it('matching the roster: 9–5 rostered, 9–5 submitted, roster untouched', async () => {
        await save(w.workers.mel, MONDAY, { roster: [entry('09:00', '17:00')], timesheet: [] });
        expect((await submit([entry('09:00', '17:00')])).status).toBe(200);
        const day = await dayOf(w.workers.mel, MONDAY);
        expect(times(day.roster)).toEqual([['WORK', '09:00', '17:00', 7.5]]);
        expect(times(day.timesheet)).toEqual([['WORK', '09:00', '17:00', 7.5]]);
    });

    it('sick leave already on the worked side is kept when the employee saves their work', async () => {
        await save(w.workers.mel, MONDAY, { roster: [entry('09:00', '17:00')], timesheet: [entry('09:00', '12:00', 'Sick')] });
        const res = await submit([entry('12:00', '17:00')]);
        expect(res.status).toBe(200);
        expect(times((await dayOf(w.workers.mel, MONDAY)).timesheet)).toEqual([['Sick', '09:00', '12:00', 3], ['WORK', '12:00', '17:00', 4.5]]);

        // Saving again with an empty list clears their own work only — the sick leave stays.
        expect((await submit([])).status).toBe(200);
        expect(times((await dayOf(w.workers.mel, MONDAY)).timesheet)).toEqual([['Sick', '09:00', '12:00', 3]]);
    });

    it('work overlapping recorded or approved leave is refused, and nothing is changed', async () => {
        await save(w.workers.mel, MONDAY, { roster: [entry('09:00', '17:00', 'Sick')], timesheet: [] });
        const res = await submit([entry('09:00', '17:00')]);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('LEAVE_CONFLICT');
        expect(res.body.error.message).toMatch(/Sick Leave/);
        expect((await dayOf(w.workers.mel, MONDAY)).timesheet).toEqual([]);

        await approvedLeave('Annual', TUESDAY, TUESDAY);
        expect((await submit([entry('10:00', '11:00')], TUESDAY)).body.error.code).toBe('LEAVE_CONFLICT');
    });

    it('leave cannot be entered on the timesheet (it goes through a leave request)', async () => {
        const res = await submit([entry('09:00', '17:00', 'Sick')]);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('LEAVE_VIA_REQUEST');
    });
});

describe('break controls', () => {
    it('an explicit break length is deducted whatever the day length; no length keeps the org rule', async () => {
        const res = await save(w.workers.mel, MONDAY, {
            roster: [{ ...entry('09:00', '13:00'), has_break: true, break_mins: 15 }],
            timesheet: [entry('09:00', '13:00')],
        });
        expect(res.status).toBe(200);
        // 4 h is under the 6 h threshold: the explicit 15 min still comes off; the org rule does not.
        expect(res.body.data.roster[0]).toMatchObject({ hours: 3.75, has_break: true, break_mins: 15 });
        expect(res.body.data.timesheet[0]).toMatchObject({ hours: 4, has_break: true, break_mins: null });
    });

    it('rejects a nonsense break length', async () => {
        const res = await save(w.workers.mel, MONDAY, { roster: [{ ...entry('09:00', '17:00'), break_mins: 999 }], timesheet: [] });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_BREAK');
    });

    it('the worked side keeps its own break: unticking it on the timesheet is not overwritten by the roster', async () => {
        await save(w.workers.mel, MONDAY, { roster: [entry('09:00', '17:00')], timesheet: [{ ...entry('09:00', '17:00'), has_break: false }] });
        const day = await dayOf(w.workers.mel, MONDAY);
        expect(day.roster[0]).toMatchObject({ hours: 7.5, has_break: true });
        expect(day.timesheet[0]).toMatchObject({ hours: 8, has_break: false });
    });

    it('Apply break to all days on the default roster, then untick one day; applying it rosters exactly that', async () => {
        await template([1, 2, 3].map(day_index => ({ day_index, roster_in: '09:00', roster_out: '17:00', has_break: false })));
        const all = await request(app).post(`/api/employees/${w.workers.mel}/templates/apply-break`).set(bearer(w.tokens.owner))
            .send({ day_indexes: [1, 2, 3], has_break: true, break_mins: 45 });
        expect(all.status).toBe(200);
        await request(app).post(`/api/employees/${w.workers.mel}/templates/apply-break`).set(bearer(w.tokens.owner))
            .send({ day_indexes: [2], has_break: false });

        const rows = (await sql('SELECT day_index, has_break, break_mins FROM roster_templates WHERE employee_id = $1 ORDER BY day_index', [w.workers.mel])).rows;
        expect(rows).toEqual([
            { day_index: 1, has_break: true, break_mins: 45 },
            { day_index: 2, has_break: false, break_mins: null },
            { day_index: 3, has_break: true, break_mins: 45 },
        ]);

        await applyDefault([1, 2, 3]);
        expect((await dayOf(w.workers.mel, MONDAY)).roster[0]).toMatchObject({ hours: 7.25, has_break: true, break_mins: 45 });
        expect((await dayOf(w.workers.mel, TUESDAY)).roster[0]).toMatchObject({ hours: 8, has_break: false });
        expect((await dayOf(w.workers.mel, WEDNESDAY)).roster[0]).toMatchObject({ hours: 7.25, break_mins: 45 });
    });

    it('the default-roster break tools never touch leave shifts', async () => {
        await template([{ day_index: 1, segment_type: 'Sick', roster_in: '09:00', roster_out: '12:00' }, { day_index: 1, roster_in: '12:00', roster_out: '17:00' }]);
        await request(app).post(`/api/employees/${w.workers.mel}/templates/apply-break`).set(bearer(w.tokens.owner)).send({ day_indexes: [1], has_break: true, break_mins: 30 });
        const rows = (await sql('SELECT segment_type, break_mins FROM roster_templates WHERE employee_id = $1 ORDER BY roster_in', [w.workers.mel])).rows;
        expect(rows).toEqual([{ segment_type: 'Sick', break_mins: null }, { segment_type: 'WORK', break_mins: 30 }]);
    });

    it('a break change on a locked roster is refused like any other roster change', async () => {
        await save(w.workers.mel, MONDAY, { roster: [entry('09:00', '17:00')], timesheet: [] });
        await sql('INSERT INTO fortnight_locks (org_id, location_id, start_date, roster_locked, timesheet_locked) VALUES ($1, $2, $3, true, false)', [w.abc.id, w.abc.melbourne, PERIOD]);
        const res = await request(app).post('/api/records/apply-break').set(bearer(w.tokens.owner))
            .send({ employee_id: w.workers.mel, record_dates: [MONDAY], has_break: false });
        expect(res.body.data).toEqual({ applied: [], skipped: [{ date: MONDAY, reason: 'ROSTER_LOCKED' }] });
        expect((await dayOf(w.workers.mel, MONDAY)).roster[0]).toMatchObject({ hours: 7.5, has_break: true });
    });

    it("another organisation cannot read or change a worker's default roster breaks", async () => {
        const res = await request(app).post(`/api/employees/${w.workers.mel}/templates/apply-break`).set(bearer(w.tokens.xavier)).send({ day_indexes: [1], has_break: false });
        expect(res.status).toBe(404);
        const save = await request(app).post(`/api/employees/${w.workers.mel}/templates`).set(bearer(w.tokens.xavier)).send({ templates: [] });
        expect(save.status).toBe(404);
    });
});
