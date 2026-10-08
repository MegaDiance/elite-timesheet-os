/**
 * Role management added on top of the roles model:
 *   - duplicating a role                       POST   /api/roles/:id/duplicate
 *   - deleting a role people hold              DELETE /api/roles/:id  { members: 'move' | 'remove', move_to_role_id }
 *   - giving one role to several people        POST   /api/team/bulk-assign
 *   - the password step before handing out organisation-wide control (REAUTH_REQUIRED)
 */
import request from 'supertest';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { connectTestDb, resetTestDb, closeTestDb, sql } from './helpers/testDb';
import { PASSWORD, World, assignRole, bearer, buildWorld, createRole, createUser, signIn, systemRoleId } from './helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

const owner = () => bearer(w.tokens.owner);
const reauth = (token: string) => request(app).post('/api/auth/reauthenticate').set(bearer(token)).send({ password: PASSWORD });
const roleRow = async (id: string) => (await sql('SELECT name, description, system_key FROM roles WHERE id = $1', [id])).rows[0];
const permsOf = async (id: string) => (await sql('SELECT permission_key FROM role_permissions WHERE role_id = $1 ORDER BY 1', [id])).rows.map((r: any) => r.permission_key);
const assignmentsOf = async (userId: string) => (await sql(
    `SELECT r.name AS role, ur.scope_all, ARRAY(SELECT l.name FROM user_role_branches urb JOIN locations l ON l.id = urb.location_id WHERE urb.user_role_id = ur.id ORDER BY l.name) AS branches
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.org_id = $1 AND ur.user_id = $2 ORDER BY r.name`,
    [w.abc.id, userId]
)).rows;

/** A person with users.manage + roles.manage for the whole organisation and nothing else. */
async function roleAdmin() {
    const person = await createUser('people@abc.test');
    await assignRole(w.abc.id, person.id, await createRole(w.abc.id, 'People Admin', ['users.manage', 'roles.manage', 'employees.view']), 'all');
    return { id: person.id, token: await signIn(person.id, w.abc.id) };
}

describe('duplicating a role', () => {
    it('copies the permissions and description into a new ordinary role nobody holds', async () => {
        const source = await systemRoleId(w.abc.id, 'ADMIN');
        const res = await request(app).post(`/api/roles/${source}/duplicate`).set(owner());
        expect(res.status).toBe(201);
        expect(res.body.data.name).toBe('Manager copy');
        expect(await roleRow(res.body.data.id)).toEqual({ ...(await roleRow(source)), name: 'Manager copy', system_key: null });
        expect(await permsOf(res.body.data.id)).toEqual(await permsOf(source));
        expect((await sql('SELECT COUNT(*)::int AS n FROM user_roles WHERE role_id = $1', [res.body.data.id])).rows[0].n).toBe(0);
    });

    it('picks the next free name, or uses the one given', async () => {
        const source = (await sql("SELECT id FROM roles WHERE org_id = $1 AND name = 'Payroll'", [w.abc.id])).rows[0].id;
        const names = [];
        for (let i = 0; i < 3; i++) names.push((await request(app).post(`/api/roles/${source}/duplicate`).set(owner())).body.data.name);
        expect(names).toEqual(['Payroll copy', 'Payroll copy 2', 'Payroll copy 3']);
        const named = await request(app).post(`/api/roles/${source}/duplicate`).set(owner()).send({ name: 'Bookkeeper' });
        expect([named.status, named.body.data.name]).toEqual([201, 'Bookkeeper']);
        expect((await request(app).post(`/api/roles/${source}/duplicate`).set(owner()).send({ name: 'bookkeeper' })).status).toBe(409);
    });

    it('a long name is shortened to fit, not refused', async () => {
        const long = await createRole(w.abc.id, 'x'.repeat(60), ['employees.view']);
        const res = await request(app).post(`/api/roles/${long}/duplicate`).set(owner());
        expect(res.status).toBe(201);
        expect(res.body.data.name).toHaveLength(60);
        expect(res.body.data.name.endsWith(' copy')).toBe(true);
    });

    it('the Owner and Employee roles cannot be copied', async () => {
        for (const key of ['OWNER', 'EMPLOYEE'] as const) {
            expect((await request(app).post(`/api/roles/${await systemRoleId(w.abc.id, key)}/duplicate`).set(owner())).status).toBe(403);
        }
    });

    it('nobody copies a role holding access they lack, and another organisation’s role is not found', async () => {
        const admin = await roleAdmin();
        const res = await request(app).post(`/api/roles/${await systemRoleId(w.abc.id, 'ADMIN')}/duplicate`).set(bearer(admin.token));
        expect(res.status).toBe(403);
        expect((await sql("SELECT 1 FROM audit_logs WHERE action = 'ACCESS_ESCALATION_BLOCKED' AND actor_id = $1", [admin.id])).rows).toHaveLength(1);
        expect((await request(app).post(`/api/roles/${w.roles.xyzAdmin}/duplicate`).set(owner())).status).toBe(404);
        expect((await request(app).post(`/api/roles/${w.roles.abcAdmin}/duplicate`).set(bearer(w.tokens.sarah))).status).toBe(403);
    });
});

