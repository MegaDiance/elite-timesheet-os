/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Migration to support Multi-Organisation, Multi-Location, Roles,
 * Cryptographic Custom URLs, and Configurable Timesheet Workflow Modes.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
    pgm.sql(`
        -- 1. Locations Table (Children of an organisation)
        CREATE TABLE IF NOT EXISTS locations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            address TEXT,
            timezone TEXT DEFAULT 'Australia/Melbourne',
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(org_id, name)
        );

        -- 2. Location Memberships (User to Location mapping with explicit role)
        CREATE TABLE IF NOT EXISTS location_memberships (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('manager', 'admin', 'employee')),
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(location_id, user_id)
        );

        -- 3. Location Invitations Table (Expiring, single-use invites for location staff/managers)
        CREATE TABLE IF NOT EXISTS location_invitations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
            email TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('manager', 'admin', 'employee')),
            token TEXT UNIQUE NOT NULL,
            token_hash TEXT UNIQUE NOT NULL,
            delivery_status TEXT DEFAULT 'pending',
            last_error TEXT,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            accepted_at TIMESTAMPTZ,
            cancelled_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        -- 4. Extend Organisations table with portal_slug, timesheet_entry_mode, and owner_user_id
        ALTER TABLE organisations
            ADD COLUMN IF NOT EXISTS portal_slug TEXT UNIQUE,
            ADD COLUMN IF NOT EXISTS timesheet_entry_mode TEXT DEFAULT 'employee' CHECK (timesheet_entry_mode IN ('employee', 'manager')),
            ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

        -- 5. Extend Employees table with location_id
        ALTER TABLE employees
            ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;

        -- 6. Extend Sessions table with location_id
        ALTER TABLE sessions
            ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;

        -- 7. Extend Audit Logs with location_id and scope (organisation vs platform)
        ALTER TABLE audit_logs
            ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'organisation' CHECK (scope IN ('organisation', 'platform'));

        -- 8. High-Performance Indexes
        CREATE INDEX IF NOT EXISTS idx_locations_org ON locations(org_id);
        CREATE INDEX IF NOT EXISTS idx_locations_active ON locations(org_id, is_active);
        CREATE INDEX IF NOT EXISTS idx_location_memberships_user ON location_memberships(user_id);
        CREATE INDEX IF NOT EXISTS idx_location_memberships_loc ON location_memberships(location_id);
        CREATE INDEX IF NOT EXISTS idx_location_invitations_token_hash ON location_invitations(token_hash);
        CREATE INDEX IF NOT EXISTS idx_location_invitations_email ON location_invitations(org_id, email);
        CREATE INDEX IF NOT EXISTS idx_employees_location ON employees(location_id);
        CREATE INDEX IF NOT EXISTS idx_organisations_portal_slug ON organisations(portal_slug);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_scope_org ON audit_logs(scope, org_id);
    `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
    pgm.sql(`
        DROP INDEX IF EXISTS idx_audit_logs_scope_org;
        DROP INDEX IF EXISTS idx_organisations_portal_slug;
        DROP INDEX IF EXISTS idx_employees_location;
        DROP INDEX IF EXISTS idx_location_invitations_email;
        DROP INDEX IF EXISTS idx_location_invitations_token_hash;
        DROP INDEX IF EXISTS idx_location_memberships_loc;
        DROP INDEX IF EXISTS idx_location_memberships_user;
        DROP INDEX IF EXISTS idx_locations_active;
        DROP INDEX IF EXISTS idx_locations_org;

        ALTER TABLE audit_logs DROP COLUMN IF EXISTS scope, DROP COLUMN IF EXISTS location_id;
        ALTER TABLE sessions DROP COLUMN IF EXISTS location_id;
        ALTER TABLE employees DROP COLUMN IF EXISTS location_id;
        ALTER TABLE organisations DROP COLUMN IF EXISTS owner_user_id, DROP COLUMN IF EXISTS timesheet_entry_mode, DROP COLUMN IF EXISTS portal_slug;

        DROP TABLE IF EXISTS location_invitations;
        DROP TABLE IF EXISTS location_memberships;
        DROP TABLE IF EXISTS locations;
    `);
};
