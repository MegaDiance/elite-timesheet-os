/**
 * The Submitted state, used when employees handle their own timesheets:
 *   employee: Draft → Submitted (submit), Submitted → Draft (withdraw)
 *   manager:  Draft or Submitted → Approved (approve), Submitted → Draft (send back), Approved → Draft (reopen)
 * While Submitted the employee can't change their days; a manager still can.
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

const mel = () => bearer(w.tokens.melEmployee);
const submit = () => request(app).post('/api/portal/timesheet/submit').set(mel()).send({ start_date: PERIOD });
const withdraw = () => request(app).post('/api/portal/timesheet/withdraw').set(mel()).send({ start_date: PERIOD });
const ownDay = (start = '09:00') => request(app).post('/api/portal/timesheet').set(mel())
    .send({ record_date: PERIOD, timesheet: [{ type: 'WORK', start, finish: '17:00' }] });
const statusFor = async (token: string) => {
    const res = await request(app).get(`/api/submissions?start_date=${PERIOD}`).set(bearer(token));
    return res.body.data.find((r: any) => r.employee_id === w.workers.mel)?.status;
};

it('an employee submits their fortnight, and the manager sees it as Submitted', async () => {
    expect((await ownDay()).status).toBe(200);
    const res = await submit();
    expect([res.status, res.body.data.status]).toEqual([200, 'Submitted']);
    expect(await statusFor(w.tokens.sarah)).toBe('Submitted');
    const own = await request(app).get(`/api/portal/timesheet?start_date=${PERIOD}`).set(mel());
    expect(own.body.submitted).toBe(true);
    const row = (await sql('SELECT submitted_at, submitted_by FROM timesheet_submissions WHERE employee_id = $1', [w.workers.mel])).rows[0];
    expect(row.submitted_by).toBe(w.users.melEmployee.id);
    expect(row.submitted_at).toBeTruthy();
    expect((await sql("SELECT 1 FROM audit_logs WHERE action = 'TIMESHEET_SUBMITTED'")).rows).toHaveLength(1);
});

it('while submitted the employee can’t change it, until they withdraw it; a manager still can', async () => {
    await ownDay();
    await submit();
    const blocked = await ownDay('08:00');
    expect([blocked.status, blocked.body.error.code]).toEqual([423, 'TIMESHEET_SUBMITTED']);
    // The manager can still correct the day.
    expect((await request(app).post('/api/records').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, record_date: PERIOD, ...simpleDay(true) })).status).toBe(200);

    expect((await withdraw()).body.data.status).toBe('Draft');
    expect((await ownDay('08:00')).status).toBe(200);
});

it('the manager approves from Submitted; after that the employee can neither withdraw nor submit', async () => {
    await submit();
    const approved = await request(app).post('/api/submissions/approve').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, start_date: PERIOD });
    expect(approved.status).toBe(200);
    expect(await statusFor(w.tokens.sarah)).toBe('Approved');
    expect((await withdraw()).body.error.code).toBe('ALREADY_APPROVED');
    expect((await submit()).body.error.code).toBe('ALREADY_APPROVED');
});

it('the manager can send a submitted timesheet back, which is audited as such', async () => {
    await submit();
    const back = await request(app).post('/api/submissions/reopen').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, start_date: PERIOD });
    expect([back.status, back.body.data.status]).toEqual([200, 'Draft']);
    expect((await sql("SELECT 1 FROM audit_logs WHERE action = 'TIMESHEET_SENT_BACK'")).rows).toHaveLength(1);
    expect((await ownDay('07:00')).status).toBe(200);
});

it('submitting twice, or withdrawing a draft, is refused without changing anything', async () => {
    await submit();
    expect((await submit()).body.error.code).toBe('ALREADY_SUBMITTED');
    await withdraw();
    expect((await withdraw()).body.error.code).toBe('NOT_SUBMITTED');
});

it('does nothing while employee timesheets are switched off, or while the period is locked', async () => {
    await request(app).put('/api/organisation/settings').set(bearer(w.tokens.owner)).send({ employees_can_submit_timesheets: false });
    expect((await submit()).body.error.code).toBe('EMPLOYEE_TIMESHEETS_DISABLED');
    await request(app).put('/api/organisation/settings').set(bearer(w.tokens.owner)).send({ employees_can_submit_timesheets: true });

    await sql('INSERT INTO fortnight_locks (org_id, location_id, start_date, timesheet_locked) VALUES ($1, $2, $3, true)', [w.abc.id, w.abc.melbourne, PERIOD]);
    expect((await submit()).status).toBe(423);
});

it('only the employee themselves can submit, and only their own timesheet', async () => {
    expect((await request(app).post('/api/portal/timesheet/submit').set(bearer(w.tokens.sarah)).send({ start_date: PERIOD })).status).toBe(403);
    // Rich submitting doesn't touch Mel.
    await request(app).post('/api/portal/timesheet/submit').set(bearer(w.tokens.richEmployee)).send({ start_date: PERIOD });
    expect(await statusFor(w.tokens.sarah)).toBe('Draft');
    expect((await request(app).post('/api/portal/timesheet/submit').set(mel()).send({ start_date: '2026-03-31' })).status).toBe(400);
});
