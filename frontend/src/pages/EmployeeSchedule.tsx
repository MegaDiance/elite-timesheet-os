import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, RotateCcw } from 'lucide-react';
import api from '../services/apiClient';
import { useAccess } from '../hooks/useAccess';
import { friendlyError } from '../services/errors';
import { currentFortnightIso, dayLabel, fortnightDays, periodLabel, shiftIso, todayIso } from '../components/roster/dates';
import { entryWhen, formatHours, partTotal, TYPE_LABEL, type Entry } from '../components/roster/day';

interface ScheduleDay {
  record_date: string;
  roster: Entry[];
}

const navButton = 'min-w-11 h-11 px-3 rounded-lg border border-[var(--border)] text-sm font-semibold text-[var(--text)] hover:bg-[var(--panel-subtle)] inline-flex items-center justify-center';

function Shifts({ entries }: { entries: Entry[] }) {
  return (
    <ul className="space-y-0.5">
      {entries.map((e, i) => (
        <li key={i} className="text-sm text-[var(--text)]">
          {e.type === 'WORK'
            ? <span className="font-semibold tabular-nums">{entryWhen(e)}</span>
            : <><span className="font-semibold">{TYPE_LABEL[e.type]}</span> <span className="text-[var(--muted)] tabular-nums">{entryWhen(e)}</span></>}
        </li>
      ))}
    </ul>
  );
}

/**
 * What an employee needs first: today's shift and where it is, then the rest of the fortnight.
 * Read-only — the roster is set by a manager.
 */
export default function EmployeeSchedule() {
  const { access } = useAccess();
  const branch = access?.branches[0];
  const today = todayIso();
  const [startDate, setStartDate] = useState(currentFortnightIso());
  const [days, setDays] = useState<Map<string, ScheduleDay>>(new Map());
  const [upcoming, setUpcoming] = useState<Map<string, ScheduleDay>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get(`/portal/schedule?start_date=${startDate}&end_date=${shiftIso(startDate, 13)}`)
      .then(res => {
        if (cancelled) return;
        setDays(new Map((res.data.data as ScheduleDay[]).map(d => [d.record_date, d])));
      })
      .catch(err => { if (!cancelled) setError(friendlyError(err, 'Your schedule could not be loaded.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [startDate]);

  useEffect(() => load(), [load]);

  // Today and the next shift always come from the next four weeks, whichever fortnight is on screen.
  useEffect(() => {
    let cancelled = false;
    api.get(`/portal/schedule?start_date=${today}&end_date=${shiftIso(today, 27)}`)
      .then(res => { if (!cancelled) setUpcoming(new Map((res.data.data as ScheduleDay[]).map(d => [d.record_date, d]))); })
      .catch(() => undefined); // the fortnight list below still shows (and reports) the schedule
    return () => { cancelled = true; };
  }, [today]);

  const todayShifts = upcoming.get(today)?.roster ?? [];
  const next = [...upcoming.values()]
    .filter(d => d.record_date > today && d.roster.some(e => e.type === 'WORK'))
    .sort((a, b) => a.record_date.localeCompare(b.record_date))[0];

  const allDays = fortnightDays(startDate);
  const weeks = [allDays.slice(0, 7), allDays.slice(7)];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <header>
        <h1 className="text-xl font-bold text-[var(--text)]">My schedule</h1>
        {branch && (
          <p className="text-sm text-[var(--muted)] mt-0.5 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
            {branch.name}{branch.address ? ` · ${branch.address}` : ''}
          </p>
        )}
      </header>

      {/* Today */}
      <section data-tour="schedule-today" aria-labelledby="today-heading" className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
        <h2 id="today-heading" className="text-sm font-semibold text-[var(--muted)]">Today · {dayLabel(today, 'long')}</h2>
        {todayShifts.length > 0 && !todayShifts.some(e => e.type === 'WORK') ? (
          <p className="text-base font-semibold text-[var(--text)]">
            You’re on {Array.from(new Set(todayShifts.map(e => TYPE_LABEL[e.type].toLowerCase()))).join(' and ')} today.
          </p>
        ) : todayShifts.length > 0 ? (
          <div className="space-y-1">
            <Shifts entries={todayShifts} />
            <p className="text-xs text-[var(--muted)] flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              {formatHours(partTotal(todayShifts.filter(e => e.type === 'WORK')))} of work
              {branch && <> · at {branch.name}{branch.address ? `, ${branch.address}` : ''}</>}
            </p>
          </div>
        ) : (
          <p className="text-base font-semibold text-[var(--text)]">You’re not rostered today.</p>
        )}
        <div className="border-t border-[var(--border)] pt-3 text-sm">
          {next ? (
            <p className="text-[var(--text)]">
              <span className="text-[var(--muted)]">Next shift: </span>
              <span className="font-semibold">{dayLabel(next.record_date, 'long')}</span>
              {', '}
              {next.roster.filter(e => e.type === 'WORK').map(e => entryWhen(e)).join(' and ')}
            </p>
          ) : (
            <p className="text-[var(--muted)]">No more shifts in the next four weeks yet. Your manager adds them to the roster.</p>
          )}
        </div>
      </section>

      {/* The fortnight */}
      <section aria-labelledby="fortnight-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="fortnight-heading" className="text-base font-bold text-[var(--text)] flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-[var(--muted)]" aria-hidden="true" />
            {periodLabel(startDate)}
          </h2>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setStartDate(shiftIso(startDate, -14))} className={navButton} aria-label="Previous fortnight">
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setStartDate(currentFortnightIso())} className={navButton} disabled={startDate === currentFortnightIso()}>
              This fortnight
            </button>
            <button type="button" onClick={() => setStartDate(shiftIso(startDate, 14))} className={navButton} aria-label="Next fortnight">
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {error ? (
          <div role="alert" className="p-4 rounded-xl bg-[var(--danger-light)] border border-[var(--danger)]/30 text-sm text-[var(--danger)] flex flex-wrap items-center justify-between gap-3">
            {error}
            <button type="button" onClick={load} className={navButton}><RotateCcw className="w-4 h-4 mr-1.5" aria-hidden="true" /> Try again</button>
          </div>
        ) : loading ? (
          <p className="p-8 text-center text-sm text-[var(--muted)] rounded-xl border border-[var(--border)] bg-[var(--panel)]">Loading your schedule…</p>
        ) : (
          weeks.map((week, w) => {
            const weekTotal = week.reduce((sum, iso) => sum + partTotal(days.get(iso)?.roster ?? []), 0);
            return (
              <div key={w} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
                <div className="px-4 py-2 bg-[var(--panel-subtle)] flex justify-between text-xs font-semibold text-[var(--muted)]">
                  <span>Week {w + 1}</span>
                  <span>{weekTotal > 0 ? `${formatHours(weekTotal)} rostered` : 'No shifts'}</span>
                </div>
                <ul className="divide-y divide-[var(--border)]">
                  {week.map(iso => {
                    const roster = days.get(iso)?.roster ?? [];
                    const isToday = iso === today;
                    return (
                      <li key={iso} className={`flex items-start gap-4 px-4 py-3 ${isToday ? 'bg-[var(--primary-light)]' : ''}`} aria-current={isToday ? 'date' : undefined}>
                        <div className="w-28 shrink-0">
                          <div className="text-sm font-medium text-[var(--text)]">{dayLabel(iso)}</div>
                          {isToday && <div className="text-[11px] font-bold text-[var(--primary-text)]">Today</div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          {roster.length > 0 ? <Shifts entries={roster} /> : <span className="text-sm text-[var(--muted)]">Not rostered</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
