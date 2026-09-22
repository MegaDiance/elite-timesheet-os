import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Copy, Equal, Eraser, Lock, MessageSquare, Plus, Trash2 } from 'lucide-react';
import api from '../../services/apiClient';
import SmartTimeInput from '../SmartTimeInput';
import CopyDayPanel from './CopyDayPanel';
import { Dialog, buttonClass, inputClass } from './Dialog';
import { apiErrorMessage } from './api';
import { dayLabel } from './dates';
import {
  MAX_SEGMENTS_PER_DAY,
  SEGMENT_LABEL,
  SEGMENT_TYPES,
  SIDE_LABEL,
  blankDraft,
  breakRuleFor,
  describeBreakRule,
  draftFromApi,
  draftHasRoster,
  draftHasWorked,
  draftToPayload,
  formatHours,
  isBlankDraft,
  isSegmentType,
  previewDayHours,
  swatchStyle,
  validateDay,
  workedTypeOf,
  type ApiSegment,
  type BreakSettings,
  type DraftSegment,
  type SegmentIssue,
  type SegmentType,
  type Side,
} from './segments';

export interface EditorWorker {
  id: string;
  full_name: string;
  location_id: string;
  location_name?: string | null;
}

export interface SegmentEditorProps {
  worker: EditorWorker;
  dateIso: string;
  /** The day's saved segments. */
  segments: ApiSegment[];
  breakSettings: BreakSettings;
  /** The worker's branch has its roster locked for this pay period. */
  rosterLocked: boolean;
  /** The worker's branch has its timesheets locked for this pay period. */
  timesheetLocked: boolean;
  /** The worker's timesheet for this pay period is approved. */
  approved: boolean;
  /** The 14 days of the pay period, for "Copy this day to…". */
  fortnightDays: string[];
  /** Other active workers in the same branch, for "Copy this day to…". */
  branchWorkers: { id: string; full_name: string }[];
  onClose: () => void;
  /** Called with the server-computed segments after a successful save. */
  onSaved: (segments: ApiSegment[]) => void;
  /** Called after "Copy this day to…" changed other days. */
  onCopied: () => void;
}

type Field = 'in' | 'out';

const serialise = (rows: DraftSegment[]) => JSON.stringify(rows.filter(r => !isBlankDraft(r)).map(draftToPayload));
const fieldId = (key: string, side: Side, field: Field) => `${key}-${side}-${field}`;

const sideValues = (row: DraftSegment, side: Side) =>
  side === 'roster'
    ? { type: row.segment_type, start: row.roster_in, finish: row.roster_out, hours: row.roster_hours }
    : { type: workedTypeOf(row), start: row.actual_in, finish: row.actual_out, hours: row.actual_hours };

const timeClass = `${inputClass} shrink-0 w-[3.75rem] lg:w-16 text-center font-mono tabular-nums px-1`;
const selectClass =
  'flex-1 min-w-[5rem] max-w-[11rem] lg:flex-none lg:w-28 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-1.5 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] disabled:opacity-70 disabled:cursor-default';

/**
 * Edits one worker's day as a short list of segments, each with a rostered side and a worked side.
 *
 * A simple day is one row: type "9" and "5p" and press Enter. A split day is a few rows; "+ Add
 * segment" starts the new row where the previous one finished and puts the cursor on its finish time.
 * Hours are previewed live with the organisation's break rule, problems are explained on the row,
 * and Save stays disabled (with the reason shown) until the day is valid.
 */
