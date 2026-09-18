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
        -- 1. Active User Sessions Table (enforces 15-min inactivity and server-side revocation)
        CREATE TABLE IF NOT EXISTS sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            org_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            ip_address TEXT,
            approx_location TEXT,
            user_agent TEXT,
            device_info TEXT,
            last_active_at TIMESTAMPTZ DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
        CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active, last_active_at);

        -- 2. Audit-Grade Login History Table
        CREATE TABLE IF NOT EXISTS login_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            org_id UUID REFERENCES organisations(id) ON DELETE SET NULL,
            email TEXT NOT NULL,
            status TEXT NOT NULL,
            ip_address TEXT,
            approx_location TEXT,
            user_agent TEXT,
            device_info TEXT,
            auth_method TEXT,
            session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON login_history(user_id);
        CREATE INDEX IF NOT EXISTS idx_login_history_email ON login_history(email);
        CREATE INDEX IF NOT EXISTS idx_login_history_created_at ON login_history(created_at DESC);

        -- 3. Suspicious Login Verification Challenges Table
        CREATE TABLE IF NOT EXISTS login_verification_challenges (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            org_id UUID REFERENCES organisations(id) ON DELETE SET NULL,
            role TEXT,
            token_hash TEXT NOT NULL UNIQUE,
            verification_code TEXT,
            ip_address TEXT,
            approx_location TEXT,
            user_agent TEXT,
            device_info TEXT,
            expires_at TIMESTAMPTZ NOT NULL,
            consumed BOOLEAN DEFAULT false,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_login_challenges_token_hash ON login_verification_challenges(token_hash);
        CREATE INDEX IF NOT EXISTS idx_login_challenges_user ON login_verification_challenges(user_id, consumed);
    `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
    pgm.sql(`
        DROP TABLE IF EXISTS login_verification_challenges;
        DROP TABLE IF EXISTS login_history;
        DROP TABLE IF EXISTS sessions;
    `);
};
