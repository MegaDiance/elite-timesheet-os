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
        CREATE EXTENSION IF NOT EXISTS "pgcrypto";

        CREATE TABLE organisations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            role TEXT,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE organisation_members (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('Platform Admin', 'Company Admin', 'Manager', 'Employee')),
            UNIQUE(organisation_id, user_id)
        );

        CREATE TABLE invitation_tokens (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            token_hash TEXT UNIQUE NOT NULL,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE org_invitation_tokens (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email TEXT NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            used BOOLEAN DEFAULT false
        );
        
        CREATE TABLE reset_tokens (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            token_hash TEXT UNIQUE NOT NULL,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE employees (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            full_name TEXT NOT NULL,
            department TEXT,
            email TEXT,
            phone TEXT,
            contracted_hours NUMERIC DEFAULT 76.0,
            is_active BOOLEAN DEFAULT true,
            deleted_at TIMESTAMPTZ,
            UNIQUE(org_id, full_name)
        );

        CREATE TABLE roster_templates (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            day_index INTEGER NOT NULL CHECK (day_index >= 0 AND day_index <= 13),
            segment_type TEXT NOT NULL,
            roster_in TIME,
            roster_out TIME,
            roster_hours NUMERIC DEFAULT 0
        );

        CREATE TABLE daily_records (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            record_date DATE NOT NULL,
            has_actuals BOOLEAN DEFAULT false,
            UNIQUE(org_id, employee_id, record_date)
        );

        CREATE TABLE shift_segments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            record_id UUID NOT NULL REFERENCES daily_records(id) ON DELETE CASCADE,
            segment_type TEXT NOT NULL,
            is_unplanned BOOLEAN DEFAULT false,
            roster_in TIME,
            roster_out TIME,
            roster_hours NUMERIC DEFAULT 0,
            actual_in TIME,
            actual_out TIME,
            actual_hours NUMERIC DEFAULT 0,
            actual_segment_type TEXT,
            notes TEXT
        );

        CREATE TABLE fortnight_locks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            start_date DATE NOT NULL,
            roster_locked BOOLEAN DEFAULT false,
            timesheet_locked BOOLEAN DEFAULT false,
            UNIQUE(org_id, start_date)
        );

        CREATE TABLE audit_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
            actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
            action TEXT NOT NULL,
            entity_type TEXT,
            entity_id UUID,
            details JSONB,
            timestamp TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE public_holidays (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            holiday_date DATE NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(org_id, holiday_date)
        );

        CREATE TABLE timesheet_submissions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            start_date DATE NOT NULL,
            status TEXT NOT NULL DEFAULT 'Draft',
            submitted_at TIMESTAMPTZ,
            reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at TIMESTAMPTZ,
            rejection_reason TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(org_id, employee_id, start_date)
        );

        CREATE TABLE leave_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            leave_type TEXT NOT NULL,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            hours NUMERIC NOT NULL,
            reason TEXT,
            status TEXT NOT NULL DEFAULT 'Pending',
            reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at TIMESTAMPTZ,
            rejection_reason TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE xero_connections (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE UNIQUE,
            tenant_id TEXT,
            tenant_name TEXT,
            access_token TEXT,
            refresh_token TEXT,
            expires_at TIMESTAMPTZ,
            connected_at TIMESTAMPTZ DEFAULT NOW()
        );
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        DROP TABLE IF EXISTS xero_connections;
        DROP TABLE IF EXISTS leave_requests;
        DROP TABLE IF EXISTS timesheet_submissions;
        DROP TABLE IF EXISTS public_holidays;
        DROP TABLE audit_logs;
        DROP TABLE fortnight_locks;
        DROP TABLE shift_segments;
        DROP TABLE daily_records;
        DROP TABLE roster_templates;
        DROP TABLE employees;
        DROP TABLE reset_tokens;
        DROP TABLE invitation_tokens;
        DROP TABLE organisation_members;
        DROP TABLE users;
        DROP TABLE organisations;
    `);
};
