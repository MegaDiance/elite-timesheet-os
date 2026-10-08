/**
 * Nobody gives, changes or takes away access they don't hold themselves — and nobody touches their
 * own access or the owner's. Real API, real database.
 */
import request from 'supertest';
import app from '../../src/index';
import { clearAllRateLimits } from '../../src/services/authUtils';
import { ASSIGNABLE_PERMISSIONS } from '../../src/services/permissions';
import { connectTestDb, resetTestDb, closeTestDb, sql } from '../helpers/testDb';
import { PASSWORD, World, assignRole, bearer, buildWorld, createRole, createUser, signIn, systemRoleId } from '../helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

const blocked = async () => (await sql("SELECT actor_id, details FROM audit_logs WHERE action = 'ACCESS_ESCALATION_BLOCKED'")).rows;

/** Someone who manages people but has only limited access of their own: users.manage + employees.view over the whole organisation. */
async function peopleManager(extra: string[] = ['employees.view']) {
    const user = await createUser('pm@abc.test', 'Pat People');
    const role = await createRole(w.abc.id, 'People Manager', ['users.manage', ...extra]);
    const assignment = await assignRole(w.abc.id, user.id, role, 'all');
    return { user, role, assignment, token: await signIn(user.id, w.abc.id) };
}

describe('nobody hands out access they do not have', () => {
    it('cannot give a role that contains a permission they lack — and the refusal names it and is audited', async () => {
        const pm = await peopleManager();
        const res = await request(app).post(`/api/team/${w.users.greg.id}/roles`).set(bearer(pm.token)).send({ role_id: w.roles.abcAdmin, scope: { all: true } });
        expect(res.status).toBe(403);
        expect(res.body.error?.message ?? res.body.message).toMatch(/Approve timesheets/);
        expect((await sql('SELECT COUNT(*)::int AS n FROM user_roles WHERE user_id = $1', [w.users.greg.id])).rows[0].n).toBe(1);
        const [entry] = await blocked();
        expect(entry.actor_id).toBe(pm.user.id);
    });

    it('can give a role whose permissions they all hold', async () => {
        const pm = await peopleManager(['employees.view', 'rosters.view']);
        const viewer = await createRole(w.abc.id, 'Roster Viewer', ['employees.view', 'rosters.view']);
        const res = await request(app).post(`/api/team/${w.users.greg.id}/roles`).set(bearer(pm.token)).send({ role_id: viewer, scope: { branch_ids: [w.abc.geelong] } });
        expect(res.status).toBe(201);
    });

    it('a permission they hold for one branch can only be given for that branch', async () => {
        const pm = await peopleManager([]);
        const melbourneOnly = await createRole(w.abc.id, 'Melbourne Viewer', ['employees.view']);
        await assignRole(w.abc.id, pm.user.id, melbourneOnly, [w.abc.melbourne]);
        const viewer = await createRole(w.abc.id, 'Viewer', ['employees.view']);
        const give = (scope: object) => request(app).post(`/api/team/${w.users.greg.id}/roles`).set(bearer(pm.token)).send({ role_id: viewer, scope });

        expect((await give({ branch_ids: [w.abc.geelong] })).status).toBe(403);
        expect((await give({ all: true })).status).toBe(403);
        expect((await give({ branch_ids: [w.abc.melbourne, w.abc.geelong] })).status).toBe(403);
        expect((await give({ branch_ids: [w.abc.melbourne] })).status).toBe(201);
    });

    it('cannot widen a scope, or touch a role they could not have given', async () => {
        const pm = await peopleManager(['employees.view']);
        const gregAdmin = w.assignments.greg;
        // Admin holds far more than the people manager does: changing or removing it is refused too.
        expect((await request(app).put(`/api/team/${w.users.greg.id}/roles/${gregAdmin}`).set(bearer(pm.token)).send({ scope: { all: true } })).status).toBe(403);
        expect((await request(app).put(`/api/team/${w.users.greg.id}/roles/${gregAdmin}`).set(bearer(pm.token)).send({ scope: { branch_ids: [w.abc.geelong] } })).status).toBe(403);
        expect((await request(app).delete(`/api/team/${w.users.greg.id}/roles/${gregAdmin}`).set(bearer(pm.token))).status).toBe(403);
        expect((await request(app).delete(`/api/team/${w.users.greg.id}`).set(bearer(pm.token))).status).toBe(403);
        expect((await sql('SELECT scope_all FROM user_roles WHERE id = $1', [gregAdmin])).rows[0].scope_all).toBe(false);
        expect((await request(app).get('/api/auth/me').set(bearer(w.tokens.greg))).status).toBe(200);
    });

    it('cannot invite someone into a role they could not give', async () => {
        const pm = await peopleManager();
        const res = await request(app).post('/api/team/invitations').set(bearer(pm.token)).send({ email: 'new@abc.test', role_id: w.roles.abcAdmin, scope: { all: true } });
        expect(res.status).toBe(403);
        expect((await sql('SELECT COUNT(*)::int AS n FROM branch_admin_invitations')).rows[0].n).toBe(0);
    });

    it('cannot reset the password of someone who holds more than they do (that would be a way into that access)', async () => {
        const pm = await peopleManager();
        const denied = await request(app).post(`/api/team/${w.users.sarah.id}/reset-password-link`).set(bearer(pm.token));
        expect(denied.status).toBe(403);
        expect((await sql('SELECT COUNT(*)::int AS n FROM reset_tokens')).rows[0].n).toBe(0);

        const small = await createUser('small@abc.test');
        await assignRole(w.abc.id, small.id, await createRole(w.abc.id, 'Small', ['employees.view']), 'all');
        expect((await request(app).post(`/api/team/${small.id}/reset-password-link`).set(bearer(pm.token))).status).toBe(200);
    });
});

