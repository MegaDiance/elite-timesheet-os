import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { requireAuth, requireTenantContext, requireRole, AuthRequest } from '../middleware/auth';
import { calcHours, parseSmartTime } from '../services/timeParser';
import { getFortnightStartIso } from '../services/periodUtils';

const router = Router();
router.use(requireAuth, requireTenantContext);

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

    const fnIso = getFortnightStartIso(record_date);

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

    const { employee_id } = req.body;
    if (employee_id && fnIso) {
        const subRes = await query(
            'SELECT status FROM timesheet_submissions WHERE org_id = $1 AND employee_id = $2 AND start_date = $3',
            [req.user?.organisation_id, employee_id, fnIso]
        );
        if (subRes.rows.length > 0 && ['Approved', 'Locked'].includes(subRes.rows[0].status)) {
            return res.status(403).json({
                success: false,
                error: {
                    code: 'TIMESHEET_ALREADY_APPROVED',
                    message: 'The timesheet for this employee is approved. Modifications to approved shifts are prohibited.'
                }
            });
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

        // Validate that requested employee belongs to the caller's organisation
        if (isManager && empId !== myEmpId) {
            const empCheck = await query('SELECT id FROM employees WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL', [empId, orgId]);
            if (empCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: { message: 'Employee not found in your organisation.' } });
            }
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

        const { start_date, end_date, employee_id } = req.query;

        let sql = 'SELECT * FROM daily_records WHERE org_id = $1';
        const params: any[] = [orgId];

        if (start_date) {
            params.push(start_date);
            sql += ` AND record_date >= $${params.length}`;
        }
        if (end_date) {
            params.push(end_date);
            sql += ` AND record_date <= $${params.length}`;
        }
        if (employee_id) {
            params.push(employee_id);
            sql += ` AND employee_id = $${params.length}`;
        }

        sql += ' ORDER BY record_date ASC';

        const result = await query(sql, params);
        const records = result.rows;

        if (records.length === 0) {
            return res.json({ success: true, data: [] });
        }

        // Single batch fetch for all shift segments (eliminates N+1 query)
        const recordIds = records.map((r: any) => r.id);
        const placeholders = recordIds.map((_: string, i: number) => `$${i + 1}`).join(', ');
        const segResult = await query(`SELECT * FROM shift_segments WHERE record_id IN (${placeholders})`, recordIds);

        const segmentsByRecord = new Map<string, any[]>();
        for (const seg of segResult.rows) {
            const list = segmentsByRecord.get(seg.record_id) || [];
            list.push(seg);
            segmentsByRecord.set(seg.record_id, list);
        }

        for (const rec of records) {
            rec.segments = segmentsByRecord.get(rec.id) || [];
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

        const empCheck = await query(
            'SELECT id, is_active, deleted_at FROM employees WHERE id = $1 AND org_id = $2',
            [employee_id, orgId]
        );
        if (empCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Employee does not belong to your organisation' } });
        }
        if (!empCheck.rows[0].is_active || empCheck.rows[0].deleted_at) {
            return res.status(400).json({
                success: false,
                error: { code: 'EMPLOYEE_INACTIVE', message: 'Cannot record shifts or hours for an inactive or deleted employee.' }
            });
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

        let orgSettings = { break_mins_weekday: 30, break_mins_weekend: 0, break_threshold_hours: 6 };
        try {
            const orgRes = await query(
                'SELECT break_mins_weekday, break_mins_weekend, break_threshold_hours FROM organisations WHERE id = $1',
                [orgId]
            );
            if (orgRes.rows[0]) {
                orgSettings = {
                    break_mins_weekday: orgRes.rows[0].break_mins_weekday ?? 30,
                    break_mins_weekend: orgRes.rows[0].break_mins_weekend ?? 0,
                    break_threshold_hours: orgRes.rows[0].break_threshold_hours ?? 6
                };
            }
        } catch {
            // Fallback to defaults
        }

        const [ry, rm, rd] = record_date.split('-').map(Number);
        const recordDayOfWeek = new Date(Date.UTC(ry, rm - 1, rd)).getUTCDay();
        const isWeekend = (recordDayOfWeek === 0 || recordDayOfWeek === 6);
        const breakOptions = {
            breakMins: isWeekend ? Number(orgSettings.break_mins_weekend) : Number(orgSettings.break_mins_weekday),
            breakThresholdHours: Number(orgSettings.break_threshold_hours)
        };

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
                const rIn = seg.roster_in ? (parseSmartTime(seg.roster_in) || null) : null;
                const rOut = seg.roster_out ? (parseSmartTime(seg.roster_out) || null) : null;
                const aIn = seg.actual_in ? (parseSmartTime(seg.actual_in) || null) : null;
                const aOut = seg.actual_out ? (parseSmartTime(seg.actual_out) || null) : null;

                const rosterH = (rIn && rOut) 
                    ? calcHours(rIn, rOut, breakOptions) 
                    : Math.max(0, Math.round(Number(seg.roster_hours || 0) * 100) / 100);

                const actualH = (aIn && aOut) 
                    ? calcHours(aIn, aOut, breakOptions) 
                    : Math.max(0, Math.round(Number(seg.actual_hours || 0) * 100) / 100);

                if (actualH > 0 || (aIn && aOut) || seg.actual_segment_type) {
                    has_actuals = true;
                }

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
                        rIn,
                        rOut,
                        rosterH,
                        aIn,
                        aOut,
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
