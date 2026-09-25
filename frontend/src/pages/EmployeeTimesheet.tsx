import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock, RotateCcw, X } from 'lucide-react';
import api from '../services/apiClient';
import { apiErrorMessage } from '../components/roster/api';
import { TimesheetStatusBadge, TIMESHEET_STATE, type TimesheetState } from '../components/TimesheetStatus';
import { buttonClass } from '../components/roster/Dialog';
import TimeLines from '../components/roster/TimeLines';
import { currentFortnightIso, dayLabel, fortnightDays, isWeekendIso, periodLabel, shiftIso } from '../components/roster/dates';
import {
  DEFAULT_BREAK_SETTINGS, breakRuleFor, checkLines, entryWhen, formatHours, lineToEntry, linesFor,
  linesToEntries, partTotal, previewDayHours, TYPE_LABEL, type BreakSettings, type DraftLine, type Entry,
} from '../components/roster/day';

interface TimesheetDay {
  record_date: string;
  roster: Entry[];
  timesheet: Entry[];
  note: string | null;
}

interface TimesheetResponse {
  data: TimesheetDay[];
  approved: boolean;
  timesheet_locked: boolean;
}

/**
 * The employee's own roster and submitted hours for one fortnight. This route only renders when
 * the organisation has "Allow employees to submit timesheets" turned on (see App.tsx's
 * EmployeeGuard). Only the WORKED side is ever editable here — the roster (what a manager
 * planned) is always read-only, matching the same roster/timesheet separation the admin editor
 * uses, just scoped to one worker's own timesheet.
 */
