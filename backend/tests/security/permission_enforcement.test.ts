/**
 * Every permission is necessary AND sufficient for what it guards, and scope is absolute.
 *
 * For each capability below two people are tested against the real API:
 *   - someone holding ONLY that permission (organisation-wide): must be allowed;
 *   - someone holding EVERY OTHER permission (organisation-wide): must be refused with 403.
 * Then the branch scope: the same role held for one branch, for all branches, in combination with
 * other roles, and with ids, branches and organisations the client made up.
 */
import request from 'supertest';
import app from '../../src/index';
import { clearAllRateLimits } from '../../src/services/authUtils';
import { ASSIGNABLE_PERMISSIONS } from '../../src/services/permissions';
import { connectTestDb, resetTestDb, closeTestDb, sql } from '../helpers/testDb';
import { PASSWORD, PERIOD, World, assignRole, bearer, buildWorld, createRole, createUser, entry, signIn } from '../helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    personaCount = 0;
    w = await buildWorld();
});

const MONDAY = '2026-03-30';
let personaCount = 0;

/** A fresh person holding a fresh custom role with exactly `permissions`, over `scope`. Returns their session token. */
async function persona(permissions: readonly string[], scope: 'all' | string[] = 'all'): Promise<string> {
    const n = ++personaCount;
    const user = await createUser(`persona${n}@abc.test`, `Persona ${n}`);
    const role = await createRole(w.abc.id, `Persona role ${n}`, [...permissions]);
    await assignRole(w.abc.id, user.id, role, scope);
    return signIn(user.id, w.abc.id);
}

const ownerSave = (body: object) => request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, record_date: MONDAY, ...body });
const save = (token: string, body: object) => request(app).post('/api/records').set(bearer(token)).send({ employee_id: w.workers.mel, record_date: MONDAY, ...body });

interface Capability {
    permission: string;
    name: string;
    prepare?: () => Promise<unknown>;
    call: (token: string) => Promise<request.Response>;
    allowed: number;
}

