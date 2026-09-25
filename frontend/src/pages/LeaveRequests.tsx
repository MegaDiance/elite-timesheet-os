import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck2, RotateCcw } from 'lucide-react';
import api from '../services/apiClient';
import { apiErrorMessage, skipReason } from '../components/roster/api';
import { buttonClass, inputClass } from '../components/roster/Dialog';
import { dayLabel } from '../components/roster/dates';
import { TYPE_LABEL, type EntryType } from '../components/roster/day';
import { LEAVE_TYPE_HELP, LeaveStatusBadge, type LeaveState } from '../components/LeaveStatus';
import { HelpTip } from '../components/ui/HelpTip';
import { useToast } from '../components/ui/Toast';

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
  status: LeaveState;
  rejection_reason: string | null;
}

/** Owner / Branch Admin: decide on leave requests from workers in the branches they manage. */
export default function LeaveRequests() {
  const toast = useToast();
  const [status, setStatus] = useState<'Pending' | 'all'>('Pending');
  const [rows, setRows] = useState<AdminLeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api.get(`/leave-requests${status === 'Pending' ? '?status=Pending' : ''}`)
      .then(res => setRows(res.data.data))
      .catch(err => setLoadError(apiErrorMessage(err, 'Leave requests could not be loaded.')))
      .finally(() => setLoading(false));
  }, [status]);
  useEffect(load, [load]);

  const decide = async (row: AdminLeaveRequest, decision: 'approve' | 'reject') => {
    setBusyId(row.id);
    try {
      const res = await api.post(`/leave-requests/${row.id}/review`, decision === 'approve'
        ? { decision }
        : { decision, rejection_reason: declineReason.trim() || undefined });
      const skipped: Array<{ date: string; reason: string }> = res.data?.data?.skipped ?? [];
      if (decision === 'reject') toast.success(`${row.employee_name}’s leave was declined.`);
      else if (skipped.length === 0) toast.success(`${row.employee_name}’s leave is approved and added to the roster.`);
      else toast.success(`Approved. Not added on ${skipped.map(s => `${dayLabel(s.date)} (${skipReason(s.reason)})`).join(', ')}. Change those days on the Roster if needed.`);
      setDeclining(null);
      setDeclineReason('');
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, decision === 'approve' ? 'This request could not be approved.' : 'This request could not be declined.'));
    } finally {
      setBusyId(null);
    }
  };

  const when = (r: AdminLeaveRequest) => [
    r.start_date === r.end_date ? dayLabel(r.start_date, 'long') : `${dayLabel(r.start_date)} – ${dayLabel(r.end_date)}`,
    r.start_time && r.end_time ? `${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}` : null,
    r.hours != null ? `${r.hours} h` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)] flex items-center gap-1">
            Leave requests
            <HelpTip label="Leave types">{LEAVE_TYPE_HELP}</HelpTip>
          </h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">
            Approving adds the leave to that person’s roster and worked hours for those days. Days that are approved or locked are left as they are and listed.
          </p>
        </div>
        <div role="group" aria-label="Show" className="flex gap-1 p-1 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)]">
          {(['Pending', 'all'] as const).map(s => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              className={`min-h-10 px-3 rounded-lg text-sm font-semibold ${status === s ? 'bg-[var(--panel)] text-[var(--text)] shadow-sm' : 'text-[var(--muted)]'}`}
            >
              {s === 'Pending' ? 'Waiting' : 'All'}
            </button>
          ))}
        </div>
      </header>

      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-xl overflow-hidden">
        {loadError ? (
          <div role="alert" className="p-4 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--danger)]">
            {loadError}
            <button type="button" onClick={load} className={`${buttonClass.secondary} h-11`}><RotateCcw className="w-4 h-4" aria-hidden="true" /> Try again</button>
          </div>
        ) : loading ? (
          <p className="p-8 text-center text-sm text-[var(--muted)]">Loading leave requests…</p>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <CalendarCheck2 className="w-6 h-6 mx-auto text-[var(--success)]" aria-hidden="true" />
            <p className="text-sm font-semibold text-[var(--text)]">{status === 'Pending' ? 'No leave is waiting for a decision.' : 'No leave requests yet.'}</p>
            <p className="text-sm text-[var(--muted)]">
              {status === 'Pending'
                ? 'New requests from your workers appear here. Past decisions are under “All”.'
                : <>Workers with portal access can ask for leave from their phone. Give access on <Link to="/workers" className="text-[var(--primary-text)] font-semibold hover:underline">Workers</Link>. You can also enter leave yourself on the Roster.</>}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {rows.map(r => (
              <li key={r.id} className="px-4 py-3 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text)]">
                      {r.employee_name} <span className="font-normal text-[var(--muted)]">· {r.location_name}</span>
                    </p>
                    <p className="text-sm text-[var(--text)]">{TYPE_LABEL[r.leave_type]} · {when(r)}</p>
                    {r.reason && <p className="text-sm text-[var(--muted)] mt-0.5">“{r.reason}”</p>}
                    {r.status === 'Rejected' && r.rejection_reason && <p className="text-sm text-[var(--danger)] mt-0.5">Why declined: {r.rejection_reason}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <LeaveStatusBadge status={r.status} />
                    {r.status === 'Pending' && (
                      <>
                        <button type="button" onClick={() => decide(r, 'approve')} disabled={busyId === r.id} className={`${buttonClass.primary} h-10`}>
                          {busyId === r.id ? 'Saving…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setDeclining(declining === r.id ? null : r.id); setDeclineReason(''); }}
                          aria-expanded={declining === r.id}
                          disabled={busyId === r.id}
                          className={`${buttonClass.secondary} h-10`}
                        >
                          Decline…
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {declining === r.id && (
                  <div className="flex flex-col sm:flex-row gap-2 rounded-lg bg-[var(--panel-subtle)] p-2">
                    <label htmlFor={`decline-${r.id}`} className="sr-only">Why are you declining? (optional)</label>
                    <input
                      id={`decline-${r.id}`}
                      value={declineReason}
                      onChange={e => setDeclineReason(e.target.value)}
                      placeholder={`Tell ${r.employee_name.split(' ')[0]} why (optional)`}
                      maxLength={500}
                      className={`${inputClass} flex-1 min-h-10`}
                    />
                    <button type="button" onClick={() => decide(r, 'reject')} disabled={busyId === r.id} className={`${buttonClass.danger} h-10`}>Decline request</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
