/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Per-shift break override. Default true preserves today's behaviour exactly for every existing
 * row: the org's unpaid break rule already applies to every shift implicitly, so "has a break" is
 * simply making that implicit default explicit and overridable per shift.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE shift_segments ADD COLUMN IF NOT EXISTS has_break BOOLEAN NOT NULL DEFAULT true;
        ALTER TABLE roster_templates ADD COLUMN IF NOT EXISTS has_break BOOLEAN NOT NULL DEFAULT true;
    `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE roster_templates DROP COLUMN IF EXISTS has_break;
        ALTER TABLE shift_segments DROP COLUMN IF EXISTS has_break;
    `);
};