const capabilities: Capability[] = [
    { permission: 'employees.create', name: 'add a worker', allowed: 201, call: t => request(app).post('/api/employees').set(bearer(t)).send({ full_name: 'Nina New', location_id: w.abc.melbourne }) },
    { permission: 'employees.edit', name: 'edit a worker', allowed: 200, call: t => request(app).put(`/api/employees/${w.workers.mel}`).set(bearer(t)).send({ full_name: 'Mel Worker', contracted_hours: 60 }) },
    { permission: 'employees.archive', name: 'deactivate a worker', allowed: 200, call: t => request(app).post(`/api/employees/${w.workers.mel}/deactivate`).set(bearer(t)) },
    { permission: 'employees.manage_access', name: 'reset a worker’s portal password link', allowed: 200, call: t => request(app).post(`/api/employee-accounts/${w.workers.mel}/reset-password-link`).set(bearer(t)) },
    { permission: 'rosters.create', name: 'roster a day that has no roster', allowed: 200, call: t => save(t, { scope: 'ROSTER', roster: [entry('09:00', '17:00')] }) },
    {
        permission: 'rosters.edit', name: 'change a day that already has a roster', allowed: 200,
        prepare: () => ownerSave({ scope: 'ROSTER', roster: [entry('09:00', '17:00')] }),
        call: t => save(t, { scope: 'ROSTER', roster: [entry('10:00', '18:00')] }),
    },
    { permission: 'rosters.create', name: 'Auto-roster a worker', allowed: 200, call: t => request(app).post('/api/roster/auto-roster').set(bearer(t)).send({ start_date: PERIOD, employee_id: w.workers.mel }) },
    { permission: 'timesheets.create', name: 'record worked hours on a day that has none', allowed: 200, call: t => save(t, { scope: 'TIMESHEET', timesheet: [entry('09:00', '17:00')] }) },
    {
        permission: 'timesheets.edit', name: 'change worked hours that already exist', allowed: 200,
        prepare: () => ownerSave({ scope: 'TIMESHEET', timesheet: [entry('09:00', '17:00')] }),
        call: t => save(t, { scope: 'TIMESHEET', timesheet: [entry('09:30', '17:30')] }),
    },
    { permission: 'timesheets.create', name: 'Auto-log a worker', allowed: 200, call: t => request(app).post('/api/roster/auto-log').set(bearer(t)).send({ start_date: PERIOD, employee_id: w.workers.mel }) },
    { permission: 'timesheets.view', name: 'list the timesheets of a branch', allowed: 200, call: t => request(app).get(`/api/submissions?start_date=${PERIOD}&location_id=${w.abc.melbourne}`).set(bearer(t)) },
    { permission: 'timesheets.approve', name: 'approve a timesheet', allowed: 200, call: t => request(app).post('/api/submissions/approve').set(bearer(t)).send({ employee_id: w.workers.mel, start_date: PERIOD }) },
    {
        permission: 'timesheets.reopen', name: 'reopen an approved timesheet', allowed: 200,
        prepare: () => request(app).post('/api/submissions/approve').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.mel, start_date: PERIOD }),
        call: t => request(app).post('/api/submissions/reopen').set(bearer(t)).send({ employee_id: w.workers.mel, start_date: PERIOD }),
    },
    { permission: 'timesheets.lock', name: 'lock a pay period', allowed: 200, call: t => request(app).post('/api/locks').set(bearer(t)).send({ location_id: w.abc.melbourne, start_date: PERIOD, roster_locked: true, password: PASSWORD }) },
    { permission: 'leave.view', name: 'list leave requests', allowed: 200, call: t => request(app).get(`/api/leave-requests?location_id=${w.abc.melbourne}`).set(bearer(t)) },
    {
        permission: 'leave.approve', name: 'decide a leave request', allowed: 200,
        prepare: async () => {
            const made = await request(app).post('/api/portal/leave-requests').set(bearer(w.tokens.melEmployee)).send({ leave_type: 'Annual', start_date: MONDAY, end_date: MONDAY, hours: 7.6 });
            (globalThis as any).__leaveId = made.body.data.id;
        },
        call: t => request(app).post(`/api/leave-requests/${(globalThis as any).__leaveId}/review`).set(bearer(t)).send({ decision: 'reject' }),
    },
    { permission: 'leave.manage', name: 'change the workforce rules', allowed: 200, call: t => request(app).put('/api/organisation/settings').set(bearer(t)).send({ employees_can_submit_timesheets: false }) },
    { permission: 'payroll.view', name: 'read the payroll report', allowed: 200, call: t => request(app).get(`/api/reports/payroll?start_date=${PERIOD}&location_id=${w.abc.melbourne}`).set(bearer(t)) },
    { permission: 'payroll.export', name: 'export payroll as CSV', allowed: 200, call: t => request(app).get(`/api/reports/export/csv?start_date=${PERIOD}&location_id=${w.abc.melbourne}`).set(bearer(t)) },
    { permission: 'payroll.export', name: 'export payroll as a printable document', allowed: 200, call: t => request(app).get(`/api/reports/export/pdf?start_date=${PERIOD}&location_id=${w.abc.melbourne}`).set(bearer(t)) },
    { permission: 'organisation.edit', name: 'change organisation settings', allowed: 200, call: t => request(app).put('/api/organisation/settings').set(bearer(t)).send({ break_mins_weekday: 45 }) },
    { permission: 'organisation.edit', name: 'add a public holiday', allowed: 200, call: t => request(app).post('/api/organisation/holidays').set(bearer(t)).send({ holiday_date: '2026-12-25', name: 'Christmas Day' }) },
    { permission: 'branches.manage', name: 'add a branch', allowed: 201, call: t => request(app).post('/api/locations').set(bearer(t)).send({ name: 'Ballarat' }) },
    { permission: 'users.manage', name: 'list the team', allowed: 200, call: t => request(app).get('/api/team').set(bearer(t)) },
    { permission: 'roles.manage', name: 'create a role', allowed: 201, call: t => request(app).post('/api/roles').set(bearer(t)).send({ name: 'Brand new', permissions: [] }) },
    { permission: 'audit.view', name: 'read the audit log', allowed: 200, call: t => request(app).get('/api/audit').set(bearer(t)) },
    { permission: 'security.manage', name: 'regenerate the sign-in link', allowed: 200, call: t => request(app).post('/api/organisation/regenerate-portal-url').set(bearer(t)).send({}) },
    {
        permission: 'announcements.moderate', name: 'delete someone else’s announcement', allowed: 200,
        prepare: async () => {
            const posted = await request(app).post('/api/announcements').set(bearer(w.tokens.sarah)).send({ content: 'Hello team' });
            (globalThis as any).__postId = posted.body.data.id;
        },
        call: t => request(app).delete(`/api/announcements/${(globalThis as any).__postId}`).set(bearer(t)),
    },
];

