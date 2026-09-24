import { Router, Response } from 'express';
import crypto from 'crypto';
import { query, withTransaction } from '../services/db';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { AccessContext, HttpError, badRequest, isUuid, loadBranch, loadWorker, resolveBranchFilter, writeAudit } from '../services/policy';
import { isValidEmail } from '../services/authUtils';
import { loadBreakSettings, normaliseDaySegments, readBreakMins } from '../services/segments';

/**
 * Workers (stored in the `employees` table).
 *
 * A worker is an operational record — someone who is rostered, timesheeted and reported on.
 * Workers never sign in and are not linked to accounts. Every worker belongs to exactly one
 * branch of its organisation, and every request here is authorised against that stored branch:
 * the Organisation Owner in any branch, a Branch Admin only in the branches assigned to them.
 */
const router = Router();
router.use(requireAuth);

const WORKER_COLUMNS = 'e.id, e.org_id, e.location_id, e.full_name, e.department, e.email, e.phone, e.contracted_hours, e.is_active';
const PHONE_PATTERN = /^[0-9+()\-.\s]{3,40}$/;
const MAX_FORTNIGHT_HOURS = 336;
const MAX_TEMPLATE_ROWS = 100;

const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === '23505';
const duplicateName = (name: string) => new HttpError(409, 'DUPLICATE_WORKER', `A worker named "${name}" already exists in this organisation. Deactivated workers keep their name.`);

function optionalText(value: unknown, label: string, max: number): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw badRequest('VALIDATION_FAILED', `${label} must be text.`);
    const text = value.trim();
    if (text.length > max) throw badRequest('VALIDATION_FAILED', `${label} must be ${max} characters at most.`);
    return text || null;
}

function readWorkerFields(body: any) {
    const fullName = typeof body?.full_name === 'string' ? body.full_name.trim() : '';
    if (!fullName || fullName.length > 120) throw badRequest('VALIDATION_FAILED', 'full_name is required (120 characters at most).');

    const email = optionalText(body?.email, 'Email', 254);
    if (email && !isValidEmail(email)) throw badRequest('VALIDATION_FAILED', 'Enter a valid email address.');

    const phone = optionalText(body?.phone, 'Phone', 40);
    if (phone && !PHONE_PATTERN.test(phone)) throw badRequest('VALIDATION_FAILED', 'Enter a valid phone number.');

    let contractedHours = 76;
    if (body?.contracted_hours !== undefined && body.contracted_hours !== null && body.contracted_hours !== '') {
        contractedHours = Number(body.contracted_hours);
        if (!Number.isFinite(contractedHours) || contractedHours < 0 || contractedHours > MAX_FORTNIGHT_HOURS) {
            throw badRequest('VALIDATION_FAILED', `contracted_hours must be between 0 and ${MAX_FORTNIGHT_HOURS}.`);
        }
    }

    return {
        full_name: fullName,
        department: optionalText(body?.department, 'Department', 120),
        email: email ? email.toLowerCase() : null,
        phone,
        contracted_hours: contractedHours,
    };
}

/** A client-supplied branch id is only ever a request: it is loaded from this organisation and checked against the caller's scope. */
async function loadActiveTargetBranch(ctx: AccessContext, requested: unknown) {
    if (!isUuid(requested)) throw badRequest('VALIDATION_FAILED', 'location_id must be a branch id.');
    const branch = await loadBranch(ctx, Permission.WORKERS_MANAGE, requested);
    if (!branch.is_active) throw badRequest('BRANCH_INACTIVE', `Branch "${branch.name}" is deactivated. Choose an active branch.`);
    return branch;
}

