/**
 * Switching organisation is a security-sensitive step:
 *   - the account password must be re-entered (verified on the server, no separate organisation password);
 *   - nothing about other organisations is shown before that;
 *   - the new session is resolved from scratch: no roles, permissions, branches or data of the old organisation carry over;
 *   - failures reveal nothing, and everything is audited.
 */
import request from 'supertest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import app from '../../src/index';
import { clearAllRateLimits } from '../../src/services/authUtils';
import { connectTestDb, resetTestDb, closeTestDb, sql } from '../helpers/testDb';
import { PASSWORD, PERIOD, World, assignBranchAdmin, assignRole, bearer, buildWorld, createRole, signIn } from '../helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
    // Greg: Admin of ABC's Geelong branch AND Admin of XYZ's Sydney branch (one account, two organisations).
    await assignBranchAdmin(w.xyz.id, w.xyz.sydney, w.users.greg.id);
});

const reauth = (token: string, password: unknown = PASSWORD) => request(app).post('/api/auth/reauthenticate').set(bearer(token)).send({ password });
const list = (token: string) => request(app).get('/api/auth/organisations').set(bearer(token));
const switchTo = (token: string, organisation_id: unknown) => request(app).post('/api/auth/switch-organisation').set(bearer(token)).send({ organisation_id });
const actions = async (orgId: string) => (await sql('SELECT action, actor_id, details FROM audit_logs WHERE org_id = $1 ORDER BY created_at', [orgId])).rows;