describe('each permission is sufficient, and necessary', () => {
    for (const capability of capabilities) {
        it(`${capability.permission}: only its holder can ${capability.name}`, async () => {
            await capability.prepare?.();
            const only = await persona([capability.permission]);
            const everythingElse = await persona(ASSIGNABLE_PERMISSIONS.filter(p => p !== capability.permission));

            const denied = await capability.call(everythingElse);
            expect({ who: 'all other permissions', status: denied.status }).toEqual({ who: 'all other permissions', status: 403 });

            const allowed = await capability.call(only);
            expect({ who: `only ${capability.permission}`, status: allowed.status, body: allowed.status === capability.allowed ? undefined : allowed.body })
                .toEqual({ who: `only ${capability.permission}`, status: capability.allowed, body: undefined });
        });
    }
});

describe('without a permission, nothing is returned', () => {
    it('no timesheets.view: the timesheet list and worked hours are not readable', async () => {
        await ownerSave({ scope: 'TIMESHEET', timesheet: [entry('09:00', '17:00')] });
        const token = await persona(ASSIGNABLE_PERMISSIONS.filter(p => p !== 'timesheets.view' && p !== 'rosters.view'));
        for (const url of [
            `/api/submissions?start_date=${PERIOD}`,
            `/api/records?start_date=${PERIOD}&employee_id=${w.workers.mel}`,
            `/api/records/stats?start_date=${PERIOD}&employee_id=${w.workers.mel}`,
        ]) {
            const res = await request(app).get(url).set(bearer(token));
            expect([url, res.status]).toEqual([url, 403]);
        }
    });

    it('a roster reader sees the roster side of a day but never the worked hours, and a timesheet reader the reverse', async () => {
        await ownerSave({ roster: [entry('09:00', '17:00')], timesheet: [entry('09:15', '17:30')] });
        const rosterOnly = await request(app).get(`/api/records?start_date=${PERIOD}&employee_id=${w.workers.mel}`).set(bearer(await persona(['rosters.view'])));
        const day = rosterOnly.body.data[0];
        expect(day.roster).toHaveLength(1);
        expect(day.timesheet).toEqual([]);

        const timesheetOnly = await request(app).get(`/api/records?start_date=${PERIOD}&employee_id=${w.workers.mel}`).set(bearer(await persona(['timesheets.view'])));
        expect(timesheetOnly.body.data[0].roster).toEqual([]);
        expect(timesheetOnly.body.data[0].timesheet).toHaveLength(1);
    });

    it('employees.view is what shows contact details: a roster reader sees names only', async () => {
        await sql("UPDATE employees SET email = 'mel@abc.test', phone = '0400 000 000' WHERE id = $1", [w.workers.mel]);
        const withRoster = await request(app).get('/api/employees').set(bearer(await persona(['rosters.view'])));
        const mel = withRoster.body.data.find((e: any) => e.id === w.workers.mel);
        expect(mel.full_name).toBe('Mel Worker');
        expect([mel.email, mel.phone]).toEqual([null, null]);

        const withEmployees = await request(app).get('/api/employees').set(bearer(await persona(['employees.view'])));
        const same = withEmployees.body.data.find((e: any) => e.id === w.workers.mel);
        expect([same.email, same.phone]).toEqual(['mel@abc.test', '0400 000 000']);
    });

    it('a day’s sides are authorised separately: roster rights do not let you write worked hours, and BOTH needs both', async () => {
        const rosterOnly = await persona(['rosters.create', 'rosters.edit']);
        expect((await save(rosterOnly, { scope: 'TIMESHEET', timesheet: [entry('09:00', '17:00')] })).status).toBe(403);
        expect((await save(rosterOnly, { roster: [entry('09:00', '17:00')], timesheet: [entry('09:00', '17:00')] })).status).toBe(403);
        expect((await save(rosterOnly, { scope: 'ROSTER', roster: [entry('09:00', '17:00')] })).status).toBe(200);
        expect((await sql('SELECT COUNT(*)::int AS n FROM shift_segments WHERE actual_in IS NOT NULL')).rows[0].n).toBe(0);
    });

    it('create and edit are different: creating a roster does not let you change one that exists, and editing does not let you start one', async () => {
        const creator = await persona(['rosters.create']);
        const editor = await persona(['rosters.edit']);
        expect((await save(editor, { scope: 'ROSTER', roster: [entry('09:00', '17:00')] })).status).toBe(403);
        expect((await save(creator, { scope: 'ROSTER', roster: [entry('09:00', '17:00')] })).status).toBe(200);
        expect((await save(creator, { scope: 'ROSTER', roster: [entry('10:00', '18:00')] })).status).toBe(403);
        expect((await save(creator, { scope: 'ROSTER', roster: [] })).status).toBe(403);
        expect((await save(editor, { scope: 'ROSTER', roster: [entry('10:00', '18:00')] })).status).toBe(200);
    });

    it('viewing is not exporting, and exporting is not viewing', async () => {
        const viewer = await persona(['payroll.view']);
        const exporter = await persona(['payroll.export']);
        expect((await request(app).get(`/api/reports/payroll?start_date=${PERIOD}`).set(bearer(viewer))).status).toBe(200);
        expect((await request(app).get(`/api/reports/export/csv?start_date=${PERIOD}`).set(bearer(viewer))).status).toBe(403);
        expect((await request(app).get(`/api/reports/payroll?start_date=${PERIOD}`).set(bearer(exporter))).status).toBe(403);
        expect((await request(app).get(`/api/reports/export/csv?start_date=${PERIOD}`).set(bearer(exporter))).status).toBe(200);
    });

    it('only leave.manage changes the workforce rules; only organisation.edit changes anything else, even in the same request', async () => {
        const leaveManager = await persona(['leave.manage']);
        const orgEditor = await persona(['organisation.edit']);
        expect((await request(app).put('/api/organisation/settings').set(bearer(leaveManager)).send({ break_mins_weekday: 10 })).status).toBe(403);
        expect((await request(app).put('/api/organisation/settings').set(bearer(leaveManager)).send({ leave_requests_require_approval: false, break_mins_weekday: 10 })).status).toBe(403);
        expect((await request(app).put('/api/organisation/settings').set(bearer(orgEditor)).send({ leave_requests_require_approval: false })).status).toBe(403);
        const stored = (await sql('SELECT break_mins_weekday, leave_requests_require_approval FROM organisations WHERE id = $1', [w.abc.id])).rows[0];
        expect({ ...stored, break_mins_weekday: Number(stored.break_mins_weekday) }).toEqual({ break_mins_weekday: 30, leave_requests_require_approval: true });
    });
});

