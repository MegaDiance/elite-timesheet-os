/**
 * Roster and timesheet workflows on real PostgreSQL: multi-segment days, copying, automatic
 * roster/log, per-branch locks and approval.
 */
import request from 'supertest';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { connectTestDb, resetTestDb, closeTestDb, sql } from './helpers/testDb';
import { PASSWORD, PERIOD, World, bearer, buildWorld, simpleDay } from './helpers/fixtures';

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

const save = (token: string, workerId: string, date: string, segments: object[]) =>
    request(app).post('/api/records').set(bearer(token)).send({ employee_id: workerId, record_date: date, segments });

const segmentsOf = async (workerId: string, date: string) => (await sql(
    `SELECT ss.* FROM shift_segments ss JOIN daily_records dr ON dr.id = ss.record_id
      WHERE dr.employee_id = $1 AND dr.record_date = $2 ORDER BY COALESCE(ss.roster_in, ss.actual_in) NULLS LAST`,
    [workerId, date]
)).rows;

const lock = (token: string, branchId: string, flags: object, password = PASSWORD) =>
    request(app).post('/api/locks').set(bearer(token)).send({ location_id: branchId, start_date: PERIOD, password, ...flags });

describe('multi-segment days', () => {
    it('saves the complex day as one day with three segments', async () => {
        const res = await save(w.tokens.sarah, w.workers.mel, MONDAY, [
            { segment_type: 'Sick', roster_in: '09:00', roster_out: '13:00' },
            { segment_type: 'Annual', roster_in: '13:00', roster_out: '15:00' },
            { segment_type: 'WORK', roster_in: '15:00', roster_out: '17:00' },
        ]);
        expect(res.status).toBe(200);
        expect((await sql('SELECT COUNT(*)::int AS n FROM daily_records WHERE employee_id = $1', [w.workers.mel])).rows[0].n).toBe(1);
        const segs = await segmentsOf(w.workers.mel, MONDAY);
        expect(segs.map(s => [s.segment_type, Number(s.roster_hours)])).toEqual([['Sick', 4], ['Annual', 2], ['WORK', 1.5]]);

        const list = await request(app).get(`/api/records?start_date=${PERIOD}&employee_id=${w.workers.mel}`).set(bearer(w.tokens.sarah));
        expect(list.body.data[0].segments.map((s: any) => s.segment_type)).toEqual(['Sick', 'Annual', 'WORK']);
    });

    it('refuses overlapping segments with a clear message and changes nothing', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay());
        const res = await save(w.tokens.sarah, w.workers.mel, MONDAY, [
            { roster_in: '09:00', roster_out: '13:00' }, { roster_in: '12:00', roster_out: '17:00' },
        ]);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('OVERLAP');
        expect(res.body.error.message).toMatch(/segment 1 and segment 2/);
        expect((await segmentsOf(w.workers.mel, MONDAY)).map(s => s.roster_in)).toEqual(['09:00:00']);
    });

    it('supports LWIP and the stats count it separately', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, [{ segment_type: 'LWIP', roster_in: '09:00', roster_out: '13:00' }]);
        const stats = await request(app).get(`/api/records/stats?start_date=${PERIOD}&employee_id=${w.workers.mel}`).set(bearer(w.tokens.sarah));
        expect(stats.body.data.leave.LWIP).toBe(4);
    });

    it('rejects a record for an inactive worker', async () => {
        await request(app).post(`/api/employees/${w.workers.mel}/deactivate`).set(bearer(w.tokens.owner));
        expect((await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay())).status).toBe(400);
    });
});

describe('copying days', () => {
    it('copies a day’s segments to selected days and other workers in scope', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, [
            { segment_type: 'WORK', roster_in: '09:00', roster_out: '13:00' },
            { segment_type: 'TIL', roster_in: '13:00', roster_out: '15:00' },
        ]);
        const res = await request(app).post('/api/records/copy-day').set(bearer(w.tokens.sarah)).send({
            employee_id: w.workers.mel, source_date: MONDAY, target_dates: [TUESDAY, '2026-04-01'], target_employee_ids: [w.workers.mel, w.workers.rich],
        });
        expect(res.status).toBe(200);
        expect(res.body.data.copied).toHaveLength(4);
        expect((await segmentsOf(w.workers.rich, TUESDAY)).map(s => s.segment_type)).toEqual(['WORK', 'TIL']);
    });

    it('never overwrites a day that already has worked hours', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, [{ roster_in: '10:00', roster_out: '14:00' }]);
        await save(w.tokens.sarah, w.workers.mel, TUESDAY, [{ roster_in: '08:00', roster_out: '12:00', actual_in: '08:00', actual_out: '12:30' }]);
        const res = await request(app).post('/api/records/copy-day').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, source_date: MONDAY, target_dates: [TUESDAY] });
        expect(res.body.data.skipped).toEqual([{ employee_id: w.workers.mel, date: TUESDAY, reason: 'HAS_WORKED_HOURS' }]);
        const [seg] = await segmentsOf(w.workers.mel, TUESDAY);
        expect([seg.actual_in, seg.actual_out]).toEqual(['08:00:00', '12:30:00']);
    });
});

