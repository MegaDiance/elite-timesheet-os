import { Router, Response } from 'express';
import { autoRosterAll, autoLogAll } from '../services/rosterService';
import { requireAuth, requireTenantContext, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(requireAuth, requireTenantContext);

router.post('/auto-roster', requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        if (!orgId) return res.status(400).json({ error: 'Missing orgId' });
        const { start_date, selected_days } = req.body;
        if (!start_date) return res.status(400).json({ success: false, error: { message: 'start_date required' }});

        const [year, month, day] = start_date.split('-');
        const dt = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);

        await autoRosterAll(orgId, dt, selected_days, req.user?.id);
        res.json({ success: true });
    } catch (err: any) {
        console.error('[ROSTER AUTO-ROSTER ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to generate automatic roster.' }});
    }
});

router.post('/auto-log', requireAuth, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        if (!orgId) return res.status(400).json({ error: 'Missing orgId' });
        const { start_date, selected_days } = req.body;
        if (!start_date) return res.status(400).json({ success: false, error: { message: 'start_date required' }});

        const [year, month, day] = start_date.split('-');
        const dt = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);

        await autoLogAll(orgId, dt, selected_days, req.user?.id);
        res.json({ success: true });
    } catch (err: any) {
        console.error('[ROSTER AUTO-LOG ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to auto-log timesheet actuals.' }});
    }
});

export default router;
