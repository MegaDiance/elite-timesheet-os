/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Brings the migrated Postgres schema in line with the in-memory development
 * schema in src/services/db.ts, and adds the indexes the hot query paths need.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
    pgm.sql(`
        -- Attempt counter for suspicious-login challenges. Without it the
        -- 5-attempt lockout in routes/auth.ts silently never engages.
        ALTER TABLE login_verification_challenges
            ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0;

        -- audit_logs.details is written as a plain string by roughly half of the
        -- 34 audit call sites (e.g. 'Created employee Jane') and as JSON by the
        -- rest. JSONB rejects the plain strings with 22P02, which fails the
        -- whole mutation. The development schema declares this column TEXT, so
        -- align production with it rather than breaking every write path.
        ALTER TABLE audit_logs
            ALTER COLUMN details TYPE TEXT USING details::text;

        -- Columns the development schema carries on audit_logs.
        ALTER TABLE audit_logs
            ADD COLUMN IF NOT EXISTS user_id UUID,
            ADD COLUMN IF NOT EXISTS ip_address TEXT;

        -- Indexes for the queries that run on every page load.
        CREATE INDEX IF NOT EXISTS idx_daily_records_org_date
            ON daily_records(org_id, record_date);
        CREATE INDEX IF NOT EXISTS idx_daily_records_employee_date
            ON daily_records(employee_id, record_date);
        CREATE INDEX IF NOT EXISTS idx_shift_segments_record
            ON shift_segments(record_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created
            ON audit_logs(org_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_employees_org_active
            ON employees(org_id, is_active);
        CREATE INDEX IF NOT EXISTS idx_submissions_org_start
            ON timesheet_submissions(org_id, start_date);
        CREATE INDEX IF NOT EXISTS idx_org_members_user
            ON organisation_members(user_id);
    `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
    pgm.sql(`
        DROP INDEX IF EXISTS idx_org_members_user;
        DROP INDEX IF EXISTS idx_submissions_org_start;
        DROP INDEX IF EXISTS idx_employees_org_active;
        DROP INDEX IF EXISTS idx_audit_logs_org_created;
        DROP INDEX IF EXISTS idx_shift_segments_record;
        DROP INDEX IF EXISTS idx_daily_records_employee_date;
        DROP INDEX IF EXISTS idx_daily_records_org_date;
        ALTER TABLE audit_logs DROP COLUMN IF EXISTS ip_address, DROP COLUMN IF EXISTS user_id;
        ALTER TABLE audit_logs
            ALTER COLUMN details TYPE JSONB
            USING CASE WHEN details IS NULL THEN NULL ELSE to_jsonb(details) END;
        ALTER TABLE login_verification_challenges DROP COLUMN IF EXISTS attempts;
    `);
};
