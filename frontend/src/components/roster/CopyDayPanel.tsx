import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import api from '../../services/apiClient';
import { ResultSummary } from './BulkResultDialog';
import { buttonClass } from './Dialog';
import { skipReason, apiErrorCode, apiErrorMessage, type CopyDayResult } from './api';
import { dayLabel, dayOfMonth, isWeekendIso, weekdayShort } from './dates';

interface CopyDayPanelProps {
  worker: { id: string; full_name: string };
  sourceDate: string;
  /** The 14 days of the pay period. */
  days: string[];
  /** Other active workers in the same branch. */
  branchWorkers: { id: string; full_name: string }[];
  /** Whether the day (as it will be saved) has anything rostered. */
  hasRoster: boolean;
  /** True when the editor has unsaved changes: they are saved before copying. */
  needsSave: boolean;
  /** Why the unsaved changes cannot be saved, if they cannot. */
  saveBlockedReason: string | null;
  onSaveFirst: () => Promise<boolean>;
  onCopied: () => void;
}

/**
 * "Copy this day's roster to…": copies what is rostered on this day onto other days of the pay
 * period and, optionally, onto other workers in the same branch (POST /records/copy-day). Only the
 * roster is copied; days that already have worked hours, approved timesheets and locked rosters are
 * skipped by the server and listed with the reason.
 */
