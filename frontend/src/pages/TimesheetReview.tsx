import { useState, useEffect, useCallback } from 'react';
import { 
  FileCheck2, 
  CheckCircle2, 
  AlertCircle, 
  ChevronLeft, 
  ChevronRight, 
  Search, 
  ChevronDown, 
  ChevronUp, 
  Send, 
  Sparkles
} from 'lucide-react';
import api from '../services/apiClient';
import { getFortnightStart, fmtISO } from '../utils/fortnight';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';

interface SubmissionItem {
  employee_id: string;
  full_name: string;
  department: string;
  contracted_hours: number;
  rostered_hours: number;
  actual_hours: number;
  variance_hours: number;
  status: 'Draft' | 'Submitted' | 'Under Review' | 'Approved' | 'Rejected';
  submission_id?: string;
  submitted_at?: string;
  reviewed_at?: string;
  rejection_reason?: string;
}

export default function TimesheetReview() {
  const toast = useToast();
  const [activeDate, setActiveDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [filterTab, setFilterTab] = useState<'ready' | 'needs_changes' | 'approved' | 'draft' | 'all'>('ready');
  const [searchQuery, setSearchQuery] = useState('');

  // Expand row for 14-day detail
  const [expandedEmpId, setExpandedEmpId] = useState<string | null>(null);
  const [dailyDetails, setDailyDetails] = useState<Record<string, any[]>>({});
  const [loadingDaily, setLoadingDaily] = useState<string | null>(null);

  // Request changes modal
  const [rejectingEmp, setRejectingEmp] = useState<SubmissionItem | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);

  // Bulk approval state
  const [isBulkApproving, setIsBulkApproving] = useState(false);

  const fnStart = getFortnightStart(activeDate);
  const fnIso = fmtISO(fnStart);

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/submissions?start_date=${fnIso}`);
      if (res.data?.success) {
        setSubmissions(res.data.data || []);
      }
    } catch (err: any) {
      console.error('Failed to load submissions:', err);
      toast.error('Unable to fetch timesheets for this fortnight.');
    } finally {
      setLoading(false);
    }
  }, [fnIso, toast]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  // Navigate fortnights
  const handlePrev = () => {
    const d = new Date(activeDate);
    d.setDate(d.getDate() - 14);
    setActiveDate(d);
  };

  const handleNext = () => {
    const d = new Date(activeDate);
    d.setDate(d.getDate() + 14);
    setActiveDate(d);
  };

  const handleCurrent = () => {
    setActiveDate(new Date());
  };

  // One-click approval
  const handleApprove = async (emp: SubmissionItem) => {
    try {
      await api.post('/submissions/approve', {
        start_date: fnIso,
        employee_id: emp.employee_id
      });
      toast.success(`Timesheet approved for ${emp.full_name}`);
      fetchSubmissions();
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Failed to approve timesheet.');
    }
  };

  // Open Request Changes Modal
  const openRejectModal = (emp: SubmissionItem) => {
    setRejectingEmp(emp);
    setRejectionReason('');
  };

  // Submit Request Changes
  const handleConfirmReject = async () => {
    if (!rejectingEmp) return;
    setIsRejecting(true);
    try {
      await api.post('/submissions/reject', {
        start_date: fnIso,
        employee_id: rejectingEmp.employee_id,
        reason: rejectionReason || 'Please review and adjust your recorded shift hours.'
      });
      toast.success(`Requested changes sent to ${rejectingEmp.full_name}`);
      setRejectingEmp(null);
      fetchSubmissions();
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Failed to return timesheet.');
    } finally {
      setIsRejecting(false);
    }
  };

  // Bulk Approve all Ready
  const handleBulkApprove = async () => {
    const readyEmps = submissions.filter(s => s.status === 'Submitted' || s.status === 'Under Review');
    if (readyEmps.length === 0) return;

    setIsBulkApproving(true);
    try {
      await api.post('/submissions/bulk-approve', {
        start_date: fnIso,
        employee_ids: readyEmps.map(s => s.employee_id)
      });
      toast.success(`Successfully approved ${readyEmps.length} timesheets`);
      fetchSubmissions();
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Failed to bulk approve timesheets.');
    } finally {
      setIsBulkApproving(false);
    }
  };

  // Expand employee daily breakdown
  const toggleExpand = async (empId: string) => {
    if (expandedEmpId === empId) {
      setExpandedEmpId(null);
      return;
    }

    setExpandedEmpId(empId);
    if (!dailyDetails[empId]) {
      setLoadingDaily(empId);
      try {
        const res = await api.get(`/records?start_date=${fnIso}`);
        if (res.data?.success) {
          const empRecords = (res.data.data || []).filter((r: any) => r.employee_id === empId);
          setDailyDetails(prev => ({ ...prev, [empId]: empRecords }));
        }
      } catch (err) {
        console.warn('Failed to load daily records', err);
      } finally {
        setLoadingDaily(null);
      }
    }
  };

  // Counts
  const readyCount = submissions.filter(s => s.status === 'Submitted' || s.status === 'Under Review').length;
  const needsChangesCount = submissions.filter(s => s.status === 'Rejected').length;
  const approvedCount = submissions.filter(s => s.status === 'Approved').length;
  const draftCount = submissions.filter(s => s.status === 'Draft').length;

  // Filtered list
  const filteredSubmissions = submissions.filter(s => {
    const matchesSearch = s.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (s.department && s.department.toLowerCase().includes(searchQuery.toLowerCase()));
    if (!matchesSearch) return false;

    if (filterTab === 'ready') return s.status === 'Submitted' || s.status === 'Under Review';
    if (filterTab === 'needs_changes') return s.status === 'Rejected';
    if (filterTab === 'approved') return s.status === 'Approved';
    if (filterTab === 'draft') return s.status === 'Draft';
    return true;
  });

  const [fy, fm, fd] = fnIso.split('-').map(Number);
  const fnStartDate = new Date(Date.UTC(fy, fm - 1, fd));
  const fnEndDate = new Date(fnStartDate);
  fnEndDate.setDate(fnEndDate.getDate() + 13);
  const fnDateRangeStr = `${fnStartDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${fnEndDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <div className="space-y-6 pb-16">
      {/* 1. Header & Fortnight Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
              Timesheet Approvals
            </h1>
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[var(--primary-light)] text-[var(--primary)] border border-[var(--primary)]/20">
              Manager Queue
            </span>
          </div>
          <p className="text-xs text-[var(--muted)] mt-1.5 flex items-center gap-2">
            <span>Pay Fortnight: <strong>{fnDateRangeStr}</strong></span>
            <span>•</span>
            <span>{submissions.length} Total Staff</span>
          </p>
        </div>

        {/* Fortnight Navigation Controls */}
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0.5">
            <button
              onClick={handlePrev}
              className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] transition-colors"
              title="Previous Fortnight"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleCurrent}
              className="px-2.5 py-1 text-xs font-semibold text-[var(--text)] hover:bg-[var(--panel-subtle)] rounded transition-colors"
            >
              Current Cycle
            </button>
            <button
              onClick={handleNext}
              className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] transition-colors"
              title="Next Fortnight"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 2. Needs Attention Hero Card */}
      <Card className="p-5 bg-[var(--panel-subtle)] border-[var(--border)] space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[var(--primary)]" />
              <h2 className="font-bold text-lg text-[var(--text)]">
                {readyCount > 0 
                  ? `${readyCount} timesheet${readyCount === 1 ? '' : 's'} ready for review` 
                  : 'All submitted timesheets are up to date'}
              </h2>
            </div>
            <p className="text-xs text-[var(--muted)]">
              {readyCount} ready to approve • {needsChangesCount} returned for changes • {approvedCount} approved
            </p>
          </div>

          {/* Bulk Approve Action */}
          {readyCount > 0 && (
            <Button
              variant="primary"
              size="md"
              onClick={handleBulkApprove}
              loading={isBulkApproving}
              rightIcon={<CheckCircle2 className="w-4 h-4" />}
            >
              Approve All Ready ({readyCount})
            </Button>
          )}
        </div>
      </Card>

      {/* 3. Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[var(--panel-subtle)] border border-[var(--border)] overflow-x-auto">
          <button
            type="button"
            onClick={() => setFilterTab('ready')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              filterTab === 'ready'
                ? 'bg-[var(--panel)] text-[var(--primary)] shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <span>Ready to Approve</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[var(--primary-light)] text-[var(--primary)]">
              {readyCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterTab('needs_changes')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              filterTab === 'needs_changes'
                ? 'bg-[var(--panel)] text-[var(--warn)] shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <span>Needs Changes</span>
            {needsChangesCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[var(--warn-light)] text-[var(--warn)]">
                {needsChangesCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setFilterTab('approved')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              filterTab === 'approved'
                ? 'bg-[var(--panel)] text-[var(--success)] shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <span>Approved ({approvedCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterTab('draft')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              filterTab === 'draft'
                ? 'bg-[var(--panel)] text-[var(--text)] shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            Draft / Unsubmitted ({draftCount})
          </button>

          <button
            type="button"
            onClick={() => setFilterTab('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              filterTab === 'all'
                ? 'bg-[var(--panel)] text-[var(--text)] shadow-xs'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            All ({submissions.length})
          </button>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="text"
            placeholder="Search employee..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] text-xs text-[var(--text)]"
          />
        </div>
      </div>

      {/* 4. Submissions List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : filteredSubmissions.length === 0 ? (
        <EmptyState
          icon={<FileCheck2 className="w-10 h-10 text-[var(--muted)]" />}
          title="No Timesheets in this View"
          description={
            filterTab === 'ready'
              ? 'There are no submitted timesheets waiting for your review.'
              : 'No timesheets match the selected filter.'
          }
          action={
            filterTab !== 'all' ? (
              <Button variant="outline" size="sm" onClick={() => setFilterTab('all')}>
                View All Timesheets
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredSubmissions.map((emp) => {
            const isReady = emp.status === 'Submitted' || emp.status === 'Under Review';
            const isApproved = emp.status === 'Approved';
            const isRejected = emp.status === 'Rejected';
            const isExpanded = expandedEmpId === emp.employee_id;

            return (
              <Card
                key={emp.employee_id}
                className={`p-4 sm:p-5 transition-all ${
                  isReady 
                    ? 'border-[var(--primary)]/60 bg-[var(--panel)] ring-1 ring-[var(--primary)]/20' 
                    : isRejected
                    ? 'border-[var(--warn)]/40 bg-[var(--warn-light)]/10'
                    : 'border-[var(--border)] bg-[var(--panel)]'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Left Column: Staff info */}
                  <div className="space-y-1 sm:min-w-[220px]">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-[var(--primary-light)] text-[var(--primary)] font-bold text-xs flex items-center justify-center shrink-0">
                        {emp.full_name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-bold text-sm text-[var(--text)]">
                          {emp.full_name}
                        </div>
                        <div className="text-xs text-[var(--muted)]">
                          {emp.department || 'Staff'} • Contract: {emp.contracted_hours} hrs
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Middle Column: Hours summary */}
                  <div className="flex items-center gap-6 sm:pl-9 lg:pl-0">
                    <div>
                      <div className="text-[10px] uppercase font-bold text-[var(--muted)]">Rostered</div>
                      <div className="text-sm font-bold font-mono text-[var(--text)]">
                        {emp.rostered_hours} hrs
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] uppercase font-bold text-[var(--muted)]">Actual Recorded</div>
                      <div className="text-sm font-bold font-mono text-[var(--text)]">
                        {emp.actual_hours} hrs
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] uppercase font-bold text-[var(--muted)]">Variance</div>
                      <div className={`text-xs font-mono font-bold ${
                        emp.variance_hours > 0 ? 'text-[var(--warn)]' : emp.variance_hours < 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'
                      }`}>
                        {emp.variance_hours > 0 ? `+${emp.variance_hours}` : emp.variance_hours} hrs
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] uppercase font-bold text-[var(--muted)]">Status</div>
                      <div>
                        {isApproved ? (
                          <Badge variant="success" size="sm">✓ Approved</Badge>
                        ) : isReady ? (
                          <Badge variant="purple" size="sm">⏳ Ready to Approve</Badge>
                        ) : isRejected ? (
                          <Badge variant="danger" size="sm">⚠️ Needs Changes</Badge>
                        ) : (
                          <Badge variant="default" size="sm">Draft / Not Submitted</Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Actions */}
                  <div className="flex items-center gap-2 self-start lg:self-center">
                    <button
                      type="button"
                      onClick={() => toggleExpand(emp.employee_id)}
                      className="px-2.5 py-1.5 rounded-md text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] flex items-center gap-1 border border-[var(--border)] transition-colors"
                      title="Inspect 14-day shift details"
                    >
                      <span>Details</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    {isReady && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openRejectModal(emp)}
                          className="text-[var(--danger)] border-[var(--danger)]/30 hover:bg-[var(--danger-light)]"
                        >
                          Request Changes
                        </Button>

                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleApprove(emp)}
                          leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                        >
                          Approve
                        </Button>
                      </>
                    )}

                    {isRejected && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleApprove(emp)}
                        leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                      >
                        Override & Approve
                      </Button>
                    )}
                  </div>
                </div>

                {/* Rejection Reason Notice */}
                {isRejected && emp.rejection_reason && (
                  <div className="mt-3 p-2.5 rounded-lg bg-[var(--danger-light)] border border-[var(--danger)]/25 text-xs text-[var(--danger)]">
                    <strong>Note sent to employee:</strong> "{emp.rejection_reason}"
                  </div>
                )}

                {/* Expandable Daily Breakdown */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-[var(--border)] space-y-2 text-xs">
                    <div className="font-semibold text-[var(--text)] flex items-center justify-between">
                      <span>14-Day Breakdown (Rostered vs Actual)</span>
                      {loadingDaily === emp.employee_id && <span className="text-[var(--muted)]">Loading daily hours...</span>}
                    </div>

                    <div className="p-3 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-[var(--border)] text-[var(--muted)] uppercase font-semibold text-[10px]">
                            <th className="pb-2">Date</th>
                            <th className="pb-2">Scheduled Shift</th>
                            <th className="pb-2">Actual Clocked</th>
                            <th className="pb-2">Daily Hours</th>
                            <th className="pb-2">Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]/40">
                          {dailyDetails[emp.employee_id] && dailyDetails[emp.employee_id].length > 0 ? (
                            dailyDetails[emp.employee_id].map((r: any) => {
                              const s = r.segments?.[0] || {};
                              return (
                                <tr key={r.record_date} className="hover:bg-[var(--panel)]/50">
                                  <td className="py-2 font-medium text-[var(--text)]">{r.record_date}</td>
                                  <td className="py-2 font-mono text-[var(--muted)]">
                                    {s.roster_in && s.roster_out ? `${s.roster_in.substring(0, 5)} – ${s.roster_out.substring(0, 5)}` : '--'}
                                  </td>
                                  <td className="py-2 font-mono font-semibold text-[var(--text)]">
                                    {s.actual_in && s.actual_out ? `${s.actual_in.substring(0, 5)} – ${s.actual_out.substring(0, 5)}` : '--'}
                                  </td>
                                  <td className="py-2 font-mono">{s.actual_hours ?? s.roster_hours ?? 0} hrs</td>
                                  <td className="py-2 text-[var(--muted)] truncate max-w-xs">{s.notes || '--'}</td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan={5} className="py-4 text-center text-[var(--muted)]">
                                Daily record details loaded with standard fortnight cycle hours.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* 5. Request Changes Modal */}
      {rejectingEmp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-[var(--warn-light)] text-[var(--warn)]">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-base text-[var(--text)]">Request Changes</h3>
                <p className="text-xs text-[var(--muted)]">Return timesheet to {rejectingEmp.full_name}</p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-[var(--text)]">
                What needs to be corrected?
              </label>
              <textarea
                rows={3}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Missing finish time on Friday 3 April; please verify your meal break."
                className="w-full p-3 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] text-xs text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>

            {/* Presets */}
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-bold text-[var(--muted)]">Quick presets:</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Missing finish time',
                  'Verify meal break deduction',
                  'Overtime requires pre-approval',
                  'Shift hours exceed roster'
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRejectionReason(preset)}
                    className="px-2.5 py-1 rounded-md bg-[var(--panel-subtle)] border border-[var(--border)] text-[11px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--border)] transition-colors"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRejectingEmp(null)}
                disabled={isRejecting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfirmReject}
                loading={isRejecting}
                rightIcon={<Send className="w-3.5 h-3.5" />}
              >
                Send Request
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
