/**
 * First-run bootstrap.
 *
 * A freshly migrated database has no users, so nobody can log in. This script
 * creates the initial Platform Admin (and optionally a demo organisation) from
 * environment variables.
 *
 * It is safe to run on every boot: if any user already exists it does nothing.
 *
 *   PLATFORM_ADMIN_EMAIL     required to seed anything
 *   PLATFORM_ADMIN_PASSWORD  required to seed anything
 *   SEED_DEMO_ORG=true       also create a demo org + Company Admin
 *   DEMO_ORG_NAME            defaults to "Demo Organisation"
 *   DEMO_ADMIN_EMAIL         defaults to demo-admin@<platform admin domain>
 *   DEMO_ADMIN_PASSWORD      defaults to PLATFORM_ADMIN_PASSWORD
 */
import dotenv from 'dotenv';
import path from 'path';
import { initDB, query } from '../services/db';
import { hashPassword } from '../services/auth';

dotenv.config();
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../../../.env') });

function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'organisation';
}

async function main() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('[BOOTSTRAP] DATABASE_URL is not set - skipping.');
        return;
    }

    await initDB(dbUrl);

    const existing = await query('SELECT COUNT(*)::int AS count FROM users');
    if (Number(existing.rows[0]?.count || 0) > 0) {
        console.log('[BOOTSTRAP] Users already exist - nothing to do.');
        return;
    }

    const adminEmail = (process.env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();
    const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD || '';

    if (!adminEmail || !adminPassword) {
        console.warn('[BOOTSTRAP] Database is empty but PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD are not set.');
        console.warn('[BOOTSTRAP] Set them and redeploy to create the first Platform Admin.');
        return;
    }

    if (adminPassword.length < 8 || !/[A-Za-z]/.test(adminPassword) || !/[0-9]/.test(adminPassword)) {
        console.error('[BOOTSTRAP] PLATFORM_ADMIN_PASSWORD must be at least 8 characters and contain a letter and a digit.');
        process.exitCode = 1;
        return;
    }

    const adminHash = await hashPassword(adminPassword);
    const adminRes = await query(
        `INSERT INTO users (email, password_hash, role, is_active)
         VALUES ($1, $2, 'Platform Admin', true)
         RETURNING id`,
        [adminEmail, adminHash]
    );
    console.log(`[BOOTSTRAP] Created Platform Admin: ${adminEmail}`);
    console.log('[BOOTSTRAP] Sign in at /platform-gate (not the normal login page).');

    if (process.env.SEED_DEMO_ORG !== 'true') {
        console.log('[BOOTSTRAP] SEED_DEMO_ORG is not "true" - skipping demo organisation.');
        return;
    }

    const orgName = process.env.DEMO_ORG_NAME || 'Demo Organisation';
    const orgSlug = slugify(orgName);
    const domain = adminEmail.split('@')[1] || 'example.com';
    const demoEmail = (process.env.DEMO_ADMIN_EMAIL || `demo-admin@${domain}`).trim().toLowerCase();
    const demoPassword = process.env.DEMO_ADMIN_PASSWORD || adminPassword;

    const orgRes = await query(
        `INSERT INTO organisations (name, slug, display_name, is_active, is_public_searchable)
         VALUES ($1, $2, $1, true, true)
         RETURNING id`,
        [orgName, orgSlug]
    );
    const orgId = orgRes.rows[0].id;

    const demoHash = await hashPassword(demoPassword);
    const demoUserRes = await query(
        `INSERT INTO users (org_id, email, password_hash, role, is_active)
         VALUES ($1, $2, $3, 'Company Admin', true)
         RETURNING id`,
        [orgId, demoEmail, demoHash]
    );
    const demoUserId = demoUserRes.rows[0].id;

    await query(
        `INSERT INTO organisation_members (organisation_id, user_id, role)
         VALUES ($1, $2, 'Company Admin')`,
        [orgId, demoUserId]
    );

    // Give the platform admin access to the demo org too, so org switching works.
    await query(
        `INSERT INTO organisation_members (organisation_id, user_id, role)
         VALUES ($1, $2, 'Platform Admin')
         ON CONFLICT (organisation_id, user_id) DO NOTHING`,
        [orgId, adminRes.rows[0].id]
    );

    console.log(`[BOOTSTRAP] Created demo organisation "${orgName}" (slug: ${orgSlug})`);
    console.log(`[BOOTSTRAP] Company Admin login: ${demoEmail} at /login/${orgSlug}`);
}

main()
    .then(() => process.exit(process.exitCode || 0))
    .catch((err) => {
        console.error('[BOOTSTRAP] Failed:', err);
        // A failed seed should not block the deploy - the server can still start.
        process.exit(0);
    });
