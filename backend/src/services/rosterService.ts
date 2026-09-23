import crypto from 'crypto';
import { query, withTransaction } from './db';
import { addDays, fmtISO, parseIsoDateUtc } from './periodUtils';
import { writeAudit } from './policy';
import { SEGMENT_TYPES, breakRuleFor, isWeekendDate, loadBreakSettings, normaliseDaySegments } from './segments';

/**
 * Fortnight totals for one worker (the caller has already authorised access to that worker).
 */
export async function calculateRosterStats(orgId: string, workerId: string, fortnightStartIso: string) {
    const endIso = fmtISO(addDays(parseIsoDateUtc(fortnightStartIso), 13));
    const segRes = await query(
        `SELECT dr.record_date, dr.has_actuals, ss.segment_type, ss.actual_segment_type, ss.roster_hours, ss.actual_hours, ss.is_unplanned
           FROM daily_records dr JOIN shift_segments ss ON ss.record_id = dr.id
          WHERE dr.org_id = $1 AND dr.employee_id = $2 AND dr.record_date >= $3 AND dr.record_date <= $4`,
        [orgId, workerId, fortnightStartIso, endIso]
    );

    let rostered = 0;
    let actual = 0;
    const byType: Record<string, number> = Object.fromEntries(SEGMENT_TYPES.map(t => [t, 0]));
    let weekdays = 0;
    let weekends = 0;
    let unplanned = 0;

    for (const seg of segRes.rows) {
        rostered += Number(seg.roster_hours || 0);
        actual += Number(seg.actual_hours || 0);

        const type = (seg.has_actuals && seg.actual_segment_type) || seg.segment_type;
        const hrs = seg.has_actuals ? Number(seg.actual_hours || 0) : Number(seg.roster_hours || 0);
        byType[type] = (byType[type] || 0) + hrs;
        if (type === 'WORK') {
            if (isWeekendDate(String(seg.record_date))) weekends += hrs; else weekdays += hrs;
        }
        if (seg.is_unplanned) unplanned += hrs;
    }

    const empRes = await query('SELECT contracted_hours FROM employees WHERE id = $1 AND org_id = $2', [workerId, orgId]);
    const contracted = Number(empRes.rows[0]?.contracted_hours ?? 76);
    const round2 = (n: number) => Math.round(n * 100) / 100;

    return {
        rostered: round2(rostered),
        actual: round2(actual),
        contracted,
        variance: round2(actual - contracted),
        leave: {
            Normal: round2(byType.WORK),
            Weekdays: round2(weekdays),
            Weekends: round2(weekends),
            Sick: round2(byType.Sick),
            Annual: round2(byType.Annual),
            TIL: round2(byType.TIL),
            LWIP: round2(byType.LWIP),
            Other: round2(byType.Other),
            Unplanned: round2(unplanned),
        },
    };
}

interface BulkScope {
    orgId: string;
    /** Branches the caller is authorised for — resolved by the route, never taken from the client. */
    branchIds: string[];
    fortnightStartIso: string;
    selectedDays?: number[];
    actorId: string;
}

function targetDayIndexes(selectedDays?: number[]): number[] {
    const all = Array.from({ length: 14 }, (_, i) => i);
    if (!Array.isArray(selectedDays) || selectedDays.length === 0) return all;
    return all.filter(i => selectedDays.includes(i));
}

/** Workers in scope whose period can still be changed: active, not approved, and in a branch that is not locked. */
async function editableWorkers(scope: BulkScope, lockColumn: 'roster_locked' | 'timesheet_locked') {
    const res = await query(
        `SELECT e.id
           FROM employees e
          WHERE e.org_id = $1 AND e.location_id = ANY($2::uuid[]) AND e.is_active = true
            AND NOT EXISTS (SELECT 1 FROM timesheet_submissions ts
                             WHERE ts.org_id = e.org_id AND ts.employee_id = e.id AND ts.start_date = $3 AND ts.status = 'Approved')
            AND NOT EXISTS (SELECT 1 FROM fortnight_locks fl
                             WHERE fl.org_id = e.org_id AND fl.location_id = e.location_id AND fl.start_date = $3 AND fl.${lockColumn} = true)`,
        [scope.orgId, scope.branchIds, scope.fortnightStartIso]
    );
    return res.rows.map((r: any) => r.id as string);
}

const hasWorkedSide = (seg: any) => Boolean(seg.actual_in) || Number(seg.actual_hours) > 0;

/**
 * Applies each worker's default roster template to the selected days.
 *
 * Rostering never overwrites or deletes worked hours: segments that already hold worked hours are
 * kept (with their notes) and only their rostered side is replaced. A worked segment with no
 * matching template shift keeps its hours and becomes an unplanned shift.
 */
