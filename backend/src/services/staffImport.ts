import { query, withTransaction } from './db';
import { AccessContext, badRequest, scopedBranchIds, writeAudit } from './policy';
import { Permission } from './permissions';
import { isValidEmail } from './authUtils';

/**
 * Importing staff from a spreadsheet.
 *
 * The browser reads the file and sends rows of text; nothing is trusted from it. Every row is
 * checked here, the same way whether the caller is previewing (validate) or importing:
 *   - required and well-formed fields (name, email, phone, hours, employee ID);
 *   - the branch must exist, be active, and be one the caller may add staff to (employees.create
 *     in that branch), so a branch-scoped manager can't import into another branch by naming it;
 *   - duplicates within the file, and against people already in the organisation (same name,
 *     same email or same employee ID).
 * An import is all or nothing: any problem and nothing is written. Large imports run in the
 * background as one transaction, with progress in import_jobs.
 */

export const MAX_IMPORT_ROWS = 5000;
/** Up to this many rows are imported straight away; more run in the background. */
export const BACKGROUND_THRESHOLD = 500;
const INSERT_CHUNK = 250;
const PHONE_PATTERN = /^[0-9+()\-.\s]{3,40}$/;
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._\-/]{0,39}$/;
const MAX_FORTNIGHT_HOURS = 336;
/** A background job not finished after this long was interrupted (e.g. a restart); its transaction rolled back. */
const STALE_JOB_MS = 30 * 60 * 1000;

export interface RowIssue { field: string; message: string }

export interface CleanRow {
    full_name: string;
    location_id: string;
    branch_name: string;
    department: string | null;
    email: string | null;
    phone: string | null;
    contracted_hours: number;
    employee_code: string | null;
}

export interface CheckedRow { row: number; errors: RowIssue[]; value: CleanRow | null }

const FIELDS = ['full_name', 'branch', 'department', 'email', 'phone', 'contracted_hours', 'employee_code'] as const;

function text(raw: unknown): string | null {
    if (raw === undefined || raw === null) return '';
    if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
    if (typeof raw !== 'string') return null;
    return raw.trim();
}

