import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../services/db';
import { requireAuth, requireTenantContext, AuthRequest } from '../middleware/auth';
import { classifyShiftHours, getWeekdayName } from '../services/classificationService';
import { fmtISO, addDays, getFortnightStartIso } from '../services/periodUtils';

const router = Router();

/**
 * GET /api/portal/my-timesheet
 * Strictly isolated: Resolves employee record via req.user.id and tenant.
 * Returns personal timesheet grid, categorized hours (Normal, Sat, Sun, Holiday, Leave),
 * submission status, and fortnight lock status.
 */
router.get('/my-timesheet', requireAuth, requireTenantContext, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const userId = req.user?.id!;
        const startDate = req.query.start_date as string;

        if (!startDate) {
            return res.status(400).json({ success: false, error: { message: 'start_date query parameter is required (YYYY-MM-DD)' } });
        }

        // Resolve logged-in user to employee record
        const empRes = await query('SELECT * FROM employees WHERE user_id = $1 AND org_id = $2 AND deleted_at IS NULL', [userId, orgId]);
        if (empRes.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: { message: 'No employee record is linked to your user account in this organization.' }
            });
        }
        const employee = empRes.rows[0];

        // Parse fortnight dates (14 days)
        const [y, m, d] = startDate.split('-').map(Number);
        const fnStart = new Date(Date.UTC(y, m - 1, d));

        // Fetch holiday records for this org
        const holidayRes = await query('SELECT id, holiday_date, name FROM public_holidays WHERE org_id = $1', [orgId]);
        const holidayMap = new Map<string, string>();
        holidayRes.rows.forEach((h: any) => holidayMap.set(h.holiday_date, h.name));

        // Fetch submission status
        const subRes = await query(
            'SELECT * FROM timesheet_submissions WHERE org_id = $1 AND employee_id = $2 AND start_date = $3',
            [orgId, employee.id, startDate]
        );
        const submission = subRes.rows[0] || {
            status: 'Draft',
            submitted_at: null,
            reviewed_at: null,
            rejection_reason: null
        };

        // Fetch fortnight lock & publish status
        const lockRes = await query(
            'SELECT roster_locked, timesheet_locked, is_published FROM fortnight_locks WHERE org_id = $1 AND start_date = $2',
            [orgId, startDate]
        );
        const lock = lockRes.rows[0] || { roster_locked: false, timesheet_locked: false, is_published: false };
        const isPublished = Boolean(lock.is_published) && Boolean(lock.roster_locked);

        const days: any[] = [];
        let totalRostered = 0;
        let totalActual = 0;
        let ordinaryWeekdayHours = 0;
        let saturdayHours = 0;
        let sundayHours = 0;
        let publicHolidayHours = 0;
        let leaveHours = 0;
        let unplannedHours = 0;

        for (let i = 0; i < 14; i++) {
            const dayDate = addDays(fnStart, i);
            const dateIso = fmtISO(dayDate);
            const weekday = getWeekdayName(dateIso);
            const isPublicHoliday = holidayMap.has(dateIso);
            const holidayName = holidayMap.get(dateIso);

            const recRes = await query(
                'SELECT * FROM daily_records WHERE org_id = $1 AND employee_id = $2 AND record_date = $3',
                [orgId, employee.id, dateIso]
            );

            let dayRostered = 0;
            let dayActual = 0;
            const segments: any[] = [];

            if (isPublished && recRes.rows.length > 0) {
                const recId = recRes.rows[0].id;
                const segRes = await query('SELECT * FROM shift_segments WHERE record_id = $1', [recId]);
                
                for (const seg of segRes.rows) {
                    const rHours = Number(seg.roster_hours || 0);
                    const aHours = Number(seg.actual_hours || 0);
                    dayRostered += rHours;
                    dayActual += aHours;

                    const effectiveType = seg.actual_segment_type || seg.segment_type || 'WORK';
                    const activeHours = (seg.actual_in && seg.actual_out) ? aHours : rHours;

                    if (seg.actual_in && seg.actual_out) {
                        const classified = await classifyShiftHours(orgId, dateIso, seg.actual_in, seg.actual_out, effectiveType);
                        classified.forEach(c => {
                            ordinaryWeekdayHours += c.normalHours;
                            saturdayHours += c.saturdayHours;
                            sundayHours += c.sundayHours;
                            publicHolidayHours += c.publicHolidayHours;
                            leaveHours += c.leaveHours;
                        });
                    } else if (['Sick', 'Annual', 'TIL'].includes(effectiveType)) {
                        leaveHours += activeHours;
                    } else if (isPublicHoliday) {
                        publicHolidayHours += activeHours;
                    } else if (weekday === 'Sat') {
                        saturdayHours += activeHours;
                    } else if (weekday === 'Sun') {
                        sundayHours += activeHours;
                    } else {
                        ordinaryWeekdayHours += activeHours;
                    }

                    if (seg.is_unplanned) {
                        unplannedHours += activeHours;
                    }

                    segments.push({
                        id: seg.id,
                        segment_type: seg.segment_type || 'WORK',
                        actual_segment_type: seg.actual_segment_type || null,
                        is_unplanned: Boolean(seg.is_unplanned),
                        roster_in: seg.roster_in || null,
                        roster_out: seg.roster_out || null,
                        roster_hours: rHours,
                        actual_in: seg.actual_in || null,
                        actual_out: seg.actual_out || null,
                        actual_hours: aHours,
                        notes: seg.notes || null
                    });
                }
            }

            totalRostered += dayRostered;
            totalActual += dayActual;

            days.push({
                date: dateIso,
                dayIndex: i,
                dayOfWeek: weekday,
                isPublicHoliday,
                holidayName,
                rosteredHours: Math.round(dayRostered * 100) / 100,
                actualHours: Math.round(dayActual * 100) / 100,
                segments
            });
        }

        const contractedHours = Number(employee.contracted_hours || 76);

        res.json({
            success: true,
            data: {
                employee: {
                    id: employee.id,
                    full_name: employee.full_name,
                    department: employee.department,
                    email: employee.email,
                    contracted_hours: contractedHours
                },
                fortnight_start: startDate,
                days,
                submission,
                locks: lock,
                summary: {
                    contracted_hours: contractedHours,
                    worked_hours: Math.round(totalActual * 100) / 100,
                    rostered_hours: Math.round(totalRostered * 100) / 100,
                    difference: Math.round((totalActual - totalRostered) * 100) / 100,
                    variance_contracted: Math.round((totalActual - contractedHours) * 100) / 100,
                    ordinary_weekday_hours: Math.round(ordinaryWeekdayHours * 100) / 100,
                    saturday_hours: Math.round(saturdayHours * 100) / 100,
                    sunday_hours: Math.round(sundayHours * 100) / 100,
                    public_holiday_hours: Math.round(publicHolidayHours * 100) / 100,
                    leave_hours: Math.round(leaveHours * 100) / 100,
                    unplanned_hours: Math.round(unplannedHours * 100) / 100
                }
            }
        });
    } catch (err: any) {
        console.error('[PORTAL ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to retrieve personal timesheet data.' } });
    }
});

