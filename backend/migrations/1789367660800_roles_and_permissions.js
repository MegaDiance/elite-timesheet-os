/* eslint-disable camelcase */

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Roles and permissions (expand + backfill).
 *
 *   User → assignments (role + scope) → permissions → branches
 *
 *   permissions         the catalogue of capabilities (seeded here; backend/src/services/permissions.ts is the
 *                       same list and a test keeps them identical)
 *   roles               per organisation. Three system roles exist for every organisation (Owner, Admin,
 *                       Employee); the rest are custom roles the Owner creates
 *   role_permissions    which permissions a role holds (Admin and custom roles; Owner and Employee are fixed
 *                       in code)
 *   user_roles          one person holding one role, with the scope it applies in: the entire organisation
 *                       (scope_all) or the branches listed in user_role_branches
 *   user_role_branches  the branches of a branch-scoped assignment
 *
 * Organisation isolation is enforced by the schema: role rows carry org_id, an assignment's role must
 * belong to the same organisation, and an assignment's branches must belong to that organisation too
 * (composite foreign keys), so no row can point across tenants.
 *
 * Backfill never grants more than a person already had: every Branch Admin becomes an Admin assignment
 * scoped to exactly the branches they administered. The Owner stays organisations.owner_user_id, and an
 * employee's access stays their linked worker record; neither is duplicated into user_roles.
 *
 * `branch_admins` is left in place but is no longer read. Dropping it is the contract step (backup and
 * explicit approval first, docs/BACKEND-SCHEMA.md §9).
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
    pgm.sql(`
        -- ------------------------------------------------------------------
        -- 1. Permission catalogue
        -- ------------------------------------------------------------------
        CREATE TABLE permissions (
            key TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            level TEXT NOT NULL CHECK (level IN ('branch', 'organisation', 'self')),
            label TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL
        );

        INSERT INTO permissions (key, category, level, label, sort_order) VALUES
            ('employees.view', 'Employees', 'branch', 'View employees', 10),
            ('employees.create', 'Employees', 'branch', 'Add employees', 11),
            ('employees.edit', 'Employees', 'branch', 'Edit employees', 12),
            ('employees.archive', 'Employees', 'branch', 'Deactivate and delete employees', 13),
            ('employees.manage_access', 'Employees', 'branch', 'Manage employee sign-in', 14),
            ('rosters.view', 'Rosters', 'branch', 'View rosters', 20),
            ('rosters.create', 'Rosters', 'branch', 'Create rosters', 21),
            ('rosters.edit', 'Rosters', 'branch', 'Edit rosters', 22),
            ('timesheets.view', 'Timesheets', 'branch', 'View timesheets', 30),
            ('timesheets.create', 'Timesheets', 'branch', 'Create timesheets', 31),
            ('timesheets.edit', 'Timesheets', 'branch', 'Edit timesheets', 32),
            ('timesheets.approve', 'Timesheets', 'branch', 'Approve timesheets', 33),
            ('timesheets.reopen', 'Timesheets', 'branch', 'Reopen timesheets', 34),
            ('timesheets.lock', 'Timesheets', 'branch', 'Lock pay periods', 35),
            ('leave.view', 'Leave', 'branch', 'View leave requests', 40),
            ('leave.approve', 'Leave', 'branch', 'Approve leave', 41),
            ('leave.manage', 'Leave', 'branch', 'Manage leave and timesheet rules', 42),
            ('payroll.view', 'Payroll', 'branch', 'View payroll data', 50),
            ('payroll.export', 'Payroll', 'branch', 'Export payroll', 51),
            ('organisation.view', 'Organisation', 'organisation', 'View organisation settings', 60),
            ('organisation.edit', 'Organisation', 'organisation', 'Edit organisation settings', 61),
            ('branches.manage', 'Organisation', 'organisation', 'Manage branches', 62),
            ('users.manage', 'Organisation', 'organisation', 'Manage users', 63),
            ('roles.manage', 'Organisation', 'organisation', 'Manage roles and permissions', 64),
            ('announcements.moderate', 'Organisation', 'organisation', 'Moderate announcements', 65),
            ('audit.view', 'Security', 'organisation', 'View audit logs', 70),
            ('security.manage', 'Security', 'organisation', 'Manage security settings', 71),
            ('portal.access', 'Employee portal', 'self', 'Use the employee portal', 80),
            ('timesheets.submit', 'Employee portal', 'self', 'Submit own timesheet', 81),
            ('leave.create', 'Employee portal', 'self', 'Request leave', 82);

        -- ------------------------------------------------------------------
        -- 2. Roles
        -- ------------------------------------------------------------------
        CREATE TABLE roles (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
            description TEXT CHECK (description IS NULL OR char_length(description) <= 300),
            system_key TEXT CHECK (system_key IN ('OWNER', 'ADMIN', 'EMPLOYEE')),
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (org_id, id)
        );
        CREATE UNIQUE INDEX roles_org_name_key ON roles (org_id, lower(btrim(name)));
        CREATE UNIQUE INDEX roles_org_system_key ON roles (org_id, system_key) WHERE system_key IS NOT NULL;

        CREATE TABLE role_permissions (
            role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
            permission_key TEXT NOT NULL REFERENCES permissions(key),
            PRIMARY KEY (role_id, permission_key)
        );

        -- A built-in role is never deleted on its own (it goes only with its organisation).
        CREATE FUNCTION roles_protect_system() RETURNS trigger AS $fn$
        BEGIN
            IF OLD.system_key IS NOT NULL AND EXISTS (SELECT 1 FROM organisations WHERE id = OLD.org_id) THEN
                RAISE EXCEPTION 'The % role is built in and cannot be deleted.', OLD.name USING ERRCODE = 'restrict_violation';
            END IF;
            RETURN OLD;
        END
        $fn$ LANGUAGE plpgsql;
        CREATE TRIGGER roles_protect_system BEFORE DELETE ON roles FOR EACH ROW EXECUTE FUNCTION roles_protect_system();

        -- ------------------------------------------------------------------
        -- 3. Assignments
        -- ------------------------------------------------------------------
        CREATE TABLE user_roles (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role_id UUID NOT NULL,
            scope_all BOOLEAN NOT NULL DEFAULT false,
            assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (user_id, role_id),
            UNIQUE (org_id, id),
            FOREIGN KEY (org_id, role_id) REFERENCES roles(org_id, id) ON DELETE CASCADE
        );
        CREATE INDEX idx_user_roles_user_org ON user_roles (user_id, org_id);
        CREATE INDEX idx_user_roles_role ON user_roles (role_id);

        CREATE TABLE user_role_branches (
            user_role_id UUID NOT NULL,
            org_id UUID NOT NULL,
            location_id UUID NOT NULL,
            PRIMARY KEY (user_role_id, location_id),
            FOREIGN KEY (org_id, user_role_id) REFERENCES user_roles(org_id, id) ON DELETE CASCADE,
            FOREIGN KEY (org_id, location_id) REFERENCES locations(org_id, id) ON DELETE CASCADE
        );
        CREATE INDEX idx_user_role_branches_location ON user_role_branches (location_id);

        -- ------------------------------------------------------------------
        -- 4. Every organisation has its three built-in roles, always
        -- ------------------------------------------------------------------
        CREATE FUNCTION create_system_roles(p_org UUID) RETURNS VOID AS $fn$
        DECLARE
            admin_role UUID;
        BEGIN
            INSERT INTO roles (org_id, name, description, system_key) VALUES
                (p_org, 'Owner', 'Full access to the whole organisation. Can’t be removed or changed.', 'OWNER'),
                (p_org, 'Admin', 'Runs the day-to-day: workers, rosters, timesheets, leave and payroll.', 'ADMIN'),
                (p_org, 'Employee', 'Uses the employee portal for their own roster, timesheet and leave.', 'EMPLOYEE')
            ON CONFLICT DO NOTHING;

            SELECT id INTO admin_role FROM roles WHERE org_id = p_org AND system_key = 'ADMIN';
            INSERT INTO role_permissions (role_id, permission_key)
                SELECT admin_role, k FROM unnest(ARRAY[
                    'employees.view', 'employees.create', 'employees.edit', 'employees.archive', 'employees.manage_access',
                    'rosters.view', 'rosters.create', 'rosters.edit',
                    'timesheets.view', 'timesheets.create', 'timesheets.edit', 'timesheets.approve', 'timesheets.reopen', 'timesheets.lock',
                    'leave.view', 'leave.approve', 'leave.manage',
                    'payroll.view', 'payroll.export',
                    'organisation.view'
                ]) AS k
            ON CONFLICT DO NOTHING;
        END
        $fn$ LANGUAGE plpgsql;

        CREATE FUNCTION organisations_create_system_roles() RETURNS trigger AS $fn$
        BEGIN
            PERFORM create_system_roles(NEW.id);
            RETURN NEW;
        END
        $fn$ LANGUAGE plpgsql;
        CREATE TRIGGER organisations_create_system_roles AFTER INSERT ON organisations
            FOR EACH ROW EXECUTE FUNCTION organisations_create_system_roles();

        SELECT create_system_roles(id) FROM organisations;

        -- ------------------------------------------------------------------
        -- 5. Backfill: each Branch Admin becomes an Admin assignment scoped to their branches
        -- ------------------------------------------------------------------
        INSERT INTO user_roles (org_id, user_id, role_id, scope_all, assigned_by)
            SELECT ba.org_id, ba.user_id, r.id, false, (array_agg(ba.assigned_by))[1]
              FROM branch_admins ba
              JOIN roles r ON r.org_id = ba.org_id AND r.system_key = 'ADMIN'
             GROUP BY ba.org_id, ba.user_id, r.id;

        INSERT INTO user_role_branches (user_role_id, org_id, location_id)
            SELECT ur.id, ba.org_id, ba.location_id
              FROM branch_admins ba
              JOIN roles r ON r.org_id = ba.org_id AND r.system_key = 'ADMIN'
              JOIN user_roles ur ON ur.org_id = ba.org_id AND ur.user_id = ba.user_id AND ur.role_id = r.id;

        COMMENT ON TABLE branch_admins IS 'DEPRECATED: replaced by user_roles / user_role_branches (migration 800). No longer read by the application; kept until the contract step.';

        -- ------------------------------------------------------------------
        -- 6. Invitations carry the role they will assign
        -- ------------------------------------------------------------------
        ALTER TABLE branch_admin_invitations
            ADD COLUMN role_id UUID,
            ADD COLUMN scope_all BOOLEAN NOT NULL DEFAULT false;

        UPDATE branch_admin_invitations i
           SET role_id = r.id
          FROM roles r
         WHERE r.org_id = i.org_id AND r.system_key = 'ADMIN';

        ALTER TABLE branch_admin_invitations
            ALTER COLUMN role_id SET NOT NULL,
            ADD CONSTRAINT branch_admin_invitations_role_fkey
                FOREIGN KEY (org_id, role_id) REFERENCES roles(org_id, id) ON DELETE CASCADE;

        -- ------------------------------------------------------------------
        -- 7. Sensitive re-authentication (organisation switching) is remembered on the server-side session
        -- ------------------------------------------------------------------
        ALTER TABLE sessions ADD COLUMN reauthenticated_at TIMESTAMPTZ;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE sessions DROP COLUMN IF EXISTS reauthenticated_at;
        ALTER TABLE branch_admin_invitations
            DROP CONSTRAINT IF EXISTS branch_admin_invitations_role_fkey,
            DROP COLUMN IF EXISTS scope_all,
            DROP COLUMN IF EXISTS role_id;
        COMMENT ON TABLE branch_admins IS NULL;
        DROP TRIGGER IF EXISTS organisations_create_system_roles ON organisations;
        DROP FUNCTION IF EXISTS organisations_create_system_roles();
        DROP FUNCTION IF EXISTS create_system_roles(UUID);
        DROP TABLE IF EXISTS user_role_branches;
        DROP TABLE IF EXISTS user_roles;
        DROP TRIGGER IF EXISTS roles_protect_system ON roles;
        DROP TABLE IF EXISTS role_permissions;
        DROP TABLE IF EXISTS roles;
        DROP FUNCTION IF EXISTS roles_protect_system();
        DROP TABLE IF EXISTS permissions;
    `);
};