/** Checks every row; never throws for a bad row (that is reported on the row), only for a malformed request. */
export async function checkRows(ctx: AccessContext, input: unknown): Promise<{ rows: CheckedRow[]; valid: number; invalid: number }> {
    if (!Array.isArray(input) || input.length === 0) throw badRequest('VALIDATION_FAILED', 'The file has no rows to import.');
    if (input.length > MAX_IMPORT_ROWS) throw badRequest('TOO_MANY_ROWS', `A file can have ${MAX_IMPORT_ROWS} people at most. Split it into smaller files.`);

    const [branchesRes, existingRes] = await Promise.all([
        query('SELECT id, name, is_active FROM locations WHERE org_id = $1', [ctx.orgId]),
        query('SELECT full_name, email, employee_code FROM employees WHERE org_id = $1', [ctx.orgId]),
    ]);
    const creatable = new Set(scopedBranchIds(ctx, Permission.EMPLOYEES_CREATE));
    const branchByName = new Map<string, { id: string; name: string; is_active: boolean }>();
    for (const b of branchesRes.rows) branchByName.set(String(b.name).trim().toLowerCase(), b);
    const usable = branchesRes.rows.filter((b: any) => b.is_active && creatable.has(b.id));
    // With exactly one branch to add staff to, the branch column can be left out.
    const onlyBranch = usable.length === 1 ? usable[0] : null;

    const existingName = new Map<string, string>();
    const existingEmail = new Map<string, string>();
    const existingCode = new Map<string, string>();
    for (const e of existingRes.rows) {
        existingName.set(String(e.full_name).toLowerCase(), e.full_name);
        if (e.email) existingEmail.set(String(e.email).toLowerCase(), e.full_name);
        if (e.employee_code) existingCode.set(String(e.employee_code).toLowerCase(), e.full_name);
    }
    const seenName = new Map<string, number>();
    const seenEmail = new Map<string, number>();
    const seenCode = new Map<string, number>();

    const rows: CheckedRow[] = input.map((raw: any, index: number) => {
        const rowNumber = Number.isInteger(raw?.row) && raw.row > 0 ? raw.row : index + 2;
        const errors: RowIssue[] = [];
        const add = (field: string, message: string) => errors.push({ field, message });
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            add('row', 'This row could not be read.');
            return { row: rowNumber, errors, value: null };
        }
        const v: Record<(typeof FIELDS)[number], string> = {} as any;
        for (const f of FIELDS) {
            const t = text(raw[f]);
            if (t === null) { add(f, 'This value could not be read.'); v[f] = ''; } else v[f] = t;
        }

        // Name
        if (!v.full_name) add('full_name', 'Name is missing.');
        else if (v.full_name.length > 120) add('full_name', 'Name is longer than 120 characters.');
        else {
            const key = v.full_name.toLowerCase();
            if (existingName.has(key)) add('full_name', `${existingName.get(key)} is already in SimpleHours.`);
            else if (seenName.has(key)) add('full_name', `Same name as row ${seenName.get(key)}.`);
            else seenName.set(key, rowNumber);
        }

        // Branch
        let branch: { id: string; name: string } | null = null;
        if (!v.branch) {
            if (onlyBranch) branch = onlyBranch;
            else add('branch', 'Branch is missing.');
        } else {
            const found = branchByName.get(v.branch.toLowerCase());
            if (!found) add('branch', `There is no branch called “${v.branch}”.`);
            else if (!found.is_active) add('branch', `${found.name} is deactivated.`);
            else if (!creatable.has(found.id)) add('branch', `You can’t add staff to ${found.name}.`);
            else branch = found;
        }

        // Department
        if (v.department.length > 120) add('department', 'Department is longer than 120 characters.');

        // Email
        let email: string | null = null;
        if (v.email) {
            const lower = v.email.toLowerCase();
            if (v.email.length > 254 || !isValidEmail(v.email)) add('email', `“${v.email}” isn’t a valid email address.`);
            else if (existingEmail.has(lower)) add('email', `This email already belongs to ${existingEmail.get(lower)}.`);
            else if (seenEmail.has(lower)) add('email', `Same email as row ${seenEmail.get(lower)}.`);
            else { seenEmail.set(lower, rowNumber); email = lower; }
        }

        // Phone
        if (v.phone && !PHONE_PATTERN.test(v.phone)) add('phone', `“${v.phone}” isn’t a valid phone number.`);

        // Hours
        let hours = 76;
        if (v.contracted_hours) {
            hours = Number(v.contracted_hours);
            if (!Number.isFinite(hours) || hours < 0 || hours > MAX_FORTNIGHT_HOURS) {
                add('contracted_hours', `Contracted hours must be a number from 0 to ${MAX_FORTNIGHT_HOURS} (per fortnight).`);
            }
        }

        // Employee ID
        let code: string | null = null;
        if (v.employee_code) {
            const lower = v.employee_code.toLowerCase();
            if (!CODE_PATTERN.test(v.employee_code)) add('employee_code', 'Employee ID can be up to 40 letters, numbers, spaces, dots, dashes or slashes.');
            else if (existingCode.has(lower)) add('employee_code', `Employee ID ${v.employee_code} already belongs to ${existingCode.get(lower)}.`);
            else if (seenCode.has(lower)) add('employee_code', `Same employee ID as row ${seenCode.get(lower)}.`);
            else { seenCode.set(lower, rowNumber); code = v.employee_code; }
        }

        if (errors.length > 0 || !branch) return { row: rowNumber, errors, value: null };
        return {
            row: rowNumber,
            errors,
            value: {
                full_name: v.full_name, location_id: branch.id, branch_name: branch.name,
                department: v.department || null, email, phone: v.phone || null, contracted_hours: hours, employee_code: code,
            },
        };
    });

    const invalid = rows.filter(r => r.errors.length > 0).length;
    return { rows, valid: rows.length - invalid, invalid };
}

