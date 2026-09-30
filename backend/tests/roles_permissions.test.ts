/**
 * Roles: reading, creating, editing and deleting them, the built-in roles' protections, audit
 * records, and that a change to a role takes effect on the very next request.
 */
import request from 'supertest';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { ADMIN_DEFAULT_PERMISSIONS, ASSIGNABLE_PERMISSIONS, EMPLOYEE_PERMISSIONS } from '../src/services/permissions';
import { connectTestDb, resetTestDb, closeTestDb, sql } from './helpers/testDb';
import { PERIOD, World, assignRole, bearer, buildWorld, createRole, createUser, signIn, systemRoleId } from './helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

const owner = () => bearer(w.tokens.owner);
const audit = async (action: string) => (await sql('SELECT * FROM audit_logs WHERE action = $1 ORDER BY created_at', [action])).rows;

describe('reading roles', () => {
    it('lists the built-in roles first, with who holds them', async () => {
        const res = await request(app).get('/api/roles').set(owner());
        expect(res.status).toBe(200);
        expect(res.body.data.can_manage).toBe(true);
        const roles = res.body.data.roles;
        expect(roles.map((r: any) => r.name)).toEqual(['Owner', 'Admin', 'Employee']);
        expect(roles.map((r: any) => r.member_count)).toEqual([1, 2, 2]);
        expect(roles.every((r: any) => r.is_system)).toBe(true);
    });

    it('shows each built-in role’s real permissions', async () => {
        const res = await request(app).get('/api/roles').set(owner());
        const byKey = Object.fromEntries(res.body.data.roles.map((r: any) => [r.system_key, r]));
        expect([...byKey.OWNER.permissions].sort()).toEqual([...ASSIGNABLE_PERMISSIONS].sort());
        expect([...byKey.ADMIN.permissions].sort()).toEqual([...ADMIN_DEFAULT_PERMISSIONS].sort());
        expect([...byKey.EMPLOYEE.permissions].sort()).toEqual([...EMPLOYEE_PERMISSIONS].sort());
        // The owner may change what Admin can do; Owner and Employee are fixed.
        expect([byKey.OWNER, byKey.ADMIN, byKey.EMPLOYEE].map((r: any) => r.can_edit_permissions)).toEqual([false, true, false]);
        expect([byKey.OWNER, byKey.ADMIN, byKey.EMPLOYEE].map((r: any) => r.can_delete)).toEqual([false, false, false]);
    });

    it('a role’s page lists its members with where the role applies', async () => {
        const res = await request(app).get(`/api/roles/${w.roles.abcAdmin}`).set(owner());
        expect(res.status).toBe(200);
        const sarah = res.body.data.members.find((m: any) => m.user_id === w.users.sarah.id);
        expect(sarah.scope.all).toBe(false);
        expect(sarah.scope.branches.map((b: any) => b.name)).toEqual(['Melbourne', 'Richmond']);
        expect(JSON.stringify(res.body)).not.toMatch(/password|token/i);
    });

    it('the Owner role lists the owner; the Employee role lists workers with a sign-in, with their branch', async () => {
        const roles = (await request(app).get('/api/roles').set(owner())).body.data.roles;
        const ownerRole = (await request(app).get(`/api/roles/${roles[0].id}`).set(owner())).body.data;
        expect(ownerRole.members.map((m: any) => m.email)).toEqual([w.users.owner.email]);
        const employeeRole = (await request(app).get(`/api/roles/${roles[2].id}`).set(owner())).body.data;
        expect(employeeRole.members.map((m: any) => [m.email, m.scope.branches[0].name]).sort()).toEqual([
            [w.users.melEmployee.email, 'Melbourne'], [w.users.richEmployee.email, 'Richmond'],
        ]);
    });

    it('serves the catalogue grouped by category, marking the employee-portal permissions as not assignable', async () => {
        const res = await request(app).get('/api/roles/permissions').set(owner());
        expect(res.status).toBe(200);
        const categories = res.body.data.map((c: any) => c.category);
        expect(categories).toEqual(['Employees', 'Rosters', 'Timesheets', 'Leave', 'Payroll', 'Organisation', 'Security', 'Employee portal']);
        const portal = res.body.data.find((c: any) => c.category === 'Employee portal');
        expect(portal.permissions.every((p: any) => p.assignable === false && p.level === 'self')).toBe(true);
    });

    it('is not available without a users or roles permission', async () => {
        for (const token of [w.tokens.sarah, w.tokens.greg, w.tokens.melEmployee]) {
            expect((await request(app).get('/api/roles').set(bearer(token))).status).toBe(403);
        }
        expect((await request(app).get('/api/roles')).status).toBe(401);
    });
});