router.get('/', requirePermission(Permission.WORKERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const branchIds = resolveBranchFilter(ctx, Permission.WORKERS_MANAGE, req.query.location_id);
        const includeInactive = req.query.include_inactive === 'true';

        const result = await query(
            `SELECT ${WORKER_COLUMNS}, l.name AS location_name,
                    CASE WHEN e.user_id IS NOT NULL THEN 'active'
                         WHEN EXISTS (SELECT 1 FROM employee_invitations i
                                       WHERE i.employee_id = e.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW()) THEN 'invited'
                         ELSE 'none' END AS portal_status
               FROM employees e
               JOIN locations l ON l.id = e.location_id AND l.org_id = e.org_id
              WHERE e.org_id = $1 AND e.location_id = ANY($2::uuid[])
                AND ($3::boolean OR e.is_active = true)
              ORDER BY e.full_name ASC`,
            [ctx.orgId, branchIds, includeInactive]
        );
        const workers = result.rows;

        const templates = await query(
            'SELECT * FROM roster_templates WHERE employee_id = ANY($1::uuid[]) ORDER BY day_index ASC',
            [workers.map((w: any) => w.id)]
        );
        const byWorker = new Map<string, any[]>();
        for (const row of templates.rows) {
            const list = byWorker.get(row.employee_id);
            if (list) list.push(row); else byWorker.set(row.employee_id, [row]);
        }
        for (const worker of workers) {
            worker.template = byWorker.get(worker.id) || [];
            worker.status = worker.is_active ? 'Active' : 'Inactive';
        }

        res.json({ success: true, data: workers });
    } catch (err) {
        sendError(res, err, 'WORKER LIST ERROR');
    }
});

router.post('/', requirePermission(Permission.WORKERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const fields = readWorkerFields(req.body);
        if (req.body?.location_id === undefined || req.body.location_id === null || req.body.location_id === '') {
            throw badRequest('VALIDATION_FAILED', 'location_id is required: every worker belongs to a branch.');
        }
        const branch = await loadActiveTargetBranch(ctx, req.body.location_id);

        let created;
        try {
            created = await query(
                `INSERT INTO employees (id, org_id, location_id, full_name, department, email, phone, contracted_hours)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING id, org_id, location_id, full_name, department, email, phone, contracted_hours, is_active`,
                [crypto.randomUUID(), ctx.orgId, branch.id, fields.full_name, fields.department, fields.email, fields.phone, fields.contracted_hours]
            );
        } catch (err) {
            if (isUniqueViolation(err)) throw duplicateName(fields.full_name);
            throw err;
        }
        const worker = created.rows[0];

        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'WORKER_CREATED', entityType: 'worker', entityId: worker.id, branchId: branch.id, details: `Created worker ${worker.full_name} in branch "${branch.name}"` });
        res.status(201).json({ success: true, data: { ...worker, location_name: branch.name } });
    } catch (err) {
        sendError(res, err, 'WORKER CREATE ERROR');
    }
});

router.put('/:id', requirePermission(Permission.WORKERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const worker = await loadWorker(ctx, Permission.WORKERS_MANAGE, req.params.id);
        const fields = readWorkerFields(req.body);

        // Moving a worker needs access to the branch they are in (loadWorker) and the branch they are going to.
        // Without a location_id in the body the worker stays where they are.
        const requested = req.body?.location_id;
        const wantsBranch = requested !== undefined && requested !== null && requested !== '';
        const target = wantsBranch && String(requested).toLowerCase() !== worker.location_id.toLowerCase()
            ? await loadActiveTargetBranch(ctx, requested)
            : null;
        const branchId: string = target ? target.id : worker.location_id;

        let updated;
        try {
            updated = await query(
                `UPDATE employees SET full_name = $1, department = $2, email = $3, phone = $4, contracted_hours = $5, location_id = $6
                  WHERE id = $7 AND org_id = $8
                  RETURNING id, org_id, location_id, full_name, department, email, phone, contracted_hours, is_active`,
                [fields.full_name, fields.department, fields.email, fields.phone, fields.contracted_hours, branchId, worker.id, ctx.orgId]
            );
        } catch (err) {
            if (isUniqueViolation(err)) throw duplicateName(fields.full_name);
            throw err;
        }

        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'WORKER_UPDATED', entityType: 'worker', entityId: worker.id, branchId, previousValue: worker.full_name, newValue: fields.full_name, details: `Updated worker ${fields.full_name}` });

        // Rosters and timesheets are not branch-stamped: they are shown by the worker's CURRENT
        // branch, not the branch they were actually worked in. A move is never blocked or altered
        // by this — the worker's own history is never touched — but the caller is told when the
        // worker has past records, since those records will now be shown under the new branch too
        // (and stop appearing under the old one) rather than staying with where the work happened.
        let historicalRecordsAffected = 0;
        if (target) {
            const from = await query('SELECT name FROM locations WHERE id = $1 AND org_id = $2', [worker.location_id, ctx.orgId]);
            await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'WORKER_MOVED', entityType: 'worker', entityId: worker.id, branchId: target.id, previousValue: from.rows[0]?.name ?? null, newValue: target.name, details: `Moved worker ${fields.full_name} to branch "${target.name}"` });
            const past = await query('SELECT COUNT(*)::int AS n FROM daily_records WHERE employee_id = $1', [worker.id]);
            historicalRecordsAffected = past.rows[0].n;
        }
        res.json({ success: true, data: { ...updated.rows[0], historical_records_affected: historicalRecordsAffected } });
    } catch (err) {
        sendError(res, err, 'WORKER UPDATE ERROR');
    }
});