export default function CopyDayPanel({
  worker, sourceDate, days, branchWorkers, hasRoster, needsSave, saveBlockedReason, onSaveFirst, onCopied,
}: CopyDayPanelProps) {
  const [targetDays, setTargetDays] = useState<Set<string>>(() => new Set());
  const [targetWorkers, setTargetWorkers] = useState<Set<string>>(() => new Set([worker.id]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CopyDayResult | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // The Copy button is disabled while copying, so move focus to the outcome once it arrives.
  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  const othersChosen = [...targetWorkers].some(id => id !== worker.id);
  const chosenDays = days.filter(d => targetDays.has(d) && (d !== sourceDate || othersChosen));
  const names = new Map([[worker.id, worker.full_name], ...branchWorkers.map(w => [w.id, w.full_name] as [string, string])]);

  const blocked = !hasRoster
    ? 'This day has nothing rostered to copy.'
    : needsSave && saveBlockedReason
      ? saveBlockedReason
      : targetWorkers.size === 0
        ? 'Choose at least one worker.'
        : chosenDays.length === 0
          ? 'Choose at least one day.'
          : null;

  const toggle = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  };

  const pickDays = (which: 'others' | 'weekdays' | 'none') => {
    setResult(null);
    if (which === 'none') return setTargetDays(new Set());
    setTargetDays(new Set(days.filter(d => d !== sourceDate && (which === 'others' || !isWeekendIso(d)))));
  };

  const run = async () => {
    if (blocked || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (needsSave && !(await onSaveFirst())) {
        setError('Your changes could not be saved, so nothing was copied.');
        return;
      }
      const workerIds = [...targetWorkers];
      const res = await api.post('/records/copy-day', {
        employee_id: worker.id,
        source_date: sourceDate,
        target_dates: chosenDays,
        ...(othersChosen ? { target_employee_ids: workerIds } : {}),
      });
      setResult(res.data.data as CopyDayResult);
      onCopied();
    } catch (err) {
      setError(apiErrorCode(err) === 'NOTHING_TO_COPY'
        ? 'This day has nothing rostered to copy. Save the roster first.'
        : apiErrorMessage(err, 'The day could not be copied.'));
    } finally {
      setBusy(false);
    }
  };

  const chipClass =
    'flex flex-col items-center justify-center gap-0.5 min-h-11 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-1 py-1.5 text-[11px] cursor-pointer select-none has-[:checked]:border-[var(--primary)] has-[:checked]:bg-[var(--primary-light)] has-[:checked]:text-[var(--primary)] has-[:disabled]:opacity-50 has-[:disabled]:cursor-not-allowed has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--primary)]';

  return (
    <section aria-label="Copy this day’s roster" className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-3 space-y-3">
      <p className="text-xs text-[var(--muted)]">
        Copies what is rostered on {dayLabel(sourceDate)} to the days you choose. Worked hours are never copied or overwritten:
        days that already have worked hours, an approved timesheet or a locked roster are skipped and listed.
      </p>

      <fieldset>
        <legend className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)] mb-1.5 flex flex-wrap items-center gap-2 w-full">
          <span>Days</span>
          <span className="flex gap-1 normal-case tracking-normal font-medium">
            <button type="button" className={`${buttonClass.quiet} max-md:h-11`} onClick={() => pickDays('others')}>All other days</button>
            <button type="button" className={`${buttonClass.quiet} max-md:h-11`} onClick={() => pickDays('weekdays')}>Weekdays</button>
            <button type="button" className={`${buttonClass.quiet} max-md:h-11`} onClick={() => pickDays('none')}>None</button>
          </span>
        </legend>
        <div className="grid grid-cols-7 gap-1">
          {days.map(d => {
            const isSource = d === sourceDate;
            return (
              <label key={d} className={chipClass} title={isSource ? 'This day (select other workers to copy it to them)' : dayLabel(d)}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={targetDays.has(d) && (!isSource || othersChosen)}
                  disabled={isSource && !othersChosen}
                  onChange={() => { setResult(null); setTargetDays(set => toggle(set, d)); }}
                  aria-label={`${dayLabel(d)}${isSource ? ' (this day)' : ''}`}
                />
                <span className="font-semibold uppercase text-[10px]">{weekdayShort(d)}</span>
                <span className="font-bold">{dayOfMonth(d)}</span>
                {isSource && <span className="text-[9px] font-semibold">this day</span>}
              </label>
            );
          })}
        </div>
      </fieldset>

      {branchWorkers.length > 0 && (
        <details className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2.5 py-2">
          <summary className="text-xs font-semibold text-[var(--text)] cursor-pointer max-md:py-2.5">
            Workers ({targetWorkers.size} chosen) — also copy to others in this branch
          </summary>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-40 overflow-y-auto">
            {[worker, ...branchWorkers].map(w => (
              <label key={w.id} className="flex items-center gap-2 text-xs text-[var(--text)] min-h-11 md:min-h-0 py-0.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-[var(--primary)]"
                  checked={targetWorkers.has(w.id)}
                  onChange={() => { setResult(null); setTargetWorkers(set => toggle(set, w.id)); }}
                />
                <span className="truncate">{w.full_name}{w.id === worker.id ? ' (this worker)' : ''}</span>
              </label>
            ))}
          </div>
        </details>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
        <p className="text-[11px] text-[var(--muted)]" aria-live="polite">
          {blocked ?? (needsSave ? 'Your changes to this day will be saved first.' : `Ready to copy to ${chosenDays.length} day${chosenDays.length === 1 ? '' : 's'}${othersChosen ? ` for ${targetWorkers.size} workers` : ''}.`)}
        </p>
        <button type="button" onClick={run} disabled={Boolean(blocked) || busy} className={`${buttonClass.primary} max-md:h-11`}>
          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
          {busy ? 'Copying…' : needsSave ? 'Save and copy' : 'Copy'}
        </button>
      </div>

      {error && <p role="alert" className="text-xs font-semibold text-[var(--danger)]">{error}</p>}
      {result && (
        <div ref={resultRef} tabIndex={-1} className="outline-none">
          <ResultSummary
            summary={result.copied.length > 0 ? `Copied to ${result.copied.length} day${result.copied.length === 1 ? '' : 's'}.` : 'Nothing was copied.'}
            problemHeading="Skipped"
            anyDone={result.copied.length > 0}
            problems={result.skipped.map(s => ({
              label: `${names.get(s.employee_id) ?? 'Worker'} · ${dayLabel(s.date)}`,
              detail: skipReason(s.reason),
            }))}
          />
        </div>
      )}
    </section>
  );
}
