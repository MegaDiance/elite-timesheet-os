/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Removes structures the database audit (docs/DATABASE-AUDIT.md) classified as SAFE TO REMOVE:
 * duplicate columns, columns nothing writes, the unused Xero integration and redundant indexes.
 * Every value that carries information is copied to legacy_archive first; random or secret values
 * (session token hashes, Xero tokens) are not.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
    pgm.sql(`
        -- organisations.display_name duplicated name; logo_url was never written.
        INSERT INTO legacy_archive (source, row)
            SELECT 'organisations.names', jsonb_build_object('id', id, 'name', name, 'display_name', display_name, 'logo_url', logo_url)
              FROM organisations
             WHERE (display_name IS NOT NULL AND display_name <> name) OR logo_url IS NOT NULL;
        UPDATE organisations SET name = display_name WHERE display_name IS NOT NULL AND btrim(display_name) <> '';
        ALTER TABLE organisations DROP COLUMN display_name, DROP COLUMN logo_url;

        -- employees.deleted_at duplicated is_active.
        INSERT INTO legacy_archive (source, row)
            SELECT 'employees.deleted_at', jsonb_build_object('id', id, 'is_active', is_active, 'deleted_at', deleted_at)
              FROM employees WHERE deleted_at IS NOT NULL;
        UPDATE employees SET is_active = false WHERE deleted_at IS NOT NULL;
        ALTER TABLE employees DROP COLUMN deleted_at;

        -- audit_logs.timestamp duplicated created_at.
        UPDATE audit_logs SET created_at = timestamp WHERE timestamp IS NOT NULL AND created_at IS NULL;
        ALTER TABLE audit_logs DROP COLUMN timestamp;

        -- sessions.token_hash was a random value nobody read.
        ALTER TABLE sessions DROP COLUMN token_hash;

        -- Only the removed roster-publishing feature wrote these.
        INSERT INTO legacy_archive (source, row)
            SELECT 'organisation_announcements.type', jsonb_build_object('id', id, 'is_system', is_system, 'announcement_type', announcement_type)
              FROM organisation_announcements
             WHERE is_system = true OR COALESCE(announcement_type, 'general') <> 'general';
        ALTER TABLE organisation_announcements DROP COLUMN is_system, DROP COLUMN announcement_type;

        -- Xero was a deferred feature with no UI and no real connection. Tokens are not archived.
        INSERT INTO legacy_archive (source, row)
            SELECT 'xero_connections', jsonb_build_object('org_id', org_id, 'tenant_name', tenant_name, 'connected_at', connected_at)
              FROM xero_connections;
        DROP TABLE xero_connections;

        -- Indexes that duplicate a unique key, or that no query uses.
        DROP INDEX IF EXISTS idx_organisations_portal_slug;
        DROP INDEX IF EXISTS idx_login_challenges_token_hash;
        DROP INDEX IF EXISTS idx_locations_org;
        DROP INDEX IF EXISTS idx_sessions_active;
        DROP INDEX IF EXISTS idx_audit_logs_target_user;
        DROP INDEX IF EXISTS idx_audit_logs_actor_org;
    `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
    pgm.sql(`
        CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_org ON audit_logs(actor_id, org_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user ON audit_logs(target_user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active, last_active_at);
        CREATE INDEX IF NOT EXISTS idx_locations_org ON locations(org_id);
        CREATE INDEX IF NOT EXISTS idx_login_challenges_token_hash ON login_verification_challenges(token_hash);
        CREATE INDEX IF NOT EXISTS idx_organisations_portal_slug ON organisations(portal_slug);

        CREATE TABLE IF NOT EXISTS xero_connections (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE UNIQUE,
            tenant_id TEXT,
            tenant_name TEXT,
            access_token TEXT,
            refresh_token TEXT,
            expires_at TIMESTAMPTZ,
            connected_at TIMESTAMPTZ DEFAULT NOW()
        );
        DELETE FROM legacy_archive WHERE source = 'xero_connections';

        ALTER TABLE organisation_announcements
            ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS announcement_type TEXT DEFAULT 'general';
        UPDATE organisation_announcements a
           SET is_system = (l.row->>'is_system')::boolean, announcement_type = l.row->>'announcement_type'
          FROM legacy_archive l
         WHERE l.source = 'organisation_announcements.type' AND (l.row->>'id')::uuid = a.id;
        DELETE FROM legacy_archive WHERE source = 'organisation_announcements.type';

        -- Session identifiers were random; existing sessions get fresh random values.
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS token_hash TEXT;
        UPDATE sessions SET token_hash = encode(gen_random_bytes(32), 'hex') WHERE token_hash IS NULL;
        ALTER TABLE sessions ALTER COLUMN token_hash SET NOT NULL;
        ALTER TABLE sessions ADD CONSTRAINT sessions_token_hash_key UNIQUE (token_hash);
        CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);

        ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ;
        UPDATE audit_logs SET timestamp = created_at;

        ALTER TABLE employees ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
        UPDATE employees e
           SET deleted_at = (l.row->>'deleted_at')::timestamptz
          FROM legacy_archive l
         WHERE l.source = 'employees.deleted_at' AND (l.row->>'id')::uuid = e.id;
        DELETE FROM legacy_archive WHERE source = 'employees.deleted_at';

        ALTER TABLE organisations ADD COLUMN IF NOT EXISTS display_name TEXT, ADD COLUMN IF NOT EXISTS logo_url TEXT;
        UPDATE organisations SET display_name = name;
        UPDATE organisations o
           SET name = l.row->>'name', display_name = l.row->>'display_name', logo_url = l.row->>'logo_url'
          FROM legacy_archive l
         WHERE l.source = 'organisations.names' AND (l.row->>'id')::uuid = o.id;
        DELETE FROM legacy_archive WHERE source = 'organisations.names';
    `);
};
