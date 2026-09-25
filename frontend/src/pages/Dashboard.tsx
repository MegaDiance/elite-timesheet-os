import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, ArrowRight, CalendarCheck, CalendarDays, CheckCircle2, Compass, Copy, FileCheck2, Lock, Phone, RefreshCw, Search, Unlock,
} from 'lucide-react';
import api from '../services/apiClient';
import { useAccess } from '../hooks/useAccess';
import { useActiveBranch } from '../hooks/useActiveBranch';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { HelpTip } from '../components/ui/HelpTip';
import { useToast } from '../components/ui/Toast';
import { formatFortnightLabel } from '../utils/fortnight';
import { friendlyError } from '../services/errors';
import { formatHours, formatTime, isEntryType, TYPE_LABEL } from '../components/roster/day';
import { startTour } from '../components/tour/tourSignals';

interface Segment {
  segment_id: string;
  segment_type: string;
  actual_segment_type: string | null;
  roster_in: string | null;
  roster_out: string | null;
  roster_hours: number;
  actual_in: string | null;
  actual_out: string | null;
  actual_hours: number;
  is_unplanned: boolean;
  notes: string | null;
}

interface ScheduledWorker {
  employee_id: string;
  full_name: string;
  department: string | null;
  phone: string | null;
  location_id: string;
  location_name: string | null;
  is_working: boolean;
  segments: Segment[];
}

interface BranchStatus {
  location_id: string;
  location_name: string;
  roster_locked: boolean;
  timesheet_locked: boolean;
  active_workers: number;
  timesheets_approved: number;
  timesheets_pending: number;
}

interface DashboardData {
  date: string;
  active_fortnight: string;
  public_holiday: string | null;
  metrics: {
    active_workers: number;
    scheduled_today: number;
    currently_working: number;
    unplanned_shifts_today: number;
    timesheets_approved: number;
    timesheets_pending: number;
  };
  branch_status: BranchStatus[];
  scheduled_today: ScheduledWorker[];
  organisation: { name: string; sign_in_link: string | null; branch_admins: number } | null;
}

const typeLabel = (type: string | null | undefined) => (type && isEntryType(type) ? TYPE_LABEL[type] : 'Normal Work');
const clock = (t: string | null) => (t ? formatTime(t.slice(0, 5)) : '');

function SegmentRow({ segment }: { segment: Segment }) {
  const rostered = segment.roster_in && segment.roster_out
    ? `${clock(segment.roster_in)} – ${clock(segment.roster_out)}`
    : segment.roster_hours > 0 ? formatHours(segment.roster_hours) : 'not rostered';
  const worked = segment.actual_in && segment.actual_out
    ? `${clock(segment.actual_in)} – ${clock(segment.actual_out)}`
    : segment.actual_in ? `started ${clock(segment.actual_in)}`
      : segment.actual_hours > 0 ? formatHours(segment.actual_hours) : null;
  const workedAsOther = segment.actual_segment_type && segment.actual_segment_type !== segment.segment_type;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="font-semibold text-[var(--text)] min-w-[7rem]">{typeLabel(segment.segment_type)}</span>
      <span className="text-[var(--muted)]">Rostered <span className="text-[var(--text)] tabular-nums">{rostered}</span></span>
      {worked && <span className="text-[var(--muted)]">Worked <span className="text-[var(--text)] tabular-nums">{worked}</span></span>}
      {workedAsOther && <Badge variant="info" size="sm">Worked as {typeLabel(segment.actual_segment_type)}</Badge>}
      {segment.is_unplanned && <Badge variant="warning" size="sm"><AlertCircle className="w-3 h-3" aria-hidden="true" /> Not on the roster</Badge>}
    </li>
  );
}

function workerStatus(worker: ScheduledWorker) {
  if (worker.is_working) return <Badge variant="success" size="sm"><span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" /> Working now</Badge>;
  if (worker.segments.some(s => s.actual_in && s.actual_out)) return <Badge variant="info" size="sm"><CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Hours recorded</Badge>;
  if (worker.segments.every(s => s.segment_type !== 'WORK')) return <Badge variant="outline" size="sm">On leave</Badge>;
  return <Badge variant="outline" size="sm">Rostered</Badge>;
}

