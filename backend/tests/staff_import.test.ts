/**
 * Staff import: POST /api/staff-import/validate, POST /api/staff-import, GET /api/staff-import/jobs/:id.
 * Validation never writes; an import is all or nothing; branches are checked against the caller's
 * own scope; large files run in the background.
 */
import request from 'supertest';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { BACKGROUND_THRESHOLD } from '../src/services/staffImport';
import { connectTestDb, resetTestDb, closeTestDb, sql } from './helpers/testDb';
import { World, bearer, buildWorld, createUser, createRole, assignRole, signIn } from './helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

type Row = Partial<Record<'full_name' | 'branch' | 'department' | 'email' | 'phone' | 'contracted_hours' | 'employee_code', unknown>> & { row?: number };
const person = (over: Row = {}): Row => ({ full_name: 'Alex Smith', branch: 'Melbourne', department: '', email: '', phone: '', contracted_hours: '', employee_code: '', ...over });
const validate = (token: string, rows: unknown) => request(app).post('/api/staff-import/validate').set(bearer(token)).send({ rows });
const doImport = (token: string, rows: unknown) => request(app).post('/api/staff-import').set(bearer(token)).send({ rows });
const count = async () => (await sql('SELECT COUNT(*)::int AS n FROM employees WHERE org_id = $1', [w.abc.id])).rows[0].n;

describe('validating a file', () => {
    it('reports each row with its problems and writes nothing', async () => {
        const before = await count();
        const res = await validate(w.tokens.owner, [
            person({ row: 2, full_name: 'Alex Smith', email: 'ALEX@example.com', phone: '0400 000 000', contracted_hours: '38', employee_code: 'A-001' }),
            person({ row: 3, full_name: '' }),
            person({ row: 4, full_name: 'Bad Email', email: 'not-an-email' }),
            person({ row: 5, full_name: 'Bad Phone', phone: 'call me' }),
            person({ row: 6, full_name: 'Too Many Hours', contracted_hours: '400' }),
            person({ row: 7, full_name: 'Nowhere', branch: 'Atlantis' }),
            person({ row: 8, full_name: 'Bad Code', employee_code: '!!' }),
        ]);
        expect(res.status).toBe(200);
        expect(res.body.data.valid).toBe(1);
        expect(res.body.data.invalid).toBe(6);
        const byRow = Object.fromEntries(res.body.data.rows.map((r: any) => [r.row, r.errors.map((e: any) => e.field)]));
        expect(byRow).toEqual({ 2: [], 3: ['full_name'], 4: ['email'], 5: ['phone'], 6: ['contracted_hours'], 7: ['branch'], 8: ['employee_code'] });
        expect(res.body.data.rows[0].value).toMatchObject({ full_name: 'Alex Smith', branch_name: 'Melbourne', email: 'alex@example.com', contracted_hours: 38, employee_code: 'A-001' });
        expect(await count()).toBe(before);
    });

    it('finds duplicates within the file and against people already in the organisation', async () => {
        await sql("UPDATE employees SET email = 'mel@abc.test', employee_code = 'E1' WHERE id = $1", [w.workers.mel]);
        const res = await validate(w.tokens.owner, [
            person({ row: 2, full_name: 'Sam One', email: 'sam@x.test', employee_code: 'S1' }),
            person({ row: 3, full_name: 'sam one' }),
            person({ row: 4, full_name: 'Sam Two', email: 'SAM@x.test' }),
            person({ row: 5, full_name: 'Sam Three', employee_code: 's1' }),
            person({ row: 6, full_name: 'mel worker' }),
            person({ row: 7, full_name: 'New Person', email: 'mel@abc.test' }),
            person({ row: 8, full_name: 'Other Person', employee_code: 'e1' }),
        ]);
        const messages = Object.fromEntries(res.body.data.rows.map((r: any) => [r.row, r.errors.map((e: any) => e.message).join(' ')]));
        expect(messages[2]).toBe('');
        expect(messages[3]).toMatch(/Same name as row 2/);
        expect(messages[4]).toMatch(/Same email as row 2/);
        expect(messages[5]).toMatch(/Same employee ID as row 2/);
        expect(messages[6]).toMatch(/Mel Worker is already in SimpleHours/);
        expect(messages[7]).toMatch(/already belongs to Mel Worker/);
        expect(messages[8]).toMatch(/E1 already belongs to Mel Worker|e1 already belongs to Mel Worker/);
    });

    it('a branch-scoped manager can only import into their own branches, even by naming another', async () => {
        // Sarah manages Melbourne and Richmond only.
        const res = await validate(w.tokens.sarah, [
            person({ row: 2, full_name: 'In Scope', branch: 'melbourne' }),
            person({ row: 3, full_name: 'Out Of Scope', branch: 'Geelong' }),
            person({ row: 4, full_name: 'Other Org', branch: 'Sydney' }),
        ]);
        const errors = Object.fromEntries(res.body.data.rows.map((r: any) => [r.row, r.errors.map((e: any) => e.message).join(' ')]));
        // A branch out of reach and one that doesn't exist get the same answer.
        expect(errors).toEqual({ 2: '', 3: 'You can’t add staff to a branch called “Geelong”.', 4: 'You can’t add staff to a branch called “Sydney”.' });
    });

    it('the branch can be left out when the caller can add staff to exactly one branch', async () => {
        const geelongOnly = await createUser('gee.mgr@abc.test');
        await assignRole(w.abc.id, geelongOnly.id, await createRole(w.abc.id, 'Geelong Adder', ['employees.create', 'employees.view']), [w.abc.geelong]);
        const res = await validate(await signIn(geelongOnly.id, w.abc.id), [person({ branch: '' })]);
        expect(res.body.data.rows[0].value.branch_name).toBe('Geelong');
        expect((await validate(w.tokens.owner, [person({ branch: '' })])).body.data.rows[0].errors[0].field).toBe('branch');
    });

    it('a deactivated branch is refused', async () => {
        await sql('UPDATE locations SET is_active = false WHERE id = $1', [w.abc.geelong]);
        const res = await validate(w.tokens.owner, [person({ branch: 'Geelong' })]);
        expect(res.body.data.rows[0].errors[0].message).toBe('Geelong is deactivated.');
    });

    it('rejects a malformed request, an empty file and an oversized one', async () => {
        expect((await validate(w.tokens.owner, 'x')).status).toBe(400);
        expect((await validate(w.tokens.owner, [])).status).toBe(400);
        expect((await validate(w.tokens.owner, Array.from({ length: 5001 }, (_, i) => person({ full_name: `P${i}` })))).body.error.code).toBe('TOO_MANY_ROWS');
        const odd = await validate(w.tokens.owner, [null, ['a'], person({ full_name: { $ne: 1 } })]);
        expect(odd.status).toBe(200);
        expect(odd.body.data.invalid).toBe(3);
    });

    it('needs permission to add staff', async () => {
        expect((await validate(w.tokens.melEmployee, [person()])).status).toBe(403);
        const viewer = await createUser('viewer@abc.test');
        await assignRole(w.abc.id, viewer.id, await createRole(w.abc.id, 'Viewer', ['employees.view']), 'all');
        expect((await validate(await signIn(viewer.id, w.abc.id), [person()])).status).toBe(403);
        expect((await request(app).post('/api/staff-import/validate').send({ rows: [person()] })).status).toBe(401);
    });
});