describe('branch scope is absolute', () => {
    it('a role held for one branch reaches that branch only — by list, filter, id and bulk action', async () => {
        const melbourneOnly = await persona(['employees.view', 'timesheets.view', 'timesheets.approve', 'payroll.view', 'payroll.export', 'rosters.view'], [w.abc.melbourne]);
        const as = (method: 'get' | 'post', url: string, body?: object) => { const r = request(app)[method](url).set(bearer(melbourneOnly)); return body ? r.send(body) : r; };

        // Lists never include another branch, even without a filter.
        expect((await as('get', '/api/employees')).body.data.map((e: any) => e.full_name)).toEqual(['Mel Worker']);
        expect((await as('get', `/api/submissions?start_date=${PERIOD}`)).body.data.map((r: any) => r.full_name)).toEqual(['Mel Worker']);
        expect((await as('get', `/api/reports/payroll?start_date=${PERIOD}`)).body.data.employees.map((e: any) => e.full_name)).toEqual(['Mel Worker']);
        expect((await as('get', `/api/reports/export/csv?start_date=${PERIOD}`)).text).not.toMatch(/Rich Worker|Gee Worker|Syd Worker/);

        // A branch filter for somewhere else is refused, never widened or ignored.
        for (const branch of [w.abc.geelong, w.abc.richmond]) {
            expect((await as('get', `/api/employees?location_id=${branch}`)).status).toBe(403);
            expect((await as('get', `/api/submissions?start_date=${PERIOD}&location_id=${branch}`)).status).toBe(403);
            expect((await as('get', `/api/reports/payroll?start_date=${PERIOD}&location_id=${branch}`)).status).toBe(403);
        }

        // Ids in another branch of the same organisation: 403. In another organisation: 404, nothing revealed.
        expect((await as('post', '/api/submissions/approve', { employee_id: w.workers.gee, start_date: PERIOD })).status).toBe(403);
        expect((await as('get', `/api/records?start_date=${PERIOD}&employee_id=${w.workers.gee}`)).status).toBe(403);
        const foreign = await as('post', '/api/submissions/approve', { employee_id: w.workers.syd, start_date: PERIOD });
        expect(foreign.status).toBe(404);
        expect(JSON.stringify(foreign.body)).not.toMatch(/Syd/);

        // Bulk: each worker is decided on its own.
        const bulk = await as('post', '/api/submissions/bulk-approve', { start_date: PERIOD, employee_ids: [w.workers.mel, w.workers.gee, w.workers.rich, w.workers.syd] });
        expect(bulk.body.data.approved.map((a: any) => a.employee_id)).toEqual([w.workers.mel]);
        expect(bulk.body.data.failed.map((f: any) => f.code)).toEqual(['FORBIDDEN', 'FORBIDDEN', 'NOT_FOUND']);
        expect((await sql("SELECT employee_id FROM timesheet_submissions WHERE status = 'Approved'")).rows.map((r: any) => r.employee_id)).toEqual([w.workers.mel]);
    });

    it('the same role held organisation-wide reaches every branch of the organisation, and no other organisation', async () => {
        const everywhere = await persona(['employees.view', 'timesheets.view', 'timesheets.approve'], 'all');
        const list = await request(app).get('/api/employees').set(bearer(everywhere));
        expect(list.body.data.map((e: any) => e.full_name).sort()).toEqual(['Gee Worker', 'Mel Worker', 'Rich Worker']);
        expect((await request(app).post('/api/submissions/approve').set(bearer(everywhere)).send({ employee_id: w.workers.gee, start_date: PERIOD })).status).toBe(200);
        expect((await request(app).post('/api/submissions/approve').set(bearer(everywhere)).send({ employee_id: w.workers.syd, start_date: PERIOD })).status).toBe(404);
    });

    it('an organisation-wide assignment covers a branch added later; a branch-scoped one does not', async () => {
        const everywhere = await persona(['employees.view'], 'all');
        const melbourneOnly = await persona(['employees.view'], [w.abc.melbourne]);
        const ballarat = (await request(app).post('/api/locations').set(bearer(w.tokens.owner)).send({ name: 'Ballarat' })).body.data.id;
        await request(app).post('/api/employees').set(bearer(w.tokens.owner)).send({ full_name: 'Ben Ballarat', location_id: ballarat });
        expect((await request(app).get(`/api/employees?location_id=${ballarat}`).set(bearer(everywhere))).status).toBe(200);
        expect((await request(app).get(`/api/employees?location_id=${ballarat}`).set(bearer(melbourneOnly))).status).toBe(403);
    });

    it('two roles combine by union, each within its own scope — one cannot borrow the other’s branches', async () => {
        const user = await createUser('sam@abc.test', 'Sam Both');
        const rosterManager = await createRole(w.abc.id, 'Roster Manager', ['rosters.view', 'rosters.create', 'rosters.edit']);
        const payrollManager = await createRole(w.abc.id, 'Payroll Manager', ['timesheets.view', 'timesheets.approve', 'payroll.view']);
        await assignRole(w.abc.id, user.id, rosterManager, [w.abc.geelong]);
        await assignRole(w.abc.id, user.id, payrollManager, [w.abc.melbourne]);
        const token = await signIn(user.id, w.abc.id);

        const me = await request(app).get('/api/auth/me').set(bearer(token));
        expect(me.body.data.roles.map((r: any) => r.name).sort()).toEqual(['Payroll Manager', 'Roster Manager']);
        expect(me.body.data.scopes['rosters.edit']).toEqual({ all: false, branch_ids: [w.abc.geelong] });
        expect(me.body.data.scopes['timesheets.approve']).toEqual({ all: false, branch_ids: [w.abc.melbourne] });
        expect(me.body.data.branches.map((b: any) => b.name).sort()).toEqual(['Geelong', 'Melbourne']);

        // Roster rights work in Geelong only…
        const geelongDay = { employee_id: w.workers.gee, record_date: MONDAY, scope: 'ROSTER', roster: [entry('09:00', '17:00')] };
        const melbourneDay = { employee_id: w.workers.mel, record_date: MONDAY, scope: 'ROSTER', roster: [entry('09:00', '17:00')] };
        expect((await request(app).post('/api/records').set(bearer(token)).send(geelongDay)).status).toBe(200);
        expect((await request(app).post('/api/records').set(bearer(token)).send(melbourneDay)).status).toBe(403);
        // …approval in Melbourne only, even though the person can also VIEW Geelong's roster.
        expect((await request(app).post('/api/submissions/approve').set(bearer(token)).send({ employee_id: w.workers.gee, start_date: PERIOD })).status).toBe(403);
        expect((await request(app).post('/api/submissions/approve').set(bearer(token)).send({ employee_id: w.workers.mel, start_date: PERIOD })).status).toBe(200);
        expect((await request(app).get(`/api/reports/payroll?start_date=${PERIOD}&location_id=${w.abc.geelong}`).set(bearer(token))).status).toBe(403);
        expect((await request(app).get(`/api/reports/payroll?start_date=${PERIOD}&location_id=${w.abc.melbourne}`).set(bearer(token))).status).toBe(200);

        // Each side of a day is shown only where its permission applies.
        await request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ ...geelongDay, scope: 'BOTH', timesheet: [entry('09:05', '17:05')] });
        const geelongRead = await request(app).get(`/api/records?start_date=${PERIOD}&employee_id=${w.workers.gee}`).set(bearer(token));
        expect(geelongRead.body.data[0].roster).toHaveLength(1);
        expect(geelongRead.body.data[0].timesheet).toEqual([]);
    });

    it('an organisation-level permission does nothing on a branch-scoped assignment — a branch role cannot reach across the organisation', async () => {
        const token = await persona(['employees.view', 'users.manage', 'roles.manage', 'audit.view', 'security.manage', 'organisation.edit', 'branches.manage', 'leave.manage'], [w.abc.melbourne]);
        const me = await request(app).get('/api/auth/me').set(bearer(token));
        expect(me.body.data.permissions).toEqual(expect.arrayContaining(['employees.view', 'leave.manage']));
        for (const key of ['users.manage', 'roles.manage', 'audit.view', 'security.manage', 'organisation.edit', 'branches.manage']) {
            expect(me.body.data.permissions).not.toContain(key);
        }
        for (const [method, url] of [['get', '/api/team'], ['get', '/api/roles'], ['get', '/api/audit'], ['post', '/api/locations'], ['post', '/api/organisation/regenerate-portal-url']] as const) {
            expect([url, (await request(app)[method](url).set(bearer(token)).send({ name: 'X' })).status]).toEqual([url, 403]);
        }
        // The very same permissions held organisation-wide do work.
        const wide = await persona(['users.manage', 'audit.view'], 'all');
        expect((await request(app).get('/api/team').set(bearer(wide))).status).toBe(200);
        expect((await request(app).get('/api/audit').set(bearer(wide))).status).toBe(200);
    });

    it('a branch that is deactivated drops out of scope on the next request', async () => {
        const token = await persona(['employees.view'], [w.abc.melbourne, w.abc.geelong]);
        expect((await request(app).get(`/api/employees?location_id=${w.abc.geelong}`).set(bearer(token))).status).toBe(200);
        await request(app).post(`/api/locations/${w.abc.geelong}/deactivate`).set(bearer(w.tokens.owner));
        expect((await request(app).get(`/api/employees?location_id=${w.abc.geelong}`).set(bearer(token))).status).toBe(403);
        expect((await request(app).get('/api/employees').set(bearer(token))).body.data.map((e: any) => e.full_name)).toEqual(['Mel Worker']);
    });
});

