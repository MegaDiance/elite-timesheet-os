/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Company-level workforce settings: whether employees can submit their own timesheets,
 * whether approved leave auto-merges with rostered hours, and whether leave requests need
 * approval before they take effect. All three default to preserving today's behaviour for
 * existing organisations (employees_can_submit_timesheets defaults true because that's the
 * feature this migration exists to re-enable; the other two default to the more conservative,
 * opt-in choice).
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE organisations
            ADD COLUMN IF NOT EXISTS employees_can_submit_timesheets BOOLEAN NOT NULL DEFAULT true,
            ADD COLUMN IF NOT EXISTS automatically_merge_leave_with_roster BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS leave_requests_require_approval BOOLEAN NOT NULL DEFAULT true;
    `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE organisations
            DROP COLUMN IF EXISTS leave_requests_require_approval,
            DROP COLUMN IF EXISTS automatically_merge_leave_with_roster,
            DROP COLUMN IF EXISTS employees_can_submit_timesheets;
    `);
};
