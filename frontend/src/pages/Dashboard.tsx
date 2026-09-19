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
  Search 
} from 'lucide-react';
import api from '../services/apiClient';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Skeleton, CardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';

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
        setData(res.data);
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

  const isManager = data && ['Admin', 'Company Admin', 'Platform Admin', 'Manager'].includes(data.role);

  // Format today's human-readable date
  const todayDateStr = data?.date ? new Date(data.date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : 'Today';

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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
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

  return (
    <div className="space-y-6">
      {/* Top Banner & Context */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
              {isManager ? "Today's Operational Overview" : "Today's Schedule & Timesheet"}
            </h1>
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[var(--primary-light)] text-[var(--primary)] border border-[var(--primary)]/20">
              Live Feed
            </span>
          </div>
          <p className="text-xs text-[var(--muted)] mt-1.5 flex flex-wrap items-center gap-2">
            <span>{todayDateStr}</span>
            <span>•</span>
            <span>Fortnight Cycle: <strong className="text-[var(--text)] font-mono">{data?.active_fortnight}</strong></span>
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
            <Link to="/roster">
              <Button variant="primary" size="sm" leftIcon={<Calendar className="w-4 h-4" />}>
                Open Roster Grid
              </Button>
            </Link>
          ) : (
            <Link to="/portal">
              <Button variant="primary" size="sm" leftIcon={<Clock className="w-4 h-4" />}>
                My Timesheet
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* =========================================================
          MANAGER / ADMIN COMMAND CENTRE VIEW
      ========================================================= */}
      {isManager && (
        <>
          {/* Key Operational KPI Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Metric 1: Currently Working */}
            <Card className="p-4 space-y-1 bg-[var(--primary-light)]/20 border-[var(--primary)]/30">
              <div className="flex items-center justify-between text-[var(--primary)]">
                <span className="text-xs font-semibold uppercase tracking-wider">On Floor Now</span>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--success)]"></span>
                </span>
              </div>
              <div className="text-3xl font-bold tracking-tight text-[var(--success)]">
                {data?.metrics?.currently_working ?? 0}
              </div>
              <div className="text-xs text-[var(--muted)]">Clocked in right now</div>
            </Card>

            {/* Metric 2: Scheduled Today */}
            <Card className="p-4 space-y-1">
              <div className="flex items-center justify-between text-[var(--muted)]">
                <span className="text-xs font-semibold uppercase tracking-wider">Rostered Shifts</span>
                <Calendar className="w-3.5 h-3.5 text-[var(--primary)]" />
              </div>
              <div className="text-3xl font-bold tracking-tight text-[var(--text)]">
                {data?.metrics?.scheduled_today ?? 0}
              </div>
              <div className="text-xs text-[var(--muted)]">Shifts today</div>
            </Card>

            {/* Metric 3: Pending Timesheets */}
            <Card className={`p-4 space-y-1 ${data?.metrics?.pending_submissions > 0 ? 'border-[var(--warn)]/50 bg-[var(--warn-light)]' : ''}`}>
              <div className="flex items-center justify-between text-[var(--muted)]">
                <span className="text-xs font-semibold uppercase tracking-wider">Pending Timesheets</span>
                <FileCheck2 className="w-3.5 h-3.5 text-[var(--warn)]" />
              </div>
              <div className="text-3xl font-bold tracking-tight text-[var(--text)]">
                {data?.metrics?.pending_submissions ?? 0}
              </div>
              <div className="text-xs text-[var(--muted)]">Awaiting approval</div>
            </Card>

            {/* Metric 4: Pending Leave */}
            <Card className={`p-4 space-y-1 ${data?.metrics?.pending_leave > 0 ? 'border-[var(--primary)]/40' : ''}`}>
              <div className="flex items-center justify-between text-[var(--muted)]">
                <span className="text-xs font-semibold uppercase tracking-wider">Leave Requests</span>
                <Plane className="w-3.5 h-3.5 text-[var(--primary)]" />
              </div>
              <div className="text-3xl font-bold tracking-tight text-[var(--text)]">
                {data?.metrics?.pending_leave ?? 0}
              </div>
              <div className="text-xs text-[var(--muted)]">To review</div>
            </Card>

            {/* Metric 5: Total Staff */}
            <Card className="p-4 space-y-1">
              <div className="flex items-center justify-between text-[var(--muted)]">
                <span className="text-xs font-semibold uppercase tracking-wider">Active Staff</span>
                <Users className="w-3.5 h-3.5 text-[var(--primary)]" />
              </div>
              <div className="text-3xl font-bold tracking-tight text-[var(--text)]">
                {data?.metrics?.total_staff ?? 0}
              </div>
              <div className="text-xs text-[var(--muted)]">In organisation</div>
            </Card>

            {/* Metric 6: Cycle Lock State */}
            <Card className="p-4 space-y-1">
              <div className="flex items-center justify-between text-[var(--muted)]">
                <span className="text-xs font-semibold uppercase tracking-wider">Cycle Status</span>
                {data?.lock_status?.timesheet_locked ? (
                  <Lock className="w-3.5 h-3.5 text-[var(--success)]" />
                ) : (
                  <Unlock className="w-3.5 h-3.5 text-[var(--warn)]" />
                )}
              </div>
              <div className="text-sm font-bold tracking-tight text-[var(--text)] pt-1">
                {data?.lock_status?.timesheet_locked ? 'Finalised' : data?.lock_status?.roster_locked ? 'Roster Locked' : 'Roster Open'}
              </div>
              <div className="text-[11px] text-[var(--muted)]">
                {data?.lock_status?.is_published ? 'Published to staff' : 'Unpublished draft'}
              </div>
            </Card>
          </div>

          {/* Main Operational Split */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 2 Cols: Live Shift Attendance Today */}
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
                    placeholder="Search name, department..."
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
                <div className="divide-y divide-[var(--border)] max-h-[480px] overflow-y-auto pr-1">
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
                              {primarySegment?.roster_in || '--:--'} - {primarySegment?.roster_out || '--:--'}
                              <span className="text-[10px] text-[var(--muted)] ml-1 font-sans">
                                ({primarySegment?.roster_hours || 0}h)
                              </span>
                            </div>
                            <div className="text-[10px] text-[var(--muted)]">
                              Actual: {primarySegment?.actual_in || '--:--'} - {primarySegment?.actual_out || '--:--'}
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

            {/* Right 1 Col: Action Required & Pending Approvals */}
            <div className="space-y-6">
              {/* Pending Timesheet Approvals */}
              <Card className="p-5 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                  <div className="flex items-center gap-2">
                    <FileCheck2 className="w-4 h-4 text-[var(--warn)]" />
                    <h2 className="font-semibold text-xs text-[var(--text)] uppercase tracking-wider">
                      Timesheets to Review
                    </h2>
                  </div>
                  <Badge variant={data?.pending_submissions?.length > 0 ? 'warning' : 'outline'} size="sm">
                    {data?.pending_submissions?.length ?? 0}
                  </Badge>
                </div>

                {data?.pending_submissions?.length === 0 ? (
                  <div className="py-6 text-center text-[var(--muted)] text-xs">
                    <CheckCircle2 className="w-6 h-6 text-[var(--success)] mx-auto mb-1 opacity-80" />
                    No timesheets currently pending review.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {data.pending_submissions.map((sub: any) => (
                      <div key={sub.submission_id} className="p-2.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] flex items-center justify-between text-xs">
                        <div>
                          <div className="font-semibold text-[var(--text)]">{sub.full_name}</div>
                          <div className="text-[10px] text-[var(--muted)]">{sub.department || 'General'}</div>
                        </div>
                        <Link to="/roster">
                          <Button variant="ghost" size="sm" className="text-xs text-[var(--primary)] hover:text-[var(--primary-h)]">
                            Review →
                          </Button>
                        </Link>
                      </div>
                    ))}
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
                  <Badge variant={data?.pending_leave?.length > 0 ? 'purple' : 'outline'} size="sm">
                    {data?.pending_leave?.length ?? 0}
                  </Badge>
                </div>

                {data?.pending_leave?.length === 0 ? (
                  <div className="py-6 text-center text-[var(--muted)] text-xs">
                    <CheckCircle2 className="w-6 h-6 text-[var(--success)] mx-auto mb-1 opacity-80" />
                    All leave applications are up to date.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {data.pending_leave.map((l: any) => (
                      <div key={l.id} className="p-2.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] flex items-center justify-between text-xs">
                        <div>
                          <div className="font-semibold text-[var(--text)]">{l.full_name}</div>
                          <div className="text-[10px] text-[var(--muted)]">
                            {l.leave_type} • {l.hours}h ({l.start_date})
                          </div>
                        </div>
                        <Link to="/leave-requests">
                          <Button variant="ghost" size="sm" className="text-xs text-[var(--primary)] hover:text-[var(--primary-h)]">
                            Action →
                          </Button>
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Quick Operation Links */}
              <Card className="p-4 space-y-2 text-xs">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Quick Navigation
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Link to="/employees" className="p-2.5 rounded-lg bg-[var(--panel-subtle)] hover:bg-[var(--hover-row)] border border-[var(--border)] flex items-center gap-2 text-[var(--text)] transition-colors">
                    <Users className="w-3.5 h-3.5 text-[var(--primary)]" />
                    <span>Staff Directory</span>
                  </Link>
                  <Link to="/leave-requests" className="p-2.5 rounded-lg bg-[var(--panel-subtle)] hover:bg-[var(--hover-row)] border border-[var(--border)] flex items-center gap-2 text-[var(--text)] transition-colors">
                    <Plane className="w-3.5 h-3.5 text-[var(--primary)]" />
                    <span>Leave Board</span>
                  </Link>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}

      {/* =========================================================
          EMPLOYEE COMMAND CENTRE VIEW
      ========================================================= */}
      {!isManager && (
        <div className="space-y-6">
          {/* Employee Welcome Card */}
          <Card className="p-6 bg-gradient-to-r from-[var(--primary-light)]/20 via-[var(--panel)] to-[var(--panel)] border-[var(--primary)]/20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wider text-[var(--primary)] font-semibold">
                    Staff Portal
                  </span>
                  <Badge variant="purple" size="sm">
                    {data?.employee?.department || 'Operations'}
                  </Badge>
                </div>
                <h2 className="text-xl font-bold text-[var(--text)]">
                  Welcome back, {data?.employee?.full_name || 'Team Member'}
                </h2>
                <p className="text-xs text-[var(--muted)]">
                  Contracted Hours: <strong className="text-[var(--text)] font-mono">{data?.employee?.contracted_hours ?? 76} hrs</strong> / fortnight
                </p>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-center">
                <Link to="/portal">
                  <Button variant="primary" size="md" leftIcon={<Clock className="w-4 h-4" />}>
                    Open 14-Day Timesheet
                  </Button>
                </Link>
              </div>
            </div>
          </Card>

          {/* Today's Shift & Fortnight Submission Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Shift Today */}
            <Card className="p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[var(--primary)]" />
                  <h3 className="font-semibold text-sm text-[var(--text)]">Today's Shift Schedule</h3>
                </div>
                <Badge variant={data?.lock_status?.is_published ? 'success' : 'warning'} size="sm">
                  {data?.lock_status?.is_published ? 'Published' : 'Draft / Unfinalised'}
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
                          <div className="text-[10px] text-[var(--muted)] uppercase font-sans">Rostered</div>
                          <div className="font-bold text-[var(--text)] text-sm">
                            {s.roster_in || '--:--'} - {s.roster_out || '--:--'}
                          </div>
                          <div className="text-[10px] text-[var(--muted)]">{s.roster_hours || 0} hrs</div>
                        </div>

                        <div className="p-2 rounded bg-[var(--bg)] border border-[var(--border)]">
                          <div className="text-[10px] text-[var(--muted)] uppercase font-sans">Recorded Actual</div>
                          <div className="font-bold text-[var(--text)] text-sm">
                            {s.actual_in || '--:--'} - {s.actual_out || '--:--'}
                          </div>
                          <div className="text-[10px] text-[var(--muted)]">{s.actual_hours || 0} hrs</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="pt-1">
                    <Link to="/portal">
                      <Button variant="outline" size="sm" className="w-full" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                        Manage Today's Clock In / Out
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
                    <Link to="/portal">
                      <Button variant="outline" size="sm">View Full 14-Day Roster</Button>
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
                  <h3 className="font-semibold text-sm text-[var(--text)]">Fortnight Timesheet Status</h3>
                </div>
                <Badge
                  variant={
                    data?.timesheet_status?.status === 'Approved' ? 'success' :
                    data?.timesheet_status?.status === 'Submitted' ? 'purple' :
                    data?.timesheet_status?.status === 'Rejected' ? 'danger' : 'warning'
                  }
                  size="sm"
                >
                  {data?.timesheet_status?.status || 'Draft'}
                </Badge>
              </div>

              <div className="p-4 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Active Fortnight:</span>
                  <span className="font-mono font-semibold text-[var(--text)]">{data?.active_fortnight}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted)]">Submission Status:</span>
                  <span className="font-semibold text-[var(--text)]">{data?.timesheet_status?.status || 'Draft'}</span>
                </div>

                {data?.timesheet_status?.status === 'Rejected' && (
                  <div className="p-3 rounded-md bg-[var(--danger-light)] border border-[var(--danger)]/30 text-[var(--danger)] text-xs mt-2 space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-[var(--danger)]" />
                      Timesheet Returned by Manager
                    </div>
                    <p className="text-xs opacity-90">
                      Reason: {data.timesheet_status.rejection_reason || 'Please correct hours and resubmit.'}
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

              <Link to="/portal">
                <Button variant="primary" size="sm" className="w-full" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                  {data?.timesheet_status?.status === 'Rejected' ? 'Correct & Resubmit Timesheet' : 'Go to Timesheet Portal'}
                </Button>
              </Link>
            </Card>
          </div>

          {/* On Duty Teammates */}
          {data?.team_today && data.team_today.length > 0 && (
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[var(--primary)]" />
                  <h3 className="font-semibold text-sm text-[var(--text)]">Teammates Working Today</h3>
                </div>
                <Badge variant="outline" size="sm">{data.team_today.length} Rostered</Badge>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-1">
                {data.team_today.map((member: any, i: number) => (
                  <div key={i} className="p-3 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] flex items-center gap-2.5">
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
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
