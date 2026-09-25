import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileCheck2, Lock, RotateCcw, Search, ShieldAlert } from 'lucide-react';
import api from '../services/apiClient';
import { useAccess } from '../hooks/useAccess';
import { useActiveBranch } from '../hooks/useActiveBranch';
import { useToast } from '../components/ui/Toast';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import BulkResultDialog, { type BulkResult } from '../components/roster/BulkResultDialog';
import { DayLines, PUBLIC_HOLIDAY_CLASS, PlannedWorkedKey, PublicHolidayBadge, WEEKEND_CLASS } from '../components/roster/DayBox';
import { Dialog, buttonClass } from '../components/roster/Dialog';
import { apiErrorMessage, signedHours, type BulkApproveResult, type TimesheetRow, type TimesheetStatus } from '../components/roster/api';
import { currentFortnightIso, dayLabel, fortnightDays, isWeekendIso, periodLabel, shiftIso, todayIso } from '../components/roster/dates';
import { formatHours, readDay, type DayRecord } from '../components/roster/day';
import { TimesheetStatusBadge, TimesheetStatusGuide } from '../components/TimesheetStatus';

type Tab = 'waiting' | 'approved' | 'locked' | 'all';

const TAB_STATUS: Record<Exclude<Tab, 'all'>, TimesheetStatus> = { waiting: 'Draft', approved: 'Approved', locked: 'Locked' };
const TAB_LABEL: Record<Tab, string> = { waiting: 'Waiting', approved: 'Approved', locked: 'Locked', all: 'All' };

/**
 * Timesheet approval for a pay period. Hours are entered by the Organisation Owner or a Branch
 * Admin, so a timesheet is simply Draft (waiting), Approved, or Locked (approved and the branch's
 * timesheets are locked).
 */
