import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import api from '../services/apiClient';
import { apiErrorMessage } from '../components/roster/api';
import { buttonClass, inputClass } from '../components/roster/Dialog';
import { Badge } from '../components/ui/Badge';
import { dayLabel } from '../components/roster/dates';
import { TYPE_LABEL, type EntryType } from '../components/roster/day';

interface AdminLeaveRequest {
  id: string;
  employee_id: string;
  employee_name: string;
  location_name: string;
  leave_type: EntryType;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  hours: number | null;
  reason: string | null;
  status: 'Pending' | 'Approved' | 'Rejected';
  rejection_reason: string | null;
}

const STATUS_VARIANT: Record<AdminLeaveRequest['status'], 'outline' | 'success' | 'danger'> = { Pending: 'outline', Approved: 'success', Rejected: 'danger' };

/** Owner/Branch Admin review of leave requests from workers in their branches. */
export default function LeaveRequests() {
  const [status, setStatus] = useState<'Pending' | 'all'>('Pending');
  const [rows, setRows] = useState<AdminLeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.get(`/leave-requests${status === 'Pending' ? '?status=Pending' : ''}`).then(res => setRows(res.data.data)).finally(() => setLoading(false));
  };
  useEffect(load, [status]);

  const approve = async (id: string) => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post(`/leave-requests/${id}/review`, { decision: 'approve' });
      setNotice(res.data.message);
      load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not approve this request.'));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.post(`/leave-requests/${id}/review`, { decision: 'reject', rejection_reason: rejectionReason || undefined });
      setRejecting(null);
      setRejectionReason('');
      load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not reject this request.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-[var(--primary)]" />
            Leave Requests
          </h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">Requests from workers in your branches.</p>
        </div>
        <div className="flex gap-1 p-1 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)]">
          <button onClick={() => setStatus('Pending')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${status === 'Pending' ? 'bg-[var(--panel)] text-[var(--text)] shadow-sm' : 'text-[var(--muted)]'}`}>Pending</button>
          <button onClick={() => setStatus('all')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${status === 'all' ? 'bg-[var(--panel)] text-[var(--text)] shadow-sm' : 'text-[var(--muted)]'}`}>All</button>
        </div>
      </div>

      {notice && <div className="p-3 rounded-xl bg-[var(--success-light)] border border-[var(--success)]/25 text-sm text-[var(--success)]">{notice}</div>}
      {error && <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400">{error}</div>}

      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl divide-y divide-[var(--border)] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]">No {status === 'Pending' ? 'pending ' : ''}leave requests.</div>
        ) : (
          rows.map(r => (
            <div key={r.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--text)]">{r.employee_name} · {r.location_name}</div>
                  <div className="text-xs text-[var(--muted)]">
                    {TYPE_LABEL[r.leave_type]} · {r.start_date === r.end_date ? dayLabel(r.start_date) : `${dayLabel(r.start_date)} – ${dayLabel(r.end_date)}`}
                    {r.start_time && r.end_time && ` · ${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}`}
                    {r.hours != null && ` · ${r.hours} h`}
                  </div>
                  {r.reason && <div className="text-xs text-[var(--muted)] mt-0.5 italic">“{r.reason}”</div>}
                  {r.status === 'Rejected' && r.rejection_reason && <div className="text-xs text-[var(--danger)] mt-0.5">Reason: {r.rejection_reason}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                  {r.status === 'Pending' && (
                    <>
                      <button onClick={() => approve(r.id)} disabled={busyId === r.id} className={buttonClass.primary}>Approve</button>
                      <button onClick={() => setRejecting(rejecting === r.id ? null : r.id)} disabled={busyId === r.id} className={buttonClass.secondary}>Reject</button>
                    </>
                  )}
                </div>
              </div>
              {rejecting === r.id && (
                <div className="mt-2 flex gap-2">
                  <input
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                    placeholder="Reason (optional)"
                    className={`${inputClass} flex-1`}
                  />
                  <button onClick={() => reject(r.id)} disabled={busyId === r.id} className={buttonClass.primary}>Confirm reject</button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
