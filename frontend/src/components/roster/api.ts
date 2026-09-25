import api from '../../services/apiClient';

/** Shapes and small helpers shared by the Roster, Timesheets and Reports pages. */

export interface Worker {
  id: string;
  location_id: string;
  location_name: string | null;
  full_name: string;
  department: string | null;
  contracted_hours: number | string | null;
  is_active: boolean;
}

export interface LockRow {
  location_id: string;
  start_date: string;
  roster_locked: boolean;
  timesheet_locked: boolean;
}

export type TimesheetStatus = 'Draft' | 'Approved' | 'Locked';

export interface TimesheetRow {
  employee_id: string;
  full_name: string;
  department: string | null;
  location_id: string;
  location_name: string | null;
  contracted_hours: number;
  rostered_hours: number;
  actual_hours: number;
  variance_hours: number;
  status: TimesheetStatus;
  submission_id: string | null;
  reviewed_at: string | null;
  timesheet_locked: boolean;
}

export interface CopyDayRequest {
  employee_id: string;
  source_date: string;
  target_dates: string[];
  target_employee_ids?: string[];
}

export interface CopyDayResult {
  copied: Array<{ employee_id: string; date: string }>;
  skipped: Array<{ employee_id: string; date: string; reason: string }>;
}

export interface BulkApproveResult {
  approved: Array<{ employee_id: string }>;
  failed: Array<{ employee_id: string; code: string; message: string }>;
}

// Error and skip-reason wording lives in one place for the whole app.
import { SKIP_REASON_LABEL, skipReason, friendlyError as apiErrorMessage, errorCode as apiErrorCode } from '../../services/errors';
export { SKIP_REASON_LABEL, skipReason, apiErrorMessage, apiErrorCode };

export const signedHours = (n: number, digits = 2): string => `${n > 0 ? '+' : ''}${n.toFixed(digits)}h`;

// ── Payroll exports ────────────────────────────────────────────────────────────────────────────

async function blobErrorMessage(err: unknown, fallback: string): Promise<string> {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      return parsed?.error?.message || parsed?.message || fallback;
    } catch {
      return fallback;
    }
  }
  return apiErrorMessage(err, fallback);
}

/** Downloads the payroll CSV for one pay period, optionally for one branch. */
export async function downloadPayrollCsv(startDate: string, locationId?: string): Promise<void> {
  try {
    const res = await api.get('/reports/export/csv', {
      params: { start_date: startDate, location_id: locationId || undefined },
      responseType: 'blob',
    });
    const disposition = String(res.headers?.['content-disposition'] || '');
    const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] || `Payroll_${startDate}.csv`;
    const url = window.URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    throw new Error(await blobErrorMessage(err, 'The CSV could not be exported.'));
  }
}

/** Opens the printable payroll report (print or save as PDF from the browser). */
export async function openPayrollPrint(startDate: string, locationId?: string): Promise<void> {
  // Open the window straight away, while the click still counts as a user action, so it isn't blocked.
  const printWindow = window.open('', '_blank');
  if (!printWindow) throw new Error('Allow pop-ups for SimpleHours to open the printable report.');
  try {
    const res = await api.get('/reports/export/pdf', { params: { start_date: startDate, location_id: locationId || undefined } });
    printWindow.document.open();
    printWindow.document.write(String(res.data));
    printWindow.document.close();
  } catch (err) {
    printWindow.close();
    throw new Error(apiErrorMessage(err, 'The printable report could not be opened.'));
  }
}
