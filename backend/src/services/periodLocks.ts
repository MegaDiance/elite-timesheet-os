import { query } from './db';
import { HttpError } from './policy';

type Run = (text: string, params?: any[]) => Promise<any>;

/**
 * Serialises everything that changes one worker's fortnight (saving a day, approving, reopening)
 * and makes those writes wait for a branch lock/unlock of the same period. Transaction-scoped:
 * released automatically at COMMIT/ROLLBACK. Call first inside the transaction, then re-read the
 * approval and lock state with the same `tx`, so a save can never land after an approval or lock.
 */
export async function lockWorkerPeriod(tx: Run, orgId: string, workerId: string, branchId: string, startDate: string) {
    await tx('SELECT pg_advisory_xact_lock_shared(hashtext($1))', [`period:${orgId}:${branchId}:${startDate}`]);
    await tx('SELECT pg_advisory_xact_lock(hashtext($1))', [`timesheet:${orgId}:${workerId}:${startDate}`]);
}

/** Taken by lock/unlock of a branch period: waits for in-flight day writes in that period. */
export async function lockBranchPeriod(tx: Run, orgId: string, branchId: string, startDate: string) {
    await tx('SELECT pg_advisory_xact_lock(hashtext($1))', [`period:${orgId}:${branchId}:${startDate}`]);
}

export interface PeriodLock {
    roster_locked: boolean;
    timesheet_locked: boolean;
}

/** Lock state of one pay period in one branch. Locks are per branch: one branch never locks another. */
export async function getPeriodLock(orgId: string, branchId: string, startDate: string, run: Run = query): Promise<PeriodLock> {
    const res = await run(
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

export async function isTimesheetApproved(orgId: string, workerId: string, startDate: string, run: Run = query): Promise<boolean> {
    const res = await run(
        "SELECT 1 FROM timesheet_submissions WHERE org_id = $1 AND employee_id = $2 AND start_date = $3 AND status = 'Approved'",
        [orgId, workerId, startDate]
    );
    return res.rows.length > 0;
}
