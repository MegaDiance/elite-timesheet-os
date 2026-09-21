import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { requireAuth, requirePermission, Permission, AuthRequest, sendError } from '../middleware/auth';
import { badRequest, notFound, writeAudit } from '../services/policy';
import {
    buildXeroAuthUrl,
    getXeroConnectionStatus,
    disconnectXero,
    saveXeroConnection,
    transformPayrollToXeroTimesheets,
    verifyXeroOAuthState
} from '../services/xeroService';
import { generatePayrollReport } from '../services/reportService';
import { isFortnightStart } from '../services/periodUtils';

/**
 * Xero payroll integration. The connection belongs to the organisation, so everything except the
 * OAuth redirect target is for the Organisation Owner only.
 */
const router = Router();

/**
 * GET /api/xero/callback
 * Public: Xero redirects the browser here without our bearer token. The HMAC-signed, expiring
 * state is what proves the round trip started from this server. The response says only whether
 * the state was accepted — never which organisation it belongs to or why it was refused.
 */
router.get('/callback', (req: Request, res: Response) => {
    try {
        const { code, state, error } = req.query;
        if (error) {
            return res.status(400).json({ success: false, error: { code: 'XERO_AUTHORISATION_FAILED', message: 'Xero authorisation was not completed.' } });
        }
        if (typeof state !== 'string' || typeof code !== 'string' || !state || !code) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_FAILED', message: 'Missing code or state parameter.' } });
        }
        const verification = verifyXeroOAuthState(state);
        if (!verification.valid || !verification.orgId) {
            return res.status(403).json({ success: false, error: { code: 'INVALID_OAUTH_STATE', message: 'Invalid or expired OAuth state.' } });
        }
        res.json({ success: true, message: 'OAuth state verified successfully. Connection ready to complete.' });
    } catch (err) {
        sendError(res, err, 'XERO CALLBACK ERROR');
    }
});

const ownerOnly = [requireAuth, requirePermission(Permission.INTEGRATIONS_MANAGE)];

/** GET /api/xero/status — whether this organisation has an active Xero connection. */
router.get('/status', ...ownerOnly, async (req: AuthRequest, res: Response) => {
    try {
        const status = await getXeroConnectionStatus(req.auth!.orgId);
        res.json({ success: true, data: status });
    } catch (err) {
        sendError(res, err, 'XERO STATUS ERROR');
    }
});

/** GET /api/xero/connect — the OAuth 2.0 authorisation URL that starts a Xero connection. */
router.get('/connect', ...ownerOnly, async (req: AuthRequest, res: Response) => {
    try {
        res.json({ success: true, data: { auth_url: buildXeroAuthUrl(req.auth!.orgId) } });
    } catch (err) {
        sendError(res, err, 'XERO CONNECT ERROR');
    }
});

/** POST /api/xero/disconnect — removes the connection and its stored credentials. */
router.post('/disconnect', ...ownerOnly, async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        await disconnectXero(ctx.orgId);
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'XERO_DISCONNECTED', entityType: 'xero_connections', details: JSON.stringify({ disconnected_by: ctx.email }) });
        res.json({ success: true, message: 'Xero disconnected successfully' });
    } catch (err) {
        sendError(res, err, 'XERO DISCONNECT ERROR');
    }
});

/**
 * POST /api/xero/mock-connect
 * Development / staging / automated-test connection without the external OAuth redirect.
 * It does not exist in production.
 */
router.post('/mock-connect', ...ownerOnly, async (req: AuthRequest, res: Response) => {
    try {
        if (process.env.NODE_ENV === 'production') throw notFound();
        const ctx = req.auth!;

        const requestedName = req.body?.tenant_name;
        if (requestedName !== undefined && requestedName !== null && typeof requestedName !== 'string') {
            throw badRequest('VALIDATION_FAILED', 'tenant_name must be text.');
        }
        const mockName = (requestedName || '').trim().slice(0, 120) || 'Acme Demo Organization (Xero)';
        const mockTenantId = 'xero-tenant-' + crypto.randomUUID().slice(0, 8);

        await saveXeroConnection(ctx.orgId, mockTenantId, mockName, 'mock-access-token', 'mock-refresh-token', 1800);
        await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action: 'XERO_CONNECTED', entityType: 'xero_connections', details: JSON.stringify({ tenant_name: mockName, mode: 'mock' }) });
        res.json({ success: true, data: { tenant_id: mockTenantId, tenant_name: mockName } });
    } catch (err) {
        sendError(res, err, 'XERO MOCK CONNECT ERROR');
    }
});

/** GET /api/xero/preview?start_date=YYYY-MM-DD — the fortnight's timesheets in Xero format, for review. */
router.get('/preview', ...ownerOnly, async (req: AuthRequest, res: Response) => {
    try {
        const ctx = req.auth!;
        const startDate = req.query.start_date;
        if (!isFortnightStart(startDate)) throw badRequest('VALIDATION_FAILED', 'start_date must be the first day of a pay period (YYYY-MM-DD).');

        const status = await getXeroConnectionStatus(ctx.orgId);
        // Owner-only route, so the scope is every branch of the organisation.
        const report = await generatePayrollReport(ctx.orgId, startDate, ctx.branchIds);
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
    } catch (err) {
        sendError(res, err, 'XERO PREVIEW ERROR');
    }
});

export default router;
