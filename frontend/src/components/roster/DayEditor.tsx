import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ChevronDown, Coffee, Copy, Eraser, Lock, MessageSquarePlus, Repeat } from 'lucide-react';
import api from '../../services/apiClient';
import ApplyBreakDialog from './ApplyBreakDialog';
import CopyDayPanel from './CopyDayPanel';
import { PART_STYLE, PartLines } from './DayBox';
import { Dialog, buttonClass } from './Dialog';
import TimeLines from './TimeLines';
import { apiErrorMessage } from './api';
import { dayLabel, todayIso } from './dates';
import {
  PART_HINT, PART_LABEL, breakRuleFor, checkLines, describeBreakRule, formatHours, lineToEntry, linesFor,
  linesToEntries, partKey, partTotal as savedTotal, previewDayHours, readSavedDay,
  type BreakSettings, type DayRecord, type DraftLine, type Entry, type Part, type Scope,
} from './day';

interface DayEditorProps {
  worker: { id: string; full_name: string; location_name: string | null };
  dateIso: string;
  /** The day as saved (undefined when nothing is saved yet). */
  day: DayRecord | undefined;
  breakSettings: BreakSettings;
  /** The worker's branch has its roster locked for this pay period. */
  rosterLocked: boolean;
  /** The worker's branch has its timesheets locked for this pay period. */
  timesheetLocked: boolean;
  /** The worker's timesheet for this pay period is approved. */
  approved: boolean;
  /** The 14 days of the pay period, for "Copy this day's roster to…". */
  fortnightDays: string[];
  /** Other active workers in the same branch, for "Copy this day's roster to…". */
  branchWorkers: { id: string; full_name: string }[];
  onClose: () => void;
  /** Called with the server's copy of the day after a successful save. */
  onSaved: (saved: { roster: Entry[]; timesheet: Entry[]; note: string | null }) => void;
  /** Called after "Copy this day's roster to…" changed other days. */
  onCopied: () => void;
}

interface Saved {
  roster: Entry[];
  timesheet: Entry[];
  note: string;
}

const TARGETS: { value: Scope; label: string; hint: string }[] = [
  { value: 'ROSTER', label: 'Roster only', hint: 'Plans the day. Nothing is recorded as worked.' },
  { value: 'TIMESHEET', label: 'Timesheet only', hint: 'Records worked time with nothing rostered.' },
  { value: 'BOTH', label: 'Both', hint: 'The same times are rostered and recorded as worked.' },
];

/**
 * One editor for one worker-day, in two plainly labelled parts: ROSTERED (what was planned) and
 * WORKED (what actually happened). Saving sends the smallest correct scope — only the roster, only
 * the worked hours, or both — so a roster change can never touch worked hours.
 */
