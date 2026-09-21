import { Router, Response } from 'express';
import { requireAuth, requireTenantContext, requireAnyPermission, Permission, AuthRequest } from '../middleware/auth';
import {
    buildXeroAuthUrl,
    getXeroConnectionStatus,
    disconnectXero,
    saveXeroConnection,
    transformPayrollToXeroTimesheets,
    verifyXeroOAuthState
} from '../services/xeroService';
import { generatePayrollReport } from '../services/reportService';
import { query } from '../services/db';
import crypto from 'crypto';

const router = Router();

/**
 * GET /api/xero/callback
 * Handles OAuth 2.0 callback from Xero, validates HMAC state signature, and prevents CSRF
 */
router.get('/callback', async (req: any, res: Response) => {
    try {
        const { code, state, error } = req.query;
        if (error) {
            return res.status(400).json({ success: false, error: { message: `Xero authorization failed: ${error}` } });
        }
        if (!state || !code) {
            return res.status(400).json({ success: false, error: { message: 'Missing code or state parameter.' } });
        }
        const stateVerification = verifyXeroOAuthState(state as string);
        if (!stateVerification.valid || !stateVerification.orgId) {
            return res.status(403).json({ success: false, error: { message: `Invalid or expired OAuth state: ${stateVerification.reason}` } });
        }

        res.json({
            success: true,
            message: 'OAuth state verified successfully. Connection ready to complete.',
            data: { org_id: stateVerification.orgId }
        });
    } catch (err: any) {
        console.error('[XERO CALLBACK ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to process Xero callback.' } });
    }
});

/**
 * GET /api/xero/status
 * Check if the current tenant has an active Xero connection
 */
router.get('/status', requireAuth, requireTenantContext, requireAnyPermission([Permission.ORGANISATION_VIEW]), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const status = await getXeroConnectionStatus(orgId);
        res.json({ success: true, data: status });
    } catch (err: any) {
        console.error('[XERO STATUS ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to retrieve Xero connection status.' } });
    }
});

/**
 * GET /api/xero/connect
 * Generates OAuth 2.0 Authorization URL to initiate Xero connection
 */
router.get('/connect', requireAuth, requireTenantContext, requireAnyPermission([Permission.ORGANISATION_UPDATE]), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const authUrl = buildXeroAuthUrl(orgId);
        res.json({ success: true, data: { auth_url: authUrl } });
    } catch (err: any) {
        console.error('[XERO CONNECT ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to generate Xero authorization URL.' } });
    }
});

/**
 * POST /api/xero/disconnect
 * Removes Xero connection and revokes credentials
 */
router.post('/disconnect', requireAuth, requireTenantContext, requireAnyPermission([Permission.ORGANISATION_UPDATE]), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        await disconnectXero(orgId);

        // Audit log
        await query(`
            INSERT INTO audit_logs (id, org_id, actor_id, action, entity_type, details, timestamp)
            VALUES ($1, $2, $3, 'XERO_DISCONNECTED', 'xero_connections', $4, NOW())
        `, [crypto.randomUUID(), orgId, req.user?.id, JSON.stringify({ disconnected_by: req.user?.email })]);

        res.json({ success: true, message: 'Xero disconnected successfully' });
    } catch (err: any) {
        console.error('[XERO DISCONNECT ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to disconnect Xero.' } });
    }
});

/**
 * POST /api/xero/mock-connect
 * Facilitates dev / staging / automated testing connection without external OAuth redirect
 */
router.post('/mock-connect', requireAuth, requireTenantContext, requireAnyPermission([Permission.ORGANISATION_UPDATE]), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const { tenant_name } = req.body;
        const mockTenantId = 'xero-tenant-' + crypto.randomUUID().slice(0, 8);
        const mockName = tenant_name || 'Acme Demo Organization (Xero)';

        await saveXeroConnection(orgId, mockTenantId, mockName, 'mock-access-token', 'mock-refresh-token', 1800);

        await query(`
            INSERT INTO audit_logs (id, org_id, actor_id, action, entity_type, details, timestamp)
            VALUES ($1, $2, $3, 'XERO_CONNECTED', 'xero_connections', $4, NOW())
        `, [crypto.randomUUID(), orgId, req.user?.id, JSON.stringify({ tenant_name: mockName, mode: 'mock' })]);

        res.json({ success: true, data: { tenant_id: mockTenantId, tenant_name: mockName } });
    } catch (err: any) {
        console.error('[XERO MOCK CONNECT ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to establish test Xero connection.' } });
    }
});

/**
 * GET /api/xero/preview
 * Previews timesheets transformed into Xero format for manager review
 */
router.get('/preview', requireAuth, requireTenantContext, requireAnyPermission([Permission.ORGANISATION_VIEW]), async (req: AuthRequest, res: Response) => {
    try {
        const orgId = req.user?.organisation_id!;
        const startDate = req.query.start_date as string;

        if (!startDate) {
            return res.status(400).json({ success: false, error: { message: 'start_date query parameter required' } });
        }

        const status = await getXeroConnectionStatus(orgId);
        const report = await generatePayrollReport(orgId, startDate);
        const timesheets = transformPayrollToXeroTimesheets(report);

        res.json({
            success: true,
            data: {
                is_xero_connected: status.connected,
                connected_tenant: status.tenant_name,
                fortnight_start: report.fortnight_start,
                fortnight_end: report.fortnight_end,
                timesheet_count: timesheets.length,
                timesheets
            }
        });
    } catch (err: any) {
        console.error('[XERO PREVIEW ERROR]', err);
        res.status(500).json({ success: false, error: { message: 'Failed to preview Xero timesheets.' } });
    }
});

export default router;
