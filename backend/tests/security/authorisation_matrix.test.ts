/**
 * Authorisation matrix: every protected endpoint × every kind of caller.
 *
 * Columns (see tests/helpers/fixtures.ts):
 *   owner   — Organisation Owner of ABC Health
 *   sarah   — Branch Admin of Melbourne + Richmond (the resource is in Melbourne: in scope)
 *   greg    — Branch Admin of Geelong (same organisation, other branch: out of scope)
 *   xavier  — Organisation Owner of XYZ Care (another organisation)
 *   anon    — no token
 *
 * Unless a row says otherwise, the target resource belongs to ABC Health / Melbourne.
 * Expected results: 2xx allowed · 403 authenticated but out of scope · 404 not in your
 * organisation (existence is not confirmed) · 401 not authenticated.
 */
import request from 'supertest';
import app from '../../src/index';
import { clearAllRateLimits } from '../../src/services/authUtils';
import { connectTestDb, resetTestDb, closeTestDb } from '../helpers/testDb';
import { PASSWORD, PERIOD, World, bearer, buildWorld, simpleDay } from '../helpers/fixtures';

type Actor = 'owner' | 'sarah' | 'greg' | 'xavier' | 'anon';
type Method = 'get' | 'post' | 'put' | 'delete';

interface Row {
    name: string;
    method: Method;
    path: (w: World) => string;
    body?: (w: World) => object;
    expect: Record<Actor, number>;
}

const OWNER_ONLY_OWN_ORG = { owner: 200, sarah: 403, greg: 403, xavier: 200, anon: 401 };
const MEL_BRANCH_SCOPED = { owner: 200, sarah: 200, greg: 403, xavier: 404, anon: 401 };
const MEL_FILTER = { owner: 200, sarah: 200, greg: 403, xavier: 403, anon: 401 };
const EVERYONE = { owner: 200, sarah: 200, greg: 200, xavier: 200, anon: 401 };