describe('creating roles', () => {
    const create = (body: object, token = w.tokens.owner) => request(app).post('/api/roles').set(bearer(token)).send(body);

    it('the owner creates a custom role, which is audited', async () => {
        const res = await create({ name: 'Payroll Manager', description: 'Payroll and timesheet access', permissions: ['timesheets.view', 'timesheets.approve', 'payroll.view', 'payroll.export'] });
        expect(res.status).toBe(201);
        const stored = (await sql('SELECT r.name, r.system_key, r.created_by FROM roles r WHERE r.id = $1', [res.body.data.id])).rows[0];
        expect(stored).toEqual({ name: 'Payroll Manager', system_key: null, created_by: w.users.owner.id });
        const [entry] = await audit('ROLE_CREATED');
        expect(entry.entity_id).toBe(res.body.data.id);
        expect(entry.actor_id).toBe(w.users.owner.id);
        expect(entry.new_value).toContain('payroll.export');
        const detail = await request(app).get(`/api/roles/${res.body.data.id}`).set(owner());
        expect(detail.body.data.can_delete).toBe(true);
        expect(detail.body.data.permissions.sort()).toEqual(['payroll.export', 'payroll.view', 'timesheets.approve', 'timesheets.view']);
    });

    it('names must be present, short, and unique in the organisation whatever the case — including the built-in names', async () => {
        expect((await create({ name: '   ', permissions: [] })).status).toBe(400);
        expect((await create({ name: 'x'.repeat(61), permissions: [] })).status).toBe(400);
        expect((await create({ name: 'Payroll Manager', permissions: [] })).status).toBe(201);
        for (const name of ['payroll manager', 'PAYROLL  MANAGER', 'Admin', 'owner', 'Employee']) {
            const res = await create({ name, permissions: [] });
            expect([name, res.status, res.body.error?.code]).toEqual([name, 409, 'DUPLICATE_ROLE']);
        }
        // The same name in another organisation is fine.
        expect((await create({ name: 'Payroll Manager', permissions: [] }, w.tokens.xavier)).status).toBe(201);
    });

    it('rejects unknown permissions, the employee-portal ones, and malformed lists', async () => {
        expect((await create({ name: 'A', permissions: ['employees.fly'] })).status).toBe(400);
        expect((await create({ name: 'B', permissions: ['portal.access'] })).status).toBe(400);
        expect((await create({ name: 'C', permissions: ['timesheets.submit'] })).status).toBe(400);
        expect((await create({ name: 'D', permissions: 'employees.view' })).status).toBe(400);
        expect((await create({ name: 'E', permissions: [{ key: 'employees.view' }] })).status).toBe(400);
        expect((await create({ name: 'F', description: 'x'.repeat(301), permissions: [] })).status).toBe(400);
        expect((await sql("SELECT COUNT(*)::int AS n FROM roles WHERE system_key IS NULL")).rows[0].n).toBe(0);
    });

    it('duplicate permissions in the list are stored once', async () => {
        const res = await create({ name: 'Dupes', permissions: ['employees.view', 'employees.view'] });
        expect(res.status).toBe(201);
        expect((await sql('SELECT COUNT(*)::int AS n FROM role_permissions WHERE role_id = $1', [res.body.data.id])).rows[0].n).toBe(1);
    });

    it('a role belongs to the organisation of the session, whatever the body says', async () => {
        const res = await create({ name: 'Sneaky', permissions: [], org_id: w.xyz.id, organisation_id: w.xyz.id });
        expect(res.status).toBe(201);
        expect((await sql('SELECT org_id FROM roles WHERE id = $1', [res.body.data.id])).rows[0].org_id).toBe(w.abc.id);
    });
});

