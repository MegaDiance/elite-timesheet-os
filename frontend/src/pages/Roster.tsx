import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Copy, Download, Lock, LockOpen,
  MousePointerClick, Printer, RotateCcw, Wand2,
} from 'lucide-react';
import api from '../services/apiClient';
import { useAccess } from '../hooks/useAccess';
import { useToast } from '../components/ui/Toast';
import { Badge } from '../components/ui/Badge';
import { getFortnightStartIso } from '../utils/fortnight';
import SegmentEditor from '../components/roster/SegmentEditor';
import LockDialog, { type LockFlag } from '../components/roster/LockDialog';
import DayPickerDialog, { type BulkFillMode } from '../components/roster/DayPickerDialog';
import ApplyFromDialog from '../components/roster/ApplyFromDialog';
import BulkResultDialog, { type BulkResult, type ResultProblem } from '../components/roster/BulkResultDialog';
import { Dialog, buttonClass } from '../components/roster/Dialog';
import { DayChips, SegmentLegend } from '../components/roster/DayChips';
import {
  SKIP_REASON_LABEL, apiErrorCode, apiErrorMessage, downloadPayrollCsv, openPayrollPrint, signedHours,
  type BulkApproveResult, type CopyDayRequest, type CopyDayResult, type LockRow, type TimesheetRow, type TimesheetStatus, type Worker,
} from '../components/roster/api';
import {
  currentFortnightIso, dayLabel, dayOfMonth, fortnightDays, isWeekendIso, periodLabel, shiftIso, weekdayShort,
} from '../components/roster/dates';
import {
  DEFAULT_BREAK_SETTINGS, apiHasWorked, apiWorkedType, asSegmentType, describeSide, textStyle,
  type ApiSegment, type BreakSettings, type DayRecord, type SegmentType,
} from '../components/roster/segments';

const cellKey = (workerId: string, dateIso: string) => `${workerId}|${dateIso}`;
const DAY_COLUMN_WIDTH = 84;

type Bucket = 'Weekdays' | 'Weekends' | Exclude<SegmentType, 'WORK'> | 'Unplanned';
const BUCKETS: Bucket[] = ['Weekdays', 'Weekends', 'Sick', 'Annual', 'TIL', 'LWIP', 'Other', 'Unplanned'];
const BUCKET_STYLE_TYPE: Record<Bucket, SegmentType> = {
  Weekdays: 'WORK', Weekends: 'WORK', Sick: 'Sick', Annual: 'Annual', TIL: 'TIL', LWIP: 'LWIP', Other: 'Other', Unplanned: 'WORK',
};
const emptyBuckets = (): Record<Bucket, number> => ({ Weekdays: 0, Weekends: 0, Sick: 0, Annual: 0, TIL: 0, LWIP: 0, Other: 0, Unplanned: 0 });
const bucketOf = (type: SegmentType, weekend: boolean): Bucket => (type === 'WORK' ? (weekend ? 'Weekends' : 'Weekdays') : type);

interface WorkerTotals {
  roster: number;
  worked: number;
  rosterBy: Record<Bucket, number>;
  workedBy: Record<Bucket, number>;
}

function summarise(days: string[], segmentsOf: (dateIso: string) => ApiSegment[]): WorkerTotals {
  const totals: WorkerTotals = { roster: 0, worked: 0, rosterBy: emptyBuckets(), workedBy: emptyBuckets() };
  for (const iso of days) {
    const weekend = isWeekendIso(iso);
    for (const s of segmentsOf(iso)) {
      const rostered = Number(s.roster_hours) || 0;
      if (rostered > 0) {
        totals.roster += rostered;
        if (!s.is_unplanned) totals.rosterBy[bucketOf(asSegmentType(s.segment_type), weekend)] += rostered;
      }
      const worked = Number(s.actual_hours) || 0;
      if (worked > 0) {
        totals.worked += worked;
        totals.workedBy[s.is_unplanned ? 'Unplanned' : bucketOf(apiWorkedType(s), weekend)] += worked;
      }
    }
  }
  return totals;
}

