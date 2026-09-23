import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CheckSquare, Lock, Pencil, X } from 'lucide-react';
import api from '../services/apiClient';
import { apiErrorMessage } from '../components/roster/api';
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
      .catch(() => setError('Could not load your timesheet. Please try again.'))
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
    api.get('/organisation/me').then(res => setBreakSettings({
      break_mins_weekday: Number(res.data.data.break_mins_weekday ?? DEFAULT_BREAK_SETTINGS.break_mins_weekday),
      break_mins_weekend: Number(res.data.data.break_mins_weekend ?? DEFAULT_BREAK_SETTINGS.break_mins_weekend),
      break_threshold_hours: Number(res.data.data.break_threshold_hours ?? DEFAULT_BREAK_SETTINGS.break_threshold_hours),
    })).catch(() => { /* preview keeps using the default rule if this fails */ });
  }, []);

  const total = partTotal(Array.from(days.values()).flatMap(d => d.timesheet));
  const locked = readOnly.approved || readOnly.timesheet_locked;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-[var(--primary)]" />
            My Timesheet
          </h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">{periodLabel(startDate)} · {formatHours(total)} worked</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setStartDate(shiftIso(startDate, -14))} className="p-2 rounded-lg border border-[var(--border)] text-[var(--text)] hover:bg-[var(--panel-subtle)]" aria-label="Previous fortnight">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => setStartDate(currentFortnightIso())} className="px-3 py-2 rounded-lg border border-[var(--border)] text-xs font-semibold text-[var(--text)] hover:bg-[var(--panel-subtle)]">
            Today
          </button>
          <button onClick={() => setStartDate(shiftIso(startDate, 14))} className="p-2 rounded-lg border border-[var(--border)] text-[var(--text)] hover:bg-[var(--panel-subtle)]" aria-label="Next fortnight">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400">{error}</div>}

      {locked && !loading && (
        <p className="flex items-center gap-1.5 text-xs text-[var(--warn)] bg-[var(--warn-light)] border border-[var(--warn)]/30 rounded-lg px-3 py-2">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          {readOnly.approved ? 'This timesheet is approved and can no longer be changed.' : 'Timesheets are locked for this pay period.'}
        </p>
      )}

      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl divide-y divide-[var(--border)] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--muted)]">Loading…</div>
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
                  breakSettings={breakSettings}
                  onCancel={() => setEditingDate(null)}
                  onSaved={() => { setEditingDate(null); load(); }}
                />
              );
            }
            return (
              <div key={iso} className={`flex items-center justify-between gap-4 px-4 py-3 ${weekend ? 'bg-[var(--panel-subtle)]' : ''}`}>
                <div className="text-sm font-medium text-[var(--text)] w-32 shrink-0">{dayLabel(iso)}</div>
                <div className="flex-1 min-w-0">
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
                </div>
                {editable && (
                  <button
                    onClick={() => setEditingDate(iso)}
                    className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--primary)] hover:bg-[var(--panel-subtle)] shrink-0"
                    title="Edit worked hours"
                  >
                    <Pencil className="w-3.5 h-3.5" />
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

function DayRow({ dateIso, entries, breakSettings, onCancel, onSaved }: {
  dateIso: string;
  entries: Entry[];
  breakSettings: BreakSettings;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [lines, setLines] = useState<DraftLine[]>(() => linesFor(entries));
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const rule = useMemo(() => breakRuleFor(breakSettings, dateIso), [breakSettings, dateIso]);
  const check = checkLines(lines);
  const preview = previewDayHours(lines.map(lineToEntry), rule);

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
        <button onClick={onCancel} className="p-1 rounded text-[var(--muted)] hover:text-[var(--text)]" title="Cancel" disabled={saving}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <TimeLines id={`emp-ts-${dateIso}`} name="Worked" lines={lines} onChange={setLines} preview={preview} issues={check.issues} autoFocus />
      {serverError && <p role="alert" className="text-xs font-semibold text-[var(--danger)]">{serverError}</p>}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">
          Total {formatHours(preview.total)}{preview.breakMins > 0 && <> · incl. {preview.breakMins} min unpaid break</>}
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
