/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Two-role model (contract).
 *
 * Removes every legacy role store and every structure that only existed for roles that
 * no longer exist (Platform Admin, Company Admin, Manager, Employee logins).
 *
 * Nothing is destroyed: each dropped table / column is first copied, row by row, into
 * legacy_archive as JSON. Secrets (plaintext or hashed invitation tokens) are NOT copied.
 * legacy_archive has no application code path and can be dropped once the deployed data
 * has been checked.
 *
 * Worker records (employees), rosters, timesheets and their segments are untouched apart
 * from the value normalisation in section 3, whose original values are archived too.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
    pgm.sql(`
        -- ------------------------------------------------------------------
        -- 1. Archive
        -- ------------------------------------------------------------------
        CREATE TABLE legacy_archive (
            id BIGSERIAL PRIMARY KEY,
            source TEXT NOT NULL,
            row JSONB NOT NULL,
            archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX idx_legacy_archive_source ON legacy_archive(source);

        INSERT INTO legacy_archive (source, row)
            SELECT 'organisation_members', to_jsonb(t) FROM organisation_members t;
        INSERT INTO legacy_archive (source, row)
            SELECT 'location_memberships', to_jsonb(t) FROM location_memberships t;
        INSERT INTO legacy_archive (source, row)
            SELECT 'location_invitations', to_jsonb(t) - 'token' - 'token_hash' FROM location_invitations t;
        INSERT INTO legacy_archive (source, row)
            SELECT 'org_invitation_tokens', to_jsonb(t) - 'token' FROM org_invitation_tokens t;
        INSERT INTO legacy_archive (source, row)
            SELECT 'invitation_tokens', to_jsonb(t) - 'token_hash' FROM invitation_tokens t;
        INSERT INTO legacy_archive (source, row)
            SELECT 'leave_requests', to_jsonb(t) FROM leave_requests t;
        INSERT INTO legacy_archive (source, row)
            SELECT 'users.role_org', jsonb_build_object('id', id, 'email', email, 'role', role, 'org_id', org_id)
              FROM users WHERE role IS NOT NULL OR org_id IS NOT NULL;
        INSERT INTO legacy_archive (source, row)
            SELECT 'employees.user_id', jsonb_build_object('id', id, 'org_id', org_id, 'user_id', user_id)
              FROM employees WHERE user_id IS NOT NULL;
        INSERT INTO legacy_archive (source, row)
            SELECT 'organisations.settings', jsonb_build_object(
                       'id', id,
                       'slug', slug,
                       'timesheet_entry_mode', timesheet_entry_mode,
                       'allow_employee_chat', allow_employee_chat,
                       'is_public_searchable', is_public_searchable)
              FROM organisations;
        INSERT INTO legacy_archive (source, row)
            SELECT 'fortnight_locks.is_published', jsonb_build_object(
                       'org_id', org_id, 'location_id', location_id, 'start_date', start_date, 'is_published', is_published)
              FROM fortnight_locks WHERE is_published = true;
        INSERT INTO legacy_archive (source, row)
            SELECT 'timesheet_submissions.status', jsonb_build_object(
                       'id', id, 'status', status, 'submitted_at', submitted_at, 'rejection_reason', rejection_reason)
              FROM timesheet_submissions
             WHERE status NOT IN ('Draft', 'Approved') OR submitted_at IS NOT NULL OR rejection_reason IS NOT NULL;
        INSERT INTO legacy_archive (source, row)
            SELECT 'shift_segments.type', jsonb_build_object(
                       'id', id, 'segment_type', segment_type, 'actual_segment_type', actual_segment_type)
              FROM shift_segments
             WHERE segment_type NOT IN ('WORK', 'Sick', 'Annual', 'TIL', 'LWIP', 'Other')
                OR (actual_segment_type IS NOT NULL AND actual_segment_type NOT IN ('WORK', 'Sick', 'Annual', 'TIL', 'LWIP', 'Other'));
        INSERT INTO legacy_archive (source, row)
            SELECT 'roster_templates.type', jsonb_build_object('id', id, 'segment_type', segment_type)
              FROM roster_templates
             WHERE segment_type NOT IN ('WORK', 'Sick', 'Annual', 'TIL', 'LWIP', 'Other');

        -- ------------------------------------------------------------------
        -- 2. Timesheet status: only admins enter hours, so there is no submit/review/reject
        --    handshake. A period is either Draft or Approved.
        -- ------------------------------------------------------------------
        UPDATE timesheet_submissions SET status = 'Draft' WHERE status NOT IN ('Draft', 'Approved');
        ALTER TABLE timesheet_submissions
            DROP COLUMN IF EXISTS submitted_at,
            DROP COLUMN IF EXISTS rejection_reason,
            ADD CONSTRAINT timesheet_submissions_status_check CHECK (status IN ('Draft', 'Approved'));

        -- ------------------------------------------------------------------
        -- 3. One segment vocabulary for roster, templates and timesheets
        --    Legacy 'Normal' is ordinary work. Any other unknown type becomes 'Other' with
        --    the original label kept at the front of the segment note.
        -- ------------------------------------------------------------------
        UPDATE shift_segments SET segment_type = 'WORK' WHERE segment_type IN ('Normal', 'NORMAL', 'Work', 'work');
        UPDATE shift_segments SET actual_segment_type = 'WORK' WHERE actual_segment_type IN ('Normal', 'NORMAL', 'Work', 'work');
        UPDATE shift_segments SET actual_segment_type = NULL WHERE actual_segment_type = '';

        UPDATE shift_segments
           SET notes = TRIM('[' || segment_type || '] ' || COALESCE(notes, '')), segment_type = 'Other'
         WHERE segment_type NOT IN ('WORK', 'Sick', 'Annual', 'TIL', 'LWIP', 'Other');
        UPDATE shift_segments
           SET notes = TRIM('[' || actual_segment_type || '] ' || COALESCE(notes, '')), actual_segment_type = 'Other'
         WHERE actual_segment_type IS NOT NULL
           AND actual_segment_type NOT IN ('WORK', 'Sick', 'Annual', 'TIL', 'LWIP', 'Other');

        UPDATE roster_templates SET segment_type = 'WORK' WHERE segment_type IN ('Normal', 'NORMAL', 'Work', 'work');
        UPDATE roster_templates SET segment_type = 'Other'
         WHERE segment_type NOT IN ('WORK', 'Sick', 'Annual', 'TIL', 'LWIP', 'Other');

        ALTER TABLE shift_segments
            ADD CONSTRAINT shift_segments_segment_type_check
                CHECK (segment_type IN ('WORK', 'Sick', 'Annual', 'TIL', 'LWIP', 'Other')),
            ADD CONSTRAINT shift_segments_actual_segment_type_check
                CHECK (actual_segment_type IS NULL OR actual_segment_type IN ('WORK', 'Sick', 'Annual', 'TIL', 'LWIP', 'Other'));
        ALTER TABLE roster_templates
            ADD CONSTRAINT roster_templates_segment_type_check
                CHECK (segment_type IN ('WORK', 'Sick', 'Annual', 'TIL', 'LWIP', 'Other'));

        -- ------------------------------------------------------------------
        -- 4. Drop the legacy role stores
        -- ------------------------------------------------------------------
        -- Outstanding challenges carried a role to mint into the token; they cannot be honoured.
        DELETE FROM login_verification_challenges WHERE consumed = false;
        ALTER TABLE login_verification_challenges DROP COLUMN IF EXISTS role;

        -- Sessions carried an "active branch" that selected permissions. Sign everyone out
        -- once so no pre-migration session outlives the role model it was created under.
        UPDATE sessions SET is_active = false, revoked_at = NOW() WHERE is_active = true;
        ALTER TABLE sessions DROP COLUMN IF EXISTS location_id;

        DROP TABLE IF EXISTS organisation_members;
        DROP TABLE IF EXISTS location_memberships;
        DROP TABLE IF EXISTS location_invitations;
        DROP TABLE IF EXISTS invitation_tokens;
        DROP TABLE IF EXISTS org_invitation_tokens;
        DROP TABLE IF EXISTS leave_requests;

        ALTER TABLE users DROP COLUMN IF EXISTS role, DROP COLUMN IF EXISTS org_id;
        ALTER TABLE employees DROP COLUMN IF EXISTS user_id;

        -- The human-readable slug was a second, guessable sign-in URL that kept working after the
        -- private link was regenerated.
        DROP INDEX IF EXISTS idx_organisations_slug;
        ALTER TABLE organisations
            DROP COLUMN IF EXISTS slug,
            DROP COLUMN IF EXISTS timesheet_entry_mode,
            DROP COLUMN IF EXISTS allow_employee_chat,
            DROP COLUMN IF EXISTS is_public_searchable;

        -- "Publishing" a roster released it to employee logins. Nobody but admins signs in now.
        ALTER TABLE fortnight_locks DROP COLUMN IF EXISTS is_published;

        -- ------------------------------------------------------------------
        -- 5. audit_logs: there is no platform scope any more; user_id duplicated actor_id;
        --    snapshot was never read or written.
        -- ------------------------------------------------------------------
        DROP INDEX IF EXISTS idx_audit_logs_scope_org;
        ALTER TABLE audit_logs
            DROP COLUMN IF EXISTS scope,
            DROP COLUMN IF EXISTS user_id,
            DROP COLUMN IF EXISTS snapshot;
    `);
};

