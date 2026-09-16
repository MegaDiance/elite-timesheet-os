import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { requireAuth, requireTenantContext, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * GET /api/organisation/holidays
 * List public holidays for this organisation
 */
router.get('/', requireAuth, requireTenantContext, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const result = await query(
            'SELECT id, holiday_date, name, created_at FROM public_holidays WHERE org_id = $1 ORDER BY holiday_date ASC',
            [orgId]
        );
        res.json({ success: true, data: result.rows });
    } catch (err: any) {
        console.error('[HOLIDAYS GET ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to retrieve public holidays.' } });
    }
});

/**
 * POST /api/organisation/holidays
 * Add or update a public holiday
 */
router.post('/', requireAuth, requireTenantContext, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const userId = req.user?.id!;
        const { holiday_date, name } = req.body;

        if (!holiday_date || !name) {
            return res.status(400).json({ success: false, error: { message: 'holiday_date and name are required' } });
        }

        const existing = await query('SELECT id FROM public_holidays WHERE org_id = $1 AND holiday_date = $2', [orgId, holiday_date]);

        let id: string;
        if (existing.rows.length > 0) {
            id = existing.rows[0].id;
            await query('UPDATE public_holidays SET name = $1 WHERE id = $2', [name, id]);
        } else {
            id = crypto.randomUUID();
            await query(
                'INSERT INTO public_holidays (id, org_id, holiday_date, name) VALUES ($1, $2, $3, $4)',
                [id, orgId, holiday_date, name]
            );
        }

        // Audit log
        await query(`
            INSERT INTO audit_logs (id, org_id, actor_id, action, entity_type, entity_id, details, timestamp)
            VALUES ($1, $2, $3, 'PUBLIC_HOLIDAY_CONFIGURED', 'public_holidays', $4, $5, NOW())
        `, [
            crypto.randomUUID(),
            orgId,
            userId,
            id,
            JSON.stringify({ holiday_date, name })
        ]);

        res.json({ success: true, data: { id, holiday_date, name } });
    } catch (err: any) {
        console.error('[HOLIDAYS SAVE ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to save public holiday.' } });
    }
});

/**
 * DELETE /api/organisation/holidays/:id
 * Remove a public holiday
 */
router.delete('/:id', requireAuth, requireTenantContext, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const userId = req.user?.id!;
        const { id } = req.params;

        const resCheck = await query('SELECT holiday_date, name FROM public_holidays WHERE id = $1 AND org_id = $2', [id, orgId]);
        if (resCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'Holiday not found' } });
        }
        const hol = resCheck.rows[0];

        await query('DELETE FROM public_holidays WHERE id = $1 AND org_id = $2', [id, orgId]);

        await query(`
            INSERT INTO audit_logs (id, org_id, actor_id, action, entity_type, entity_id, details, timestamp)
            VALUES ($1, $2, $3, 'PUBLIC_HOLIDAY_DELETED', 'public_holidays', $4, $5, NOW())
        `, [
            crypto.randomUUID(),
            orgId,
            userId,
            id,
            JSON.stringify({ holiday_date: hol.holiday_date, name: hol.name })
        ]);

        res.json({ success: true, message: 'Holiday removed' });
    } catch (err: any) {
        console.error('[HOLIDAYS DELETE ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to remove public holiday.' } });
    }
});

export default router;