describe('importing', () => {
    it('adds every row, with all their details, and records it in the audit log', async () => {
        const before = await count();
        const res = await doImport(w.tokens.owner, [
            person({ full_name: 'Alex Smith', email: 'alex@x.test', phone: '0400 000 000', department: 'Front desk', contracted_hours: 38, employee_code: 'A1' }),
            person({ full_name: 'Sam Jones', branch: 'Richmond' }),
        ]);
        expect(res.status).toBe(201);
        expect(res.body.data.imported).toBe(2);
        expect(await count()).toBe(before + 2);
        const alex = (await sql("SELECT e.*, l.name AS branch FROM employees e JOIN locations l ON l.id = e.location_id WHERE e.full_name = 'Alex Smith'")).rows[0];
        expect(alex).toMatchObject({ branch: 'Melbourne', email: 'alex@x.test', phone: '0400 000 000', department: 'Front desk', employee_code: 'A1', is_active: true });
        expect(Number(alex.contracted_hours)).toBe(38);
        const sam = (await sql("SELECT contracted_hours FROM employees WHERE full_name = 'Sam Jones'")).rows[0];
        expect(Number(sam.contracted_hours)).toBe(76);
        const [audit] = (await sql("SELECT * FROM audit_logs WHERE action = 'STAFF_IMPORTED'")).rows;
        expect(audit.details).toBe('Imported 2 people into Melbourne, Richmond');
    });

    it('is all or nothing: one bad row and nothing is written', async () => {
        const before = await count();
        const res = await doImport(w.tokens.owner, [person({ full_name: 'Good One' }), person({ row: 3, full_name: 'Bad One', email: 'nope' })]);
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('IMPORT_INVALID');
        expect(res.body.data.rows).toEqual([expect.objectContaining({ row: 3 })]);
        expect(await count()).toBe(before);
    });

    it('importing the same file twice finds everyone already there', async () => {
        const rows = [person({ full_name: 'Twice', employee_code: 'T1' })];
        expect((await doImport(w.tokens.owner, rows)).status).toBe(201);
        expect((await doImport(w.tokens.owner, rows)).status).toBe(422);
    });

    it('people are only ever added to this organisation', async () => {
        await doImport(w.tokens.owner, [person({ full_name: 'Only ABC' })]);
        expect((await sql("SELECT org_id FROM employees WHERE full_name = 'Only ABC'")).rows).toEqual([{ org_id: w.abc.id }]);
        const xavier = await doImport(w.tokens.xavier, [person({ full_name: 'Into ABC', branch: 'Melbourne' })]);
        expect(xavier.status).toBe(422);
    });

    it(`more than ${BACKGROUND_THRESHOLD} rows run in the background, and the job reports progress and the result`, async () => {
        const rows = Array.from({ length: BACKGROUND_THRESHOLD + 1 }, (_, i) => person({ full_name: `Bulk Person ${i}`, employee_code: `B${i}` }));
        const res = await doImport(w.tokens.owner, rows);
        expect(res.status).toBe(202);
        const jobId = res.body.data.job_id;
        let job: any;
        for (let i = 0; i < 100; i++) {
            job = (await request(app).get(`/api/staff-import/jobs/${jobId}`).set(bearer(w.tokens.owner))).body.data;
            if (job.status !== 'running') break;
            await new Promise(r => setTimeout(r, 50));
        }
        expect(job).toMatchObject({ status: 'done', total_rows: rows.length, done_rows: rows.length });
        expect((await sql("SELECT COUNT(*)::int AS n FROM employees WHERE full_name LIKE 'Bulk Person %'")).rows[0].n).toBe(rows.length);
        // Another organisation can't see the job.
        expect((await request(app).get(`/api/staff-import/jobs/${jobId}`).set(bearer(w.tokens.xavier))).status).toBe(404);
    });

    it('an interrupted background job reports that nothing was imported', async () => {
        const job = (await sql(
            "INSERT INTO import_jobs (org_id, status, total_rows, created_at) VALUES ($1, 'running', 600, NOW() - INTERVAL '1 hour') RETURNING id",
            [w.abc.id]
        )).rows[0].id;
        const res = await request(app).get(`/api/staff-import/jobs/${job}`).set(bearer(w.tokens.owner));
        expect(res.body.data).toMatchObject({ status: 'failed', done_rows: 0 });
        expect(res.body.data.error).toMatch(/nothing was imported/);
    });
});