describe('nobody edits their own access', () => {
    it('cannot add, widen or remove their own roles, even with users.manage', async () => {
        const pm = await peopleManager(['employees.view']);
        const viewer = await createRole(w.abc.id, 'Viewer', ['employees.view']);
        expect((await request(app).post(`/api/team/${pm.user.id}/roles`).set(bearer(pm.token)).send({ role_id: viewer, scope: { all: true } })).status).toBe(403);
        expect((await request(app).put(`/api/team/${pm.user.id}/roles/${pm.assignment}`).set(bearer(pm.token)).send({ scope: { branch_ids: [w.abc.melbourne] } })).status).toBe(403);
        expect((await request(app).delete(`/api/team/${pm.user.id}/roles/${pm.assignment}`).set(bearer(pm.token))).status).toBe(403);
        expect((await request(app).delete(`/api/team/${pm.user.id}`).set(bearer(pm.token))).status).toBe(403);
        expect((await request(app).post(`/api/team/${pm.user.id}/reset-password-link`).set(bearer(pm.token))).status).toBe(403);
        expect((await sql('SELECT COUNT(*)::int AS n FROM user_roles WHERE user_id = $1', [pm.user.id])).rows[0].n).toBe(1);
        expect((await blocked()).length).toBeGreaterThanOrEqual(4);
    });

    it('cannot grant themselves anything by creating or editing a role they hold', async () => {
        const user = await createUser('rm@abc.test');
        const role = await createRole(w.abc.id, 'Role Maker', ['roles.manage', 'employees.view']);
        await assignRole(w.abc.id, user.id, role, 'all');
        const token = await signIn(user.id, w.abc.id);

        // Adding a permission they do not hold to a role they hold: refused.
        const grab = await request(app).put(`/api/roles/${role}`).set(bearer(token)).send({ permissions: ['roles.manage', 'employees.view', 'audit.view'] });
        expect(grab.status).toBe(403);
        const create = await request(app).post('/api/roles').set(bearer(token)).send({ name: 'Bigger', permissions: ['payroll.export'] });
        expect(create.status).toBe(403);
        expect((await sql('SELECT permission_key FROM role_permissions WHERE role_id = $1 ORDER BY 1', [role])).rows.map((r: any) => r.permission_key)).toEqual(['employees.view', 'roles.manage']);

        // Within their own access they may make a role.
        expect((await request(app).post('/api/roles').set(bearer(token)).send({ name: 'Smaller', permissions: ['employees.view'] })).status).toBe(201);
    });

    it('cannot edit or delete a role that is more powerful than themselves, or the Admin role', async () => {
        const user = await createUser('rm@abc.test');
        const role = await createRole(w.abc.id, 'Role Maker', ['roles.manage', 'employees.view']);
        await assignRole(w.abc.id, user.id, role, 'all');
        const token = await signIn(user.id, w.abc.id);
        const strong = await createRole(w.abc.id, 'Strong', ['payroll.export', 'employees.view']);
        expect((await request(app).put(`/api/roles/${strong}`).set(bearer(token)).send({ permissions: ['employees.view'] })).status).toBe(403);
        expect((await request(app).put(`/api/roles/${strong}`).set(bearer(token)).send({ name: 'Renamed' })).status).toBe(403);
        expect((await request(app).delete(`/api/roles/${strong}`).set(bearer(token))).status).toBe(403);
        expect((await request(app).put(`/api/roles/${w.roles.abcAdmin}`).set(bearer(token)).send({ permissions: [] })).status).toBe(403);
    });
});

