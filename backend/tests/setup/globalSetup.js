/**
 * Jest global setup: builds a fresh PostgreSQL database from the real production
 * migrations before every test run. Tests never use a hand-written schema, so the
 * schema under test is exactly the schema that ships.
 *
 * Requires the disposable test server from docker-compose.yml:
 *     docker compose up -d db-test
 * Override the server with TEST_DATABASE_URL (the database named in it is only used
 * as the maintenance connection; tests run in TEST_DATABASE_NAME).
 */
const { Client } = require('pg');
const { execFileSync } = require('child_process');
const path = require('path');
const { adminUrl, testDbName, testDbUrl, redact } = require('./testDbConfig');

module.exports = async () => {
    const admin = new Client({ connectionString: adminUrl() });
    try {
        await admin.connect();
    } catch (err) {
        throw new Error(
            `Cannot reach the test PostgreSQL server at ${redact(adminUrl())}.\n` +
            'Start it with:  docker compose up -d db-test\n' +
            `(${err.message})`
        );
    }
    try {
        await admin.query(`DROP DATABASE IF EXISTS ${testDbName()} WITH (FORCE)`);
        await admin.query(`CREATE DATABASE ${testDbName()}`);
    } finally {
        await admin.end();
    }

    const backendDir = path.join(__dirname, '..', '..');
    try {
        execFileSync(
            process.execPath,
            [require.resolve('node-pg-migrate/bin/node-pg-migrate'), 'up', '--no-check-order'],
            { cwd: backendDir, env: { ...process.env, DATABASE_URL: testDbUrl() }, stdio: 'pipe' }
        );
    } catch (err) {
        const out = `${err.stdout || ''}\n${err.stderr || ''}`;
        throw new Error(`Production migrations failed against the test database:\n${out.slice(-4000)}`);
    }
};
