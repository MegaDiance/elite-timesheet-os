import { query } from './db';
import { fmtISO, addDays } from './periodUtils';
import { classifyShiftHours, getWeekdayName } from './classificationService';

export interface EmployeePayrollSummary {
    employee_id: string;
    full_name: string;
    department: string;
    contracted_hours: number;
    rostered_hours: number;
    actual_hours: number;
    variance_hours: number;
    normal_hours: number;
    saturday_hours: number;
    sunday_hours: number;
    public_holiday_hours: number;
    sick_hours: number;
    annual_hours: number;
    til_hours: number;
    unplanned_hours: number;
    submission_status: string;
}

export interface PayrollReport {
    org_id: string;
    org_name: string;
    fortnight_start: string;
    fortnight_end: string;
    generated_at: string;
    employees: EmployeePayrollSummary[];
    totals: {
        total_contracted: number;
        total_rostered: number;
        total_actual: number;
        total_variance: number;
        total_normal: number;
        total_saturday: number;
        total_sunday: number;
        total_public_holiday: number;
        total_sick: number;
        total_annual: number;
        total_til: number;
        total_unplanned: number;
    };
}

export async function generatePayrollReport(orgId: string, startDate: string): Promise<PayrollReport> {
    const orgRes = await query('SELECT name FROM organisations WHERE id = $1', [orgId]);
    const orgName = orgRes.rows[0]?.name || 'Organization';

    const [y, m, d] = startDate.split('-').map(Number);
    const fnStart = new Date(Date.UTC(y, m - 1, d));
    const fnEnd = addDays(fnStart, 13);
    const endDateIso = fmtISO(fnEnd);

    // Fetch public holidays
    const holRes = await query('SELECT holiday_date, name FROM public_holidays WHERE org_id = $1', [orgId]);
    const holidayMap = new Map<string, string>();
    holRes.rows.forEach((h: any) => holidayMap.set(h.holiday_date, h.name));

    // Fetch employees
    const empRes = await query(
        'SELECT id, full_name, department, contracted_hours FROM employees WHERE org_id = $1 AND is_active = true AND deleted_at IS NULL ORDER BY full_name ASC',
        [orgId]
    );

    // Fetch submissions
    const subRes = await query('SELECT employee_id, status FROM timesheet_submissions WHERE org_id = $1 AND start_date = $2', [orgId, startDate]);
    const subMap = new Map<string, string>();
    subRes.rows.forEach((s: any) => subMap.set(s.employee_id, s.status));

    // Fetch fortnight lock
    const lockRes = await query('SELECT timesheet_locked FROM fortnight_locks WHERE org_id = $1 AND start_date = $2', [orgId, startDate]);
    const isTimesheetLocked = lockRes.rows[0]?.timesheet_locked || false;

    const employeesSummary: EmployeePayrollSummary[] = [];

    const totals = {
        total_contracted: 0,
        total_rostered: 0,
        total_actual: 0,
        total_variance: 0,
        total_normal: 0,
        total_saturday: 0,
        total_sunday: 0,
        total_public_holiday: 0,
        total_sick: 0,
        total_annual: 0,
        total_til: 0,
        total_unplanned: 0
    };

    for (const emp of empRes.rows) {
        let rostered = 0;
        let actual = 0;
        let normal = 0;
        let sat = 0;
        let sun = 0;
        let holiday = 0;
        let sick = 0;
        let annual = 0;
        let til = 0;
        let unplanned = 0;

        for (let i = 0; i < 14; i++) {
            const dayDate = addDays(fnStart, i);
            const dateIso = fmtISO(dayDate);
            const weekday = getWeekdayName(dateIso);
            const isPublicHoliday = holidayMap.has(dateIso);

            const recRes = await query(
                'SELECT id, has_actuals FROM daily_records WHERE org_id = $1 AND employee_id = $2 AND record_date = $3',
                [orgId, emp.id, dateIso]
            );

            if (recRes.rows.length > 0) {
                const rec = recRes.rows[0];
                const segRes = await query('SELECT * FROM shift_segments WHERE record_id = $1', [rec.id]);

                for (const seg of segRes.rows) {
                    const rHours = Number(seg.roster_hours || 0);
                    const aHours = Number(seg.actual_hours || 0);
                    rostered += rHours;
                    actual += aHours;

                    const effectiveType = seg.actual_segment_type || seg.segment_type || 'WORK';
                    const activeHours = (seg.actual_in && seg.actual_out) ? aHours : rHours;

                    if (seg.actual_in && seg.actual_out) {
                        const classified = await classifyShiftHours(orgId, dateIso, seg.actual_in, seg.actual_out, effectiveType);
                        classified.forEach(c => {
                            normal += c.normalHours;
                            sat += c.saturdayHours;
                            sun += c.sundayHours;
                            holiday += c.publicHolidayHours;
                        });
                    } else if (effectiveType === 'WORK') {
                        if (isPublicHoliday) holiday += activeHours;
                        else if (weekday === 'Sat') sat += activeHours;
                        else if (weekday === 'Sun') sun += activeHours;
                        else normal += activeHours;
                    }

                    if (effectiveType === 'Sick') sick += activeHours;
                    else if (effectiveType === 'Annual') annual += activeHours;
                    else if (effectiveType === 'TIL') til += activeHours;

                    if (seg.is_unplanned) {
                        unplanned += activeHours;
                    }
                }
            }
        }

        const contracted = Number(emp.contracted_hours ?? 76);
        const variance = Math.round((actual - contracted) * 100) / 100;
        let status = subMap.get(emp.id) || 'Draft';
        if (isTimesheetLocked && status === 'Approved') {
            status = 'Locked';
        }

        const summary: EmployeePayrollSummary = {
            employee_id: emp.id,
            full_name: emp.full_name,
            department: emp.department || 'General',
            contracted_hours: contracted,
            rostered_hours: Math.round(rostered * 100) / 100,
            actual_hours: Math.round(actual * 100) / 100,
            variance_hours: variance,
            normal_hours: Math.round(normal * 100) / 100,
            saturday_hours: Math.round(sat * 100) / 100,
            sunday_hours: Math.round(sun * 100) / 100,
            public_holiday_hours: Math.round(holiday * 100) / 100,
            sick_hours: Math.round(sick * 100) / 100,
            annual_hours: Math.round(annual * 100) / 100,
            til_hours: Math.round(til * 100) / 100,
            unplanned_hours: Math.round(unplanned * 100) / 100,
            submission_status: status
        };

        employeesSummary.push(summary);

        totals.total_contracted += summary.contracted_hours;
        totals.total_rostered += summary.rostered_hours;
        totals.total_actual += summary.actual_hours;
        totals.total_variance += summary.variance_hours;
        totals.total_normal += summary.normal_hours;
        totals.total_saturday += summary.saturday_hours;
        totals.total_sunday += summary.sunday_hours;
        totals.total_public_holiday += summary.public_holiday_hours;
        totals.total_sick += summary.sick_hours;
        totals.total_annual += summary.annual_hours;
        totals.total_til += summary.til_hours;
        totals.total_unplanned += summary.unplanned_hours;
    }

    // Round totals
    Object.keys(totals).forEach(k => {
        // @ts-ignore
        totals[k] = Math.round(totals[k] * 100) / 100;
    });

    return {
        org_id: orgId,
        org_name: orgName,
        fortnight_start: startDate,
        fortnight_end: endDateIso,
        generated_at: new Date().toISOString(),
        employees: employeesSummary,
        totals
    };
}

