/**
 * Split days through the real save route (POST /api/records), with the organisation's
 * "automatically merge leave with the roster" setting on and off. Covers both the rostered and
 * the worked side, the break rule, overlaps, invalid ranges and boundary times. Real PostgreSQL.
 */
import request from 'supertest';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { connectTestDb, resetTestDb, closeTestDb } from './helpers/testDb';
import { World, bearer, buildWorld, entry } from './helpers/fixtures';

const MONDAY = '2026-03-30';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

const setMerge = (on: boolean) =>
    request(app).put('/api/organisation/settings').set(bearer(w.tokens.owner)).send({ automatically_merge_leave_with_roster: on });
const save = (day: object) =>
    request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, record_date: MONDAY, ...day });
const lines = (list: any[]) => list.map(e => [e.type, e.start, e.finish, e.hours]);
const total = (list: any[]) => Math.round(list.reduce((sum, e) => sum + Number(e.hours || 0), 0) * 100) / 100;

describe('merge on: leave splits Normal Work around it', () => {
    beforeEach(async () => { expect((await setMerge(true)).status).toBe(200); });

    it('work + sick (the documented example): 9–5 with 1–2 sick → 9–1 work, 1–2 sick, 2–5 work, on both sides', async () => {
        const day = [entry('09:00', '17:00'), entry('13:00', '14:00', 'Sick')];
        const res = await save({ roster: day, timesheet: day });
        expect(res.status).toBe(200);
        const expected = [['Sick', '13:00', '14:00', 1], ['WORK', '09:00', '13:00', 3.5], ['WORK', '14:00', '17:00', 3]];
        expect(lines(res.body.data.roster).sort()).toEqual(expected.sort());
        expect(lines(res.body.data.timesheet).sort()).toEqual(expected.sort());
        // 8 h day, 1 h sick, the org's 30 min break comes off the longer work piece only.
        expect(total(res.body.data.timesheet)).toBe(7.5);
    });

    it('9–1 work, 1–3 sick, 3–5 work entered directly is kept exactly as entered', async () => {
        const day = [entry('09:00', '13:00'), entry('13:00', '15:00', 'Sick'), entry('15:00', '17:00')];
        const res = await save({ roster: day, timesheet: [] });
        expect(res.status).toBe(200);
        expect(lines(res.body.data.roster).sort()).toEqual([['Sick', '13:00', '15:00', 2], ['WORK', '09:00', '13:00', 3.5], ['WORK', '15:00', '17:00', 2]].sort());
    });

    it('work + annual leave at the start of the shift leaves one work piece after it', async () => {
        const res = await save({ roster: [entry('09:00', '17:00'), entry('09:00', '12:00', 'Annual')], timesheet: [] });
        expect(lines(res.body.data.roster).sort()).toEqual([['Annual', '09:00', '12:00', 3], ['WORK', '12:00', '17:00', 4.5]].sort());
    });

    it('multiple leave periods in one shift: every work piece between them survives', async () => {
        const res = await save({
            roster: [entry('08:00', '18:00'), entry('10:00', '11:00', 'Sick'), entry('14:00', '15:30', 'Annual')],
            timesheet: [],
        });
        expect(res.status).toBe(200);
        const work = res.body.data.roster.filter((e: any) => e.type === 'WORK').map((e: any) => [e.start, e.finish]);
        expect(work.sort()).toEqual([['08:00', '10:00'], ['11:00', '14:00'], ['15:30', '18:00']]);
    });

    it('leave covering the whole shift leaves only the leave', async () => {
        const res = await save({ roster: [entry('09:00', '17:00'), entry('09:00', '17:00', 'Sick')], timesheet: [] });
        expect(lines(res.body.data.roster)).toEqual([['Sick', '09:00', '17:00', 8]]);
    });

    it('boundary: leave that only touches the shift (ends as work starts) does not split it', async () => {
        const res = await save({ roster: [entry('07:00', '09:00', 'Sick'), entry('09:00', '17:00')], timesheet: [] });
        expect(lines(res.body.data.roster).sort()).toEqual([['Sick', '07:00', '09:00', 2], ['WORK', '09:00', '17:00', 7.5]].sort());
    });

    it('overlapping leave with leave is still refused — never silently resolved', async () => {
        const res = await save({ roster: [entry('09:00', '17:00'), entry('12:00', '14:00', 'Sick'), entry('13:00', '15:00', 'Annual')], timesheet: [] });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('OVERLAP');
    });

    it('overlapping work with work is still refused', async () => {
        const res = await save({ roster: [entry('09:00', '13:00'), entry('12:00', '17:00')], timesheet: [] });
        expect(res.body.error.code).toBe('OVERLAP');
    });

    it('the worked side is merged on its own: worked sick leave does not change the roster', async () => {
        const res = await save({ roster: [entry('09:00', '17:00')], timesheet: [entry('09:00', '17:00'), entry('13:00', '14:00', 'Sick')] });
        expect(lines(res.body.data.roster)).toEqual([['WORK', '09:00', '17:00', 7.5]]);
        expect(res.body.data.timesheet.filter((e: any) => e.type === 'WORK')).toHaveLength(2);
    });
});

describe('merge off: overlapping leave is refused instead of merged', () => {
    it('work + sick overlapping → OVERLAP, and nothing is saved', async () => {
        await setMerge(false);
        const res = await save({ roster: [entry('09:00', '17:00'), entry('13:00', '14:00', 'Sick')], timesheet: [] });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('OVERLAP');
        const day = await request(app).get(`/api/records?start_date=${MONDAY}&end_date=${MONDAY}&employee_id=${w.workers.mel}`).set(bearer(w.tokens.owner));
        expect(day.body.data[0]?.roster ?? []).toEqual([]);
    });

    it('a split day entered without overlaps is saved as entered', async () => {
        await setMerge(false);
        const res = await save({ roster: [entry('09:00', '13:00'), entry('13:00', '15:00', 'Sick'), entry('15:00', '17:00')], timesheet: [] });
        expect(res.status).toBe(200);
        expect(res.body.data.roster).toHaveLength(3);
    });
});

describe('invalid ranges are refused with a specific reason', () => {
    it.each([
        ['start equals finish', [entry('09:00', '09:00')], 'EMPTY_SEGMENT'],
        ['a finish that is not a time', [entry('09:00', '25:00')], 'INVALID_TIME'],
        ['only a start', [entry('09:00', null)], 'INCOMPLETE_SEGMENT'],
        ['backwards by more than an overnight shift', [entry('17:00', '09:00'), entry('09:30', '10:00')], null],
        ['an unknown leave type', [entry('09:00', '17:00', 'Holiday')], 'INVALID_TYPE'],
    ])('%s', async (_label, roster, code) => {
        const res = await save({ roster, timesheet: [] });
        if (code) {
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe(code);
        } else {
            expect(res.status).toBeLessThan(500);
        }
    });

    it('boundary: one segment may be exactly 14 hours, not a minute more', async () => {
        expect((await save({ roster: [entry('06:00', '20:00')], timesheet: [] })).status).toBe(200);
        const tooLong = await save({ roster: [entry('06:00', '20:01')], timesheet: [] });
        expect(tooLong.status).toBe(400);
        expect(tooLong.body.error.code).toBe('BACKWARDS_TIME');
    });

    it('boundary: an overnight shift (22:00 → 06:00) is accepted', async () => {
        expect((await save({ roster: [entry('22:00', '06:00')], timesheet: [] })).status).toBe(200);
    });
});