describe('the owner’s access is not a role that can be moved', () => {
    it('nobody — not even the owner — assigns, changes or removes the owner through the team API', async () => {
        const pm = await peopleManager();
        const viewer = await createRole(w.abc.id, 'Viewer', ['employees.view']);
        for (const token of [pm.token, w.tokens.owner]) {
            expect((await request(app).post(`/api/team/${w.users.owner.id}/roles`).set(bearer(token)).send({ role_id: viewer, scope: { all: true } })).status).toBe(403);
            expect((await request(app).delete(`/api/team/${w.users.owner.id}`).set(bearer(token))).status).toBe(403);
            expect((await request(app).post(`/api/team/${w.users.owner.id}/reset-password-link`).set(bearer(token))).status).toBe(403);
        }
        expect((await sql('SELECT owner_user_id FROM organisations WHERE id = $1', [w.abc.id])).rows[0].owner_user_id).toBe(w.users.owner.id);
    });

    it('the owner cannot remove their own ownership or lock themselves out', async () => {
        const team = await request(app).get('/api/team').set(bearer(w.tokens.owner));
        const self = team.body.data.members.find((m: any) => m.is_self);
        expect(self.is_owner).toBe(true);
        expect((await request(app).delete(`/api/team/${w.users.owner.id}`).set(bearer(w.tokens.owner))).status).toBe(403);
        // The owner role can't be edited or deleted, so its permissions can never be trimmed.
        const ownerRole = await systemRoleId(w.abc.id, 'OWNER');
        expect((await request(app).put(`/api/roles/${ownerRole}`).set(bearer(w.tokens.owner)).send({ permissions: [] })).status).toBe(403);
        expect((await request(app).delete(`/api/roles/${ownerRole}`).set(bearer(w.tokens.owner))).status).toBe(403);
        const me = await request(app).get('/api/auth/me').set(bearer(w.tokens.owner));
        expect([...me.body.data.permissions].sort()).toEqual([...ASSIGNABLE_PERMISSIONS].sort());
    });

    it('the Owner and Employee roles cannot be assigned or invited, and an assignment row for them grants nothing', async () => {
        const ownerRole = await systemRoleId(w.abc.id, 'OWNER');
        const employeeRole = await systemRoleId(w.abc.id, 'EMPLOYEE');
        for (const role_id of [ownerRole, employeeRole]) {
            const assign = await request(app).post(`/api/team/${w.users.greg.id}/roles`).set(bearer(w.tokens.owner)).send({ role_id, scope: { all: true } });
            expect([assign.status, assign.body.error?.code]).toEqual([400, 'ROLE_NOT_ASSIGNABLE']);
            const invite = await request(app).post('/api/team/invitations').set(bearer(w.tokens.owner)).send({ email: 'x@abc.test', role_id, scope: { all: true } });
            expect([invite.status, invite.body.error?.code]).toEqual([400, 'ROLE_NOT_ASSIGNABLE']);
        }
        // Even a row written straight into the database (which nothing in the application does) grants nothing.
        const nobody = await createUser('nobody@abc.test');
        await assignRole(w.abc.id, nobody.id, ownerRole, 'all');
        const token = await signIn(nobody.id, w.abc.id);
        expect((await request(app).get('/api/auth/me').set(bearer(token))).status).toBe(401);
    });

    it('ownership moves only by the owner, with their password, to a team member', async () => {
        const manager = await peopleManager(['security.manage']);
        const attempt = await request(app).post('/api/organisation/transfer-ownership').set(bearer(manager.token)).send({ user_id: manager.user.id, current_password: PASSWORD });
        expect(attempt.status).toBe(403);
        expect((await sql('SELECT owner_user_id FROM organisations WHERE id = $1', [w.abc.id])).rows[0].owner_user_id).toBe(w.users.owner.id);
    });
});