/** Inserts every row in one transaction; `onProgress` is told after each chunk. */
async function insertAll(ctx: AccessContext, rows: CleanRow[], onProgress?: (done: number) => Promise<void>): Promise<void> {
    await withTransaction(async (tx) => {
        for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
            const chunk = rows.slice(start, start + INSERT_CHUNK);
            const params: unknown[] = [];
            const values = chunk.map(r => {
                params.push(ctx.orgId, r.location_id, r.full_name, r.department, r.email, r.phone, r.contracted_hours, r.employee_code);
                const n = params.length;
                return `(gen_random_uuid(), $${n - 7}, $${n - 6}, $${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
            });
            await tx(
                `INSERT INTO employees (id, org_id, location_id, full_name, department, email, phone, contracted_hours, employee_code)
                 VALUES ${values.join(', ')}`,
                params
            );
            if (onProgress) await onProgress(Math.min(start + INSERT_CHUNK, rows.length));
        }
    });
}

async function auditImport(ctx: AccessContext, rows: CleanRow[]): Promise<void> {
    const branches = [...new Set(rows.map(r => r.branch_name))].sort();
    await writeAudit({
        orgId: ctx.orgId, actorId: ctx.userId, action: 'STAFF_IMPORTED', entityType: 'worker',
        newValue: String(rows.length), details: `Imported ${rows.length} ${rows.length === 1 ? 'person' : 'people'} into ${branches.join(', ')}`,
    });
}

const IMPORT_RACE = 'Someone added or changed staff while this import was running, so nothing was imported. Check the file again and retry.';
const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === '23505';

export type ImportOutcome =
    | { kind: 'invalid'; rows: CheckedRow[]; invalid: number }
    | { kind: 'imported'; count: number }
    | { kind: 'queued'; jobId: string; total: number };

export async function importRows(ctx: AccessContext, input: unknown): Promise<ImportOutcome> {
    const checked = await checkRows(ctx, input);
    if (checked.invalid > 0) return { kind: 'invalid', rows: checked.rows.filter(r => r.errors.length > 0), invalid: checked.invalid };
    const rows = checked.rows.map(r => r.value!) as CleanRow[];

    if (rows.length <= BACKGROUND_THRESHOLD) {
        try {
            await insertAll(ctx, rows);
        } catch (err) {
            if (isUniqueViolation(err)) throw badRequest('IMPORT_CONFLICT', IMPORT_RACE);
            throw err;
        }
        await auditImport(ctx, rows);
        return { kind: 'imported', count: rows.length };
    }

    const job = await query(
        `INSERT INTO import_jobs (org_id, created_by, status, total_rows) VALUES ($1, $2, 'running', $3) RETURNING id`,
        [ctx.orgId, ctx.userId, rows.length]
    );
    const jobId: string = job.rows[0].id;
    setImmediate(() => { void runJob(ctx, jobId, rows); });
    return { kind: 'queued', jobId, total: rows.length };
}

async function runJob(ctx: AccessContext, jobId: string, rows: CleanRow[]): Promise<void> {
    try {
        await insertAll(ctx, rows, done => query('UPDATE import_jobs SET done_rows = $1 WHERE id = $2', [done, jobId]).then(() => undefined));
        await query(`UPDATE import_jobs SET status = 'done', done_rows = total_rows, finished_at = NOW() WHERE id = $1`, [jobId]);
        await auditImport(ctx, rows);
    } catch (err) {
        const message = isUniqueViolation(err) ? IMPORT_RACE : 'The import failed, so nothing was imported. Please try again.';
        if (!isUniqueViolation(err)) console.error('[STAFF IMPORT] job failed:', err instanceof Error ? err.message : 'unknown error');
        await query(`UPDATE import_jobs SET status = 'failed', done_rows = 0, error = $1, finished_at = NOW() WHERE id = $2`, [message, jobId]).catch(() => undefined);
    }
}

/** A job in this organisation. Someone else's organisation's job is simply not found. */
export async function readJob(orgId: string, jobId: string) {
    const res = await query(
        `SELECT id, status, total_rows, done_rows, error, created_at, finished_at FROM import_jobs WHERE id = $1 AND org_id = $2`,
        [jobId, orgId]
    );
    const job = res.rows[0];
    if (!job) return null;
    if (job.status === 'running' && Date.now() - new Date(job.created_at).getTime() > STALE_JOB_MS) {
        // Interrupted (e.g. the server restarted): the transaction never committed, so nothing was imported.
        const message = 'The import was interrupted, so nothing was imported. Please try again.';
        await query(`UPDATE import_jobs SET status = 'failed', done_rows = 0, error = $1, finished_at = NOW() WHERE id = $2 AND status = 'running'`, [message, jobId]);
        return { ...job, status: 'failed', done_rows: 0, error: message };
    }
    return job;
}