describe('the client cannot choose organisation, branch or role', () => {
    it('organisation ids in the query, the body and the headers are ignored', async () => {
        const token = await persona(['employees.view', 'employees.create'], [w.abc.melbourne]);
        const headers = { 'x-organisation-id': w.xyz.id, 'x-org-id': w.xyz.id, 'x-location-id': w.xyz.sydney, 'x-branch-id': w.xyz.sydney };
        const list = await request(app).get(`/api/employees?org_id=${w.xyz.id}&organisation_id=${w.xyz.id}`).set(bearer(token)).set(headers);
        expect(list.status).toBe(200);
        expect(list.body.data.map((e: any) => e.full_name)).toEqual(['Mel Worker']);

        const created = await request(app).post('/api/employees').set(bearer(token)).set(headers)
            .send({ full_name: 'Planted', location_id: w.abc.melbourne, org_id: w.xyz.id, organisation_id: w.xyz.id });
        expect(created.status).toBe(201);
        expect((await sql('SELECT org_id FROM employees WHERE id = $1', [created.body.data.id])).rows[0].org_id).toBe(w.abc.id);

        // A branch id from another organisation is "not found", never a permission answer.
        const foreign = await request(app).post('/api/employees').set(bearer(token)).send({ full_name: 'Planted 2', location_id: w.xyz.sydney });
        expect(foreign.status).toBe(404);
    });

    it('role, permission, scope and organisation claims in a token or body change nothing', async () => {
        const token = await persona(['employees.view'], [w.abc.melbourne]);
        const res = await request(app).post('/api/roles').set(bearer(token)).send({ name: 'Grab', permissions: ['users.manage'], roles: ['OWNER'], permission: 'roles.manage', is_owner: true });
        expect(res.status).toBe(403);
        expect((await request(app).get('/api/team?role=OWNER&is_owner=true').set(bearer(token))).status).toBe(403);
    });

    it('role ids and assignment ids from elsewhere are not found', async () => {
        const xyzRole = await createRole(w.xyz.id, 'Their role', ['employees.view']);
        expect((await request(app).post(`/api/team/${w.users.greg.id}/roles`).set(bearer(w.tokens.owner)).send({ role_id: xyzRole, scope: { all: true } })).status).toBe(404);
        expect((await request(app).post('/api/team/invitations').set(bearer(w.tokens.owner)).send({ email: 'x@abc.test', role_id: xyzRole, scope: { all: true } })).status).toBe(404);
        // Sarah's assignment id used with Greg's user id.
        expect((await request(app).put(`/api/team/${w.users.greg.id}/roles/${w.assignments.sarah}`).set(bearer(w.tokens.owner)).send({ scope: { all: true } })).status).toBe(404);
        expect((await request(app).delete(`/api/team/${w.users.greg.id}/roles/${w.assignments.sarah}`).set(bearer(w.tokens.owner))).status).toBe(404);
        // A branch of another organisation in a scope.
        expect((await request(app).put(`/api/team/${w.users.greg.id}/roles/${w.assignments.greg}`).set(bearer(w.tokens.owner)).send({ scope: { branch_ids: [w.xyz.sydney] } })).status).toBe(404);
        expect((await sql('SELECT scope_all FROM user_roles WHERE id = $1', [w.assignments.greg])).rows[0].scope_all).toBe(false);
    });
});