export default function SegmentEditor({
  worker, dateIso, segments, breakSettings, rosterLocked, timesheetLocked, approved, fortnightDays, branchWorkers, onClose, onSaved, onCopied,
}: SegmentEditorProps) {
  const rosterReadOnly = approved || rosterLocked;
  const workedReadOnly = approved || timesheetLocked;
  const editableSides = useMemo<Side[]>(
    () => [...(rosterReadOnly ? [] : ['roster' as const]), ...(workedReadOnly ? [] : ['actual' as const])],
    [rosterReadOnly, workedReadOnly],
  );
  const canEdit = editableSides.length > 0;

  const [rows, setRows] = useState<DraftSegment[]>(() =>
    segments.length > 0 ? segments.map(draftFromApi) : canEdit ? [blankDraft()] : [],
  );
  const [baseline, setBaseline] = useState(() => serialise(rows));
  const [activeSide, setActiveSide] = useState<Side>(editableSides[0] ?? 'roster');
  const [openNotes, setOpenNotes] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [showCopy, setShowCopy] = useState(false);
  const reasonId = useId();

  // ── Focus management ─────────────────────────────────────────────────────────────────────────
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const bindInput = (id: string) => (el: HTMLInputElement | null) => {
    if (el) inputs.current.set(id, el);
    else inputs.current.delete(id);
  };
  const [initialFocus] = useState<string | null>(() => {
    const first = rows[0];
    const side = editableSides[0];
    if (!first || !side) return null;
    const { start, finish } = sideValues(first, side);
    return fieldId(first.key, side, start && !finish ? 'out' : 'in');
  });

  useEffect(() => {
    if (initialFocus) inputs.current.get(initialFocus)?.focus();
  }, [initialFocus]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target === 'add') addButton.current?.focus();
    else inputs.current.get(target)?.focus();
  });

  // ── Derived state ────────────────────────────────────────────────────────────────────────────
  const rule = useMemo(() => breakRuleFor(breakSettings, dateIso), [breakSettings, dateIso]);
  const savable = useMemo(() => rows.filter(r => !isBlankDraft(r)), [rows]);
  const rowNumber = (row: DraftSegment) => rows.indexOf(row) + 1;
  const validation = useMemo(
    () => validateDay(savable, i => `segment ${rows.indexOf(savable[i]) + 1}`),
    [rows, savable],
  );
  const issueByKey = useMemo(() => {
    const map = new Map<string, SegmentIssue>();
    savable.forEach((r, i) => {
      const issue = validation.issues[i];
      if (issue) map.set(r.key, issue);
    });
    return map;
  }, [savable, validation]);
  const preview = useMemo(() => previewDayHours(rows, rule), [rows, rule]);
  const dirty = serialise(rows) !== baseline;

  const blockReason = approved
    ? 'This timesheet is approved, so this day is read-only.'
    : !canEdit
      ? 'This day is locked.'
      : !validation.ok
        ? validation.first
        : !dirty
          ? 'No changes to save yet.'
          : null;

  const addSide: Side | null = editableSides.includes(activeSide) ? activeSide : editableSides[0] ?? null;
  const previousFinish = addSide
    ? [...rows].reverse().map(r => (addSide === 'roster' ? r.roster_out : r.actual_out)).find(Boolean) ?? ''
    : '';

  // ── Changes ──────────────────────────────────────────────────────────────────────────────────
  const patchRow = (key: string, patch: Partial<DraftSegment>) => {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
    setServerError(null);
  };

  const setTime = (row: DraftSegment, side: Side, field: Field, value: string) => {
    const current = sideValues(row, side)[field === 'in' ? 'start' : 'finish'];
    if (current === value) return;
    // Once a side has times, its hours come from them; typed hours only apply to an untimed side.
    if (side === 'roster') patchRow(row.key, field === 'in' ? { roster_in: value, roster_hours: 0 } : { roster_out: value, roster_hours: 0 });
    else patchRow(row.key, field === 'in' ? { actual_in: value, actual_hours: 0 } : { actual_out: value, actual_hours: 0 });
  };

  const setType = (row: DraftSegment, side: Side, type: SegmentType) => {
    if (side === 'actual') {
      patchRow(row.key, { actual_segment_type: type === row.segment_type ? null : type });
      return;
    }
    // The worked type follows the rostered type only until worked hours are recorded.
    const worked = draftHasWorked(row) ? workedTypeOf(row) : row.actual_segment_type;
    patchRow(row.key, { segment_type: type, actual_segment_type: worked === type ? null : worked });
  };

  const setHours = (row: DraftSegment, side: Side, hours: number) =>
    patchRow(row.key, side === 'roster' ? { roster_hours: hours } : { actual_hours: hours });

  const addSegment = () => {
    if (!addSide || rows.length >= MAX_SEGMENTS_PER_DAY) return;
    const row = blankDraft();
    if (addSide === 'roster') row.roster_in = previousFinish;
    else row.actual_in = previousFinish;
    setRows(rs => [...rs, row]);
    setServerError(null);
    pendingFocus.current = fieldId(row.key, addSide, previousFinish ? 'out' : 'in');
  };

  const canRemove = (row: DraftSegment) =>
    !approved && !(rosterReadOnly && draftHasRoster(row)) && !(workedReadOnly && draftHasWorked(row));

  const removeRow = (key: string) => {
    setRows(rs => rs.filter(r => r.key !== key));
    setServerError(null);
    pendingFocus.current = 'add';
  };

  const sameAsRoster = () => {
    setRows(rs => rs.map(r => (draftHasRoster(r)
      ? { ...r, actual_in: r.roster_in, actual_out: r.roster_out, actual_hours: r.roster_in ? 0 : r.roster_hours, actual_segment_type: null }
      : r)));
    setServerError(null);
  };

  const clearDay = () => {
    setRows(rs => rs
      .map(r => ({
        ...r,
        ...(rosterReadOnly ? {} : { roster_in: '', roster_out: '', roster_hours: 0 }),
        ...(workedReadOnly ? {} : { actual_in: '', actual_out: '', actual_hours: 0, actual_segment_type: null }),
      }))
      .filter(r => draftHasRoster(r) || draftHasWorked(r)));
    setServerError(null);
    pendingFocus.current = 'add';
  };

  const toggleNotes = (key: string) =>
    setOpenNotes(set => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  // ── Saving ───────────────────────────────────────────────────────────────────────────────────
  const persist = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (blockReason) return false;
    setSaving(true);
    setServerError(null);
    try {
      const res = await api.post('/records', {
        employee_id: worker.id,
        record_date: dateIso,
        segments: savable.map(draftToPayload),
      });
      const saved: ApiSegment[] = res.data?.data?.segments ?? [];
      const next = saved.map(draftFromApi);
      setRows(next.length > 0 ? next : [blankDraft()]);
      setBaseline(serialise(next));
      onSaved(saved);
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

  // ── Rendering ────────────────────────────────────────────────────────────────────────────────
  const sideLocked = (side: Side) => (side === 'roster' ? rosterReadOnly : workedReadOnly);

  const renderSide = (row: DraftSegment, index: number, side: Side, issue: SegmentIssue | undefined, messageId: string) => {
    const n = rowNumber(row);
    const values = sideValues(row, side);
    const readOnly = sideLocked(side);
    const timed = Boolean(values.start || values.finish);
    const hours = side === 'roster' ? preview.roster[index] : preview.actual[index];
    const breakHere = (side === 'roster' ? preview.rosterBreakAt : preview.actualBreakAt) === index;
    const invalid = Boolean(issue && (issue.side === side || issue.side === null));
    const label = SIDE_LABEL[side];
    return (
      <div className="flex flex-wrap lg:flex-nowrap items-center gap-x-1.5 gap-y-0.5 min-w-0" onFocus={() => { if (!readOnly) setActiveSide(side); }}>
        <span className="lg:hidden w-full text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">{label}</span>
        <span className="w-2 h-2 rounded-full shrink-0" style={swatchStyle(values.type, side, side === 'actual' && row.is_unplanned)} aria-hidden="true" />
        <select
          aria-label={`${label} type, segment ${n}`}
          value={values.type}
          disabled={readOnly}
          onChange={e => { if (isSegmentType(e.target.value)) setType(row, side, e.target.value); }}
          className={selectClass}
        >
          {SEGMENT_TYPES.map(t => <option key={t} value={t}>{SEGMENT_LABEL[t]}</option>)}
        </select>
        <SmartTimeInput
          live
          selectOnFocus
          ref={bindInput(fieldId(row.key, side, 'in'))}
          label={`${label} start, segment ${n}`}
          placeholder="Start"
          value={values.start}
          readOnly={readOnly}
          invalid={invalid}
          describedBy={issue ? messageId : undefined}
          onChange={v => setTime(row, side, 'in', v)}
          className={timeClass}
        />
        <span className="text-[var(--muted)] text-xs" aria-hidden="true">→</span>
        <SmartTimeInput
          live
          selectOnFocus
          ref={bindInput(fieldId(row.key, side, 'out'))}
          label={`${label} finish, segment ${n}`}
          placeholder="Finish"
          value={values.finish}
          readOnly={readOnly}
          invalid={invalid}
          describedBy={issue ? messageId : undefined}
          onChange={v => setTime(row, side, 'out', v)}
          className={timeClass}
        />
        {timed ? (
          <span className="w-12 lg:w-14 shrink-0 text-right text-xs font-mono tabular-nums text-[var(--text)]" aria-label={`${label} hours, segment ${n}: ${hours === null ? 'not yet known' : formatHours(hours)}`}>
            {hours === null ? '—' : formatHours(hours)}
            {breakHere && (
              <span className="block text-[9px] leading-none text-[var(--muted)] font-sans" title={`${rule.breakMins} min unpaid break deducted from this segment`}>
                −{rule.breakMins}m break
              </span>
            )}
          </span>
        ) : (
          <HoursInput
            value={values.hours}
            readOnly={readOnly}
            label={`${label} hours without times, segment ${n}`}
            invalid={invalid}
            onChange={h => setHours(row, side, h)}
          />
        )}
      </div>
    );
  };

  const notices: { key: string; text: string }[] = [];
  if (approved) {
    notices.push({ key: 'approved', text: 'This timesheet is approved, so the day is read-only. Reopen the timesheet (on the roster or the Timesheets page) to change it.' });
  } else {
    if (rosterLocked) notices.push({ key: 'roster', text: 'The roster is locked for this branch: rostered times can’t change. You can still record worked hours.' });
    if (timesheetLocked) notices.push({ key: 'timesheet', text: 'Timesheets are locked for this branch: worked times can’t change.' });
  }

  const title = (
    <>
      {worker.full_name} <span className="text-[var(--muted)] font-semibold">· {dayLabel(dateIso, 'long')}</span>
    </>
  );

  return (
    <Dialog
      title={title}
      description={
        <>
          {worker.location_name ? `${worker.location_name} · ` : ''}
          {describeBreakRule(rule)}
        </>
      }
      onClose={onClose}
      closeDisabled={saving}
      size="xl"
      onSubmit={handleSubmit}
      footer={
        <div className="space-y-2">
          {serverError && (
            <p role="alert" className="flex items-start gap-1.5 text-xs font-semibold text-[var(--danger)] bg-[var(--danger-light)] border border-[var(--danger)]/30 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
              {serverError}
            </p>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p id={reasonId} aria-live="polite" className={`text-xs ${validation.ok ? 'text-[var(--muted)]' : 'text-[var(--danger)] font-semibold'}`}>
              {blockReason ?? 'Ready to save.'}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={saving} className={buttonClass.secondary}>
                {dirty ? 'Cancel' : 'Close'}
              </button>
              <button type="submit" disabled={Boolean(blockReason) || saving} aria-describedby={reasonId} className={buttonClass.primary}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      }
    >
      {notices.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {notices.map(n => (
            <p key={n.key} className="flex items-start gap-1.5 text-xs text-[var(--warn)] bg-[var(--warn-light)] border border-[var(--warn)]/30 rounded-lg px-3 py-2">
              <Lock className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
              {n.text}
            </p>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <button
          type="button"
          onClick={sameAsRoster}
          disabled={workedReadOnly || !rows.some(draftHasRoster)}
          className={buttonClass.secondary}
          title="Copy each segment's rostered times into its worked times"
        >
          <Equal className="w-3.5 h-3.5" aria-hidden="true" /> Same as roster
        </button>
        <button
          type="button"
          onClick={clearDay}
          disabled={!canEdit || rows.length === 0}
          className={buttonClass.secondary}
          title={rosterReadOnly ? 'Clears the worked times (the roster is locked)' : workedReadOnly ? 'Clears the rostered times (worked times are locked)' : 'Removes every segment of this day'}
        >
          <Eraser className="w-3.5 h-3.5" aria-hidden="true" /> Clear day
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setShowCopy(v => !v)}
          aria-expanded={showCopy}
          disabled={rosterLocked}
          className={buttonClass.secondary}
          title={rosterLocked ? 'The roster is locked for this branch' : 'Copy the rostered times of this day to other days or workers'}
        >
          <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Copy this day to…
        </button>
      </div>

      {/* Column headings (wide screens) */}
      <div className="hidden lg:grid grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
        <span aria-hidden="true">#</span>
        <span className="flex items-center gap-1">Rostered {rosterReadOnly && <Lock className="w-3 h-3" aria-label="read-only" />}</span>
        <span className="flex items-center gap-1">Worked {workedReadOnly && <Lock className="w-3 h-3" aria-label="read-only" />}</span>
        <span className="w-[10.5rem] text-right">Note · Unplanned · Remove</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-[var(--muted)] rounded-xl border border-dashed border-[var(--border)] px-3 py-4 text-center">
          {dirty ? 'No segments left — saving will clear this day.' : 'Nothing is recorded for this day.'}
        </p>
      ) : (
        <ol className="space-y-1.5" aria-label="Segments">
          {rows.map((row, index) => {
            const n = index + 1;
            const issue = issueByKey.get(row.key);
            const messageId = `${row.key}-message`;
            const notesId = `${row.key}-notes`;
            const notesOpen = openNotes.has(row.key);
            const removable = canRemove(row);
            return (
              <li
                key={row.key}
                aria-label={`Segment ${n}`}
                className={`rounded-xl border px-2 py-1.5 ${issue ? 'border-[var(--danger)]/60 bg-[var(--danger-light)]' : 'border-[var(--border)] bg-[var(--panel-subtle)]'}`}
              >
                <div className="grid grid-cols-1 lg:grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5 lg:gap-3 items-center">
                  <span className="hidden lg:block text-xs font-bold text-[var(--muted)]" aria-hidden="true">{n}</span>
                  {renderSide(row, index, 'roster', issue, messageId)}
                  {renderSide(row, index, 'actual', issue, messageId)}
                  <div className="flex items-center justify-end gap-1 lg:w-[10.5rem] lg:pl-2 lg:border-l lg:border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => toggleNotes(row.key)}
                      aria-expanded={notesOpen}
                      aria-controls={notesId}
                      className={`${buttonClass.quiet} ${row.notes ? 'text-[var(--primary)]' : ''}`}
                      title={row.notes ? `Note: ${row.notes}` : 'Add a note'}
                    >
                      <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{row.notes ? 'Note •' : 'Note'}</span>
                    </button>
                    <label className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)] px-1 cursor-pointer" title="Worked but not rostered">
                      <input
                        type="checkbox"
                        className="accent-[var(--danger)]"
                        checked={row.is_unplanned}
                        disabled={approved}
                        aria-label={`Unplanned, segment ${n}`}
                        onChange={e => patchRow(row.key, { is_unplanned: e.target.checked })}
                      />
                      Unplanned
                    </label>
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      disabled={!removable}
                      aria-label={`Remove segment ${n}`}
                      title={removable ? `Remove segment ${n}` : 'Locked times can’t be removed'}
                      className={`${buttonClass.quiet} hover:text-[var(--danger)]`}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {issue && (
                  <p id={messageId} className="mt-1 lg:ml-8 flex items-center gap-1 text-[11px] font-semibold text-[var(--danger)]">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    {issue.message}
                  </p>
                )}

                {notesOpen ? (
                  <div className="mt-1.5 lg:ml-8">
                    <input
                      id={notesId}
                      type="text"
                      maxLength={500}
                      value={row.notes}
                      readOnly={approved}
                      aria-label={`Note for segment ${n}`}
                      placeholder="Optional note, e.g. left early for an appointment"
                      onChange={e => patchRow(row.key, { notes: e.target.value })}
                      className={`${inputClass} w-full`}
                    />
                  </div>
                ) : (
                  row.notes && (
                    <p className="mt-1 lg:ml-8 text-[11px] text-[var(--muted)] truncate">Note: {row.notes}</p>
                  )
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Add segment + day totals */}
      <div className="mt-2 flex flex-col lg:flex-row lg:items-center gap-2 justify-between">
        <button
          ref={addButton}
          type="button"
          onClick={addSegment}
          disabled={!addSide || rows.length >= MAX_SEGMENTS_PER_DAY}
          className={buttonClass.secondary}
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          Add segment
          {addSide && (
            <span className="font-normal text-[var(--muted)]">
              ({SIDE_LABEL[addSide].toLowerCase()}{previousFinish ? `, from ${previousFinish}` : ''})
            </span>
          )}
        </button>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]" aria-live="polite">
          <span>
            Rostered <strong className="text-[var(--text)] font-mono">{formatHours(preview.rosterTotal)}</strong>
            {preview.rosterBreakAt !== null && ` (after a ${rule.breakMins} min break)`}
          </span>
          <span>
            Worked <strong className="text-[var(--text)] font-mono">{formatHours(preview.actualTotal)}</strong>
            {preview.actualBreakAt !== null && ` (after a ${rule.breakMins} min break)`}
          </span>
        </div>
      </div>

      {validation.dayMessage && <p className="mt-2 text-xs font-semibold text-[var(--danger)]">{validation.dayMessage}</p>}

      {showCopy && (
        <CopyDayPanel
          worker={worker}
          sourceDate={dateIso}
          days={fortnightDays}
          branchWorkers={branchWorkers}
          hasRoster={savable.some(draftHasRoster)}
          needsSave={dirty}
          saveBlockedReason={dirty ? blockReason : null}
          onSaveFirst={persist}
          onCopied={onCopied}
        />
      )}
    </Dialog>
  );
}

/** Hours for a side without times (e.g. a full day of leave). Keeps the typed text while focused. */
function HoursInput({ value, onChange, readOnly, label, invalid }: {
  value: number;
  onChange: (hours: number) => void;
  readOnly: boolean;
  label: string;
  invalid: boolean;
}) {
  const [text, setText] = useState(value ? String(value) : '');
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value ? String(value) : '');
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      placeholder="hrs"
      value={text}
      readOnly={readOnly}
      onFocus={() => { focused.current = true; }}
      onBlur={() => {
        focused.current = false;
        setText(value ? String(value) : '');
      }}
      onChange={e => {
        const cleaned = e.target.value.replace(/[^\d.]/g, '');
        setText(cleaned);
        const n = parseFloat(cleaned);
        onChange(Number.isFinite(n) ? n : 0);
      }}
      className={`${inputClass} w-12 lg:w-14 shrink-0 text-right font-mono tabular-nums px-1.5`}
    />
  );
}
