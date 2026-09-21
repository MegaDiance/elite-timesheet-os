import { Router, Response } from 'express';
import { requireAuth, requireTenantContext, requireAnyPermission, Permission, AuthRequest } from '../middleware/auth';
import { generatePayrollReport, convertReportToCsv, generatePrintableHtml } from '../services/reportService';

const router = Router();
router.use(requireAuth, requireTenantContext);

/**
 * GET /api/reports/payroll
 * Returns JSON aggregation of payroll data for the given fortnight
 */
router.get('/payroll', requireAuth, requireTenantContext, requireAnyPermission([Permission.REPORT_VIEW]), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const startDate = (req.query.start_date || req.query.startDate) as string;

        if (!startDate) {
            return res.status(400).json({ success: false, error: { message: 'start_date query parameter is required (YYYY-MM-DD)' } });
        }

        const report = await generatePayrollReport(orgId, startDate);
        res.json({ success: true, data: report });
    } catch (err: any) {
        console.error('[REPORT PAYROLL ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to generate payroll report.' } });
    }
});

/**
 * GET /api/reports/export/csv
 * Downloads RFC 4180 standard CSV file for accountant / payroll processing
 */
router.get('/export/csv', requireAuth, requireTenantContext, requireAnyPermission([Permission.REPORT_VIEW]), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const startDate = (req.query.start_date || req.query.startDate) as string;

        if (!startDate) {
            return res.status(400).json({ success: false, error: { message: 'start_date query parameter is required (YYYY-MM-DD)' } });
        }

        const report = await generatePayrollReport(orgId, startDate);
        const csv = convertReportToCsv(report);

        const safeOrgName = report.org_name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `Payroll_${safeOrgName}_${startDate}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (err: any) {
        console.error('[REPORT CSV ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to export payroll CSV.' } });
    }
});

/**
 * GET /api/reports/export/pdf
 * Returns a printable HTML document ready for window.print() or headless print-to-pdf
 */
router.get('/export/pdf', requireAuth, requireTenantContext, requireAnyPermission([Permission.REPORT_VIEW]), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const startDate = (req.query.start_date || req.query.startDate) as string;

        if (!startDate) {
            return res.status(400).json({ success: false, error: { message: 'start_date query parameter is required (YYYY-MM-DD)' } });
        }

        const report = await generatePayrollReport(orgId, startDate);
        const html = generatePrintableHtml(report);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err: any) {
        console.error('[REPORT PDF ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to export payroll PDF.' } });
    }
});

export default router;
