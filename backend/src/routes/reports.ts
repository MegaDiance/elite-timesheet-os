import { Router, Response } from 'express';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { badRequest, resolveBranchFilter, writeAudit } from '../services/policy';
import { isFortnightStart } from '../services/periodUtils';
import { generatePayrollReport, convertReportToCsv, generatePrintableHtml } from '../services/reportService';

/**
 * Payroll-hours reports. The Owner sees every branch; a Branch Admin sees only assigned branches.
 * `location_id` narrows the report to one branch inside that scope.
 */
const router = Router();
router.use(requireAuth);

async function buildReport(req: AuthRequest) {
    const startDate = req.query.start_date;
    if (!isFortnightStart(startDate)) throw badRequest('VALIDATION_FAILED', 'start_date must be the first day of a pay period (YYYY-MM-DD).');
    const branchIds = resolveBranchFilter(req.auth!, Permission.REPORTS_VIEW, req.query.location_id);
    return generatePayrollReport(req.auth!.orgId, startDate, branchIds);
}

router.get('/payroll', requirePermission(Permission.REPORTS_VIEW), async (req: AuthRequest, res: Response) => {
    try {
        res.json({ success: true, data: await buildReport(req) });
    } catch (err) {
        sendError(res, err, 'REPORT ERROR');
    }
});

async function auditExport(req: AuthRequest, format: string, rows: number, period: string) {
    const ctx = req.auth!;
    await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'PAYROLL_EXPORTED', entityType: 'report', details: `${format} export, fortnight ${period}, ${rows} workers` });
}

/** RFC 4180 CSV for payroll processing. */
router.get('/export/csv', requirePermission(Permission.REPORTS_VIEW), async (req: AuthRequest, res: Response) => {
    try {
        const report = await buildReport(req);
        await auditExport(req, 'CSV', report.employees.length, report.fortnight_start);
        const safeOrgName = report.org_name.replace(/[^a-zA-Z0-9_-]/g, '_');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="Payroll_${safeOrgName}_${report.fortnight_start}.csv"`);
        res.send(convertReportToCsv(report));
    } catch (err) {
        sendError(res, err, 'REPORT CSV ERROR');
    }
});

/** Printable HTML document (window.print() → PDF). */
router.get('/export/pdf', requirePermission(Permission.REPORTS_VIEW), async (req: AuthRequest, res: Response) => {
    try {
        const report = await buildReport(req);
        await auditExport(req, 'PDF', report.employees.length, report.fortnight_start);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(generatePrintableHtml(report));
    } catch (err) {
        sendError(res, err, 'REPORT PDF ERROR');
    }
});

export default router;