describe('roles that only make sense organisation-wide', () => {
    it('cannot be given for chosen branches', async () => {
        const hr = await createRole(w.abc.id, 'HR Manager', ['users.manage', 'audit.view']);
        const res = await request(app).post(`/api/team/${w.users.greg.id}/roles`).set(bearer(w.tokens.owner)).send({ role_id: hr, scope: { branch_ids: [w.abc.geelong] } });
        expect([res.status, res.body.error.code]).toEqual([400, 'SCOPE_NOT_SUPPORTED']);
        await request(app).post('/api/auth/reauthenticate').set(bearer(w.tokens.owner)).send({ password: PASSWORD });
        const organisationWide = await request(app).post(`/api/team/${w.users.greg.id}/roles`).set(bearer(w.tokens.owner)).send({ role_id: hr, scope: { all: true } });
        expect(organisationWide.status).toBe(201);
        expect((await request(app).get('/api/audit').set(bearer(w.tokens.greg))).status).toBe(200);
    });

    it('a mixed role given for chosen branches keeps its branch permissions and drops the organisation ones', async () => {
        const mixed = await createRole(w.abc.id, 'Supervisor', ['employees.view', 'audit.view']);
        await request(app).post(`/api/team/${w.users.greg.id}/roles`).set(bearer(w.tokens.owner)).send({ role_id: mixed, scope: { branch_ids: [w.abc.geelong] } });
        const me = await request(app).get('/api/auth/me').set(bearer(w.tokens.greg));
        expect(me.body.data.permissions).toContain('employees.view');
        expect(me.body.data.permissions).not.toContain('audit.view');
        expect((await request(app).get('/api/audit').set(bearer(w.tokens.greg))).status).toBe(403);
    });
});

describe('every change to access is recorded', () => {
    it('assigning, rescoping and removing a role, and removing all access, each leave an audit record with who, whom, and what', async () => {
        const viewer = await createRole(w.abc.id, 'Viewer', ['employees.view']);
        const owner = bearer(w.tokens.owner);
        const assigned = await request(app).post(`/api/team/${w.users.greg.id}/roles`).set(owner).send({ role_id: viewer, scope: { branch_ids: [w.abc.geelong] } });
        await request(app).put(`/api/team/${w.users.greg.id}/roles/${assigned.body.data.id}`).set(owner).send({ scope: { all: true } });
        await request(app).delete(`/api/team/${w.users.greg.id}/roles/${assigned.body.data.id}`).set(owner);
        await request(app).delete(`/api/team/${w.users.greg.id}`).set(owner);

        const rows = (await sql("SELECT action, actor_id, target_user_id, previous_value, new_value FROM audit_logs WHERE action IN ('ROLE_ASSIGNED', 'ROLE_SCOPE_CHANGED', 'ROLE_REMOVED', 'USER_ACCESS_REMOVED') ORDER BY created_at")).rows;
        expect(rows.map((r: any) => r.action)).toEqual(['ROLE_ASSIGNED', 'ROLE_SCOPE_CHANGED', 'ROLE_REMOVED', 'USER_ACCESS_REMOVED']);
        for (const row of rows) {
            expect(row.actor_id).toBe(w.users.owner.id);
            expect(row.target_user_id).toBe(w.users.greg.id);
        }
        expect(rows[0].new_value).toBe('Viewer: Geelong');
        expect([rows[1].previous_value, rows[1].new_value]).toEqual(['Viewer: Geelong', 'Viewer: entire organisation']);
        expect(rows[2].previous_value).toBe('Viewer: entire organisation');
        // Audit rows live in audit_logs, not in any organisation data table.
        expect((await sql("SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE column_name IN ('audit', 'audit_log', 'audit_trail')")).rows[0].n).toBe(0);
    });

    it('removing someone’s last access signs them out straight away', async () => {
        await request(app).delete(`/api/team/${w.users.greg.id}`).set(bearer(w.tokens.owner));
        expect((await request(app).get('/api/auth/me').set(bearer(w.tokens.greg))).status).toBe(401);
        expect((await sql('SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = $1 AND is_active = true', [w.users.greg.id])).rows[0].n).toBe(0);
    });
});
