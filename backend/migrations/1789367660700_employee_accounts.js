/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Employee accounts (deliberate, partial reversal of 1789367660601_drop_legacy_roles.js).
 *
 * Revives employees.user_id so a worker record can optionally be linked to a login, and adds
 * an invitation flow for it, modeled on branch_admin_invitations. Unlike the old (dropped)
 * shape, one login maps to at most one worker record app-wide (partial unique index) rather
 * than being unconstrained.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
        CREATE UNIQUE INDEX idx_employees_user_id ON employees(user_id) WHERE user_id IS NOT NULL;

        CREATE TABLE employee_invitations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            email TEXT NOT NULL,
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
        CREATE INDEX idx_employee_invitations_org ON employee_invitations(org_id, created_at DESC);
        CREATE INDEX idx_employee_invitations_employee ON employee_invitations(employee_id);
    `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
    pgm.sql(`
        DROP TABLE IF EXISTS employee_invitations;
        DROP INDEX IF EXISTS idx_employees_user_id;
        ALTER TABLE employees DROP COLUMN IF EXISTS user_id;
    `);
};
