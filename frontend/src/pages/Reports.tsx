import { useState, useEffect, useMemo } from 'react';
import { 
  Download, 
  Printer, 
  RefreshCw, 
  ChevronLeft, 
  ChevronRight, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  Users
} from 'lucide-react';
import api from '../services/apiClient';
import { 
  Button, 
  Badge, 
  Card, 
  Table, 
  TableHeader, 
  TableBody, 
  TableRow, 
  TableHead, 
  TableCell, 
  Tabs, 
  EmptyState 
} from '../components/ui';

interface EmployeePayrollSummary {
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

interface PayrollReport {
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

// Calculate fortnight start date from reference anchor 2026-03-29
function getFortnightStart(d: Date): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const dateNum = d.getUTCDate();
  const utcDate = new Date(Date.UTC(y, m, dateNum));
  const ref = new Date(Date.UTC(2026, 2, 29)); // 2026-03-29 reference anchor
  const diff = Math.floor((utcDate.getTime() - ref.getTime()) / 86400000);
  const offset = Math.floor(diff / 14);
  return new Date(ref.getTime() + offset * 14 * 86400000);
}

function formatDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
}

function formatPeriodLabel(startDateIso: string): string {
  const [y, m, d] = startDateIso.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = addDays(start, 13);
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
  return `${start.toLocaleDateString('en-AU', options)} – ${end.toLocaleDateString('en-AU', options)}`;
}

