import { Pool, types } from 'pg';

// Parse PostgreSQL DATE type (OID 1082) as a raw 'YYYY-MM-DD' string to prevent UTC timezone drift
types.setTypeParser(1082, (val: string) => val);

let pool: Pool;

/**
 * Connects to PostgreSQL. The schema is owned by backend/migrations — development, tests and
 * production all run on a migrated database; there is no in-memory or hand-written schema.
 */
export async function initDB(dbUrl: string) {
    if (!/^postgres(ql)?:\/\//.test(dbUrl)) {
        throw new Error(
            'DATABASE_URL must be a PostgreSQL URL. The in-memory database was removed; for local development run '
            + '`docker compose up -d db` and set DATABASE_URL=postgres://elite_user:elite_password@localhost:5432/elite_timesheet'
        );
    }
    // Railway's private network (*.railway.internal) and local Postgres do not
    // speak TLS, so SSL is off for those unless DB_SSL=true forces it on.
    const isInternalHost = /(^|@|\/\/)([^/@]*\.railway\.internal|localhost|127\.0\.0\.1)(:|\/|$)/.test(dbUrl);
    const isSslDisabled = process.env.DB_SSL === 'false'
        || (process.env.DB_SSL !== 'true' && isInternalHost);
    pool = new Pool({
        connectionString: dbUrl,
        ssl: isSslDisabled ? false : { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    });
}

export function getPool() {
    return pool;
}

export function query(text: string, params?: any[]) {
    return pool.query(text, params);
}

export async function withTransaction<T>(fn: (queryFn: (text: string, params?: any[]) => Promise<any>) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const res = await fn((text: string, params?: any[]) => client.query(text, params));
        await client.query('COMMIT');
        return res;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
    } finally {
        client.release();
    }
}