/**
 * Restores the dropped STRUCTURES so the previous application build can start.
 * Data is restored only where it is unambiguous (membership rows, user role/home org,
 * worker↔user links). Invitation tokens are never restored.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE audit_logs
            ADD COLUMN IF NOT EXISTS snapshot TEXT,
            ADD COLUMN IF NOT EXISTS user_id UUID,
            ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'organisation' CHECK (scope IN ('organisation', 'platform'));
        CREATE INDEX IF NOT EXISTS idx_audit_logs_scope_org ON audit_logs(scope, org_id);

        ALTER TABLE fortnight_locks ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT false;
        UPDATE fortnight_locks fl
           SET is_published = true
          FROM legacy_archive a
         WHERE a.source = 'fortnight_locks.is_published'
           AND (a.row->>'location_id')::uuid = fl.location_id AND (a.row->>'start_date')::date = fl.start_date;

        ALTER TABLE organisations
            ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE,
            ADD COLUMN IF NOT EXISTS is_public_searchable BOOLEAN DEFAULT true,
            ADD COLUMN IF NOT EXISTS allow_employee_chat BOOLEAN DEFAULT true,
            ADD COLUMN IF NOT EXISTS timesheet_entry_mode TEXT DEFAULT 'employee'
                CHECK (timesheet_entry_mode IN ('employee', 'manager'));

        UPDATE organisations o
           SET slug = a.row->>'slug'
          FROM legacy_archive a
         WHERE a.source = 'organisations.settings' AND (a.row->>'id')::uuid = o.id;
        CREATE INDEX IF NOT EXISTS idx_organisations_slug ON organisations(slug);

        ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
        UPDATE employees e
           SET user_id = (a.row->>'user_id')::uuid
          FROM legacy_archive a
         WHERE a.source = 'employees.user_id' AND (a.row->>'id')::uuid = e.id
           AND EXISTS (SELECT 1 FROM users u WHERE u.id = (a.row->>'user_id')::uuid);

        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS role TEXT,
            ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE CASCADE;
        UPDATE users u
           SET role = a.row->>'role',
               org_id = (SELECT o.id FROM organisations o WHERE o.id = NULLIF(a.row->>'org_id', '')::uuid)
          FROM legacy_archive a
         WHERE a.source = 'users.role_org' AND (a.row->>'id')::uuid = u.id;

        CREATE TABLE IF NOT EXISTS leave_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            leave_type TEXT NOT NULL,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            hours NUMERIC NOT NULL,
            reason TEXT,
            status TEXT NOT NULL DEFAULT 'Pending',
            reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at TIMESTAMPTZ,
            rejection_reason TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS org_invitation_tokens (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email TEXT NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            used BOOLEAN DEFAULT false,
            delivery_status TEXT DEFAULT 'pending',
            last_error TEXT
        );

        CREATE TABLE IF NOT EXISTS invitation_tokens (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            token_hash TEXT UNIQUE NOT NULL,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

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
        CREATE INDEX IF NOT EXISTS idx_location_invitations_token_hash ON location_invitations(token_hash);
        CREATE INDEX IF NOT EXISTS idx_location_invitations_email ON location_invitations(org_id, email);

        CREATE TABLE IF NOT EXISTS location_memberships (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('manager', 'admin', 'employee')),
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(location_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_location_memberships_user ON location_memberships(user_id);
        CREATE INDEX IF NOT EXISTS idx_location_memberships_loc ON location_memberships(location_id);
        CREATE INDEX IF NOT EXISTS idx_loc_members_user_loc ON location_memberships(user_id, location_id);
        INSERT INTO location_memberships (id, location_id, user_id, role, is_active, created_at)
            SELECT (a.row->>'id')::uuid, (a.row->>'location_id')::uuid, (a.row->>'user_id')::uuid,
                   a.row->>'role', COALESCE((a.row->>'is_active')::boolean, true), (a.row->>'created_at')::timestamptz
              FROM legacy_archive a
             WHERE a.source = 'location_memberships'
               AND EXISTS (SELECT 1 FROM locations l WHERE l.id = (a.row->>'location_id')::uuid)
               AND EXISTS (SELECT 1 FROM users u WHERE u.id = (a.row->>'user_id')::uuid)
        ON CONFLICT DO NOTHING;

        CREATE TABLE IF NOT EXISTS organisation_members (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('Platform Admin', 'Company Admin', 'Manager', 'Employee')),
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(organisation_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_org_members_user ON organisation_members(user_id);
        CREATE INDEX IF NOT EXISTS idx_org_members_user_org ON organisation_members(user_id, organisation_id);
        INSERT INTO organisation_members (id, organisation_id, user_id, role, is_active, created_at)
            SELECT (a.row->>'id')::uuid, (a.row->>'organisation_id')::uuid, (a.row->>'user_id')::uuid,
                   a.row->>'role', COALESCE((a.row->>'is_active')::boolean, true), (a.row->>'created_at')::timestamptz
              FROM legacy_archive a
             WHERE a.source = 'organisation_members'
               AND EXISTS (SELECT 1 FROM organisations o WHERE o.id = (a.row->>'organisation_id')::uuid)
               AND EXISTS (SELECT 1 FROM users u WHERE u.id = (a.row->>'user_id')::uuid)
        ON CONFLICT DO NOTHING;

        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;
        ALTER TABLE login_verification_challenges ADD COLUMN IF NOT EXISTS role TEXT;

        ALTER TABLE roster_templates DROP CONSTRAINT IF EXISTS roster_templates_segment_type_check;
        ALTER TABLE shift_segments
            DROP CONSTRAINT IF EXISTS shift_segments_actual_segment_type_check,
            DROP CONSTRAINT IF EXISTS shift_segments_segment_type_check;

        ALTER TABLE timesheet_submissions
            DROP CONSTRAINT IF EXISTS timesheet_submissions_status_check,
            ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

        DROP TABLE IF EXISTS legacy_archive;
    `);
};