/** Deactivating keeps every roster, timesheet and report row; the worker just stops appearing in active lists. */
router.post('/:id/deactivate', requirePermission(Permission.WORKERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const worker = await loadWorker(ctx, Permission.WORKERS_MANAGE, req.params.id);
        await query('UPDATE employees SET is_active = false WHERE id = $1 AND org_id = $2', [worker.id, ctx.orgId]);
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'WORKER_DEACTIVATED', entityType: 'worker', entityId: worker.id, branchId: worker.location_id, details: `Deactivated worker ${worker.full_name}` });
        res.json({ success: true });
    } catch (err) {
        sendError(res, err, 'WORKER DEACTIVATE ERROR');
    }
});

router.post('/:id/reactivate', requirePermission(Permission.WORKERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const worker = await loadWorker(ctx, Permission.WORKERS_MANAGE, req.params.id);
        await query('UPDATE employees SET is_active = true WHERE id = $1 AND org_id = $2', [worker.id, ctx.orgId]);
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'WORKER_REACTIVATED', entityType: 'worker', entityId: worker.id, branchId: worker.location_id, details: `Reactivated worker ${worker.full_name}` });
        res.json({ success: true });
    } catch (err) {
        sendError(res, err, 'WORKER REACTIVATE ERROR');
    }
});

/** Permanent deletion is refused once a worker has approved timesheets: that is payroll history. Deactivate instead. */
router.delete('/:id', requirePermission(Permission.WORKERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const worker = await loadWorker(ctx, Permission.WORKERS_MANAGE, req.params.id);

        const deleted = await withTransaction(async (tx) => {
            const approved = await tx(
                "SELECT 1 FROM timesheet_submissions WHERE employee_id = $1 AND org_id = $2 AND status = 'Approved' LIMIT 1",
                [worker.id, ctx.orgId]
            );
            if (approved.rows.length > 0) return false;

            await tx('DELETE FROM roster_templates WHERE employee_id = $1', [worker.id]);
            await tx('DELETE FROM shift_segments WHERE record_id IN (SELECT id FROM daily_records WHERE employee_id = $1 AND org_id = $2)', [worker.id, ctx.orgId]);
            await tx('DELETE FROM daily_records WHERE employee_id = $1 AND org_id = $2', [worker.id, ctx.orgId]);
            await tx('DELETE FROM timesheet_submissions WHERE employee_id = $1 AND org_id = $2', [worker.id, ctx.orgId]);
            await tx('DELETE FROM employees WHERE id = $1 AND org_id = $2', [worker.id, ctx.orgId]);
            return true;
        });

        if (!deleted) {
            throw new HttpError(409, 'WORKER_HAS_APPROVED_TIMESHEETS', 'This worker has approved timesheets, which are payroll history. Deactivate the worker instead.');
        }

        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'WORKER_DELETED', entityType: 'worker', entityId: worker.id, branchId: worker.location_id, details: `Permanently deleted worker ${worker.full_name}` });
        res.json({ success: true });
    } catch (err) {
        sendError(res, err, 'WORKER DELETE ERROR');
    }
});

