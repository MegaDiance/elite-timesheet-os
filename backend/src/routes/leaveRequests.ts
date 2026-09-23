import { Router, Response } from 'express';
import { query } from '../services/db';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { badRequest, isUuid, loadWorker, notFound, resolveBranchFilter, writeAudit } from '../services/policy';
import { materializeLeaveRequest } from '../services/leaveRequests';

/**
 * Leave request review (Owner, or the worker's own Branch Admin — the same scope
 * `TIMESHEETS_MANAGE` already grants for every other worker-day action).
 *
 * Requests are created by employees via POST /api/portal/leave-requests. This file only reviews
 * them; when `leave_requests_require_approval` is off, a request is auto-approved and
 * materialized at creation time instead, and never appears here as Pending.
 */
const router = Router();
router.use(requireAuth, requirePermission(Permission.TIMESHEETS_MANAGE));

router.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const branchIds = resolveBranchFilter(ctx, Permission.TIMESHEETS_MANAGE, req.query.location_id);
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;

        const params: any[] = [ctx.orgId, branchIds];
        let sql = `SELECT lr.id, lr.employee_id, e.full_name AS employee_name, lr.location_id, l.name AS location_name,
                          lr.leave_type, lr.start_date, lr.end_date, lr.start_time, lr.end_time, lr.hours, lr.reason,
                          lr.status, lr.reviewed_by, lr.reviewed_at, lr.rejection_reason, lr.created_at
                     FROM leave_requests lr
                     JOIN employees e ON e.id = lr.employee_id
                     JOIN locations l ON l.id = lr.location_id
                    WHERE lr.org_id = $1 AND lr.location_id = ANY($2::uuid[])`;
        if (status) {
            params.push(status);
            sql += ` AND lr.status = $${params.length}`;
        }
        sql += ' ORDER BY lr.created_at DESC';

        res.json({ success: true, data: (await query(sql, params)).rows });
    } catch (err) {
        sendError(res, err, 'LEAVE REQUESTS LIST ERROR');
    }
});

router.post('/:id/review', async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        if (!isUuid(req.params.id)) throw notFound('Leave request');

        const reqRes = await query('SELECT * FROM leave_requests WHERE id = $1 AND org_id = $2', [req.params.id, ctx.orgId]);
        const request = reqRes.rows[0];
        if (!request) throw notFound('Leave request');
        if (request.status !== 'Pending') throw badRequest('ALREADY_REVIEWED', 'This request has already been reviewed.');

        // Authorises the caller against the worker's own branch — a Branch Admin can only review
        // requests from workers in branches assigned to them, exactly like every other worker-day action.
        const worker = await loadWorker(ctx, Permission.TIMESHEETS_MANAGE, request.employee_id);

        const { decision, rejection_reason } = req.body || {};
        if (decision !== 'approve' && decision !== 'reject') throw badRequest('VALIDATION_FAILED', 'decision must be "approve" or "reject".');

        if (decision === 'reject') {
            const reason = typeof rejection_reason === 'string' && rejection_reason.trim() ? rejection_reason.trim().slice(0, 500) : null;
            await query('UPDATE leave_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW(), rejection_reason = $3 WHERE id = $4',
                ['Rejected', ctx.userId, reason, request.id]);
            await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'LEAVE_REQUEST_REJECTED', entityType: 'leave_request', entityId: request.id, targetUserId: null, branchId: worker.location_id, details: reason || undefined });
            return res.json({ success: true, message: 'Leave request rejected.' });
        }

        const result = await materializeLeaveRequest(ctx.orgId, worker, request as any);
        await query('UPDATE leave_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3', ['Approved', ctx.userId, request.id]);
        await writeAudit({
            orgId: ctx.orgId, actorId: ctx.userId, action: 'LEAVE_REQUEST_APPROVED', entityType: 'leave_request', entityId: request.id,
            branchId: worker.location_id, details: result.skipped.length ? `${result.applied.length} day(s) applied, ${result.skipped.length} skipped` : `${result.applied.length} day(s) applied`,
        });
        res.json({
            success: true,
            data: result,
            message: result.skipped.length > 0
                ? `Approved. ${result.applied.length} day(s) updated; ${result.skipped.length} could not be (check locks/approval).`
                : 'Leave request approved.',
        });
    } catch (err) {
        sendError(res, err, 'LEAVE REQUEST REVIEW ERROR');
    }
});

export default router;
