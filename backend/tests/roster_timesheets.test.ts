/**
 * Roster and timesheet workflows on real PostgreSQL. A day has a ROSTER (planned) and a TIMESHEET
 * (worked); writes are scoped to one or both. Also: leave, breaks, copying, automatic roster/log,
 * per-branch locks and approval.
 */
import request from 'supertest';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { connectTestDb, resetTestDb, closeTestDb, sql } from './helpers/testDb';
import { PASSWORD, PERIOD, World, bearer, buildWorld, entry, simpleDay } from './helpers/fixtures';

const MONDAY = '2026-03-30';
const TUESDAY = '2026-03-31';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

const save = (token: string, workerId: string, date: string, day: object) =>
    request(app).post('/api/records').set(bearer(token)).send({ employee_id: workerId, record_date: date, ...day });

const dayOf = async (workerId: string, date: string, token = w.tokens.owner) => {
    const res = await request(app).get(`/api/records?start_date=${date}&end_date=${date}&employee_id=${workerId}`).set(bearer(token));
    return res.body.data[0] || { roster: [], timesheet: [], note: null };
};
const times = (list: any[]) => list.map(e => [e.type, e.start, e.finish, e.hours]);

const lock = (token: string, branchId: string, flags: object, password = PASSWORD) =>
    request(app).post('/api/locks').set(bearer(token)).send({ location_id: branchId, start_date: PERIOD, password, ...flags });

describe('roster only, timesheet only, both', () => {
    it('a roster-only entry creates no worked hours', async () => {
        expect((await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'ROSTER', roster: [entry('09:00', '17:00')] })).status).toBe(200);
        const day = await dayOf(w.workers.mel, MONDAY);
        expect(times(day.roster)).toEqual([['WORK', '09:00', '17:00', 7.5]]);
        expect(day.timesheet).toEqual([]);
        const report = await request(app).get(`/api/submissions?start_date=${PERIOD}`).set(bearer(w.tokens.sarah));
        expect(report.body.data.find((r: any) => r.employee_id === w.workers.mel).actual_hours).toBe(0);
    });

    it('a timesheet-only entry leaves the roster alone', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'ROSTER', roster: [entry('09:00', '17:00')] });
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'TIMESHEET', timesheet: [entry('08:45', '17:15')] });
        const day = await dayOf(w.workers.mel, MONDAY);
        expect(times(day.roster)).toEqual([['WORK', '09:00', '17:00', 7.5]]);
        expect(times(day.timesheet)).toEqual([['WORK', '08:45', '17:15', 8]]);
    });

    it('a roster-only change never alters recorded worked hours', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { roster: [entry('09:00', '17:00')], timesheet: [entry('09:05', '17:02')] });
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'ROSTER', roster: [entry('10:00', '14:00')] });
        const day = await dayOf(w.workers.mel, MONDAY);
        expect(times(day.roster)).toEqual([['WORK', '10:00', '14:00', 4]]);
        expect(times(day.timesheet)).toEqual([['WORK', '09:05', '17:02', 7.45]]);
    });

    it('clearing the roster keeps the timesheet, and vice versa', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay(true));
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'ROSTER', roster: [] });
        expect((await dayOf(w.workers.mel, MONDAY)).timesheet).toHaveLength(1);
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'ROSTER', roster: [entry('09:00', '17:00')] });
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'TIMESHEET', timesheet: [] });
        const day = await dayOf(w.workers.mel, MONDAY);
        expect([day.roster.length, day.timesheet.length]).toEqual([1, 0]);
    });

    it('both: one write sets the roster and the timesheet', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay(true));
        const day = await dayOf(w.workers.mel, MONDAY);
        expect(times(day.roster)).toEqual(times(day.timesheet));
    });

    it('a scoped write that includes the other side is refused', async () => {
        const res = await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'ROSTER', roster: [entry('09:00', '17:00')], timesheet: [entry('09:00', '17:00')] });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('SCOPE_VIOLATION');
        expect((await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'SOMETHING', roster: [] })).status).toBe(400);
    });

    it('extra worked time with no rostered counterpart is marked unplanned', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { roster: [entry('09:00', '13:00')], timesheet: [entry('09:00', '13:00'), entry('18:00', '20:00')] });
        const rows = (await sql(`SELECT ss.actual_in, ss.is_unplanned FROM shift_segments ss JOIN daily_records dr ON dr.id = ss.record_id
                                  WHERE dr.employee_id = $1 ORDER BY ss.actual_in`, [w.workers.mel])).rows;
        expect(rows.map((r: any) => r.is_unplanned)).toEqual([false, true]);
    });

    it('a note for the day is kept with the day', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { ...simpleDay(), note: 'Covering for Rich' });
        expect((await dayOf(w.workers.mel, MONDAY)).note).toBe('Covering for Rich');
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'TIMESHEET', timesheet: [entry('09:00', '17:00')] });
        expect((await dayOf(w.workers.mel, MONDAY)).note).toBe('Covering for Rich');
    });
});