export default function EmployeeTimesheet() {
  const [startDate, setStartDate] = useState(currentFortnightIso());
  const [days, setDays] = useState<Map<string, TimesheetDay>>(new Map());
  const [readOnly, setReadOnly] = useState({ approved: false, timesheet_locked: false });
  const [breakSettings, setBreakSettings] = useState<BreakSettings>(DEFAULT_BREAK_SETTINGS);
  const [mergeLeave, setMergeLeave] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    return api.get(`/portal/timesheet?start_date=${startDate}`)
      .then(res => {
        const body = res.data as TimesheetResponse;
        const map = new Map<string, TimesheetDay>();
        for (const d of body.data) map.set(d.record_date, d);
        setDays(map);
        setReadOnly({ approved: body.approved, timesheet_locked: body.timesheet_locked });
      })
      .catch(err => setError(apiErrorMessage(err, 'Your timesheet could not be loaded.')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    setEditingDate(null);
    load().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate]);

  useEffect(() => {
    api.get('/organisation/me').then(res => {
      setBreakSettings({
        break_mins_weekday: Number(res.data.data.break_mins_weekday ?? DEFAULT_BREAK_SETTINGS.break_mins_weekday),
        break_mins_weekend: Number(res.data.data.break_mins_weekend ?? DEFAULT_BREAK_SETTINGS.break_mins_weekend),
        break_threshold_hours: Number(res.data.data.break_threshold_hours ?? DEFAULT_BREAK_SETTINGS.break_threshold_hours),
      });
      setMergeLeave(Boolean(res.data.data.automatically_merge_leave_with_roster));
    }).catch(() => { /* preview keeps using the default rule if this fails */ });
  }, []);

  const total = partTotal(Array.from(days.values()).flatMap(d => d.timesheet));
  const locked = readOnly.approved || readOnly.timesheet_locked;

  const status: TimesheetState = readOnly.approved && readOnly.timesheet_locked ? 'Locked' : readOnly.approved ? 'Approved' : 'Draft';
  const navButton = 'min-w-11 h-11 px-3 rounded-lg border border-[var(--border)] text-sm font-semibold text-[var(--text)] hover:bg-[var(--panel-subtle)] inline-flex items-center justify-center';

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">My timesheet</h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">{periodLabel(startDate)} · {formatHours(total)} worked</p>
        </div>
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
      </header>

      {!loading && !error && (
        <section data-tour="my-timesheet" aria-label="Timesheet status" className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 flex items-start gap-3">
          <TimesheetStatusBadge status={status} size="md" />
          <div className="text-sm">
            <p className="text-[var(--text)]">{TIMESHEET_STATE[status].employeeMeaning}</p>
            {!locked && <p className="text-[var(--muted)] mt-1">Choose “Record hours” on a day to enter when you started and finished.</p>}
            {locked && readOnly.timesheet_locked && !readOnly.approved && (
              <p className="text-[var(--warn)] mt-1 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" aria-hidden="true" /> Timesheets are locked for this pay period.</p>
            )}
          </div>
        </section>
      )}

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-[var(--danger-light)] border border-[var(--danger)]/30 text-sm text-[var(--danger)] flex flex-wrap items-center justify-between gap-3">
          {error}
          <button type="button" onClick={() => load()} className={navButton}><RotateCcw className="w-4 h-4 mr-1.5" aria-hidden="true" /> Try again</button>
        </div>
      )}

      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl divide-y divide-[var(--border)] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]">Loading your timesheet…</div>
        ) : (
          fortnightDays(startDate).map(iso => {
            const day = days.get(iso);
            const weekend = isWeekendIso(iso);
            const editable = !locked;
            if (editingDate === iso) {
              return (
                <DayRow
                  key={iso}
                  dateIso={iso}
                  entries={day?.timesheet ?? []}
                  rostered={day?.roster ?? []}
                  breakSettings={breakSettings}
                  mergeLeave={mergeLeave}
                  onCancel={() => setEditingDate(null)}
                  onSaved={() => { setEditingDate(null); load(); }}
                />
              );
            }
            return (
              <div key={iso} className={`flex items-center justify-between gap-4 px-4 py-3 ${weekend ? 'bg-[var(--panel-subtle)]' : ''}`}>
                <div className="text-sm font-medium text-[var(--text)] w-32 shrink-0">{dayLabel(iso)}</div>
                <div className="flex-1 min-w-0 space-y-0.5">
                  {day && day.timesheet.length > 0 ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {day.timesheet.map((e, i) => (
                        <span key={i} className="text-sm text-[var(--text)]">
                          {e.type !== 'WORK' && <span className="font-medium text-[var(--muted)] mr-1">{TYPE_LABEL[e.type]}</span>}
                          {entryWhen(e)}
                          <span className="text-[var(--muted)]"> · {formatHours(e.hours)}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-[var(--muted)]">Nothing recorded</span>
                  )}
                  {day && day.roster.length > 0 && (
                    <RosterComparison roster={day.roster} timesheet={day.timesheet} />
                  )}
                </div>
                {editable && (
                  <button
                    type="button"
                    onClick={() => setEditingDate(iso)}
                    className="h-11 px-3 rounded-lg border border-[var(--border)] text-sm font-semibold text-[var(--primary-text)] hover:bg-[var(--primary-light)] shrink-0"
                    aria-label={`${day && day.timesheet.length > 0 ? 'Change' : 'Record'} hours for ${dayLabel(iso, 'long')}`}
                  >
                    {day && day.timesheet.length > 0 ? 'Change' : 'Record hours'}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** How the day was rostered, and whether what was worked matches it — the roster itself is read-only here. */
function RosterComparison({ roster, timesheet }: { roster: Entry[]; timesheet: Entry[] }) {
  const same = (a: Entry[], b: Entry[]) =>
    a.length === b.length && a.every((e, i) => e.type === b[i].type && e.start === b[i].start && e.finish === b[i].finish && (e.start || e.hours === b[i].hours));
  const status = timesheet.length === 0 ? null : same(roster, timesheet) ? 'match' : 'differs';
  return (
    <p className="text-xs text-[var(--muted)]">
      Rostered {roster.map(e => `${e.type !== 'WORK' ? `${TYPE_LABEL[e.type]} ` : ''}${entryWhen(e)}`).join(', ')}
      {status === 'match' && <span className="ml-1.5 font-semibold text-[var(--success)]">· matches</span>}
      {status === 'differs' && <span className="ml-1.5 font-semibold text-[var(--warn)]">· differs from roster</span>}
    </p>
  );
}

/**
 * Editing one day's worked time. Only Normal Work can be entered here: leave is requested on the
 * Leave tab (and approved by a manager), so leave already recorded on the day is shown read-only
 * and is always kept by the server — saving never removes it, and work that overlaps it is refused.
 */
function DayRow({ dateIso, entries, rostered, breakSettings, mergeLeave, onCancel, onSaved }: {
  dateIso: string;
  entries: Entry[];
  rostered: Entry[];
  breakSettings: BreakSettings;
  mergeLeave: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const leave = entries.filter(e => e.type !== 'WORK');
  const rosteredLeave = rostered.filter(e => e.type !== 'WORK');
  const [lines, setLines] = useState<DraftLine[]>(() => linesFor(entries.filter(e => e.type === 'WORK')));
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const rule = useMemo(() => breakRuleFor(breakSettings, dateIso), [breakSettings, dateIso]);
  const check = checkLines(lines, mergeLeave);
  // The day's break threshold counts the kept leave too, exactly as the server will.
  const fullPreview = previewDayHours([...leave, ...lines.map(lineToEntry)], rule, mergeLeave);
  const preview = { ...fullPreview, perEntry: fullPreview.perEntry.slice(leave.length) };

  const save = async () => {
    if (check.first || saving) return;
    setSaving(true);
    setServerError(null);
    try {
      await api.post('/portal/timesheet', { record_date: dateIso, timesheet: linesToEntries(lines) });
      onSaved();
    } catch (err) {
      setServerError(apiErrorMessage(err, 'Could not save this day.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-4 py-4 bg-[var(--panel-subtle)] space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[var(--text)]">{dayLabel(dateIso, 'long')}</div>
        <button type="button" onClick={onCancel} className="p-2.5 rounded text-[var(--muted)] hover:text-[var(--text)]" aria-label="Cancel" disabled={saving}>
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      {(leave.length > 0 || rosteredLeave.length > 0) && (
        <p className="text-xs text-[var(--muted)] bg-[var(--panel)] border border-[var(--border)] rounded-lg px-3 py-2">
          Leave on this day (kept as is): {[...leave, ...rosteredLeave.filter(r => !leave.some(l => l.type === r.type && l.start === r.start && l.finish === r.finish))]
            .map(e => `${TYPE_LABEL[e.type]} ${entryWhen(e)}`).join(', ')}. Ask your manager if it’s wrong.
        </p>
      )}
      <TimeLines id={`emp-ts-${dateIso}`} name="Worked" lines={lines} onChange={setLines} preview={preview} issues={check.issues} autoFocus breakRule={rule} types={['WORK']} />
      {serverError && <p role="alert" className="text-xs font-semibold text-[var(--danger)]">{serverError}</p>}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">
          Total {formatHours(fullPreview.total)}{fullPreview.breakMins > 0 && <> · incl. {fullPreview.breakMins} min unpaid break</>}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={saving} className={buttonClass.secondary}>Cancel</button>
          <button type="button" onClick={save} disabled={Boolean(check.first) || saving} className={buttonClass.primary}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