export async function autoRosterAll(scope: BulkScope): Promise<{ workers: number }> {
    const settings = await loadBreakSettings(scope.orgId);
    const fortnightStart = parseIsoDateUtc(scope.fortnightStartIso);
    const workerIds = await editableWorkers(scope, 'roster_locked');

    for (const workerId of workerIds) {
        const templates = (await query(
            'SELECT day_index, segment_type, roster_in, roster_out, has_break FROM roster_templates WHERE employee_id = $1 AND roster_in IS NOT NULL AND roster_out IS NOT NULL ORDER BY day_index, roster_in',
            [workerId]
        )).rows;

        for (const dayIndex of targetDayIndexes(scope.selectedDays)) {
            const dayTemplates = templates.filter((t: any) => t.day_index === dayIndex);
            // A worker with no template at all gets the standard 09:00–17:00 shift.
            const dateIso = fmtISO(addDays(fortnightStart, dayIndex));
            const shifts = dayTemplates.length > 0
                ? dayTemplates
                : (templates.length === 0 ? [{ segment_type: 'WORK', roster_in: '09:00', roster_out: '17:00' }] : []);
            if (shifts.length === 0) continue;

            const planned = normaliseDaySegments(
                shifts.map((t: any) => ({ segment_type: t.segment_type, roster_in: t.roster_in, roster_out: t.roster_out, has_break: t.has_break })),
                breakRuleFor(settings, dateIso)
            ).segments;

            await withTransaction(async (tx) => {
                const recRes = await tx(
                    `INSERT INTO daily_records (id, org_id, employee_id, record_date) VALUES ($1, $2, $3, $4)
                     ON CONFLICT (org_id, employee_id, record_date) DO UPDATE SET record_date = EXCLUDED.record_date
                     RETURNING id`,
                    [crypto.randomUUID(), scope.orgId, workerId, dateIso]
                );
                const recordId = recRes.rows[0].id;
                const existing = (await tx('SELECT * FROM shift_segments WHERE record_id = $1 ORDER BY COALESCE(actual_in, roster_in) ASC NULLS LAST, id ASC', [recordId])).rows;
                const worked = existing.filter(hasWorkedSide);
                const unworkedIds = existing.filter((s: any) => !hasWorkedSide(s)).map((s: any) => s.id);
                if (unworkedIds.length > 0) await tx('DELETE FROM shift_segments WHERE id = ANY($1::uuid[])', [unworkedIds]);

                for (let i = 0; i < planned.length; i++) {
                    const shift = planned[i];
                    if (worked[i]) {
                        await tx(
                            'UPDATE shift_segments SET segment_type = $1, roster_in = $2, roster_out = $3, roster_hours = $4, is_unplanned = false, has_break = $5 WHERE id = $6',
                            [shift.segment_type, shift.roster_in, shift.roster_out, shift.roster_hours, shift.has_break, worked[i].id]
                        );
                    } else {
                        await tx(
                            'INSERT INTO shift_segments (id, record_id, segment_type, roster_in, roster_out, roster_hours, has_break) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                            [crypto.randomUUID(), recordId, shift.segment_type, shift.roster_in, shift.roster_out, shift.roster_hours, shift.has_break]
                        );
                    }
                }
                for (const extra of worked.slice(planned.length)) {
                    await tx('UPDATE shift_segments SET roster_in = NULL, roster_out = NULL, roster_hours = 0, is_unplanned = true WHERE id = $1', [extra.id]);
                }
            });
        }
    }

    await writeAudit({ orgId: scope.orgId, actorId: scope.actorId, action: 'AUTO_ROSTER', details: `Applied roster templates for the fortnight starting ${scope.fortnightStartIso} (${workerIds.length} workers)` });
    return { workers: workerIds.length };
}

/**
 * Copies the roster into worked hours for the selected days: the whole rostered day, timed and
 * hours-only entries alike. Only days with no worked time at all are filled, so recorded hours are
 * never overwritten and never overlapped by copied times.
 */
export async function autoLogAll(scope: BulkScope): Promise<{ workers: number }> {
    const fortnightStart = parseIsoDateUtc(scope.fortnightStartIso);
    const workerIds = await editableWorkers(scope, 'timesheet_locked');
    const dates = targetDayIndexes(scope.selectedDays).map(i => fmtISO(addDays(fortnightStart, i)));

    if (workerIds.length > 0 && dates.length > 0) {
        await withTransaction(async (tx) => {
            const updated = await tx(
                `UPDATE shift_segments ss
                    SET actual_in = ss.roster_in, actual_out = ss.roster_out, actual_hours = ss.roster_hours, actual_segment_type = ss.segment_type
                   FROM daily_records dr
                  WHERE dr.id = ss.record_id AND dr.org_id = $1 AND dr.employee_id = ANY($2::uuid[]) AND dr.record_date = ANY($3::date[])
                    AND ((ss.roster_in IS NOT NULL AND ss.roster_out IS NOT NULL) OR COALESCE(ss.roster_hours, 0) > 0)
                    AND NOT EXISTS (SELECT 1 FROM shift_segments w
                                     WHERE w.record_id = dr.id AND (w.actual_in IS NOT NULL OR COALESCE(w.actual_hours, 0) > 0))
                  RETURNING ss.record_id`,
                [scope.orgId, workerIds, dates]
            );
            const recordIds = Array.from(new Set(updated.rows.map((r: any) => r.record_id)));
            if (recordIds.length > 0) await tx('UPDATE daily_records SET has_actuals = true WHERE id = ANY($1::uuid[])', [recordIds]);
        });
    }

    await writeAudit({ orgId: scope.orgId, actorId: scope.actorId, action: 'AUTO_LOG', details: `Copied roster to worked hours for the fortnight starting ${scope.fortnightStartIso} (${workerIds.length} workers)` });
    return { workers: workerIds.length };
}
