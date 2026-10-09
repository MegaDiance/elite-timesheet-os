/* eslint-disable camelcase */

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * A "Submitted" timesheet state, used only when employees handle their own timesheets
 * (organisations.employees_can_submit_timesheets): Draft → Submitted (the employee hands it in) →
 * Approved (a manager). A manager can send a Submitted timesheet back to Draft. Without that
 * setting a timesheet still goes straight from Draft to Approved.
 */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE timesheet_submissions DROP CONSTRAINT IF EXISTS timesheet_submissions_status_check;
        ALTER TABLE timesheet_submissions
            ADD CONSTRAINT timesheet_submissions_status_check CHECK (status IN ('Draft', 'Submitted', 'Approved')),
            ADD COLUMN submitted_at TIMESTAMPTZ,
            ADD COLUMN submitted_by UUID REFERENCES users(id) ON DELETE SET NULL;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        UPDATE timesheet_submissions SET status = 'Draft' WHERE status = 'Submitted';
        ALTER TABLE timesheet_submissions DROP CONSTRAINT IF EXISTS timesheet_submissions_status_check;
        ALTER TABLE timesheet_submissions
            DROP COLUMN IF EXISTS submitted_by,
            DROP COLUMN IF EXISTS submitted_at,
            ADD CONSTRAINT timesheet_submissions_status_check CHECK (status IN ('Draft', 'Approved'));
    `);
};
