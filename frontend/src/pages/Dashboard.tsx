import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { 
  Calendar, 
  Users, 
  Clock, 
  Plane, 
  ArrowRight, 
  Lock, 
  Unlock, 
  CheckCircle2, 
  RefreshCw, 
  Phone, 
  AlertCircle, 
  FileCheck2, 
  Hourglass, 
  CalendarCheck, 
  Search,
  Sparkles,
  ClipboardList,
  ShieldCheck,
  Plus,
  Building2,
  Copy,
  Sliders
} from 'lucide-react';
import api from '../services/apiClient';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Skeleton, CardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { formatFortnightLabel } from '../utils/fortnight';

function formatHours(h: number | string | null | undefined): string {
  if (h === null || h === undefined || h === '') return '0h';
  const num = Number(h);
  if (isNaN(num)) return '0h';
  return (Math.round(num * 100) / 100).toString() + 'h';
}

function formatTime(t: string | null | undefined): string {
  if (!t) return '--:--';
  return t.split(':').slice(0, 2).join(':');
}

export default function Dashboard() {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchDashboardData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await api.get('/dashboard/today');
      if (res.data?.success) {
        const raw = res.data.data ? { ...res.data.data, ...res.data } : res.data;
        setData({
          ...raw,
          scheduled_today: raw.scheduled_today || [],
          pending_submissions: raw.pending_submissions || [],
          pending_leave: raw.pending_leave || []
        });
      }
    } catch (err: any) {
      console.error('Failed to load dashboard data:', err);
      toast.error('Unable to fetch latest dashboard feed.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const userRole = (data?.role || '').trim();
  const isManager = ['admin', 'company admin', 'platform admin', 'manager', 'owner'].includes(userRole.toLowerCase());
  const isOwner = userRole.toLowerCase() === 'owner' || Boolean(data?.is_owner_view);

  // Format today's human-readable date
  const todayDateStr = data?.date ? new Date(data.date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : 'Today';

  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? 'Good morning' : currentHour < 17 ? 'Good afternoon' : 'Good evening';

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
          <div className="space-y-2">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-96" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-32" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

  // Filter scheduled employees by search query
  const filteredScheduledStaff = (data?.scheduled_today || []).filter((emp: any) => {
    const q = searchQuery.toLowerCase();
    return (
      emp.full_name?.toLowerCase().includes(q) ||
      emp.department?.toLowerCase().includes(q) ||
      emp.phone?.toLowerCase().includes(q)
    );
  });

  const pendingSubmissionsCount = data?.metrics?.pending_submissions || 0;
  const pendingLeaveCount = data?.metrics?.pending_leave || 0;
  const totalAttentionCount = pendingSubmissionsCount + pendingLeaveCount;

  return (
    <div className="space-y-6">
      {/* Top Banner & Context Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
              {isManager ? "Operational Command Centre" : "Schedule & Timesheet"}
            </h1>
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[var(--primary-light)] text-[var(--primary)] border border-[var(--primary)]/20">
              Live Feed
            </span>
          </div>
          <p className="text-xs text-[var(--muted)] mt-1.5 flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--text)]">{todayDateStr}</span>
            <span>•</span>
            <span>
              Fortnight:{' '}
              <strong className="text-[var(--text)] font-sans">
                {data?.active_fortnight ? formatFortnightLabel(data.active_fortnight) : 'Active Cycle'}
              </strong>
            </span>
            {data?.public_holiday && (
              <>
                <span>•</span>
                <span className="text-[var(--warn)] font-semibold flex items-center gap-1">
                  <CalendarCheck className="w-3.5 h-3.5" />
                  Public Holiday: {data.public_holiday}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchDashboardData(true)}
            loading={refreshing}
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>

          {isManager ? (
            <div className="flex items-center gap-2">
              <Link to="/timesheets">
                <Button variant="primary" size="sm" leftIcon={<FileCheck2 className="w-4 h-4" />}>
                  Review Timesheets
                </Button>
              </Link>
              <Link to="/roster">
                <Button variant="outline" size="sm" leftIcon={<Calendar className="w-4 h-4" />}>
                  Roster Grid
                </Button>
              </Link>
            </div>
          ) : (
            <Link to="/timesheet">
              <Button variant="primary" size="sm" leftIcon={<Clock className="w-4 h-4" />}>
                Enter Hours
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* =========================================================
          MANAGER / ADMIN COMMAND CENTRE VIEW
      ========================================================= */}
      {isManager && (
        <div className="space-y-6">
          {/* Section 0: Organisation Owner Overview (if Owner) */}
          {isOwner && (
            <Card className="p-5 bg-gradient-to-r from-[var(--primary-light)]/20 via-[var(--panel)] to-[var(--panel)] border-[var(--primary)]/30 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase font-bold tracking-wider text-[var(--primary)]">
                      Organisation Control Centre
                    </span>
                    <Badge variant="purple" size="sm">Owner Account</Badge>
                    <Badge variant="outline" size="sm">
                      {data?.organisation?.entry_mode === 'manager' || data?.summary?.timesheet_entry_mode === 'manager'
                        ? 'Direct Manager Entry' 
                        : 'Employee Self-Submission'}
                    </Badge>
                  </div>
                  <h2 className="text-lg font-bold text-[var(--text)] mt-1">
                    {data?.organisation?.name || data?.summary?.organisation_name || 'Your Organisation'}
                  </h2>
                </div>

                <div className="flex items-center gap-2">
                  <Link to="/locations">
                    <Button variant="outline" size="sm" leftIcon={<Building2 className="w-3.5 h-3.5" />}>
                      Manage Locations
                    </Button>
                  </Link>
                  <Link to="/settings">
                    <Button variant="ghost" size="sm" leftIcon={<Sliders className="w-3.5 h-3.5" />}>
                      Org Settings
                    </Button>
                  </Link>
                </div>
              </div>

              {/* 4 Key Organisation Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-[var(--panel-subtle)] border border-[var(--border)]">
                  <div className="text-[10px] uppercase font-bold text-[var(--muted)]">Total Locations</div>
                  <div className="text-2xl font-bold text-[var(--text)] font-mono mt-0.5">
                    {data?.metrics?.total_locations ?? data?.summary?.total_locations ?? 1}
                  </div>
                  <Link to="/locations" className="text-[11px] text-[var(--primary)] font-semibold hover:underline block mt-1">
                    View branches →
                  </Link>
                </div>

                <div className="p-3 rounded-xl bg-[var(--panel-subtle)] border border-[var(--border)]">
                  <div className="text-[10px] uppercase font-bold text-[var(--muted)]">Active Managers</div>
                  <div className="text-2xl font-bold text-[var(--text)] font-mono mt-0.5">
                    {data?.metrics?.active_managers ?? data?.summary?.active_managers ?? 0}
                  </div>
                  <Link to="/locations" className="text-[11px] text-[var(--primary)] font-semibold hover:underline block mt-1">
                    Assign managers →
                  </Link>
                </div>

                <div className="p-3 rounded-xl bg-[var(--panel-subtle)] border border-[var(--border)]">
                  <div className="text-[10px] uppercase font-bold text-[var(--muted)]">Total Staff</div>
                  <div className="text-2xl font-bold text-[var(--text)] font-mono mt-0.5">
                    {data?.metrics?.total_employees ?? data?.metrics?.total_staff ?? data?.summary?.total_employees ?? 0}
                  </div>
                  <Link to="/employees" className="text-[11px] text-[var(--primary)] font-semibold hover:underline block mt-1">
                    Staff directory →
                  </Link>
                </div>

                <div className="p-3 rounded-xl bg-[var(--panel-subtle)] border border-[var(--border)]">
                  <div className="text-[10px] uppercase font-bold text-[var(--muted)]">Custom Portal URL</div>
                  <div className="text-xs font-mono font-semibold text-[var(--text)] truncate mt-1">
                    {(data?.organisation?.portal_slug || data?.summary?.portal_slug) ? `/login/${data.organisation?.portal_slug || data.summary?.portal_slug}` : 'Configured'}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const slug = data?.organisation?.portal_slug || data?.summary?.portal_slug;
                      if (slug) {
                        const url = `${window.location.origin}/login/${slug}`;
                        navigator.clipboard.writeText(url);
                        toast.success('Portal URL copied to clipboard!');
                      } else {
                        toast.info('Visit Settings to view your portal slug.');
                      }
                    }}
                    className="text-[11px] text-[var(--primary)] font-semibold hover:underline flex items-center gap-1 mt-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy Link</span>
                  </button>
                </div>
              </div>
            </Card>
          )}

          {/* Section 1: Today's Operational Snapshot (3 Clean, High-Value Stats) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Stat 1: Currently Working */}
            <Card className="p-5 flex items-center justify-between border-[var(--border)] bg-[var(--panel)]">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--success)]"></span>
                  </span>
                  <span>On Floor Now</span>
                </div>
                <div className="text-3xl font-bold tracking-tight text-[var(--success)]">
                  {data?.metrics?.currently_working ?? 0}
                </div>
                <p className="text-xs text-[var(--muted)]">Staff clocked in right now</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-[var(--success-light)] text-[var(--success)] flex items-center justify-center shrink-0">
                <Clock className="w-6 h-6" />
              </div>
            </Card>

            {/* Stat 2: Scheduled Today */}
            <Card className="p-5 flex items-center justify-between border-[var(--border)] bg-[var(--panel)]">
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Scheduled Today
                </div>
                <div className="text-3xl font-bold tracking-tight text-[var(--text)]">
                  {data?.metrics?.scheduled_today ?? 0}
                </div>
                <p className="text-xs text-[var(--muted)]">Rostered staff across all roles</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center shrink-0">
                <Calendar className="w-6 h-6" />
              </div>
            </Card>

            {/* Stat 3: Roster & Cycle Status */}
            <Card className="p-5 flex items-center justify-between border-[var(--border)] bg-[var(--panel)]">
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Cycle Status
                </div>
                <div className="text-base font-bold tracking-tight text-[var(--text)] flex items-center gap-2 pt-0.5">
                  {data?.lock_status?.timesheet_locked ? (
                    <Badge variant="success" size="md">Finalised</Badge>
                  ) : data?.lock_status?.roster_locked ? (
                    <Badge variant="purple" size="md">Roster Locked</Badge>
                  ) : (
                    <Badge variant="warning" size="md">Roster Open</Badge>
                  )}
                  {data?.metrics?.unplanned_shifts_today > 0 && (
                    <Badge variant="danger" size="md">
                      {data.metrics.unplanned_shifts_today} Unplanned
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-[var(--muted)]">
                  {data?.lock_status?.is_published ? 'Published to staff' : 'Unpublished draft'}
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-[var(--panel-subtle)] text-[var(--muted)] border border-[var(--border)] flex items-center justify-center shrink-0">
                {data?.lock_status?.timesheet_locked ? (
                  <Lock className="w-6 h-6 text-[var(--success)]" />
                ) : (
                  <Unlock className="w-6 h-6 text-[var(--warn)]" />
                )}
              </div>
            </Card>
          </div>

          {/* Section 2: Needs Attention (Action-Driven Hero Banner) */}
          {totalAttentionCount > 0 ? (
            <Card className="p-5 sm:p-6 bg-gradient-to-r from-[var(--warn-light)]/40 via-[var(--panel)] to-[var(--panel)] border-[var(--warn)]/30">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-[var(--warn)] font-semibold text-xs uppercase tracking-wider">
                    <AlertCircle className="w-4 h-4" />
                    <span>Action Required</span>
                  </div>
                  <h2 className="text-lg font-bold text-[var(--text)]">
                    {totalAttentionCount} item{totalAttentionCount === 1 ? '' : 's'} awaiting your review
                  </h2>
                  <p className="text-xs text-[var(--muted)]">
                    {pendingSubmissionsCount > 0 && `${pendingSubmissionsCount} timesheet${pendingSubmissionsCount === 1 ? '' : 's'} submitted`}
                    {pendingSubmissionsCount > 0 && pendingLeaveCount > 0 && ' • '}
                    {pendingLeaveCount > 0 && `${pendingLeaveCount} leave request${pendingLeaveCount === 1 ? '' : 's'} pending`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {pendingSubmissionsCount > 0 && (
                    <Link to="/timesheets">
                      <Button variant="primary" size="md" leftIcon={<FileCheck2 className="w-4 h-4" />} rightIcon={<ArrowRight className="w-4 h-4" />}>
                        Review {pendingSubmissionsCount} Timesheet{pendingSubmissionsCount === 1 ? '' : 's'}
                      </Button>
                    </Link>
                  )}
                  {pendingLeaveCount > 0 && (
                    <Link to="/leave-requests">
                      <Button variant="outline" size="md" leftIcon={<Plane className="w-4 h-4" />} rightIcon={<ArrowRight className="w-4 h-4" />}>
                        Approve {pendingLeaveCount} Leave Request{pendingLeaveCount === 1 ? '' : 's'}
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-4 bg-[var(--success-light)]/20 border-[var(--success)]/20">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[var(--success-light)] text-[var(--success)] flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--text)]">All caught up!</p>
                    <p className="text-xs text-[var(--muted)]">
                      No timesheets or leave requests require your review right now.
                    </p>
                  </div>
                </div>
                <Link to="/roster">
                  <Button variant="ghost" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                    Open Roster Grid
                  </Button>
                </Link>
              </div>
            </Card>
          )}

          {/* Section 3 & 4: Main Split Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Section 3: Today's Roster (Attendance & Schedule) - Left 2 Cols */}
            <Card className="lg:col-span-2 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
                <div>
                  <h2 className="font-bold text-sm text-[var(--text)]">Today's Staff & Attendance Schedule</h2>
                  <p className="text-xs text-[var(--muted)]">
                    Real-time floor presence, rostered segments, and actual clocking times.
                  </p>
                </div>

                {/* Filter / Search input */}
                <div className="relative w-full sm:w-60">
                  <Search className="w-3.5 h-3.5 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search staff, role..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              {filteredScheduledStaff.length === 0 ? (
                <EmptyState
                  icon={<Calendar className="w-8 h-8 text-[var(--muted)]" />}
                  title={searchQuery ? 'No matching staff found' : 'No staff scheduled for today'}
                  description={searchQuery ? 'Try adjusting your search criteria.' : 'No roster segments are configured for this date.'}
                  action={
                    !searchQuery ? (
                      <Link to="/roster">
                        <Button variant="outline" size="sm">Configure Roster Grid</Button>
                      </Link>
                    ) : undefined
                  }
                />
              ) : (
                <div className="divide-y divide-[var(--border)] max-h-[460px] overflow-y-auto pr-1">
                  {filteredScheduledStaff.map((emp: any) => {
                    const primarySegment = emp.segments?.[0];
                    const isClockedIn = emp.segments?.some((s: any) => s.actual_in && !s.actual_out);
                    const isCompleted = emp.segments?.every((s: any) => s.actual_in && s.actual_out);

                    return (
                      <div key={emp.employee_id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[var(--hover-row)] px-2 rounded-lg transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-[var(--primary-light)] text-[var(--primary)] font-bold text-xs flex items-center justify-center shrink-0">
                            {emp.full_name?.charAt(0) || 'E'}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-xs text-[var(--text)] truncate">{emp.full_name}</span>
                              {emp.department && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--panel-subtle)] text-[var(--muted)] border border-[var(--border)]">
                                  {emp.department}
                                </span>
                              )}
                            </div>
                            {emp.phone && (
                              <div className="flex items-center gap-1 text-xs text-[var(--muted)] mt-0.5">
                                <Phone className="w-3 h-3 text-[var(--primary)]" />
                                <span className="font-mono">{emp.phone}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Shift Times & Status */}
                        <div className="flex items-center gap-4 text-xs shrink-0 self-end sm:self-center">
                          <div className="text-right font-mono">
                            <div className="text-[var(--text)] font-semibold text-xs">
                              {formatTime(primarySegment?.roster_in)} - {formatTime(primarySegment?.roster_out)}
                              <span className="text-[10px] text-[var(--muted)] ml-1 font-sans">
                                ({formatHours(primarySegment?.roster_hours)})
                              </span>
                            </div>
                            <div className="text-[10px] text-[var(--muted)]">
                              Actual: {formatTime(primarySegment?.actual_in)} - {formatTime(primarySegment?.actual_out)}
                            </div>
                          </div>

                          {/* Real-time Status Badge */}
                          <div className="w-28 text-right">
                            {isClockedIn ? (
                              <Badge variant="success" size="sm" className="gap-1 animate-pulse">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
                                Clocked In
                              </Badge>
                            ) : isCompleted ? (
                              <Badge variant="purple" size="sm">Completed</Badge>
                            ) : (
                              <Badge variant="outline" size="sm">Scheduled</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Section 4: Pending Approvals & Quick Operations - Right 1 Col */}
            <div className="space-y-6">
              {/* Pending Timesheet Approvals Queue */}
              <Card className="p-5 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                  <div className="flex items-center gap-2">
                    <FileCheck2 className="w-4 h-4 text-[var(--warn)]" />
                    <h2 className="font-semibold text-xs text-[var(--text)] uppercase tracking-wider">
                      Timesheet Queue
                    </h2>
                  </div>
                  <Badge variant={data?.pending_submissions?.length > 0 ? 'warning' : 'outline'} size="sm">
                    {data?.pending_submissions?.length ?? 0}
                  </Badge>
                </div>

                {!data?.pending_submissions || data.pending_submissions.length === 0 ? (
                  <div className="py-6 text-center text-[var(--muted)] text-xs">
                    <CheckCircle2 className="w-6 h-6 text-[var(--success)] mx-auto mb-1 opacity-80" />
                    No timesheets currently pending review.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {(data.pending_submissions || []).slice(0, 4).map((sub: any) => (
                      <div key={sub.submission_id} className="p-2.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] flex items-center justify-between text-xs">
                        <div>
                          <div className="font-semibold text-[var(--text)]">{sub.full_name}</div>
                          <div className="text-[10px] text-[var(--muted)]">{sub.department || 'General'}</div>
                        </div>
                        <Link to="/timesheets">
                          <Button variant="ghost" size="sm" className="text-xs text-[var(--primary)] hover:text-[var(--primary-h)]">
                            Review →
                          </Button>
                        </Link>
                      </div>
                    ))}
                    {(data?.pending_submissions?.length || 0) > 4 && (
                      <div className="pt-1 text-center">
                        <Link to="/timesheets" className="text-xs font-semibold text-[var(--primary)] hover:underline">
                          View all {data.pending_submissions.length} timesheets →
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </Card>

              {/* Pending Leave Requests */}
              <Card className="p-5 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                  <div className="flex items-center gap-2">
                    <Plane className="w-4 h-4 text-[var(--primary)]" />
                    <h2 className="font-semibold text-xs text-[var(--text)] uppercase tracking-wider">
                      Leave Requests
                    </h2>
                  </div>
                  <Badge variant={(data?.pending_leave?.length || 0) > 0 ? 'purple' : 'outline'} size="sm">
                    {data?.pending_leave?.length ?? 0}
                  </Badge>
                </div>

                {!data?.pending_leave || data.pending_leave.length === 0 ? (
                  <div className="py-6 text-center text-[var(--muted)] text-xs">
                    <CheckCircle2 className="w-6 h-6 text-[var(--success)] mx-auto mb-1 opacity-80" />
                    All leave applications are up to date.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {(data.pending_leave || []).slice(0, 4).map((l: any) => (
                      <div key={l.id} className="p-2.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] flex items-center justify-between text-xs">
                        <div>
                          <div className="font-semibold text-[var(--text)]">{l.full_name}</div>
                          <div className="text-[10px] text-[var(--muted)]">
                            {l.leave_type} • {formatHours(l.hours)} ({l.start_date})
                          </div>
                        </div>
                        <Link to="/leave-requests">
                          <Button variant="ghost" size="sm" className="text-xs text-[var(--primary)] hover:text-[var(--primary-h)]">
                            Action →
                          </Button>
                        </Link>
                      </div>
                    ))}
                    {(data?.pending_leave?.length || 0) > 4 && (
                      <div className="pt-1 text-center">
                        <Link to="/leave-requests" className="text-xs font-semibold text-[var(--primary)] hover:underline">
                          View all {data.pending_leave.length} requests →
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </Card>

              {/* Quick Navigation / Shortcuts */}
              <Card className="p-4 space-y-2 text-xs">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Quick Actions
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Link to="/roster" className="p-2.5 rounded-lg bg-[var(--panel-subtle)] hover:bg-[var(--hover-row)] border border-[var(--border)] flex items-center gap-2 text-[var(--text)] transition-colors">
                    <Calendar className="w-3.5 h-3.5 text-[var(--primary)]" />
                    <span className="font-medium">Roster Grid</span>
                  </Link>
                  <Link to="/employees" className="p-2.5 rounded-lg bg-[var(--panel-subtle)] hover:bg-[var(--hover-row)] border border-[var(--border)] flex items-center gap-2 text-[var(--text)] transition-colors">
                    <Users className="w-3.5 h-3.5 text-[var(--primary)]" />
                    <span className="font-medium">Staff Directory</span>
                  </Link>
                  <Link to="/timesheets" className="p-2.5 rounded-lg bg-[var(--panel-subtle)] hover:bg-[var(--hover-row)] border border-[var(--border)] flex items-center gap-2 text-[var(--text)] transition-colors">
                    <ClipboardList className="w-3.5 h-3.5 text-[var(--primary)]" />
                    <span className="font-medium">Timesheets</span>
                  </Link>
                  <Link to="/audit-log" className="p-2.5 rounded-lg bg-[var(--panel-subtle)] hover:bg-[var(--hover-row)] border border-[var(--border)] flex items-center gap-2 text-[var(--text)] transition-colors">
                    <ShieldCheck className="w-3.5 h-3.5 text-[var(--primary)]" />
                    <span className="font-medium">Audit Log</span>
                  </Link>
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================
          EMPLOYEE COMMAND CENTRE VIEW
      ========================================================= */}
      {!isManager && (
        <div className="space-y-6">
          {data?.has_employee_record === false ? (
            <Card className="p-8 text-center space-y-4 max-w-xl mx-auto my-8">
              <div className="w-14 h-14 rounded-2xl bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center mx-auto">
                <Users className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-base text-[var(--text)]">No Staff Profile Linked</h3>
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  Your login account is active, but is not currently linked to an employee timesheet profile. Please reach out to your manager or administrator to link your profile.
                </p>
              </div>
              <div className="pt-2">
                <Link to="/settings">
                  <Button variant="outline" size="sm">
                    Account Settings
                  </Button>
                </Link>
              </div>
            </Card>
          ) : (
            <>
              {/* Employee Welcome Card */}
          <Card className="p-6 bg-gradient-to-r from-[var(--primary-light)]/20 via-[var(--panel)] to-[var(--panel)] border-[var(--primary)]/20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wider text-[var(--primary)] font-semibold">
                    Staff Home
                  </span>
                  <Badge variant="purple" size="sm">
                    {data?.employee?.department || 'Operations'}
                  </Badge>
                </div>
                <h2 className="text-xl font-bold text-[var(--text)]">
                  {greeting}, {data?.employee?.full_name?.split(' ')[0] || 'Team Member'}
                </h2>
                <p className="text-xs text-[var(--muted)]">
                  Active Fortnight: <strong className="text-[var(--text)] font-sans">{data?.active_fortnight ? formatFortnightLabel(data.active_fortnight) : 'Current'}</strong>
                  {data?.employee?.contracted_hours && (
                    <span> • Target: {data.employee.contracted_hours} hrs</span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-center">
                <Link to="/timesheet">
                  <Button variant="primary" size="md" rightIcon={<ArrowRight className="w-4 h-4" />}>
                    Enter Hours
                  </Button>
                </Link>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent('start-simplehours-tutorial'))}
                  className="px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--panel)] text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)] transition-colors flex items-center gap-1.5"
                  title="Take the 1-minute tour"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[var(--primary)]" />
                  Tour
                </button>
              </div>
            </div>
          </Card>

          {/* Row 1: What am I working today? & Active Fortnight Timesheet */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* What am I working today? */}
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[var(--primary)]" />
                  <h3 className="font-semibold text-sm text-[var(--text)]">Today's Shift</h3>
                </div>
                <Badge variant={data?.lock_status?.is_published ? 'success' : 'warning'} size="sm">
                  {data?.lock_status?.is_published ? 'Published' : 'Draft Schedule'}
                </Badge>
              </div>

              {!data?.lock_status?.is_published && (!data?.my_shifts || data.my_shifts.length === 0) ? (
                <div className="py-8 text-center space-y-2">
                  <Hourglass className="w-8 h-8 text-[var(--warn)] mx-auto opacity-80" />
                  <div className="font-medium text-xs text-[var(--text)]">Roster is being finalized</div>
                  <p className="text-xs text-[var(--muted)] max-w-sm mx-auto">
                    Management has not yet published the roster for this cycle. Your scheduled shifts will appear once released.
                  </p>
                </div>
              ) : data?.my_shifts?.length > 0 ? (
                <div className="space-y-3">
                  {data.my_shifts.map((s: any, idx: number) => (
                    <div key={idx} className="p-3.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[var(--text)]">{s.segment_type || 'Standard Shift'}</span>
                        <Badge variant={s.actual_in && !s.actual_out ? 'success' : s.actual_out ? 'purple' : 'outline'} size="sm">
                          {s.actual_in && !s.actual_out ? 'Clocked In' : s.actual_out ? 'Clocked Out' : 'Scheduled'}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-1">
                        <div className="p-2 rounded bg-[var(--bg)] border border-[var(--border)]">
                          <div className="text-[10px] text-[var(--muted)] uppercase font-sans">Rostered Shift</div>
                          <div className="font-bold text-[var(--text)] text-sm">
                            {formatTime(s.roster_in)} - {formatTime(s.roster_out)}
                          </div>
                          <div className="text-[10px] text-[var(--muted)]">{formatHours(s.roster_hours)}</div>
                        </div>

                        <div className="p-2 rounded bg-[var(--bg)] border border-[var(--border)]">
                          <div className="text-[10px] text-[var(--muted)] uppercase font-sans">Recorded Time</div>
                          <div className="font-bold text-[var(--text)] text-sm">
                            {formatTime(s.actual_in)} - {formatTime(s.actual_out)}
                          </div>
                          <div className="text-[10px] text-[var(--muted)]">{formatHours(s.actual_hours)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="pt-1">
                    <Link to="/timesheet">
                      <Button variant="outline" size="sm" className="w-full" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                        Record Today's Hours
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={<Calendar className="w-8 h-8 text-[var(--muted)]" />}
                  title="No Shift Scheduled Today"
                  description="You do not have a shift assigned for today. Enjoy your day off!"
                  action={
                    <Link to="/schedule">
                      <Button variant="outline" size="sm">View 14-Day Schedule</Button>
                    </Link>
                  }
                />
              )}
            </Card>

            {/* Active Fortnight Submission Status */}
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <FileCheck2 className="w-4 h-4 text-[var(--primary)]" />
                  <h3 className="font-semibold text-sm text-[var(--text)]">Fortnight Timesheet</h3>
                </div>
                <Badge
                  variant={
                    data?.timesheet_status?.status === 'Approved' ? 'success' :
                    data?.timesheet_status?.status === 'Submitted' ? 'purple' :
                    data?.timesheet_status?.status === 'Rejected' ? 'danger' : 'warning'
                  }
                  size="sm"
                >
                  {data?.timesheet_status?.status === 'Approved' ? '✓ Approved' :
                   data?.timesheet_status?.status === 'Submitted' ? '⏳ Awaiting Review' :
                   data?.timesheet_status?.status === 'Rejected' ? '⚠️ Needs Changes' : 'Draft'}
                </Badge>
              </div>

              <div className="p-4 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Fortnight Period:</span>
                  <span className="font-medium text-[var(--text)]">
                    {data?.active_fortnight ? formatFortnightLabel(data.active_fortnight) : 'Active'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Target Hours:</span>
                  <span className="font-semibold text-[var(--text)]">{data?.employee?.contracted_hours ?? 76} hrs</span>
                </div>

                {data?.timesheet_status?.status === 'Rejected' && (
                  <div className="p-3 rounded-md bg-[var(--danger-light)] border border-[var(--danger)]/30 text-[var(--danger)] text-xs mt-2 space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-[var(--danger)]" />
                      Changes requested by manager
                    </div>
                    <p className="text-xs opacity-90">
                      Note: {data.timesheet_status.rejection_reason || 'Please correct your hours and resubmit.'}
                    </p>
                  </div>
                )}

                {data?.timesheet_status?.status === 'Approved' && (
                  <div className="p-3 rounded-md bg-[var(--success-light)] border border-[var(--success)]/30 text-[var(--success)] text-xs mt-2 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[var(--success)] shrink-0" />
                    <span>Your timesheet has been approved by management.</span>
                  </div>
                )}

                {data?.timesheet_status?.status === 'Submitted' && (
                  <div className="p-3 rounded-md bg-[var(--primary-light)] border border-[var(--primary)]/30 text-[var(--primary)] text-xs mt-2 flex items-center gap-2">
                    <Hourglass className="w-4 h-4 text-[var(--primary)] shrink-0" />
                    <span>Submitted and awaiting management review.</span>
                  </div>
                )}
              </div>

              <Link to="/timesheet">
                <Button variant="primary" size="sm" className="w-full" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                  {data?.timesheet_status?.status === 'Rejected' 
                    ? 'Fix & Resubmit Timesheet' 
                    : data?.timesheet_status?.status === 'Submitted'
                    ? 'View Submitted Timesheet'
                    : data?.timesheet_status?.status === 'Approved'
                    ? 'View Approved Timesheet'
                    : 'Enter Fortnight Hours'}
                </Button>
              </Link>
            </Card>
          </div>

          {/* Row 2: My Leave Status & Teammates Today */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* My Leave Requests */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <Plane className="w-4 h-4 text-[var(--primary)]" />
                  <h3 className="font-semibold text-sm text-[var(--text)]">My Leave Requests</h3>
                </div>
                <Link to="/leave-requests">
                  <Button variant="ghost" size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />}>
                    Request Leave
                  </Button>
                </Link>
              </div>

              {!data?.my_leave || data.my_leave.length === 0 ? (
                <div className="py-6 text-center text-[var(--muted)] text-xs">
                  No active or past leave requests found.
                </div>
              ) : (
                <div className="space-y-2">
                  {data.my_leave.map((l: any) => (
                    <div key={l.id} className="p-2.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-[var(--text)]">{l.leave_type}</div>
                        <div className="text-[10px] text-[var(--muted)]">
                          {l.start_date} {l.end_date && l.end_date !== l.start_date ? `to ${l.end_date}` : ''} • {formatHours(l.hours)}
                        </div>
                      </div>
                      <Badge
                        variant={
                          l.status === 'Approved' ? 'success' :
                          l.status === 'Rejected' ? 'danger' : 'warning'
                        }
                        size="sm"
                      >
                        {l.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Teammates On Shift Today */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[var(--primary)]" />
                  <h3 className="font-semibold text-sm text-[var(--text)]">Teammates Working Today</h3>
                </div>
                <Badge variant="outline" size="sm">
                  {data?.team_today ? `${data.team_today.length} on duty` : '0 on duty'}
                </Badge>
              </div>

              {!data?.team_today || data.team_today.length === 0 ? (
                <div className="py-6 text-center text-[var(--muted)] text-xs">
                  No other colleagues scheduled for today.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  {data.team_today.map((member: any, i: number) => (
                    <div key={i} className="p-2.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-[var(--primary-light)] text-[var(--primary)] font-bold text-xs flex items-center justify-center shrink-0">
                        {member.full_name?.charAt(0) || 'T'}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-xs text-[var(--text)] truncate">{member.full_name}</div>
                        <div className="text-[10px] text-[var(--muted)] truncate">{member.department || 'Team'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
        </div>
      )}
    </div>
  );
}
