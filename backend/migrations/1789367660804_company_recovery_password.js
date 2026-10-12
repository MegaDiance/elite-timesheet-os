/* eslint-disable camelcase */

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * An optional company recovery password, set by the Organisation Owner. The company name plus this
 * password shows the organisation's current private link on /recover-link (see
 * services/loginLinkRecovery.ts). Only an Argon2id hash is stored. Additive: existing links and
 * organisations are untouched, and an organisation without one simply can't be recovered this way.
 */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE organisations
            ADD COLUMN IF NOT EXISTS recovery_password_hash TEXT,
            ADD COLUMN IF NOT EXISTS recovery_password_set_at TIMESTAMPTZ;
        CREATE INDEX IF NOT EXISTS organisations_recovery_name_idx
            ON organisations (LOWER(BTRIM(name)))
            WHERE recovery_password_hash IS NOT NULL;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        DROP INDEX IF EXISTS organisations_recovery_name_idx;
        ALTER TABLE organisations
            DROP COLUMN IF EXISTS recovery_password_set_at,
            DROP COLUMN IF EXISTS recovery_password_hash;
    `);
};
