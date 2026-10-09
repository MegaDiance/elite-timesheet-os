/* eslint-disable camelcase */

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Useful roles from day one.
 *
 *   - The built-in Admin role is called "Manager" (its system key stays ADMIN). It is renamed only
 *     while it still has its original name.
 *   - Every organisation also starts with two ordinary roles it can edit, duplicate or delete:
 *     "Branch Manager" (runs the branches a person is given) and "Payroll" (records and exports
 *     hours). They are created only if the organisation has no role with that name already.
 *
 *   - The permission catalogue uses the app's words: Staff, Schedules and Reports instead of
 *     Employees, Rosters and Payroll (keys are unchanged).
 *
 * services/permissions.ts holds the same lists (MANAGER_DEFAULT_PERMISSIONS, ROLE_PRESETS) and a
 * test keeps them identical.
 */
exports.up = (pgm) => {
    pgm.sql(`
        UPDATE permissions SET category = 'Staff' WHERE category = 'Employees';
        UPDATE permissions SET category = 'Schedules' WHERE category = 'Rosters';
        UPDATE permissions SET category = 'Reports' WHERE category = 'Payroll';
        UPDATE permissions SET label = v.label FROM (VALUES
            ('employees.view', 'View staff'), ('employees.create', 'Add staff'), ('employees.edit', 'Edit staff'),
            ('employees.archive', 'Deactivate and delete staff'),
            ('rosters.view', 'View schedules'), ('rosters.create', 'Create schedules'), ('rosters.edit', 'Edit schedules'),
            ('payroll.view', 'View reports'), ('payroll.export', 'Export reports')
        ) AS v(key, label) WHERE permissions.key = v.key;

        UPDATE roles
           SET name = 'Manager', description = 'Runs the day-to-day: staff, schedules, timesheets, leave and payroll.', updated_at = NOW()
         WHERE system_key = 'ADMIN' AND name = 'Admin'
           AND NOT EXISTS (SELECT 1 FROM roles other WHERE other.org_id = roles.org_id AND lower(other.name) = 'manager');

        CREATE OR REPLACE FUNCTION create_role_presets(p_org UUID) RETURNS VOID AS $fn$
        DECLARE
            preset_role UUID;
        BEGIN
            INSERT INTO roles (org_id, name, description)
                VALUES (p_org, 'Branch Manager', 'Runs the branches they’re given: staff, schedules, timesheets and leave.')
                ON CONFLICT DO NOTHING
                RETURNING id INTO preset_role;
            IF preset_role IS NOT NULL THEN
                INSERT INTO role_permissions (role_id, permission_key)
                    SELECT preset_role, k FROM unnest(ARRAY[
                        'employees.view', 'employees.create', 'employees.edit', 'employees.manage_access',
                        'rosters.view', 'rosters.create', 'rosters.edit',
                        'timesheets.view', 'timesheets.create', 'timesheets.edit', 'timesheets.approve', 'timesheets.reopen',
                        'leave.view', 'leave.approve',
                        'payroll.view'
                    ]) AS k;
            END IF;

            preset_role := NULL;
            INSERT INTO roles (org_id, name, description)
                VALUES (p_org, 'Payroll', 'Records and checks hours, and exports the payroll report.')
                ON CONFLICT DO NOTHING
                RETURNING id INTO preset_role;
            IF preset_role IS NOT NULL THEN
                INSERT INTO role_permissions (role_id, permission_key)
                    SELECT preset_role, k FROM unnest(ARRAY[
                        'employees.view',
                        'timesheets.view', 'timesheets.create', 'timesheets.edit',
                        'payroll.view', 'payroll.export'
                    ]) AS k;
            END IF;
        END
        $fn$ LANGUAGE plpgsql;

        CREATE OR REPLACE FUNCTION create_system_roles(p_org UUID) RETURNS VOID AS $fn$
        DECLARE
            admin_role UUID;
        BEGIN
            INSERT INTO roles (org_id, name, description, system_key) VALUES
                (p_org, 'Owner', 'Full access to the whole organisation. Can’t be removed or changed.', 'OWNER'),
                (p_org, 'Manager', 'Runs the day-to-day: staff, schedules, timesheets, leave and payroll.', 'ADMIN'),
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

            PERFORM create_role_presets(p_org);
        END
        $fn$ LANGUAGE plpgsql;

        SELECT create_role_presets(id) FROM organisations;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        UPDATE permissions SET category = 'Employees' WHERE category = 'Staff';
        UPDATE permissions SET category = 'Rosters' WHERE category = 'Schedules';
        UPDATE permissions SET category = 'Payroll' WHERE category = 'Reports';
        UPDATE permissions SET label = v.label FROM (VALUES
            ('employees.view', 'View employees'), ('employees.create', 'Add employees'), ('employees.edit', 'Edit employees'),
            ('employees.archive', 'Deactivate and delete employees'),
            ('rosters.view', 'View rosters'), ('rosters.create', 'Create rosters'), ('rosters.edit', 'Edit rosters'),
            ('payroll.view', 'View payroll data'), ('payroll.export', 'Export payroll')
        ) AS v(key, label) WHERE permissions.key = v.key;
        CREATE OR REPLACE FUNCTION create_system_roles(p_org UUID) RETURNS VOID AS $fn$
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
        DROP FUNCTION IF EXISTS create_role_presets(UUID);
        UPDATE roles SET name = 'Admin', description = 'Runs the day-to-day: workers, rosters, timesheets, leave and payroll.'
         WHERE system_key = 'ADMIN' AND name = 'Manager';
        -- The preset roles stay: they may have been edited or assigned since.
    `);
};