/**
 * GET /api/portal/team-roster
 * Allows employees to view the full organisation roster for a fortnight.
 * Strictly ROSTER ONLY: No timesheet actuals or variance data is exposed.
 */
router.get('/team-roster', requireAuth, requireTenantContext, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const startDate = req.query.start_date as string;

        if (!startDate) {
            return res.status(400).json({ success: false, error: { message: 'start_date query parameter is required (YYYY-MM-DD)' } });
        }

        // Fetch fortnight lock & publish status
        const lockRes = await query(
            'SELECT roster_locked, is_published FROM fortnight_locks WHERE org_id = $1 AND start_date = $2',
            [orgId, startDate]
        );
        const lock = lockRes.rows[0] || { roster_locked: false, is_published: false };
        const isPublished = Boolean(lock.is_published) && Boolean(lock.roster_locked);

        if (!isPublished) {
            return res.json({
                success: true,
                data: {
                    is_published: false,
                    fortnight_start: startDate,
                    days: [],
                    team: []
                }
            });
        }

        // Parse fortnight dates (14 days)
        const [y, m, d] = startDate.split('-').map(Number);
        const fnStart = new Date(Date.UTC(y, m - 1, d));

        // Fetch holiday records for this org
        const holidayRes = await query('SELECT id, holiday_date, name FROM public_holidays WHERE org_id = $1', [orgId]);
        const holidayMap = new Map<string, string>();
        holidayRes.rows.forEach((h: any) => holidayMap.set(h.holiday_date, h.name));

        const days: any[] = [];
        for (let i = 0; i < 14; i++) {
            const dayDate = addDays(fnStart, i);
            const dateIso = fmtISO(dayDate);
            days.push({
                date: dateIso,
                dayIndex: i,
                dayOfWeek: getWeekdayName(dateIso),
                isPublicHoliday: holidayMap.has(dateIso),
                holidayName: holidayMap.get(dateIso)
            });
        }

        // Fetch all active employees in org
        const empsRes = await query(
            'SELECT id, full_name, department FROM employees WHERE org_id = $1 AND is_active = true AND deleted_at IS NULL ORDER BY full_name ASC',
            [orgId]
        );
        const employeesList = empsRes.rows;

        // Fetch roster shift segments for all employees in this fortnight using parameterized query
        const endDateIso = days[days.length - 1]?.date || startDate;
        const recordsRes = await query(
            `SELECT dr.id as record_id, dr.employee_id, dr.record_date,
                    ss.id as segment_id, ss.segment_type, ss.roster_in, ss.roster_out, ss.roster_hours
             FROM daily_records dr
             JOIN shift_segments ss ON dr.id = ss.record_id
             WHERE dr.org_id = $1 AND dr.record_date >= $2 AND dr.record_date <= $3`,
            [orgId, startDate, endDateIso]
        );

        // Map employee -> date -> segments
        const rosterMap: Record<string, Record<string, any[]>> = {};
        for (const row of recordsRes.rows) {
            if (!rosterMap[row.employee_id]) {
                rosterMap[row.employee_id] = {};
            }
            if (!rosterMap[row.employee_id][row.record_date]) {
                rosterMap[row.employee_id][row.record_date] = [];
            }
            rosterMap[row.employee_id][row.record_date].push({
                id: row.segment_id,
                segment_type: row.segment_type,
                roster_in: row.roster_in,
                roster_out: row.roster_out,
                roster_hours: Number(row.roster_hours || 0)
            });
        }

        const teamRoster = employeesList.map((emp: any) => {
            const empDays = days.map(day => {
                const segs = (rosterMap[emp.id] && rosterMap[emp.id][day.date]) || [];
                const totalHours = segs.reduce((sum, s) => sum + s.roster_hours, 0);
                return {
                    date: day.date,
                    dayIndex: day.dayIndex,
                    dayOfWeek: day.dayOfWeek,
                    isPublicHoliday: day.isPublicHoliday,
                    holidayName: day.holidayName,
                    rosteredHours: Math.round(totalHours * 100) / 100,
                    segments: segs
                };
            });
            const fortnightTotalHours = empDays.reduce((sum, d) => sum + d.rosteredHours, 0);
            return {
                id: emp.id,
                full_name: emp.full_name,
                department: emp.department || 'General',
                total_rostered_hours: Math.round(fortnightTotalHours * 100) / 100,
                days: empDays
            };
        });

        res.json({
            success: true,
            data: {
                is_published: true,
                fortnight_start: startDate,
                days,
                team: teamRoster
            }
        });
    } catch (err: any) {
        console.error('[PORTAL TEAM ROSTER ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to retrieve team roster.' } });
    }
});

