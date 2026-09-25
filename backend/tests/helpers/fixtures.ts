/**
 * Shared fixture world for integration tests (real PostgreSQL, real server sessions).
 *
 *   ABC Health (owner: Olivia)
 *     Melbourne  — Branch Admin: Sarah          — worker: Mel Worker
 *     Richmond   — Branch Admin: Sarah          — worker: Rich Worker
 *     Geelong    — Branch Admin: Greg           — worker: Gee Worker
 *   XYZ Care (owner: Xavier)
 *     Sydney     —                              — worker: Syd Worker
 */
import crypto from 'crypto';
import { hashPassword, generateToken } from '../../src/services/auth';
import { createSession } from '../../src/services/sessionService';
import { issuePortalLink } from '../../src/services/portalLink';
import { sql } from './testDb';

export const PASSWORD = 'Password123';
/** First day of a pay period (fortnights are anchored on Sunday 2026-03-29). */
export const PERIOD = '2026-03-29';

let cachedHash: Promise<string> | null = null;
const passwordHash = () => (cachedHash ||= hashPassword(PASSWORD));

const CLIENT = { ip: '127.0.0.1', userAgent: 'jest', approxLocation: 'Melbourne, Victoria, Australia', deviceInfo: 'Jest on Node' };

export async function createUser(email: string, fullName?: string): Promise<{ id: string; email: string }> {
    const res = await sql(
        'INSERT INTO users (email, password_hash, full_name, is_active) VALUES ($1, $2, $3, true) RETURNING id, email',
        [email, await passwordHash(), fullName || null]
    );
    return res.rows[0];
}

/** `portalSlug` is the organisation's private sign-in link token, issued the same way production does. */
export async function createOrganisation(name: string, ownerId: string): Promise<{ id: string; portalSlug: string }> {
    const res = await sql(
        'INSERT INTO organisations (name, owner_user_id, is_active) VALUES ($1, $2, true) RETURNING id',
        [name, ownerId]
    );
    const link = await issuePortalLink(res.rows[0].id);
    return { id: res.rows[0].id, portalSlug: link.token };
}

export async function createBranch(orgId: string, name: string): Promise<string> {
    const res = await sql('INSERT INTO locations (org_id, name) VALUES ($1, $2) RETURNING id', [orgId, name]);
    return res.rows[0].id;
}

export async function assignBranchAdmin(orgId: string, branchId: string, userId: string): Promise<void> {
    await sql('INSERT INTO branch_admins (org_id, location_id, user_id) VALUES ($1, $2, $3)', [orgId, branchId, userId]);
}

export async function createWorker(orgId: string, branchId: string, fullName: string): Promise<string> {
    const res = await sql(
        'INSERT INTO employees (org_id, location_id, full_name, contracted_hours) VALUES ($1, $2, $3, 76) RETURNING id',
        [orgId, branchId, fullName]
    );
    return res.rows[0].id;
}

/**
 * Links a worker record to a login, exactly as accepting an employee invitation would — used
 * directly by fixtures rather than through the invitation/accept HTTP flow, which is what those
 * routes' own tests exercise.
 */
export async function linkEmployeeLogin(employeeId: string, userId: string): Promise<void> {
    await sql('UPDATE employees SET user_id = $1 WHERE id = $2', [userId, employeeId]);
}

/** A real server session + token, exactly as a successful login produces. */
export async function signIn(userId: string, orgId: string): Promise<string> {
    const session = await createSession(userId, orgId, CLIENT);
    return generateToken({ sub: userId, sid: session.sessionId });
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface World {
    abc: { id: string; portalSlug: string; melbourne: string; richmond: string; geelong: string };
    xyz: { id: string; portalSlug: string; sydney: string };
    users: {
        owner: { id: string; email: string }; sarah: { id: string; email: string }; greg: { id: string; email: string }; xavier: { id: string; email: string };
        melEmployee: { id: string; email: string }; richEmployee: { id: string; email: string };
    };
    workers: { mel: string; rich: string; gee: string; syd: string };
    tokens: { owner: string; sarah: string; greg: string; xavier: string; melEmployee: string; richEmployee: string };
}

export async function buildWorld(): Promise<World> {
    const owner = await createUser('olivia@abc.test', 'Olivia Owner');
    const sarah = await createUser('sarah@abc.test', 'Sarah Admin');
    const greg = await createUser('greg@abc.test', 'Greg Admin');
    const xavier = await createUser('xavier@xyz.test', 'Xavier Owner');

    const abcOrg = await createOrganisation('ABC Health', owner.id);
    const melbourne = await createBranch(abcOrg.id, 'Melbourne');
    const richmond = await createBranch(abcOrg.id, 'Richmond');
    const geelong = await createBranch(abcOrg.id, 'Geelong');
    await assignBranchAdmin(abcOrg.id, melbourne, sarah.id);
    await assignBranchAdmin(abcOrg.id, richmond, sarah.id);
    await assignBranchAdmin(abcOrg.id, geelong, greg.id);

    const xyzOrg = await createOrganisation('XYZ Care', xavier.id);
    const sydney = await createBranch(xyzOrg.id, 'Sydney');

    const workers = {
        mel: await createWorker(abcOrg.id, melbourne, 'Mel Worker'),
        rich: await createWorker(abcOrg.id, richmond, 'Rich Worker'),
        gee: await createWorker(abcOrg.id, geelong, 'Gee Worker'),
        syd: await createWorker(xyzOrg.id, sydney, 'Syd Worker'),
    };

    const melEmployee = await createUser('mel.worker@abc.test', 'Mel Worker');
    const richEmployee = await createUser('rich.worker@abc.test', 'Rich Worker');
    await linkEmployeeLogin(workers.mel, melEmployee.id);
    await linkEmployeeLogin(workers.rich, richEmployee.id);

    return {
        abc: { id: abcOrg.id, portalSlug: abcOrg.portalSlug, melbourne, richmond, geelong },
        xyz: { id: xyzOrg.id, portalSlug: xyzOrg.portalSlug, sydney },
        users: { owner, sarah, greg, xavier, melEmployee, richEmployee },
        workers,
        tokens: {
            owner: await signIn(owner.id, abcOrg.id),
            sarah: await signIn(sarah.id, abcOrg.id),
            greg: await signIn(greg.id, abcOrg.id),
            xavier: await signIn(xavier.id, xyzOrg.id),
            melEmployee: await signIn(melEmployee.id, abcOrg.id),
            richEmployee: await signIn(richEmployee.id, abcOrg.id),
        },
    };
}

/** One time entry of a day: start → finish of a type (Normal Work = WORK, or a leave type). */
export const entry = (start: string | null, finish: string | null, type = 'WORK', hours?: number) =>
    ({ type, start, finish, ...(hours !== undefined ? { hours } : {}) });

/** A plain day: rostered 09:00–17:00 and, optionally, worked the same. Spread into a POST /records body. */
export const simpleDay = (worked = false) => ({
    roster: [entry('09:00', '17:00')],
    timesheet: worked ? [entry('09:00', '17:00')] : [],
});