const STATUS_VARIANT: Record<TimesheetStatus, 'outline' | 'success' | 'warning'> = { Draft: 'outline', Approved: 'success', Locked: 'warning' };

export default function Roster() {
  const { access, can } = useAccess();
  const toast = useToast();
  const branches = useMemo(() => access?.branches ?? [], [access]);
  const canTimesheets = can('timesheets.manage');
  const canLock = can('periods.lock');
  const canReports = can('reports.view');

  const [branchId, setBranchId] = useState<string>(() => (access?.branches.length === 1 ? access.branches[0].id : ''));
  const [startIso, setStartIso] = useState<string>(currentFortnightIso);
  const days = useMemo(() => fortnightDays(startIso), [startIso]);
  const endIso = days[13];

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
  const [applyOpen, setApplyOpen] = useState(false);
  const [approveAllOpen, setApproveAllOpen] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
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
    setRecords(r.status === 'fulfilled' ? r.value.data?.data ?? [] : []);
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
        // The preview falls back to the default break rule; saved hours always come from the server.
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
  const segmentsFor = useCallback((workerId: string, dateIso: string) => recordByCell.get(cellKey(workerId, dateIso))?.segments ?? [], [recordByCell]);
  const nameOf = (id: string) => workerById.get(id)?.full_name ?? 'Worker';
  const branchNameOf = (id: string) => branches.find(b => b.id === id)?.name ?? workers.find(w => w.location_id === id)?.location_name ?? 'Branch';

  const groups = useMemo(() => {
    const multiBranch = new Set(workers.map(w => w.location_id)).size > 1;
    const sorted = [...workers].sort((a, b) =>
      (multiBranch ? (a.location_name ?? '').localeCompare(b.location_name ?? '') : 0)
      || (a.department ?? '').localeCompare(b.department ?? '')
      || a.full_name.localeCompare(b.full_name));
    const list: { key: string; branchId: string; department: string; workers: Worker[] }[] = [];
    for (const w of sorted) {
      const department = w.department?.trim() || 'No department';
      const key = `${multiBranch ? w.location_id : ''}|${department}`;
      const last = list[list.length - 1];
      if (last && last.key === key) last.workers.push(w);
      else list.push({ key, branchId: w.location_id, department, workers: [w] });
    }
    return { multiBranch, list };
  }, [workers]);

  const selectedBranchLock = branchId ? lockByBranch.get(branchId) : undefined;
  const approvable = timesheets.filter(t => t.status === 'Draft' && !t.timesheet_locked);
  const scopeText = branchId ? branchNameOf(branchId) : 'all your branches';

  const changePeriod = (iso: string) => {
    setStartIso(iso);
    setSelected(new Set());
  };
  const changeBranch = (id: string) => {
    setBranchId(id);
    setSelected(new Set());
  };

  // ── Selection ────────────────────────────────────────────────────────────────────────────────
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

  const onCellClick = (e: ReactMouseEvent, workerId: string, dateIso: string) => {
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

  const datesByWorker = () => {
    const map = new Map<string, string[]>();
    for (const c of selectedCells) map.set(c.workerId, [...(map.get(c.workerId) ?? []), c.dateIso]);
    for (const list of map.values()) list.sort();
    return map;
  };

  // ── Copy tools ───────────────────────────────────────────────────────────────────────────────
  const runCopyJobs = async (title: string, jobs: CopyDayRequest[]) => {
    if (jobs.length === 0) return;
    setBusy('Copying…');
    let copied = 0;
    const problems: ResultProblem[] = [];
    for (const job of jobs) {
      try {
        const res = await api.post('/records/copy-day', job);
        const data = res.data.data as CopyDayResult;
        copied += data.copied.length;
        problems.push(...data.skipped.map(s => ({
          label: `${nameOf(s.employee_id)} · ${dayLabel(s.date)}`,
          detail: SKIP_REASON_LABEL[s.reason] ?? s.reason,
        })));
      } catch (err) {
        const targets = job.target_employee_ids ?? [job.employee_id];
        problems.push({
          label: `${targets.map(nameOf).join(', ')} · ${job.target_dates.map(d => dayLabel(d)).join(', ')}`,
          detail: apiErrorCode(err) === 'NOTHING_TO_COPY'
            ? `nothing is rostered on ${dayLabel(job.source_date)} to copy`
            : apiErrorMessage(err, 'could not be copied'),
        });
      }
    }
    setBusy(null);
    setSelected(new Set());
    setResult({ title, summary: copied > 0 ? `Copied to ${copied} day${copied === 1 ? '' : 's'}.` : 'Nothing was copied.', problemHeading: 'Skipped', problems, anyDone: copied > 0 });
    await load();
  };

  /** Each run of consecutive selected days gets the roster of the day before the run. */
  const copyPreviousDay = () => {
    const jobs: CopyDayRequest[] = [];
    for (const [workerId, dates] of datesByWorker()) {
      let run: string[] = [];
      const flush = () => {
        if (run.length > 0) jobs.push({ employee_id: workerId, source_date: shiftIso(run[0], -1), target_dates: run });
        run = [];
      };
      for (const d of dates) {
        if (run.length > 0 && shiftIso(run[run.length - 1], 1) !== d) flush();
        run.push(d);
      }
      flush();
    }
    runCopyJobs('Copy previous day', jobs);
  };

  /** One request per set of workers that share the same selected days. */
  const applyFrom = (sourceWorkerId: string, sourceDate: string) => {
    const byDates = new Map<string, { dates: string[]; workers: string[] }>();
    for (const [workerId, dates] of datesByWorker()) {
      const signature = dates.join(',');
      const group = byDates.get(signature) ?? { dates, workers: [] };
      group.workers.push(workerId);
      byDates.set(signature, group);
    }
    const jobs = [...byDates.values()].map(g => ({
      employee_id: sourceWorkerId,
      source_date: sourceDate,
      target_dates: g.dates,
      target_employee_ids: g.workers,
    }));
    setApplyOpen(false);
    runCopyJobs(`Apply segments from ${nameOf(sourceWorkerId)}, ${dayLabel(sourceDate)}`, jobs);
  };

  // ── Bulk fill, approval, exports ─────────────────────────────────────────────────────────────
  const runFill = async (mode: BulkFillMode, dayIndexes: number[]) => {
    setBusy(mode === 'roster' ? 'Applying roster templates…' : 'Copying the roster to worked hours…');
    try {
      const res = await api.post(mode === 'roster' ? '/roster/auto-roster' : '/roster/auto-log', {
        start_date: startIso,
        selected_days: dayIndexes,
        location_id: branchId || undefined,
      });
      const count = Number(res.data?.data?.workers ?? 0);
      const dayText = `${dayIndexes.length} day${dayIndexes.length === 1 ? '' : 's'}`;
      toast.success(mode === 'roster'
        ? `Roster templates applied for ${count} worker${count === 1 ? '' : 's'} on ${dayText}.`
        : `Worked hours filled from the roster for ${count} worker${count === 1 ? '' : 's'} on ${dayText}.`);
      setFillMode(null);
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, mode === 'roster' ? 'Auto-Roster did not run.' : 'Auto-Log did not run.'));
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

  const onSaved = (workerId: string, dateIso: string, saved: ApiSegment[]) => {
    setRecords(rs => {
      const hasActuals = saved.some(apiHasWorked);
      const index = rs.findIndex(r => r.employee_id === workerId && r.record_date === dateIso);
      if (index >= 0) return rs.map((r, i) => (i === index ? { ...r, segments: saved, has_actuals: hasActuals } : r));
      return [...rs, { id: `local-${cellKey(workerId, dateIso)}`, employee_id: workerId, record_date: dateIso, has_actuals: hasActuals, segments: saved }];
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

  // ── Rendering helpers ────────────────────────────────────────────────────────────────────────
  const lockButton = (flag: LockFlag) => {
    const name = flag === 'roster' ? 'Roster' : 'Timesheets';
    if (!branchId) {
      return (
        <button type="button" onClick={() => setLockFlag(flag)} className={buttonClass.secondary} title={`Lock or unlock the ${name.toLowerCase()} of one branch`}>
          <Lock className="w-3.5 h-3.5" aria-hidden="true" /> {name} lock…
        </button>
      );
    }
    const locked = Boolean(flag === 'roster' ? selectedBranchLock?.roster_locked : selectedBranchLock?.timesheet_locked);
    return (
      <button
        type="button"
        onClick={() => setLockFlag(flag)}
        className={`${buttonClass.secondary} ${locked ? '!text-[var(--warn)] !border-[var(--warn)]/40 !bg-[var(--warn-light)]' : ''}`}
        title={locked ? `${name} locked. Click to unlock.` : `${name} open. Click to lock.`}
      >
        {locked ? <Lock className="w-3.5 h-3.5" aria-hidden="true" /> : <LockOpen className="w-3.5 h-3.5" aria-hidden="true" />}
        {name}: {locked ? 'locked' : 'open'}
      </button>
    );
  };

  const lockBadges = () => {
    const shown = branchId ? branches.filter(b => b.id === branchId) : branches.filter(b => b.is_active);
    return shown.map(b => {
      const row = lockByBranch.get(b.id);
      const rosterLocked = Boolean(row?.roster_locked);
      const timesheetLocked = Boolean(row?.timesheet_locked);
      return (
        <Badge key={b.id} variant={rosterLocked || timesheetLocked ? 'warning' : 'outline'} size="sm">
          {rosterLocked || timesheetLocked ? <Lock className="w-2.5 h-2.5" aria-hidden="true" /> : null}
          {branchId ? '' : `${b.name}: `}Roster {rosterLocked ? 'locked' : 'open'} · Timesheets {timesheetLocked ? 'locked' : 'open'}
        </Badge>
      );
    });
  };

  const editingWorker = editing ? workerById.get(editing.workerId) : undefined;
  const editingLock = editingWorker ? lockByBranch.get(editingWorker.location_id) : undefined;
  const editingStatus = editingWorker ? timesheetByWorker.get(editingWorker.id)?.status : undefined;

  return (
    <div className="flex flex-col h-[calc(100vh-82px)] sm:h-[calc(100vh-86px)] overflow-hidden relative w-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[var(--panel)] p-3 rounded-t-xl border border-[var(--border)] border-b-0">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="roster-branch" className="sr-only">Branch</label>
          <select
            id="roster-branch"
            value={branchId}
            onChange={e => changeBranch(e.target.value)}
            className="bg-[var(--panel-subtle)] border border-[var(--border)] rounded-lg px-2.5 py-2 text-xs font-semibold text-[var(--text)] outline-none focus:border-[var(--primary)] cursor-pointer max-w-[14rem]"
          >
            <option value="">All my branches</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}{b.is_active ? '' : ' (inactive)'}</option>
            ))}
          </select>

          <div className="flex items-center gap-0.5 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-lg p-0.5">
            <button type="button" onClick={() => changePeriod(shiftIso(startIso, -14))} className={buttonClass.quiet} aria-label="Previous pay period">
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <div className="relative">
              <button type="button" onClick={openDatePicker} className={`${buttonClass.quiet} !text-[var(--text)] font-semibold`} aria-label={`Pay period ${periodLabel(startIso)}. Choose a date to jump to its pay period`}>
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
            <button type="button" onClick={() => changePeriod(shiftIso(startIso, 14))} className={buttonClass.quiet} aria-label="Next pay period">
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => changePeriod(currentFortnightIso())} className={buttonClass.quiet}>Today</button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            aria-pressed={selectMode}
            className={`${buttonClass.secondary} ${selectMode ? '!bg-[var(--primary-light)] !text-[var(--primary)] !border-[var(--primary)]/40' : ''}`}
            title="Select days on the grid to copy them (tip: shift-click a cell)"
          >
            <MousePointerClick className="w-3.5 h-3.5" aria-hidden="true" /> Select days
          </button>
          <button
            type="button"
            onClick={() => setFillMode('roster')}
            disabled={Boolean(busy) || Boolean(selectedBranchLock?.roster_locked)}
            className={buttonClass.secondary}
            title={selectedBranchLock?.roster_locked ? 'The roster is locked for this branch' : 'Apply default roster templates to chosen days'}
          >
            <Wand2 className="w-3.5 h-3.5" aria-hidden="true" /> Auto-Roster
          </button>
          <button
            type="button"
            onClick={() => setFillMode('log')}
            disabled={Boolean(busy) || !canTimesheets || Boolean(selectedBranchLock?.timesheet_locked)}
            className={buttonClass.secondary}
            title={selectedBranchLock?.timesheet_locked ? 'Timesheets are locked for this branch' : 'Copy rostered times into worked hours on chosen days'}
          >
            <ClipboardCheck className="w-3.5 h-3.5" aria-hidden="true" /> Auto-Log
          </button>
          {canTimesheets && (
            <button
              type="button"
              onClick={() => setApproveAllOpen(true)}
              disabled={Boolean(busy) || approvable.length === 0}
              className={buttonClass.secondary}
              title={approvable.length === 0 ? 'No draft timesheets to approve' : 'Approve every draft timesheet shown'}
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Approve all ({approvable.length})
            </button>
          )}
          {canReports && (
            <>
              <button type="button" onClick={exportCsv} className={buttonClass.secondary} title="Download the payroll CSV for this pay period">
                <Download className="w-3.5 h-3.5" aria-hidden="true" /> CSV
              </button>
              <button type="button" onClick={printReport} className={buttonClass.secondary} title="Open a printable report (save as PDF from the print dialog)">
                <Printer className="w-3.5 h-3.5" aria-hidden="true" /> Print / PDF
              </button>
            </>
          )}
          {canLock && lockButton('roster')}
          {canLock && lockButton('timesheet')}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[var(--panel-subtle)] border border-[var(--border)] border-t-0 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[var(--muted)]">Pay period</span>
          <span className="font-semibold text-[var(--text)]">{periodLabel(startIso)}</span>
          <span className="text-[var(--muted)] font-mono text-[11px]">({startIso} to {endIso})</span>
          <span role="status" className="text-[var(--primary)] font-semibold">{busy ?? (loading && workers.length > 0 ? 'Refreshing…' : '')}</span>
        </div>
        <div className="hidden md:block"><SegmentLegend /></div>
        <div className="flex flex-wrap items-center gap-1.5">{lockBadges()}</div>
      </div>

      {selectMode && (
        <div role="region" aria-label="Selected days" className="flex flex-wrap items-center gap-2 px-3 py-2 bg-[var(--primary-light)] border border-[var(--primary)]/30 border-t-0 text-xs">
          <MousePointerClick className="w-4 h-4 text-[var(--primary)]" aria-hidden="true" />
          <span className="font-semibold text-[var(--text)]" aria-live="polite">{selectedCells.length} day{selectedCells.length === 1 ? '' : 's'} selected</span>
          <span className="text-[var(--muted)] hidden lg:inline">Click cells to select them, or click a date to select that day for every worker.</span>
          <span className="flex-1" />
          <button type="button" onClick={copyPreviousDay} disabled={selectedCells.length === 0 || Boolean(busy)} className={buttonClass.secondary} title="Fill each selected day with the roster of the day before it">
            <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Copy previous day
          </button>
          <button type="button" onClick={() => setApplyOpen(true)} disabled={selectedCells.length === 0 || Boolean(busy)} className={buttonClass.secondary}>
            <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Apply segments from…
          </button>
          <button type="button" onClick={() => setSelected(new Set())} disabled={selectedCells.length === 0} className={buttonClass.quiet}>Clear selection</button>
          <button type="button" onClick={exitSelectMode} className={buttonClass.primary}>Done</button>
        </div>
      )}

      {partialError && (
        <p role="alert" className="px-3 py-1.5 text-xs text-[var(--warn)] bg-[var(--warn-light)] border border-[var(--border)] border-t-0">{partialError}</p>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-auto bg-[var(--panel)] rounded-b-xl border border-[var(--border)] relative">
        {loadError ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm font-semibold text-[var(--danger)]" role="alert">{loadError}</p>
            <button type="button" onClick={() => load()} className={buttonClass.secondary}>
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Try again
            </button>
          </div>
        ) : loading && workers.length === 0 ? (
          <p className="p-10 text-center text-sm text-[var(--muted)]">Loading the roster…</p>
        ) : workers.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-semibold text-[var(--text)]">No workers in {scopeText} yet.</p>
            <p className="text-xs text-[var(--muted)]">
              Add workers on the <Link to="/workers" className="text-[var(--primary)] font-semibold hover:underline">Workers</Link> page to start rostering.
            </p>
          </div>
        ) : (
          <table className="ag-table border-none select-none" style={{ minWidth: 200 + 14 * DAY_COLUMN_WIDTH + 140 + 72 }}>
            <thead>
              <tr>
                <th className="name-col max-sm:!w-[8.5rem] py-3 text-[var(--muted)] font-bold text-xs uppercase tracking-wider">Workers</th>
                {days.map((iso, i) => {
                  const heading = (
                    <span className="flex flex-col items-center gap-0.5">
                      <span className="text-[0.65rem] uppercase font-bold">{weekdayShort(iso)}</span>
                      <span className="text-xs font-bold text-[var(--text)]">{dayOfMonth(iso)}</span>
                    </span>
                  );
                  return (
                    <th
                      key={iso}
                      scope="col"
                      style={{ width: DAY_COLUMN_WIDTH }}
                      className={`py-2 text-center ${i === 6 ? '!border-r-2 !border-r-[var(--primary)]' : ''} ${isWeekendIso(iso) ? '!bg-[var(--panel-subtle)]' : ''}`}
                    >
                      {selectMode ? (
                        <button
                          type="button"
                          onClick={() => toggleDayForEveryone(iso)}
                          className="w-full rounded-md py-0.5 hover:bg-[var(--glass-8)] cursor-pointer"
                          aria-label={`Select ${dayLabel(iso)} for every worker`}
                        >
                          {heading}
                        </button>
                      ) : (
                        <span aria-label={dayLabel(iso)}>{heading}</span>
                      )}
                    </th>
                  );
                })}
                <th className="w-[140px] text-center py-1.5 px-2">
                  <span className="flex flex-col items-center text-[0.68rem] uppercase font-black tracking-wider">
                    <span className="text-[var(--primary)]">Rostered</span>
                    <span className="w-full border-t-2 border-[var(--divider-split)] my-1" aria-hidden="true" />
                    <span className="text-[var(--success)]">Worked</span>
                  </span>
                </th>
                <th className="w-[72px] text-center text-[var(--muted)] text-xs font-bold py-2" title="Worked minus rostered hours">Variance</th>
              </tr>
            </thead>
            <tbody>
              {groups.list.map((group, gi) => {
                const newBranch = groups.multiBranch && (gi === 0 || groups.list[gi - 1].branchId !== group.branchId);
                const branchLock = lockByBranch.get(group.branchId);
                return (
                  <Fragment key={group.key}>
                    {newBranch && (
                      <tr>
                        <td colSpan={17} className="bg-[var(--panel)] text-[var(--text)] font-bold text-sm !px-3 !py-2 border-t-2 border-[var(--border)]">
                          <span className="sticky left-3 inline-flex flex-wrap items-center gap-2">
                            {branchNameOf(group.branchId)}
                            <Badge variant={branchLock?.roster_locked ? 'warning' : 'outline'} size="sm">Roster {branchLock?.roster_locked ? 'locked' : 'open'}</Badge>
                            <Badge variant={branchLock?.timesheet_locked ? 'warning' : 'outline'} size="sm">Timesheets {branchLock?.timesheet_locked ? 'locked' : 'open'}</Badge>
                          </span>
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td colSpan={17} className="bg-[var(--panel-subtle)] text-[var(--primary)] font-bold text-xs !px-4 !py-1.5 uppercase tracking-widest border-t border-[var(--border)]">
                        <span className="sticky left-4">{group.department}</span>
                      </td>
                    </tr>
                    {group.workers.map(w => {
                      const totals = summarise(days, iso => segmentsFor(w.id, iso));
                      const variance = Math.round((totals.worked - totals.roster) * 100) / 100;
                      const ts = timesheetByWorker.get(w.id);
                      const status: TimesheetStatus = ts?.status ?? 'Draft';
                      const contracted = Number(w.contracted_hours ?? 76);
                      return (
                        <tr key={w.id} className="hover:bg-[var(--hover-row)] border-b border-[var(--border)]">
                          <td className="name-col align-top p-2">
                            <span className="block font-bold text-sm text-[var(--text)] truncate" title={w.full_name}>{w.full_name}</span>
                            <span className="block text-[11px] font-semibold text-[var(--muted)]">{contracted}h contract</span>
                            <span className="flex flex-wrap items-center gap-1 mt-1">
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
                                  className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--success-light)] text-[var(--success)] border border-[var(--success)]/30 hover:opacity-80 disabled:opacity-50 cursor-pointer"
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
                                  className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--panel-subtle)] text-[var(--muted)] border border-[var(--border)] hover:text-[var(--text)] disabled:opacity-50 cursor-pointer"
                                  aria-label={`Reopen timesheet for ${w.full_name}`}
                                >
                                  Reopen
                                </button>
                              )}
                            </span>
                          </td>
                          {days.map((iso, i) => {
                            const segs = segmentsFor(w.id, iso);
                            const isSelected = selected.has(cellKey(w.id, iso));
                            return (
                              <td key={iso} className={`!p-0.5 align-middle ${i === 6 ? '!border-r-2 !border-r-[var(--primary)]' : ''} ${isWeekendIso(iso) ? 'bg-[var(--glass-4)]' : ''}`}>
                                <button
                                  type="button"
                                  onClick={e => onCellClick(e, w.id, iso)}
                                  aria-pressed={selectMode ? isSelected : undefined}
                                  aria-label={`${w.full_name}, ${dayLabel(iso)}: ${describeSide(segs, 'roster')}; ${describeSide(segs, 'actual')}.${selectMode ? '' : ' Edit day.'}`}
                                  className={`relative w-full min-h-[58px] flex flex-col justify-between gap-0.5 rounded-md p-0.5 cursor-pointer transition-colors hover:bg-[var(--glass-8)] focus-visible:outline-2 focus-visible:outline-[var(--primary)] ${
                                    isSelected ? 'ring-2 ring-[var(--primary)] bg-[var(--primary-light)]' : ''
                                  }`}
                                >
                                  <span className="flex flex-col items-center justify-center gap-0.5 w-full min-h-[20px]">
                                    <DayChips segments={segs} side="roster" />
                                  </span>
                                  <span className="w-full border-t border-[var(--divider-split)]" aria-hidden="true" />
                                  <span className="flex flex-col items-center justify-center gap-0.5 w-full min-h-[20px]">
                                    <DayChips segments={segs} side="actual" />
                                  </span>
                                  {isSelected && (
                                    <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[var(--primary)] text-white flex items-center justify-center" aria-hidden="true">
                                      <Check className="w-2.5 h-2.5" strokeWidth={3} />
                                    </span>
                                  )}
                                </button>
                              </td>
                            );
                          })}
                          <td className="text-center bg-[var(--panel)] p-2 align-middle">
                            <div className="flex flex-col min-h-[52px] justify-between text-[0.6rem] font-bold">
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="text-[var(--primary)] text-xs">{totals.roster.toFixed(2)}h</span>
                                {BUCKETS.filter(b => totals.rosterBy[b] > 0).map(b => (
                                  <span key={b} style={textStyle(BUCKET_STYLE_TYPE[b], 'roster')}>{b}: {totals.rosterBy[b].toFixed(2)}h</span>
                                ))}
                              </div>
                              <span className="w-full border-t-2 border-[var(--divider-split)] my-1.5" aria-hidden="true" />
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="text-[var(--success)] text-xs">{totals.worked.toFixed(2)}h</span>
                                {BUCKETS.filter(b => totals.workedBy[b] > 0).map(b => (
                                  <span key={b} style={textStyle(BUCKET_STYLE_TYPE[b], 'actual', b === 'Unplanned')}>{b}: {totals.workedBy[b].toFixed(2)}h</span>
                                ))}
                              </div>
                            </div>
                          </td>
                          <td className={`text-center font-bold text-xs bg-[var(--panel)] align-middle ${variance > 0 ? 'text-[var(--success)]' : variance < 0 ? 'text-[var(--danger)]' : 'text-[var(--muted)]'}`}>
                            {signedHours(variance)}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Dialogs */}
      {editing && editingWorker && (
        <SegmentEditor
          key={cellKey(editing.workerId, editing.dateIso)}
          worker={{ id: editingWorker.id, full_name: editingWorker.full_name, location_id: editingWorker.location_id, location_name: editingWorker.location_name }}
          dateIso={editing.dateIso}
          segments={segmentsFor(editing.workerId, editing.dateIso)}
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

      {applyOpen && (
        <ApplyFromDialog
          workers={workers.map(w => ({ id: w.id, full_name: w.full_name }))}
          days={days}
          defaultWorkerId={selectedCells[0]?.workerId ?? workers[0]?.id ?? ''}
          segmentsFor={segmentsFor}
          targetCount={selectedCells.length}
          busy={Boolean(busy)}
          onApply={applyFrom}
          onClose={() => setApplyOpen(false)}
        />
      )}

      {approveAllOpen && (
        <Dialog
          title="Approve all draft timesheets?"
          description={`Pay period ${periodLabel(startIso)} · ${scopeText}`}
          onClose={() => setApproveAllOpen(false)}
          closeDisabled={Boolean(busy)}
          size="sm"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setApproveAllOpen(false)} disabled={Boolean(busy)} className={buttonClass.secondary}>Cancel</button>
              <button type="button" onClick={approveAll} disabled={Boolean(busy) || approvable.length === 0} className={buttonClass.primary}>
                {busy ? 'Approving…' : `Approve ${approvable.length}`}
              </button>
            </div>
          }
        >
          <p className="text-xs text-[var(--muted)] mb-2">
            Approved timesheets can’t be edited until they are reopened. Each one is checked on its own; any that can’t be approved are listed afterwards.
          </p>
          <ul className="text-xs text-[var(--text)] max-h-48 overflow-y-auto space-y-0.5">
            {approvable.map(t => (
              <li key={t.employee_id}>{t.full_name} <span className="text-[var(--muted)]">· {t.actual_hours.toFixed(2)}h worked</span></li>
            ))}
          </ul>
        </Dialog>
      )}

      {result && <BulkResultDialog result={result} onClose={() => setResult(null)} />}
    </div>
  );
}
