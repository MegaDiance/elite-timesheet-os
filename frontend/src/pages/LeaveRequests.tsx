import { useState, useEffect } from 'react';
import api from '../services/apiClient';

interface LeaveRequestItem {
  id: string;
  org_id: string;
  employee_id: string;
  employee_name: string;
  employee_department?: string;
  employee_email?: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  hours: number;
  reason?: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  reviewed_by?: string;
  reviewed_at?: string;
  rejection_reason?: string;
  created_at: string;
}

export default function LeaveRequests() {
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'All' | 'Pending' | 'Approved' | 'Rejected'>('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Reject Modal State
  const [rejectModalItem, setRejectModalItem] = useState<LeaveRequestItem | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const fetchLeaveRequests = async () => {
    setLoading(true);
    try {
      const res = await api.get('/organisation/leave-requests');
      if (res.data?.data) {
        setLeaveRequests(res.data.data);
      }
    } catch (err) {
      console.warn('Failed to load leave requests', err);
      showToast('Failed to load leave requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaveRequests();
  }, []);

  const handleReview = async (id: string, status: 'Approved' | 'Rejected', reason?: string) => {
    setActionLoadingId(id);
    try {
      await api.post(`/organisation/leave-requests/${id}/review`, {
        status,
        rejection_reason: reason
      });
      showToast(`Leave request ${status.toLowerCase()} successfully`);
      if (rejectModalItem) {
        setRejectModalItem(null);
        setRejectionReason('');
      }
      fetchLeaveRequests();
    } catch (err: any) {
      showToast(err.response?.data?.error?.message || `Failed to update leave request`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const filteredRequests = leaveRequests.filter(req => {
    if (statusFilter !== 'All' && req.status !== statusFilter) return false;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchName = req.employee_name?.toLowerCase().includes(term);
      const matchDept = req.employee_department?.toLowerCase().includes(term);
      const matchType = req.leave_type?.toLowerCase().includes(term);
      return matchName || matchDept || matchType;
    }
    return true;
  });

  const pendingCount = leaveRequests.filter(r => r.status === 'Pending').length;

  return (
    <div className="flex flex-col h-full max-w-6xl mx-auto gap-6 mt-4 pb-16 px-2">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed top-20 right-6 z-50 bg-[var(--primary)] text-white font-bold text-xs px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2">
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-black text-[var(--text)]">Staff Leave Requests</h2>
            {pendingCount > 0 && (
              <span className="bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/40 text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider">
                {pendingCount} Pending Review
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--muted)] mt-1">Review, approve, or decline employee leave applications</p>
        </div>

        <button
          onClick={fetchLeaveRequests}
          disabled={loading}
          className="px-3.5 py-2 bg-[var(--panel-subtle)] text-[var(--text)] hover:bg-[var(--glass-4)] rounded-xl text-xs font-bold border border-[var(--border)] flex items-center gap-1.5 transition-colors self-start md:self-auto"
        >
          <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
          <span>Refresh</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-[var(--panel)] p-4 rounded-2xl border border-[var(--border)] shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex items-center gap-2 w-full md:w-auto">
          {(['All', 'Pending', 'Approved', 'Rejected'] as const).map(tab => {
            const count = tab === 'All' ? leaveRequests.length : leaveRequests.filter(r => r.status === tab).length;
            return (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  statusFilter === tab
                    ? 'bg-[var(--primary)] text-white shadow-sm'
                    : 'bg-[var(--panel-subtle)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)]'
                }`}
              >
                <span>{tab}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-black ${
                  statusFilter === tab ? 'bg-white/20 text-white' : 'bg-[var(--glass-4)] text-[var(--muted)]'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="w-full md:w-64">
          <input
            type="text"
            placeholder="Search employee, department..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-xs text-[var(--text)] font-semibold"
          />
        </div>
      </div>

      {/* Leave Requests Table */}
      <div className="bg-[var(--panel)] rounded-2xl border border-[var(--border)] p-6 shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[var(--muted)] font-bold text-xs gap-2">
            <div className="w-4 h-4 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin"></div>
            Loading leave requests...
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="text-center py-16 text-[var(--muted)]">
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-[var(--panel-subtle)] text-[var(--muted)] flex items-center justify-center">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
            </div>
            <div className="font-bold text-sm text-[var(--text)]">No leave requests found</div>
            <div className="text-xs mt-1">
              {searchTerm || statusFilter !== 'All'
                ? 'Try adjusting your filter or search query.'
                : 'When employees submit leave applications in their portal, they will appear here.'}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted)] font-bold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4">Leave Type</th>
                  <th className="py-3 px-4">Date Range</th>
                  <th className="py-3 px-4">Hours</th>
                  <th className="py-3 px-4">Reason</th>
                  <th className="py-3 px-4">Submitted</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredRequests.map(item => (
                  <tr key={item.id} className="hover:bg-[var(--glass-2)] transition-colors">
                    <td className="py-3.5 px-4 font-bold text-[var(--text)]">
                      <div className="font-black">{item.employee_name}</div>
                      <div className="text-[11px] text-[var(--muted)] font-normal">{item.employee_department || 'General'}</div>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-[var(--text)]">
                      <span className="px-2.5 py-1 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] text-[11px]">
                        {item.leave_type}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-[var(--muted)] font-semibold whitespace-nowrap">
                      {item.start_date} → {item.end_date}
                    </td>
                    <td className="py-3.5 px-4 font-black text-[var(--text)]">
                      {item.hours}h
                    </td>
                    <td className="py-3.5 px-4 text-[var(--muted)] max-w-xs truncate">
                      {item.reason ? `"${item.reason}"` : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-[var(--muted)] text-[11px] whitespace-nowrap">
                      {new Date(item.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric'
                      })}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider ${
                        item.status === 'Approved' ? 'bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/40' :
                        item.status === 'Rejected' ? 'bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/40' :
                        'bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/40'
                      }`}>
                        {item.status}
                      </span>
                      {item.status === 'Rejected' && item.rejection_reason && (
                        <div className="text-[10px] text-red-500 font-semibold mt-1 max-w-xs">
                          Reason: {item.rejection_reason}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {item.status === 'Pending' ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleReview(item.id, 'Approved')}
                            disabled={actionLoadingId === item.id}
                            className="px-3 py-1 bg-[#10b981] text-white rounded-lg font-bold text-[11px] hover:bg-[#059669] transition-colors shadow-sm disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => {
                              setRejectModalItem(item);
                              setRejectionReason('');
                            }}
                            disabled={actionLoadingId === item.id}
                            className="px-3 py-1 bg-[#ef4444]/15 text-[#ef4444] hover:bg-[#ef4444]/25 border border-[#ef4444]/30 rounded-lg font-bold text-[11px] transition-colors disabled:opacity-50"
                          >
                            Decline
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-[var(--muted)] font-medium italic">
                          Reviewed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reject Modal */}
      {rejectModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-black text-[var(--text)]">Decline Leave Request</h3>
            <p className="text-xs text-[var(--muted)]">
              Decline leave for <span className="font-bold text-[var(--text)]">{rejectModalItem.employee_name}</span> ({rejectModalItem.start_date} → {rejectModalItem.end_date}).
            </p>
            <div>
              <label className="text-xs font-bold text-[var(--muted)] block mb-1">
                Reason for declining <span className="text-red-400">*</span>
              </label>
              <textarea
                rows={3}
                placeholder="e.g. Insufficient staffing coverage during this period"
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl p-3 text-xs text-[var(--text)] font-medium focus:outline-none focus:ring-1 focus:ring-red-500"
              />
              {!rejectionReason.trim() && (
                <p className="text-[11px] text-red-400 mt-1">Please provide a reason for declining.</p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectModalItem(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-[var(--muted)] hover:bg-[var(--glass-4)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoadingId === rejectModalItem.id || !rejectionReason.trim()}
                onClick={() => handleReview(rejectModalItem.id, 'Rejected', rejectionReason.trim())}
                className="px-4 py-2 bg-[#ef4444] text-white rounded-xl text-xs font-black hover:bg-red-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm Decline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