describe('editing roles', () => {
    let roleId: string;
    let rita: { id: string };
    let ritaToken: string;
    beforeEach(async () => {
        roleId = await createRole(w.abc.id, 'Timesheet Reviewer', ['timesheets.view'], w.users.owner.id);
        rita = await createUser('rita@abc.test', 'Rita Reviewer');
        await assignRole(w.abc.id, rita.id, roleId, 'all');
        ritaToken = await signIn(rita.id, w.abc.id);
    });
    const edit = (id: string, body: object, token = w.tokens.owner) => request(app).put(`/api/roles/${id}`).set(bearer(token)).send(body);
    const listSubmissions = () => request(app).get(`/api/submissions?start_date=${PERIOD}`).set(bearer(ritaToken));

    it('a permission change reaches every holder on their very next request, and is audited with what was added and removed', async () => {
        expect((await listSubmissions()).status).toBe(200);
        expect((await request(app).post('/api/submissions/approve').set(bearer(ritaToken)).send({ employee_id: w.workers.mel, start_date: PERIOD })).status).toBe(403);

        expect((await edit(roleId, { permissions: ['timesheets.approve'] })).status).toBe(200);
        expect((await listSubmissions()).status).toBe(403);
        expect((await request(app).post('/api/submissions/approve').set(bearer(ritaToken)).send({ employee_id: w.workers.mel, start_date: PERIOD })).status).toBe(200);

        const [entry] = await audit('ROLE_PERMISSIONS_CHANGED');
        expect(entry.previous_value).toBe('timesheets.view');
        expect(entry.new_value).toBe('timesheets.approve');
        expect(entry.details).toContain('Added: Approve timesheets');
        expect(entry.details).toContain('Removed: View timesheets');
    });

    it('renaming and describing a custom role is audited separately from its permissions', async () => {
        expect((await edit(roleId, { name: 'Reviewer', description: 'Reviews timesheets' })).status).toBe(200);
        expect((await audit('ROLE_UPDATED'))).toHaveLength(1);
        expect((await audit('ROLE_PERMISSIONS_CHANGED'))).toHaveLength(0);
        expect((await sql('SELECT name, description FROM roles WHERE id = $1', [roleId])).rows[0]).toEqual({ name: 'Reviewer', description: 'Reviews timesheets' });
        // A name another role has is refused, and nothing changes.
        expect((await edit(roleId, { name: 'ADMIN' })).status).toBe(409);
    });

    it('the Owner and Employee roles can never be edited, by anyone', async () => {
        const ownerRole = await systemRoleId(w.abc.id, 'OWNER');
        const employeeRole = await systemRoleId(w.abc.id, 'EMPLOYEE');
        for (const id of [ownerRole, employeeRole]) {
            expect((await edit(id, { permissions: [] })).status).toBe(403);
            expect((await edit(id, { name: 'Renamed' })).status).toBe(403);
        }
        expect((await sql('SELECT name FROM roles WHERE id = $1', [ownerRole])).rows[0].name).toBe('Owner');
    });

    it('only the owner edits Admin, and only its permissions', async () => {
        expect((await edit(w.roles.abcAdmin, { name: 'Boss' })).status).toBe(403);
        expect((await edit(w.roles.abcAdmin, { description: 'Whatever' })).status).toBe(403);
        const trimmed = ADMIN_DEFAULT_PERMISSIONS.filter(p => p !== 'payroll.export');
        expect((await edit(w.roles.abcAdmin, { permissions: trimmed })).status).toBe(200);
        // Sarah is an Admin: she loses the export on her next request.
        expect((await request(app).get(`/api/reports/export/csv?start_date=${PERIOD}`).set(bearer(w.tokens.sarah))).status).toBe(403);
        expect((await request(app).get(`/api/reports/payroll?start_date=${PERIOD}`).set(bearer(w.tokens.sarah))).status).toBe(200);
    });

    it('a role that has lost every permission no longer opens the organisation to its holders', async () => {
        expect((await edit(roleId, { permissions: [] })).status).toBe(200);
        const res = await request(app).get('/api/auth/me').set(bearer(ritaToken));
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('ACCESS_REVOKED');
    });

    it('roles of another organisation are never found', async () => {
        for (const res of [
            await request(app).get(`/api/roles/${roleId}`).set(bearer(w.tokens.xavier)),
            await edit(roleId, { name: 'Hijacked' }, w.tokens.xavier),
            await request(app).delete(`/api/roles/${roleId}`).set(bearer(w.tokens.xavier)),
        ]) {
            expect(res.status).toBe(404);
        }
        expect((await sql('SELECT name FROM roles WHERE id = $1', [roleId])).rows[0].name).toBe('Timesheet Reviewer');
    });
});

