/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Binds a password-reset token to the organisation it was issued from (the portal the user asked
 * from, or the organisation whose Owner/Branch Admin generated the link). With the generic /login
 * page removed, this is how a completed reset sends the user back to the right organisation's
 * sign-in page. Nullable: tokens issued before this migration, or from a request with no portal
 * context, simply have none.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE reset_tokens ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE CASCADE;
    `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE reset_tokens DROP COLUMN IF EXISTS org_id;
    `);
};
