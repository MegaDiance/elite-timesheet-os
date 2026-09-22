import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Copy, Download, Lock, LockOpen,
  MousePointerClick, Plus, Printer, RotateCcw, Wand2,
} from 'lucide-react';
import api from '../services/apiClient';
import { useAccess } from '../hooks/useAccess';
import { useActiveBranch } from '../hooks/useActiveBranch';
import { useToast } from '../components/ui/Toast';
import { Badge } from '../components/ui/Badge';
import { getFortnightStartIso } from '../utils/fortnight';
import DayEditor from '../components/roster/DayEditor';
import LockDialog, { type LockFlag } from '../components/roster/LockDialog';
import DayPickerDialog, { type BulkFillMode } from '../components/roster/DayPickerDialog';
import BulkResultDialog, { type BulkResult, type ResultProblem } from '../components/roster/BulkResultDialog';
import { Dialog, buttonClass } from '../components/roster/Dialog';
import { DayLines, PART_STYLE, PlannedWorkedKey, describeDay, type DayContent } from '../components/roster/DayBox';
import {
  SKIP_REASON_LABEL, apiErrorCode, apiErrorMessage, downloadPayrollCsv, openPayrollPrint,
  type BulkApproveResult, type CopyDayRequest, type CopyDayResult, type LockRow, type TimesheetRow, type TimesheetStatus, type Worker,
} from '../components/roster/api';
import {
  currentFortnightIso, dayLabel, dayOfMonth, fortnightDays, isWeekendIso, periodLabel, shiftIso, todayIso, weekdayShort,
} from '../components/roster/dates';
import {
  DEFAULT_BREAK_SETTINGS, dayIsEmpty, formatHours, partTotal, readDay, type BreakSettings, type DayRecord,
} from '../components/roster/day';

const cellKey = (workerId: string, dateIso: string) => `${workerId}|${dateIso}`;
const EMPTY_DAY: DayContent = { roster: [], timesheet: [], note: null };
const STATUS_VARIANT: Record<TimesheetStatus, 'outline' | 'success' | 'warning'> = { Draft: 'outline', Approved: 'success', Locked: 'warning' };
const DAY_WIDTH = 116;
const NAME_WIDTH = 184;
const TOTAL_WIDTH = 128;

