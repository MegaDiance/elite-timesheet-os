/**
 * Per-shift break override (has_break) and the two bulk "Apply Break" endpoints.
 */
import request from 'supertest';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { connectTestDb, resetTestDb, closeTestDb, sql } from './helpers/testDb';
import { PERIOD, World, bearer, buildWorld, entry } from './helpers/fixtures';

// PERIOD (2026-03-29) is a Sunday, and break_mins_weekend defaults to 0 — a weekday date is
// needed to exercise the (weekday) break deduction at all. Both are inside PERIOD's fortnight.
const MONDAY = '2026-03-30';
const TUESDAY = '2026-03-31';
// The start of the *next* fortnight, so approving PERIOD's fortnight never touches it.
const NEXT_MONDAY = '2026-04-13';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

describe('has_break persists and affects hours', () => {
    it('a shift saved with has_break: false keeps the full 8 hours, no break deducted', async () => {
        const res = await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({
            employee_id: w.workers.mel, record_date: PERIOD,
            roster: [{ ...entry('09:00', '17:00'), has_break: false }],
            timesheet: [],
        });
        expect(res.status).toBe(200);
        expect(res.body.data.roster).toEqual([{ type: 'WORK', start: '09:00', finish: '17:00', hours: 8, has_break: false, break_mins: null }]);
    });

    it('defaults to has_break: true when omitted, matching today\'s behaviour (30 min deducted)', async () => {
        const res = await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({
            employee_id: w.workers.mel, record_date: MONDAY, roster: [entry('09:00', '17:00')], timesheet: [],
        });
        expect(res.body.data.roster[0]).toEqual({ type: 'WORK', start: '09:00', finish: '17:00', hours: 7.5, has_break: true, break_mins: null });
    });
});

describe('POST /records/apply-break', () => {
    async function seedTwoDays() {
        const dates = [MONDAY, TUESDAY];
        for (const date of dates) {
            await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({
                employee_id: w.workers.mel, record_date: date, roster: [entry('09:00', '17:00')], timesheet: [entry('09:00', '17:00')],
            });
        }
        return dates;
    }

    it('turns the break off for every existing segment on the given days, both roster and timesheet', async () => {
        const dates = await seedTwoDays();
        const res = await request(app).post('/api/records/apply-break').set(bearer(w.tokens.owner))
            .send({ employee_id: w.workers.mel, record_dates: dates, has_break: false });
        expect(res.status).toBe(200);
        expect(res.body.data.applied.sort()).toEqual(dates.sort());
        expect(res.body.data.skipped).toEqual([]);

        const rows = (await sql('SELECT has_break, roster_hours::float, actual_hours::float FROM shift_segments ss JOIN daily_records dr ON dr.id = ss.record_id WHERE dr.employee_id = $1', [w.workers.mel])).rows;
        for (const row of rows) {
            expect(row.has_break).toBe(false);
            expect(row.roster_hours).toBe(8);
            expect(row.actual_hours).toBe(8);
        }
    });

    it('turning it back on restores the break deduction', async () => {
        const dates = await seedTwoDays();
        await request(app).post('/api/records/apply-break').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, record_dates: dates, has_break: false });
        await request(app).post('/api/records/apply-break').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, record_dates: dates, has_break: true });
        const rows = (await sql('SELECT roster_hours::float FROM shift_segments ss JOIN daily_records dr ON dr.id = ss.record_id WHERE dr.employee_id = $1', [w.workers.mel])).rows;
        for (const row of rows) expect(row.roster_hours).toBe(7.5);
    });

    it('a day with nothing recorded is skipped as NOTHING_TO_CHANGE, not created', async () => {
        const res = await request(app).post('/api/records/apply-break').set(bearer(w.tokens.owner))
            .send({ employee_id: w.workers.mel, record_dates: [PERIOD], has_break: false });
        expect(res.body.data.applied).toEqual([]);
        expect(res.body.data.skipped).toEqual([{ date: PERIOD, reason: 'NOTHING_TO_CHANGE' }]);
        expect((await sql('SELECT COUNT(*)::int AS n FROM daily_records WHERE employee_id = $1', [w.workers.mel])).rows[0].n).toBe(0);
    });

    it('an approved fortnight is skipped, a day in a different fortnight still applies', async () => {
        await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({
            employee_id: w.workers.mel, record_date: NEXT_MONDAY, roster: [entry('09:00', '17:00')], timesheet: [entry('09:00', '17:00')],
        });
        await seedTwoDays(); // both MONDAY and TUESDAY are in PERIOD's fortnight
        await request(app).post('/api/submissions/approve').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, start_date: PERIOD });

        const res = await request(app).post('/api/records/apply-break').set(bearer(w.tokens.owner))
            .send({ employee_id: w.workers.mel, record_dates: [MONDAY, TUESDAY, NEXT_MONDAY], has_break: false });
        expect(res.body.data.applied).toEqual([NEXT_MONDAY]);
        expect(res.body.data.skipped).toEqual([
            { date: MONDAY, reason: 'TIMESHEET_ALREADY_APPROVED' },
            { date: TUESDAY, reason: 'TIMESHEET_ALREADY_APPROVED' },
        ]);
    });

    it('a Branch Admin outside the worker\'s branch is refused, another organisation gets 404', async () => {
        const dates = await seedTwoDays();
        expect((await request(app).post('/api/records/apply-break').set(bearer(w.tokens.greg)).send({ employee_id: w.workers.mel, record_dates: dates, has_break: false })).status).toBe(403);
        expect((await request(app).post('/api/records/apply-break').set(bearer(w.tokens.xavier)).send({ employee_id: w.workers.mel, record_dates: dates, has_break: false })).status).toBe(404);
    });
});

describe('POST /employees/:id/templates/apply-break', () => {
    it('flips has_break for the given template days only', async () => {
        await request(app).post(`/api/employees/${w.workers.mel}/templates`).set(bearer(w.tokens.owner)).send({
            templates: [
                { day_index: 1, roster_in: '09:00', roster_out: '17:00' },
                { day_index: 2, roster_in: '09:00', roster_out: '17:00' },
            ],
        });
        const res = await request(app).post(`/api/employees/${w.workers.mel}/templates/apply-break`).set(bearer(w.tokens.owner))
            .send({ day_indexes: [1], has_break: false });
        expect(res.status).toBe(200);

        const rows = (await sql('SELECT day_index, has_break FROM roster_templates WHERE employee_id = $1 ORDER BY day_index', [w.workers.mel])).rows;
        expect(rows).toEqual([{ day_index: 1, has_break: false }, { day_index: 2, has_break: true }]);
    });

    it('a Branch Admin outside the worker\'s branch is refused', async () => {
        const res = await request(app).post(`/api/employees/${w.workers.mel}/templates/apply-break`).set(bearer(w.tokens.greg)).send({ day_indexes: [1], has_break: false });
        expect(res.status).toBe(403);
    });
});