describe('the employee portal', () => {
    it('is unchanged: an employee keeps their portal, gets nothing from management, and the submission setting still decides timesheets', async () => {
        const schedule = await request(app).get(`/api/portal/schedule?start_date=${PERIOD}&end_date=2026-04-11`).set(bearer(w.tokens.melEmployee));
        expect(schedule.status).toBe(200);
        const me = await request(app).get('/api/auth/me').set(bearer(w.tokens.melEmployee));
        expect(me.body.data.is_manager).toBe(false);
        expect(me.body.data.permissions.sort()).toEqual(['leave.create', 'portal.access', 'timesheets.submit']);
        expect(me.body.data.employee_capabilities).toEqual({ can_submit_timesheets: true });

        const day = { record_date: MONDAY, timesheet: [entry('09:00', '17:00')] };
        expect((await request(app).post('/api/portal/timesheet').set(bearer(w.tokens.melEmployee)).send(day)).status).toBe(200);
        await request(app).put('/api/organisation/settings').set(bearer(w.tokens.owner)).send({ employees_can_submit_timesheets: false });
        expect((await request(app).post('/api/portal/timesheet').set(bearer(w.tokens.melEmployee)).send(day)).status).toBe(403);
    });

    it('a manager’s role never opens the employee portal, and an employee’s role never opens management', async () => {
        expect((await request(app).get(`/api/portal/schedule?start_date=${PERIOD}&end_date=2026-04-11`).set(bearer(w.tokens.sarah))).status).toBe(403);
        expect((await request(app).get('/api/employees').set(bearer(w.tokens.melEmployee))).status).toBe(403);
        expect((await request(app).get('/api/announcements').set(bearer(w.tokens.melEmployee))).status).toBe(403);
    });

    it('a person who is both a manager and an employee has both, each within its own limits', async () => {
        const token = await persona(['rosters.view'], [w.abc.geelong]);
        const me = await request(app).get('/api/auth/me').set(bearer(token));
        expect(me.body.data.is_employee).toBe(false);
        // Link this login to Mel Worker: they now also have the portal, and still only Geelong's roster.
        const userId = (await sql("SELECT id FROM users WHERE email = 'persona1@abc.test'")).rows[0].id;
        await sql('UPDATE employees SET user_id = $1 WHERE id = $2', [userId, w.workers.mel]);
        const both = await request(app).get('/api/auth/me').set(bearer(token));
        expect(both.body.data.is_employee).toBe(true);
        expect(both.body.data.is_manager).toBe(true);
        expect(both.body.data.permissions).toEqual(expect.arrayContaining(['rosters.view', 'portal.access']));
        expect((await request(app).get(`/api/portal/schedule?start_date=${PERIOD}&end_date=2026-04-11`).set(bearer(token))).status).toBe(200);
        expect((await request(app).get(`/api/records?start_date=${PERIOD}&employee_id=${w.workers.mel}`).set(bearer(token))).status).toBe(403);
    });
});