describe('leave and breaks', () => {
    it('the complex day: 9–1 Sick · 1–3 Annual · 3–5 Work, break taken from work only', async () => {
        const res = await save(w.tokens.sarah, w.workers.mel, MONDAY, {
            scope: 'ROSTER',
            roster: [entry('09:00', '13:00', 'Sick'), entry('13:00', '15:00', 'Annual'), entry('15:00', '17:00')],
        });
        expect(res.status).toBe(200);
        expect(times(res.body.data.roster)).toEqual([['Sick', '09:00', '13:00', 4], ['Annual', '13:00', '15:00', 2], ['WORK', '15:00', '17:00', 1.5]]);
        expect((await sql('SELECT COUNT(*)::int AS n FROM daily_records WHERE employee_id = $1', [w.workers.mel])).rows[0].n).toBe(1);
    });

    it('a day of leave only is never reduced by the break', async () => {
        const res = await save(w.tokens.sarah, w.workers.mel, MONDAY, { roster: [entry('09:00', '17:00', 'Annual')], timesheet: [entry('09:00', '17:00', 'Annual')] });
        expect(res.body.data.timesheet[0].hours).toBe(8);
    });

    it('LWIP and hours-only leave are supported and counted separately', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'TIMESHEET', timesheet: [entry(null, null, 'LWIP', 7.6)] });
        await save(w.tokens.sarah, w.workers.mel, TUESDAY, { scope: 'TIMESHEET', timesheet: [entry('09:00', '13:00', 'LWIP')] });
        const stats = await request(app).get(`/api/records/stats?start_date=${PERIOD}&employee_id=${w.workers.mel}`).set(bearer(w.tokens.sarah));
        expect(stats.body.data.leave.LWIP).toBe(11.6);
    });

    it('refuses overlapping times with a clear message and changes nothing', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay());
        const res = await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'ROSTER', roster: [entry('09:00', '13:00'), entry('12:00', '17:00')] });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('OVERLAP');
        expect(times((await dayOf(w.workers.mel, MONDAY)).roster)).toEqual([['WORK', '09:00', '17:00', 7.5]]);
    });

    it('rejects an unknown type (LWOP is not a SimpleHours type)', async () => {
        const res = await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'ROSTER', roster: [entry(null, null, 'LWOP', 4)] });
        expect(res.status).toBe(400);
    });

    it('rejects a record for an inactive worker', async () => {
        await request(app).post(`/api/employees/${w.workers.mel}/deactivate`).set(bearer(w.tokens.owner));
        expect((await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay())).status).toBe(400);
    });
});

