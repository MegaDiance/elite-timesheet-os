import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, RotateCcw } from 'lucide-react';
import api from '../services/apiClient';
import { useAccess } from '../hooks/useAccess';
import { friendlyError } from '../services/errors';
import { dayLabel, dayOfMonth, shiftIso, todayIso } from '../components/roster/dates';
import { entryWhen, formatHours, partTotal, TYPE_LABEL, type Entry } from '../components/roster/day';

interface ScheduleDay {
  record_date: string;
  roster: Entry[];
}

const navButton = 'min-w-11 h-11 px-3 rounded-lg border border-[var(--border)] text-sm font-semibold text-[var(--text)] hover:bg-[var(--panel-subtle)] inline-flex items-center justify-center disabled:opacity-50';

type View = 'day' | 'week' | 'month';
const VIEWS: Array<{ id: View; label: string }> = [{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }];
const VIEW_KEY = 'simplehours_schedule_view';

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Weeks start on Sunday, like the pay period. */
const weekStart = (day: string) => shiftIso(day, -utc(day).getUTCDay());
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const addMonths = (first: string, n: number) => { const d = utc(first); d.setUTCMonth(d.getUTCMonth() + n); return iso(d); };
const monthLabel = (first: string) => utc(first).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The days a view shows: one day, a Sunday-to-Saturday week, or whole weeks covering the month. */
function visibleDays(view: View, anchor: string): { days: string[]; inPeriod: (d: string) => boolean } {
  if (view === 'day') return { days: [anchor], inPeriod: () => true };
  if (view === 'week') {
    const start = weekStart(anchor);
    return { days: Array.from({ length: 7 }, (_, i) => shiftIso(start, i)), inPeriod: () => true };
  }
  const first = monthStart(anchor);
  const start = weekStart(first);
  const last = shiftIso(addMonths(first, 1), -1);
  const count = Math.ceil(((utc(last).getTime() - utc(start).getTime()) / 86400000 + 1) / 7) * 7;
  return { days: Array.from({ length: count }, (_, i) => shiftIso(start, i)), inPeriod: d => d.slice(0, 7) === first.slice(0, 7) };
}