describe('locked and approved timesheets keep their rules under every role', () => {
    it('a fully-permitted person still cannot change an approved timesheet or a locked side', async () => {
        const token = await persona(ASSIGNABLE_PERMISSIONS);
        await ownerSave({ roster: [entry('09:00', '17:00')], timesheet: [entry('09:00', '17:00')] });
        expect((await request(app).post('/api/locks').set(bearer(token)).send({ location_id: w.abc.melbourne, start_date: PERIOD, timesheet_locked: true, password: PASSWORD })).status).toBe(200);
        const locked = await save(token, { scope: 'TIMESHEET', timesheet: [entry('10:00', '18:00')] });
        expect(locked.status).toBe(423);
        expect((await save(token, { scope: 'ROSTER', roster: [entry('10:00', '18:00')] })).status).toBe(200);

        await request(app).post('/api/locks').set(bearer(token)).send({ location_id: w.abc.melbourne, start_date: PERIOD, timesheet_locked: false, password: PASSWORD });
        expect((await request(app).post('/api/submissions/approve').set(bearer(token)).send({ employee_id: w.workers.mel, start_date: PERIOD })).status).toBe(200);
        const approved = await save(token, { scope: 'ROSTER', roster: [entry('11:00', '19:00')] });
        expect(approved.status).toBe(423);
        expect(approved.body.error?.code ?? approved.body.code).toBe('TIMESHEET_ALREADY_APPROVED');
    });

    it('changing a lock still needs the caller’s own password, whatever they hold', async () => {
        const token = await persona(['timesheets.lock']);
        const res = await request(app).post('/api/locks').set(bearer(token)).send({ location_id: w.abc.melbourne, start_date: PERIOD, roster_locked: true, password: 'WrongPassword1' });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('INVALID_PASSWORD');
    });
});