describe('copying days', () => {
    it('copies a day’s roster to selected days and other workers in scope', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'ROSTER', roster: [entry('09:00', '13:00'), entry('13:00', '15:00', 'TIL')] });
        const res = await request(app).post('/api/records/copy-day').set(bearer(w.tokens.sarah)).send({
            employee_id: w.workers.mel, source_date: MONDAY, target_dates: [TUESDAY, '2026-04-01'], target_employee_ids: [w.workers.mel, w.workers.rich],
        });
        expect(res.status).toBe(200);
        expect(res.body.data.copied).toHaveLength(4);
        const copied = await dayOf(w.workers.rich, TUESDAY);
        expect(copied.roster.map((e: any) => e.type)).toEqual(['WORK', 'TIL']);
        expect(copied.timesheet).toEqual([]);
    });

    it('never overwrites a day that already has worked hours', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'ROSTER', roster: [entry('10:00', '14:00')] });
        await save(w.tokens.sarah, w.workers.mel, TUESDAY, { roster: [entry('08:00', '12:00')], timesheet: [entry('08:00', '12:30')] });
        const res = await request(app).post('/api/records/copy-day').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, source_date: MONDAY, target_dates: [TUESDAY] });
        expect(res.body.data.skipped).toEqual([{ employee_id: w.workers.mel, date: TUESDAY, reason: 'HAS_WORKED_HOURS' }]);
        expect(times((await dayOf(w.workers.mel, TUESDAY)).timesheet)).toEqual([['WORK', '08:00', '12:30', 4.5]]);
    });
});

describe('automatic roster and log', () => {
    it('auto-roster replaces only the roster; worked hours and the note survive', async () => {
        await request(app).post(`/api/employees/${w.workers.mel}/templates`).set(bearer(w.tokens.sarah))
            .send({ templates: [{ day_index: 1, roster_in: '10:00', roster_out: '16:00' }] });
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { roster: [entry('09:00', '17:00')], timesheet: [entry('09:05', '17:02')], note: 'keep me' });

        const res = await request(app).post('/api/roster/auto-roster').set(bearer(w.tokens.sarah)).send({ start_date: PERIOD, selected_days: [1], location_id: w.abc.melbourne });
        expect(res.status).toBe(200);
        const day = await dayOf(w.workers.mel, MONDAY);
        expect(times(day.roster)).toEqual([['WORK', '10:00', '16:00', 5.5]]);
        expect(times(day.timesheet)).toEqual([['WORK', '09:05', '17:02', 7.45]]);
        expect(day.note).toBe('keep me');
    });

    it('auto-log fills worked hours only where none were recorded', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay());
        await save(w.tokens.sarah, w.workers.mel, TUESDAY, { roster: [entry('09:00', '17:00')], timesheet: [entry('09:30', '17:00')] });
        await request(app).post('/api/roster/auto-log').set(bearer(w.tokens.sarah)).send({ start_date: PERIOD, selected_days: [1, 2] });
        expect((await dayOf(w.workers.mel, MONDAY)).timesheet[0].start).toBe('09:00');
        expect((await dayOf(w.workers.mel, TUESDAY)).timesheet[0].start).toBe('09:30');
    });

    it('auto-log copies the whole rostered day, including hours-only leave', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'ROSTER', roster: [entry('09:00', '13:00'), entry(null, null, 'Annual', 4)] });
        await request(app).post('/api/roster/auto-log').set(bearer(w.tokens.sarah)).send({ start_date: PERIOD, selected_days: [1] });
        const day = await dayOf(w.workers.mel, MONDAY);
        expect(times(day.timesheet)).toEqual(times(day.roster));
        expect(times(day.timesheet)).toContainEqual(['Annual', null, null, 4]);
    });

    it('auto-log leaves a day alone once any worked time is recorded on it (no overlapping worked time)', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'ROSTER', roster: [entry('09:00', '13:00'), entry('13:00', '17:00')] });
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'TIMESHEET', timesheet: [entry('13:30', '15:00')] });
        await request(app).post('/api/roster/auto-log').set(bearer(w.tokens.sarah)).send({ start_date: PERIOD, selected_days: [1] });
        expect(times((await dayOf(w.workers.mel, MONDAY)).timesheet)).toEqual([['WORK', '13:30', '15:00', 1.5]]);
    });

    it('templates are validated with the same rules', async () => {
        const res = await request(app).post(`/api/employees/${w.workers.mel}/templates`).set(bearer(w.tokens.sarah))
            .send({ templates: [{ day_index: 1, roster_in: '09:00', roster_out: '13:00' }, { day_index: 1, roster_in: '12:00', roster_out: '17:00' }] });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('OVERLAP');
    });

    it('auto-roster with employee_id changes only that worker, even when others are in scope', async () => {
        await request(app).post(`/api/employees/${w.workers.mel}/templates`).set(bearer(w.tokens.sarah))
            .send({ templates: [{ day_index: 1, roster_in: '10:00', roster_out: '16:00' }] });
        await request(app).post(`/api/employees/${w.workers.rich}/templates`).set(bearer(w.tokens.sarah))
            .send({ templates: [{ day_index: 1, roster_in: '11:00', roster_out: '15:00' }] });

        const res = await request(app).post('/api/roster/auto-roster').set(bearer(w.tokens.sarah))
            .send({ start_date: PERIOD, selected_days: [1], employee_id: w.workers.mel });
        expect(res.status).toBe(200);
        expect(res.body.data.workers).toBe(1);
        expect(times((await dayOf(w.workers.mel, MONDAY)).roster)).toEqual([['WORK', '10:00', '16:00', 5.5]]);
        expect((await dayOf(w.workers.rich, MONDAY)).roster).toEqual([]);
    });

    it('auto-log with employee_id fills worked hours for only that worker', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'ROSTER', roster: [entry('09:00', '17:00')] });
        await save(w.tokens.sarah, w.workers.rich, MONDAY, { scope: 'ROSTER', roster: [entry('09:00', '17:00')] });

        const res = await request(app).post('/api/roster/auto-log').set(bearer(w.tokens.sarah))
            .send({ start_date: PERIOD, selected_days: [1], employee_id: w.workers.mel });
        expect(res.status).toBe(200);
        expect(res.body.data.workers).toBe(1);
        expect((await dayOf(w.workers.mel, MONDAY)).timesheet).not.toEqual([]);
        expect((await dayOf(w.workers.rich, MONDAY)).timesheet).toEqual([]);
    });

    it('employee_id is authorised like any other single-worker action: a branch admin outside that branch is refused', async () => {
        const res = await request(app).post('/api/roster/auto-roster').set(bearer(w.tokens.greg))
            .send({ start_date: PERIOD, selected_days: [1], employee_id: w.workers.mel });
        expect(res.status).toBe(403);
        expect((await dayOf(w.workers.mel, MONDAY)).roster).toEqual([]);
    });

    it('employee_id from another organisation is not found', async () => {
        const res = await request(app).post('/api/roster/auto-log').set(bearer(w.tokens.sarah))
            .send({ start_date: PERIOD, selected_days: [1], employee_id: w.workers.syd });
        expect(res.status).toBe(404);
    });
});

