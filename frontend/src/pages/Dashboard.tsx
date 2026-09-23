import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Building2,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  FileCheck2,
  Lock,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  Unlock,
  Users,
} from 'lucide-react';
import api from '../services/apiClient';
import { useActiveBranch } from '../hooks/useActiveBranch';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Skeleton, CardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { formatFortnightLabel } from '../utils/fortnight';
import { STATUS_VARIANT, type DayStatus } from '../components/roster/DayBox';

const SEGMENT_LABEL: Record<string, string> = {
  WORK: 'Normal Work',
  Sick: 'Sick Leave',
  Annual: 'Annual Leave',
  TIL: 'TIL',
  LWIP: 'LWIP',
  Other: 'Other',
};

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

interface PendingTimesheet {
  employee_id: string;
  full_name: string;
  department: string | null;
  location_id: string;
  location_name: string;
  status: string;
}

interface DashboardData {
  role: string;
  date: string;
  active_fortnight: string;
  fortnight_end: string;
  public_holiday: string | null;
  branches: Array<{ id: string; name: string; is_active: boolean }>;
  metrics: {
    branches: number;
    active_workers: number;
    scheduled_today: number;
    currently_working: number;
    unplanned_shifts_today: number;
    timesheets_approved: number;
    timesheets_pending: number;
  };
  branch_status: BranchStatus[];
  scheduled_today: ScheduledWorker[];
  pending_timesheets: PendingTimesheet[];
  organisation: { name: string; sign_in_link: string; branch_admins: number } | null;
}

const QUICK_LINKS = [
  { to: '/roster', label: 'Roster', icon: Calendar },
  { to: '/timesheets', label: 'Timesheets', icon: ClipboardList },
  { to: '/workers', label: 'Workers', icon: Users },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/branches', label: 'Branches', icon: Building2 },
];

function formatTime(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : '';
}

function formatHours(h: number | null | undefined): string {
  const n = Number(h || 0);
  return `${Math.round(n * 100) / 100}h`;
}

function segmentLabel(type: string | null | undefined): string {
  return (type && SEGMENT_LABEL[type]) || type || 'Normal Work';
}

function SegmentRow({ segment }: { segment: Segment }) {
  const rostered = segment.roster_in && segment.roster_out
    ? `${formatTime(segment.roster_in)}–${formatTime(segment.roster_out)} (${formatHours(segment.roster_hours)})`
    : segment.roster_hours > 0 ? formatHours(segment.roster_hours) : 'Not rostered';
  const worked = segment.actual_in && segment.actual_out
    ? `${formatTime(segment.actual_in)}–${formatTime(segment.actual_out)} (${formatHours(segment.actual_hours)})`
    : segment.actual_in ? `Started ${formatTime(segment.actual_in)}`
    : segment.actual_hours > 0 ? formatHours(segment.actual_hours) : '—';
  const workedAsOther = segment.actual_segment_type && segment.actual_segment_type !== segment.segment_type;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      <span className="font-semibold text-[var(--text)] min-w-[92px]">{segmentLabel(segment.segment_type)}</span>
      <span className="font-mono text-[var(--muted)]">Rostered: <span className="text-[var(--text)]">{rostered}</span></span>
      <span className="font-mono text-[var(--muted)]">Worked: <span className="text-[var(--text)]">{worked}</span></span>
      {workedAsOther && (
        <Badge variant="info" size="sm">Worked as {segmentLabel(segment.actual_segment_type)}</Badge>
      )}
      {segment.is_unplanned && <Badge variant="warning" size="sm">Unplanned</Badge>}
    </div>
  );
}

function workerStatus(worker: ScheduledWorker) {
  if (worker.is_working) return <Badge variant="success" size="sm">Working now</Badge>;
  if (worker.segments.some(s => s.actual_in && s.actual_out)) return <Badge variant="purple" size="sm">Hours recorded</Badge>;
  return <Badge variant="outline" size="sm">Rostered</Badge>;
}