describe('editing without seeing contact details', () => {
    it('saving a worker never blanks or replaces the email and phone of someone who may not view them', async () => {
        await sql("UPDATE employees SET email = 'mel@abc.test', phone = '0400 000 000' WHERE id = $1", [w.workers.mel]);
        const editorOnly = await persona(['employees.edit']);
        const res = await request(app).put(`/api/employees/${w.workers.mel}`).set(bearer(editorOnly)).send({ full_name: 'Mel Renamed', contracted_hours: 50, email: 'attacker@evil.test', phone: '0400 111 111' });
        expect(res.status).toBe(200);
        const row = (await sql('SELECT full_name, email, phone, contracted_hours::float AS hours FROM employees WHERE id = $1', [w.workers.mel])).rows[0];
        expect(row).toEqual({ full_name: 'Mel Renamed', email: 'mel@abc.test', phone: '0400 000 000', hours: 50 });

        // Someone who can view contact details changes them normally.
        const editorAndViewer = await persona(['employees.edit', 'employees.view']);
        await request(app).put(`/api/employees/${w.workers.mel}`).set(bearer(editorAndViewer)).send({ full_name: 'Mel Renamed', email: 'new@abc.test', phone: '0400 222 222' });
        expect((await sql('SELECT email, phone FROM employees WHERE id = $1', [w.workers.mel])).rows[0]).toEqual({ email: 'new@abc.test', phone: '0400 222 222' });
    });
});