export default function Reports() {
  const [selectedStartDate, setSelectedStartDate] = useState<string>(() => {
    return formatDateStr(getFortnightStart(new Date()));
  });
  const [report, setReport] = useState<PayrollReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [exportingCsv, setExportingCsv] = useState<boolean>(false);
  const [exportingPdf, setExportingPdf] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('summary');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
  const [error, setError] = useState<string | null>(null);

  // Generate a list of recent and upcoming pay periods (6 past, current, 4 future)
  const payPeriods = useMemo(() => {
    const currentFn = getFortnightStart(new Date());
    const periods: { value: string; label: string }[] = [];
    for (let i = -6; i <= 4; i++) {
      const pStart = addDays(currentFn, i * 14);
      const iso = formatDateStr(pStart);
      const isCurrent = iso === formatDateStr(currentFn);
      periods.push({
        value: iso,
        label: `${formatPeriodLabel(iso)}${isCurrent ? ' (Current)' : ''}`,
      });
    }
    return periods;
  }, []);

  const fetchReport = async (startDate: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/reports/payroll?start_date=${startDate}`);
      if (res.data?.success) {
        setReport(res.data.data);
      } else {
        setError(res.data?.error?.message || 'Failed to load report.');
      }
    } catch (err: any) {
      console.error('Failed to fetch payroll report:', err);
      setError(err.response?.data?.error?.message || 'Error communicating with server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport(selectedStartDate);
  }, [selectedStartDate]);

  const handlePrevFortnight = () => {
    const [y, m, d] = selectedStartDate.split('-').map(Number);
    const prev = addDays(new Date(Date.UTC(y, m - 1, d)), -14);
    setSelectedStartDate(formatDateStr(prev));
  };

  const handleNextFortnight = () => {
    const [y, m, d] = selectedStartDate.split('-').map(Number);
    const next = addDays(new Date(Date.UTC(y, m - 1, d)), 14);
    setSelectedStartDate(formatDateStr(next));
  };

  const handleExportCsv = async () => {
    setExportingCsv(true);
    try {
      const res = await api.get(`/reports/export/csv?start_date=${selectedStartDate}`, {
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Payroll_${report?.org_name ? report.org_name.replace(/[^a-zA-Z0-9_-]/g, '_') : 'Org'}_${selectedStartDate}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export CSV:', err);
      alert('Could not export CSV file.');
    } finally {
      setExportingCsv(false);
    }
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const res = await api.get(`/reports/export/pdf?start_date=${selectedStartDate}`);
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(res.data);
        printWindow.document.close();
      }
    } catch (err) {
      console.error('Failed to export PDF preview:', err);
      alert('Could not load print preview.');
    } finally {
      setExportingPdf(false);
    }
  };

  // Distinct department list
  const departments = useMemo(() => {
    if (!report?.employees) return [];
    const depts = new Set<string>();
    report.employees.forEach(e => {
      if (e.department) depts.add(e.department);
    });
    return Array.from(depts).sort();
  }, [report]);

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    if (!report?.employees) return [];
    return report.employees.filter(emp => {
      const matchesSearch = searchQuery.trim() === '' || 
        emp.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.department?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesDept = selectedDept === 'ALL' || emp.department === selectedDept;

      if (activeTab === 'exceptions') {
        const hasVariance = Math.abs(emp.variance_hours) > 0.1;
        const notApproved = emp.submission_status !== 'Approved';
        const hasOvertime = emp.unplanned_hours > 0;
        return matchesSearch && matchesDept && (hasVariance || notApproved || hasOvertime);
      }

      return matchesSearch && matchesDept;
    });
  }, [report, searchQuery, selectedDept, activeTab]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Approved':
        return <Badge variant="success">Approved</Badge>;
      case 'Submitted':
        return <Badge variant="info">Submitted</Badge>;
      case 'Under Review':
        return <Badge variant="warning">Under Review</Badge>;
      case 'Rejected':
        return <Badge variant="danger">Rejected</Badge>;
      case 'Draft':
      default:
        return <Badge variant="default">Draft</Badge>;
    }
  };

  const tabs = [
    { id: 'summary', label: 'Timesheet Summary', badge: report?.employees?.length },
    { id: 'breakdown', label: 'Hours Classification Breakdown' },
    { 
      id: 'exceptions', 
      label: 'Exceptions & Variances', 
      badge: report?.employees?.filter(e => Math.abs(e.variance_hours) > 0.1 || e.submission_status !== 'Approved').length || undefined 
    },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[var(--border)] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Workforce Reports</h1>
            <Badge variant="purple" size="sm">Stage 4 Operations</Badge>
          </div>
          <p className="text-xs text-[var(--muted)] mt-1">
            Authoritative payroll hours, shift classification breakdown, submission status, and export compliance.
          </p>
        </div>

        {/* Action Buttons & Period Selector */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Period Stepper */}
          <div className="flex items-center gap-1 bg-[var(--panel)] border border-[var(--border)] rounded-md p-1">
            <button
              onClick={handlePrevFortnight}
              disabled={loading}
              title="Previous Pay Period"
              className="p-1.5 rounded hover:bg-[var(--panel-subtle)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <select
              value={selectedStartDate}
              onChange={(e) => setSelectedStartDate(e.target.value)}
              disabled={loading}
              className="bg-transparent text-xs font-semibold text-[var(--text)] px-2 py-1 focus:outline-none cursor-pointer"
            >
              {payPeriods.map(p => (
                <option key={p.value} value={p.value} className="bg-[var(--panel)] text-[var(--text)]">
                  {p.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleNextFortnight}
              disabled={loading}
              title="Next Pay Period"
              className="p-1.5 rounded hover:bg-[var(--panel-subtle)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchReport(selectedStartDate)}
            disabled={loading}
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleExportPdf}
            disabled={loading || exportingPdf || !report}
            isLoading={exportingPdf}
            leftIcon={<Printer className="w-3.5 h-3.5" />}
          >
            Print / PDF
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={handleExportCsv}
            disabled={loading || exportingCsv || !report}
            isLoading={exportingCsv}
            leftIcon={<Download className="w-3.5 h-3.5" />}
          >
            Export CSV
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards */}
      {report && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="p-4">
            <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">Rostered Hours</div>
            <div className="text-xl font-bold text-[var(--text)] mt-1">
              {report.totals.total_rostered.toFixed(2)}h
            </div>
            <div className="text-[10px] text-[var(--muted)] mt-1">Scheduled across team</div>
          </Card>

          <Card className="p-4">
            <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">Worked Hours</div>
            <div className="text-xl font-bold text-[var(--text)] mt-1">
              {report.totals.total_actual.toFixed(2)}h
            </div>
            <div className="text-[10px] text-[var(--muted)] mt-1">Actual completed time</div>
          </Card>

          <Card className="p-4">
            <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">Net Variance</div>
            <div className={`text-xl font-bold mt-1 ${
              report.totals.total_variance > 0 
                ? 'text-amber-400' 
                : report.totals.total_variance < 0 
                  ? 'text-rose-400' 
                  : 'text-emerald-400'
            }`}>
              {report.totals.total_variance > 0 ? `+${report.totals.total_variance.toFixed(2)}h` : `${report.totals.total_variance.toFixed(2)}h`}
            </div>
            <div className="text-[10px] text-[var(--muted)] mt-1">Actual vs rostered gap</div>
          </Card>

          <Card className="p-4">
            <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">Overtime / Unplanned</div>
            <div className={`text-xl font-bold mt-1 ${report.totals.total_unplanned > 0 ? 'text-amber-400' : 'text-[var(--text)]'}`}>
              {report.totals.total_unplanned.toFixed(2)}h
            </div>
            <div className="text-[10px] text-[var(--muted)] mt-1">Unrostered shifts & OT</div>
          </Card>

          <Card className="p-4">
            <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">Paid Leave & Hol.</div>
            <div className="text-xl font-bold text-[var(--text)] mt-1">
              {(report.totals.total_sick + report.totals.total_annual + report.totals.total_til + report.totals.total_public_holiday).toFixed(2)}h
            </div>
            <div className="text-[10px] text-[var(--muted)] mt-1">Annual, sick, TIL & hol.</div>
          </Card>
        </div>
      )}

      {/* Tabs & Filters */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <Tabs 
            tabs={tabs} 
            activeTab={activeTab} 
            onChange={setActiveTab} 
            variant="pill" 
          />

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search staff or dept..."
                className="bg-[var(--input-bg)] text-xs text-[var(--text)] pl-8 pr-3 py-1.5 rounded-md border border-[var(--border)] focus:outline-none focus:ring-1 focus:ring-indigo-500 w-48 sm:w-56"
              />
            </div>

            {departments.length > 0 && (
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                className="bg-[var(--panel-subtle)] text-xs text-[var(--text)] px-2.5 py-1.5 rounded-md border border-[var(--border)] focus:outline-none cursor-pointer"
              >
                <option value="ALL">All Departments</option>
                {departments.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Content Views */}
        {loading ? (
          <div className="p-12 text-center bg-[var(--panel)] border border-[var(--border)] rounded-lg">
            <RefreshCw className="w-6 h-6 animate-spin text-indigo-400 mx-auto mb-2" />
            <p className="text-xs text-[var(--muted)]">Aggregating live payroll and timesheet records...</p>
          </div>
        ) : !report || filteredEmployees.length === 0 ? (
          <EmptyState
            icon={activeTab === 'exceptions' ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <Users className="w-5 h-5" />}
            title={activeTab === 'exceptions' ? "No Exceptions Found" : "No Staff Records Found"}
            description={
              activeTab === 'exceptions'
                ? "Every timesheet in this pay period perfectly matches the roster and has been approved with zero discrepancies."
                : "No employee data matched your active filters or department selection for this pay period."
            }
          />
        ) : (
          <div>
            {/* Tab 1: Summary Table */}
            {activeTab === 'summary' && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Contract</TableHead>
                    <TableHead className="text-right">Rostered</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead className="text-right">Unplanned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEmployees.map((emp) => (
                    <TableRow key={emp.employee_id}>
                      <TableCell className="font-semibold text-[var(--text)]">
                        {emp.full_name}
                      </TableCell>
                      <TableCell className="text-[var(--muted)]">
                        {emp.department || '—'}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(emp.submission_status)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[var(--muted)]">
                        {emp.contracted_hours > 0 ? `${emp.contracted_hours.toFixed(1)}h` : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[var(--muted)]">
                        {emp.rostered_hours.toFixed(2)}h
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold text-[var(--text)]">
                        {emp.actual_hours.toFixed(2)}h
                      </TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${
                        emp.variance_hours > 0.05
                          ? 'text-amber-400'
                          : emp.variance_hours < -0.05
                            ? 'text-rose-400'
                            : 'text-emerald-400'
                      }`}>
                        {emp.variance_hours > 0 ? `+${emp.variance_hours.toFixed(2)}h` : `${emp.variance_hours.toFixed(2)}h`}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[var(--muted)]">
                        {emp.unplanned_hours > 0 ? (
                          <span className="text-amber-400 font-semibold">+{emp.unplanned_hours.toFixed(2)}h</span>
                        ) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {/* Tab 2: Hours Classification Breakdown Table */}
            {activeTab === 'breakdown' && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead className="text-right">Ordinary</TableHead>
                    <TableHead className="text-right">Saturday</TableHead>
                    <TableHead className="text-right">Sunday</TableHead>
                    <TableHead className="text-right">Pub Holiday</TableHead>
                    <TableHead className="text-right">Annual Leave</TableHead>
                    <TableHead className="text-right">Sick Leave</TableHead>
                    <TableHead className="text-right">TIL Taken</TableHead>
                    <TableHead className="text-right font-bold text-[var(--text)]">Total Actual</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEmployees.map((emp) => (
                    <TableRow key={emp.employee_id}>
                      <TableCell className="font-semibold text-[var(--text)]">
                        <div>{emp.full_name}</div>
                        <div className="text-[10px] text-[var(--muted)]">{emp.department || 'General'}</div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {emp.normal_hours > 0 ? `${emp.normal_hours.toFixed(2)}h` : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {emp.saturday_hours > 0 ? (
                          <span className="text-indigo-400 font-semibold">{emp.saturday_hours.toFixed(2)}h</span>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {emp.sunday_hours > 0 ? (
                          <span className="text-purple-400 font-semibold">{emp.sunday_hours.toFixed(2)}h</span>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {emp.public_holiday_hours > 0 ? (
                          <span className="text-amber-400 font-semibold">{emp.public_holiday_hours.toFixed(2)}h</span>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[var(--muted)]">
                        {emp.annual_hours > 0 ? `${emp.annual_hours.toFixed(2)}h` : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[var(--muted)]">
                        {emp.sick_hours > 0 ? `${emp.sick_hours.toFixed(2)}h` : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[var(--muted)]">
                        {emp.til_hours > 0 ? `${emp.til_hours.toFixed(2)}h` : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-[var(--text)]">
                        {emp.actual_hours.toFixed(2)}h
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {/* Tab 3: Exceptions & Variances Table */}
            {activeTab === 'exceptions' && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Rostered</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead>Exception Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEmployees.map((emp) => {
                    const isUnder = emp.variance_hours < -0.1;
                    const isOver = emp.variance_hours > 0.1;
                    const isUnsubmitted = emp.submission_status === 'Draft';
                    const isRejected = emp.submission_status === 'Rejected';

                    return (
                      <TableRow key={emp.employee_id}>
                        <TableCell className="font-semibold text-[var(--text)]">
                          <div>{emp.full_name}</div>
                          <div className="text-[10px] text-[var(--muted)]">{emp.department || 'General'}</div>
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(emp.submission_status)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[var(--muted)]">
                          {emp.rostered_hours.toFixed(2)}h
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold text-[var(--text)]">
                          {emp.actual_hours.toFixed(2)}h
                        </TableCell>
                        <TableCell className={`text-right font-mono font-semibold ${
                          isOver ? 'text-amber-400' : isUnder ? 'text-rose-400' : 'text-emerald-400'
                        }`}>
                          {emp.variance_hours > 0 ? `+${emp.variance_hours.toFixed(2)}h` : `${emp.variance_hours.toFixed(2)}h`}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {isOver && (
                              <Badge variant="warning" size="sm">
                                Overtime (+{emp.variance_hours.toFixed(2)}h)
                              </Badge>
                            )}
                            {isUnder && (
                              <Badge variant="danger" size="sm">
                                Undertime ({emp.variance_hours.toFixed(2)}h)
                              </Badge>
                            )}
                            {isUnsubmitted && (
                              <Badge variant="default" size="sm">
                                Not Submitted
                              </Badge>
                            )}
                            {isRejected && (
                              <Badge variant="danger" size="sm">
                                Submission Rejected
                              </Badge>
                            )}
                            {emp.unplanned_hours > 0 && (
                              <Badge variant="purple" size="sm">
                                {emp.unplanned_hours.toFixed(2)}h Unplanned Shift
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
