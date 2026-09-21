/**
 * Real-PostgreSQL helpers for integration tests. The database is created from the
 * production migrations by tests/setup/globalSetup.js; these helpers only connect,
 * wipe rows between tests, and disconnect.
 */
import { initDB, getPool } from '../../src/services/db';

export async function connectTestDb(): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url || url === 'memory') {
        throw new Error('Integration tests require the real test PostgreSQL database (see tests/setup/env.js).');
    }
    await initDB(url);
}

/** Removes all rows from every application table (the schema and pgmigrations are kept). */
export async function resetTestDb(): Promise<void> {
    const pool = getPool();
    const tables = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations'`
    );
    if (tables.rows.length > 0) {
        const list = tables.rows.map((r: any) => `"${r.tablename}"`).join(', ');
        await pool.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    }
}

export async function closeTestDb(): Promise<void> {
    const pool = getPool();
    if (pool && typeof pool.end === 'function') {
        await pool.end();
    }
}

export function sql(text: string, params?: any[]) {
    return getPool().query(text, params);
}
