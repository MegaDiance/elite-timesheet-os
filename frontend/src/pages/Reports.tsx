import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download, Printer, RefreshCw, Search, Users } from 'lucide-react';
import api from '../services/apiClient';
import { useAccess } from '../hooks/useAccess';
import { useActiveBranch } from '../hooks/useActiveBranch';
import { useToast } from '../components/ui/Toast';
import { Badge, Button, Card, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs } from '../components/ui';
import { apiErrorMessage, downloadPayrollCsv, openPayrollPrint, signedHours } from '../components/roster/api';
import { currentFortnightIso, periodLabel, shiftIso } from '../components/roster/dates';

interface WorkerPayrollSummary {
  employee_id: string;
  full_name: string;
  department: string | null;
  location_name: string | null;
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
  lwip_hours: number;
  other_hours: number;
  unplanned_hours: number;
  submission_status: string;
}

interface PayrollTotals {
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
  total_lwip: number;
  total_other: number;
  total_unplanned: number;
}

interface PayrollReport {
  org_name: string;
  fortnight_start: string;
  fortnight_end: string;
  generated_at: string;
  employees: WorkerPayrollSummary[];
  totals: PayrollTotals;
}

type ReportTab = 'summary' | 'breakdown' | 'exceptions';

const n = (value: unknown): number => Number(value) || 0;
const hours = (value: unknown): string => `${n(value).toFixed(2)}h`;
const hoursOrDash = (value: unknown): string => (n(value) > 0 ? hours(value) : '—');

const varianceClass = (v: number) => (v > 0.05 ? 'text-[var(--warn)]' : v < -0.05 ? 'text-[var(--danger)]' : 'text-[var(--success)]');

const hasException = (w: WorkerPayrollSummary) =>
  Math.abs(n(w.variance_hours)) > 0.1 || w.submission_status === 'Draft' || n(w.unplanned_hours) > 0;

/** Sums a column over the rows shown, so the totals row always matches the filtered table. */
const sumOf = (rows: WorkerPayrollSummary[], key: keyof WorkerPayrollSummary) => rows.reduce((acc, r) => acc + n(r[key]), 0);

function StatusBadge({ status }: { status: string }) {
  if (status === 'Approved') return <Badge variant="success"><CheckCircle2 className="w-3 h-3" aria-hidden="true" />Approved</Badge>;
  if (status === 'Locked') return <Badge variant="warning">Locked</Badge>;
  return <Badge variant="default">Draft</Badge>;
}

