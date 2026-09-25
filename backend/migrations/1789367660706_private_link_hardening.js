/* eslint-disable camelcase */

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Private sign-in link hardening (expand + migrate step).
 *
 * The organisation's link token (/login/<token>) used to be stored and compared in plain text,
 * and never expired. From now on:
 *   - `portal_slug_hash`   SHA-256 of the token — the only column used to look a link up.
 *   - `portal_slug_enc`    AES-256-GCM encrypted copy, written by the application (the key never
 *                          reaches the database), so the Owner can see and copy the link again.
 *   - `portal_link_expires_at`  optional expiry chosen by the Owner. NULL = does not expire.
 *   - `portal_link_created_at`  when the current link was issued.
 *
 * Existing links keep working: their hash is backfilled here. The plain `portal_slug` is made
 * nullable and is cleared by the application once each organisation's encrypted copy exists.
 * Dropping the `portal_slug` column is a later contract step that needs explicit approval.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
    pgm.sql(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;

        ALTER TABLE organisations
            ADD COLUMN IF NOT EXISTS portal_slug_hash TEXT,
            ADD COLUMN IF NOT EXISTS portal_slug_enc TEXT,
            ADD COLUMN IF NOT EXISTS portal_link_expires_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS portal_link_created_at TIMESTAMPTZ;

        UPDATE organisations
           SET portal_slug_hash = encode(digest(lower(portal_slug), 'sha256'), 'hex'),
               portal_link_created_at = COALESCE(portal_link_created_at, created_at, NOW())
         WHERE portal_slug IS NOT NULL AND portal_slug_hash IS NULL;

        ALTER TABLE organisations ALTER COLUMN portal_slug DROP NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS organisations_portal_slug_hash_key ON organisations (portal_slug_hash);
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        DROP INDEX IF EXISTS organisations_portal_slug_hash_key;
        ALTER TABLE organisations
            DROP COLUMN IF EXISTS portal_link_created_at,
            DROP COLUMN IF EXISTS portal_link_expires_at,
            DROP COLUMN IF EXISTS portal_slug_enc,
            DROP COLUMN IF EXISTS portal_slug_hash;
    `);
};
