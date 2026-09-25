/* eslint-disable camelcase */

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * First-time walkthrough progress, per person (it used to live only in one browser's storage, so
 * it reappeared on every new device and could never be offered again on purpose).
 *
 *   tutorial_version       — which walkthrough the person finished or skipped (NULL = never)
 *   tutorial_completed_at  — when; kept for support, not shown
 *
 * Additive only.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS tutorial_version INTEGER,
            ADD COLUMN IF NOT EXISTS tutorial_completed_at TIMESTAMPTZ;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE users
            DROP COLUMN IF EXISTS tutorial_completed_at,
            DROP COLUMN IF EXISTS tutorial_version;
    `);
};
