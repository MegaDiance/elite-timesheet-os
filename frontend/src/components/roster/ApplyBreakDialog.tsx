import { useState } from 'react';
import { Dialog, buttonClass } from './Dialog';
import { apiErrorMessage } from './api';
import { dayLabel, dayOfMonth, isWeekendIso, weekdayShort } from './dates';

interface ApplyBreakDialogProps {
  /** "Apply Break" starts every day unticked; "Apply Break to All Days" starts every day ticked. */
  startAllChecked: boolean;
  worker: { id: string; full_name: string };
  days: string[];
  onClose: () => void;
  /** Calls POST /records/apply-break and resolves with { applied, skipped }. */
  onConfirm: (recordDates: string[], hasBreak: boolean) => Promise<{ applied: string[]; skipped: Array<{ date: string; reason: string }> }>;
  onApplied: () => void;
}

const SKIP_REASON_LABEL: Record<string, string> = {
  NOTHING_TO_CHANGE: 'nothing recorded',
  TIMESHEET_ALREADY_APPROVED: 'timesheet approved',
  ROSTER_LOCKED: 'roster locked',
  TIMESHEET_LOCKED: 'timesheet locked',
};

/**
 * "Apply Break" / "Apply Break to All Days": tick the days that should have the unpaid break
 * rule applied (or, starting from every day ticked, untick the exceptions), for one worker's
 * fortnight. Mirrors DayPickerDialog's day-grid, scoped to a single worker instead of a branch.
 */
export default function ApplyBreakDialog({ startAllChecked, worker, days, onClose, onConfirm, onApplied }: ApplyBreakDialogProps) {
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(startAllChecked ? days.map((_, i) => i) : []));
  const [hasBreak, setHasBreak] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ applied: string[]; skipped: Array<{ date: string; reason: string }> } | null>(null);

  const toggle = (i: number) =>
    setChosen(set => {
      const next = new Set(set);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const chosenDates = [...chosen].sort((a, b) => a - b).map(i => days[i]);
      const res = await onConfirm(chosenDates, hasBreak);
      setResult(res);
      if (res.skipped.length === 0) onApplied();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not update the break for these days.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`${startAllChecked ? 'Apply Break to All Days' : 'Apply Break'} — ${worker.full_name}`}
      onClose={onClose}
      closeDisabled={busy}
      size="md"
      footer={
        <div className="flex flex-col gap-2">
          {error && <p role="alert" className="text-xs font-semibold text-[var(--danger)]">{error}</p>}
          {result && (
            <p className="text-xs text-[var(--muted)]" aria-live="polite">
              {result.applied.length} day{result.applied.length === 1 ? '' : 's'} updated
              {result.skipped.length > 0 && `; ${result.skipped.length} skipped (${result.skipped.map(s => `${dayLabel(s.date)}: ${SKIP_REASON_LABEL[s.reason] ?? s.reason}`).join(', ')})`}
            </p>
          )}
          <p className="text-xs text-[var(--muted)]" aria-live="polite">{chosen.size} of {days.length} days chosen</p>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button type="button" onClick={result ? onApplied : onClose} disabled={busy} className={`${buttonClass.secondary} max-md:h-11`}>
              {result ? 'Done' : 'Cancel'}
            </button>
            <button type="button" disabled={chosen.size === 0 || busy} onClick={confirm} className={`${buttonClass.primary} max-md:h-11`}>
              {busy ? 'Working…' : `${hasBreak ? 'Apply' : 'Remove'} break on ${chosen.size} day${chosen.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      }
    >
      <fieldset className="mb-3">
        <legend className="text-xs font-semibold text-[var(--text)] mb-1.5">Break</legend>
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)]">
          {[{ value: true, label: 'Has a break' }, { value: false, label: 'No break' }].map(o => (
            <label
              key={String(o.value)}
              className="flex items-center justify-center text-center min-h-11 md:min-h-9 px-2 rounded-lg text-xs font-semibold text-[var(--muted)] cursor-pointer select-none has-[:checked]:bg-[var(--panel)] has-[:checked]:text-[var(--text)] has-[:checked]:shadow-sm has-[:checked]:ring-1 has-[:checked]:ring-[var(--border)]"
            >
              <input type="radio" name="apply-break-value" className="sr-only" checked={hasBreak === o.value} onChange={() => setHasBreak(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-1 mb-2">
        <button type="button" className={`${buttonClass.quiet} max-md:h-11`} onClick={() => setChosen(new Set(days.map((_, i) => i)))}>All days</button>
        <button type="button" className={`${buttonClass.quiet} max-md:h-11`} onClick={() => setChosen(new Set(days.flatMap((d, i) => (isWeekendIso(d) ? [] : [i]))))}>Weekdays</button>
        <button type="button" className={`${buttonClass.quiet} max-md:h-11`} onClick={() => setChosen(new Set())}>None</button>
      </div>
      <fieldset>
        <legend className="sr-only">Days</legend>
        {[0, 1].map(week => (
          <div key={week} className="mb-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)] mb-1">Week {week + 1}</p>
            <div className="grid grid-cols-7 gap-1">
              {days.slice(week * 7, week * 7 + 7).map((d, j) => {
                const i = week * 7 + j;
                return (
                  <label
                    key={d}
                    title={dayLabel(d)}
                    className="flex flex-col items-center justify-center gap-0.5 min-h-11 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-1 py-1.5 text-[11px] text-[var(--muted)] cursor-pointer select-none has-[:checked]:border-[var(--primary)] has-[:checked]:bg-[var(--primary-light)] has-[:checked]:text-[var(--primary)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--primary)]"
                  >
                    <input type="checkbox" className="sr-only" checked={chosen.has(i)} onChange={() => toggle(i)} aria-label={dayLabel(d)} />
                    <span className="font-semibold uppercase text-[10px]">{weekdayShort(d)}</span>
                    <span className="font-bold">{dayOfMonth(d)}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </fieldset>
    </Dialog>
  );
}
