/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
    pgm.sql(\`
        -- 1. Organizations discovery & policy settings
        ALTER TABLE organisations
            ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE,
            ADD COLUMN IF NOT EXISTS display_name TEXT,
            ADD COLUMN IF NOT EXISTS logo_url TEXT,
            ADD COLUMN IF NOT EXISTS is_public_searchable BOOLEAN DEFAULT true,
            ADD COLUMN IF NOT EXISTS break_mins_weekday NUMERIC DEFAULT 30,
            ADD COLUMN IF NOT EXISTS break_mins_weekend NUMERIC DEFAULT 0,
            ADD COLUMN IF NOT EXISTS break_threshold_hours NUMERIC DEFAULT 6,
            ADD COLUMN IF NOT EXISTS roster_lock_password_hash TEXT,
            ADD COLUMN IF NOT EXISTS timesheet_lock_password_hash TEXT;

        -- 2. Users two-factor authentication flag
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT false;

        -- 3. Fortnight publishing state
        ALTER TABLE fortnight_locks
            ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT false;

        -- 4. Organization invitation delivery telemetry
        ALTER TABLE org_invitation_tokens
            ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'pending',
            ADD COLUMN IF NOT EXISTS last_error TEXT;

        -- 5. Audit logs snapshot data
        ALTER TABLE audit_logs
            ADD COLUMN IF NOT EXISTS snapshot TEXT;

        -- 6. Two-Factor Authentication codes
        CREATE TABLE IF NOT EXISTS two_factor_codes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            code_hash TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            attempts INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        -- 7. Organization Announcements
        CREATE TABLE IF NOT EXISTS organisation_announcements (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            author_id UUID REFERENCES users(id) ON DELETE SET NULL,
            author_name TEXT NOT NULL,
            author_role TEXT,
            title TEXT,
            content TEXT NOT NULL,
            is_system BOOLEAN DEFAULT false,
            announcement_type TEXT DEFAULT 'general',
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        -- Index for fast tenant lookup by slug
        CREATE INDEX IF NOT EXISTS idx_organisations_slug ON organisations(slug);
    \`);
};

exports.down = (pgm) => {
    pgm.sql(\`
        DROP TABLE IF EXISTS organisation_announcements;
        DROP TABLE IF EXISTS two_factor_codes;
        ALTER TABLE audit_logs DROP COLUMN IF EXISTS snapshot;
        ALTER TABLE org_invitation_tokens DROP COLUMN IF EXISTS last_error, DROP COLUMN IF EXISTS delivery_status;
        ALTER TABLE fortnight_locks DROP COLUMN IF EXISTS is_published;
        ALTER TABLE users DROP COLUMN IF EXISTS two_factor_enabled;
        ALTER TABLE organisations 
            DROP COLUMN IF EXISTS timesheet_lock_password_hash,
            DROP COLUMN IF EXISTS roster_lock_password_hash,
            DROP COLUMN IF EXISTS break_threshold_hours,
            DROP COLUMN IF EXISTS break_mins_weekend,
            DROP COLUMN IF EXISTS break_mins_weekday,
            DROP COLUMN IF EXISTS is_public_searchable,
            DROP COLUMN IF EXISTS logo_url,
            DROP COLUMN IF EXISTS display_name,
            DROP COLUMN IF EXISTS slug;
    \`);
};