describe('deleting roles', () => {
    it('a custom role is deleted with its assignments, and the audit trail says how many people held it', async () => {
        const roleId = await createRole(w.abc.id, 'Temporary', ['employees.view']);
        await assignRole(w.abc.id, w.users.greg.id, roleId, [w.abc.geelong]);
        await assignRole(w.abc.id, w.users.sarah.id, roleId, 'all');
        const res = await request(app).delete(`/api/roles/${roleId}`).set(owner());
        expect(res.status).toBe(200);
        expect((await sql('SELECT COUNT(*)::int AS n FROM roles WHERE id = $1', [roleId])).rows[0].n).toBe(0);
        expect((await sql('SELECT COUNT(*)::int AS n FROM user_roles WHERE role_id = $1', [roleId])).rows[0].n).toBe(0);
        const [entry] = await audit('ROLE_DELETED');
        expect(entry.previous_value).toBe('Temporary');
        expect(entry.details).toContain('2 people');
        // Their other access is untouched.
        expect((await request(app).get('/api/auth/me').set(bearer(w.tokens.greg))).status).toBe(200);
    });

    it('a person whose only access was the deleted role is signed out on their next request', async () => {
        const roleId = await createRole(w.abc.id, 'Only Role', ['employees.view']);
        const nobody = await createUser('temp@abc.test');
        await assignRole(w.abc.id, nobody.id, roleId, 'all');
        const token = await signIn(nobody.id, w.abc.id);
        expect((await request(app).get('/api/employees').set(bearer(token))).status).toBe(200);
        await request(app).delete(`/api/roles/${roleId}`).set(owner());
        const res = await request(app).get('/api/employees').set(bearer(token));
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('ACCESS_REVOKED');
    });

    it('built-in roles cannot be deleted: not through the API, not directly in the database', async () => {
        for (const key of ['OWNER', 'ADMIN', 'EMPLOYEE'] as const) {
            const id = await systemRoleId(w.abc.id, key);
            expect((await request(app).delete(`/api/roles/${id}`).set(owner())).status).toBe(403);
            await expect(sql('DELETE FROM roles WHERE id = $1', [id])).rejects.toThrow(/built in/);
        }
        expect((await sql('SELECT COUNT(*)::int AS n FROM roles WHERE org_id = $1 AND system_key IS NOT NULL', [w.abc.id])).rows[0].n).toBe(3);
    });
});
