/* eslint-disable camelcase */

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Staff import.
 *
 *   employees.employee_code   the organisation's own staff number (optional). Unique within an
 *                             organisation, ignoring case, so an import can spot the same person twice.
 *   import_jobs               progress of a large import that runs in the background. The import
 *                             itself is one transaction: it either adds every row or none.
 */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE employees ADD COLUMN employee_code TEXT
            CHECK (employee_code IS NULL OR (length(employee_code) BETWEEN 1 AND 40));
        CREATE UNIQUE INDEX employees_org_code_key ON employees (org_id, lower(employee_code)) WHERE employee_code IS NOT NULL;

        CREATE TABLE import_jobs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            kind TEXT NOT NULL DEFAULT 'staff' CHECK (kind IN ('staff')),
            status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
            total_rows INTEGER NOT NULL CHECK (total_rows >= 0),
            done_rows INTEGER NOT NULL DEFAULT 0 CHECK (done_rows >= 0),
            error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            finished_at TIMESTAMPTZ
        );
        CREATE INDEX idx_import_jobs_org ON import_jobs (org_id, created_at DESC);
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        DROP TABLE IF EXISTS import_jobs;
        DROP INDEX IF EXISTS employees_org_code_key;
        ALTER TABLE employees DROP COLUMN IF EXISTS employee_code;
    `);
};