export default function Dashboard() {
  const toast = useToast();
  const { activeBranchId, activeBranch } = useActiveBranch();
  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Always scoped to the one active branch (switched in the sidebar) — never every branch at once.
  useEffect(() => {
    if (!activeBranchId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get('/dashboard/today', { params: { location_id: activeBranchId } })
      .then(res => {
        if (!cancelled) setData(res.data.data);
      })
      .catch(err => {
        if (!cancelled) setError(err.response?.data?.error?.message || 'The dashboard could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
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
    ? new Date(`${data.date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : 'Today';

  const q = searchQuery.trim().toLowerCase();
  const scheduled = (data?.scheduled_today ?? []).filter(w =>
    !q
    || w.full_name.toLowerCase().includes(q)
    || (w.department || '').toLowerCase().includes(q)
    || (w.location_name || '').toLowerCase().includes(q)
  );
  const pending = data?.pending_timesheets ?? [];
  const metrics = data?.metrics;

  const header = (
    <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-4 border-b border-[var(--border)]">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)] flex items-center gap-2">
          Dashboard
          {activeBranch && <Badge variant="outline" size="sm"><Building2 className="w-3 h-3" />{activeBranch.name}</Badge>}
        </h1>
        <p className="text-xs text-[var(--muted)] mt-1.5 flex flex-wrap items-center gap-2">
          <span className="font-medium text-[var(--text)]">{todayLabel}</span>
          {data?.active_fortnight && (
            <>
              <span>•</span>
              <span>Pay period: <strong className="text-[var(--text)]">{formatFortnightLabel(data.active_fortnight)}</strong></span>
            </>
          )}
          {data?.public_holiday && (
            <>
              <span>•</span>
              <span className="text-[var(--warn)] font-semibold flex items-center gap-1">
                <CalendarCheck className="w-3.5 h-3.5" />
                Public holiday: {data.public_holiday}
              </span>
            </>
          )}
        </p>
      </div>

      <div className="flex items-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setReloadKey(k => k + 1)}
          disabled={loading}
          leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
        >
          Refresh
        </Button>
      </div>
    </div>
  );

  if (loading && !data) {
    return (
      <div className="space-y-6">
        {header}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-64 lg:col-span-2 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={<AlertCircle className="w-5 h-5" />}
          title="The dashboard could not be loaded"
          description={error}
          actionLabel="Try again"
          onAction={() => setReloadKey(k => k + 1)}
        />
      </div>
    );
  }

  const tiles = [
    { label: 'Working now', value: metrics?.currently_working ?? 0, hint: 'Started and not yet finished', tone: 'text-[var(--success)]', icon: Clock },
    { label: 'Rostered today', value: metrics?.scheduled_today ?? 0, hint: 'Workers with segments today', tone: 'text-[var(--text)]', icon: Calendar },
    { label: 'Active workers', value: metrics?.active_workers ?? 0, hint: `Across ${metrics?.branches ?? 0} branch${metrics?.branches === 1 ? '' : 'es'}`, tone: 'text-[var(--text)]', icon: Users },
    { label: 'Unplanned today', value: metrics?.unplanned_shifts_today ?? 0, hint: 'Segments worked without a roster', tone: (metrics?.unplanned_shifts_today ?? 0) > 0 ? 'text-[var(--warn)]' : 'text-[var(--text)]', icon: AlertCircle },
    { label: 'Timesheets approved', value: metrics?.timesheets_approved ?? 0, hint: 'This pay period', tone: 'text-[var(--success)]', icon: CheckCircle2 },
    { label: 'Waiting for approval', value: metrics?.timesheets_pending ?? 0, hint: 'This pay period', tone: (metrics?.timesheets_pending ?? 0) > 0 ? 'text-[var(--warn)]' : 'text-[var(--text)]', icon: FileCheck2 },
  ];

  return (
    <div className="space-y-6">
      {header}

      {error && (
        <div className="p-3 rounded-lg bg-[var(--danger-light)] border border-[var(--danger)]/30 text-xs text-[var(--danger)] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Organisation card: Organisation Owner only (the API returns null for Branch Admins) */}
      {data?.organisation && (
        <Card className="p-5 border-[var(--primary)]/30 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
            <div>
              <span className="text-[11px] uppercase font-bold tracking-wider text-[var(--primary)]">Your organisation</span>
              <h2 className="text-lg font-bold text-[var(--text)]">{data.organisation.name}</h2>
            </div>
            <Link to="/settings">
              <Button variant="ghost" size="sm" leftIcon={<ShieldCheck className="w-3.5 h-3.5" />}>Organisation settings</Button>
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2 p-3 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] space-y-2">
              <div className="text-[10px] uppercase font-bold text-[var(--muted)]">Private sign-in link</div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0 px-3 py-2 rounded-md bg-[var(--input-bg)] border border-[var(--border)] font-mono text-xs text-[var(--text)] truncate select-all">
                  {data.organisation.sign_in_link}
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleCopyLink(data.organisation!.sign_in_link)}
                  leftIcon={<Copy className="w-3.5 h-3.5" />}
                >
                  Copy link
                </Button>
              </div>
              <p className="text-[11px] text-[var(--muted)]">Share it with your Branch Admins and any workers you give portal access. It’s the only place anyone signs in.</p>
            </div>

            <Link
              to="/branch-admins"
              className="p-3 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] hover:bg-[var(--hover-row)] transition-colors flex flex-col justify-between"
            >
              <div className="text-[10px] uppercase font-bold text-[var(--muted)]">Branch Admins</div>
              <div className="text-2xl font-bold text-[var(--text)] font-mono">{data.organisation.branch_admins}</div>
              <span className="text-[11px] text-[var(--primary)] font-semibold">Manage Branch Admins →</span>
            </Link>
          </div>
        </Card>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {tiles.map(tile => (
          <Card key={tile.label} className="p-4 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{tile.label}</span>
              <tile.icon className="w-4 h-4 text-[var(--muted)] shrink-0" />
            </div>
            <div className={`text-2xl font-bold tracking-tight ${tile.tone}`}>{tile.value}</div>
            <p className="text-[11px] text-[var(--muted)]">{tile.hint}</p>
          </Card>
        ))}
      </div>

      {/* Per-branch pay period status */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
          <div>
            <h2 className="font-bold text-sm text-[var(--text)]">Pay period status by branch</h2>
            {data && (
              <p className="text-xs text-[var(--muted)]">{formatFortnightLabel(data.active_fortnight)}</p>
            )}
          </div>
          <Link to="/timesheets" className="text-xs font-semibold text-[var(--primary)] hover:underline">Open timesheets →</Link>
        </div>

        {(data?.branch_status ?? []).length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--muted)]">No active branches to show.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-[var(--muted)] border-b border-[var(--border)]">
                  <th className="py-2 pr-3 font-semibold">Branch</th>
                  <th className="py-2 px-3 font-semibold">Roster</th>
                  <th className="py-2 px-3 font-semibold">Timesheets</th>
                  <th className="py-2 px-3 font-semibold">Approved</th>
                  <th className="py-2 pl-3 font-semibold text-right">Waiting</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data!.branch_status.map(b => {
                  const pct = b.active_workers > 0 ? Math.round((b.timesheets_approved / b.active_workers) * 100) : 0;
                  return (
                    <tr key={b.location_id}>
                      <td className="py-2.5 pr-3 font-semibold text-[var(--text)]">{b.location_name}</td>
                      <td className="py-2.5 px-3">
                        {b.roster_locked
                          ? <Badge variant="purple" size="sm"><Lock className="w-3 h-3" /> Locked</Badge>
                          : <Badge variant="outline" size="sm"><Unlock className="w-3 h-3" /> Open</Badge>}
                      </td>
                      <td className="py-2.5 px-3">
                        {b.timesheet_locked
                          ? <Badge variant="success" size="sm"><Lock className="w-3 h-3" /> Locked</Badge>
                          : <Badge variant="outline" size="sm"><Unlock className="w-3 h-3" /> Open</Badge>}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2 min-w-[140px]">
                          <div className="flex-1 h-1.5 rounded-full bg-[var(--panel-subtle)] border border-[var(--border)] overflow-hidden">
                            <div className="h-full bg-[var(--success)]" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="font-mono text-[var(--text)] whitespace-nowrap">{b.timesheets_approved} / {b.active_workers}</span>
                        </div>
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        <Badge variant={b.timesheets_pending > 0 ? 'warning' : 'outline'} size="sm">{b.timesheets_pending}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Who is rostered / working today */}
        <Card className="lg:col-span-2 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
            <div>
              <h2 className="font-bold text-sm text-[var(--text)]">Rostered and working today</h2>
              <p className="text-xs text-[var(--muted)]">Each worker's segments for today, rostered and worked.</p>
            </div>
            <div className="relative w-full sm:w-56">
              <Search className="w-3.5 h-3.5 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search workers…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>

          {scheduled.length === 0 ? (
            <EmptyState
              icon={<Calendar className="w-5 h-5" />}
              title={q ? 'No matching workers' : 'Nobody is rostered today'}
              description={q ? 'Try a different search.' : 'No roster or worked hours have been entered for today.'}
              action={!q ? <Link to="/roster"><Button variant="outline" size="sm">Open the roster</Button></Link> : undefined}
              className="border-dashed"
            />
          ) : (
            <div className="divide-y divide-[var(--border)] max-h-[520px] overflow-y-auto pr-1">
              {scheduled.map(worker => (
                <div key={worker.employee_id} className="py-3 px-2 space-y-2 rounded-lg hover:bg-[var(--hover-row)] transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-[var(--primary-light)] text-[var(--primary)] font-bold text-xs flex items-center justify-center shrink-0">
                        {worker.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-xs text-[var(--text)] truncate">{worker.full_name}</span>
                          {worker.department && <Badge size="sm">{worker.department}</Badge>}
                        </div>
                        {worker.phone && (
                          <a href={`tel:${worker.phone}`} className="flex items-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)] mt-0.5 w-fit">
                            <Phone className="w-3 h-3 text-[var(--primary)]" />
                            <span className="font-mono">{worker.phone}</span>
                          </a>
                        )}
                      </div>
                    </div>
                    {workerStatus(worker)}
                  </div>
                  <div className="pl-11 space-y-1">
                    {worker.segments.map(segment => (
                      <SegmentRow key={segment.segment_id} segment={segment} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          {/* Timesheets waiting for approval */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <FileCheck2 className="w-4 h-4 text-[var(--warn)]" />
                <h2 className="font-semibold text-xs text-[var(--text)] uppercase tracking-wider">Waiting for approval</h2>
              </div>
              <Badge variant={pending.length > 0 ? 'warning' : 'outline'} size="sm">{pending.length}</Badge>
            </div>

            {pending.length === 0 ? (
              <div className="py-6 text-center text-[var(--muted)] text-xs">
                <CheckCircle2 className="w-6 h-6 text-[var(--success)] mx-auto mb-1 opacity-80" />
                Every timesheet in this pay period is approved.
              </div>
            ) : (
              <div className="space-y-2">
                {pending.slice(0, 6).map(t => (
                  <div key={t.employee_id} className="p-2.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-semibold text-[var(--text)] truncate">{t.full_name}</div>
                      <div className="text-[10px] text-[var(--muted)] truncate">
                        {[t.location_name, t.department].filter(Boolean).join(' • ')}
                      </div>
                    </div>
                    <Badge variant={STATUS_VARIANT[t.status as DayStatus] ?? 'outline'} size="sm">{t.status}</Badge>
                  </div>
                ))}
                <Link to="/timesheets" className="block pt-1">
                  <Button variant="primary" size="sm" className="w-full" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                    {pending.length > 6 ? `Review all ${pending.length} timesheets` : 'Review timesheets'}
                  </Button>
                </Link>
              </div>
            )}
          </Card>

          {/* Quick links */}
          <Card className="p-4 space-y-2 text-xs">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Quick links</div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {QUICK_LINKS.map(link => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="p-2.5 rounded-lg bg-[var(--panel-subtle)] hover:bg-[var(--hover-row)] border border-[var(--border)] flex items-center gap-2 text-[var(--text)] transition-colors"
                >
                  <link.icon className="w-3.5 h-3.5 text-[var(--primary)]" />
                  <span className="font-medium">{link.label}</span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
