/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Two-role model (expand + backfill).
 *
 * SimpleHours has exactly two authenticated roles:
 *   OWNER        = organisations.owner_user_id            (one per organisation)
 *   BRANCH_ADMIN = a row in branch_admins                 (explicit, per branch)
 *
 * This migration creates the new structures and backfills them from the legacy role
 * stores without deleting anything. The legacy structures are archived and dropped in
 * the following migration (…601).
 *
 * Backfill never grants more than a person already had:
 *   - owner             : owner_user_id, else the earliest org-level 'Company Admin'
 *   - other org admins  : Branch Admin of every branch of that organisation
 *   - branch manager/admin memberships : Branch Admin of that branch
 *   - org-level 'Manager' in an organisation that had no branches (they had
 *     organisation-wide operational access through the old fallback): Branch Admin of
 *     the organisation's new "Main Branch"
 *   - everything else ('Employee', 'Platform Admin', branch 'employee'): no access
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
    pgm.sql(`
        -- ------------------------------------------------------------------
        -- 1. Accounts carry their own display name (workers are no longer linked to users)
        -- ------------------------------------------------------------------
        ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT;

        UPDATE users u
           SET full_name = e.full_name
          FROM (
                SELECT DISTINCT ON (user_id) user_id, full_name
                  FROM employees
                 WHERE user_id IS NOT NULL
                 ORDER BY user_id, (deleted_at IS NOT NULL), id
               ) e
         WHERE e.user_id = u.id AND u.full_name IS NULL;

        -- ------------------------------------------------------------------
        -- 2. Every organisation has at least one branch
        -- ------------------------------------------------------------------
        CREATE TEMP TABLE _branchless_orgs ON COMMIT DROP AS
            SELECT o.id FROM organisations o
             WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.org_id = o.id);

        INSERT INTO locations (org_id, name)
            SELECT id, 'Main Branch' FROM _branchless_orgs;

        ALTER TABLE locations ADD CONSTRAINT locations_org_id_id_key UNIQUE (org_id, id);

        -- ------------------------------------------------------------------
        -- 3. OWNER: organisations.owner_user_id is the single authority
        -- ------------------------------------------------------------------
        UPDATE organisations o
           SET owner_user_id = m.user_id
          FROM (
                SELECT DISTINCT ON (organisation_id) organisation_id, user_id
                  FROM organisation_members
                 WHERE role IN ('Company Admin', 'Owner', 'OWNER') AND COALESCE(is_active, true)
                 ORDER BY organisation_id, created_at NULLS LAST, id
               ) m
         WHERE o.owner_user_id IS NULL AND m.organisation_id = o.id;

        UPDATE organisations o
           SET owner_user_id = u.id
          FROM (
                SELECT DISTINCT ON (org_id) org_id, id
                  FROM users
                 WHERE role IN ('Company Admin', 'Owner', 'OWNER') AND COALESCE(is_active, true) AND org_id IS NOT NULL
                 ORDER BY org_id, created_at NULLS LAST, id
               ) u
         WHERE o.owner_user_id IS NULL AND u.org_id = o.id;

        -- An organisation nobody owns cannot be administered: it is switched off, not deleted.
        UPDATE organisations SET is_active = false WHERE owner_user_id IS NULL;

        ALTER TABLE organisations DROP CONSTRAINT IF EXISTS organisations_owner_user_id_fkey;
        ALTER TABLE organisations
            ADD CONSTRAINT organisations_owner_user_id_fkey
                FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE NO ACTION,
            ADD CONSTRAINT organisations_active_has_owner
                CHECK (owner_user_id IS NOT NULL OR is_active = false);
        CREATE INDEX IF NOT EXISTS idx_organisations_owner ON organisations(owner_user_id);

        -- The private sign-in link (/login/<portal_slug>) is the only organisation entry point.
        UPDATE organisations SET portal_slug = encode(gen_random_bytes(12), 'hex') WHERE portal_slug IS NULL;
        ALTER TABLE organisations ALTER COLUMN portal_slug SET NOT NULL;

        -- ------------------------------------------------------------------
        -- 4. BRANCH_ADMIN: explicit per-branch assignments
        -- ------------------------------------------------------------------
        CREATE TABLE branch_admins (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            location_id UUID NOT NULL,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (location_id, user_id),
            FOREIGN KEY (org_id, location_id) REFERENCES locations(org_id, id) ON DELETE CASCADE
        );
        CREATE INDEX idx_branch_admins_user_org ON branch_admins(user_id, org_id);

        INSERT INTO branch_admins (org_id, location_id, user_id)
            SELECT l.org_id, lm.location_id, lm.user_id
              FROM location_memberships lm
              JOIN locations l ON l.id = lm.location_id
              JOIN organisations o ON o.id = l.org_id
             WHERE lm.role IN ('manager', 'admin')
               AND COALESCE(lm.is_active, true)
               AND o.owner_user_id IS DISTINCT FROM lm.user_id
        ON CONFLICT DO NOTHING;

        INSERT INTO branch_admins (org_id, location_id, user_id)
            SELECT l.org_id, l.id, om.user_id
              FROM organisation_members om
              JOIN organisations o ON o.id = om.organisation_id
              JOIN locations l ON l.org_id = o.id
             WHERE om.role IN ('Company Admin', 'Owner', 'OWNER')
               AND COALESCE(om.is_active, true)
               AND o.owner_user_id IS DISTINCT FROM om.user_id
        ON CONFLICT DO NOTHING;

        INSERT INTO branch_admins (org_id, location_id, user_id)
            SELECT l.org_id, l.id, om.user_id
              FROM organisation_members om
              JOIN _branchless_orgs b ON b.id = om.organisation_id
              JOIN organisations o ON o.id = om.organisation_id
              JOIN locations l ON l.org_id = o.id
             WHERE om.role = 'Manager'
               AND COALESCE(om.is_active, true)
               AND o.owner_user_id IS DISTINCT FROM om.user_id
        ON CONFLICT DO NOTHING;

        -- ------------------------------------------------------------------
        -- 5. Branch Admin invitations (hash-only, expiring, single use)
        -- ------------------------------------------------------------------
        CREATE TABLE branch_admin_invitations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            email TEXT NOT NULL,
            full_name TEXT,
            token_hash TEXT NOT NULL UNIQUE,
            invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            accepted_at TIMESTAMPTZ,
            accepted_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            revoked_at TIMESTAMPTZ,
            delivery_status TEXT NOT NULL DEFAULT 'pending',
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX idx_branch_admin_invitations_org ON branch_admin_invitations(org_id, created_at DESC);

        CREATE TABLE branch_admin_invitation_branches (
            invitation_id UUID NOT NULL REFERENCES branch_admin_invitations(id) ON DELETE CASCADE,
            org_id UUID NOT NULL,
            location_id UUID NOT NULL,
            PRIMARY KEY (invitation_id, location_id),
            FOREIGN KEY (org_id, location_id) REFERENCES locations(org_id, id) ON DELETE CASCADE
        );

        -- ------------------------------------------------------------------
        -- 6. Organisation sign-up (replaces platform-issued organisation invites)
        -- ------------------------------------------------------------------
        CREATE TABLE organisation_signups (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            used_at TIMESTAMPTZ,
            delivery_status TEXT NOT NULL DEFAULT 'pending',
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX idx_organisation_signups_email ON organisation_signups(email, created_at DESC);

        -- ------------------------------------------------------------------
        -- 7. Every worker record belongs to exactly one branch of its own organisation
        -- ------------------------------------------------------------------
        UPDATE employees e
           SET location_id = (
                SELECT l.id FROM locations l
                 WHERE l.org_id = e.org_id
                 ORDER BY l.is_active DESC, l.created_at, l.id
                 LIMIT 1
               )
         WHERE e.location_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM locations l WHERE l.id = e.location_id AND l.org_id = e.org_id);

        ALTER TABLE employees ALTER COLUMN location_id SET NOT NULL;
        ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_location_id_fkey;
        ALTER TABLE employees
            ADD CONSTRAINT employees_org_location_fkey
                FOREIGN KEY (org_id, location_id) REFERENCES locations(org_id, id) ON DELETE NO ACTION;

        -- ------------------------------------------------------------------
        -- 8. Period locks are per branch
        -- ------------------------------------------------------------------
        ALTER TABLE fortnight_locks DROP CONSTRAINT IF EXISTS fortnight_locks_org_id_start_date_key;
        ALTER TABLE fortnight_locks ADD COLUMN location_id UUID;

        INSERT INTO fortnight_locks (org_id, location_id, start_date, roster_locked, timesheet_locked, is_published)
            SELECT fl.org_id, l.id, fl.start_date, fl.roster_locked, fl.timesheet_locked, fl.is_published
              FROM fortnight_locks fl
              JOIN locations l ON l.org_id = fl.org_id
             WHERE fl.location_id IS NULL;

        DELETE FROM fortnight_locks WHERE location_id IS NULL;

        ALTER TABLE fortnight_locks ALTER COLUMN location_id SET NOT NULL;
        ALTER TABLE fortnight_locks
            ADD CONSTRAINT fortnight_locks_org_location_fkey
                FOREIGN KEY (org_id, location_id) REFERENCES locations(org_id, id) ON DELETE CASCADE,
            ADD CONSTRAINT fortnight_locks_org_location_start_key
                UNIQUE (org_id, location_id, start_date);
    `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
    pgm.sql(`
        -- Carry today's access back into the legacy stores the previous build reads (…601's down has
        -- re-created them), so a rollback keeps everyone's access, including people added since.
        INSERT INTO location_memberships (location_id, user_id, role)
            SELECT location_id, user_id, 'manager' FROM branch_admins
        ON CONFLICT (location_id, user_id) DO NOTHING;
        INSERT INTO organisation_members (organisation_id, user_id, role)
            SELECT DISTINCT org_id, user_id, 'Manager' FROM branch_admins
        ON CONFLICT (organisation_id, user_id) DO NOTHING;
        INSERT INTO organisation_members (organisation_id, user_id, role)
            SELECT id, owner_user_id, 'Company Admin' FROM organisations WHERE owner_user_id IS NOT NULL
        ON CONFLICT (organisation_id, user_id) DO NOTHING;

        -- Period locks back to one row per organisation (any branch locked => locked)
        ALTER TABLE fortnight_locks
            DROP CONSTRAINT IF EXISTS fortnight_locks_org_location_start_key,
            DROP CONSTRAINT IF EXISTS fortnight_locks_org_location_fkey;

        CREATE TEMP TABLE _locks ON COMMIT DROP AS
            SELECT org_id, start_date,
                   bool_or(roster_locked) AS roster_locked,
                   bool_or(timesheet_locked) AS timesheet_locked,
                   bool_or(is_published) AS is_published
              FROM fortnight_locks GROUP BY org_id, start_date;
        DELETE FROM fortnight_locks;
        ALTER TABLE fortnight_locks DROP COLUMN location_id;
        INSERT INTO fortnight_locks (org_id, start_date, roster_locked, timesheet_locked, is_published)
            SELECT org_id, start_date, roster_locked, timesheet_locked, is_published FROM _locks;
        ALTER TABLE fortnight_locks
            ADD CONSTRAINT fortnight_locks_org_id_start_date_key UNIQUE (org_id, start_date);

        ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_org_location_fkey;
        ALTER TABLE employees ALTER COLUMN location_id DROP NOT NULL;
        ALTER TABLE employees
            ADD CONSTRAINT employees_location_id_fkey
                FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;

        DROP TABLE IF EXISTS organisation_signups;
        DROP TABLE IF EXISTS branch_admin_invitation_branches;
        DROP TABLE IF EXISTS branch_admin_invitations;
        DROP TABLE IF EXISTS branch_admins;

        DROP INDEX IF EXISTS idx_organisations_owner;
        ALTER TABLE organisations ALTER COLUMN portal_slug DROP NOT NULL;
        ALTER TABLE organisations
            DROP CONSTRAINT IF EXISTS organisations_active_has_owner,
            DROP CONSTRAINT IF EXISTS organisations_owner_user_id_fkey;
        ALTER TABLE organisations
            ADD CONSTRAINT organisations_owner_user_id_fkey
                FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;

        ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_org_id_id_key;
        ALTER TABLE users DROP COLUMN IF EXISTS full_name;
    `);
};
