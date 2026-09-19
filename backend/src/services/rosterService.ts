import { query } from './db';
import { addDays, fmtISO } from './periodUtils';
import { calcHours } from './timeParser';
import crypto from 'crypto';

export async function calculateRosterStats(orgId: string, employeeId: string, fortnightStart: Date) {
    let rostered = 0;
    let actual = 0;
    let leave = {
        Normal: 0,
        Weekdays: 0,
        Weekends: 0,
        Sick: 0,
        Annual: 0,
        TIL: 0,
        Unplanned: 0
    };

    for (let i = 0; i < 14; i++) {
        const d = addDays(fortnightStart, i);
        const iso = fmtISO(d);
        const isWeekend = (i % 7 >= 5);

        const recRes = await query('SELECT id, has_actuals FROM daily_records WHERE org_id = $1 AND employee_id = $2 AND record_date = $3', [orgId, employeeId, iso]);
        if (recRes.rows.length > 0) {
            const rec = recRes.rows[0];
            const segRes = await query('SELECT * FROM shift_segments WHERE record_id = $1', [rec.id]);
            
            for (const seg of segRes.rows) {
                rostered += Number(seg.roster_hours || 0);
                if (seg.actual_hours > 0) {
                    actual += Number(seg.actual_hours);
                }
                
                const type = seg.actual_segment_type || seg.segment_type;
                const hrs = (rec.has_actuals ? Number(seg.actual_hours || 0) : Number(seg.roster_hours || 0));

                if (['Normal', 'WORK'].includes(type)) {
                    leave.Normal += hrs;
                    if (isWeekend) {
                        leave.Weekends += hrs;
                    } else {
                        leave.Weekdays += hrs;
                    }
                } else if (['Sick', 'Annual', 'TIL'].includes(type)) {
                    // @ts-ignore
                    leave[type] += hrs;
                }
                
                if (seg.is_unplanned) {
                    leave.Unplanned += hrs;
                }
            }
        }
    }

    const empRes = await query('SELECT contracted_hours FROM employees WHERE id = $1 AND org_id = $2', [employeeId, orgId]);
    const contracted = Number(empRes.rows[0]?.contracted_hours || 76);

    const rRostered = Math.round(rostered * 100) / 100;
    const rActual = Math.round(actual * 100) / 100;
    const rVariance = Math.round((rActual - contracted) * 100) / 100;
    const rLeave = {
        Normal: Math.round(leave.Normal * 100) / 100,
        Weekdays: Math.round(leave.Weekdays * 100) / 100,
        Weekends: Math.round(leave.Weekends * 100) / 100,
        Sick: Math.round(leave.Sick * 100) / 100,
        Annual: Math.round(leave.Annual * 100) / 100,
        TIL: Math.round(leave.TIL * 100) / 100,
        Unplanned: Math.round(leave.Unplanned * 100) / 100
    };

    return { rostered: rRostered, actual: rActual, contracted, variance: rVariance, leave: rLeave };
}