export default function Reports() {
  const { access } = useAccess();
  const { activeBranchId } = useActiveBranch();
  const toast = useToast();
  const branches = useMemo(() => access?.branches ?? [], [access]);

  // Defaults to, and follows, the branch switched in the sidebar; "All my branches" stays available below.
  const [branchId, setBranchId] = useState<string>(() => activeBranchId || (access?.branches.length === 1 ? access.branches[0].id : ''));
  useEffect(() => {
    if (activeBranchId) setBranchId(activeBranchId);
  }, [activeBranchId]);
  const [startIso, setStartIso] = useState<string>(currentFortnightIso);
  const [report, setReport] = useState<PayrollReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const [tab, setTab] = useState<ReportTab>('summary');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('ALL');
  const loadSeq = useRef(0);

  // Recent and upcoming pay periods, always including the one being shown.
  const periods = useMemo(() => {
    const current = currentFortnightIso();
    const list = Array.from({ length: 17 }, (_, i) => shiftIso(current, (i - 12) * 14));
    if (!list.includes(startIso)) list.push(startIso);
    return list.sort().map(iso => ({ value: iso, label: `${periodLabel(iso)}${iso === current ? ' (current)' : ''}` }));
  }, [startIso]);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/reports/payroll', { params: { start_date: startIso, location_id: branchId || undefined } });
      if (seq === loadSeq.current) setReport(res.data?.data ?? null);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setReport(null);
      setError(apiErrorMessage(err, 'The report could not be loaded.'));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [startIso, branchId]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = async () => {
    setExporting('csv');
    try {
      await downloadPayrollCsv(startIso, branchId);
      toast.success('Payroll CSV downloaded.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The CSV could not be exported.');
    } finally {
      setExporting(null);
    }
  };

  const exportPdf = async () => {
    setExporting('pdf');
    try {
      await openPayrollPrint(startIso, branchId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The printable report could not be opened.');
    } finally {
      setExporting(null);
    }
  };

  const workers = useMemo(() => report?.employees ?? [], [report]);
  const showBranch = !branchId;
  const departments = useMemo(
    () => Array.from(new Set(workers.map(w => w.department).filter((d): d is string => Boolean(d)))).sort(),
    [workers],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return workers.filter(w =>
      (!query || w.full_name.toLowerCase().includes(query) || (w.department ?? '').toLowerCase().includes(query) || (w.location_name ?? '').toLowerCase().includes(query))
      && (department === 'ALL' || w.department === department)
      && (tab !== 'exceptions' || hasException(w)));
  }, [workers, search, department, tab]);

  const exceptionCount = workers.filter(hasException).length;
  const tabs = [
    { id: 'summary', label: 'Summary', badge: workers.length },
    { id: 'breakdown', label: 'Hours by category' },
    { id: 'exceptions', label: 'Exceptions', badge: exceptionCount || undefined },
  ];

  const totals = report?.totals;
  const totalRow = (cells: ReactNode) => (
    <TableRow className="bg-[var(--panel-subtle)] font-bold border-t-2 border-[var(--border)]">{cells}</TableRow>
  );
  const nameCell = (w: WorkerPayrollSummary) => (
    <TableCell className="font-semibold text-[var(--text)]">
      <div>{w.full_name}</div>
      {w.department && <div className="text-[10px] font-normal text-[var(--muted)]">{w.department}</div>}
    </TableCell>
  );
  const branchCell = (w: WorkerPayrollSummary) => (showBranch ? <TableCell className="text-[var(--muted)]">{w.location_name || '—'}</TableCell> : null);
  const leadingTotalCells = (label: string) => (
    <>
      <TableCell className="text-[var(--text)]">{label} ({filtered.length})</TableCell>
      {showBranch && <TableCell />}
    </>
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* Header and controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[var(--border)] pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Reports</h1>
          <p className="text-xs text-[var(--muted)] mt-1">
            Payroll hours for a pay period: worked hours by category, leave, approval status and exports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="reports-branch" className="sr-only">Branch</label>
          <select
            id="reports-branch"
            value={branchId}
            onChange={e => setBranchId(e.target.value)}
            className="bg-[var(--panel)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-xs font-semibold text-[var(--text)] outline-none focus:border-[var(--primary)] cursor-pointer max-w-[14rem]"
          >
            <option value="">All my branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.is_active ? '' : ' (inactive)'}</option>)}
          </select>

          <div className="flex items-center gap-1 bg-[var(--panel)] border border-[var(--border)] rounded-md p-1">
            <button
              type="button"
              onClick={() => setStartIso(shiftIso(startIso, -14))}
              disabled={loading}
              aria-label="Previous pay period"
              className="p-1.5 rounded hover:bg-[var(--panel-subtle)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40 transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <label htmlFor="reports-period" className="sr-only">Pay period</label>
            <select
              id="reports-period"
              value={startIso}
              onChange={e => setStartIso(e.target.value)}
              disabled={loading}
              className="bg-transparent text-xs font-semibold text-[var(--text)] px-2 py-1 outline-none cursor-pointer"
            >
              {periods.map(p => (
                <option key={p.value} value={p.value} className="bg-[var(--panel)] text-[var(--text)]">{p.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setStartIso(shiftIso(startIso, 14))}
              disabled={loading}
              aria-label="Next pay period"
              className="p-1.5 rounded hover:bg-[var(--panel-subtle)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40 transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => load()}
            disabled={loading}
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />}
          >
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={exportPdf}
            disabled={loading || exporting !== null || !report}
            isLoading={exporting === 'pdf'}
            leftIcon={<Printer className="w-3.5 h-3.5" aria-hidden="true" />}
          >
            Print / PDF
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={exportCsv}
            disabled={loading || exporting !== null || !report}
            isLoading={exporting === 'csv'}
            leftIcon={<Download className="w-3.5 h-3.5" aria-hidden="true" />}
          >
            Export CSV
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-lg bg-[var(--danger-light)] border border-[var(--danger)]/30 text-[var(--danger)] text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Key figures */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="p-4">
            <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">Rostered</div>
            <div className="text-xl font-bold text-[var(--text)] mt-1">{hours(totals.total_rostered)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">Worked</div>
            <div className="text-xl font-bold text-[var(--text)] mt-1">{hours(totals.total_actual)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">Variance vs contract</div>
            <div className={`text-xl font-bold mt-1 ${varianceClass(n(totals.total_variance))}`}>{signedHours(n(totals.total_variance))}</div>
          </Card>
          <Card className="p-4">
            <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">Unplanned</div>
            <div className={`text-xl font-bold mt-1 ${n(totals.total_unplanned) > 0 ? 'text-[var(--warn)]' : 'text-[var(--text)]'}`}>{hours(totals.total_unplanned)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider">Leave</div>
            <div className="text-xl font-bold text-[var(--text)] mt-1">
              {hours(n(totals.total_sick) + n(totals.total_annual) + n(totals.total_til) + n(totals.total_lwip) + n(totals.total_other))}
            </div>
            <div className="text-[10px] text-[var(--muted)] mt-1">Sick, annual, TIL, LWIP and other</div>
          </Card>
        </div>
      )}

      {/* Tabs and filters */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <Tabs tabs={tabs} activeTab={tab} onChange={id => setTab(id as ReportTab)} variant="pill" />
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
              <input
                type="search"
                aria-label="Search workers"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search workers…"
                className="bg-[var(--input-bg)] text-xs text-[var(--text)] pl-8 pr-3 py-1.5 rounded-md border border-[var(--border)] outline-none focus:border-[var(--primary)] w-48 sm:w-56"
              />
            </div>
            {departments.length > 0 && (
              <select
                aria-label="Department"
                value={department}
                onChange={e => setDepartment(e.target.value)}
                className="bg-[var(--panel-subtle)] text-xs text-[var(--text)] px-2.5 py-1.5 rounded-md border border-[var(--border)] outline-none cursor-pointer"
              >
                <option value="ALL">All departments</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center bg-[var(--panel)] border border-[var(--border)] rounded-lg">
            <RefreshCw className="w-6 h-6 animate-spin text-[var(--primary)] mx-auto mb-2" aria-hidden="true" />
            <p className="text-xs text-[var(--muted)]">Adding up the pay period…</p>
          </div>
        ) : !report || filtered.length === 0 ? (
          <EmptyState
            icon={tab === 'exceptions' ? <CheckCircle2 className="w-5 h-5 text-[var(--success)]" aria-hidden="true" /> : <Users className="w-5 h-5" aria-hidden="true" />}
            title={tab === 'exceptions' ? 'No exceptions' : 'No workers to show'}
            description={
              tab === 'exceptions'
                ? 'Every timesheet shown is approved, matches the contract and has no unplanned hours.'
                : 'No workers match these filters for this pay period.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            {tab === 'summary' && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Worker</TableHead>
                    {showBranch && <TableHead>Branch</TableHead>}
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Contract</TableHead>
                    <TableHead className="text-right">Rostered</TableHead>
                    <TableHead className="text-right">Worked</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead className="text-right">Unplanned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(w => (
                    <TableRow key={w.employee_id}>
                      {nameCell(w)}
                      {branchCell(w)}
                      <TableCell><StatusBadge status={w.submission_status} /></TableCell>
                      <TableCell className="text-right font-mono text-[var(--muted)]">{hoursOrDash(w.contracted_hours)}</TableCell>
                      <TableCell className="text-right font-mono text-[var(--muted)]">{hours(w.rostered_hours)}</TableCell>
                      <TableCell className="text-right font-mono font-semibold text-[var(--text)]">{hours(w.actual_hours)}</TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${varianceClass(n(w.variance_hours))}`}>{signedHours(n(w.variance_hours))}</TableCell>
                      <TableCell className="text-right font-mono">{hoursOrDash(w.unplanned_hours)}</TableCell>
                    </TableRow>
                  ))}
                  {totalRow(
                    <>
                      {leadingTotalCells('Total')}
                      <TableCell />
                      <TableCell className="text-right font-mono">{hours(sumOf(filtered, 'contracted_hours'))}</TableCell>
                      <TableCell className="text-right font-mono">{hours(sumOf(filtered, 'rostered_hours'))}</TableCell>
                      <TableCell className="text-right font-mono text-[var(--text)]">{hours(sumOf(filtered, 'actual_hours'))}</TableCell>
                      <TableCell className={`text-right font-mono ${varianceClass(sumOf(filtered, 'variance_hours'))}`}>{signedHours(sumOf(filtered, 'variance_hours'))}</TableCell>
                      <TableCell className="text-right font-mono">{hours(sumOf(filtered, 'unplanned_hours'))}</TableCell>
                    </>,
                  )}
                </TableBody>
              </Table>
            )}

            {tab === 'breakdown' && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Worker</TableHead>
                    {showBranch && <TableHead>Branch</TableHead>}
                    <TableHead className="text-right">Ordinary</TableHead>
                    <TableHead className="text-right">Saturday</TableHead>
                    <TableHead className="text-right">Sunday</TableHead>
                    <TableHead className="text-right">Public holiday</TableHead>
                    <TableHead className="text-right">Annual Leave</TableHead>
                    <TableHead className="text-right">Sick Leave</TableHead>
                    <TableHead className="text-right">TIL</TableHead>
                    <TableHead className="text-right">LWIP</TableHead>
                    <TableHead className="text-right">Other</TableHead>
                    <TableHead className="text-right">Total worked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(w => (
                    <TableRow key={w.employee_id}>
                      {nameCell(w)}
                      {branchCell(w)}
                      <TableCell className="text-right font-mono">{hoursOrDash(w.normal_hours)}</TableCell>
                      <TableCell className="text-right font-mono">{hoursOrDash(w.saturday_hours)}</TableCell>
                      <TableCell className="text-right font-mono">{hoursOrDash(w.sunday_hours)}</TableCell>
                      <TableCell className="text-right font-mono">{hoursOrDash(w.public_holiday_hours)}</TableCell>
                      <TableCell className="text-right font-mono text-[var(--muted)]">{hoursOrDash(w.annual_hours)}</TableCell>
                      <TableCell className="text-right font-mono text-[var(--muted)]">{hoursOrDash(w.sick_hours)}</TableCell>
                      <TableCell className="text-right font-mono text-[var(--muted)]">{hoursOrDash(w.til_hours)}</TableCell>
                      <TableCell className="text-right font-mono text-[var(--muted)]">{hoursOrDash(w.lwip_hours)}</TableCell>
                      <TableCell className="text-right font-mono text-[var(--muted)]">{hoursOrDash(w.other_hours)}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-[var(--text)]">{hours(w.actual_hours)}</TableCell>
                    </TableRow>
                  ))}
                  {totalRow(
                    <>
                      {leadingTotalCells('Total')}
                      {(['normal_hours', 'saturday_hours', 'sunday_hours', 'public_holiday_hours', 'annual_hours', 'sick_hours', 'til_hours', 'lwip_hours', 'other_hours', 'actual_hours'] as const).map(key => (
                        <TableCell key={key} className="text-right font-mono">{hours(sumOf(filtered, key))}</TableCell>
                      ))}
                    </>,
                  )}
                </TableBody>
              </Table>
            )}

            {tab === 'exceptions' && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Worker</TableHead>
                    {showBranch && <TableHead>Branch</TableHead>}
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Rostered</TableHead>
                    <TableHead className="text-right">Worked</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead>Why it’s listed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(w => {
                    const variance = n(w.variance_hours);
                    return (
                      <TableRow key={w.employee_id}>
                        {nameCell(w)}
                        {branchCell(w)}
                        <TableCell><StatusBadge status={w.submission_status} /></TableCell>
                        <TableCell className="text-right font-mono text-[var(--muted)]">{hours(w.rostered_hours)}</TableCell>
                        <TableCell className="text-right font-mono font-semibold text-[var(--text)]">{hours(w.actual_hours)}</TableCell>
                        <TableCell className={`text-right font-mono font-semibold ${varianceClass(variance)}`}>{signedHours(variance)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {variance > 0.1 && <Badge variant="warning" size="sm">Over contract ({signedHours(variance)})</Badge>}
                            {variance < -0.1 && <Badge variant="danger" size="sm">Under contract ({signedHours(variance)})</Badge>}
                            {w.submission_status === 'Draft' && <Badge variant="default" size="sm">Not approved</Badge>}
                            {n(w.unplanned_hours) > 0 && <Badge variant="purple" size="sm">{hours(w.unplanned_hours)} unplanned</Badge>}
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
