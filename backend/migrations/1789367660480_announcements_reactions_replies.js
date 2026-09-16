/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
    pgm.sql(`
        -- 1. Organisation chat permissions
        ALTER TABLE organisations
            ADD COLUMN IF NOT EXISTS allow_employee_chat BOOLEAN DEFAULT true;

        -- 2. Announcement reactions (emojis)
        CREATE TABLE IF NOT EXISTS announcement_reactions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            announcement_id UUID NOT NULL REFERENCES organisation_announcements(id) ON DELETE CASCADE,
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_name TEXT NOT NULL,
            emoji TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(announcement_id, user_id, emoji)
        );

        -- 3. Announcement replies (threaded comments)
        CREATE TABLE IF NOT EXISTS announcement_replies (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            announcement_id UUID NOT NULL REFERENCES organisation_announcements(id) ON DELETE CASCADE,
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            author_name TEXT NOT NULL,
            author_role TEXT,
            content TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
    pgm.sql(`
        DROP TABLE IF EXISTS announcement_replies;
        DROP TABLE IF EXISTS announcement_reactions;
        ALTER TABLE organisations DROP COLUMN IF EXISTS allow_employee_chat;
    `);
};