function LockState({ locked }: { locked: boolean }) {
  return locked
    ? <Badge variant="info" size="sm"><Lock className="w-3 h-3" aria-hidden="true" /> Locked</Badge>
    : <Badge variant="outline" size="sm"><Unlock className="w-3 h-3" aria-hidden="true" /> Open</Badge>;
}

interface AttentionItem { key: string; icon: ReactNode; text: ReactNode; action?: { to: string; label: string } }

/** "Today": what needs doing first, who is working, and the pay period — for the branch chosen in the menu. */
export default function Dashboard() {
  const toast = useToast();
  const { can } = useAccess();
  const { activeBranchId, activeBranch } = useActiveBranch();
  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<DashboardData | null>(null);
  const [leavePending, setLeavePending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!activeBranchId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get('/dashboard/today', { params: { location_id: activeBranchId } }),
      api.get('/dashboard/attention', { params: { location_id: activeBranchId } }).catch(() => null),
    ])
      .then(([today, attention]) => {
        if (cancelled) return;
        setData(today.data.data);
        setLeavePending(attention?.data?.data?.leave_pending ?? 0);
      })
      .catch(err => { if (!cancelled) setError(friendlyError(err, 'Today’s overview could not be loaded.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeBranchId, reloadKey]);

  const handleCopyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Sign-in link copied.');
    } catch {
      toast.error('The link could not be copied. Select it and copy it manually.');
    }
  };

  const todayLabel = data?.date
    ? new Date(`${data.date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
    : 'Today';

  const header = (
    <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Today</h1>
        <p className="text-sm text-[var(--muted)] mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-[var(--text)]">{todayLabel}</span>
          {activeBranch && <span>· {activeBranch.name}</span>}
          {data?.active_fortnight && <span>· Pay period {formatFortnightLabel(data.active_fortnight)}</span>}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={startTour} leftIcon={<Compass className="w-3.5 h-3.5" aria-hidden="true" />}>Show me around</Button>
        <Button variant="ghost" size="sm" onClick={() => setReloadKey(k => k + 1)} disabled={loading} leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />}>
          Refresh
        </Button>
      </div>
    </header>
  );

  if (!activeBranchId && !loading) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={<CalendarDays className="w-5 h-5" aria-hidden="true" />}
          title="There are no active branches to show"
          description="Everything in SimpleHours happens inside a branch: its workers, roster and timesheets. Add a branch to get started."
          action={can('branches.manage') ? <Link to="/branches"><Button variant="primary" size="md">Add a branch</Button></Link> : undefined}
        />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState icon={<AlertCircle className="w-5 h-5" aria-hidden="true" />} title="Today’s overview could not be loaded" description={error} actionLabel="Try again" onAction={() => setReloadKey(k => k + 1)} />
      </div>
    );
  }

  const metrics = data?.metrics;
  const branch = data?.branch_status[0];
  const q = searchQuery.trim().toLowerCase();
  const scheduled = (data?.scheduled_today ?? []).filter(w => !q || `${w.full_name} ${w.department ?? ''}`.toLowerCase().includes(q));

  // What needs doing, most urgent first. Only things this person can act on.
  const attention: AttentionItem[] = [];
  if (data?.organisation && !data.organisation.sign_in_link) {
    attention.push({ key: 'link', icon: <AlertCircle className="w-4 h-4 text-[var(--danger)]" aria-hidden="true" />, text: <><strong>Your sign-in link has expired.</strong> Nobody can sign in until you renew it.</>, action: { to: '/settings?tab=security', label: 'Renew link' } });
  }
  if (can('timesheets.manage') && leavePending > 0) {
    attention.push({ key: 'leave', icon: <CalendarDays className="w-4 h-4 text-[var(--warn)]" aria-hidden="true" />, text: <><strong>{leavePending} leave request{leavePending === 1 ? '' : 's'}</strong> waiting for your decision.</>, action: { to: '/leave-requests', label: 'Decide' } });
  }
  if (can('timesheets.manage') && (metrics?.timesheets_pending ?? 0) > 0) {
    attention.push({
      key: 'timesheets', icon: <FileCheck2 className="w-4 h-4 text-[var(--warn)]" aria-hidden="true" />,
      text: <><strong>{metrics!.timesheets_pending} timesheet{metrics!.timesheets_pending === 1 ? '' : 's'}</strong> not approved yet this pay period ({metrics!.timesheets_approved} of {metrics!.active_workers} done).</>,
      action: { to: '/timesheets', label: 'Review' },
    });
  }
  if ((metrics?.unplanned_shifts_today ?? 0) > 0) {
    attention.push({ key: 'unplanned', icon: <AlertCircle className="w-4 h-4 text-[var(--warn)]" aria-hidden="true" />, text: <><strong>{metrics!.unplanned_shifts_today} shift{metrics!.unplanned_shifts_today === 1 ? '' : 's'} worked today</strong> that {metrics!.unplanned_shifts_today === 1 ? 'isn’t' : 'aren’t'} on the roster.</>, action: can('rosters.manage') ? { to: '/roster', label: 'Check roster' } : undefined });
  }
  if (data?.public_holiday) {
    attention.push({ key: 'holiday', icon: <CalendarCheck className="w-4 h-4 text-[var(--primary-text)]" aria-hidden="true" />, text: <>Today is a public holiday: <strong>{data.public_holiday}</strong>. Hours worked today are reported as public holiday hours.</> });
  }
  if (branch?.roster_locked || branch?.timesheet_locked) {
    attention.push({ key: 'locks', icon: <Lock className="w-4 h-4 text-[var(--muted)]" aria-hidden="true" />, text: <>{[branch.roster_locked && 'The roster', branch.timesheet_locked && 'Timesheets'].filter(Boolean).join(' and ')} {branch.roster_locked && branch.timesheet_locked ? 'are' : 'is'} locked for this pay period, so {branch.roster_locked && branch.timesheet_locked ? 'they' : 'it'} can’t be changed.</> });
  }

  return (
    <div className="space-y-6">
      {header}

      {error && (
        <p role="alert" className="p-3 rounded-lg bg-[var(--danger-light)] border border-[var(--danger)]/30 text-sm text-[var(--danger)]">{error}</p>
      )}

      {/* 1. What needs doing */}
      <section aria-labelledby="attention-heading">
        <h2 id="attention-heading" className="text-sm font-semibold text-[var(--muted)] mb-2">Needs your attention</h2>
        <Card className="p-0 overflow-hidden">
          {attention.length === 0 ? (
            <p className="p-4 flex items-center gap-2 text-sm text-[var(--text)]">
              <CheckCircle2 className="w-4 h-4 text-[var(--success)]" aria-hidden="true" />
              Nothing needs you right now. Timesheets and leave are up to date.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {attention.map(item => (
                <li key={item.key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3">
                  <p className="flex items-start gap-2.5 text-sm text-[var(--text)]"><span className="mt-0.5 shrink-0">{item.icon}</span><span>{item.text}</span></p>
                  {item.action && (
                    <Link to={item.action.to} className="shrink-0 self-start sm:self-auto">
                      <Button variant="secondary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />}>{item.action.label}</Button>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* 2. Today's staffing */}
      <section aria-labelledby="staffing-heading" className="space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h2 id="staffing-heading" className="text-sm font-semibold text-[var(--muted)]">Today’s staffing</h2>
            <p className="text-sm text-[var(--text)]">
              <strong>{metrics?.scheduled_today ?? 0}</strong> rostered · <strong>{metrics?.currently_working ?? 0}</strong> working now
            </p>
          </div>
          {(data?.scheduled_today.length ?? 0) > 5 && (
            <div className="relative w-full sm:w-56">
              <label htmlFor="staff-search" className="sr-only">Find a worker</label>
              <Search className="w-3.5 h-3.5 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input id="staff-search" type="search" placeholder="Find a worker" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                className="w-full h-10 pl-9 pr-3 text-sm rounded-lg bg-[var(--input-bg)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--primary)]" />
            </div>
          )}
        </div>
        <Card className="p-0 overflow-hidden">
          {scheduled.length === 0 ? (
            <div className="p-6 text-center space-y-2">
              <p className="text-sm font-semibold text-[var(--text)]">{q ? `No worker matches “${searchQuery.trim()}”.` : 'Nobody is rostered today.'}</p>
              {!q && <p className="text-sm text-[var(--muted)]">Shifts added on the roster for today show up here, with who has started.</p>}
              {!q && can('rosters.manage') && <Link to="/roster" className="inline-block"><Button variant="secondary" size="sm">Open the roster</Button></Link>}
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)] max-h-[32rem] overflow-y-auto">
              {scheduled.map(worker => (
                <li key={worker.employee_id} className="px-4 py-3 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-semibold text-sm text-[var(--text)]">{worker.full_name}</span>
                      {worker.department && <span className="text-xs text-[var(--muted)]"> · {worker.department}</span>}
                      {worker.phone && (
                        <a href={`tel:${worker.phone}`} className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--primary-text)] hover:underline" aria-label={`Call ${worker.full_name}`}>
                          <Phone className="w-3 h-3" aria-hidden="true" /> {worker.phone}
                        </a>
                      )}
                    </div>
                    {workerStatus(worker)}
                  </div>
                  <ul className="space-y-1">
                    {worker.segments.map(segment => <SegmentRow key={segment.segment_id} segment={segment} />)}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* 3. The pay period */}
      {(data?.branch_status.length ?? 0) > 0 && (
        <section aria-labelledby="period-heading" className="space-y-2">
          <h2 id="period-heading" className="text-sm font-semibold text-[var(--muted)] flex items-center gap-0.5">
            This pay period
            <HelpTip label="Locks">A locked roster can’t be changed, but worked hours can still be recorded. Locked timesheets can’t be changed at all. Locks are set on the Roster page.</HelpTip>
          </h2>
          <Card className="p-0 overflow-hidden">
            <ul className="divide-y divide-[var(--border)]">
              {data!.branch_status.map(b => (
                <li key={b.location_id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-[var(--text)]">{b.location_name}</span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[var(--muted)]">
                    <span className="flex items-center gap-1.5">Roster <LockState locked={b.roster_locked} /></span>
                    <span className="flex items-center gap-1.5">Timesheets <LockState locked={b.timesheet_locked} /></span>
                    <span>{b.timesheets_approved} of {b.active_workers} approved</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {/* 4. Organisation (Owner only; the API returns null for everyone else) */}
      {data?.organisation && (
        <section aria-labelledby="org-heading" className="space-y-2">
          <h2 id="org-heading" className="text-sm font-semibold text-[var(--muted)]">Your organisation</h2>
          <Card className="p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-[var(--text)] flex items-center gap-0.5">
                Sign-in link
                <HelpTip label="Sign-in link">This is the only place anyone signs in to {data.organisation.name}. Share it with your Branch Admins and any workers you give access. Manage it in Settings → Security.</HelpTip>
              </p>
              {data.organisation.sign_in_link ? (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-1">
                  <div className="flex-1 min-w-0 px-3 py-2 rounded-md bg-[var(--input-bg)] border border-[var(--border)] font-mono text-xs text-[var(--text)] truncate select-all">{data.organisation.sign_in_link}</div>
                  <Button variant="secondary" size="sm" onClick={() => handleCopyLink(data.organisation!.sign_in_link!)} leftIcon={<Copy className="w-3.5 h-3.5" aria-hidden="true" />}>Copy link</Button>
                </div>
              ) : (
                <p className="text-sm text-[var(--danger)] mt-1">Expired. <Link to="/settings?tab=security" className="underline font-semibold">Renew it in Settings</Link>.</p>
              )}
            </div>
            <p className="text-sm text-[var(--muted)]">
              {data.organisation.branch_admins} Branch Admin{data.organisation.branch_admins === 1 ? '' : 's'} ·{' '}
              <Link to="/branch-admins" className="text-[var(--primary-text)] font-semibold hover:underline">Manage</Link>
            </p>
          </Card>
        </section>
      )}
    </div>
  );
}
