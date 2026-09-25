/**
 * First-run bootstrap.
 *
 * Organisations are normally created through sign-up (/signup), which needs working email.
 * For a fresh deployment, or for local development, this script can create the first
 * organisation and its Organisation Owner directly from environment variables.
 *
 * It is safe to run on every boot: if any user already exists it does nothing.
 *
 *   SEED_OWNER_EMAIL          required to seed anything
 *   SEED_OWNER_PASSWORD       required to seed anything (8+ characters, letters and digits)
 *   SEED_ORGANISATION_NAME    defaults to "Demo Organisation"
 */
import dotenv from 'dotenv';
import path from 'path';
import { initDB, query, withTransaction } from '../services/db';
import { hashPassword } from '../services/auth';
import { isStrongPassword, isValidEmail } from '../services/authUtils';
import { issuePortalLink } from '../services/portalLink';

dotenv.config();
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../../../.env') });

async function main() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('[BOOTSTRAP] DATABASE_URL is not set - skipping.');
        return;
    }

    await initDB(dbUrl);

    const existing = await query('SELECT COUNT(*)::int AS count FROM users');
    if (existing.rows[0].count > 0) {
        console.log('[BOOTSTRAP] Accounts already exist - nothing to do.');
        return;
    }

    const ownerEmail = (process.env.SEED_OWNER_EMAIL || '').trim().toLowerCase();
    const ownerPassword = process.env.SEED_OWNER_PASSWORD || '';
    if (!ownerEmail || !ownerPassword) {
        console.log('[BOOTSTRAP] No SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD set - organisations are created through /signup.');
        return;
    }
    if (!isValidEmail(ownerEmail) || !isStrongPassword(ownerPassword).valid) {
        console.error('[BOOTSTRAP] SEED_OWNER_EMAIL must be an email address and SEED_OWNER_PASSWORD must be 8+ characters with letters and digits.');
        process.exitCode = 1;
        return;
    }

    const orgName = (process.env.SEED_ORGANISATION_NAME || 'Demo Organisation').trim();
    const passwordHash = await hashPassword(ownerPassword);

    const loginPath = await withTransaction(async (tx) => {
        const userRes = await tx(
            'INSERT INTO users (email, password_hash, is_active) VALUES ($1, $2, true) RETURNING id',
            [ownerEmail, passwordHash]
        );
        const orgRes = await tx(
            'INSERT INTO organisations (name, owner_user_id, is_active) VALUES ($1, $2, true) RETURNING id',
            [orgName, userRes.rows[0].id]
        );
        await tx('INSERT INTO locations (org_id, name) VALUES ($1, $2)', [orgRes.rows[0].id, 'Main Branch']);
        return (await issuePortalLink(orgRes.rows[0].id, null, tx)).path;
    });

    console.log(`[BOOTSTRAP] Created organisation "${orgName}" owned by ${ownerEmail}.`);
    console.log(`[BOOTSTRAP] Sign in at ${loginPath}`);
}

main()
    .then(() => process.exit(process.exitCode || 0))
    .catch((err) => {
        console.error('[BOOTSTRAP] Failed:', err);
        // A failed seed should not block the deploy - the server can still start.
        process.exit(0);
    });