/**
 * Replaces the worker's fortnightly roster template (day_index 0–13, day 0 is the Sunday a pay
 * period starts on). Each day is validated with the same segment rules as the roster itself.
 */
router.post('/:id/templates', requirePermission(Permission.WORKERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const worker = await loadWorker(ctx, Permission.WORKERS_MANAGE, req.params.id);

        const templates = req.body?.templates;
        if (!Array.isArray(templates) || templates.length > MAX_TEMPLATE_ROWS) {
            throw badRequest('VALIDATION_FAILED', `templates must be a list of at most ${MAX_TEMPLATE_ROWS} rows.`);
        }

        const byDay = new Map<number, any[]>();
        for (const t of templates) {
            const dayIndex = t?.day_index;
            if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 13) {
                throw badRequest('VALIDATION_FAILED', 'day_index must be a whole number from 0 to 13.');
            }
            // Templates only describe the roster, never worked hours.
            const row = { segment_type: t.segment_type || 'WORK', roster_in: t.roster_in, roster_out: t.roster_out, roster_hours: t.roster_hours, has_break: t.has_break, break_mins: t.break_mins };
            byDay.set(dayIndex, [...(byDay.get(dayIndex) || []), row]);
        }

        const settings = await loadBreakSettings(ctx.orgId);
        const rows: any[][] = [];
        for (const [dayIndex, dayRows] of byDay) {
            const isWeekend = dayIndex % 7 === 0 || dayIndex % 7 === 6;
            const rule = { breakMins: isWeekend ? settings.break_mins_weekend : settings.break_mins_weekday, thresholdHours: settings.break_threshold_hours };
            for (const seg of normaliseDaySegments(dayRows, rule).segments) {
                rows.push([crypto.randomUUID(), worker.id, dayIndex, seg.segment_type, seg.roster_in, seg.roster_out, seg.roster_hours, seg.has_break, seg.break_mins]);
            }
        }

        await withTransaction(async (tx) => {
            await tx('DELETE FROM roster_templates WHERE employee_id = $1', [worker.id]);
            for (const row of rows) {
                await tx(
                    `INSERT INTO roster_templates (id, employee_id, day_index, segment_type, roster_in, roster_out, roster_hours, has_break, break_mins)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                    row
                );
            }
        });

        res.json({ success: true });
    } catch (err) {
        sendError(res, err, 'WORKER TEMPLATE ERROR');
    }
});

/**
 * POST /api/employees/:id/templates/apply-break  { day_indexes: number[], has_break: boolean, break_mins?: number | null }
 * Turns the unpaid break on or off for the Normal Work shifts on the given days of the worker's
 * default roster template, optionally with an explicit length (null = the organisation's rule).
 * A day with no template shift has nothing to flip, so it is left alone.
 */
router.post('/:id/templates/apply-break', requirePermission(Permission.WORKERS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const worker = await loadWorker(ctx, Permission.WORKERS_MANAGE, req.params.id);

        const { day_indexes, has_break } = req.body || {};
        if (typeof has_break !== 'boolean') throw badRequest('VALIDATION_FAILED', 'has_break must be true or false.');
        if (!Array.isArray(day_indexes) || day_indexes.length === 0 || !day_indexes.every((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 13)) {
            throw badRequest('VALIDATION_FAILED', 'day_indexes must be a list of whole numbers from 0 to 13.');
        }

        const breakMins = has_break ? readBreakMins(req.body?.break_mins, 'break_mins') : null;
        await query(
            `UPDATE roster_templates SET has_break = $1, break_mins = $2 WHERE employee_id = $3 AND day_index = ANY($4::int[]) AND segment_type = 'WORK'`,
            [has_break, breakMins, worker.id, day_indexes]
        );
        res.json({ success: true });
    } catch (err) {
        sendError(res, err, 'WORKER TEMPLATE APPLY BREAK ERROR');
    }
});

export default router;