const rows: Row[] = [
    // Account
    { name: 'GET /auth/me', method: 'get', path: () => '/api/auth/me', expect: EVERYONE },
    { name: 'GET /auth/organisations', method: 'get', path: () => '/api/auth/organisations', expect: EVERYONE },
    { name: 'GET /auth/security/activity', method: 'get', path: () => '/api/auth/security/activity', expect: EVERYONE },
    { name: 'GET /auth/2fa/status', method: 'get', path: () => '/api/auth/2fa/status', expect: EVERYONE },

    // Organisation (Owner only)
    { name: 'GET /organisation/me', method: 'get', path: () => '/api/organisation/me', expect: EVERYONE },
    { name: 'PUT /organisation/settings', method: 'put', path: () => '/api/organisation/settings', body: () => ({ break_mins_weekday: 30 }), expect: OWNER_ONLY_OWN_ORG },
    { name: 'POST /organisation/regenerate-portal-url', method: 'post', path: () => '/api/organisation/regenerate-portal-url', expect: OWNER_ONLY_OWN_ORG },
    { name: 'PUT /organisation/lock-passwords', method: 'put', path: () => '/api/organisation/lock-passwords', body: () => ({ current_password: PASSWORD, new_roster_lock_password: 'roster1' }), expect: OWNER_ONLY_OWN_ORG },
    {
        name: 'POST /organisation/transfer-ownership (to ABC Branch Admin)', method: 'post', path: () => '/api/organisation/transfer-ownership',
        body: (w) => ({ user_id: w.users.greg.id, current_password: PASSWORD }),
        expect: { owner: 200, sarah: 403, greg: 403, xavier: 404, anon: 401 },
    },
    { name: 'GET /audit', method: 'get', path: () => '/api/audit', expect: OWNER_ONLY_OWN_ORG },
    { name: 'GET /organisation/holidays', method: 'get', path: () => '/api/organisation/holidays', expect: EVERYONE },
    { name: 'POST /organisation/holidays', method: 'post', path: () => '/api/organisation/holidays', body: () => ({ holiday_date: '2026-12-25', name: 'Christmas Day' }), expect: OWNER_ONLY_OWN_ORG },

    // Branches
    { name: 'GET /locations', method: 'get', path: () => '/api/locations', expect: EVERYONE },
    { name: 'GET /locations/:melbourne', method: 'get', path: (w) => `/api/locations/${w.abc.melbourne}`, expect: MEL_BRANCH_SCOPED },
    { name: 'POST /locations', method: 'post', path: () => '/api/locations', body: () => ({ name: 'Ballarat' }), expect: { owner: 201, sarah: 403, greg: 403, xavier: 201, anon: 401 } },
    { name: 'PUT /locations/:melbourne', method: 'put', path: (w) => `/api/locations/${w.abc.melbourne}`, body: () => ({ name: 'Melbourne CBD' }), expect: { owner: 200, sarah: 403, greg: 403, xavier: 404, anon: 401 } },
    { name: 'POST /locations/:melbourne/deactivate', method: 'post', path: (w) => `/api/locations/${w.abc.melbourne}/deactivate`, expect: { owner: 200, sarah: 403, greg: 403, xavier: 404, anon: 401 } },
    { name: 'POST /locations/:melbourne/reactivate', method: 'post', path: (w) => `/api/locations/${w.abc.melbourne}/reactivate`, expect: { owner: 200, sarah: 403, greg: 403, xavier: 404, anon: 401 } },

    // Branch Admin management (Owner only)
    { name: 'GET /branch-admins', method: 'get', path: () => '/api/branch-admins', expect: OWNER_ONLY_OWN_ORG },
    {
        name: 'POST /branch-admins/invitations (ABC Melbourne)', method: 'post', path: () => '/api/branch-admins/invitations',
        body: (w) => ({ email: 'new.admin@abc.test', location_ids: [w.abc.melbourne] }),
        expect: { owner: 201, sarah: 403, greg: 403, xavier: 404, anon: 401 },
    },
    {
        name: 'PUT /branch-admins/:greg/branches', method: 'put', path: (w) => `/api/branch-admins/${w.users.greg.id}/branches`,
        body: (w) => ({ location_ids: [w.abc.geelong, w.abc.melbourne] }),
        expect: { owner: 200, sarah: 403, greg: 403, xavier: 404, anon: 401 },
    },
    { name: 'DELETE /branch-admins/:greg', method: 'delete', path: (w) => `/api/branch-admins/${w.users.greg.id}`, expect: { owner: 200, sarah: 403, greg: 403, xavier: 404, anon: 401 } },

    // Workers
    { name: 'GET /employees', method: 'get', path: () => '/api/employees', expect: EVERYONE },
    { name: 'GET /employees?location_id=melbourne', method: 'get', path: (w) => `/api/employees?location_id=${w.abc.melbourne}`, expect: MEL_FILTER },
    { name: 'POST /employees (in Melbourne)', method: 'post', path: () => '/api/employees', body: (w) => ({ full_name: 'New Worker', location_id: w.abc.melbourne }), expect: { owner: 201, sarah: 201, greg: 403, xavier: 404, anon: 401 } },
    { name: 'PUT /employees/:mel', method: 'put', path: (w) => `/api/employees/${w.workers.mel}`, body: () => ({ full_name: 'Mel Worker', contracted_hours: 60 }), expect: MEL_BRANCH_SCOPED },
    { name: 'POST /employees/:mel/templates', method: 'post', path: (w) => `/api/employees/${w.workers.mel}/templates`, body: () => ({ templates: [{ day_index: 1, roster_in: '09:00', roster_out: '17:00' }] }), expect: MEL_BRANCH_SCOPED },
    { name: 'POST /employees/:mel/templates/apply-break', method: 'post', path: (w) => `/api/employees/${w.workers.mel}/templates/apply-break`, body: () => ({ day_indexes: [1, 2], has_break: true, break_mins: 30 }), expect: MEL_BRANCH_SCOPED },
    { name: 'POST /employees/:mel/deactivate', method: 'post', path: (w) => `/api/employees/${w.workers.mel}/deactivate`, expect: MEL_BRANCH_SCOPED },
    { name: 'POST /employees/:mel/reactivate', method: 'post', path: (w) => `/api/employees/${w.workers.mel}/reactivate`, expect: MEL_BRANCH_SCOPED },
    { name: 'DELETE /employees/:mel', method: 'delete', path: (w) => `/api/employees/${w.workers.mel}`, expect: MEL_BRANCH_SCOPED },

    // Roster and timesheets
    { name: 'GET /records?employee_id=mel', method: 'get', path: (w) => `/api/records?start_date=${PERIOD}&employee_id=${w.workers.mel}`, expect: MEL_BRANCH_SCOPED },
    { name: 'GET /records/stats?employee_id=mel', method: 'get', path: (w) => `/api/records/stats?start_date=${PERIOD}&employee_id=${w.workers.mel}`, expect: MEL_BRANCH_SCOPED },
    { name: 'POST /records (mel)', method: 'post', path: () => '/api/records', body: (w) => ({ employee_id: w.workers.mel, record_date: '2026-03-30', ...simpleDay() }), expect: MEL_BRANCH_SCOPED },
    {
        name: 'POST /records/copy-day (mel)', method: 'post', path: () => '/api/records/copy-day',
        body: (w) => ({ employee_id: w.workers.mel, source_date: '2026-03-30', target_dates: ['2026-03-31'] }),
        // Every caller who may see the worker gets "nothing to copy" (400) on an empty day.
        expect: { owner: 400, sarah: 400, greg: 403, xavier: 404, anon: 401 },
    },
    { name: 'POST /records/apply-break (mel)', method: 'post', path: () => '/api/records/apply-break', body: (w) => ({ employee_id: w.workers.mel, record_dates: ['2026-03-30'], has_break: false }), expect: MEL_BRANCH_SCOPED },
    { name: 'POST /roster/auto-roster (one worker: mel)', method: 'post', path: () => '/api/roster/auto-roster', body: (w) => ({ start_date: PERIOD, employee_id: w.workers.mel }), expect: MEL_BRANCH_SCOPED },
    { name: 'POST /roster/auto-roster (melbourne)', method: 'post', path: () => '/api/roster/auto-roster', body: (w) => ({ start_date: PERIOD, location_id: w.abc.melbourne }), expect: MEL_FILTER },
    { name: 'POST /roster/auto-log (melbourne)', method: 'post', path: () => '/api/roster/auto-log', body: (w) => ({ start_date: PERIOD, location_id: w.abc.melbourne }), expect: MEL_FILTER },
    { name: 'GET /submissions?location_id=melbourne', method: 'get', path: (w) => `/api/submissions?start_date=${PERIOD}&location_id=${w.abc.melbourne}`, expect: MEL_FILTER },
    { name: 'POST /submissions/approve (mel)', method: 'post', path: () => '/api/submissions/approve', body: (w) => ({ employee_id: w.workers.mel, start_date: PERIOD }), expect: MEL_BRANCH_SCOPED },
    { name: 'GET /locks?location_id=melbourne', method: 'get', path: (w) => `/api/locks?location_id=${w.abc.melbourne}`, expect: MEL_FILTER },
    {
        name: 'POST /locks (melbourne)', method: 'post', path: () => '/api/locks',
        body: (w) => ({ location_id: w.abc.melbourne, start_date: PERIOD, roster_locked: true, password: PASSWORD }),
        expect: MEL_BRANCH_SCOPED,
    },

    // Leave requests and employee portal accounts
    { name: 'GET /leave-requests?location_id=melbourne', method: 'get', path: (w) => `/api/leave-requests?location_id=${w.abc.melbourne}`, expect: MEL_FILTER },
    { name: 'POST /employee-accounts/:mel/reset-password-link', method: 'post', path: (w) => `/api/employee-accounts/${w.workers.mel}/reset-password-link`, expect: MEL_BRANCH_SCOPED },

    // Reports and dashboard
    { name: 'GET /reports/payroll?location_id=melbourne', method: 'get', path: (w) => `/api/reports/payroll?start_date=${PERIOD}&location_id=${w.abc.melbourne}`, expect: MEL_FILTER },
    { name: 'GET /reports/export/csv', method: 'get', path: () => `/api/reports/export/csv?start_date=${PERIOD}`, expect: EVERYONE },
    { name: 'GET /dashboard/today', method: 'get', path: () => '/api/dashboard/today', expect: EVERYONE },
    { name: 'GET /dashboard/today?location_id=melbourne', method: 'get', path: (w) => `/api/dashboard/today?location_id=${w.abc.melbourne}`, expect: MEL_FILTER },
    { name: 'GET /dashboard/attention', method: 'get', path: () => '/api/dashboard/attention', expect: EVERYONE },
    { name: 'GET /dashboard/attention?location_id=melbourne', method: 'get', path: (w) => `/api/dashboard/attention?location_id=${w.abc.melbourne}`, expect: MEL_FILTER },

    // Noticeboard
    { name: 'GET /announcements', method: 'get', path: () => '/api/announcements', expect: EVERYONE },
    { name: 'POST /announcements', method: 'post', path: () => '/api/announcements', body: () => ({ content: 'Hello team' }), expect: { owner: 201, sarah: 201, greg: 201, xavier: 201, anon: 401 } },
];