/**
 * POST /api/portal/leave-requests
 * Submit a leave request (Sick, Annual, TIL)
 */
router.post('/leave-requests', requireAuth, requireTenantContext, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const userId = req.user?.id!;
        const { leave_type, start_date, end_date, hours, reason } = req.body;

        if (!leave_type || !start_date || !end_date || hours === undefined) {
            return res.status(400).json({ success: false, error: { message: 'Missing required leave fields' } });
        }

        if (end_date < start_date) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_DATES', message: 'Leave end date cannot be earlier than start date.' }
            });
        }

        const numHours = Number(hours);
        if (isNaN(numHours) || numHours <= 0 || numHours > 336) {
            return res.status(400).json({
                success: false,
                error: { code: 'INVALID_HOURS', message: 'Leave hours must be greater than 0 and not exceed 336 hours.' }
            });
        }

        const validTypes = ['Sick', 'Annual', 'TIL', 'Unpaid', 'Other'];
        if (!validTypes.includes(leave_type)) {
            return res.status(400).json({ success: false, error: { message: `Invalid leave type. Allowed: ${validTypes.join(', ')}` } });
        }

        const empRes = await query('SELECT id, full_name FROM employees WHERE user_id = $1 AND org_id = $2', [userId, orgId]);
        if (empRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: { message: 'No employee record linked to this user.' } });
        }
        const emp = empRes.rows[0];

        // Check if either start_date or end_date falls into a timesheet-locked fortnight
        const startFnIso = getFortnightStartIso(start_date);
        const endFnIso = getFortnightStartIso(end_date);

        const lockCheck = await query(
            'SELECT start_date, timesheet_locked FROM fortnight_locks WHERE org_id = $1 AND start_date IN ($2, $3) AND timesheet_locked = true',
            [orgId, startFnIso, endFnIso]
        );
        if (lockCheck.rows.length > 0) {
            return res.status(403).json({
                success: false,
                error: { code: 'TIMESHEET_LOCKED', message: 'Leave cannot be requested for a period that overlaps a locked timesheet fortnight.' }
            });
        }

        // Check for duplicate pending requests
        const dupCheck = await query(
            `SELECT id FROM leave_requests 
             WHERE org_id = $1 AND employee_id = $2 AND start_date = $3 AND end_date = $4 AND leave_type = $5 AND status = 'Pending'`,
            [orgId, emp.id, start_date, end_date, leave_type]
        );
        if (dupCheck.rows.length > 0) {
            return res.status(400).json({
                success: false,
                error: { code: 'DUPLICATE_REQUEST', message: 'A pending leave request for this period and leave type already exists.' }
            });
        }

        const id = crypto.randomUUID();
        await query(`
            INSERT INTO leave_requests (id, org_id, employee_id, leave_type, start_date, end_date, hours, reason, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending')
        `, [id, orgId, emp.id, leave_type, start_date, end_date, Number(hours), reason || '']);

        // Log to audit
        await query(`
            INSERT INTO audit_logs (id, org_id, actor_id, action, entity_type, entity_id, details, timestamp)
            VALUES ($1, $2, $3, 'LEAVE_REQUESTED', 'leave_requests', $4, $5, NOW())
        `, [
            crypto.randomUUID(),
            orgId,
            userId,
            id,
            JSON.stringify({ employee_name: emp.full_name, leave_type, start_date, end_date, hours })
        ]);

        res.json({ success: true, data: { id, status: 'Pending' } });
    } catch (err: any) {
        console.error('[LEAVE REQUEST ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to submit leave request.' } });
    }
});

/**
 * GET /api/portal/leave-requests
 * Retrieve employee's leave requests
 */
router.get('/leave-requests', requireAuth, requireTenantContext, async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const userId = req.user?.id!;

        const empRes = await query('SELECT id FROM employees WHERE user_id = $1 AND org_id = $2', [userId, orgId]);
        if (empRes.rows.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const result = await query(
            'SELECT * FROM leave_requests WHERE org_id = $1 AND employee_id = $2 ORDER BY created_at DESC',
            [orgId, empRes.rows[0].id]
        );

        res.json({ success: true, data: result.rows });
    } catch (err: any) {
        console.error('[GET LEAVE REQUESTS ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to retrieve leave requests.' } });
    }
});

export default router;
