import { useEffect, useState, type FormEvent } from 'react';
import { CalendarDays, X } from 'lucide-react';
import api from '../services/apiClient';
import { apiErrorMessage } from '../components/roster/api';
import { buttonClass, inputClass } from '../components/roster/Dialog';
import { Badge } from '../components/ui/Badge';
import { dayLabel } from '../components/roster/dates';
import { TYPE_LABEL, type EntryType } from '../components/roster/day';

interface LeaveRequest {
  id: string;
  leave_type: EntryType;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  hours: number | null;
  reason: string | null;
  status: 'Pending' | 'Approved' | 'Rejected';
  rejection_reason: string | null;
  created_at: string;
}

const LEAVE_TYPES: EntryType[] = ['Sick', 'Annual', 'TIL', 'LWIP', 'Other'];
const STATUS_VARIANT: Record<LeaveRequest['status'], 'outline' | 'success' | 'danger'> = { Pending: 'outline', Approved: 'success', Rejected: 'danger' };

/** The employee's own leave requests: a simple form to ask for leave, and the history of past requests. */
export default function EmployeeLeave() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [leaveType, setLeaveType] = useState<EntryType>('Annual');
  const [wholeDay, setWholeDay] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [hours, setHours] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.get('/portal/leave-requests').then(res => setRequests(res.data.data)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const resetForm = () => {
    setLeaveType('Annual'); setWholeDay(true); setStartDate(''); setEndDate(''); setStartTime(''); setEndTime(''); setHours(''); setReason(''); setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { leave_type: leaveType, start_date: startDate, end_date: wholeDay ? endDate || startDate : startDate, reason: reason || undefined };
      if (wholeDay) body.hours = Number(hours);
      else { body.start_time = startTime; body.end_time = endTime; }
      await api.post('/portal/leave-requests', body);
      setShowForm(false);
      resetForm();
      load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not submit this request.'));
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async (id: string) => {
    await api.delete(`/portal/leave-requests/${id}`).catch(() => {});
    load();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-[var(--primary)]" />
            My Leave
          </h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">Request time off and track its status.</p>
        </div>
        {!showForm && <button onClick={() => setShowForm(true)} className={buttonClass.primary}>Request leave</button>}
      </div>

      {showForm && (
        <form onSubmit={submit} className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[var(--text)]">New request</h2>
            <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="p-1 rounded text-[var(--muted)] hover:text-[var(--text)]"><X className="w-4 h-4" /></button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--text)] mb-1">Type</label>
            <select value={leaveType} onChange={e => setLeaveType(e.target.value as EntryType)} className={`${inputClass} w-full`}>
              {LEAVE_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </div>

          <div className="flex gap-1 p-1 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] w-fit">
            <button type="button" onClick={() => setWholeDay(true)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${wholeDay ? 'bg-[var(--panel)] text-[var(--text)] shadow-sm' : 'text-[var(--muted)]'}`}>Whole day(s)</button>
            <button type="button" onClick={() => setWholeDay(false)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${!wholeDay ? 'bg-[var(--panel)] text-[var(--text)] shadow-sm' : 'text-[var(--muted)]'}`}>Part of a day</button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[var(--text)] mb-1">{wholeDay ? 'From' : 'Date'}</label>
              <input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} className={`${inputClass} w-full`} />
            </div>
            {wholeDay ? (
              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1">To</label>
                <input type="date" required value={endDate || startDate} onChange={e => setEndDate(e.target.value)} className={`${inputClass} w-full`} />
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-[var(--text)] mb-1">Start</label>
                  <input type="time" required value={startTime} onChange={e => setStartTime(e.target.value)} className={`${inputClass} w-full`} />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-[var(--text)] mb-1">Finish</label>
                  <input type="time" required value={endTime} onChange={e => setEndTime(e.target.value)} className={`${inputClass} w-full`} />
                </div>
              </div>
            )}
          </div>

          {wholeDay && (
            <div>
              <label className="block text-xs font-semibold text-[var(--text)] mb-1">Total hours</label>
              <input type="number" min="0.1" max="240" step="0.1" required value={hours} onChange={e => setHours(e.target.value)} className={`${inputClass} w-32`} />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[var(--text)] mb-1">Reason (optional)</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={500} className={`${inputClass} w-full resize-y`} />
          </div>

          {error && <p role="alert" className="text-xs font-semibold text-[var(--danger)]">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className={buttonClass.secondary}>Cancel</button>
            <button type="submit" disabled={submitting} className={buttonClass.primary}>{submitting ? 'Sending…' : 'Send request'}</button>
          </div>
        </form>
      )}

      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl divide-y divide-[var(--border)] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]">Loading…</div>
        ) : requests.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]">No leave requests yet.</div>
        ) : (
          requests.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--text)]">
                  {TYPE_LABEL[r.leave_type]} · {r.start_date === r.end_date ? dayLabel(r.start_date) : `${dayLabel(r.start_date)} – ${dayLabel(r.end_date)}`}
                  {r.start_time && r.end_time && ` · ${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}`}
                </div>
                {r.reason && <div className="text-xs text-[var(--muted)] truncate">{r.reason}</div>}
                {r.status === 'Rejected' && r.rejection_reason && <div className="text-xs text-[var(--danger)] mt-0.5">Reason: {r.rejection_reason}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                {r.status === 'Pending' && (
                  <button onClick={() => withdraw(r.id)} className="text-xs text-[var(--muted)] hover:text-[var(--danger)] font-medium">Withdraw</button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