describe('locks are per branch and change only what was asked', () => {
    it('locking Melbourne’s roster does not lock Richmond', async () => {
        expect((await lock(w.tokens.sarah, w.abc.melbourne, { roster_locked: true })).status).toBe(200);
        expect((await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'ROSTER', roster: [entry('09:00', '17:00')] })).status).toBe(423);
        expect((await save(w.tokens.sarah, w.workers.rich, MONDAY, { scope: 'ROSTER', roster: [entry('09:00', '17:00')] })).status).toBe(200);
    });

    it('changing the roster lock leaves the timesheet lock alone', async () => {
        await lock(w.tokens.owner, w.abc.melbourne, { timesheet_locked: true });
        await lock(w.tokens.owner, w.abc.melbourne, { roster_locked: true });
        await lock(w.tokens.owner, w.abc.melbourne, { roster_locked: false });
        const row = (await sql('SELECT roster_locked, timesheet_locked FROM fortnight_locks WHERE location_id = $1', [w.abc.melbourne])).rows[0];
        expect(row).toEqual({ roster_locked: false, timesheet_locked: true });
    });

    it('a locked roster still accepts timesheet entries; a locked timesheet refuses them', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay());
        await lock(w.tokens.sarah, w.abc.melbourne, { roster_locked: true });
        expect((await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'TIMESHEET', timesheet: [entry('09:00', '17:00')] })).status).toBe(200);
        await lock(w.tokens.sarah, w.abc.melbourne, { timesheet_locked: true });
        const res = await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'TIMESHEET', timesheet: [entry('09:00', '18:00')] });
        expect(res.status).toBe(423);
        expect(res.body.error.code).toBe('TIMESHEET_LOCKED');
    });

    it('a wrong password changes nothing and does not end the session', async () => {
        const res = await lock(w.tokens.sarah, w.abc.melbourne, { roster_locked: true }, 'not-my-password');
        expect(res.status).toBe(403);
        expect((await sql('SELECT COUNT(*)::int AS n FROM fortnight_locks')).rows[0].n).toBe(0);
        expect((await request(app).get('/api/auth/me').set(bearer(w.tokens.sarah))).status).toBe(200);
    });

    it('the organisation lock password works only for its own flag', async () => {
        await request(app).put('/api/organisation/lock-passwords').set(bearer(w.tokens.owner)).send({ current_password: PASSWORD, new_roster_lock_password: 'rosterpw' });
        expect((await lock(w.tokens.sarah, w.abc.melbourne, { roster_locked: true }, 'rosterpw')).status).toBe(200);
        expect((await lock(w.tokens.sarah, w.abc.melbourne, { timesheet_locked: true }, 'rosterpw')).status).toBe(403);
    });

    it('lock changes are audited with before and after values', async () => {
        await lock(w.tokens.sarah, w.abc.melbourne, { roster_locked: true });
        const audit = (await sql("SELECT previous_value, new_value, location_id FROM audit_logs WHERE action = 'PERIOD_LOCK_CHANGED'")).rows[0];
        expect(JSON.parse(audit.previous_value)).toEqual({ roster_locked: false, timesheet_locked: false });
        expect(JSON.parse(audit.new_value)).toEqual({ roster_locked: true, timesheet_locked: false });
        expect(audit.location_id).toBe(w.abc.melbourne);
    });
});

