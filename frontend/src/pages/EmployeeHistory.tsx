import { useEffect, useState } from 'react';
import { History as HistoryIcon } from 'lucide-react';
import api from '../services/apiClient';
import { Badge } from '../components/ui/Badge';
import { currentFortnightIso, periodLabel, shiftIso } from '../components/roster/dates';
import { formatHours } from '../components/roster/day';

interface HistoryRow {
  start_date: string;
  status: 'Draft' | 'Approved' | 'Locked';
  actual_hours: number;
}

const STATUS_VARIANT: Record<HistoryRow['status'], 'outline' | 'success' | 'purple'> = {
  Draft: 'outline',
  Approved: 'success',
  Locked: 'purple',
};

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
      .catch(() => { if (!cancelled) setError('Could not load your history. Please try again.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
          <HistoryIcon className="w-5 h-5 text-[var(--primary)]" />
          Timesheet History
        </h1>
        <p className="text-sm text-[var(--muted)] mt-0.5">Your past pay periods and their status.</p>
      </div>

      {error && <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400">{error}</div>}

      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl divide-y divide-[var(--border)] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]">No timesheet history yet.</div>
        ) : (
          rows.map(row => (
            <div key={row.start_date} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="text-sm font-medium text-[var(--text)]">{periodLabel(row.start_date)}</div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-[var(--muted)]">{formatHours(row.actual_hours)}</span>
                <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
