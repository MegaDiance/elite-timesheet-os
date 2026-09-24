/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Break controls, done properly.
 *
 * 1. `break_mins` (roster side, and on roster templates): an optional per-shift break length.
 *    NULL — every existing row — keeps today's behaviour exactly: the organisation's weekday /
 *    weekend break applies once the day reaches the break threshold. A number is an explicit break
 *    for that shift ("this shift has a 45 min unpaid break"), deducted regardless of the threshold.
 *
 * 2. `actual_has_break` / `actual_break_mins` (worked side): until now one `has_break` column was
 *    shared by a row's rostered AND worked halves, so unticking the break on what was actually
 *    worked was silently overwritten by the roster's value whenever the two were paired in one row.
 *    Each side now has its own. Backfilled from `has_break`, so every existing day computes exactly
 *    the same hours as before this migration.
 *
 * Additive only (expand step); nothing is dropped.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE shift_segments
            ADD COLUMN IF NOT EXISTS break_mins INTEGER,
            ADD COLUMN IF NOT EXISTS actual_has_break BOOLEAN,
            ADD COLUMN IF NOT EXISTS actual_break_mins INTEGER;
        UPDATE shift_segments SET actual_has_break = has_break WHERE actual_has_break IS NULL;
        ALTER TABLE shift_segments ALTER COLUMN actual_has_break SET DEFAULT true;
        ALTER TABLE shift_segments ALTER COLUMN actual_has_break SET NOT NULL;
        ALTER TABLE shift_segments ADD CONSTRAINT shift_segments_break_mins_range CHECK (break_mins IS NULL OR (break_mins BETWEEN 0 AND 240));
        ALTER TABLE shift_segments ADD CONSTRAINT shift_segments_actual_break_mins_range CHECK (actual_break_mins IS NULL OR (actual_break_mins BETWEEN 0 AND 240));

        ALTER TABLE roster_templates ADD COLUMN IF NOT EXISTS break_mins INTEGER;
        ALTER TABLE roster_templates ADD CONSTRAINT roster_templates_break_mins_range CHECK (break_mins IS NULL OR (break_mins BETWEEN 0 AND 240));
    `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE roster_templates DROP CONSTRAINT IF EXISTS roster_templates_break_mins_range;
        ALTER TABLE roster_templates DROP COLUMN IF EXISTS break_mins;
        ALTER TABLE shift_segments DROP CONSTRAINT IF EXISTS shift_segments_actual_break_mins_range;
        ALTER TABLE shift_segments DROP CONSTRAINT IF EXISTS shift_segments_break_mins_range;
        ALTER TABLE shift_segments DROP COLUMN IF EXISTS actual_break_mins;
        ALTER TABLE shift_segments DROP COLUMN IF EXISTS actual_has_break;
        ALTER TABLE shift_segments DROP COLUMN IF EXISTS break_mins;
    `);
};
