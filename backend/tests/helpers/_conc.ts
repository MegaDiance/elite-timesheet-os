import request from 'supertest';
import { connectTestDb, closeTestDb, sql } from './testDb';
import { buildWorld, bearer } from './fixtures';
(async () => {
    await connectTestDb();
    const app = (await import('../../src/index')).default;
    const w = await buildWorld();
    const login = () => request(app).post('/api/auth/login').send({ email: w.users.sarah.email, password: 'Wrong12345', organisation_slug: w.abc.portalSlug });
    const res = await Promise.all(Array.from({ length: 40 }, login));
    const tally = res.reduce((m: any, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {});
    const checked = (await sql("SELECT COUNT(*)::int n FROM login_history WHERE email = $1 AND status = 'FAILED'", [w.users.sarah.email])).rows[0].n;
    console.log('LOGIN 40 parallel wrong passwords for one account:', JSON.stringify(tally), '| password checks actually run:', checked, '(limit is 5)');
    const off = () => request(app).post('/api/auth/2fa/disable').set(bearer(w.tokens.greg)).send({ password: 'Wrong12345' });
    const r2 = await Promise.all(Array.from({ length: 40 }, off));
    console.log('2FA-DISABLE 40 parallel wrong passwords:', JSON.stringify(r2.reduce((m: any, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {})), '(401 = password actually checked; limit is 5)');
    await closeTestDb(); process.exit(0);
})();
