import { useEffect, useState } from 'react';
import { friendlyError } from '../services/errors';
import api from '../services/apiClient';
import { currentFortnightIso, periodLabel, shiftIso } from '../components/roster/dates';
import { formatHours } from '../components/roster/day';
import { TimesheetStatusBadge } from '../components/TimesheetStatus';

interface HistoryRow {
  start_date: string;
  status: 'Draft' | 'Approved' | 'Locked';
  actual_hours: number;
}


const LOOKBACK_FORTNIGHTS = 12; // roughly six months

/** The employee's own past fortnights and their approval status — read only. */
export default function EmployeeHistory() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const end = currentFortnightIso();
    const start = shiftIso(end, -14 * (LOOKBACK_FORTNIGHTS - 1));
    api.get(`/portal/history?start_date=${start}&end_date=${end}`)
      .then(res => { if (!cancelled) setRows((res.data.data as HistoryRow[]).slice().reverse()); })
      .catch(err => { if (!cancelled) setError(friendlyError(err, 'Your past hours could not be loaded.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--text)]">My past hours</h1>
        <p className="text-sm text-[var(--muted)] mt-0.5">Your hours for each pay period over the last six months, and whether they’re approved.</p>
      </div>

      {error && <p role="alert" className="p-4 rounded-xl bg-[var(--danger-light)] border border-[var(--danger)]/30 text-sm text-[var(--danger)]">{error} Reload the page to try again.</p>}

      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl divide-y divide-[var(--border)] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]">Loading your past hours…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]">No past pay periods yet. They appear here once you’ve worked a full fortnight.</div>
        ) : (
          rows.map(row => (
            <div key={row.start_date} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="text-sm font-medium text-[var(--text)]">{periodLabel(row.start_date)}</div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-[var(--muted)]">{formatHours(row.actual_hours)}</span>
                <TimesheetStatusBadge status={row.status} size="md" />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