export async function autoRosterAll(orgId: string, fortnightStart: Date, selectedDays?: number[], actorId?: string) {
    let orgSettings = { break_mins_weekday: 30, break_mins_weekend: 0, break_threshold_hours: 6 };
    try {
        const orgRes = await query('SELECT break_mins_weekday, break_mins_weekend, break_threshold_hours FROM organisations WHERE id = $1', [orgId]);
        if (orgRes.rows[0]) {
            orgSettings = {
                break_mins_weekday: orgRes.rows[0].break_mins_weekday ?? 30,
                break_mins_weekend: orgRes.rows[0].break_mins_weekend ?? 0,
                break_threshold_hours: orgRes.rows[0].break_threshold_hours ?? 6
            };
        }
    } catch {
        // Fallback to default break settings if columns do not exist in temporary mock schemas
    }

    const emps = await query('SELECT id FROM employees WHERE org_id = $1 AND is_active = true AND deleted_at IS NULL', [orgId]);
    const targetDays = selectedDays && selectedDays.length > 0 ? selectedDays : Array.from({ length: 14 }, (_, i) => i);
    const startIso = fmtISO(fortnightStart);

    // Identify employees with approved/locked timesheets for this fortnight to protect them from mutation
    let lockedEmpIds = new Set<string>();
    try {
        const approvedSubs = await query(
            "SELECT employee_id FROM timesheet_submissions WHERE org_id = $1 AND start_date = $2 AND status IN ('Approved', 'Locked')",
            [orgId, startIso]
        );
        lockedEmpIds = new Set(approvedSubs.rows.map((r: any) => r.employee_id));
    } catch {
        // Safe fallback if table not yet migrated in mock environments
    }
    
    for (const emp of emps.rows) {
        const empId = emp.id;
        if (lockedEmpIds.has(empId)) {
            // Strictly preserve approved timesheet records
            continue;
        }
        const templates = await query('SELECT * FROM roster_templates WHERE employee_id = $1', [empId]);
        const hasTemplates = templates.rows.some((t: any) => t.roster_in && t.roster_out);

        for (const i of targetDays) {
            const dateIso = fmtISO(addDays(fortnightStart, i));
            const dayTemplates = templates.rows.filter((t: any) => t.day_index === i && t.roster_in && t.roster_out);
            const isWeekday = (i % 7 >= 1 && i % 7 <= 5);
            const shiftsToApply = dayTemplates.length > 0
                ? dayTemplates
                : (!hasTemplates ? [{ segment_type: 'WORK', roster_in: '09:00', roster_out: '17:00', roster_hours: calcHours('09:00', '17:00', { breakMins: isWeekday ? Number(orgSettings.break_mins_weekday) : Number(orgSettings.break_mins_weekend), breakThresholdHours: Number(orgSettings.break_threshold_hours) }) }] : []);

            if (shiftsToApply.length > 0) {
                let recId;
                const existing = await query('SELECT id FROM daily_records WHERE org_id = $1 AND employee_id = $2 AND record_date = $3', [orgId, empId, dateIso]);
                
                let savedActuals: any[] = [];
                if (existing.rows.length === 0) {
                    recId = crypto.randomUUID();
                    await query('INSERT INTO daily_records (id, org_id, employee_id, record_date) VALUES ($1, $2, $3, $4)', [recId, orgId, empId, dateIso]);
                } else {
                    recId = existing.rows[0].id;
                    const existingSegs = await query('SELECT * FROM shift_segments WHERE record_id = $1', [recId]);
                    savedActuals = existingSegs.rows.map((s: any) => ({
                        actual_in: s.actual_in,
                        actual_out: s.actual_out,
                        actual_hours: s.actual_hours,
                        actual_segment_type: s.actual_segment_type
                    }));
                    await query('DELETE FROM shift_segments WHERE record_id = $1', [recId]);
                }

                for (let idx = 0; idx < shiftsToApply.length; idx++) {
                    const t = shiftsToApply[idx];
                    const prevAct = savedActuals[idx] || {};
                    const defaultHours = (t.roster_in && t.roster_out)
                        ? calcHours(t.roster_in, t.roster_out, { breakMins: isWeekday ? Number(orgSettings.break_mins_weekday) : Number(orgSettings.break_mins_weekend), breakThresholdHours: Number(orgSettings.break_threshold_hours) })
                        : 7.5;

                    await query(`
                        INSERT INTO shift_segments (id, record_id, segment_type, roster_in, roster_out, roster_hours, actual_in, actual_out, actual_hours, actual_segment_type)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    `, [
                        crypto.randomUUID(), 
                        recId, 
                        t.segment_type || 'WORK', 
                        t.roster_in, 
                        t.roster_out, 
                        Math.round(Number(t.roster_hours || defaultHours) * 100) / 100,
                        prevAct.actual_in || null,
                        prevAct.actual_out || null,
                        Math.round(Number(prevAct.actual_hours || 0) * 100) / 100,
                        prevAct.actual_segment_type || null
                    ]);
                }
            }
        }
    }
    
    if (actorId) {
        await query(
            `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, details) VALUES ($1, $2, $3, $4, $5, $6)`,
            [crypto.randomUUID(), orgId, new Date().toISOString(), actorId, 'AUTO_ROSTER', JSON.stringify({ message: `Applied templates for fortnight starting ${fmtISO(fortnightStart)}` })]
        );
    }
}

export async function autoLogAll(orgId: string, fortnightStart: Date, selectedDays?: number[], actorId?: string) {
    const emps = await query('SELECT id FROM employees WHERE org_id = $1 AND is_active = true AND deleted_at IS NULL', [orgId]);
    const targetDays = selectedDays && selectedDays.length > 0 ? selectedDays : Array.from({ length: 14 }, (_, i) => i);
    const startIso = fmtISO(fortnightStart);

    let lockedEmpIds = new Set<string>();
    try {
        const approvedSubs = await query(
            "SELECT employee_id FROM timesheet_submissions WHERE org_id = $1 AND start_date = $2 AND status IN ('Approved', 'Locked')",
            [orgId, startIso]
        );
        lockedEmpIds = new Set(approvedSubs.rows.map((r: any) => r.employee_id));
    } catch {
        // Safe fallback if table not yet migrated
    }
    
    for (const emp of emps.rows) {
        const empId = emp.id;
        if (lockedEmpIds.has(empId)) {
            // Strictly preserve approved timesheet records
            continue;
        }
        for (const i of targetDays) {
            const dateIso = fmtISO(addDays(fortnightStart, i));
            const existing = await query('SELECT id, has_actuals FROM daily_records WHERE org_id = $1 AND employee_id = $2 AND record_date = $3', [orgId, empId, dateIso]);
            
            if (existing.rows.length > 0) {
                const recId = existing.rows[0].id;
                const segments = await query('SELECT * FROM shift_segments WHERE record_id = $1', [recId]);
                
                let hasActual = false;
                for (const seg of segments.rows) {
                    if (seg.roster_in && seg.roster_out) {
                        hasActual = true;
                        await query(`
                            UPDATE shift_segments 
                            SET actual_in = roster_in, actual_out = roster_out, actual_hours = roster_hours, actual_segment_type = segment_type
                            WHERE id = $1
                        `, [seg.id]);
                    }
                }
                
                if (hasActual) {
                    await query('UPDATE daily_records SET has_actuals = true WHERE id = $1', [recId]);
                }
            }
        }
    }
    
    if (actorId) {
        await query(
            `INSERT INTO audit_logs (id, org_id, timestamp, actor_id, action, details) VALUES ($1, $2, $3, $4, $5, $6)`,
            [crypto.randomUUID(), orgId, new Date().toISOString(), actorId, 'AUTO_LOG', JSON.stringify({ message: `Auto-logged all shifts for fortnight starting ${fmtISO(fortnightStart)}` })]
        );
    }
}