export default function DayEditor({
  worker, dateIso, day, breakSettings, rosterLocked, timesheetLocked, approved, fortnightDays, branchWorkers, onClose, onSaved, onCopied,
}: DayEditorProps) {
  const id = useId();
  const rosterReadOnly = approved || rosterLocked;
  const workedReadOnly = approved || timesheetLocked;

  const [saved, setSaved] = useState<Saved>(() => ({ roster: day?.roster ?? [], timesheet: day?.timesheet ?? [], note: day?.note ?? '' }));
  const isFreshDay = (s: Saved) => !approved && !rosterLocked && !timesheetLocked && s.roster.length === 0 && s.timesheet.length === 0;
  // A day with nothing on it yet is entered as one list, with an explicit choice of where it goes.
  const [fresh, setFresh] = useState(() => isFreshDay(saved));
  const [target, setTarget] = useState<Scope>('ROSTER');
  const [rosterLines, setRosterLines] = useState<DraftLine[]>(() => linesFor(saved.roster));
  const [workedLines, setWorkedLines] = useState<DraftLine[]>(() => linesFor(saved.timesheet));
  const [note, setNote] = useState(saved.note);
  const [noteOpen, setNoteOpen] = useState(Boolean(saved.note));
  const [showCopy, setShowCopy] = useState(false);
  const [applyBreakMode, setApplyBreakMode] = useState<'some' | 'all' | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const noteWasOpen = useRef(noteOpen);

  useEffect(() => {
    if (noteOpen && !noteWasOpen.current) noteRef.current?.focus();
    noteWasOpen.current = noteOpen;
  }, [noteOpen]);

  // ── What would be saved ──────────────────────────────────────────────────────────────────────
  const rule = useMemo(() => breakRuleFor(breakSettings, dateIso), [breakSettings, dateIso]);
  const effRoster = fresh ? (target === 'TIMESHEET' ? [] : rosterLines) : rosterLines;
  const effWorked = fresh ? (target === 'ROSTER' ? [] : rosterLines) : workedLines;
  const rosterEntries = linesToEntries(effRoster);
  const workedEntries = linesToEntries(effWorked);

  const rosterChanged = !rosterReadOnly && partKey(rosterEntries) !== partKey(saved.roster);
  const workedChanged = !workedReadOnly && partKey(workedEntries) !== partKey(saved.timesheet);
  const noteChanged = !approved && note.trim() !== saved.note.trim();
  const scope: Scope | null = rosterChanged && workedChanged ? 'BOTH'
    : rosterChanged ? 'ROSTER'
      : workedChanged ? 'TIMESHEET'
        // A note on its own is saved with the unchanged roster (or, if that is locked, the unchanged timesheet).
        : noteChanged ? (rosterReadOnly ? 'TIMESHEET' : 'ROSTER') : null;

  const rosterCheck = checkLines(rosterLines);
  const workedCheck = checkLines(workedLines);
  const freshName = target === 'BOTH' ? 'Rostered and worked' : PART_LABEL[target === 'TIMESHEET' ? 'timesheet' : 'roster'];
  const problem = fresh
    ? (rosterCheck.first ? `${freshName}: ${rosterCheck.first}` : null)
    : (rosterChanged && rosterCheck.first ? `Rostered: ${rosterCheck.first}` : null)
      ?? (workedChanged && workedCheck.first ? `Worked: ${workedCheck.first}` : null);

  const blockReason = approved
    ? 'This timesheet is approved. Reopen the timesheet to change it.'
    : problem || (scope === null ? 'No changes yet.' : null);

  const saveLabel = rosterChanged && workedChanged ? 'Save roster and worked hours'
    : rosterChanged ? 'Save roster'
      : workedChanged ? 'Save worked hours'
        : noteChanged ? 'Save note' : 'Save';
  const partsHint = rosterChanged && workedChanged
    ? (fresh ? 'The same times are saved as rostered and worked.' : 'Saves the roster and the worked hours.')
    : rosterChanged
      ? `${rosterEntries.length > 0 ? 'Only the roster changes.' : 'Clears the roster.'} Worked hours stay as they are.`
      : workedChanged
        ? `${workedEntries.length > 0 ? 'Only the worked hours change.' : 'Clears the worked hours.'} The roster stays as it is.`
        : null;
  const saveHint = partsHint && noteChanged ? `${partsHint} The note is saved too.` : partsHint ?? (noteChanged ? 'Only the note changes.' : null);

  // ── Saving ───────────────────────────────────────────────────────────────────────────────────
  const persist = async (): Promise<boolean> => {
    if (scope === null) return true;
    if (blockReason) return false;
    setSaving(true);
    setServerError(null);
    try {
      const res = await api.post('/records', {
        employee_id: worker.id,
        record_date: dateIso,
        scope,
        ...(scope !== 'TIMESHEET' ? { roster: rosterChanged ? rosterEntries : saved.roster } : {}),
        ...(scope !== 'ROSTER' ? { timesheet: workedChanged ? workedEntries : saved.timesheet } : {}),
        ...(noteChanged ? { note: note.trim() } : {}),
      });
      const result = readSavedDay(res.data?.data ?? {});
      const next: Saved = { roster: result.roster, timesheet: result.timesheet, note: result.note ?? '' };
      setSaved(next);
      setFresh(isFreshDay(next));
      setRosterLines(linesFor(next.roster));
      setWorkedLines(linesFor(next.timesheet));
      setNote(next.note);
      onSaved(result);
      return true;
    } catch (err) {
      setServerError(apiErrorMessage(err, 'This day could not be saved.'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (blockReason || saving) return;
    if (await persist()) onClose();
  };

  const changeLines = (part: Part) => (lines: DraftLine[]) => {
    (part === 'roster' ? setRosterLines : setWorkedLines)(lines);
    setServerError(null);
  };

  const workedAsRostered = () => {
    setWorkedLines(linesFor(rosterEntries));
    setServerError(null);
  };

  // Where the cursor starts (once, when the editor opens): the roster for future days; for today or
  // earlier, the worked time when the roster is already there.
  const [focusPart] = useState<Part | 'fresh' | null>(() => (fresh ? 'fresh'
    : !rosterReadOnly && (workedReadOnly || saved.roster.length === 0 || dateIso > todayIso()) ? 'roster'
      : !workedReadOnly ? 'timesheet' : null));

  // ── Rendering ────────────────────────────────────────────────────────────────────────────────
  // A read-only part shows the hours as saved (what payroll uses), not a recalculation under today's settings.
  const partTotal = (lines: DraftLine[], stored?: Entry[]) => {
    let { total, breakMins } = previewDayHours(lines.map(lineToEntry), rule);
    if (stored) {
      total = savedTotal(stored);
      breakMins = Math.max(0, Math.round((previewDayHours(stored, { breakMins: 0, thresholdHours: 0 }).total - total) * 60));
    }
    return (
      <p className="text-xs text-[var(--muted)] tabular-nums" aria-live="polite">
        Total <strong className="text-[var(--text)]">{formatHours(total)}</strong>
        {breakMins > 0 && <> · incl. {breakMins} min unpaid break</>}
      </p>
    );
  };

  const lockReason = (part: Part): string | null => {
    if (approved) return null;
    const branch = worker.location_name ?? 'this branch';
    if (part === 'roster' && rosterLocked) return `The roster for ${branch} is locked for this pay period.`;
    if (part === 'timesheet' && timesheetLocked) return `Timesheets for ${branch} are locked for this pay period.`;
    return null;
  };

  const renderPart = (part: Part) => {
    const readOnly = part === 'roster' ? rosterReadOnly : workedReadOnly;
    const lines = part === 'roster' ? rosterLines : workedLines;
    const entries = part === 'roster' ? saved.roster : saved.timesheet;
    const check = part === 'roster' ? rosterCheck : workedCheck;
    const titleId = `${id}-${part}`;
    const reason = lockReason(part);
    return (
      <section aria-labelledby={titleId} className="rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-3 md:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
          <div className={`pl-2 ${PART_STYLE[part]}`}>
            <h3 id={titleId} className="text-sm font-bold text-[var(--text)]">
              {PART_LABEL[part]} <span className="font-normal text-[var(--muted)]">· {PART_HINT[part]}</span>
            </h3>
            {partTotal(lines, readOnly ? entries : undefined)}
          </div>
          {!readOnly && (
            <div className="flex flex-wrap gap-1">
              {part === 'timesheet' && (
                <button
                  type="button"
                  onClick={workedAsRostered}
                  disabled={rosterEntries.length === 0}
                  className={`${buttonClass.secondary} max-md:h-11`}
                  title={rosterEntries.length === 0 ? 'Nothing is rostered on this day' : 'Copy the rostered times into Worked'}
                >
                  <Repeat className="w-3.5 h-3.5" aria-hidden="true" /> Worked the rostered times
                </button>
              )}
              <button
                type="button"
                onClick={() => changeLines(part)(linesFor([]))}
                className={`${buttonClass.quiet} max-md:h-11`}
                title={`Remove every ${PART_LABEL[part].toLowerCase()} time on this day`}
              >
                <Eraser className="w-3.5 h-3.5" aria-hidden="true" /> Clear
              </button>
            </div>
          )}
        </div>

        {readOnly ? (
          <>
            {reason && (
              <p className="mb-2 flex items-center gap-1.5 text-xs text-[var(--warn)]">
                <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {reason}
              </p>
            )}
            <PartLines part={part} entries={entries} emptyText={part === 'roster' ? 'Nothing rostered' : 'Nothing worked'} />
          </>
        ) : (
          <TimeLines
            id={titleId}
            name={PART_LABEL[part]}
            lines={lines}
            onChange={changeLines(part)}
            preview={previewDayHours(lines.map(lineToEntry), rule)}
            issues={check.issues}
            autoFocus={focusPart === part}
          />
        )}
      </section>
    );
  };

  const renderFresh = () => {
    const part: Part = target === 'TIMESHEET' ? 'timesheet' : 'roster';
    const current = TARGETS.find(t => t.value === target)!;
    return (
      <>
        <fieldset className="mb-3">
          <legend className="text-xs font-semibold text-[var(--text)] mb-1.5">Add to</legend>
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)]">
            {TARGETS.map(t => (
              <label
                key={t.value}
                className="flex items-center justify-center text-center min-h-11 md:min-h-9 px-2 rounded-lg text-xs font-semibold text-[var(--muted)] cursor-pointer select-none has-[:checked]:bg-[var(--panel)] has-[:checked]:text-[var(--text)] has-[:checked]:shadow-sm has-[:checked]:ring-1 has-[:checked]:ring-[var(--border)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--primary)]"
              >
                <input
                  type="radio"
                  name={`${id}-target`}
                  value={t.value}
                  checked={target === t.value}
                  onChange={() => { setTarget(t.value); setServerError(null); }}
                  className="sr-only"
                />
                {t.label}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-[var(--muted)]">{current.hint}</p>
        </fieldset>

        <section aria-labelledby={`${id}-fresh`} className="rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-3 md:p-4">
          <div className={`pl-2 mb-2 ${target === 'BOTH' ? PART_STYLE.timesheet : PART_STYLE[part]}`}>
            <h3 id={`${id}-fresh`} className="text-sm font-bold text-[var(--text)]">
              {freshName}{' '}
              <span className="font-normal text-[var(--muted)]">
                · {target === 'BOTH' ? 'planned and worked the same' : PART_HINT[part]}
              </span>
            </h3>
            {partTotal(rosterLines)}
          </div>
          <TimeLines
            id={`${id}-fresh`}
            name={freshName}
            lines={rosterLines}
            onChange={changeLines('roster')}
            preview={previewDayHours(rosterLines.map(lineToEntry), rule)}
            issues={rosterCheck.issues}
            autoFocus={focusPart === 'fresh'}
          />
        </section>
      </>
    );
  };

  return (
    <Dialog
      title={`${worker.full_name} — ${dayLabel(dateIso, 'long')}`}
      description={`${worker.location_name ? `${worker.location_name} · ` : ''}${describeBreakRule(rule)}`}
      onClose={onClose}
      closeDisabled={saving}
      size="lg"
      sheet
      onSubmit={handleSubmit}
      footer={
        <div className="space-y-2">
          {serverError && (
            <p role="alert" className="flex items-start gap-1.5 text-xs font-semibold text-[var(--danger)] bg-[var(--danger-light)] border border-[var(--danger)]/30 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              {serverError}
            </p>
          )}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
            <p id={`${id}-reason`} aria-live="polite" className={`text-xs ${problem ? 'text-[var(--danger)] font-semibold' : 'text-[var(--muted)]'}`}>
              {blockReason ?? saveHint}
            </p>
            <div className="flex justify-end gap-2 shrink-0">
              <button type="button" onClick={onClose} disabled={saving} className={`${buttonClass.secondary} max-md:flex-1 max-md:h-11`}>
                {scope ? 'Cancel' : 'Close'}
              </button>
              <button
                type="submit"
                disabled={Boolean(blockReason) || saving}
                aria-describedby={`${id}-reason`}
                className={`${buttonClass.primary} max-md:flex-1 max-md:h-11`}
              >
                {saving ? 'Saving…' : saveLabel}
              </button>
            </div>
          </div>
        </div>
      }
    >
      {approved && (
        <p className="mb-3 flex items-start gap-1.5 text-xs text-[var(--warn)] bg-[var(--warn-light)] border border-[var(--warn)]/30 rounded-lg px-3 py-2">
          <Lock className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          This timesheet is approved, so this day can’t be changed. Reopen the timesheet to change it.
        </p>
      )}

      <div className="space-y-3">
        {fresh ? renderFresh() : (
          <>
            {renderPart('roster')}
            {renderPart('timesheet')}
          </>
        )}

        {/* Note for the day */}
        {noteOpen ? (
          <div>
            <label htmlFor={`${id}-note`} className="block text-xs font-semibold text-[var(--text)] mb-1">Note for the day</label>
            <textarea
              ref={noteRef}
              id={`${id}-note`}
              rows={2}
              maxLength={500}
              value={note}
              readOnly={approved}
              placeholder="e.g. Covering for Rich"
              onChange={e => { setNote(e.target.value); setServerError(null); }}
              className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-2 text-base md:text-xs text-[var(--text)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] read-only:opacity-70 resize-y"
            />
          </div>
        ) : (
          !approved && (
            <button type="button" onClick={() => setNoteOpen(true)} className={`${buttonClass.quiet} max-md:h-11 -ml-2.5`}>
              <MessageSquarePlus className="w-3.5 h-3.5" aria-hidden="true" /> Add a note
            </button>
          )
        )}

        {/* Copy this day's roster */}
        <div className="border-t border-[var(--border)] pt-3">
          <button
            type="button"
            onClick={() => setShowCopy(v => !v)}
            aria-expanded={showCopy}
            aria-controls={`${id}-copy`}
            disabled={rosterLocked}
            className={`${buttonClass.quiet} max-md:h-11 -ml-2.5`}
            title={rosterLocked ? 'The roster is locked for this branch' : 'Copy the rostered times of this day to other days or workers'}
          >
            <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Copy this day’s roster to…
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showCopy ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {showCopy && (
            <div id={`${id}-copy`}>
              <CopyDayPanel
                worker={worker}
                sourceDate={dateIso}
                days={fortnightDays}
                branchWorkers={branchWorkers}
                hasRoster={rosterEntries.length > 0}
                needsSave={scope !== null}
                saveBlockedReason={scope !== null ? blockReason : null}
                onSaveFirst={persist}
                onCopied={onCopied}
              />
            </div>
          )}
        </div>

        {/* Apply the unpaid break rule across the fortnight for this worker */}
        <div className="flex flex-wrap gap-1">
          <button type="button" onClick={() => setApplyBreakMode('some')} className={`${buttonClass.quiet} max-md:h-11 -ml-2.5`} title="Choose which days of this fortnight have a break">
            <Coffee className="w-3.5 h-3.5" aria-hidden="true" /> Apply Break…
          </button>
          <button type="button" onClick={() => setApplyBreakMode('all')} className={`${buttonClass.quiet} max-md:h-11`} title="Give every day a break, then untick exceptions">
            <Coffee className="w-3.5 h-3.5" aria-hidden="true" /> Apply Break to All Days…
          </button>
        </div>
      </div>

      {applyBreakMode && (
        <ApplyBreakDialog
          startAllChecked={applyBreakMode === 'all'}
          worker={worker}
          days={fortnightDays}
          onClose={() => setApplyBreakMode(null)}
          onConfirm={async (recordDates, hasBreakValue) => {
            const res = await api.post('/records/apply-break', { employee_id: worker.id, record_dates: recordDates, has_break: hasBreakValue });
            return res.data.data;
          }}
          onApplied={() => { setApplyBreakMode(null); onCopied(); }}
        />
      )}
    </Dialog>
  );
}
