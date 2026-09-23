import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import api from '../services/apiClient';
import { currentFortnightIso, dayLabel, fortnightDays, isWeekendIso, periodLabel, shiftIso } from '../components/roster/dates';
import { entryWhen, TYPE_LABEL, type Entry } from '../components/roster/day';

interface ScheduleDay {
  record_date: string;
  roster: Entry[];
}

/**
 * The employee's own rostered shifts, one fortnight at a time. Read-only: hours here are set by
 * a manager, not the employee (see EmployeeTimesheet for the employee's own submitted hours).
 */
export default function EmployeeSchedule() {
  const [startDate, setStartDate] = useState(currentFortnightIso());
  const [days, setDays] = useState<Map<string, ScheduleDay>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const endDate = shiftIso(startDate, 13);
    api.get(`/portal/schedule?start_date=${startDate}&end_date=${endDate}`)
      .then(res => {
        if (cancelled) return;
        const map = new Map<string, ScheduleDay>();
        for (const d of res.data.data as ScheduleDay[]) map.set(d.record_date, d);
        setDays(map);
      })
      .catch(() => { if (!cancelled) setError('Could not load your schedule. Please try again.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [startDate]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-[var(--primary)]" />
            My Schedule
          </h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">{periodLabel(startDate)}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setStartDate(shiftIso(startDate, -14))}
            className="p-2 rounded-lg border border-[var(--border)] text-[var(--text)] hover:bg-[var(--panel-subtle)]"
            aria-label="Previous fortnight"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setStartDate(currentFortnightIso())}
            className="px-3 py-2 rounded-lg border border-[var(--border)] text-xs font-semibold text-[var(--text)] hover:bg-[var(--panel-subtle)]"
          >
            Today
          </button>
          <button
            onClick={() => setStartDate(shiftIso(startDate, 14))}
            className="p-2 rounded-lg border border-[var(--border)] text-[var(--text)] hover:bg-[var(--panel-subtle)]"
            aria-label="Next fortnight"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400">{error}</div>}

      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl divide-y divide-[var(--border)] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]">Loading…</div>
        ) : (
          fortnightDays(startDate).map(iso => {
            const day = days.get(iso);
            const weekend = isWeekendIso(iso);
            return (
              <div key={iso} className={`flex items-center justify-between gap-4 px-4 py-3 ${weekend ? 'bg-[var(--panel-subtle)]' : ''}`}>
                <div className="text-sm font-medium text-[var(--text)] w-32 shrink-0">{dayLabel(iso)}</div>
                <div className="flex-1 min-w-0">
                  {day && day.roster.length > 0 ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {day.roster.map((e, i) => (
                        <span key={i} className="text-sm text-[var(--text)]">
                          {e.type !== 'WORK' && <span className="font-medium text-[var(--muted)] mr-1">{TYPE_LABEL[e.type]}</span>}
                          {entryWhen(e)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-[var(--muted)]">{weekend ? 'Weekend' : 'Off'}</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
