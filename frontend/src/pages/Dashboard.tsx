import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  Calendar, 
  Users, 
  Clock, 
  FileSpreadsheet, 
  Plane, 
  Bell, 
  ShieldCheck, 
  ArrowRight,
  Lock,
  Unlock,
  CheckCircle2
} from 'lucide-react';
import api from '../services/apiClient';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

export default function Dashboard() {
  const [employeeCount, setEmployeeCount] = useState<number>(0);
  const [activeLocks, setActiveLocks] = useState<any[]>([]);
  const [leaveCount, setLeaveCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardMetrics();
  }, []);

  const fetchDashboardMetrics = async () => {
    setLoading(true);
    try {
      const [empRes, lockRes, leaveRes] = await Promise.allSettled([
        api.get('/employees'),
        api.get('/locks'),
        api.get('/organisation/leave-requests'),
      ]);

      if (empRes.status === 'fulfilled' && empRes.value.data?.data) {
        setEmployeeCount(empRes.value.data.data.length);
      }
      if (lockRes.status === 'fulfilled' && lockRes.value.data?.data) {
        setActiveLocks(lockRes.value.data.data);
      }
      if (leaveRes.status === 'fulfilled' && leaveRes.value.data?.data) {
        const pending = leaveRes.value.data.data.filter((l: any) => l.status === 'Pending').length;
        setLeaveCount(pending);
      }
    } catch (err) {
      console.warn('Failed to load dashboard metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  const latestLock = activeLocks[0] || null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Workforce Overview</h1>
          <p className="text-xs text-[var(--muted)] mt-1">
            Real-time compliance status, active roster cycle, and pending approvals.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link to="/roster">
            <Button variant="primary" size="sm" leftIcon={<Calendar className="w-4 h-4" />}>
              Open Roster Editor
            </Button>
          </Link>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <Card className="p-5 space-y-2">
          <div className="flex items-center justify-between text-[var(--muted)]">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Staff</span>
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-3xl font-bold tracking-tight text-[var(--text)]">
            {loading ? '...' : employeeCount}
          </div>
          <div className="text-[11px] text-[var(--muted)] flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            <span>Eligible for scheduling</span>
          </div>
        </Card>

        {/* Metric 2 */}
        <Card className="p-5 space-y-2">
          <div className="flex items-center justify-between text-[var(--muted)]">
            <span className="text-xs font-semibold uppercase tracking-wider">Current Fortnight</span>
            <Clock className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-lg font-bold tracking-tight text-[var(--text)] font-mono">
            {latestLock?.start_date || 'Active Cycle'}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Badge variant={latestLock?.roster_locked ? 'success' : 'warning'} size="sm">
              {latestLock?.roster_locked ? 'Roster Locked' : 'Roster Open'}
            </Badge>
          </div>
        </Card>

        {/* Metric 3 */}
        <Card className="p-5 space-y-2">
          <div className="flex items-center justify-between text-[var(--muted)]">
            <span className="text-xs font-semibold uppercase tracking-wider">Pending Leave</span>
            <Plane className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-3xl font-bold tracking-tight text-[var(--text)]">
            {loading ? '...' : leaveCount}
          </div>
          <div className="text-[11px] text-[var(--muted)]">
            {leaveCount > 0 ? (
              <Link to="/leave-requests" className="text-indigo-400 hover:underline">
                Requires review →
              </Link>
            ) : (
              <span>All requests actioned</span>
            )}
          </div>
        </Card>

        {/* Metric 4 */}
        <Card className="p-5 space-y-2">
          <div className="flex items-center justify-between text-[var(--muted)]">
            <span className="text-xs font-semibold uppercase tracking-wider">Timesheet State</span>
            {latestLock?.timesheet_locked ? (
              <Lock className="w-4 h-4 text-emerald-500" />
            ) : (
              <Unlock className="w-4 h-4 text-amber-500" />
            )}
          </div>
          <div className="text-lg font-bold tracking-tight text-[var(--text)]">
            {latestLock?.timesheet_locked ? 'Finalised' : 'Unfinalised'}
          </div>
          <div className="text-[11px] text-[var(--muted)]">
            {latestLock?.timesheet_locked ? 'Ready for export' : 'Clock-ins active'}
          </div>
        </Card>
      </div>

      {/* Quick Launchpad */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6 space-y-4">
          <CardHeader className="mb-0 pb-3">
            <CardTitle>Workforce Operations Launchpad</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <Link to="/roster" className="p-4 rounded-lg bg-[var(--panel-subtle)] hover:bg-[var(--hover-row)] border border-[var(--border)] transition-colors flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-md bg-indigo-600/10 text-indigo-400 flex items-center justify-center">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-xs text-[var(--text)] group-hover:text-indigo-400 transition-colors">
                    Shift Roster
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">14-day schedule & actuals</div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-[var(--muted)] group-hover:translate-x-0.5 transition-transform" />
            </Link>

            <Link to="/employees" className="p-4 rounded-lg bg-[var(--panel-subtle)] hover:bg-[var(--hover-row)] border border-[var(--border)] transition-colors flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-md bg-indigo-600/10 text-indigo-400 flex items-center justify-center">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-xs text-[var(--text)] group-hover:text-indigo-400 transition-colors">
                    Staff Directory
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">Contracts & department teams</div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-[var(--muted)] group-hover:translate-x-0.5 transition-transform" />
            </Link>

            <Link to="/leave-requests" className="p-4 rounded-lg bg-[var(--panel-subtle)] hover:bg-[var(--hover-row)] border border-[var(--border)] transition-colors flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-md bg-indigo-600/10 text-indigo-400 flex items-center justify-center">
                  <Plane className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-xs text-[var(--text)] group-hover:text-indigo-400 transition-colors">
                    Leave Approvals
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">Annual & sick leave review</div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-[var(--muted)] group-hover:translate-x-0.5 transition-transform" />
            </Link>

            <Link to="/announcements" className="p-4 rounded-lg bg-[var(--panel-subtle)] hover:bg-[var(--hover-row)] border border-[var(--border)] transition-colors flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-md bg-indigo-600/10 text-indigo-400 flex items-center justify-center">
                  <Bell className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-semibold text-xs text-[var(--text)] group-hover:text-indigo-400 transition-colors">
                    Team Alerts
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">Broadcasts & roster alerts</div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-[var(--muted)] group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>
        </Card>

        {/* Security & Compliance Highlights */}
        <Card className="p-6 space-y-4">
          <CardHeader className="mb-0 pb-3">
            <CardTitle>Compliance Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-2 text-xs">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-[var(--text)]">Dual-Password Encryption</div>
                <div className="text-[11px] text-[var(--muted)]">Roster & timesheet passwords active</div>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-[var(--text)]">Fair Work Meal Breaks</div>
                <div className="text-[11px] text-[var(--muted)]">Automatic 30m deduction enabled</div>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <FileSpreadsheet className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-[var(--text)]">Payroll Bureau Export</div>
                <div className="text-[11px] text-[var(--muted)]">RFC 4180 CSV attachment format</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
