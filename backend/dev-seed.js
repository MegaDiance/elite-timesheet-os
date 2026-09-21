/**
 * Local dev server with a seeded in-memory database.
 *
 * Starts the SimpleHours API on PORT (default 4000) backed by pg-mem and seeds a
 * demo tenant that demonstrates the organisation / branch permission model:
 *
 *   owner@demo.test    OWNER, no branch membership  -> NO timesheet access anywhere
 *   sarah@demo.test    ORG_MANAGER + Melbourne BRANCH_MANAGER -> Melbourne only
 *   rich@demo.test     BRANCH_ADMIN of Richmond     -> Richmond only
 *   Password for all:  Password123!
 *
 * Usage:  DATABASE_URL=memory node dev-seed.js
 * (Run `npm run build` first, or use the real Postgres via `npm run dev`.)
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'memory';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_for_local_dev';

const crypto = require('crypto');
const { initDB, query } = require('./dist/services/db');
const { hashPassword } = require('./dist/services/auth');
const app = require('./dist/index').default;

const PORT = Number(process.env.PORT || 4000);

async function seed() {
    const existing = await query(`SELECT id FROM organisations WHERE slug = 'demo-clinics'`);
    if (existing.rows.length > 0) {
        console.log('\n[DEV SEED] Demo tenant already present (restored from .db_snapshot.json) - skipping seed.\n');
        return;
    }

    const pw = await hashPassword('Password123!');
    const orgId = crypto.randomUUID();
    await query(
        `INSERT INTO organisations (id, name, slug, portal_slug, timesheet_entry_mode)
         VALUES ($1, 'Demo Clinics', 'demo-clinics', 'demo123', 'employee')`,
        [orgId]
    );

    const branches = {};
    for (const name of ['Melbourne', 'Richmond', 'Geelong']) {
        const id = crypto.randomUUID();
        branches[name] = id;
        await query(`INSERT INTO locations (id, org_id, name) VALUES ($1, $2, $3)`, [id, orgId, name]);
    }

    async function makeUser(email, legacyRole, orgRole) {
        const id = crypto.randomUUID();
        await query(
            `INSERT INTO users (id, org_id, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)`,
            [id, orgId, email, pw, legacyRole]
        );
        await query(
            `INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ($1, $2, $3, $4)`,
            [crypto.randomUUID(), orgId, id, orgRole]
        );
        return id;
    }

    const ownerId = await makeUser('owner@demo.test', 'Company Admin', 'OWNER');
    await query(`UPDATE organisations SET owner_user_id = $1 WHERE id = $2`, [ownerId, orgId]);

    const sarahId = await makeUser('sarah@demo.test', 'Manager', 'ORG_MANAGER');
    await query(
        `INSERT INTO location_memberships (id, user_id, location_id, role) VALUES ($1, $2, $3, 'BRANCH_MANAGER')`,
        [crypto.randomUUID(), sarahId, branches.Melbourne]
    );

    const richId = await makeUser('rich@demo.test', 'Manager', 'ORG_MANAGER');
    await query(
        `INSERT INTO location_memberships (id, user_id, location_id, role) VALUES ($1, $2, $3, 'BRANCH_ADMIN')`,
        [crypto.randomUUID(), richId, branches.Richmond]
    );

    // One employee per branch, each with a submitted timesheet for the demo fortnight
    const fortnight = '2026-04-12';
    for (const [name, label] of [['Melbourne', 'Mia Melbourne'], ['Richmond', 'Rory Richmond']]) {
        const empUserId = await makeUser(`${name.toLowerCase()}.staff@demo.test`, 'Employee', 'EMPLOYEE');
        const empId = crypto.randomUUID();
        await query(
            `INSERT INTO employees (id, org_id, location_id, full_name, email, user_id, contracted_hours)
             VALUES ($1, $2, $3, $4, $5, $6, 76)`,
            [empId, orgId, branches[name], label, `${name.toLowerCase()}.staff@demo.test`, empUserId]
        );
        await query(
            `INSERT INTO timesheet_submissions (id, org_id, employee_id, start_date, status, submitted_at)
             VALUES ($1, $2, $3, $4, 'Submitted', NOW())`,
            [crypto.randomUUID(), orgId, empId, fortnight]
        );
    }

    console.log('\n[DEV SEED] Demo tenant ready (org slug: demo-clinics, fortnight 2026-04-12)');
    console.log('[DEV SEED]   owner@demo.test  OWNER, no branch membership -> no timesheet access');
    console.log('[DEV SEED]   sarah@demo.test  ORG_MANAGER + Melbourne BRANCH_MANAGER');
    console.log('[DEV SEED]   rich@demo.test   BRANCH_ADMIN of Richmond');
    console.log('[DEV SEED]   password: Password123!\n');
}

(async () => {
    await initDB(process.env.DATABASE_URL);
    await seed();
    app.listen(PORT, '0.0.0.0', () => console.log(`Dev server (seeded, in-memory) listening on port ${PORT}`));
})().catch((err) => {
    console.error('[DEV SEED FAILED]', err);
    process.exit(1);
});
