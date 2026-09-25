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
delete process.env.SMTP_HOST;
delete process.env.SMTP_USERNAME;
delete process.env.SMTP_PASSWORD;


// supertest serves each request from `app.listen(0)`, which binds every interface (IPv6 "::",
// dual-stack), but it always connects to 127.0.0.1. When another local program already holds that
// port number on 127.0.0.1 only (dev tools, local AI servers…), the request reaches that program
// instead and comes back as a stray empty 400/404 in long runs. Connecting over IPv6 loopback
// reaches the port the test server itself was given, and IPv4-only listeners cannot intercept it.
const Test = require('supertest/lib/test');
const https = require('https');
Test.prototype.serverAddress = function (app, path) {
    if (!app.address()) this._server = app.listen(0);
    const addr = app.address();
    const host = addr.family === 'IPv6' || addr.family === 6 ? '[::1]' : '127.0.0.1';
    return `${app instanceof https.Server ? 'https' : 'http'}://${host}:${addr.port}${path}`;
};
