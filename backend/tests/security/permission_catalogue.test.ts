/**
 * The permission catalogue in code (services/permissions.ts) and the one in the database (seeded by
 * migration …800) must be the same list, and a new organisation gets exactly the documented
 * built-in roles.
 */
import { connectTestDb, resetTestDb, closeTestDb, sql } from '../helpers/testDb';
import { buildWorld, createOrganisation, createUser, World } from '../helpers/fixtures';
import { ADMIN_DEFAULT_PERMISSIONS, PERMISSION_CATALOGUE, SYSTEM_ROLES } from '../../src/services/permissions';

beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(resetTestDb);

it('the permissions table matches the catalogue in code: keys, categories, levels', async () => {
    const rows = (await sql('SELECT key, category, level FROM permissions ORDER BY key')).rows;
    expect(rows).toEqual([...PERMISSION_CATALOGUE].map(p => ({ key: p.key, category: p.category, level: p.level })).sort((a, b) => a.key.localeCompare(b.key)));
});

describe('a new organisation', () => {
    let w: World;
    beforeEach(async () => { w = await buildWorld(); });

    it('always gets the three built-in roles, and only they are marked built in', async () => {
        const rows = (await sql('SELECT name, system_key FROM roles WHERE org_id = $1 ORDER BY system_key', [w.abc.id])).rows;
        expect(rows).toEqual(SYSTEM_ROLES.map(r => ({ name: r.name, system_key: r.key })).sort((a, b) => a.system_key.localeCompare(b.system_key)));
    });

    it('gets the documented Admin permissions, in the database exactly as in code', async () => {
        const rows = (await sql("SELECT rp.permission_key FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.org_id = $1 AND r.system_key = 'ADMIN' ORDER BY 1", [w.abc.id])).rows;
        expect(rows.map((r: any) => r.permission_key)).toEqual([...ADMIN_DEFAULT_PERMISSIONS].sort());
    });

    it('never stores permissions for the Owner and Employee roles: those are defined in code, so they cannot be edited', async () => {
        const rows = (await sql("SELECT COUNT(*)::int AS n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.org_id = $1 AND r.system_key IN ('OWNER', 'EMPLOYEE')", [w.abc.id])).rows;
        expect(rows[0].n).toBe(0);
    });

    it('organisations do not share roles', async () => {
        const abc = (await sql('SELECT id FROM roles WHERE org_id = $1', [w.abc.id])).rows.map((r: any) => r.id);
        const xyz = (await sql('SELECT id FROM roles WHERE org_id = $1', [w.xyz.id])).rows.map((r: any) => r.id);
        expect(abc.filter((id: string) => xyz.includes(id))).toEqual([]);
        expect(abc).toHaveLength(3);
        const other = await createOrganisation('Third Org', (await createUser('third@owner.test')).id);
        expect((await sql('SELECT COUNT(*)::int AS n FROM roles WHERE org_id = $1', [other.id])).rows[0].n).toBe(3);
    });
});

describe('the database refuses what the model forbids', () => {
    let w: World;
    beforeEach(async () => { w = await buildWorld(); });

    it('a built-in role cannot be deleted', async () => {
        await expect(sql("DELETE FROM roles WHERE org_id = $1 AND system_key = 'OWNER'", [w.abc.id])).rejects.toThrow(/built in/);
        await expect(sql("DELETE FROM roles WHERE org_id = $1 AND system_key = 'ADMIN'", [w.abc.id])).rejects.toThrow(/built in/);
    });

    it('an assignment cannot point at another organisation’s role or branch', async () => {
        await expect(sql('INSERT INTO user_roles (org_id, user_id, role_id, scope_all) VALUES ($1, $2, $3, true)', [w.abc.id, w.users.greg.id, w.roles.xyzAdmin])).rejects.toThrow(/foreign key/);
        const assignment = (await sql('INSERT INTO user_roles (org_id, user_id, role_id, scope_all) VALUES ($1, $2, $3, false) RETURNING id', [w.abc.id, w.users.xavier.id, w.roles.abcAdmin])).rows[0].id;
        await expect(sql('INSERT INTO user_role_branches (user_role_id, org_id, location_id) VALUES ($1, $2, $3)', [assignment, w.abc.id, w.xyz.sydney])).rejects.toThrow(/foreign key/);
    });

    it('a role can only hold permissions from the catalogue, and role names are unique per organisation ignoring case', async () => {
        await expect(sql("INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, 'employees.fly')", [w.roles.abcAdmin])).rejects.toThrow(/foreign key/);
        await sql("INSERT INTO roles (org_id, name) VALUES ($1, 'Payroll Manager')", [w.abc.id]);
        await expect(sql("INSERT INTO roles (org_id, name) VALUES ($1, 'payroll manager')", [w.abc.id])).rejects.toThrow(/duplicate key/);
        await expect(sql("INSERT INTO roles (org_id, name) VALUES ($1, 'admin')", [w.abc.id])).rejects.toThrow(/duplicate key/);
        await sql("INSERT INTO roles (org_id, name) VALUES ($1, 'Payroll Manager')", [w.xyz.id]);
    });
});