export function convertReportToCsv(report: PayrollReport): string {
    const headers = [
        'Employee Name',
        'Department',
        'Contracted (h)',
        'Rostered (h)',
        'Actual Worked (h)',
        'Variance (h)',
        'Normal (h)',
        'Saturday (h)',
        'Sunday (h)',
        'Public Holiday (h)',
        'Sick Leave (h)',
        'Annual Leave (h)',
        'TIL (h)',
        'Unplanned (h)',
        'Timesheet Status'
    ];

    const escapeCsv = (val: any) => {
        if (val === null || val === undefined) return '""';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return `"${str}"`;
    };

    const rows: string[] = [];
    rows.push(headers.join(','));

    report.employees.forEach(emp => {
        rows.push([
            escapeCsv(emp.full_name),
            escapeCsv(emp.department),
            emp.contracted_hours.toFixed(2),
            emp.rostered_hours.toFixed(2),
            emp.actual_hours.toFixed(2),
            emp.variance_hours.toFixed(2),
            emp.normal_hours.toFixed(2),
            emp.saturday_hours.toFixed(2),
            emp.sunday_hours.toFixed(2),
            emp.public_holiday_hours.toFixed(2),
            emp.sick_hours.toFixed(2),
            emp.annual_hours.toFixed(2),
            emp.til_hours.toFixed(2),
            emp.unplanned_hours.toFixed(2),
            escapeCsv(emp.submission_status)
        ].join(','));
    });

    // Add totals row
    rows.push([
        escapeCsv('TOTALS'),
        escapeCsv(''),
        report.totals.total_contracted.toFixed(2),
        report.totals.total_rostered.toFixed(2),
        report.totals.total_actual.toFixed(2),
        report.totals.total_variance.toFixed(2),
        report.totals.total_normal.toFixed(2),
        report.totals.total_saturday.toFixed(2),
        report.totals.total_sunday.toFixed(2),
        report.totals.total_public_holiday.toFixed(2),
        report.totals.total_sick.toFixed(2),
        report.totals.total_annual.toFixed(2),
        report.totals.total_til.toFixed(2),
        report.totals.total_unplanned.toFixed(2),
        escapeCsv('')
    ].join(','));

    return rows.join('\r\n');
}