describe('deleting a role people hold', () => {
    let temp: string;
    beforeEach(async () => {
        temp = await createRole(w.abc.id, 'Temporary', ['employees.view', 'timesheets.view']);
        await assignRole(w.abc.id, w.users.greg.id, temp, [w.abc.geelong]);
        await assignRole(w.abc.id, w.users.sarah.id, temp, 'all');
    });

    it('asks what happens to them first, and changes nothing until told', async () => {
        const res = await request(app).delete(`/api/roles/${temp}`).set(owner());
        expect([res.status, res.body.error.code]).toEqual([409, 'ROLE_IN_USE']);
        expect(res.body.error.message).toMatch(/^2 people have this role/);
        expect(await roleRow(temp)).toBeTruthy();
        expect((await request(app).delete(`/api/roles/${temp}`).set(owner()).send({ members: 'keep' })).status).toBe(409);
    });

    it('a role nobody holds is deleted without asking', async () => {
        const unused = await createRole(w.abc.id, 'Unused', ['employees.view']);
        expect((await request(app).delete(`/api/roles/${unused}`).set(owner())).status).toBe(200);
    });

    it('"move" gives each person the other role exactly where they had this one', async () => {
        const target = (await sql("SELECT id FROM roles WHERE org_id = $1 AND name = 'Payroll'", [w.abc.id])).rows[0].id;
        const res = await request(app).delete(`/api/roles/${temp}`).set(owner()).send({ members: 'move', move_to_role_id: target });
        expect(res.status).toBe(200);
        expect(await roleRow(temp)).toBeUndefined();
        expect((await assignmentsOf(w.users.greg.id)).filter((a: any) => a.role === 'Payroll')).toEqual([{ role: 'Payroll', scope_all: false, branches: ['Geelong'] }]);
        expect((await assignmentsOf(w.users.sarah.id)).filter((a: any) => a.role === 'Payroll')).toEqual([{ role: 'Payroll', scope_all: true, branches: [] }]);
        const [entry] = (await sql("SELECT * FROM audit_logs WHERE action = 'ROLE_DELETED'")).rows;
        expect(entry.details).toContain('moved 2 people to “Payroll”');
    });

    it('someone who already holds the other role keeps one assignment, applying wherever either did', async () => {
        // Greg already holds Manager in Geelong; Temporary moves into it for Melbourne too.
        await sql('DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2', [w.users.greg.id, temp]);
        await assignRole(w.abc.id, w.users.greg.id, temp, [w.abc.melbourne]);
        const res = await request(app).delete(`/api/roles/${temp}`).set(owner()).send({ members: 'move', move_to_role_id: w.roles.abcAdmin });
        expect(res.status).toBe(200);
        expect(await assignmentsOf(w.users.greg.id)).toEqual([{ role: 'Manager', scope_all: false, branches: ['Geelong', 'Melbourne'] }]);
        // Sarah held Temporary organisation-wide, so her Manager role now applies organisation-wide.
        expect(await assignmentsOf(w.users.sarah.id)).toEqual([{ role: 'Manager', scope_all: true, branches: [] }]);
    });

    it('"remove" takes it away; people keep their other roles, and anyone left with nothing is signed out', async () => {
        const loner = await createUser('loner@abc.test');
        await assignRole(w.abc.id, loner.id, temp, 'all');
        const token = await signIn(loner.id, w.abc.id);
        const res = await request(app).delete(`/api/roles/${temp}`).set(owner()).send({ members: 'remove' });
        expect(res.status).toBe(200);
        expect((await assignmentsOf(w.users.greg.id)).map((a: any) => a.role)).toEqual(['Manager']);
        expect((await request(app).get('/api/auth/me').set(bearer(token))).status).toBe(401);
    });

    it('people cannot be moved to Owner, Employee, the same role, or another organisation’s role', async () => {
        for (const target of [await systemRoleId(w.abc.id, 'OWNER'), await systemRoleId(w.abc.id, 'EMPLOYEE'), temp]) {
            const res = await request(app).delete(`/api/roles/${temp}`).set(owner()).send({ members: 'move', move_to_role_id: target });
            expect(res.status).toBe(400);
        }
        expect((await request(app).delete(`/api/roles/${temp}`).set(owner()).send({ members: 'move', move_to_role_id: w.roles.xyzAdmin })).status).toBe(404);
        expect(await roleRow(temp)).toBeTruthy();
    });

    it('nobody moves people into a role with access they lack, nor moves themselves', async () => {
        const admin = await roleAdmin();
        const res = await request(app).delete(`/api/roles/${temp}`).set(bearer(admin.token)).send({ members: 'move', move_to_role_id: w.roles.abcAdmin });
        expect(res.status).toBe(403);
        const mine = await createRole(w.abc.id, 'Mine', ['employees.view']);
        await assignRole(w.abc.id, admin.id, mine, 'all');
        const self = await request(app).delete(`/api/roles/${mine}`).set(bearer(admin.token)).send({ members: 'move', move_to_role_id: temp });
        expect(self.status).toBe(403);
        expect(await roleRow(temp)).toBeTruthy();
        expect(await roleRow(mine)).toBeTruthy();
    });

    it('moving people into a role with organisation-wide control needs the password again', async () => {
        const hr = await createRole(w.abc.id, 'HR', ['users.manage', 'employees.view']);
        const first = await request(app).delete(`/api/roles/${temp}`).set(owner()).send({ members: 'move', move_to_role_id: hr });
        expect([first.status, first.body.error.code]).toEqual([403, 'REAUTH_REQUIRED']);
        await reauth(w.tokens.owner);
        expect((await request(app).delete(`/api/roles/${temp}`).set(owner()).send({ members: 'move', move_to_role_id: hr })).status).toBe(200);
    });
});

