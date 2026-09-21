/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Migration for SimpleHours Organisation Hierarchy & Permissions Revamp
 * - Extends audit_logs with target_user_id, previous_value, new_value
 * - Extends organisation_members with is_active, created_at
 * - Supports canonical and legacy roles cleanly
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
    pgm.sql(`
        -- 1. Extend audit_logs with target_user_id, previous_value, new_value
        ALTER TABLE audit_logs
            ADD COLUMN IF NOT EXISTS target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS previous_value TEXT,
            ADD COLUMN IF NOT EXISTS new_value TEXT;

        -- 2. Extend organisation_members with is_active and created_at
        ALTER TABLE organisation_members
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

        -- 3. Extend location_memberships to ensure is_active and created_at exist
        ALTER TABLE location_memberships
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

        -- 4. Indexes for fast permission and membership evaluation
        CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user ON audit_logs(target_user_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_org ON audit_logs(actor_id, org_id);
        CREATE INDEX IF NOT EXISTS idx_org_members_user_org ON organisation_members(user_id, organisation_id);
        CREATE INDEX IF NOT EXISTS idx_loc_members_user_loc ON location_memberships(user_id, location_id);
    `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
    pgm.sql(`
        DROP INDEX IF EXISTS idx_loc_members_user_loc;
        DROP INDEX IF EXISTS idx_org_members_user_org;
        DROP INDEX IF EXISTS idx_audit_logs_actor_org;
        DROP INDEX IF EXISTS idx_audit_logs_target_user;
        ALTER TABLE audit_logs
            DROP COLUMN IF EXISTS new_value,
            DROP COLUMN IF EXISTS previous_value,
            DROP COLUMN IF EXISTS target_user_id;
        ALTER TABLE organisation_members
            DROP COLUMN IF EXISTS created_at,
            DROP COLUMN IF EXISTS is_active;
    `);
};
