/**
 * Defects found in the pre-merge audit, each pinned by a test:
 *   - parallel requests could get past attempt limits (sign-in, sensitive password checks, re-entry);
 *   - an upper-case UUID got past "nobody changes their own access / the owner";
 *   - a role with pending invitations could gain organisation-wide permissions without the password step;
 *   - staff-import checks named people in branches the caller can't see;
 *   - auto-approved leave could change a fortnight the employee had submitted;
 *   - the 5 MB import body was read before sign-in was checked.
 */
import request from 'supertest';
import app from '../../src/index';
import { clearAllRateLimits } from '../../src/services/authUtils';
import { connectTestDb, resetTestDb, closeTestDb, sql } from '../helpers/testDb';
import { PASSWORD, PERIOD, World, assignRole, bearer, buildWorld, createRole, createUser, signIn } from '../helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

const WRONG = 'Wrong12345';
const tally = (rs: request.Response[]) => rs.reduce((m: Record<number, number>, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});

describe('limits hold under parallel requests', () => {
    it('40 wrong passwords at once for one account: at most 5 are checked', async () => {
        const rs = await Promise.all(Array.from({ length: 40 }, () =>
            request(app).post('/api/auth/login').send({ email: w.users.sarah.email, password: WRONG, organisation_slug: w.abc.portalSlug })));
        const checked = (await sql("SELECT COUNT(*)::int n FROM login_history WHERE email = $1 AND status = 'FAILED'", [w.users.sarah.email])).rows[0].n;
        expect(checked).toBeLessThanOrEqual(5);
        expect(tally(rs)[429]).toBeGreaterThanOrEqual(35);
    });

    it('the same for turning two-step verification off and for password re-entry', async () => {
        for (const [path, token] of [['/api/auth/2fa/disable', w.tokens.greg], ['/api/auth/reauthenticate', w.tokens.sarah]] as const) {
            const rs = await Promise.all(Array.from({ length: 30 }, () => request(app).post(path).set(bearer(token)).send({ password: WRONG })));
            const t = tally(rs);
            expect({ path, checked: (t[401] || 0) + (t[403] || 0) <= 5 }).toEqual({ path, checked: true });
        }
    });

    it('a correct password still works when tried alone', async () => {
        expect((await request(app).post('/api/auth/login').send({ email: w.users.sarah.email, password: PASSWORD, organisation_slug: w.abc.portalSlug })).status).toBe(200);
    });
});

describe('ids are compared the way the database compares them', () => {
    it('an upper-case id is still you, or still the owner', async () => {
        const hr = await createRole(w.abc.id, 'Viewer', ['employees.view']);
        const admin = await createUser('people@abc.test');
        await assignRole(w.abc.id, admin.id, await createRole(w.abc.id, 'People', ['users.manage', 'employees.view']), 'all');
        const token = await signIn(admin.id, w.abc.id);
        const self = await request(app).post('/api/team/bulk-assign').set(bearer(token)).send({ user_ids: [admin.id.toUpperCase()], role_id: hr, scope: { all: true } });
        expect(self.status).toBe(403);
        const single = await request(app).post(`/api/team/${admin.id.toUpperCase()}/roles`).set(bearer(token)).send({ role_id: hr, scope: { all: true } });
        expect(single.status).toBe(403);
        const owner = await request(app).post('/api/team/bulk-assign').set(bearer(w.tokens.owner)).send({ user_ids: [w.users.owner.id.toUpperCase()], role_id: hr, scope: { all: true } });
        expect(owner.status).toBe(403);
        // The same person twice in different cases is one person, not a database error.
        const twice = await request(app).post('/api/team/bulk-assign').set(bearer(w.tokens.owner)).send({ user_ids: [w.users.greg.id, w.users.greg.id.toUpperCase()], role_id: hr, scope: { all: true } });
        expect(twice.status).toBe(201);
        expect(twice.body.data.assigned).toEqual([w.users.greg.id]);
    });
});

