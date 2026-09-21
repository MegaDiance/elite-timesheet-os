import { query } from './db';
import { HttpError } from './policy';

export interface PeriodLock {
    roster_locked: boolean;
    timesheet_locked: boolean;
}

/** Lock state of one pay period in one branch. Locks are per branch: one branch never locks another. */
export async function getPeriodLock(orgId: string, branchId: string, startDate: string): Promise<PeriodLock> {
    const res = await query(
        'SELECT roster_locked, timesheet_locked FROM fortnight_locks WHERE org_id = $1 AND location_id = $2 AND start_date = $3',
        [orgId, branchId, startDate]
    );
    return {
        roster_locked: Boolean(res.rows[0]?.roster_locked),
        timesheet_locked: Boolean(res.rows[0]?.timesheet_locked),
    };
}

export const rosterLockedError = () => new HttpError(423, 'ROSTER_LOCKED', 'The roster for this fortnight is locked in this branch.');
export const timesheetLockedError = () => new HttpError(423, 'TIMESHEET_LOCKED', 'Timesheets for this fortnight are locked in this branch.');

export async function isTimesheetApproved(orgId: string, workerId: string, startDate: string): Promise<boolean> {
    const res = await query(
        "SELECT 1 FROM timesheet_submissions WHERE org_id = $1 AND employee_id = $2 AND start_date = $3 AND status = 'Approved'",
        [orgId, workerId, startDate]
    );
    return res.rows.length > 0;
}