function readView(): View {
  try { const v = localStorage.getItem(VIEW_KEY); return v === 'day' || v === 'month' ? v : 'week'; } catch { return 'week'; }
}

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
  const [view, setViewState] = useState<View>(readView);
  const [anchor, setAnchor] = useState(today);
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* per-device convenience only */ } };
  const { days: shown, inPeriod } = visibleDays(view, anchor);
  const rangeStart = shown[0];
  const rangeEnd = shown[shown.length - 1];
  const [days, setDays] = useState<Map<string, ScheduleDay>>(new Map());
  const [upcoming, setUpcoming] = useState<Map<string, ScheduleDay>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get(`/portal/schedule?start_date=${rangeStart}&end_date=${rangeEnd}`)
      .then(res => {
        if (cancelled) return;
        setDays(new Map((res.data.data as ScheduleDay[]).map(d => [d.record_date, d])));
      })
      .catch(err => { if (!cancelled) setError(friendlyError(err, 'Your schedule could not be loaded.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [rangeStart, rangeEnd]);

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

  const move = (n: number) => setAnchor(view === 'day' ? shiftIso(anchor, n) : view === 'week' ? shiftIso(anchor, 7 * n) : addMonths(monthStart(anchor), n));
  const heading = view === 'day' ? dayLabel(anchor, 'long')
    : view === 'week' ? `${dayLabel(rangeStart)} – ${dayLabel(rangeEnd)}`
    : monthLabel(monthStart(anchor));
  const showsToday = shown.includes(today) && inPeriod(today);
  const unit = view === 'day' ? 'day' : view === 'week' ? 'week' : 'month';

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

      {/* Day, week or month */}
      <section aria-labelledby="period-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="View" className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden">
            {VIEWS.map(v => (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                aria-pressed={view === v.id}
                className={`h-11 px-4 text-sm font-semibold ${view === v.id ? 'bg-[var(--primary)] text-white' : 'text-[var(--text)] hover:bg-[var(--panel-subtle)]'}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => move(-1)} className={navButton} aria-label={`Previous ${unit}`}>
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setAnchor(today)} className={navButton} disabled={showsToday && (view !== 'day' || anchor === today)}>
              Today
            </button>
            <button type="button" onClick={() => move(1)} className={navButton} aria-label={`Next ${unit}`}>
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <h2 id="period-heading" className="text-base font-bold text-[var(--text)] flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-[var(--muted)]" aria-hidden="true" />
          {heading}
        </h2>

        {error ? (
          <div role="alert" className="p-4 rounded-xl bg-[var(--danger-light)] border border-[var(--danger)]/30 text-sm text-[var(--danger)] flex flex-wrap items-center justify-between gap-3">
            {error}
            <button type="button" onClick={load} className={navButton}><RotateCcw className="w-4 h-4 mr-1.5" aria-hidden="true" /> Try again</button>
          </div>
        ) : loading ? (
          <p className="p-8 text-center text-sm text-[var(--muted)] rounded-xl border border-[var(--border)]">Loading your schedule…</p>
        ) : view === 'month' ? (
          <div className="rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="grid grid-cols-7 text-center text-xs font-semibold text-[var(--muted)] border-b border-[var(--border)]" aria-hidden="true">
              {WEEKDAYS.map(d => <div key={d} className="py-2">{d}</div>)}
            </div>
            <ul className="grid grid-cols-7">
              {shown.map(dayIso => {
                const roster = days.get(dayIso)?.roster ?? [];
                const work = roster.filter(e => e.type === 'WORK');
                const leave = roster.filter(e => e.type !== 'WORK');
                const isToday = dayIso === today;
                const label = `${dayLabel(dayIso, 'long')}: ${roster.length === 0 ? 'not rostered' : [...work.map(e => entryWhen(e)), ...leave.map(e => TYPE_LABEL[e.type])].join(', ')}`;
                return (
                  <li
                    key={dayIso}
                    aria-label={label}
                    aria-current={isToday ? 'date' : undefined}
                    className={`min-h-16 sm:min-h-20 p-1 sm:p-1.5 border-b border-r border-[var(--border)] [&:nth-child(7n)]:border-r-0 text-left ${inPeriod(dayIso) ? '' : 'opacity-40'} ${isToday ? 'bg-[var(--primary-light)]' : ''}`}
                  >
                    <button type="button" onClick={() => { setAnchor(dayIso); setView('day'); }} className="w-full h-full text-left" aria-label={`Open ${dayLabel(dayIso, 'long')}`}>
                      <span className={`text-xs ${isToday ? 'font-bold text-[var(--primary-text)]' : 'text-[var(--muted)]'}`}>{dayOfMonth(dayIso)}</span>
                      {work.map((e, i) => <span key={i} className="block text-[11px] sm:text-xs font-semibold text-[var(--text)] tabular-nums leading-tight truncate">{entryWhen(e)}</span>)}
                      {leave.length > 0 && <span className="block text-[11px] text-[var(--muted)] truncate">{TYPE_LABEL[leave[0].type]}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--border)] overflow-hidden">
            {view === 'week' && (() => {
              const total = shown.reduce((sum, d) => sum + partTotal((days.get(d)?.roster ?? []).filter(e => e.type === 'WORK')), 0);
              return (
                <div className="px-4 py-2 border-b border-[var(--border)] text-xs font-semibold text-[var(--muted)]">
                  {total > 0 ? `${formatHours(total)} rostered this week` : 'No shifts this week'}
                </div>
              );
            })()}
            <ul className="divide-y divide-[var(--border)]">
              {shown.map(dayIso => {
                const roster = days.get(dayIso)?.roster ?? [];
                const isToday = dayIso === today;
                return (
                  <li key={dayIso} className={`flex items-start gap-4 px-4 py-3 ${isToday ? 'bg-[var(--primary-light)]' : ''}`} aria-current={isToday ? 'date' : undefined}>
                    {view === 'week' && (
                      <div className="w-28 shrink-0">
                        <div className="text-sm font-medium text-[var(--text)]">{dayLabel(dayIso)}</div>
                        {isToday && <div className="text-[11px] font-bold text-[var(--primary-text)]">Today</div>}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      {roster.length > 0 ? (
                        <>
                          <Shifts entries={roster} />
                          {view === 'day' && roster.some(e => e.type === 'WORK') && (
                            <p className="mt-1 text-xs text-[var(--muted)]">{formatHours(partTotal(roster.filter(e => e.type === 'WORK')))} of work{branch ? ` · ${branch.name}` : ''}</p>
                          )}
                        </>
                      ) : <span className="text-sm text-[var(--muted)]">Not rostered</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