describe('employee ID on the normal add and edit', () => {
    it('is saved, is unique per organisation ignoring case, and can be cleared', async () => {
        const add = (body: Record<string, unknown>) => request(app).post('/api/employees').set(bearer(w.tokens.owner)).send({ location_id: w.abc.melbourne, ...body });
        const first = await add({ full_name: 'Coded', employee_code: 'C-1' });
        expect([first.status, first.body.data.employee_code]).toEqual([201, 'C-1']);
        const dup = await add({ full_name: 'Coded Two', employee_code: 'c-1' });
        expect([dup.status, dup.body.error.code]).toEqual([409, 'DUPLICATE_EMPLOYEE_CODE']);
        // The same ID in another organisation is fine.
        expect((await request(app).post('/api/employees').set(bearer(w.tokens.xavier)).send({ location_id: w.xyz.sydney, full_name: 'Xyz Coded', employee_code: 'C-1' })).status).toBe(201);

        const id = first.body.data.id;
        const keep = await request(app).put(`/api/employees/${id}`).set(bearer(w.tokens.owner)).send({ full_name: 'Coded Renamed' });
        expect(keep.body.data.employee_code).toBe('C-1');
        const clear = await request(app).put(`/api/employees/${id}`).set(bearer(w.tokens.owner)).send({ full_name: 'Coded Renamed', employee_code: '' });
        expect(clear.body.data.employee_code).toBeNull();
        expect((await add({ full_name: 'Bad Code', employee_code: '***' })).status).toBe(400);
    });
});
