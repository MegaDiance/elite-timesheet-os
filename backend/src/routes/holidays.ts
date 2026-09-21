import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { badRequest, isUuid, notFound, writeAudit } from '../services/policy';
import { isIsoDate } from '../services/periodUtils';

/**
 * Public holidays are organisation-wide: every branch rosters and reports against the same list.
 * Both roles may read it; only the Organisation Owner changes it.
 */
const router = Router();
router.use(requireAuth);

function readHolidayFields(body: any) {
    const holidayDate = typeof body?.holiday_date === 'string' ? body.holiday_date.trim() : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!holidayDate || !name) throw badRequest('VALIDATION_FAILED', 'holiday_date and name are required');
    if (!isIsoDate(holidayDate)) {
        throw badRequest('VALIDATION_FAILED', 'holiday_date must be a valid date in YYYY-MM-DD format.');
    }
    if (name.length > 120) throw badRequest('VALIDATION_FAILED', 'name must be 120 characters at most.');
    return { holidayDate, name };
}

/** GET /api/organisation/holidays — public holidays of the caller's organisation. */
router.get('/', requirePermission(Permission.BRANCH_VIEW), async (req: AuthRequest, res: Response) => {
    try {
        const result = await query(
            'SELECT id, holiday_date, name, created_at FROM public_holidays WHERE org_id = $1 ORDER BY holiday_date ASC',
            [req.auth!.orgId]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        sendError(res, err, 'HOLIDAYS GET ERROR');
    }
});

/** POST /api/organisation/holidays — adds a public holiday, or renames the one already on that date. */
router.post('/', requirePermission(Permission.HOLIDAYS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const { holidayDate, name } = readHolidayFields(req.body);

        const existing = await query('SELECT id FROM public_holidays WHERE org_id = $1 AND holiday_date = $2', [ctx.orgId, holidayDate]);
        let id: string;
        if (existing.rows.length > 0) {
            id = existing.rows[0].id;
            await query('UPDATE public_holidays SET name = $1 WHERE id = $2 AND org_id = $3', [name, id, ctx.orgId]);
        } else {
            id = crypto.randomUUID();
            await query('INSERT INTO public_holidays (id, org_id, holiday_date, name) VALUES ($1, $2, $3, $4)', [id, ctx.orgId, holidayDate, name]);
        }

        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'PUBLIC_HOLIDAY_CONFIGURED', entityType: 'public_holidays', entityId: id, details: JSON.stringify({ holiday_date: holidayDate, name }) });
        res.json({ success: true, data: { id, holiday_date: holidayDate, name } });
    } catch (err) {
        sendError(res, err, 'HOLIDAYS SAVE ERROR');
    }
});

/** DELETE /api/organisation/holidays/:id */
router.delete('/:id', requirePermission(Permission.HOLIDAYS_MANAGE), async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        if (!isUuid(req.params.id)) throw notFound('Holiday');
        const removed = await query('DELETE FROM public_holidays WHERE id = $1 AND org_id = $2 RETURNING holiday_date, name', [req.params.id, ctx.orgId]);
        if (removed.rows.length === 0) throw notFound('Holiday');

        const holiday = removed.rows[0];
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'PUBLIC_HOLIDAY_DELETED', entityType: 'public_holidays', entityId: req.params.id, details: JSON.stringify({ holiday_date: holiday.holiday_date, name: holiday.name }) });
        res.json({ success: true, message: 'Holiday removed' });
    } catch (err) {
        sendError(res, err, 'HOLIDAYS DELETE ERROR');
    }
});

export default router;
