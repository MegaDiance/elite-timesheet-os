const DEFAULT_ADMIN_URL = 'postgres://simplehours_test:simplehours_test@localhost:55432/simplehours_test';

function adminUrl() {
    return process.env.TEST_DATABASE_URL || DEFAULT_ADMIN_URL;
}

function testDbName() {
    const name = process.env.TEST_DATABASE_NAME || 'simplehours_jest';
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('TEST_DATABASE_NAME must be a plain lowercase identifier');
    return name;
}

function urlForDatabase(dbName) {
    const url = new URL(adminUrl());
    url.pathname = `/${dbName}`;
    return url.toString();
}

function testDbUrl() {
    return urlForDatabase(testDbName());
}

function redact(url) {
    try {
        const u = new URL(url);
        if (u.password) u.password = '***';
        return u.toString();
    } catch {
        return '<invalid url>';
    }
}

module.exports = { adminUrl, testDbName, testDbUrl, urlForDatabase, redact };
