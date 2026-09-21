/**
 * The two-role migrations (…600 expand/backfill, …601 contract) against real PostgreSQL, starting
 * from a database that holds every kind of legacy role data (tests/fixtures/legacy_roles_seed.sql).
 *
 * Runs in its own scratch database so it never disturbs the shared test database.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { Client } from 'pg';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { adminUrl, urlForDatabase } = require('./setup/testDbConfig');

const DB = 'simplehours_jest_migrations';
const backendDir = path.join(__dirname, '..');
const LAST_LEGACY_MIGRATION_COUNT = 7; // 478 … 500

function migrate(...args: string[]) {
    execFileSync(process.execPath, [require.resolve('node-pg-migrate/bin/node-pg-migrate'), ...args, '--no-check-order'], {
        cwd: backendDir, env: { ...process.env, DATABASE_URL: urlForDatabase(DB) }, stdio: 'pipe',
    });
}

const ids = {
    apex: '00000000-0000-0000-0000-0000000000a1',
    branchless: '00000000-0000-0000-0000-0000000000a2',
    orphan: '00000000-0000-0000-0000-0000000000a3',
    melbourne: '00000000-0000-0000-0000-0000000000b1',
    richmond: '00000000-0000-0000-0000-0000000000b2',
    owner: '00000000-0000-0000-0000-000000000001',
    coadmin: '00000000-0000-0000-0000-000000000002',
    manager: '00000000-0000-0000-0000-000000000003',
    employee: '00000000-0000-0000-0000-000000000004',
    platform: '00000000-0000-0000-0000-000000000005',
    blOwner: '00000000-0000-0000-0000-000000000006',
    blManager: '00000000-0000-0000-0000-000000000007',
};

describe('two-role migrations on legacy data', () => {
    let db: Client;
    const q = async (text: string, params?: any[]) => (await db.query(text, params)).rows;

    beforeAll(async () => {
        const admin = new Client({ connectionString: adminUrl() });
        await admin.connect();
        await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
        await admin.query(`CREATE DATABASE ${DB}`);
        await admin.end();

        migrate('up', String(LAST_LEGACY_MIGRATION_COUNT));
        db = new Client({ connectionString: urlForDatabase(DB) });
        await db.connect();
        await db.query(fs.readFileSync(path.join(__dirname, 'fixtures/legacy_roles_seed.sql'), 'utf8'));
        await db.end();

        migrate('up');
        db = new Client({ connectionString: urlForDatabase(DB) });
        await db.connect();
    }, 120000);

    afterAll(async () => {
        await db.end();
        const admin = new Client({ connectionString: adminUrl() });
        await admin.connect();
        await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
        await admin.end();
    });

    it('every organisation has exactly one owner, or is switched off when nobody could own it', async () => {
        expect(await q('SELECT id, owner_user_id, is_active FROM organisations ORDER BY name')).toEqual([
            { id: ids.apex, owner_user_id: ids.owner, is_active: true },
            { id: ids.branchless, owner_user_id: ids.blOwner, is_active: true },
            { id: ids.orphan, owner_user_id: null, is_active: false },
        ]);
    });

    it('Branch Admin access is exactly what people could do before — nothing more', async () => {
        const rows = await q(`SELECT l.name AS branch, u.email FROM branch_admins ba JOIN locations l ON l.id = ba.location_id
                               JOIN users u ON u.id = ba.user_id ORDER BY 1, 2`);
        expect(rows).toEqual([
            { branch: 'Main Branch', email: 'mgr@bl.test' },       // org-level Manager of a branchless org
            { branch: 'Melbourne', email: 'coadmin@apex.test' },   // second Company Admin: all branches
            { branch: 'Melbourne', email: 'mgr@apex.test' },       // branch manager membership
            { branch: 'Richmond', email: 'coadmin@apex.test' },
        ]);
    });

    it('employee logins and the Platform Admin get no access; their accounts are kept', async () => {
        for (const id of [ids.employee, ids.platform]) {
            expect(await q('SELECT 1 FROM branch_admins WHERE user_id = $1', [id])).toEqual([]);
            expect(await q('SELECT 1 FROM organisations WHERE owner_user_id = $1', [id])).toEqual([]);
            expect(await q('SELECT 1 FROM users WHERE id = $1', [id])).toHaveLength(1);
        }
    });

    it('legacy role structures are gone', async () => {
        const tables = (await q("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).map(r => r.tablename);
        for (const t of ['organisation_members', 'location_memberships', 'location_invitations', 'invitation_tokens', 'org_invitation_tokens', 'leave_requests']) {
            expect(tables).not.toContain(t);
        }
        const columns = await q(`SELECT table_name || '.' || column_name AS c FROM information_schema.columns
                                  WHERE table_schema = 'public' AND (table_name, column_name) IN
                                  (('users','role'),('users','org_id'),('employees','user_id'),('sessions','location_id'),
                                   ('login_verification_challenges','role'),('organisations','slug'),('organisations','timesheet_entry_mode'),
                                   ('audit_logs','scope'),('fortnight_locks','is_published'))`);
        expect(columns).toEqual([]);
    });

    it('worker records, rosters and timesheets are preserved', async () => {
        expect(await q('SELECT e.full_name, l.name AS branch FROM employees e JOIN locations l ON l.id = e.location_id ORDER BY 1')).toEqual([
            { full_name: 'Bea Branchless', branch: 'Main Branch' },
            { full_name: 'Emma Employee', branch: 'Richmond' },
            { full_name: 'No Branch Ned', branch: 'Melbourne' },
        ]);
        expect(await q('SELECT segment_type, actual_segment_type, notes, roster_hours::float, actual_hours::float FROM shift_segments ORDER BY segment_type')).toEqual([
            { segment_type: 'Other', actual_segment_type: null, notes: '[Unpaid]', roster_hours: 4, actual_hours: 0 },
            { segment_type: 'WORK', actual_segment_type: 'WORK', notes: 'n1', roster_hours: 7.5, actual_hours: 7.5 },
        ]);
        expect(await q("SELECT status FROM timesheet_submissions ORDER BY status")).toEqual([{ status: 'Approved' }, { status: 'Draft' }]);
    });

    it('organisation-wide locks became one lock per branch with the same flags', async () => {
        expect(await q(`SELECT l.name, f.roster_locked, f.timesheet_locked FROM fortnight_locks f JOIN locations l ON l.id = f.location_id ORDER BY 1`)).toEqual([
            { name: 'Main Branch', roster_locked: true, timesheet_locked: true },
            { name: 'Melbourne', roster_locked: true, timesheet_locked: false },
            { name: 'Richmond', roster_locked: true, timesheet_locked: false },
        ]);
    });

    it('everything dropped is archived, and no secret is copied into the archive', async () => {
        const sources = (await q('SELECT source, COUNT(*)::int AS n FROM legacy_archive GROUP BY source ORDER BY source'));
        expect(sources).toEqual(expect.arrayContaining([
            { source: 'organisation_members', n: 7 },
            { source: 'location_memberships', n: 3 },
            { source: 'leave_requests', n: 1 },
            { source: 'users.role_org', n: 7 },
            { source: 'employees.user_id', n: 1 },
        ]));
        expect(await q("SELECT 1 FROM legacy_archive WHERE row::text LIKE '%PLAINTEXT-SECRET%' OR row ? 'token' OR row ? 'token_hash'")).toEqual([]);
    });

    it('new constraints hold: foreign keys, CHECKs and unique keys', async () => {
        await expect(db.query("UPDATE shift_segments SET segment_type = 'LWOP'")).rejects.toThrow(/shift_segments_segment_type_check/);
        await expect(db.query("UPDATE timesheet_submissions SET status = 'Submitted'")).rejects.toThrow(/timesheet_submissions_status_check/);
        await expect(db.query('UPDATE employees SET location_id = NULL')).rejects.toThrow(/null value/);
        await expect(db.query('INSERT INTO branch_admins (org_id, location_id, user_id) VALUES ($1, $2, $3)', [ids.branchless, ids.melbourne, ids.employee]))
            .rejects.toThrow(/branch_admins_org_id_location_id_fkey/);
        await expect(db.query('INSERT INTO branch_admins (org_id, location_id, user_id) VALUES ($1, $2, $3)', [ids.apex, ids.melbourne, ids.manager]))
            .rejects.toThrow(/duplicate key/);
        await expect(db.query('UPDATE organisations SET owner_user_id = NULL WHERE id = $1', [ids.apex])).rejects.toThrow(/organisations_active_has_owner/);
    });

    it('no orphaned rows', async () => {
        expect(await q('SELECT 1 FROM shift_segments s LEFT JOIN daily_records d ON d.id = s.record_id WHERE d.id IS NULL')).toEqual([]);
        expect(await q('SELECT 1 FROM daily_records d LEFT JOIN employees e ON e.id = d.employee_id AND e.org_id = d.org_id WHERE e.id IS NULL')).toEqual([]);
        expect(await q('SELECT 1 FROM branch_admins b JOIN locations l ON l.id = b.location_id WHERE l.org_id <> b.org_id')).toEqual([]);
    });

    it('rolls back with everyone’s access intact, and re-applies to exactly the same access', async () => {
        const accessBefore = await q('SELECT org_id, location_id, user_id FROM branch_admins ORDER BY 1, 2, 3');
        await db.end();
        migrate('down', '2');
        db = new Client({ connectionString: urlForDatabase(DB) });
        await db.connect();
        // The original legacy rows are back…
        expect((await q("SELECT COUNT(*)::int AS n FROM organisation_members WHERE role IN ('Platform Admin', 'Employee')"))[0].n).toBe(2);
        expect((await q('SELECT COUNT(*)::int AS n FROM users WHERE role IS NOT NULL'))[0].n).toBe(7);
        expect(await q("SELECT role FROM location_memberships WHERE user_id = $1", [ids.employee])).toEqual([{ role: 'employee' }]);
        // …and every current Branch Admin can still work in the previous build.
        for (const a of accessBefore) {
            expect(await q('SELECT 1 FROM location_memberships WHERE location_id = $1 AND user_id = $2', [a.location_id, a.user_id])).toHaveLength(1);
        }
        await db.end();

        migrate('up');
        db = new Client({ connectionString: urlForDatabase(DB) });
        await db.connect();
        expect(await q('SELECT org_id, location_id, user_id FROM branch_admins ORDER BY 1, 2, 3')).toEqual(accessBefore);
    }, 120000);
});