describe('the password is needed before anything is shown or done', () => {
    it('shows no organisation list, and refuses to switch, until the password was re-entered on this session', async () => {
        const shown = await list(w.tokens.greg);
        expect(shown.status).toBe(403);
        expect(shown.body.code).toBe('REAUTH_REQUIRED');
        expect(JSON.stringify(shown.body)).not.toMatch(/XYZ|ABC|Care|Health/);

        const attempt = await switchTo(w.tokens.greg, w.xyz.id);
        expect(attempt.status).toBe(403);
        expect(attempt.body.code).toBe('REAUTH_REQUIRED');
        // Nothing happened: same session, same organisation.
        const me = await request(app).get('/api/auth/me').set(bearer(w.tokens.greg));
        expect(me.body.data.organisation.id).toBe(w.abc.id);
    });

    it('/auth/me only says whether there is somewhere to switch to — never where', async () => {
        const greg = await request(app).get('/api/auth/me').set(bearer(w.tokens.greg));
        expect(greg.body.data.has_other_organisations).toBe(true);
        expect(JSON.stringify(greg.body)).not.toContain('XYZ Care');
        const sarah = await request(app).get('/api/auth/me').set(bearer(w.tokens.sarah));
        expect(sarah.body.data.has_other_organisations).toBe(false);
    });

    it('a wrong, empty or missing password is refused with one generic message and unlocks nothing', async () => {
        const responses = [await reauth(w.tokens.greg, 'WrongPassword1'), await reauth(w.tokens.greg, ''), await request(app).post('/api/auth/reauthenticate').set(bearer(w.tokens.greg)).send({}), await reauth(w.tokens.greg, { $ne: '' })];
        for (const res of responses) {
            expect(res.status).toBe(403);
            expect(res.body).toEqual({ success: false, error: { code: 'INVALID_PASSWORD', message: 'That password is not correct.' } });
        }
        expect((await list(w.tokens.greg)).status).toBe(403);
        expect((await switchTo(w.tokens.greg, w.xyz.id)).status).toBe(403);
    });

    it('the password is verified against the account, not against a token or another person', async () => {
        // Everyone else's password (the shared test password) proves nothing for Greg's session: it is Greg's account that is checked.
        const { hashPassword } = await import('../../src/services/auth');
        await sql('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword('GregOnly12345'), w.users.greg.id]);
        expect((await reauth(w.tokens.greg, PASSWORD)).status).toBe(403);
        expect((await reauth(w.tokens.greg, 'GregOnly12345')).status).toBe(200);
    });

    it('guessing is rate-limited per account: after five wrong passwords even the right one is refused for a while', async () => {
        for (let i = 0; i < 5; i++) expect((await reauth(w.tokens.greg, 'WrongPassword1')).status).toBe(403);
        expect((await reauth(w.tokens.greg, 'WrongPassword1')).status).toBe(429);
        expect((await reauth(w.tokens.greg, PASSWORD)).status).toBe(429);
        expect((await list(w.tokens.greg)).status).toBe(403);
    });

    it('one session’s password check does not unlock another session or another person', async () => {
        await reauth(w.tokens.greg);
        const otherSession = await signIn(w.users.greg.id, w.abc.id);
        expect((await list(otherSession)).status).toBe(403);
        expect((await list(w.tokens.sarah)).status).toBe(403);
        expect((await switchTo(w.tokens.sarah, w.xyz.id)).status).toBe(403);
    });

    it('the re-entry expires after five minutes', async () => {
        await reauth(w.tokens.greg);
        expect((await list(w.tokens.greg)).status).toBe(200);
        const { sid } = jwt.decode(w.tokens.greg) as any;
        await sql("UPDATE sessions SET reauthenticated_at = NOW() - INTERVAL '6 minutes' WHERE id = $1", [sid]);
        expect((await list(w.tokens.greg)).body.code).toBe('REAUTH_REQUIRED');
        expect((await switchTo(w.tokens.greg, w.xyz.id)).body.code).toBe('REAUTH_REQUIRED');
    });
});

describe('after the password: choosing and switching', () => {
    beforeEach(async () => { await reauth(w.tokens.greg); });

    it('lists only organisations this account can actually enter, with the roles held in each — and never a password or secret', async () => {
        const res = await list(w.tokens.greg);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([
            { id: w.abc.id, name: 'ABC Health', roles: ['Admin'], is_current: true },
            { id: w.xyz.id, name: 'XYZ Care', roles: ['Admin'], is_current: false },
        ]);
        expect(JSON.stringify(res.body)).not.toMatch(/password|token|slug|portal/i);
    });

    it('switches: a new session for the other organisation, the old one ended, and nothing from the old organisation carries over', async () => {
        const before = await request(app).get('/api/employees').set(bearer(w.tokens.greg));
        expect(before.body.data.map((e: any) => e.full_name)).toEqual(['Gee Worker']);

        const res = await switchTo(w.tokens.greg, w.xyz.id);
        expect(res.status).toBe(200);
        const newToken: string = res.body.data.token;
        expect(newToken).toBeTruthy();
        expect(newToken).not.toBe(w.tokens.greg);
        expect(res.body.data.organisation).toEqual({ id: w.xyz.id, name: 'XYZ Care' });

        // Organisation context: the new permissions, roles and branches are XYZ's alone.
        expect(res.body.data.roles.map((r: any) => r.name)).toEqual(['Admin']);
        expect(res.body.data.branches.map((b: any) => b.name)).toEqual(['Sydney']);
        expect(Object.values(res.body.data.scopes).every((s: any) => s.all === false && s.branch_ids.length === 1 && s.branch_ids[0] === w.xyz.sydney)).toBe(true);
        expect(JSON.stringify(res.body.data)).not.toMatch(/"name":"(Geelong|Melbourne|Richmond)"|ABC Health/);

        // The old session is dead; the new one only sees XYZ.
        expect((await request(app).get('/api/auth/me').set(bearer(w.tokens.greg))).status).toBe(401);
        const after = await request(app).get('/api/employees').set(bearer(newToken));
        expect(after.body.data.map((e: any) => e.full_name)).toEqual(['Syd Worker']);
        // ABC's branch and ABC's people are out of reach with the old branch id, the old worker id and the old organisation id.
        expect((await request(app).get(`/api/employees?location_id=${w.abc.geelong}`).set(bearer(newToken))).status).toBe(403);
        expect((await request(app).get(`/api/records?start_date=${PERIOD}&employee_id=${w.workers.gee}`).set(bearer(newToken)).set('x-organisation-id', w.abc.id)).status).toBe(404);
        expect((await request(app).get(`/api/employees?org_id=${w.abc.id}`).set(bearer(newToken))).body.data.map((e: any) => e.full_name)).toEqual(['Syd Worker']);
    });

    it('permissions are reloaded for the new organisation: different roles there mean different access', async () => {
        // In XYZ, Greg is a payroll-only person over the entire organisation instead of an Admin.
        await sql('DELETE FROM user_roles WHERE user_id = $1 AND org_id = $2', [w.users.greg.id, w.xyz.id]);
        await assignRole(w.xyz.id, w.users.greg.id, await createRole(w.xyz.id, 'Payroll Only', ['payroll.view', 'payroll.export']), 'all');
        const res = await switchTo(w.tokens.greg, w.xyz.id);
        expect(res.body.data.roles.map((r: any) => r.name)).toEqual(['Payroll Only']);
        expect([...res.body.data.permissions].sort()).toEqual(['payroll.export', 'payroll.view']);
        expect(res.body.data.scopes['payroll.view']).toEqual({ all: true, branch_ids: [] });
        const token = res.body.data.token;
        expect((await request(app).get('/api/employees').set(bearer(token))).status).toBe(403);
        expect((await request(app).get(`/api/reports/payroll?start_date=${PERIOD}`).set(bearer(token))).status).toBe(200);
        // And back again: switching needs the password again, and brings back ABC's Admin access only.
        expect((await list(token)).status).toBe(403);
        await reauth(token);
        const back = await switchTo(token, w.abc.id);
        expect(back.body.data.roles.map((r: any) => r.name)).toEqual(['Admin']);
        expect(back.body.data.scopes['payroll.view'].branch_ids).toEqual([w.abc.geelong]);
    });

    it('the re-entry is spent by the switch: the new session must enter the password again', async () => {
        const res = await switchTo(w.tokens.greg, w.xyz.id);
        expect((await list(res.body.data.token)).status).toBe(403);
    });

    it('refuses organisations this account has no access to, the current one, unknown ones and malformed ids — all the same way', async () => {
        const responses = [
            await switchTo(w.tokens.greg, crypto.randomUUID()),
            await switchTo(w.tokens.greg, w.abc.id),
            await switchTo(w.tokens.greg, 'not-a-uuid'),
            await switchTo(w.tokens.greg, undefined),
            await switchTo(w.tokens.greg, { id: w.xyz.id }),
            await switchTo(w.tokens.greg, [w.xyz.id]),
        ];
        for (const res of responses) {
            expect(res.status).toBe(403);
            expect(res.body.error).toEqual({ code: 'FORBIDDEN', message: 'You do not have access to that organisation.' });
        }
        // Still signed in to ABC, and the failed tries did not spend the re-entry.
        expect((await request(app).get('/api/auth/me').set(bearer(w.tokens.greg))).body.data.organisation.id).toBe(w.abc.id);
        expect((await switchTo(w.tokens.greg, w.xyz.id)).status).toBe(200);
    });

    it('cannot switch into an organisation whose only access has been withdrawn, or that is switched off', async () => {
        await sql('DELETE FROM user_roles WHERE user_id = $1 AND org_id = $2', [w.users.greg.id, w.xyz.id]);
        expect((await switchTo(w.tokens.greg, w.xyz.id)).status).toBe(403);
        expect((await list(w.tokens.greg)).body.data.map((o: any) => o.name)).toEqual(['ABC Health']);
    });

    it('an employee who is also a team member elsewhere switches like anyone else', async () => {
        await sql('UPDATE employees SET user_id = $1 WHERE id = $2', [w.users.greg.id, w.workers.syd]);
        await sql('DELETE FROM user_roles WHERE user_id = $1 AND org_id = $2', [w.users.greg.id, w.xyz.id]);
        const res = await switchTo(w.tokens.greg, w.xyz.id);
        expect(res.status).toBe(200);
        expect(res.body.data.roles.map((r: any) => r.name)).toEqual(['Employee']);
        expect(res.body.data.is_manager).toBe(false);
    });
});

describe('everything is audited, and nothing sensitive is written', () => {
    it('records failed and successful re-authentication and the switch in both organisations’ trails', async () => {
        await reauth(w.tokens.greg, 'WrongPassword1');
        await reauth(w.tokens.greg);
        await switchTo(w.tokens.greg, w.xyz.id);

        const abc = await actions(w.abc.id);
        expect(abc.map(a => a.action)).toEqual(expect.arrayContaining(['REAUTHENTICATION_FAILED', 'REAUTHENTICATION_SUCCEEDED', 'ORGANISATION_SWITCHED_AWAY']));
        const xyz = await actions(w.xyz.id);
        expect(xyz.map(a => a.action)).toEqual(expect.arrayContaining(['ORGANISATION_SWITCHED_IN', 'LOGIN_SUCCESS']));
        expect(abc.filter(a => a.action.startsWith('REAUTH') || a.action.startsWith('ORGANISATION_SWITCHED')).every(a => a.actor_id === w.users.greg.id)).toBe(true);
        // Neither trail names the other organisation, and no password appears anywhere.
        expect(JSON.stringify(abc)).not.toMatch(/XYZ/);
        expect(JSON.stringify(xyz)).not.toMatch(/ABC/);
        expect(JSON.stringify([...abc, ...xyz])).not.toContain(PASSWORD);
        expect(JSON.stringify([...abc, ...xyz])).not.toContain('WrongPassword1');
    });

    it('the 15-minute inactivity timeout still applies to a session that has re-authenticated', async () => {
        await reauth(w.tokens.greg);
        const { sid } = jwt.decode(w.tokens.greg) as any;
        await sql("UPDATE sessions SET last_active_at = NOW() - INTERVAL '16 minutes' WHERE id = $1", [sid]);
        const res = await list(w.tokens.greg);
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('SESSION_EXPIRED');
    });
});
