import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { CalendarDays, RotateCcw, X } from 'lucide-react';
import api from '../services/apiClient';
import { apiErrorMessage } from '../components/roster/api';
import { buttonClass, inputClass } from '../components/roster/Dialog';
import { dayLabel } from '../components/roster/dates';
import { TYPE_LABEL, type EntryType } from '../components/roster/day';
import { LEAVE_TYPE_HELP, LeaveStatusBadge, type LeaveState } from '../components/LeaveStatus';
import { HelpTip } from '../components/ui/HelpTip';
import { useToast } from '../components/ui/Toast';

interface LeaveRequest {
  id: string;
  leave_type: EntryType;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  hours: number | null;
  reason: string | null;
  status: LeaveState;
  rejection_reason: string | null;
  created_at: string;
}

const LEAVE_TYPES: EntryType[] = ['Annual', 'Sick', 'TIL', 'LWIP', 'Other'];
const label = 'block text-sm font-semibold text-[var(--text)] mb-1';
const field = `${inputClass} w-full min-h-11 md:min-h-9 !text-base md:!text-sm`;

/** The employee's own leave: ask for time off, and see what happened to earlier requests. */
export default function EmployeeLeave() {
  const id = useId();
  const toast = useToast();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const [confirmWithdraw, setConfirmWithdraw] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api.get('/portal/leave-requests')
      .then(res => setRequests(res.data.data))
      .catch(err => setLoadError(apiErrorMessage(err, 'Your leave requests could not be loaded.')))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

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
      const res = await api.post('/portal/leave-requests', body);
      setShowForm(false);
      resetForm();
      toast.success(res.data?.message || 'Your leave request was sent to your manager.');
      load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Your request could not be sent.'));
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async (requestId: string) => {
    setConfirmWithdraw(null);
    try {
      await api.delete(`/portal/leave-requests/${requestId}`);
      toast.success('Your leave request was withdrawn.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'The request could not be withdrawn.'));
    }
    load();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <header data-tour="leave-form" className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">Leave</h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">Ask for time off and see what your manager decided.</p>
        </div>
        {!showForm && (
          <button type="button" onClick={() => setShowForm(true)} className={`${buttonClass.primary} h-11`}>
            <CalendarDays className="w-4 h-4" aria-hidden="true" /> Request leave
          </button>
        )}
      </header>

      {showForm && (
        <form onSubmit={submit} aria-labelledby={`${id}-title`} className="bg-[var(--panel)] border border-[var(--border)] rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 id={`${id}-title`} className="text-base font-bold text-[var(--text)]">New leave request</h2>
            <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="p-2.5 rounded text-[var(--muted)] hover:text-[var(--text)]" aria-label="Close without sending">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <div>
            <label htmlFor={`${id}-type`} className={`${label} flex items-center gap-0.5`}>
              Type of leave
              <HelpTip label="Type of leave">{LEAVE_TYPE_HELP}</HelpTip>
            </label>
            <select id={`${id}-type`} value={leaveType} onChange={e => setLeaveType(e.target.value as EntryType)} className={field}>
              {LEAVE_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </div>

          <fieldset>
            <legend className={label}>How long?</legend>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] max-w-sm">
              {[{ v: true, t: 'Whole day(s)' }, { v: false, t: 'Part of a day' }].map(o => (
                <label key={o.t} className="flex items-center justify-center min-h-11 rounded-lg text-sm font-semibold text-[var(--muted)] cursor-pointer has-[:checked]:bg-[var(--panel)] has-[:checked]:text-[var(--text)] has-[:checked]:shadow-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--primary)]">
                  <input type="radio" name={`${id}-length`} className="sr-only" checked={wholeDay === o.v} onChange={() => setWholeDay(o.v)} />
                  {o.t}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${id}-from`} className={label}>{wholeDay ? 'First day' : 'Date'}</label>
              <input id={`${id}-from`} type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} className={field} />
            </div>
            {wholeDay ? (
              <div>
                <label htmlFor={`${id}-to`} className={label}>Last day</label>
                <input id={`${id}-to`} type="date" required min={startDate || undefined} value={endDate || startDate} onChange={e => setEndDate(e.target.value)} className={field} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor={`${id}-start`} className={label}>From</label>
                  <input id={`${id}-start`} type="time" required value={startTime} onChange={e => setStartTime(e.target.value)} className={field} />
                </div>
                <div>
                  <label htmlFor={`${id}-end`} className={label}>Until</label>
                  <input id={`${id}-end`} type="time" required value={endTime} onChange={e => setEndTime(e.target.value)} className={field} />
                </div>
              </div>
            )}
          </div>

          {wholeDay && (
            <div>
              <label htmlFor={`${id}-hours`} className={label}>Total hours of leave</label>
              <input id={`${id}-hours`} type="number" inputMode="decimal" min="0.1" max="240" step="0.1" required value={hours} onChange={e => setHours(e.target.value)} aria-describedby={`${id}-hours-hint`} className={`${field} max-w-[10rem]`} />
              <p id={`${id}-hours-hint`} className="text-xs text-[var(--muted)] mt-1">The hours you would normally have worked on those days, for example 7.6 for one full day.</p>
            </div>
          )}

          <div>
            <label htmlFor={`${id}-reason`} className={label}>Note for your manager <span className="font-normal text-[var(--muted)]">(optional)</span></label>
            <textarea id={`${id}-reason`} value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={500} className={`${field} resize-y`} />
          </div>

          {error && <p role="alert" className="text-sm font-semibold text-[var(--danger)]">{error}</p>}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className={`${buttonClass.secondary} h-11`}>Cancel</button>
            <button type="submit" disabled={submitting} className={`${buttonClass.primary} h-11`}>{submitting ? 'Sending…' : 'Send to my manager'}</button>
          </div>
        </form>
      )}

      <section aria-labelledby={`${id}-list`} className="space-y-2">
        <h2 id={`${id}-list`} className="text-sm font-semibold text-[var(--muted)]">My requests</h2>
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)] overflow-hidden">
          {loadError ? (
            <div role="alert" className="p-4 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--danger)]">
              {loadError}
              <button type="button" onClick={load} className={`${buttonClass.secondary} h-11`}><RotateCcw className="w-4 h-4" aria-hidden="true" /> Try again</button>
            </div>
          ) : loading ? (
            <p className="p-8 text-center text-sm text-[var(--muted)]">Loading your leave requests…</p>
          ) : requests.length === 0 ? (
            <div className="p-8 text-center space-y-1">
              <p className="text-sm font-semibold text-[var(--text)]">You haven’t asked for any leave yet.</p>
              <p className="text-sm text-[var(--muted)]">When you need time off, choose “Request leave”. Your manager’s decision shows up here.</p>
            </div>
          ) : (
            <ul>
              {requests.map(r => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 border-b border-[var(--border)] last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text)]">{TYPE_LABEL[r.leave_type]}</p>
                    <p className="text-sm text-[var(--text)]">
                      {r.start_date === r.end_date ? dayLabel(r.start_date, 'long') : `${dayLabel(r.start_date)} – ${dayLabel(r.end_date)}`}
                      {r.start_time && r.end_time && ` · ${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}`}
                      {r.hours ? <span className="text-[var(--muted)]"> · {r.hours} h</span> : null}
                    </p>
                    {r.reason && <p className="text-xs text-[var(--muted)] truncate">{r.reason}</p>}
                    {r.status === 'Rejected' && r.rejection_reason && <p className="text-sm text-[var(--danger)] mt-0.5">Why: {r.rejection_reason}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <LeaveStatusBadge status={r.status} />
                    {r.status === 'Pending' && (confirmWithdraw === r.id ? (
                      <span className="flex items-center gap-1">
                        <button type="button" onClick={() => withdraw(r.id)} className={`${buttonClass.danger} h-10`}>Withdraw</button>
                        <button type="button" onClick={() => setConfirmWithdraw(null)} className={`${buttonClass.quiet} h-10`}>Keep</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmWithdraw(r.id)} className={`${buttonClass.quiet} h-10`}>Withdraw…</button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
