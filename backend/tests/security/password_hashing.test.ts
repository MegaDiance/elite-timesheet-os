/**
 * Passwords are hashed with Argon2id. Older bcrypt hashes still verify and are upgraded at the
 * next successful sign-in, never on a failed one.
 */
import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../../src/index';
import { clearAllRateLimits } from '../../src/services/authUtils';
import { comparePassword, hashPassword, needsRehash } from '../../src/services/auth';
import { connectTestDb, resetTestDb, closeTestDb, sql } from '../helpers/testDb';
import { PASSWORD, World, buildWorld } from '../helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

const hashOf = async (userId: string) => (await sql('SELECT password_hash FROM users WHERE id = $1', [userId])).rows[0].password_hash as string;
const login = (password: string) => request(app).post('/api/auth/login').send({ email: w.users.sarah.email, password, organisation_slug: w.abc.portalSlug });

it('new hashes are Argon2id at the recommended settings, salted, and never contain the password', async () => {
    const a = await hashPassword('Correct-Horse-1');
    const b = await hashPassword('Correct-Horse-1');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('Correct-Horse-1');
    expect(await comparePassword('Correct-Horse-1', a)).toBe(true);
    expect(await comparePassword('correct-horse-1', a)).toBe(false);
    expect(needsRehash(a)).toBe(false);
});

it('a malformed or empty stored hash never matches', async () => {
    for (const bad of ['', 'not-a-hash', '$argon2id$garbage', '$2b$10$short']) {
        expect(await comparePassword(PASSWORD, bad)).toBe(false);
    }
});

it('an older bcrypt hash still signs in, and is replaced with Argon2id', async () => {
    const legacy = await bcrypt.hash(PASSWORD, 10);
    await sql('UPDATE users SET password_hash = $1 WHERE id = $2', [legacy, w.users.sarah.id]);
    expect(needsRehash(legacy)).toBe(true);

    expect((await login(PASSWORD)).status).toBe(200);
    const upgraded = await hashOf(w.users.sarah.id);
    expect(upgraded).toMatch(/^\$argon2id\$/);
    expect(await comparePassword(PASSWORD, upgraded)).toBe(true);
    // And it still works afterwards.
    clearAllRateLimits();
    expect((await login(PASSWORD)).status).toBe(200);
});

it('a wrong password never touches the stored hash', async () => {
    const legacy = await bcrypt.hash(PASSWORD, 10);
    await sql('UPDATE users SET password_hash = $1 WHERE id = $2', [legacy, w.users.sarah.id]);
    expect((await login('Wrong12345')).status).toBe(401);
    expect(await hashOf(w.users.sarah.id)).toBe(legacy);
});