describe('approval', () => {
    it('approving freezes the fortnight; reopening unfreezes it', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay(true));
        expect((await request(app).post('/api/submissions/approve').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, start_date: PERIOD })).status).toBe(200);
        expect((await request(app).post('/api/submissions/approve').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, start_date: PERIOD })).status).toBe(409);
        expect((await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'ROSTER', roster: [] })).status).toBe(423);

        const reopen = await request(app).post('/api/submissions/reopen').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, start_date: PERIOD });
        expect(reopen.body.data.status).toBe('Draft');
        expect((await save(w.tokens.sarah, w.workers.mel, MONDAY, { scope: 'ROSTER', roster: [] })).status).toBe(200);
    });

    it('approval and reopening are refused while the branch’s timesheets are locked', async () => {
        await lock(w.tokens.sarah, w.abc.melbourne, { timesheet_locked: true });
        const res = await request(app).post('/api/submissions/approve').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, start_date: PERIOD });
        expect(res.status).toBe(423);
    });

    it('auto-log skips approved fortnights', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay());
        await request(app).post('/api/submissions/approve').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, start_date: PERIOD });
        await request(app).post('/api/roster/auto-log').set(bearer(w.tokens.sarah)).send({ start_date: PERIOD });
        expect((await dayOf(w.workers.mel, MONDAY)).timesheet).toEqual([]);
    });

    it('a start_date that is not the first day of a pay period is refused', async () => {
        const res = await request(app).post('/api/submissions/approve').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, start_date: MONDAY });
        expect(res.status).toBe(400);
    });

    it('the list shows Approved, Draft and Locked states per worker', async () => {
        await request(app).post('/api/submissions/approve').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, start_date: PERIOD });
        await lock(w.tokens.owner, w.abc.melbourne, { timesheet_locked: true });
        const list = await request(app).get(`/api/submissions?start_date=${PERIOD}`).set(bearer(w.tokens.owner));
        const status = Object.fromEntries(list.body.data.map((r: any) => [r.full_name, r.status]));
        expect(status).toEqual({ 'Gee Worker': 'Draft', 'Mel Worker': 'Locked', 'Rich Worker': 'Draft' });
    });
});

describe('branch isolation of day records', () => {
    it('another branch’s Branch Admin can neither read nor write the day', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay(true));
        const read = await request(app).get(`/api/records?start_date=${MONDAY}&employee_id=${w.workers.mel}`).set(bearer(w.tokens.greg));
        const write = await save(w.tokens.greg, w.workers.mel, MONDAY, { scope: 'TIMESHEET', timesheet: [] });
        expect([read.status, write.status]).toEqual([403, 403]);
        expect((await dayOf(w.workers.mel, MONDAY)).timesheet).toHaveLength(1);
    });
});
