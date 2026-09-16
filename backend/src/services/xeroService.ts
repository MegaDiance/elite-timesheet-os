import { query } from './db';
import { PayrollReport, EmployeePayrollSummary } from './reportService';
import crypto from 'crypto';

export interface XeroConnectionStatus {
    connected: boolean;
    tenant_name?: string;
    tenant_id?: string;
    connected_at?: string;
}

export interface XeroTimesheetLine {
    earnings_rate: string;
    tracking_category?: string;
    number_of_units: number;
}

export interface XeroTimesheetPayload {
    employee_id: string;
    employee_name: string;
    department: string;
    start_date: string;
    end_date: string;
    status: 'DRAFT' | 'APPROVED';
    lines: XeroTimesheetLine[];
    total_hours: number;
}

export function buildXeroAuthUrl(orgId: string): string {
    const clientId = process.env.XERO_CLIENT_ID || 'DEMO_CLIENT_ID';
    const redirectUri = encodeURIComponent(process.env.XERO_REDIRECT_URI || 'http://localhost:4000/api/xero/callback');
    const scope = encodeURIComponent('openid profile email accounting.transactions accounting.settings accounting.payroll.au offline_access');
    const state = encodeURIComponent(Buffer.from(JSON.stringify({ orgId, nonce: crypto.randomUUID() })).toString('base64'));

    return `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`;
}

export async function getXeroConnectionStatus(orgId: string): Promise<XeroConnectionStatus> {
    const res = await query('SELECT tenant_name, tenant_id, connected_at, expires_at FROM xero_connections WHERE org_id = $1', [orgId]);
    if (res.rows.length === 0) {
        return { connected: false };
    }
    const row = res.rows[0];
    return {
        connected: true,
        tenant_name: row.tenant_name || 'Connected Xero Organization',
        tenant_id: row.tenant_id,
        connected_at: row.connected_at
    };
}

export async function disconnectXero(orgId: string): Promise<boolean> {
    await query('DELETE FROM xero_connections WHERE org_id = $1', [orgId]);
    return true;
}

export async function saveXeroConnection(orgId: string, tenantId: string, tenantName: string, accessToken: string, refreshToken: string, expiresInSec: number): Promise<void> {
    const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();
    const existing = await query('SELECT id FROM xero_connections WHERE org_id = $1', [orgId]);

    if (existing.rows.length > 0) {
        await query(`
            UPDATE xero_connections
            SET tenant_id = $1, tenant_name = $2, access_token = $3, refresh_token = $4, expires_at = $5, connected_at = NOW()
            WHERE org_id = $6
        `, [tenantId, tenantName, accessToken, refreshToken, expiresAt, orgId]);
    } else {
        await query(`
            INSERT INTO xero_connections (id, org_id, tenant_id, tenant_name, access_token, refresh_token, expires_at, connected_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `, [crypto.randomUUID(), orgId, tenantId, tenantName, accessToken, refreshToken, expiresAt]);
    }
}

/**
 * Transforms standard PayrollReport into Xero Timesheet preparation payload.
 * Strictly formats time units (Normal, Saturday, Sunday, Public Holiday, Leave)
 * without calculating dollar pay or legal multipliers.
 */
export function transformPayrollToXeroTimesheets(report: PayrollReport): XeroTimesheetPayload[] {
    return report.employees.map(emp => {
        const lines: XeroTimesheetLine[] = [];

        if (emp.normal_hours > 0) {
            lines.push({ earnings_rate: 'Ordinary Hours', tracking_category: emp.department, number_of_units: emp.normal_hours });
        }
        if (emp.saturday_hours > 0) {
            lines.push({ earnings_rate: 'Saturday Ordinary Hours', tracking_category: emp.department, number_of_units: emp.saturday_hours });
        }
        if (emp.sunday_hours > 0) {
            lines.push({ earnings_rate: 'Sunday Ordinary Hours', tracking_category: emp.department, number_of_units: emp.sunday_hours });
        }
        if (emp.public_holiday_hours > 0) {
            lines.push({ earnings_rate: 'Public Holiday Worked', tracking_category: emp.department, number_of_units: emp.public_holiday_hours });
        }
        if (emp.sick_hours > 0) {
            lines.push({ earnings_rate: 'Sick Leave', tracking_category: emp.department, number_of_units: emp.sick_hours });
        }
        if (emp.annual_hours > 0) {
            lines.push({ earnings_rate: 'Annual Leave', tracking_category: emp.department, number_of_units: emp.annual_hours });
        }
        if (emp.til_hours > 0) {
            lines.push({ earnings_rate: 'Time in Lieu (TIL)', tracking_category: emp.department, number_of_units: emp.til_hours });
        }

        const totalHours = Math.round(lines.reduce((acc, l) => acc + l.number_of_units, 0) * 100) / 100;
        const status = (emp.submission_status === 'Approved' || emp.submission_status === 'Locked') ? 'APPROVED' : 'DRAFT';

        return {
            employee_id: emp.employee_id,
            employee_name: emp.full_name,
            department: emp.department,
            start_date: report.fortnight_start,
            end_date: report.fortnight_end,
            status,
            lines,
            total_hours: totalHours
        };
    });
}
