import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';
import { calcHours } from '../services/timeParser';

const router = Router();

function rangesOverlap(s1: number, e1: number, s2: number, e2: number): boolean {
    if (e1 <= s1) e1 += 24 * 60;
    if (e2 <= s2) e2 += 24 * 60;
    return Math.max(s1, s2) < Math.min(e1, e2);
}

const toMins = (t?: string): number => {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

// Check locks middleware
async function checkLocks(req: AuthRequest, res: Response, next: any) {
    const { record_date } = req.body;
    if (!record_date) return next();

    const parts = record_date.split('-');
    const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0);
    const ref = new Date(2026, 2, 29, 0, 0, 0, 0);
    const diff = Math.floor((dt.getTime() - ref.getTime()) / 86400000);
    const offset = Math.floor(diff / 14);
    const fnStart = new Date(ref.getTime() + offset * 14 * 86400000);
    const fnIso = `${fnStart.getFullYear()}-${String(fnStart.getMonth() + 1).padStart(2, '0')}-${String(fnStart.getDate()).padStart(2, '0')}`;

    const lockResult = await query('SELECT * FROM fortnight_locks WHERE org_id = $1 AND start_date = $2', [req.user?.organisation_id, fnIso]);
    const lock = lockResult.rows[0];

    if (lock) {
        if (lock.roster_locked) {
            return res.status(403).json({ success: false, error: { code: 'ROSTER_LOCKED', message: 'Roster is locked for this period.' } });
        }
        if (lock.timesheet_locked) {
            return res.status(403).json({ success: false, error: { code: 'TIMESHEET_LOCKED', message: 'Timesheets are locked for this period.' } });
        }
    }
    next();
}

import { calculateRosterStats } from '../services/rosterService';

router.get('/stats', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        if (!orgId) return res.status(400).json({ error: 'Missing orgId' });
        
        const start_date = req.query.start_date as string;
        if (!start_date) return res.status(400).json({ error: 'Missing start_date' });

        const isManager = ['Admin', 'Company Admin', 'Platform Admin', 'Manager'].includes(req.user?.role || '');
        
        let empRes = await query('SELECT id FROM employees WHERE user_id = $1 AND org_id = $2 AND deleted_at IS NULL', [req.user?.id, orgId]);
        let myEmpId = empRes.rows.length > 0 ? empRes.rows[0].id : null;

        let empId = (req.query.employee_id as string) || myEmpId;

        if (!isManager && empId !== myEmpId) {
            return res.status(403).json({ success: false, error: { message: 'Forbidden: You can only access stats for your own employee record.' } });
        }

        if (!empId) {
            return res.status(404).json({ success: false, error: { message: 'Employee profile not found for this user.' }});
        }

        const [year, month, day] = start_date.split('-');
        const dt = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);

        const stats = await calculateRosterStats(orgId, empId, dt);
        res.json({ success: true, data: stats });
    } catch (err: any) {
        console.error('[RECORDS STATS ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to calculate roster stats.' } });
    }
});

router.get('/', requireAuth, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        if (!orgId) return res.status(400).json({ error: 'Missing orgId' });
        const result = await query('SELECT * FROM daily_records WHERE org_id = $1', [orgId]);
        const records = result.rows;

        for (const rec of records) {
            const segResult = await query('SELECT * FROM shift_segments WHERE record_id = $1', [rec.id]);
            rec.segments = segResult.rows;
        }

        res.json({ success: true, data: records });
    } catch (err: any) {
        console.error('[RECORDS GET ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch daily records.' } });
    }
});

router.post('/', requireAuth, requireRole(['Admin', 'Company Admin', 'Platform Admin', 'Manager']), checkLocks, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id;
        const { employee_id, record_date, segments } = req.body;

        if (!employee_id || !record_date) {
            return res.status(400).json({ success: false, error: { message: 'employee_id and record_date are required' } });
        }

        const empCheck = await query('SELECT id FROM employees WHERE id = $1 AND org_id = $2', [employee_id, orgId]);
        if (empCheck.rows.length === 0) {
            return res.status(400).json({ success: false, error: { message: 'Employee does not belong to your organisation' } });
        }

        if (segments && Array.isArray(segments)) {
            for (let i = 0; i < segments.length; i++) {
                for (let j = i + 1; j < segments.length; j++) {
                    const s1 = segments[i], s2 = segments[j];
                    if (!s1.is_unplanned && !s2.is_unplanned && s1.roster_in && s1.roster_out && s2.roster_in && s2.roster_out) {
                        if (rangesOverlap(toMins(s1.roster_in), toMins(s1.roster_out), toMins(s2.roster_in), toMins(s2.roster_out))) {
                            return res.status(400).json({ success: false, error: { code: 'OVERLAP', message: 'Roster times overlap.' } });
                        }
                    }
                    if (s1.actual_in && s1.actual_out && s2.actual_in && s2.actual_out) {
                        if (rangesOverlap(toMins(s1.actual_in), toMins(s1.actual_out), toMins(s2.actual_in), toMins(s2.actual_out))) {
                            return res.status(400).json({ success: false, error: { code: 'OVERLAP', message: 'Actual times overlap.' } });
                        }
                    }
                }
            }
        }

        let recResult = await query('SELECT * FROM daily_records WHERE org_id = $1 AND employee_id = $2 AND record_date = $3', [orgId, employee_id, record_date]);
        let recId: string;

        if (recResult.rows.length > 0) {
            recId = recResult.rows[0].id;
            await query('DELETE FROM shift_segments WHERE record_id = $1', [recId]);
        } else {
            recId = crypto.randomUUID();
            await query('INSERT INTO daily_records (id, org_id, employee_id, record_date) VALUES ($1, $2, $3, $4)', [recId, orgId, employee_id, record_date]);
        }

        let has_actuals = false;
        if (segments && Array.isArray(segments)) {
            for (const seg of segments) {
                const rosterH = (seg.roster_in && seg.roster_out) ? (seg.roster_hours || calcHours(seg.roster_in, seg.roster_out)) : (seg.roster_hours || 0);
                const actualH = (seg.actual_in && seg.actual_out) ? (seg.actual_hours || calcHours(seg.actual_in, seg.actual_out)) : (seg.actual_hours || 0);
                if (actualH > 0 || (seg.actual_in && seg.actual_out)) has_actuals = true;

                await query(
                    `INSERT INTO shift_segments (
                        id, record_id, segment_type, is_unplanned,
                        roster_in, roster_out, roster_hours,
                        actual_in, actual_out, actual_hours, actual_segment_type, notes
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                    [
                        crypto.randomUUID(),
                        recId,
                        seg.segment_type || 'WORK',
                        seg.is_unplanned ? true : false,
                        seg.roster_in || null,
                        seg.roster_out || null,
                        rosterH,
                        seg.actual_in || null,
                        seg.actual_out || null,
                        actualH,
                        seg.actual_segment_type || null,
                        seg.notes || null
                    ]
                );
            }
        }

        await query('UPDATE daily_records SET has_actuals = $1 WHERE id = $2', [has_actuals, recId]);

        res.json({ success: true });
    } catch (err: any) {
        console.error('[RECORDS SAVE ERROR]', err);
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to save shift record.' } });
    }
});

export default router;