/** Phones and small tablets get a list of day boxes instead of the fortnight grid. */
const NARROW_QUERY = '(max-width: 767px)';
function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export default function Roster() {
  const { access, can } = useAccess();
  const { activeBranchId } = useActiveBranch();
  const toast = useToast();
  const narrow = useNarrowScreen();
  const branches = useMemo(() => access?.branches ?? [], [access]);
  const canTimesheets = can('timesheets.manage');
  const canLock = can('periods.lock');
  const canReports = can('reports.view');

  // Defaults to, and follows, the branch switched in the sidebar; "All my branches" stays available below.
  const [branchId, setBranchId] = useState<string>(() => activeBranchId || (access?.branches.length === 1 ? access.branches[0].id : ''));
  useEffect(() => {
    if (activeBranchId) setBranchId(activeBranchId);
  }, [activeBranchId]);
  const [startIso, setStartIso] = useState<string>(currentFortnightIso);
  const days = useMemo(() => fortnightDays(startIso), [startIso]);
  const endIso = days[13];
  const today = todayIso();

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [records, setRecords] = useState<DayRecord[]>([]);
  const [locks, setLocks] = useState<LockRow[]>([]);
  const [timesheets, setTimesheets] = useState<TimesheetRow[]>([]);
  const [breakSettings, setBreakSettings] = useState<BreakSettings>(DEFAULT_BREAK_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [partialError, setPartialError] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ workerId: string; dateIso: string } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [fillMode, setFillMode] = useState<BulkFillMode | null>(null);
  const [lockFlag, setLockFlag] = useState<LockFlag | null>(null);
  const [approveAllOpen, setApproveAllOpen] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [mobileDayChoice, setMobileDay] = useState<string | null>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const loadSeq = useRef(0);

  // ── Loading ──────────────────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    const location_id = branchId || undefined;
    const [w, r, l, t] = await Promise.allSettled([
      api.get('/employees', { params: { location_id } }),
      api.get('/records', { params: { location_id, start_date: startIso, end_date: endIso } }),
      api.get('/locks', { params: { location_id, start_date: startIso } }),
      api.get('/submissions', { params: { location_id, start_date: startIso } }),
    ]);
    if (seq !== loadSeq.current) return;
    const failed = [w, r].find((x): x is PromiseRejectedResult => x.status === 'rejected');
    setLoadError(failed ? apiErrorMessage(failed.reason, 'The roster could not be loaded.') : null);
    const partial = [l, t].find((x): x is PromiseRejectedResult => x.status === 'rejected');
    setPartialError(partial ? `Lock and approval status could not be loaded: ${apiErrorMessage(partial.reason, 'please refresh.')}` : null);
    setWorkers(w.status === 'fulfilled' ? w.value.data?.data ?? [] : []);
    setRecords(r.status === 'fulfilled' ? (r.value.data?.data ?? []).map(readDay) : []);
    setLocks(l.status === 'fulfilled' ? l.value.data?.data ?? [] : []);
    setTimesheets(t.status === 'fulfilled' ? t.value.data?.data ?? [] : []);
    setLoading(false);
  }, [branchId, startIso, endIso]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    api.get('/organisation/me')
      .then(res => {
        const d = res.data?.data;
        if (cancelled || !d) return;
        setBreakSettings({
          break_mins_weekday: Number(d.break_mins_weekday ?? DEFAULT_BREAK_SETTINGS.break_mins_weekday),
          break_mins_weekend: Number(d.break_mins_weekend ?? DEFAULT_BREAK_SETTINGS.break_mins_weekend),
          break_threshold_hours: Number(d.break_threshold_hours ?? DEFAULT_BREAK_SETTINGS.break_threshold_hours),
        });
      })
      .catch(() => {
        // The live preview falls back to the default break rule; saved hours always come from the server.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Derived data ─────────────────────────────────────────────────────────────────────────────
  const recordByCell = useMemo(() => new Map(records.map(r => [cellKey(r.employee_id, r.record_date), r])), [records]);
  const lockByBranch = useMemo(() => new Map(locks.map(l => [l.location_id, l])), [locks]);
  const timesheetByWorker = useMemo(() => new Map(timesheets.map(t => [t.employee_id, t])), [timesheets]);
  const workerById = useMemo(() => new Map(workers.map(w => [w.id, w])), [workers]);
  const dayOf = (workerId: string, dateIso: string): DayContent => recordByCell.get(cellKey(workerId, dateIso)) ?? EMPTY_DAY;
  const nameOf = (id: string) => workerById.get(id)?.full_name ?? 'Worker';
  const branchNameOf = (id: string) => branches.find(b => b.id === id)?.name ?? workers.find(w => w.location_id === id)?.location_name ?? 'this branch';
  const statusOf = (workerId: string): TimesheetStatus => timesheetByWorker.get(workerId)?.status ?? 'Draft';

  const totals = useMemo(() => {
    const map = new Map<string, { roster: number; worked: number }>();
    for (const r of records) {
      const t = map.get(r.employee_id) ?? { roster: 0, worked: 0 };
      t.roster += partTotal(r.roster);
      t.worked += partTotal(r.timesheet);
      map.set(r.employee_id, t);
    }
    return map;
  }, [records]);

  const groups = useMemo(() => {
    const multiBranch = new Set(workers.map(w => w.location_id)).size > 1;
    const sorted = [...workers].sort((a, b) =>
      (multiBranch ? (a.location_name ?? '').localeCompare(b.location_name ?? '') : 0)
      || (a.department ?? '').localeCompare(b.department ?? '')
      || a.full_name.localeCompare(b.full_name));
    const list: { branchId: string; workers: Worker[] }[] = [];
    for (const w of sorted) {
      const last = list[list.length - 1];
      if (last && last.branchId === w.location_id) last.workers.push(w);
      else list.push({ branchId: w.location_id, workers: [w] });
    }
    return { multiBranch, list };
  }, [workers]);

  const selectedBranchLock = branchId ? lockByBranch.get(branchId) : undefined;
  const approvable = timesheets.filter(t => t.status === 'Draft' && !t.timesheet_locked);
  const filterName = branchId ? branchNameOf(branchId) : branches.length === 1 ? branches[0].name : null;
  const scopeText = filterName ? `all workers in ${filterName}` : 'all workers in all your branches';
  const mobileDay = mobileDayChoice && days.includes(mobileDayChoice) ? mobileDayChoice : days.includes(today) ? today : days[0];

  const changePeriod = (iso: string) => {
    setStartIso(iso);
    setSelected(new Set());
  };
  const changeBranch = (id: string) => {
    setBranchId(id);
    setSelected(new Set());
  };

  // ── Selecting days (for "Copy roster from the day before") ───────────────────────────────────
  const toggleCell = (workerId: string, dateIso: string) =>
    setSelected(set => {
      const next = new Set(set);
      const key = cellKey(workerId, dateIso);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const toggleDayForEveryone = (dateIso: string) =>
    setSelected(set => {
      const keys = workers.map(w => cellKey(w.id, dateIso));
      const next = new Set(set);
      if (keys.every(k => next.has(k))) keys.forEach(k => next.delete(k));
      else keys.forEach(k => next.add(k));
      return next;
    });

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) exitSelectMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectMode, exitSelectMode]);

  const openDay = (e: ReactMouseEvent, workerId: string, dateIso: string) => {
    if (selectMode || e.shiftKey) {
      if (!selectMode) setSelectMode(true);
      toggleCell(workerId, dateIso);
      return;
    }
    setEditing({ workerId, dateIso });
  };

  const selectedCells = useMemo(
    () => [...selected].map(k => {
      const [workerId, dateIso] = k.split('|');
      return { workerId, dateIso };
    }).filter(c => workerById.has(c.workerId)),
    [selected, workerById],
  );

  /** Each run of consecutive selected days gets the roster of the day before the run. */
  const copyDayBefore = async () => {
    const byWorker = new Map<string, string[]>();
    for (const c of selectedCells) byWorker.set(c.workerId, [...(byWorker.get(c.workerId) ?? []), c.dateIso]);
    const jobs: CopyDayRequest[] = [];
    for (const [workerId, dates] of byWorker) {
      let run: string[] = [];
      const flush = () => {
        if (run.length > 0) jobs.push({ employee_id: workerId, source_date: shiftIso(run[0], -1), target_dates: run });
        run = [];
      };
      for (const d of dates.sort()) {
        if (run.length > 0 && shiftIso(run[run.length - 1], 1) !== d) flush();
        run.push(d);
      }
      flush();
    }
    if (jobs.length === 0) return;

    setBusy('Copying…');
    let copied = 0;
    const problems: ResultProblem[] = [];
    for (const job of jobs) {
      try {
        const res = await api.post('/records/copy-day', job);
        const data = res.data.data as CopyDayResult;
        copied += data.copied.length;
        problems.push(...data.skipped.map(s => ({ label: `${nameOf(s.employee_id)} · ${dayLabel(s.date)}`, detail: SKIP_REASON_LABEL[s.reason] ?? s.reason })));
      } catch (err) {
        problems.push({
          label: `${nameOf(job.employee_id)} · ${job.target_dates.map(d => dayLabel(d)).join(', ')}`,
          detail: apiErrorCode(err) === 'NOTHING_TO_COPY'
            ? `nothing is rostered on ${dayLabel(job.source_date)} to copy`
            : apiErrorMessage(err, 'could not be copied'),
        });
      }
    }
    setBusy(null);
    setSelected(new Set());
    setResult({
      title: 'Copy roster from the day before',
      summary: copied > 0 ? `Copied to ${copied} day${copied === 1 ? '' : 's'}.` : 'Nothing was copied.',
      problemHeading: 'Skipped',
      problems,
      anyDone: copied > 0,
    });
    await load();
  };

  // ── Whole-branch tools, approval, exports ────────────────────────────────────────────────────
  const runFill = async (mode: BulkFillMode, dayIndexes: number[]) => {
    setBusy(mode === 'roster' ? 'Applying default rosters…' : 'Copying the roster to worked hours…');
    try {
      const res = await api.post(mode === 'roster' ? '/roster/auto-roster' : '/roster/auto-log', {
        start_date: startIso,
        selected_days: dayIndexes,
        location_id: branchId || undefined,
      });
      const count = Number(res.data?.data?.workers ?? 0);
      const who = `${count} worker${count === 1 ? '' : 's'}`;
      toast.success(mode === 'roster' ? `Default rosters applied for ${who}.` : `Worked hours filled from the roster for ${who}.`);
      setFillMode(null);
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, mode === 'roster' ? 'The default rosters were not applied.' : 'The roster was not copied to worked hours.'));
    } finally {
      setBusy(null);
    }
  };

  const changeTimesheet = async (row: TimesheetRow, action: 'approve' | 'reopen') => {
    setRowBusy(row.employee_id);
    try {
      await api.post(`/submissions/${action}`, { employee_id: row.employee_id, start_date: startIso });
      toast.success(action === 'approve' ? `Timesheet approved for ${row.full_name}.` : `Timesheet reopened for ${row.full_name}.`);
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, action === 'approve' ? 'The timesheet could not be approved.' : 'The timesheet could not be reopened.'));
    } finally {
      setRowBusy(null);
    }
  };

  const approveAll = async () => {
    setBusy('Approving timesheets…');
    try {
      const res = await api.post('/submissions/bulk-approve', { start_date: startIso, employee_ids: approvable.map(t => t.employee_id) });
      const data = res.data?.data as BulkApproveResult;
      setApproveAllOpen(false);
      setResult({
        title: 'Approve timesheets',
        summary: `Approved ${data.approved.length} timesheet${data.approved.length === 1 ? '' : 's'}.`,
        problemHeading: 'Not approved',
        anyDone: data.approved.length > 0,
        problems: data.failed.map(f => ({ label: timesheetByWorker.get(f.employee_id)?.full_name ?? nameOf(f.employee_id), detail: f.message })),
      });
    } catch (err) {
      toast.error(apiErrorMessage(err, 'The timesheets could not be approved.'));
    } finally {
      setBusy(null);
      await load();
    }
  };

  const exportCsv = async () => {
    try {
      await downloadPayrollCsv(startIso, branchId);
      toast.success('Payroll CSV downloaded.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The CSV could not be exported.');
    }
  };

  const printReport = async () => {
    try {
      await openPayrollPrint(startIso, branchId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The printable report could not be opened.');
    }
  };

  const onSaved = (workerId: string, dateIso: string, saved: DayContent) => {
    setRecords(rs => {
      const index = rs.findIndex(r => r.employee_id === workerId && r.record_date === dateIso);
      if (index >= 0) return rs.map((r, i) => (i === index ? { ...r, ...saved } : r));
      return [...rs, { id: `local-${cellKey(workerId, dateIso)}`, employee_id: workerId, record_date: dateIso, ...saved }];
    });
    load();
  };

  const openDatePicker = () => {
    const input = dateInputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  };

  // ── Pieces ───────────────────────────────────────────────────────────────────────────────────
  const tool = `${buttonClass.secondary} max-md:h-11`;

  const lockButton = (flag: LockFlag) => {
    const name = flag === 'roster' ? 'Roster' : 'Timesheets';
    if (!branchId) {
      return (
        <button type="button" onClick={() => setLockFlag(flag)} className={tool} title={`Lock or unlock the ${name.toLowerCase()} of one branch`}>
          <Lock className="w-3.5 h-3.5" aria-hidden="true" /> {name} lock…
        </button>
      );
    }
    const locked = Boolean(flag === 'roster' ? selectedBranchLock?.roster_locked : selectedBranchLock?.timesheet_locked);
    return (
      <button
        type="button"
        onClick={() => setLockFlag(flag)}
        className={`${tool} ${locked ? '!text-[var(--warn)] !border-[var(--warn)]/40 !bg-[var(--warn-light)]' : ''}`}
        title={locked ? `${name} locked for ${filterName}. Select to unlock.` : `${name} open for ${filterName}. Select to lock.`}
      >
        {locked ? <Lock className="w-3.5 h-3.5" aria-hidden="true" /> : <LockOpen className="w-3.5 h-3.5" aria-hidden="true" />}
        {name} {locked ? 'locked' : 'open'}
      </button>
    );
  };

  const branchLockBadges = (id: string) => {
    const lock = lockByBranch.get(id);
    return (
      <>
        {lock?.roster_locked && <Badge variant="warning" size="sm"><Lock className="w-2.5 h-2.5" aria-hidden="true" />Roster locked</Badge>}
        {lock?.timesheet_locked && <Badge variant="warning" size="sm"><Lock className="w-2.5 h-2.5" aria-hidden="true" />Timesheets locked</Badge>}
      </>
    );
  };

  const statusControls = (w: Worker, large: boolean) => {
    const ts = timesheetByWorker.get(w.id);
    const status = statusOf(w.id);
    const small = `text-[11px] font-semibold rounded-md border px-2 ${large ? 'h-11' : 'py-0.5'} disabled:opacity-50 cursor-pointer`;
    return (
      <span className={`flex items-center gap-1.5 ${large ? 'shrink-0' : 'flex-wrap'}`}>
        <Badge
          variant={STATUS_VARIANT[status]}
          size="sm"
          title={status === 'Locked' ? 'Approved, and timesheets are locked for this branch' : ts?.timesheet_locked ? 'Timesheets are locked for this branch' : undefined}
        >
          {status === 'Approved' && <Check className="w-2.5 h-2.5" aria-hidden="true" />}
          {status === 'Locked' && <Lock className="w-2.5 h-2.5" aria-hidden="true" />}
          {status}
        </Badge>
        {canTimesheets && ts && status === 'Draft' && !ts.timesheet_locked && (
          <button
            type="button"
            onClick={() => changeTimesheet(ts, 'approve')}
            disabled={rowBusy === w.id}
            className={`${small} bg-[var(--success-light)] text-[var(--success)] border-[var(--success)]/30 hover:opacity-80`}
            aria-label={`Approve timesheet for ${w.full_name}`}
          >
            Approve
          </button>
        )}
        {canTimesheets && ts && status === 'Approved' && (
          <button
            type="button"
            onClick={() => changeTimesheet(ts, 'reopen')}
            disabled={rowBusy === w.id}
            className={`${small} bg-[var(--panel-subtle)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--text)]`}
            aria-label={`Reopen timesheet for ${w.full_name}`}
          >
            Reopen
          </button>
        )}
      </span>
    );
  };

  const cellLabel = (w: Worker, iso: string, day: DayContent) => {
    const empty = dayIsEmpty(day);
    const what = empty ? 'nothing rostered or worked' : describeDay(day);
    const action = selectMode ? (selected.has(cellKey(w.id, iso)) ? 'Selected.' : 'Not selected.') : empty ? 'Add times.' : 'Open the day.';
    return `${w.full_name}, ${dayLabel(iso)}: ${what}. ${action}`;
  };

  const selectedMark = (
    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--primary)] text-white flex items-center justify-center" aria-hidden="true">
      <Check className="w-2.5 h-2.5" strokeWidth={3} />
    </span>
  );

  // ── Desktop: workers × 14 days ───────────────────────────────────────────────────────────────
  const renderGrid = () => (
    <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--panel)]" role="region" aria-label="Roster for the pay period" tabIndex={0}>
      <table className="table-fixed border-separate border-spacing-0 text-left" style={{ width: NAME_WIDTH + days.length * DAY_WIDTH + TOTAL_WIDTH }}>
        <thead>
          <tr>
            <th scope="col" style={{ width: NAME_WIDTH }} className="sticky top-0 left-0 z-30 bg-[var(--table-header)] border-b-2 border-r-2 border-[var(--border)] px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
              Workers
            </th>
            {days.map((iso, i) => {
              const isToday = iso === today;
              const heading = (
                <span className="flex flex-col items-center leading-tight">
                  <span className="text-[10px] font-bold uppercase">{weekdayShort(iso)}</span>
                  <span className={`text-sm font-bold ${isToday ? 'text-[var(--primary)]' : 'text-[var(--text)]'}`}>{dayOfMonth(iso)}</span>
                  {isToday && <span className="text-[9px] font-semibold text-[var(--primary)]">Today</span>}
                </span>
              );
              return (
                <th
                  key={iso}
                  scope="col"
                  style={{ width: DAY_WIDTH }}
                  className={`sticky top-0 z-20 border-b-2 border-r border-[var(--border)] py-1.5 text-center text-[var(--muted)] ${i === 7 ? 'border-l-2 border-l-[var(--divider-split)]' : ''} ${isWeekendIso(iso) ? 'bg-[var(--panel-subtle)]' : 'bg-[var(--table-header)]'}`}
                >
                  {selectMode ? (
                    <button type="button" onClick={() => toggleDayForEveryone(iso)} className="w-full rounded-md py-0.5 hover:bg-[var(--glass-8)] cursor-pointer" aria-label={`Select ${dayLabel(iso)} for every worker`}>
                      {heading}
                    </button>
                  ) : (
                    <span aria-label={dayLabel(iso, 'long')}>{heading}</span>
                  )}
                </th>
              );
            })}
            <th scope="col" style={{ width: TOTAL_WIDTH }} className="sticky top-0 z-20 bg-[var(--table-header)] border-b-2 border-[var(--border)] px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
              Fortnight
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.list.map(group => (
            <Fragment key={group.branchId}>
              {groups.multiBranch && (
                <tr>
                  <th scope="rowgroup" colSpan={days.length + 2} className="bg-[var(--panel-subtle)] border-b border-[var(--border)] px-3 py-2 text-left">
                    <span className="sticky left-3 inline-flex flex-wrap items-center gap-2 text-sm font-bold text-[var(--text)]">
                      {branchNameOf(group.branchId)}
                      {branchLockBadges(group.branchId)}
                    </span>
                  </th>
                </tr>
              )}
              {group.workers.map(w => {
                const t = totals.get(w.id) ?? { roster: 0, worked: 0 };
                return (
                  <tr key={w.id}>
                    <th scope="row" className="sticky left-0 z-10 bg-[var(--panel)] border-b border-r-2 border-[var(--border)] px-3 py-2 align-top text-left font-normal">
                      <span className="block font-semibold text-sm text-[var(--text)] truncate" title={w.full_name}>{w.full_name}</span>
                      <span className="block text-[11px] text-[var(--muted)] truncate mb-1">
                        {[w.department, `${Number(w.contracted_hours ?? 76)} h contract`].filter(Boolean).join(' · ')}
                      </span>
                      {statusControls(w, false)}
                    </th>
                    {days.map((iso, i) => {
                      const day = dayOf(w.id, iso);
                      const empty = dayIsEmpty(day);
                      const isSelected = selected.has(cellKey(w.id, iso));
                      return (
                        <td key={iso} className={`border-b border-r border-[var(--border)] p-1 align-top ${i === 7 ? 'border-l-2 border-l-[var(--divider-split)]' : ''} ${isWeekendIso(iso) ? 'bg-[var(--glass-4)]' : ''}`}>
                          <button
                            type="button"
                            onClick={e => openDay(e, w.id, iso)}
                            aria-pressed={selectMode ? isSelected : undefined}
                            aria-label={cellLabel(w, iso, day)}
                            title={empty ? undefined : describeDay(day)}
                            className={`group relative w-full min-h-[3.25rem] rounded-lg p-1.5 text-left cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--primary)] ${
                              empty ? 'border border-dashed border-transparent hover:border-[var(--border-hover)]' : 'border border-[var(--border)] bg-[var(--panel-subtle)] hover:border-[var(--border-hover)]'
                            } ${isSelected ? 'ring-2 ring-[var(--primary)]' : ''}`}
                          >
                            {empty
                              ? <Plus className="w-4 h-4 mx-auto mt-2.5 text-[var(--muted)] opacity-0 group-hover:opacity-70 group-focus-visible:opacity-70" aria-hidden="true" />
                              : <DayLines day={day} variant="compact" />}
                            {isSelected && selectedMark}
                          </button>
                        </td>
                      );
                    })}
                    <td className="border-b border-[var(--border)] px-2 py-2 align-top">
                      <span className={`block pl-1.5 text-[11px] leading-4 tabular-nums ${PART_STYLE.roster}`}>Rostered {formatHours(t.roster)}</span>
                      <span className={`block pl-1.5 mt-1 text-[11px] leading-4 font-semibold tabular-nums ${PART_STYLE.timesheet}`}>Worked {formatHours(t.worked)}</span>
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );

  // ── Phones: one day at a time, a day box per worker ──────────────────────────────────────────
  const renderList = () => (
    <div className="space-y-3">
      <nav aria-label="Days of the pay period" className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-2 space-y-1">
        {[0, 1].map(week => (
          <div key={week} className="grid grid-cols-7 gap-1">
            {days.slice(week * 7, week * 7 + 7).map(iso => {
              const active = iso === mobileDay;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setMobileDay(iso)}
                  aria-pressed={active}
                  aria-label={`${dayLabel(iso, 'long')}${iso === today ? ' (today)' : ''}`}
                  className={`min-h-11 rounded-lg flex flex-col items-center justify-center leading-tight cursor-pointer border ${
                    active ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : `border-transparent ${isWeekendIso(iso) ? 'bg-[var(--panel-subtle)]' : ''} text-[var(--text)]`
                  }`}
                >
                  <span className={`text-[10px] font-semibold uppercase ${active ? '' : 'text-[var(--muted)]'}`}>{weekdayShort(iso)}</span>
                  <span className={`text-sm font-bold ${!active && iso === today ? 'text-[var(--primary)] underline underline-offset-2' : ''}`}>{dayOfMonth(iso)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <h2 className="text-base font-bold text-[var(--text)]">{dayLabel(mobileDay, 'long')}</h2>

      {groups.list.map(group => (
        <section key={group.branchId} aria-label={branchNameOf(group.branchId)} className="space-y-2">
          {groups.multiBranch && (
            <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold text-[var(--text)] pt-1">
              {branchNameOf(group.branchId)}
              {branchLockBadges(group.branchId)}
            </h3>
          )}
          <ul className="space-y-2">
            {group.workers.map(w => {
              const day = dayOf(w.id, mobileDay);
              const t = totals.get(w.id) ?? { roster: 0, worked: 0 };
              const isSelected = selected.has(cellKey(w.id, mobileDay));
              return (
                <li key={w.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-[var(--text)] truncate">{w.full_name}</p>
                      <p className="text-[11px] text-[var(--muted)]">Fortnight: {formatHours(t.roster)} rostered · {formatHours(t.worked)} worked</p>
                    </div>
                    {statusControls(w, true)}
                  </div>
                  <button
                    type="button"
                    onClick={e => openDay(e, w.id, mobileDay)}
                    aria-pressed={selectMode ? isSelected : undefined}
                    aria-label={cellLabel(w, mobileDay, day)}
                    className={`relative w-full min-h-11 rounded-lg border p-3 text-left cursor-pointer bg-[var(--panel-subtle)] border-[var(--border)] focus-visible:outline-2 focus-visible:outline-[var(--primary)] ${isSelected ? 'ring-2 ring-[var(--primary)]' : ''}`}
                  >
                    <DayLines day={day} variant="regular" />
                    {isSelected && selectedMark}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );

  let content: ReactNode;
  if (loadError) {
    content = (
      <div className="p-10 text-center space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <p className="text-sm font-semibold text-[var(--danger)]" role="alert">{loadError}</p>
        <button type="button" onClick={() => load()} className={buttonClass.secondary}>
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Try again
        </button>
      </div>
    );
  } else if (loading && workers.length === 0) {
    content = <p className="p-10 text-center text-sm text-[var(--muted)] rounded-xl border border-[var(--border)] bg-[var(--panel)]">Loading the roster…</p>;
  } else if (workers.length === 0) {
    content = (
      <div className="p-10 text-center space-y-2 rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <p className="text-sm font-semibold text-[var(--text)]">No workers in {filterName ?? 'your branches'} yet.</p>
        <p className="text-xs text-[var(--muted)]">
          Add workers on the <Link to="/workers" className="text-[var(--primary)] font-semibold hover:underline">Workers</Link> page to start rostering.
        </p>
      </div>
    );
  } else {
    content = narrow ? renderList() : renderGrid();
  }

  const busyText = busy ?? (loading && workers.length > 0 ? 'Refreshing…' : null);
  const tools = (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => setFillMode('roster')}
        disabled={Boolean(busy) || Boolean(selectedBranchLock?.roster_locked)}
        className={tool}
        title={selectedBranchLock?.roster_locked ? `The roster is locked for ${filterName}` : `Give ${scopeText} their default roster on days you choose`}
      >
        <Wand2 className="w-3.5 h-3.5" aria-hidden="true" /> Apply default rosters…
      </button>
      {canTimesheets && (
        <button
          type="button"
          onClick={() => setFillMode('log')}
          disabled={Boolean(busy) || Boolean(selectedBranchLock?.timesheet_locked)}
          className={tool}
          title={selectedBranchLock?.timesheet_locked ? `Timesheets are locked for ${filterName}` : `Record rostered times as worked for ${scopeText} on days you choose`}
        >
          <ClipboardCheck className="w-3.5 h-3.5" aria-hidden="true" /> Copy roster to worked hours…
        </button>
      )}
      <button
        type="button"
        onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
        aria-pressed={selectMode}
        className={`${tool} ${selectMode ? '!bg-[var(--primary-light)] !text-[var(--primary)] !border-[var(--primary)]/40' : ''}`}
        title="Select days to copy the roster from the day before (tip: shift-click a day)"
      >
        <MousePointerClick className="w-3.5 h-3.5" aria-hidden="true" /> Select days
      </button>

      <span className="hidden md:block w-px h-6 bg-[var(--border)] mx-1" aria-hidden="true" />

      {canTimesheets && (
        <button
          type="button"
          onClick={() => setApproveAllOpen(true)}
          disabled={Boolean(busy) || approvable.length === 0}
          className={tool}
          title={approvable.length === 0 ? 'No draft timesheets to approve' : 'Approve every draft timesheet shown'}
        >
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Approve all waiting ({approvable.length})
        </button>
      )}
      {canLock && lockButton('roster')}
      {canLock && lockButton('timesheet')}
      {canReports && (
        <>
          <button type="button" onClick={exportCsv} className={tool} title="Download the payroll CSV for this pay period and branch filter">
            <Download className="w-3.5 h-3.5" aria-hidden="true" /> CSV
          </button>
          <button type="button" onClick={printReport} className={tool} title="Open a printable report (save it as a PDF from the print dialog)">
            <Printer className="w-3.5 h-3.5" aria-hidden="true" /> PDF
          </button>
        </>
      )}
    </div>
  );

  const editingWorker = editing ? workerById.get(editing.workerId) : undefined;
  const editingLock = editingWorker ? lockByBranch.get(editingWorker.location_id) : undefined;
  const editingStatus = editingWorker ? statusOf(editingWorker.id) : undefined;

  return (
    <div className={`flex flex-col gap-2 w-full ${narrow ? '' : 'h-[calc(100dvh-3.5rem)] min-h-[30rem]'}`}>
      {/* Header: filter, pay period and tools */}
      <header className="shrink-0 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-[var(--text)] leading-tight">Roster</h1>
            <p className="mt-1"><PlannedWorkedKey /></p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="roster-branch" className="sr-only">Branch</label>
            <select
              id="roster-branch"
              value={branchId}
              onChange={e => changeBranch(e.target.value)}
              className="h-9 max-md:h-11 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-lg px-2.5 text-xs font-semibold text-[var(--text)] outline-none focus:border-[var(--primary)] cursor-pointer max-w-[14rem]"
            >
              <option value="">All my branches</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.is_active ? '' : ' (inactive)'}</option>)}
            </select>

            <div className="flex items-center gap-0.5 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-lg p-0.5">
              <button type="button" onClick={() => changePeriod(shiftIso(startIso, -14))} className={`${buttonClass.quiet} max-md:h-10 max-md:w-10`} aria-label="Previous pay period">
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <div className="relative">
                <button type="button" onClick={openDatePicker} className={`${buttonClass.quiet} max-md:h-10 !text-[var(--text)] font-semibold whitespace-nowrap`} aria-label={`Pay period ${periodLabel(startIso)}. Choose a date to jump to its pay period`}>
                  <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
                  {periodLabel(startIso)}
                </button>
                <input
                  ref={dateInputRef}
                  type="date"
                  tabIndex={-1}
                  aria-hidden="true"
                  value={startIso}
                  onChange={e => { if (e.target.value) changePeriod(getFortnightStartIso(e.target.value)); }}
                  className="absolute inset-0 opacity-0 pointer-events-none"
                />
              </div>
              <button type="button" onClick={() => changePeriod(shiftIso(startIso, 14))} className={`${buttonClass.quiet} max-md:h-10 max-md:w-10`} aria-label="Next pay period">
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => changePeriod(currentFortnightIso())} className={`${buttonClass.quiet} max-md:h-10`}>Today</button>
            </div>
          </div>
        </div>

        {narrow ? (
          <details className="group rounded-lg border border-[var(--border)] bg-[var(--panel-subtle)]">
            <summary className="min-h-11 px-3 flex items-center justify-between gap-2 text-xs font-semibold text-[var(--text)] cursor-pointer list-none">
              Tools, approval and exports
              <ChevronDown className="w-4 h-4 text-[var(--muted)] transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="p-2 pt-0">{tools}</div>
          </details>
        ) : tools}
        <p role="status" className="text-xs font-semibold text-[var(--primary)] empty:hidden">{busyText}</p>
      </header>

      {selectMode && (
        <div role="region" aria-label="Selected days" className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-[var(--primary-light)] border border-[var(--primary)]/30 text-xs">
          <MousePointerClick className="w-4 h-4 text-[var(--primary)]" aria-hidden="true" />
          <span className="font-semibold text-[var(--text)]" aria-live="polite">{selectedCells.length} day{selectedCells.length === 1 ? '' : 's'} selected</span>
          <span className="text-[var(--muted)] hidden lg:inline">Select days, or a date heading to select that day for everyone.</span>
          <span className="flex-1" />
          <button type="button" onClick={copyDayBefore} disabled={selectedCells.length === 0 || Boolean(busy)} className={tool} title="Give each selected day the roster of the day before it">
            <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Copy roster from the day before
          </button>
          <button type="button" onClick={() => setSelected(new Set())} disabled={selectedCells.length === 0} className={`${buttonClass.quiet} max-md:h-11`}>Clear selection</button>
          <button type="button" onClick={exitSelectMode} className={`${buttonClass.primary} max-md:h-11`}>Done</button>
        </div>
      )}

      {partialError && (
        <p role="alert" className="shrink-0 px-3 py-1.5 rounded-lg text-xs text-[var(--warn)] bg-[var(--warn-light)] border border-[var(--warn)]/30">{partialError}</p>
      )}

      {content}

      {/* Dialogs */}
      {editing && editingWorker && (
        <DayEditor
          key={cellKey(editing.workerId, editing.dateIso)}
          worker={{ id: editingWorker.id, full_name: editingWorker.full_name, location_name: editingWorker.location_name ?? branchNameOf(editingWorker.location_id) }}
          dateIso={editing.dateIso}
          day={recordByCell.get(cellKey(editing.workerId, editing.dateIso))}
          breakSettings={breakSettings}
          rosterLocked={Boolean(editingLock?.roster_locked)}
          timesheetLocked={Boolean(editingLock?.timesheet_locked)}
          approved={editingStatus === 'Approved' || editingStatus === 'Locked'}
          fortnightDays={days}
          branchWorkers={workers
            .filter(w => w.location_id === editingWorker.location_id && w.id !== editingWorker.id)
            .map(w => ({ id: w.id, full_name: w.full_name }))}
          onClose={() => setEditing(null)}
          onSaved={saved => onSaved(editing.workerId, editing.dateIso, saved)}
          onCopied={() => load()}
        />
      )}

      {fillMode && (
        <DayPickerDialog
          mode={fillMode}
          days={days}
          scopeText={scopeText}
          busy={Boolean(busy)}
          onConfirm={dayIndexes => runFill(fillMode, dayIndexes)}
          onClose={() => setFillMode(null)}
        />
      )}

      {lockFlag && (
        <LockDialog
          flag={lockFlag}
          startDate={startIso}
          periodText={`Pay period ${periodLabel(startIso)}`}
          branches={branches.filter(b => b.is_active || b.id === branchId).map(b => ({ id: b.id, name: b.name }))}
          fixedBranchId={branchId || null}
          lockFor={id => lockByBranch.get(id)}
          onClose={() => setLockFlag(null)}
          onChanged={row => {
            setLocks(ls => [...ls.filter(l => l.location_id !== row.location_id), row]);
            toast.success(`${lockFlag === 'roster' ? 'Roster' : 'Timesheet'} lock updated for ${branchNameOf(row.location_id)}.`);
            load();
          }}
        />
      )}

      {approveAllOpen && (
        <Dialog
          title="Approve all waiting timesheets?"
          description={`Pay period ${periodLabel(startIso)} · ${filterName ?? 'all your branches'}`}
          onClose={() => setApproveAllOpen(false)}
          closeDisabled={Boolean(busy)}
          size="sm"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setApproveAllOpen(false)} disabled={Boolean(busy)} className={`${buttonClass.secondary} max-md:h-11`}>Cancel</button>
              <button type="button" onClick={approveAll} disabled={Boolean(busy) || approvable.length === 0} className={`${buttonClass.primary} max-md:h-11`}>
                {busy ? 'Approving…' : `Approve ${approvable.length}`}
              </button>
            </div>
          }
        >
          <p className="text-xs text-[var(--muted)] mb-2">
            Approved timesheets can’t be changed until they are reopened. Each one is checked on its own; any that can’t be approved are listed afterwards.
          </p>
          <ul className="text-xs text-[var(--text)] max-h-48 overflow-y-auto space-y-0.5">
            {approvable.map(t => (
              <li key={t.employee_id}>{t.full_name} <span className="text-[var(--muted)]">· {formatHours(t.actual_hours)} worked</span></li>
            ))}
          </ul>
        </Dialog>
      )}

      {result && <BulkResultDialog result={result} onClose={() => setResult(null)} />}
    </div>
  );
}