it('adding organisation-wide control to a role with a pending invitation asks for the password', async () => {
    const role = await createRole(w.abc.id, 'Helper', ['employees.view']);
    expect((await request(app).post('/api/team/invitations').set(bearer(w.tokens.owner)).send({ email: 'new@abc.test', role_id: role, scope: { all: true } })).status).toBe(201);
    const edit = await request(app).put(`/api/roles/${role}`).set(bearer(w.tokens.owner)).send({ permissions: ['employees.view', 'users.manage'] });
    expect(edit.body.error?.code).toBe('REAUTH_REQUIRED');
});

it('staff-import checks never name people in branches the caller can’t see', async () => {
    await sql("UPDATE employees SET email = 'gee@abc.test', employee_code = 'G1' WHERE id = $1", [w.workers.gee]);
    // Sarah sees Melbourne and Richmond only; Gee works in Geelong.
    const res = await request(app).post('/api/staff-import/validate').set(bearer(w.tokens.sarah)).send({ rows: [
        { row: 2, full_name: 'gee worker', branch: 'Melbourne' },
        { row: 3, full_name: 'New One', branch: 'Melbourne', email: 'gee@abc.test' },
        { row: 4, full_name: 'New Two', branch: 'Melbourne', employee_code: 'g1' },
    ] });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Gee Worker');
    expect(res.body.data.invalid).toBe(3);
    // Someone she can see is still named, which helps fix the file.
    const own = await request(app).post('/api/staff-import/validate').set(bearer(w.tokens.sarah)).send({ rows: [{ row: 2, full_name: 'mel worker', branch: 'Melbourne' }] });
    expect(JSON.stringify(own.body)).toContain('Mel Worker');
});

it('leave an employee records themselves never changes a fortnight they’ve submitted', async () => {
    await request(app).put('/api/organisation/settings').set(bearer(w.tokens.owner)).send({ leave_requests_require_approval: false });
    await request(app).post('/api/portal/timesheet').set(bearer(w.tokens.melEmployee)).send({ record_date: PERIOD, timesheet: [{ type: 'WORK', start: '09:00', finish: '17:00' }] });
    expect((await request(app).post('/api/portal/timesheet/submit').set(bearer(w.tokens.melEmployee)).send({ start_date: PERIOD })).status).toBe(200);
    const before = (await sql("SELECT COUNT(*)::int n FROM shift_segments s JOIN daily_records d ON d.id = s.record_id WHERE d.employee_id = $1 AND s.segment_type <> 'WORK'", [w.workers.mel])).rows[0].n;
    const leave = await request(app).post('/api/portal/leave-requests').set(bearer(w.tokens.melEmployee)).send({ leave_type: 'Annual', start_date: PERIOD, end_date: PERIOD, hours: 7.5 });
    expect(leave.status).toBe(201);
    expect(leave.body.data.skipped.map((s: any) => s.reason)).toEqual(['TIMESHEET_SUBMITTED']);
    const after = (await sql("SELECT COUNT(*)::int n FROM shift_segments s JOIN daily_records d ON d.id = s.record_id WHERE d.employee_id = $1 AND s.segment_type <> 'WORK'", [w.workers.mel])).rows[0].n;
    expect(after).toBe(before);
});

it('a large import body is refused before it is read when not signed in', async () => {
    const big = { rows: Array.from({ length: 20000 }, (_, i) => ({ full_name: `x${i}`.padEnd(100, 'x') })) };
    // The server answers 401 without reading the body and closes the connection, so the client sees
    // either that 401 or a connection reset while it is still sending. Both mean the body was never processed.
    try {
        const res = await request(app).post('/api/staff-import/validate').send(big);
        expect(res.status).toBe(401);
    } catch (err) {
        expect((err as NodeJS.ErrnoException).code).toMatch(/ECONNRESET|EPIPE/);
    }
});
