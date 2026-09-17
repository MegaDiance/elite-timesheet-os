const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const util = require('util');

const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'), (err) => {
    if (err) console.error('DB Connection Error:', err.message);
});

// Wrap queries in promises
db.runAsync = util.promisify(db.run.bind(db));
db.allAsync = util.promisify(db.all.bind(db));
db.getAsync = util.promisify(db.get.bind(db));

async function initializeSchema() {
    await db.runAsync('PRAGMA foreign_keys = ON');
    await db.runAsync('PRAGMA journal_mode = WAL;');

    await db.runAsync(`
        CREATE TABLE IF NOT EXISTS organizations (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL
        )
    `);

    await db.runAsync(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL REFERENCES organizations(id),
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('Admin', 'Company Admin', 'Platform Admin', 'Manager', 'Employee', 'Viewer'))
        )
    `);

    await db.runAsync(`
        CREATE TABLE IF NOT EXISTS employees (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL REFERENCES organizations(id),
            full_name TEXT NOT NULL,
            department TEXT,
            email TEXT,
            phone TEXT,
            user_id TEXT REFERENCES users(id),
            contracted_hours REAL DEFAULT 76,
            is_active INTEGER DEFAULT 1,
            UNIQUE(org_id, full_name)
        )
    `);

    await db.runAsync(`
        CREATE TABLE IF NOT EXISTS fortnight_locks (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL REFERENCES organizations(id),
            start_date TEXT NOT NULL,
            roster_locked INTEGER DEFAULT 0,
            timesheet_locked INTEGER DEFAULT 0,
            UNIQUE(org_id, start_date)
        )
    `);

    await db.runAsync(`
        CREATE TABLE IF NOT EXISTS daily_records (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL REFERENCES organizations(id),
            employee_id TEXT NOT NULL REFERENCES employees(id),
            record_date TEXT NOT NULL,
            has_actuals INTEGER DEFAULT 0,
            UNIQUE(org_id, employee_id, record_date)
        )
    `);

    await db.runAsync(`
        CREATE TABLE IF NOT EXISTS shift_segments (
            id TEXT PRIMARY KEY,
            record_id TEXT NOT NULL REFERENCES daily_records(id) ON DELETE CASCADE,
            segment_type TEXT NOT NULL,
            is_unplanned INTEGER DEFAULT 0,
            roster_in TEXT,
            roster_out TEXT,
            roster_hours REAL DEFAULT 0,
            actual_in TEXT,
            actual_out TEXT,
            actual_hours REAL DEFAULT 0
        )
    `);

    await db.runAsync(`
        CREATE TABLE IF NOT EXISTS roster_templates (
            id TEXT PRIMARY KEY,
            employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            day_index INTEGER NOT NULL CHECK(day_index >= 0 AND day_index <= 13),
            is_off INTEGER DEFAULT 0,
            roster_in TEXT,
            roster_out TEXT,
            UNIQUE(employee_id, day_index)
        )
    `);

    await db.runAsync(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL REFERENCES organizations(id),
            timestamp TEXT NOT NULL,
            actor_id TEXT REFERENCES users(id),
            action TEXT NOT NULL,
            entity_id TEXT,
            details TEXT,
            snapshot TEXT
        )
    `);

    await db.runAsync(`
        CREATE TABLE IF NOT EXISTS invitation_tokens (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL
        )
    `);

    await db.runAsync(`
        CREATE TABLE IF NOT EXISTS reset_tokens (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL
        )
    `);

    try {
        await db.runAsync('ALTER TABLE employees ADD COLUMN user_id TEXT');
    } catch(e) { /* column already exists */ }
    
    try {
        await db.runAsync('ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1');
    } catch(e) { /* column already exists */ }

    console.log('Database schema initialized.');
}

module.exports = { db, initializeSchema };
