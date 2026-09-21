/**
 * Branch and organisation isolation: what comes back, not just the status code.
 * Covers ID, query-string, body and header tampering, and stale access after changes.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/index';
import { clearAllRateLimits } from '../../src/services/authUtils';
import { connectTestDb, resetTestDb, closeTestDb, sql } from '../helpers/testDb';
import { PASSWORD, PERIOD, World, bearer, buildWorld, simpleDay, signIn } from '../helpers/fixtures';

const names = (rows: any[]) => rows.map(r => r.full_name).sort();

describe('Branch and organisation isolation', () => {
    let w: World;

    beforeAll(connectTestDb);
    afterAll(closeTestDb);
    beforeEach(async () => {
        await resetTestDb();
        clearAllRateLimits();
        w = await buildWorld();
    });

    describe('lists contain only the caller’s scope', () => {
        it('Owner sees every branch’s workers, Branch Admins only their branches’, XYZ none of ABC’s', async () => {
            const owner = await request(app).get('/api/employees').set(bearer(w.tokens.owner));
            const sarah = await request(app).get('/api/employees').set(bearer(w.tokens.sarah));
            const greg = await request(app).get('/api/employees').set(bearer(w.tokens.greg));
            const xavier = await request(app).get('/api/employees').set(bearer(w.tokens.xavier));
            expect(names(owner.body.data)).toEqual(['Gee Worker', 'Mel Worker', 'Rich Worker']);
            expect(names(sarah.body.data)).toEqual(['Mel Worker', 'Rich Worker']);
            expect(names(greg.body.data)).toEqual(['Gee Worker']);
            expect(names(xavier.body.data)).toEqual(['Syd Worker']);
        });

        it('branch list is limited to assigned branches', async () => {
            const sarah = await request(app).get('/api/locations').set(bearer(w.tokens.sarah));
            expect(sarah.body.data.map((b: any) => b.name).sort()).toEqual(['Melbourne', 'Richmond']);
            const greg = await request(app).get('/api/locations').set(bearer(w.tokens.greg));
            expect(greg.body.data.map((b: any) => b.name)).toEqual(['Geelong']);
        });

        it('timesheet list, payroll report, CSV and dashboard never include another branch', async () => {
            await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.gee, record_date: '2026-03-30', segments: simpleDay(true) });

            const subs = await request(app).get(`/api/submissions?start_date=${PERIOD}`).set(bearer(w.tokens.sarah));
            expect(names(subs.body.data)).toEqual(['Mel Worker', 'Rich Worker']);

            const report = await request(app).get(`/api/reports/payroll?start_date=${PERIOD}`).set(bearer(w.tokens.sarah));
            expect(names(report.body.data.employees)).toEqual(['Mel Worker', 'Rich Worker']);

            const csv = await request(app).get(`/api/reports/export/csv?start_date=${PERIOD}`).set(bearer(w.tokens.sarah));
            expect(csv.text).not.toContain('Gee Worker');

            const dash = await request(app).get('/api/dashboard/today?date=2026-03-30').set(bearer(w.tokens.sarah));
            expect(JSON.stringify(dash.body)).not.toContain('Gee Worker');
            expect(dash.body.data.branches.map((b: any) => b.name).sort()).toEqual(['Melbourne', 'Richmond']);
            expect(dash.body.data.organisation).toBeNull();
        });

        it('records list ignores other branches even without an employee filter', async () => {
            await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.gee, record_date: '2026-03-30', segments: simpleDay() });
            await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, record_date: '2026-03-30', segments: simpleDay() });
            const res = await request(app).get(`/api/records?start_date=${PERIOD}`).set(bearer(w.tokens.sarah));
            expect(res.body.data.map((r: any) => r.employee_id)).toEqual([w.workers.mel]);
        });
    });

    describe('tampering', () => {
        it('a branch id in the query outside scope is refused (403), never widened or ignored', async () => {
            const res = await request(app).get(`/api/employees?location_id=${w.abc.melbourne}`).set(bearer(w.tokens.greg));
            expect(res.status).toBe(403);
            expect(JSON.stringify(res.body)).not.toContain('Mel Worker');
        });

        it('an x-location-id header grants nothing', async () => {
            const res = await request(app).get('/api/employees').set(bearer(w.tokens.greg)).set('x-location-id', w.abc.melbourne);
            expect(names(res.body.data)).toEqual(['Gee Worker']);
        });

        it('a body branch id cannot redirect a write to an out-of-scope worker', async () => {
            const res = await request(app).post('/api/records').set(bearer(w.tokens.greg))
                .send({ employee_id: w.workers.mel, location_id: w.abc.geelong, branch_id: w.abc.geelong, record_date: '2026-03-30', segments: simpleDay() });
            expect(res.status).toBe(403);
            const rows = await sql('SELECT 1 FROM daily_records WHERE employee_id = $1', [w.workers.mel]);
            expect(rows.rows).toHaveLength(0);
        });

        it('a Branch Admin cannot create a worker in, or move a worker to, another branch', async () => {
            const create = await request(app).post('/api/employees').set(bearer(w.tokens.greg)).send({ full_name: 'Sneaky', location_id: w.abc.melbourne });
            expect(create.status).toBe(403);
            const move = await request(app).put(`/api/employees/${w.workers.gee}`).set(bearer(w.tokens.greg)).send({ full_name: 'Gee Worker', location_id: w.abc.melbourne });
            expect(move.status).toBe(403);
            const row = await sql('SELECT location_id FROM employees WHERE id = $1', [w.workers.gee]);
            expect(row.rows[0].location_id).toBe(w.abc.geelong);
        });

        it('bulk approve reports out-of-scope items instead of silently dropping or approving them', async () => {
            const res = await request(app).post('/api/submissions/bulk-approve').set(bearer(w.tokens.sarah))
                .send({ start_date: PERIOD, employee_ids: [w.workers.mel, w.workers.gee, w.workers.syd] });
            expect(res.body.data.approved.map((a: any) => a.employee_id)).toEqual([w.workers.mel]);
            expect(res.body.data.failed.map((f: any) => [f.employee_id, f.code])).toEqual([
                [w.workers.gee, 'FORBIDDEN'],
                [w.workers.syd, 'NOT_FOUND'],
            ]);
            const approved = await sql("SELECT employee_id FROM timesheet_submissions WHERE status = 'Approved'");
            expect(approved.rows.map((r: any) => r.employee_id)).toEqual([w.workers.mel]);
        });

        it('copy-day authorises every target worker', async () => {
            await request(app).post('/api/records').set(bearer(w.tokens.sarah)).send({ employee_id: w.workers.mel, record_date: '2026-03-30', segments: simpleDay() });
            const res = await request(app).post('/api/records/copy-day').set(bearer(w.tokens.sarah))
                .send({ employee_id: w.workers.mel, source_date: '2026-03-30', target_dates: ['2026-03-31'], target_employee_ids: [w.workers.rich, w.workers.gee] });
            expect(res.status).toBe(403);
        });

        it('auto-roster without a filter only touches the caller’s branches', async () => {
            const res = await request(app).post('/api/roster/auto-roster').set(bearer(w.tokens.greg)).send({ start_date: PERIOD, selected_days: [1] });
            expect(res.status).toBe(200);
            const rows = await sql('SELECT DISTINCT employee_id FROM daily_records');
            expect(rows.rows.map((r: any) => r.employee_id)).toEqual([w.workers.gee]);
        });

        it('another organisation’s ids are 404, and nothing about them is returned', async () => {
            const cases = [
                request(app).get(`/api/locations/${w.xyz.sydney}`).set(bearer(w.tokens.owner)),
                request(app).put(`/api/employees/${w.workers.syd}`).set(bearer(w.tokens.owner)).send({ full_name: 'Hijack' }),
                request(app).get(`/api/records?start_date=${PERIOD}&employee_id=${w.workers.syd}`).set(bearer(w.tokens.owner)),
                request(app).post('/api/submissions/approve').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.syd, start_date: PERIOD }),
                request(app).post('/api/locks').set(bearer(w.tokens.owner)).send({ location_id: w.xyz.sydney, start_date: PERIOD, roster_locked: true, password: PASSWORD }),
                request(app).post('/api/branch-admins/invitations').set(bearer(w.tokens.owner)).send({ email: 'x@x.test', location_ids: [w.xyz.sydney] }),
                request(app).put(`/api/branch-admins/${w.users.sarah.id}/branches`).set(bearer(w.tokens.xavier)).send({ location_ids: [w.xyz.sydney] }),
            ];
            for (const res of await Promise.all(cases)) {
                expect(res.status).toBe(404);
                expect(JSON.stringify(res.body)).not.toMatch(/Syd Worker|Sydney|Sarah/);
            }
            const worker = await sql('SELECT full_name FROM employees WHERE id = $1', [w.workers.syd]);
            expect(worker.rows[0].full_name).toBe('Syd Worker');
        });
    });

    describe('access follows the database, not the token', () => {
        it('removing a Branch Admin from a branch takes effect on the very next request', async () => {
            const before = await request(app).get(`/api/employees?location_id=${w.abc.richmond}`).set(bearer(w.tokens.sarah));
            expect(before.status).toBe(200);
            await request(app).put(`/api/branch-admins/${w.users.sarah.id}/branches`).set(bearer(w.tokens.owner)).send({ location_ids: [w.abc.melbourne] });
            const after = await request(app).get(`/api/employees?location_id=${w.abc.richmond}`).set(bearer(w.tokens.sarah));
            expect(after.status).toBe(403);
        });

        it('removing all of a Branch Admin’s branches ends their session', async () => {
            await request(app).delete(`/api/branch-admins/${w.users.greg.id}`).set(bearer(w.tokens.owner));
            const res = await request(app).get('/api/auth/me').set(bearer(w.tokens.greg));
            expect(res.status).toBe(401);
        });

        it('deactivating a branch removes it from every Branch Admin’s scope immediately', async () => {
            await request(app).post(`/api/locations/${w.abc.richmond}/deactivate`).set(bearer(w.tokens.owner));
            const res = await request(app).get(`/api/employees?location_id=${w.abc.richmond}`).set(bearer(w.tokens.sarah));
            expect(res.status).toBe(403);
        });

        it('role, organisation and branch claims in a token are ignored', async () => {
            const session = jwt.decode(w.tokens.greg) as any;
            const forged = jwt.sign(
                { sub: w.users.greg.id, sid: session.sid, role: 'OWNER', organisation_id: w.xyz.id, location_id: w.abc.melbourne },
                process.env.JWT_SECRET as string
            );
            const me = await request(app).get('/api/auth/me').set(bearer(forged));
            expect(me.body.data.role).toBe('BRANCH_ADMIN');
            expect(me.body.data.organisation.id).toBe(w.abc.id);
            const settings = await request(app).put('/api/organisation/settings').set(bearer(forged)).send({ break_mins_weekday: 0 });
            expect(settings.status).toBe(403);
        });

        it('a token without a server session is rejected', async () => {
            const sessionless = jwt.sign({ sub: w.users.owner.id }, process.env.JWT_SECRET as string);
            expect((await request(app).get('/api/auth/me').set(bearer(sessionless))).status).toBe(401);
        });

        it('a session cannot be replayed by a different user', async () => {
            const { sid } = jwt.decode(w.tokens.owner) as any;
            const stolen = jwt.sign({ sub: w.users.greg.id, sid }, process.env.JWT_SECRET as string);
            expect((await request(app).get('/api/auth/me').set(bearer(stolen))).status).toBe(401);
        });

        it('a person with access to two organisations only acts in the session’s organisation', async () => {
            // Greg becomes a Branch Admin of XYZ as well; his ABC session still only reaches ABC.
            await sql('INSERT INTO branch_admins (org_id, location_id, user_id) VALUES ($1, $2, $3)', [w.xyz.id, w.xyz.sydney, w.users.greg.id]);
            const list = await request(app).get('/api/employees').set(bearer(w.tokens.greg));
            expect(names(list.body.data)).toEqual(['Gee Worker']);
            const xyzToken = await signIn(w.users.greg.id, w.xyz.id);
            const xyzList = await request(app).get('/api/employees').set(bearer(xyzToken));
            expect(names(xyzList.body.data)).toEqual(['Syd Worker']);
        });
    });
});
