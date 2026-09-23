/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Revives leave_requests (dropped, archived, in 1789367660601_drop_legacy_roles.js), gated by the
 * new organisations.leave_requests_require_approval setting. Adjusted from the old shape:
 *
 *   - leave_type is now constrained to the same vocabulary as shift_segments (SEGMENT_TYPES minus
 *     WORK), so an approved request always maps onto a valid segment type.
 *   - status is constrained to Pending / Approved / Rejected (the old code used these three
 *     values ad hoc with no CHECK).
 *   - start_time / end_time (nullable) distinguish a whole-day request (both null — the old
 *     shape) from a partial-day request (both set, start_date = end_date), which is needed to
 *     drive the leave/roster auto-merge engine.
 *   - location_id is denormalised from the worker's branch at insert time, matching the
 *     composite-FK pattern already used by fortnight_locks/branch_admins, so branch-scoped
 *     review queries don't need a join.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
    pgm.sql(`
        CREATE TABLE leave_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            location_id UUID NOT NULL,
            leave_type TEXT NOT NULL CHECK (leave_type IN ('Sick', 'Annual', 'TIL', 'LWIP', 'Other')),
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            start_time TIME,
            end_time TIME,
            hours NUMERIC,
            reason TEXT,
            status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
            reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at TIMESTAMPTZ,
            rejection_reason TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK (end_date >= start_date),
            CHECK ((start_time IS NULL) = (end_time IS NULL)),
            CHECK (start_time IS NULL OR start_date = end_date),
            FOREIGN KEY (org_id, location_id) REFERENCES locations(org_id, id) ON DELETE CASCADE
        );
        CREATE INDEX idx_leave_requests_employee ON leave_requests(employee_id, start_date DESC);
        CREATE INDEX idx_leave_requests_org_location ON leave_requests(org_id, location_id, status);
    `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS leave_requests;`);
};