const actors: Actor[] = ['owner', 'sarah', 'greg', 'xavier', 'anon'];

describe('Authorisation matrix', () => {
    let world: World;

    beforeAll(connectTestDb);
    afterAll(closeTestDb);
    beforeEach(async () => {
        await resetTestDb();
        clearAllRateLimits();
        world = await buildWorld();
    });

    for (const row of rows) {
        for (const actor of actors) {
            const expected = row.expect[actor];
            it(`${row.name} as ${actor} → ${expected}`, async () => {
                let req = request(app)[row.method](row.path(world));
                if (actor !== 'anon') req = req.set(bearer(world.tokens[actor]));
                const res = row.body ? await req.send(row.body(world)) : await req;
                if (res.status !== expected) {
                    throw new Error(`expected ${expected}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
                }
            });
        }
    }

    /**
     * EMPLOYEE holds none of the Permission values (ROLE_PERMISSIONS.EMPLOYEE is an empty set,
     * see policy.ts and role_removal.test.ts), so every requirePermission-gated route above must
     * reject an employee token with 403 — the entire existing admin surface, unmodified, is
     * employee-proof by construction. The only legitimate exceptions are the handful of
     * requireAuth-only "any authenticated account" routes that are personal-account or org-context
     * reads an employee also needs (session/2FA self-service, switching between their own
     * organisations, and the organisation profile the portal itself will read from).
     */
    const OPEN_TO_EMPLOYEE = new Set([
        'GET /auth/me', 'GET /auth/organisations', 'GET /auth/security/activity', 'GET /auth/2fa/status',
        'GET /organisation/me',
    ]);

    for (const row of rows) {
        const expected = OPEN_TO_EMPLOYEE.has(row.name) ? 200 : 403;
        it(`${row.name} as melEmployee → ${expected}`, async () => {
            let req = request(app)[row.method](row.path(world)).set(bearer(world.tokens.melEmployee));
            const res = row.body ? await req.send(row.body(world)) : await req;
            if (res.status !== expected) {
                throw new Error(`expected ${expected}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
            }
        });
    }
});
