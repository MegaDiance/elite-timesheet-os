import { Router, Response } from 'express';
import { autoRosterAll, autoLogAll } from '../services/rosterService';
import { requireAuth, requireTenantContext, requireAnyBranchPermission, Permission, AuthRequest } from '../middleware/auth';
import { query } from '../services/db';

const router = Router();
router.use(requireAuth, requireTenantContext);

router.post('/auto-roster', requireAnyBranchPermission(Permission.ROSTER_CREATE), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        if (!orgId) return res.status(400).json({ error: 'Missing orgId' });
        const { start_date, selected_days } = req.body;
        if (!start_date) return res.status(400).json({ success: false, error: { message: 'start_date required' }});

        // Block if roster is locked for this fortnight
        const lockRes = await query('SELECT roster_locked FROM fortnight_locks WHERE org_id = $1 AND start_date = $2', [orgId, start_date]);
        if (lockRes.rows[0]?.roster_locked) {
            return res.status(423).json({ success: false, error: { code: 'ROSTER_LOCKED', message: 'The roster for this fortnight is locked and cannot be modified.' } });
        }

        const [year, month, day] = start_date.split('-');
        const dt = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);

        await autoRosterAll(orgId, dt, selected_days, req.user?.id, req.user?.location_id);
        res.json({ success: true });
    } catch (err: any) {
        console.error('[ROSTER AUTO-ROSTER ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to generate automatic roster.' }});
    }
});

router.post('/auto-log', requireAuth, requireAnyBranchPermission(Permission.ROSTER_UPDATE), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        if (!orgId) return res.status(400).json({ error: 'Missing orgId' });
        const { start_date, selected_days } = req.body;
        if (!start_date) return res.status(400).json({ success: false, error: { message: 'start_date required' }});

        // Block if timesheet is locked for this fortnight
        const lockRes = await query('SELECT timesheet_locked FROM fortnight_locks WHERE org_id = $1 AND start_date = $2', [orgId, start_date]);
        if (lockRes.rows[0]?.timesheet_locked) {
            return res.status(423).json({ success: false, error: { code: 'TIMESHEET_LOCKED', message: 'The timesheet for this fortnight is locked and cannot be modified.' } });
        }

        const [year, month, day] = start_date.split('-');
        const dt = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);

        await autoLogAll(orgId, dt, selected_days, req.user?.id, req.user?.location_id);
        res.json({ success: true });
    } catch (err: any) {
        console.error('[ROSTER AUTO-LOG ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to auto-log timesheet actuals.' }});
    }
});

export default router;

