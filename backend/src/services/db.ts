import { Pool, types } from 'pg';
import { newDb, DataType } from 'pg-mem';

// Parse PostgreSQL DATE type (OID 1082) as a raw 'YYYY-MM-DD' string to prevent UTC timezone drift
types.setTypeParser(1082, (val: string) => val);

let pool: any;

export async function initDB(dbUrl: string) {
    if (dbUrl === 'memory') {
        console.log('Using in-memory PostgreSQL mock (pg-mem) for development...');
        const db = newDb();
        db.public.registerFunction({
            name: 'gen_random_uuid',
            args: [],
            returns: DataType.uuid,
            implementation: () => '123e4567-e89b-12d3-a456-' + Math.floor(Math.random() * 1000000),
        });
        
        // Execute migrations
        db.public.none(`
            CREATE TABLE IF NOT EXISTS organisations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                slug TEXT UNIQUE,
                display_name TEXT,
                logo_url TEXT,
                is_public_searchable BOOLEAN DEFAULT true,
                break_mins_weekday NUMERIC DEFAULT 30,
                break_mins_weekend NUMERIC DEFAULT 0,
                break_threshold_hours NUMERIC DEFAULT 6,
                roster_lock_password_hash TEXT,
                timesheet_lock_password_hash TEXT,
                allow_employee_chat BOOLEAN DEFAULT true,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                role TEXT DEFAULT 'Employee',
                is_active BOOLEAN DEFAULT true,
                two_factor_enabled BOOLEAN DEFAULT false,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS organisation_members (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                organisation_id UUID NOT NULL,
                user_id UUID NOT NULL,
                role TEXT NOT NULL,
                UNIQUE(organisation_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS employees (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                full_name TEXT NOT NULL,
                department TEXT,
                email TEXT,
                phone TEXT,
                user_id UUID,
                contracted_hours NUMERIC DEFAULT 76,
                is_active BOOLEAN DEFAULT true,
                deleted_at TIMESTAMPTZ
            );

            CREATE TABLE IF NOT EXISTS fortnight_locks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                start_date TEXT NOT NULL,
                roster_locked BOOLEAN DEFAULT false,
                timesheet_locked BOOLEAN DEFAULT false,
                is_published BOOLEAN DEFAULT false,
                UNIQUE(org_id, start_date)
            );

            CREATE TABLE IF NOT EXISTS daily_records (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                employee_id UUID NOT NULL,
                record_date TEXT NOT NULL,
                has_actuals BOOLEAN DEFAULT false,
                UNIQUE(org_id, employee_id, record_date)
            );

            CREATE TABLE IF NOT EXISTS shift_segments (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                record_id UUID NOT NULL,
                segment_type TEXT NOT NULL,
                is_unplanned BOOLEAN DEFAULT false,
                roster_in TEXT,
                roster_out TEXT,
                roster_hours NUMERIC DEFAULT 0,
                actual_in TEXT,
                actual_out TEXT,
                actual_hours NUMERIC DEFAULT 0,
                actual_segment_type TEXT,
                notes TEXT
            );

            CREATE TABLE IF NOT EXISTS roster_templates (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                employee_id UUID NOT NULL,
                day_index INTEGER NOT NULL,
                segment_type TEXT NOT NULL,
                roster_in TEXT,
                roster_out TEXT,
                roster_hours NUMERIC DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT NOW(),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                actor_id UUID,
                action TEXT NOT NULL,
                entity_type TEXT,
                entity_id UUID,
                details TEXT,
                snapshot TEXT
            );

            CREATE TABLE IF NOT EXISTS invitation_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id UUID NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL
            );

            CREATE TABLE IF NOT EXISTS org_invitation_tokens (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                email TEXT NOT NULL,
                token TEXT UNIQUE NOT NULL,
                delivery_status TEXT DEFAULT 'pending',
                last_error TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                used BOOLEAN DEFAULT false
            );

            CREATE TABLE IF NOT EXISTS reset_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id UUID NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL
            );

            CREATE TABLE IF NOT EXISTS two_factor_codes (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                code_hash TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                attempts INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS public_holidays (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                holiday_date TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(org_id, holiday_date)
            );

            CREATE TABLE IF NOT EXISTS timesheet_submissions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                employee_id UUID NOT NULL,
                start_date TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Draft',
                submitted_at TIMESTAMPTZ,
                reviewed_by UUID,
                reviewed_at TIMESTAMPTZ,
                rejection_reason TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(org_id, employee_id, start_date)
            );

            CREATE TABLE IF NOT EXISTS leave_requests (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                employee_id UUID NOT NULL,
                leave_type TEXT NOT NULL,
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                hours NUMERIC NOT NULL,
                reason TEXT,
                status TEXT NOT NULL DEFAULT 'Pending',
                reviewed_by UUID,
                reviewed_at TIMESTAMPTZ,
                rejection_reason TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS xero_connections (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL UNIQUE,
                tenant_id TEXT,
                tenant_name TEXT,
                access_token TEXT,
                refresh_token TEXT,
                expires_at TIMESTAMPTZ,
                connected_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS organisation_announcements (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                author_id UUID,
                author_name TEXT NOT NULL,
                author_role TEXT,
                title TEXT,
                content TEXT NOT NULL,
                is_system BOOLEAN DEFAULT false,
                announcement_type TEXT DEFAULT 'general',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS announcement_reactions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                announcement_id UUID NOT NULL,
                org_id UUID NOT NULL,
                user_id UUID NOT NULL,
                user_name TEXT NOT NULL,
                emoji TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(announcement_id, user_id, emoji)
            );

            CREATE TABLE IF NOT EXISTS announcement_replies (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                announcement_id UUID NOT NULL,
                org_id UUID NOT NULL,
                author_id UUID NOT NULL,
                author_name TEXT NOT NULL,
                author_role TEXT,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // Seed initial admin & organisation
        const { hashPassword } = await import('./auth');
        const hash = await hashPassword('password123');
        const orgId = '123e4567-e89b-12d3-a456-222222222222';
        const platformUserId = '123e4567-e89b-12d3-a456-111111111111';
        const companyAdminUserId = '123e4567-e89b-12d3-a456-333333333333';

        // Platform Admin Account
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${platformUserId}', '${orgId}', 'admin@elite.local', '${hash}', 'Platform Admin')`);
        
        // Company Admin Account for Apex Logistics
        db.public.none(`INSERT INTO users (id, org_id, email, password_hash, role) VALUES ('${companyAdminUserId}', '${orgId}', 'admin@apexlogistics.com', '${hash}', 'Company Admin')`);
        
        db.public.none(`INSERT INTO organisations (id, name, slug, display_name) VALUES ('${orgId}', 'Apex Logistics Solutions', 'apex-logistics', 'Apex Logistics Solutions')`);
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('123e4567-e89b-12d3-a456-444444444444', '${orgId}', '${platformUserId}', 'Platform Admin')`);
        db.public.none(`INSERT INTO organisation_members (id, organisation_id, user_id, role) VALUES ('123e4567-e89b-12d3-a456-555555555555', '${orgId}', '${companyAdminUserId}', 'Company Admin')`);

        const PgPool = db.adapters.createPg().Pool;
        pool = new PgPool();

        // Restore persisted db snapshot if available in development (disabled in test)
        const fs = await import('fs');
        const path = await import('path');
        const dbDumpFile = path.join(__dirname, '../../.db_snapshot.json');

        if (process.env.NODE_ENV !== 'test' && fs.existsSync(dbDumpFile)) {
            try {
                const snapshotData = JSON.parse(fs.readFileSync(dbDumpFile, 'utf8'));
                if (snapshotData.tables) {
                    for (const [table, rows] of Object.entries(snapshotData.tables as Record<string, any[]>)) {
                        if (rows && rows.length > 0) {
                            for (const row of rows) {
                                const keys = Object.keys(row);
                                const values = Object.values(row).map(v => {
                                    if (v === null) return 'NULL';
                                    if (typeof v === 'boolean' || typeof v === 'number') return v;
                                    return `'${String(v).replace(/'/g, "''")}'`;
                                });
                                db.public.none(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${values.join(',')}) ON CONFLICT DO NOTHING`);
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn('Failed to restore db snapshot:', err);
            }
        }

        // Schedule periodic snapshot dumps to disk in development (disabled in test)
        if (process.env.NODE_ENV !== 'test') {
            const saveSnapshot = () => {
                try {
                    const tables = [
                        'organisations', 'users', 'organisation_members', 'employees',
                        'fortnight_locks', 'daily_records', 'shift_segments', 'roster_templates',
                        'audit_logs', 'invitation_tokens', 'org_invitation_tokens', 'reset_tokens',
                        'two_factor_codes', 'public_holidays', 'timesheet_submissions', 'leave_requests', 'xero_connections',
                        'organisation_announcements', 'announcement_reactions', 'announcement_replies'
                    ];
                    const dump: Record<string, any[]> = {};
                    for (const t of tables) {
                        dump[t] = db.public.many(`SELECT * FROM ${t}`);
                    }
                    fs.writeFileSync(dbDumpFile, JSON.stringify({ timestamp: new Date().toISOString(), tables: dump }, null, 2));
                } catch (err) {
                    // Ignore silent dump errors
                }
            };

            const dumpInterval = setInterval(saveSnapshot, 2000);
            process.on('beforeExit', saveSnapshot);
            process.on('SIGINT', () => { clearInterval(dumpInterval); saveSnapshot(); process.exit(0); });
            process.on('SIGTERM', () => { clearInterval(dumpInterval); saveSnapshot(); process.exit(0); });
        }
    } else {
        const isSslDisabled = process.env.DB_SSL === 'false';
        pool = new Pool({
            connectionString: dbUrl,
            ssl: isSslDisabled ? false : { rejectUnauthorized: false },
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
        });
    }
}

export function setPool(mockPool: any) {
    pool = mockPool;
}

export function query(text: string, params?: any[]) {
    return pool.query(text, params);
}

export async function seedOrgDefaults(_orgId: string) {
    // Left clean without automatic fake employees
}

export async function getClient() {
    return pool.connect();
}