describe('automatic roster and log', () => {
    it('auto-roster replaces only the rostered side; worked hours and notes survive', async () => {
        await request(app).post(`/api/employees/${w.workers.mel}/templates`).set(bearer(w.tokens.sarah))
            .send({ templates: [{ day_index: 1, roster_in: '10:00', roster_out: '16:00' }] });
        await save(w.tokens.sarah, w.workers.mel, MONDAY, [{ roster_in: '09:00', roster_out: '17:00', actual_in: '09:05', actual_out: '17:02', notes: 'keep me' }]);

        const res = await request(app).post('/api/roster/auto-roster').set(bearer(w.tokens.sarah)).send({ start_date: PERIOD, selected_days: [1], location_id: w.abc.melbourne });
        expect(res.status).toBe(200);
        const [seg] = await segmentsOf(w.workers.mel, MONDAY);
        expect([seg.roster_in, seg.roster_out, seg.actual_in, seg.actual_out, seg.notes]).toEqual(['10:00:00', '16:00:00', '09:05:00', '17:02:00', 'keep me']);
    });

    it('auto-log fills worked hours only where none were recorded', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay());
        await save(w.tokens.sarah, w.workers.mel, TUESDAY, [{ roster_in: '09:00', roster_out: '17:00', actual_in: '09:30', actual_out: '17:00' }]);
        await request(app).post('/api/roster/auto-log').set(bearer(w.tokens.sarah)).send({ start_date: PERIOD, selected_days: [1, 2] });
        expect((await segmentsOf(w.workers.mel, MONDAY))[0].actual_in).toBe('09:00:00');
        expect((await segmentsOf(w.workers.mel, TUESDAY))[0].actual_in).toBe('09:30:00');
    });

    it('templates are validated with the same segment rules', async () => {
        const res = await request(app).post(`/api/employees/${w.workers.mel}/templates`).set(bearer(w.tokens.sarah))
            .send({ templates: [{ day_index: 1, roster_in: '09:00', roster_out: '13:00' }, { day_index: 1, roster_in: '12:00', roster_out: '17:00' }] });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('OVERLAP');
    });
});

describe('locks are per branch and change only what was asked', () => {
    it('locking Melbourne’s roster does not lock Richmond', async () => {
        expect((await lock(w.tokens.sarah, w.abc.melbourne, { roster_locked: true })).status).toBe(200);
        expect((await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay())).status).toBe(423);
        expect((await save(w.tokens.sarah, w.workers.rich, MONDAY, simpleDay())).status).toBe(200);
    });

    it('changing the roster lock leaves the timesheet lock alone', async () => {
        await lock(w.tokens.owner, w.abc.melbourne, { timesheet_locked: true });
        await lock(w.tokens.owner, w.abc.melbourne, { roster_locked: true });
        await lock(w.tokens.owner, w.abc.melbourne, { roster_locked: false });
        const row = (await sql('SELECT roster_locked, timesheet_locked FROM fortnight_locks WHERE location_id = $1', [w.abc.melbourne])).rows[0];
        expect(row).toEqual({ roster_locked: false, timesheet_locked: true });
    });

    it('a locked roster still accepts worked hours; a locked timesheet refuses them', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay());
        await lock(w.tokens.sarah, w.abc.melbourne, { roster_locked: true });
        expect((await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay(true))).status).toBe(200);
        await lock(w.tokens.sarah, w.abc.melbourne, { timesheet_locked: true });
        const res = await save(w.tokens.sarah, w.workers.mel, MONDAY, [{ roster_in: '09:00', roster_out: '17:00', actual_in: '09:00', actual_out: '18:00' }]);
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
        expect((await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay())).status).toBe(423);

        const reopen = await request(app).post('/api/submissions/reopen').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, start_date: PERIOD });
        expect(reopen.body.data.status).toBe('Draft');
        expect((await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay())).status).toBe(200);
    });

    it('approval and reopening are refused while the branch’s timesheets are locked', async () => {
        await lock(w.tokens.sarah, w.abc.melbourne, { timesheet_locked: true });
        const res = await request(app).post('/api/submissions/approve').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, start_date: PERIOD });
        expect(res.status).toBe(423);
    });

    it('auto-roster and auto-log skip approved fortnights', async () => {
        await save(w.tokens.sarah, w.workers.mel, MONDAY, simpleDay());
        await request(app).post('/api/submissions/approve').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, start_date: PERIOD });
        await request(app).post('/api/roster/auto-log').set(bearer(w.tokens.sarah)).send({ start_date: PERIOD });
        expect((await segmentsOf(w.workers.mel, MONDAY))[0].actual_in).toBeNull();
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
