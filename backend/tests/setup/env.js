/**
 * Runs in every test file before any module is imported.
 * Points the app at the migrated test database and forces the mock email transport.
 */
const { testDbUrl } = require('./testDbConfig');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDbUrl();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret-not-for-production';
process.env.EMAIL_PROVIDER = 'mock';
delete process.env.RESEND_API_KEY;
delete process.env.POSTMARK_SERVER_TOKEN;