function escapeHtml(str?: string): string {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function generatePrintableHtml(report: PayrollReport): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Payroll Report - ${escapeHtml(report.org_name)} - ${report.fortnight_start}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 11px; color: #1e293b; padding: 24px; background: #fff; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-b: 2px solid #e2e8f0; padding-bottom: 16px; }
        .title { font-size: 20px; font-weight: 800; margin: 0; color: #0f172a; }
        .subtitle { font-size: 12px; color: #64748b; margin-top: 4px; }
        .meta-box { font-size: 11px; color: #475569; text-align: right; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th { background: #f8fafc; text-align: center; padding: 8px 6px; font-size: 10px; font-weight: 700; color: #475569; text-transform: uppercase; border-bottom: 2px solid #cbd5e1; }
        td { padding: 8px 6px; border-bottom: 1px solid #e2e8f0; text-align: center; font-size: 11px; }
        .text-left { text-align: left; }
        .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
        .badge-approved { background: #dcfce7; color: #15803d; }
        .badge-submitted { background: #dbeafe; color: #1d4ed8; }
        .badge-under_review { background: #fef3c7; color: #b45309; }
        .badge-draft { background: #f3f4f6; color: #4b5563; }
        .badge-rejected { background: #fee2e2; color: #b91c1c; }
        .badge-locked { background: #fef3c7; color: #b45309; }
        .signatures {
            margin-top: 40px;
            display: flex;
            justify-content: space-between;
            page-break-inside: avoid;
        }
        .sig-block {
            width: 42%;
            border-top: 1px solid #94a3b8;
            padding-top: 8px;
        }
        @media print {
            body { padding: 10px; }
            @page { size: landscape; margin: 12mm; }
            .no-print { display: none; }
        }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1 class="title">${escapeHtml(report.org_name)}</h1>
            <p class="subtitle">Fortnight Timesheet & Payroll Hours Summary</p>
        </div>
        <div class="meta-box">
            <div><strong>Period:</strong> ${escapeHtml(report.fortnight_start)} &rarr; ${escapeHtml(report.fortnight_end)}</div>
            <div><strong>Generated:</strong> ${new Date(report.generated_at).toLocaleString()}</div>
            <button class="no-print" onclick="window.print()" style="margin-top:8px; padding:6px 12px; background:#2563eb; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">Print / Save PDF</button>
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th class="text-left">Employee</th>
                <th class="text-left">Department</th>
                <th>Contract</th>
                <th>Roster</th>
                <th>Actual</th>
                <th>Variance</th>
                <th>Normal</th>
                <th>Sat</th>
                <th>Sun</th>
                <th>Pub Hol</th>
                <th>Sick</th>
                <th>Annual</th>
                <th>TIL</th>
                <th>Unplanned</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
            ${report.employees.map(e => `
                <tr>
                    <td class="text-left"><strong>${escapeHtml(e.full_name)}</strong></td>
                    <td class="text-left">${escapeHtml(e.department)}</td>
                    <td>${e.contracted_hours.toFixed(1)}h</td>
                    <td>${e.rostered_hours.toFixed(1)}h</td>
                    <td><strong>${e.actual_hours.toFixed(1)}h</strong></td>
                    <td style="color:${e.variance_hours > 0 ? '#16a34a' : e.variance_hours < 0 ? '#dc2626' : '#4b5563'}">
                        ${e.variance_hours > 0 ? '+' : ''}${e.variance_hours.toFixed(1)}h
                    </td>
                    <td>${e.normal_hours.toFixed(1)}h</td>
                    <td>${e.saturday_hours.toFixed(1)}h</td>
                    <td>${e.sunday_hours.toFixed(1)}h</td>
                    <td>${e.public_holiday_hours.toFixed(1)}h</td>
                    <td>${e.sick_hours.toFixed(1)}h</td>
                    <td>${e.annual_hours.toFixed(1)}h</td>
                    <td>${e.til_hours.toFixed(1)}h</td>
                    <td>${e.unplanned_hours.toFixed(1)}h</td>
                    <td style="text-align:center;">
                        <span class="badge badge-${e.submission_status.toLowerCase().replace(' ', '-')}">${e.submission_status}</span>
                    </td>
                </tr>
            `).join('')}
            <tr class="total-row">
                <td class="text-left">TOTALS</td>
                <td class="text-left">${report.employees.length} Staff</td>
                <td>${report.totals.total_contracted.toFixed(1)}h</td>
                <td>${report.totals.total_rostered.toFixed(1)}h</td>
                <td>${report.totals.total_actual.toFixed(1)}h</td>
                <td>${report.totals.total_variance > 0 ? '+' : ''}${report.totals.total_variance.toFixed(1)}h</td>
                <td>${report.totals.total_normal.toFixed(1)}h</td>
                <td>${report.totals.total_saturday.toFixed(1)}h</td>
                <td>${report.totals.total_sunday.toFixed(1)}h</td>
                <td>${report.totals.total_public_holiday.toFixed(1)}h</td>
                <td>${report.totals.total_sick.toFixed(1)}h</td>
                <td>${report.totals.total_annual.toFixed(1)}h</td>
                <td>${report.totals.total_til.toFixed(1)}h</td>
                <td>${report.totals.total_unplanned.toFixed(1)}h</td>
                <td>-</td>
            </tr>
        </tbody>
    </table>

    <div class="signatures">
        <div class="sig-block">
            <strong>Prepared / Reviewed By (Payroll Officer / Manager):</strong>
            <div style="margin-top: 24px;">Signature: ___________________________ Date: ____________</div>
        </div>
        <div class="sig-block">
            <strong>Authorised By (Director / Executive):</strong>
            <div style="margin-top: 24px;">Signature: ___________________________ Date: ____________</div>
        </div>
    </div>
</body>
</html>`;
}