describe('giving one role to several people', () => {
    const bulk = (token: string, body: Record<string, unknown>) => request(app).post('/api/team/bulk-assign').set(bearer(token)).send(body);
    let payroll: string;
    beforeEach(async () => {
        payroll = (await sql("SELECT id FROM roles WHERE org_id = $1 AND name = 'Payroll'", [w.abc.id])).rows[0].id;
    });

    it('assigns the role with one scope to everyone chosen, skipping people who already have it', async () => {
        await assignRole(w.abc.id, w.users.greg.id, payroll, [w.abc.geelong]);
        const res = await bulk(w.tokens.owner, { user_ids: [w.users.sarah.id, w.users.greg.id, w.users.melEmployee.id], role_id: payroll, scope: { branch_ids: [w.abc.melbourne] } });
        expect(res.status).toBe(201);
        expect(res.body.data.assigned.sort()).toEqual([w.users.sarah.id, w.users.melEmployee.id].sort());
        expect(res.body.data.skipped).toEqual([w.users.greg.id]);
        expect((await assignmentsOf(w.users.sarah.id)).find((a: any) => a.role === 'Payroll')).toEqual({ role: 'Payroll', scope_all: false, branches: ['Melbourne'] });
        // Greg's existing scope is untouched.
        expect((await assignmentsOf(w.users.greg.id)).find((a: any) => a.role === 'Payroll')).toEqual({ role: 'Payroll', scope_all: false, branches: ['Geelong'] });
        expect((await sql("SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'ROLE_ASSIGNED'")).rows[0].n).toBe(2);
    });

    it('is all or nothing: one person who can’t be changed stops the whole request', async () => {
        const stranger = await createUser('stranger@nowhere.test');
        for (const bad of [w.users.owner.id, stranger.id, w.users.xavier.id, 'not-a-uuid']) {
            const res = await bulk(w.tokens.owner, { user_ids: [w.users.sarah.id, bad], role_id: payroll, scope: { all: true } });
            expect({ bad, ok: res.status < 300 }).toEqual({ bad, ok: false });
        }
        const admin = await roleAdmin();
        expect((await bulk(admin.token, { user_ids: [w.users.sarah.id, admin.id], role_id: await createRole(w.abc.id, 'Viewer', ['employees.view']), scope: { all: true } })).status).toBe(403);
        expect((await sql('SELECT COUNT(*)::int AS n FROM user_roles WHERE user_id = $1 AND role_id = $2', [w.users.sarah.id, payroll])).rows[0].n).toBe(0);
    });

    it('only hands out what the caller holds, where they hold it', async () => {
        const branchAdmin = await createUser('ba@abc.test');
        await assignRole(w.abc.id, branchAdmin.id, await createRole(w.abc.id, 'Melbourne People', ['users.manage', 'employees.view', 'timesheets.view']), 'all');
        const melOnly = await createRole(w.abc.id, 'Mel Viewer', ['employees.view']);
        const token = await signIn(branchAdmin.id, w.abc.id);
        expect((await bulk(token, { user_ids: [w.users.greg.id], role_id: melOnly, scope: { all: true } })).status).toBe(201);
        expect((await bulk(token, { user_ids: [w.users.sarah.id], role_id: payroll, scope: { all: true } })).status).toBe(403);
    });

    it('validates the list and the role, and refuses another organisation’s role or branch', async () => {
        expect((await bulk(w.tokens.owner, { user_ids: [], role_id: payroll, scope: { all: true } })).status).toBe(400);
        expect((await bulk(w.tokens.owner, { user_ids: 'x', role_id: payroll, scope: { all: true } })).status).toBe(400);
        const many = Array.from({ length: 201 }, () => w.users.sarah.id);
        expect((await bulk(w.tokens.owner, { user_ids: many.map((_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`), role_id: payroll, scope: { all: true } })).status).toBe(400);
        expect((await bulk(w.tokens.owner, { user_ids: [w.users.sarah.id], role_id: w.roles.xyzAdmin, scope: { all: true } })).status).toBe(404);
        expect((await bulk(w.tokens.owner, { user_ids: [w.users.sarah.id], role_id: payroll, scope: { branch_ids: [w.xyz.sydney] } })).status).toBe(404);
        expect((await bulk(w.tokens.owner, { user_ids: [w.users.sarah.id], role_id: await systemRoleId(w.abc.id, 'EMPLOYEE'), scope: { all: true } })).status).toBe(400);
        expect((await bulk(w.tokens.melEmployee, { user_ids: [w.users.sarah.id], role_id: payroll, scope: { all: true } })).status).toBe(403);
    });
});

describe('handing out organisation-wide control needs the password again', () => {
    let hr: string;
    beforeEach(async () => { hr = await createRole(w.abc.id, 'HR', ['users.manage', 'employees.view']); });

    it('assigning, inviting and bulk-assigning such a role organisation-wide asks for it, for the owner too', async () => {
        const tries = [
            () => request(app).post(`/api/team/${w.users.greg.id}/roles`).set(owner()).send({ role_id: hr, scope: { all: true } }),
            () => request(app).post('/api/team/invitations').set(owner()).send({ email: 'new@abc.test', full_name: 'New Person', role_id: hr, scope: { all: true } }),
            () => request(app).post('/api/team/bulk-assign').set(owner()).send({ user_ids: [w.users.sarah.id], role_id: hr, scope: { all: true } }),
        ];
        for (const attempt of tries) {
            const res = await attempt();
            expect([res.status, res.body.error.code]).toEqual([403, 'REAUTH_REQUIRED']);
        }
        expect((await sql('SELECT COUNT(*)::int AS n FROM user_roles WHERE role_id = $1', [hr])).rows[0].n).toBe(0);

        expect((await reauth(w.tokens.owner)).status).toBe(200);
        for (const attempt of tries) expect((await attempt()).status).toBe(201);
    });

    it('a wrong password does not count, and the step expires after five minutes', async () => {
        const wrong = await request(app).post('/api/auth/reauthenticate').set(owner()).send({ password: 'Wrong12345' });
        expect(wrong.status).toBe(403);
        expect(wrong.body.data).toBeUndefined();
        const give = () => request(app).post(`/api/team/${w.users.greg.id}/roles`).set(owner()).send({ role_id: hr, scope: { all: true } });
        expect((await give()).status).toBe(403);
        await reauth(w.tokens.owner);
        await sql("UPDATE sessions SET reauthenticated_at = NOW() - INTERVAL '6 minutes'");
        expect((await give()).body.error.code).toBe('REAUTH_REQUIRED');
    });

    it('giving ordinary access, or a role for chosen branches, does not ask', async () => {
        const viewer = await createRole(w.abc.id, 'Viewer', ['employees.view', 'users.manage']);
        // Over chosen branches organisation-level permissions do nothing, so nothing of that kind is handed out.
        expect((await request(app).post(`/api/team/${w.users.greg.id}/roles`).set(owner()).send({ role_id: viewer, scope: { branch_ids: [w.abc.geelong] } })).status).toBe(201);
        const plain = await createRole(w.abc.id, 'Plain', ['employees.view']);
        expect((await request(app).post(`/api/team/${w.users.sarah.id}/roles`).set(owner()).send({ role_id: plain, scope: { all: true } })).status).toBe(201);
    });

    it('adding such a permission to a role people hold asks; to a role nobody holds, it does not', async () => {
        const held = await createRole(w.abc.id, 'Held', ['employees.view']);
        await assignRole(w.abc.id, w.users.sarah.id, held, 'all');
        const edit = (id: string) => request(app).put(`/api/roles/${id}`).set(owner()).send({ permissions: ['employees.view', 'roles.manage'] });
        expect((await edit(held)).body.error?.code).toBe('REAUTH_REQUIRED');
        expect(await permsOf(held)).toEqual(['employees.view']);
        const empty = await createRole(w.abc.id, 'Empty', ['employees.view']);
        expect((await edit(empty)).status).toBe(200);
        await reauth(w.tokens.owner);
        expect((await edit(held)).status).toBe(200);
    });
});