export default function TimesheetReview() {
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
  const [rows, setRows] = useState<TimesheetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [tab, setTab] = useState<Tab>('waiting');
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DayRecord[] | 'error'>>({});
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    api.get('/organisation/holidays')
      .then(res => {
        if (cancelled) return;
        setHolidays(new Map((res.data?.data ?? []).map((h: { holiday_date: string; name: string }) => [h.holiday_date.slice(0, 10), h.name])));
      })
      .catch(() => { /* the grid just shows no holiday badges if this fails */ });
    return () => {
      cancelled = true;
    };
  }, []);
  const loadSeq = useRef(0);

  const days = useMemo(() => fortnightDays(startIso), [startIso]);
  const endIso = days[13];
  const today = todayIso();
  const showBranch = !branchId && new Set(rows.map(r => r.location_id)).size > 1;

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const res = await api.get('/submissions', { params: { start_date: startIso, location_id: branchId || undefined } });
      if (seq !== loadSeq.current) return;
      setRows(res.data?.data ?? []);
      setLoadError(null);
      setAccessDenied(false);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setRows([]);
      if ((err as { response?: { status?: number } })?.response?.status === 403) setAccessDenied(true);
      else setLoadError(apiErrorMessage(err, 'Timesheets for this pay period could not be loaded.'));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [startIso, branchId]);

  useEffect(() => {
    load();
  }, [load]);

  const changePeriod = (iso: string) => {
    setStartIso(iso);
    setChosen(new Set());
    setExpanded(null);
  };

  const changeBranch = (id: string) => {
    setBranchId(id);
    setChosen(new Set());
  };

  // Cached per pay period, so a slow answer for an earlier period never shows under a later one.
  const detailKey = (employeeId: string) => `${startIso}|${employeeId}`;
  const loadDetails = async (employeeId: string) => {
    const key = detailKey(employeeId);
    try {
      const res = await api.get('/records', { params: { employee_id: employeeId, start_date: startIso, end_date: endIso } });
      setDetails(d => ({ ...d, [key]: (res.data?.data ?? []).map(readDay) }));
    } catch {
      setDetails(d => ({ ...d, [key]: 'error' }));
    }
  };

  const toggleExpand = (employeeId: string) => {
    if (expanded === employeeId) {
      setExpanded(null);
      return;
    }
    setExpanded(employeeId);
    const cached = details[detailKey(employeeId)];
    if (!cached || cached === 'error') loadDetails(employeeId);
  };

  const changeOne = async (row: TimesheetRow, action: 'approve' | 'reopen') => {
    setRowBusy(row.employee_id);
    try {
      await api.post(`/submissions/${action}`, { employee_id: row.employee_id, start_date: startIso });
      toast.success(action === 'approve' ? `Timesheet approved for ${row.full_name}.` : `Timesheet reopened for ${row.full_name}.`);
      setChosen(set => {
        const next = new Set(set);
        next.delete(row.employee_id);
        return next;
      });
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, action === 'approve' ? 'The timesheet could not be approved.' : 'The timesheet could not be reopened.'));
    } finally {
      setRowBusy(null);
    }
  };

  const approveMany = async (ids: string[]) => {
    setBulkBusy(true);
    try {
      const res = await api.post('/submissions/bulk-approve', { start_date: startIso, employee_ids: ids });
      const data = res.data?.data as BulkApproveResult;
      const nameOf = (id: string) => rows.find(r => r.employee_id === id)?.full_name ?? 'Worker';
      setResult({
        title: 'Approve timesheets',
        summary: `Approved ${data.approved.length} timesheet${data.approved.length === 1 ? '' : 's'}.`,
        problemHeading: 'Not approved',
        anyDone: data.approved.length > 0,
        problems: data.failed.map(f => ({ label: nameOf(f.employee_id), detail: f.message })),
      });
      setChosen(new Set());
      setConfirmIds(null);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'The timesheets could not be approved.'));
    } finally {
      setBulkBusy(false);
      await load();
    }
  };

  const approvable = rows.filter(r => r.status === 'Draft' && !r.timesheet_locked);
  const counts: Record<Tab, number> = {
    waiting: rows.filter(r => r.status === 'Draft').length,
    approved: rows.filter(r => r.status === 'Approved').length,
    locked: rows.filter(r => r.status === 'Locked').length,
    all: rows.length,
  };

  const query = search.trim().toLowerCase();
  const visible = rows.filter(r =>
    (tab === 'all' || r.status === TAB_STATUS[tab])
    && (!query || r.full_name.toLowerCase().includes(query) || (r.department ?? '').toLowerCase().includes(query) || (r.location_name ?? '').toLowerCase().includes(query)));
  const visibleApprovable = visible.filter(r => r.status === 'Draft' && !r.timesheet_locked);
  const allVisibleChosen = visibleApprovable.length > 0 && visibleApprovable.every(r => chosen.has(r.employee_id));
  const chosenIds = approvable.filter(r => chosen.has(r.employee_id)).map(r => r.employee_id);

  const toggleChosen = (id: string) =>
    setChosen(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleAllVisible = () =>
    setChosen(set => {
      const next = new Set(set);
      if (allVisibleChosen) visibleApprovable.forEach(r => next.delete(r.employee_id));
      else visibleApprovable.forEach(r => next.add(r.employee_id));
      return next;
    });

  const header = (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Timesheets</h1>
        <p className="text-xs text-[var(--muted)] mt-1">
          Pay period <strong className="text-[var(--text)]">{periodLabel(startIso)}</strong> · {rows.length} worker{rows.length === 1 ? '' : 's'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="timesheets-branch" className="sr-only">Branch</label>
        <select
          id="timesheets-branch"
          value={branchId}
          onChange={e => changeBranch(e.target.value)}
          className="bg-[var(--panel)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--text)] outline-none focus:border-[var(--primary)] cursor-pointer max-w-[14rem]"
        >
          <option value="">All my branches</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.is_active ? '' : ' (inactive)'}</option>)}
        </select>
        <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0.5">
          <button type="button" onClick={() => changePeriod(shiftIso(startIso, -14))} className={buttonClass.quiet} aria-label="Previous pay period">
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => changePeriod(currentFortnightIso())} className={buttonClass.quiet}>Current</button>
          <button type="button" onClick={() => changePeriod(shiftIso(startIso, 14))} className={buttonClass.quiet} aria-label="Next pay period">
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );

  if (accessDenied) {
    return (
      <div className="space-y-6 pb-16">
        {header}
        <div className="flex items-center justify-center py-10">
          <div className="w-full max-w-md text-center bg-[var(--panel)] border border-[var(--border)] rounded-lg p-8 shadow-sm flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[var(--panel-subtle)] border border-[var(--border)] text-[var(--muted)] flex items-center justify-center">
              <ShieldAlert className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-sm font-semibold text-[var(--text)]">You don’t have access to these timesheets</h2>
              <p className="text-xs leading-relaxed text-[var(--muted)]">
                Choose one of your branches, or ask the Organisation Owner to give you access to this branch.
              </p>
            </div>
            <button type="button" onClick={() => load()} className={buttonClass.secondary}>Try again</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-16">
      {header}

      {/* Summary */}
      <Card className="p-4 bg-[var(--panel-subtle)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-base text-[var(--text)]">
              {counts.waiting > 0
                ? `${counts.waiting} timesheet${counts.waiting === 1 ? '' : 's'} waiting for approval`
                : 'Every timesheet in this view is approved'}
            </h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {counts.waiting} waiting · {counts.approved} approved · {counts.locked} locked
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {chosenIds.length > 0 && (
              <button type="button" onClick={() => setConfirmIds(chosenIds)} disabled={bulkBusy} className={buttonClass.secondary}>
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Approve selected ({chosenIds.length})
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmIds(approvable.map(r => r.employee_id))}
              disabled={bulkBusy || approvable.length === 0}
              className={buttonClass.primary}
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Approve all waiting ({approvable.length})
            </button>
          </div>
        </div>
      </Card>

      {/* How it works, in one line — the details are a click away */}
      <details data-tour="timesheet-status" className="group rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
        <summary className="cursor-pointer list-none flex flex-wrap items-center gap-2 text-sm text-[var(--text)]">
          <span className="font-semibold">How approval works:</span>
          <TimesheetStatusBadge status="Draft" /> <span aria-hidden="true">→</span>
          <TimesheetStatusBadge status="Approved" /> <span aria-hidden="true">→</span>
          <TimesheetStatusBadge status="Locked" />
          <span className="text-xs text-[var(--primary-text)] font-semibold group-open:hidden">What do these mean?</span>
        </summary>
        <div className="pt-3 space-y-3">
          <TimesheetStatusGuide />
          <p className="text-xs text-[var(--muted)]">
            Hours are entered on the <Link to="/roster" className="text-[var(--primary-text)] font-semibold hover:underline">Roster</Link>. This page is for checking each person’s fortnight and approving it.
          </p>
        </div>
      </details>

      {/* Tabs and search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div role="group" aria-label="Filter by status" className="flex items-center gap-1 p-1 rounded-xl bg-[var(--panel-subtle)] border border-[var(--border)] overflow-x-auto">
          {(Object.keys(TAB_LABEL) as Tab[]).map(t => (
            <button
              key={t}
              type="button"
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                tab === t ? 'bg-[var(--panel)] text-[var(--text)] shadow-xs' : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              {TAB_LABEL[t]}
              <span className="px-1.5 rounded-full text-[10px] bg-[var(--glass-8)]">{counts[t]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search workers"
            placeholder="Search workers, departments or branches…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] text-xs text-[var(--text)] outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>

      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--danger-light)] border border-[var(--danger)]/30 text-xs text-[var(--danger)]">
          <span>{loadError}</span>
          <button type="button" onClick={() => load()} className={buttonClass.secondary}>Try again</button>
        </div>
      )}

      {/* List */}
      {loading && rows.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<FileCheck2 className="w-5 h-5" aria-hidden="true" />}
          title={search.trim() ? `No timesheet matches “${search.trim()}”` : tab === 'waiting' ? 'Nothing is waiting for approval' : 'No timesheets in this view'}
          description={search.trim()
            ? 'Check the spelling, or clear the search.'
            : tab === 'waiting'
              ? 'Every timesheet in this pay period is approved. Use the arrows above to check another pay period.'
              : rows.length === 0
                ? 'There are no active workers in this branch yet. Add workers, give them shifts on the Roster, and their timesheets appear here.'
                : 'No timesheets have this status. “All” shows every timesheet in the pay period.'}
          action={tab !== 'all' ? <button type="button" onClick={() => setTab('all')} className={buttonClass.secondary}>Show all</button> : undefined}
        />
      ) : (
        <div className="space-y-2">
          {visibleApprovable.length > 1 && (
            <label className="flex items-center gap-2 px-1 text-xs font-semibold text-[var(--muted)] cursor-pointer w-fit">
              <input type="checkbox" className="accent-[var(--primary)]" checked={allVisibleChosen} onChange={toggleAllVisible} />
              Select all waiting in this view ({visibleApprovable.length})
            </label>
          )}
          {visible.map(row => {
            const isExpanded = expanded === row.employee_id;
            const canApprove = row.status === 'Draft' && !row.timesheet_locked;
            const canReopen = row.status === 'Approved';
            const detail = details[detailKey(row.employee_id)];
            const detailId = `timesheet-days-${row.employee_id}`;
            return (
              <Card key={row.employee_id} className={`p-3 sm:p-4 ${row.status === 'Draft' ? 'border-[var(--primary)]/40' : ''}`}>
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 lg:w-[30%]">
                    {canApprove ? (
                      <input
                        type="checkbox"
                        className="mt-1 accent-[var(--primary)]"
                        checked={chosen.has(row.employee_id)}
                        onChange={() => toggleChosen(row.employee_id)}
                        aria-label={`Select ${row.full_name} for approval`}
                      />
                    ) : (
                      <span className="w-[13px] shrink-0" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-[var(--text)] truncate">{row.full_name}</div>
                      <div className="text-xs text-[var(--muted)] truncate">
                        {[showBranch ? row.location_name : null, row.department, `${row.contracted_hours}h contract`].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </div>

                  <dl className="grid grid-cols-4 gap-4 text-xs sm:pl-7 lg:pl-0">
                    <div>
                      <dt className="text-[10px] uppercase font-bold text-[var(--muted)]">Rostered</dt>
                      <dd className="font-bold font-mono text-[var(--text)]">{formatHours(row.rostered_hours)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase font-bold text-[var(--muted)]">Worked</dt>
                      <dd className="font-bold font-mono text-[var(--text)]">{formatHours(row.actual_hours)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase font-bold text-[var(--muted)]" title="Worked hours minus contracted hours">vs contract</dt>
                      <dd className={`font-bold font-mono ${row.variance_hours > 0 ? 'text-[var(--warn)]' : row.variance_hours < 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'}`}>
                        {signedHours(row.variance_hours)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase font-bold text-[var(--muted)]">Status</dt>
                      <dd>
                        <TimesheetStatusBadge status={row.status} />
                      </dd>
                    </div>
                  </dl>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <button
                      type="button"
                      onClick={() => toggleExpand(row.employee_id)}
                      aria-expanded={isExpanded}
                      aria-controls={detailId}
                      className={buttonClass.quiet}
                    >
                      Days {isExpanded ? <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
                    </button>
                    {canApprove && (
                      <button type="button" onClick={() => changeOne(row, 'approve')} disabled={rowBusy === row.employee_id} className={buttonClass.primary}>
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Approve
                      </button>
                    )}
                    {canReopen && (
                      <button type="button" onClick={() => changeOne(row, 'reopen')} disabled={rowBusy === row.employee_id} className={buttonClass.secondary}>
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Reopen
                      </button>
                    )}
                    {row.timesheet_locked && (
                      <span className="text-[11px] text-[var(--muted)] flex items-center gap-1">
                        <Lock className="w-3 h-3" aria-hidden="true" /> Timesheets locked for this branch
                      </span>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div id={detailId} className="mt-3 pt-3 border-t border-[var(--border)]">
                    {detail === undefined ? (
                      <p className="text-xs text-[var(--muted)]">Loading days…</p>
                    ) : detail === 'error' ? (
                      <p role="alert" className="text-xs text-[var(--danger)]">
                        The days could not be loaded.{' '}
                        <button type="button" onClick={() => loadDetails(row.employee_id)} className="underline font-semibold cursor-pointer">Try again</button>
                      </p>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <PlannedWorkedKey />
                          <Link to="/roster" className="text-xs font-semibold text-[var(--primary-text)] hover:underline">Change days on the roster</Link>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-4 gap-y-4">
                          {[0, 1].map(week => (
                            <ol key={week} aria-label={`Week ${week + 1}`} className="space-y-1.5">
                              {days.slice(week * 7, week * 7 + 7).map(iso => {
                                const record = detail.find(r => r.record_date === iso);
                                const holidayName = holidays.get(iso);
                                return (
                                  <li key={iso} className={`grid grid-cols-[5.25rem_minmax(0,1fr)] gap-2 rounded-lg border border-[var(--border)] p-2 ${holidayName ? PUBLIC_HOLIDAY_CLASS : isWeekendIso(iso) ? WEEKEND_CLASS : 'bg-[var(--panel-subtle)]'}`}>
                                    <span className={`text-xs font-semibold leading-5 whitespace-nowrap ${iso === today ? 'text-[var(--primary-text)]' : 'text-[var(--text)]'}`}>{dayLabel(iso)}</span>
                                    <div className="min-w-0">
                                      {holidayName && <PublicHolidayBadge name={holidayName} />}
                                      <DayLines day={record ?? { roster: [], timesheet: [], note: null }} variant="regular" />
                                    </div>
                                  </li>
                                );
                              })}
                            </ol>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {confirmIds && (
        <Dialog
          title={`Approve ${confirmIds.length} timesheet${confirmIds.length === 1 ? '' : 's'}?`}
          description={`Pay period ${periodLabel(startIso)}`}
          onClose={() => setConfirmIds(null)}
          closeDisabled={bulkBusy}
          size="sm"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmIds(null)} disabled={bulkBusy} className={buttonClass.secondary}>Cancel</button>
              <button type="button" onClick={() => approveMany(confirmIds)} disabled={bulkBusy} className={buttonClass.primary}>
                {bulkBusy ? 'Approving…' : 'Approve'}
              </button>
            </div>
          }
        >
          <p className="text-xs text-[var(--muted)] mb-2">
            Approved timesheets can’t be edited until they are reopened. Each timesheet is checked on its own; any that can’t be approved are listed afterwards.
          </p>
          <ul className="text-xs text-[var(--text)] max-h-48 overflow-y-auto space-y-0.5">
            {confirmIds.map(id => {
              const row = rows.find(r => r.employee_id === id);
              return <li key={id}>{row?.full_name ?? 'Worker'} <span className="text-[var(--muted)]">· {row ? `${formatHours(row.actual_hours)} worked` : ''}</span></li>;
            })}
          </ul>
        </Dialog>
      )}

      {result && <BulkResultDialog result={result} onClose={() => setResult(null)} />}
    </div>
  );
}
