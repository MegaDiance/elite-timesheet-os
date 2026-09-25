import { useState } from 'react';
import { Check } from 'lucide-react';
import { Dialog, buttonClass } from './Dialog';
import { skipReason, apiErrorMessage } from './api';
import { dayLabel, dayOfMonth, isWeekendIso, weekdayShort } from './dates';
import { BREAK_LENGTHS, breakChoiceLabel, breakFromChoice, type BreakChoice } from './day';

interface ApplyBreakDialogProps {
  /** "Apply Break" starts every day unticked; "Apply Break to All Days" starts every day ticked. */
  startAllChecked: boolean;
  worker: { id: string; full_name: string };
  days: string[];
  onClose: () => void;
  /** Calls POST /records/apply-break and resolves with { applied, skipped }. */
  onConfirm: (recordDates: string[], brk: { has_break: boolean; break_mins: number | null }) => Promise<{ applied: string[]; skipped: Array<{ date: string; reason: string }> }>;
  onApplied: () => void;
}

/**
 * "Apply break to all days" / "Apply break to chosen days": tick the days that should have the unpaid break
 * rule applied (or, starting from every day ticked, untick the exceptions), for one worker's
 * fortnight. Mirrors DayPickerDialog's day-grid, scoped to a single worker instead of a branch.
 */
export default function ApplyBreakDialog({ startAllChecked, worker, days, onClose, onConfirm, onApplied }: ApplyBreakDialogProps) {
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(startAllChecked ? days.map((_, i) => i) : []));
  const [choice, setChoice] = useState<BreakChoice>('standard');
  const hasBreak = choice !== 'none';
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
      const res = await onConfirm(chosenDates, breakFromChoice(choice));
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
      title={`${startAllChecked ? 'Apply break to all days' : 'Apply break to chosen days'} · ${worker.full_name}`}
      description={startAllChecked ? 'Every day is ticked. Untick the days that are different — those keep their current break.' : 'Tick the days that should get this break.'}
      onClose={onClose}
      closeDisabled={busy}
      size="md"
      footer={
        <div className="flex flex-col gap-2">
          {error && <p role="alert" className="text-xs font-semibold text-[var(--danger)]">{error}</p>}
          {result && (
            <div className="text-sm" aria-live="polite">
              <p className="font-semibold text-[var(--text)]">{result.applied.length} day{result.applied.length === 1 ? '' : 's'} updated.</p>
              {(() => {
                // Days with no shift are expected; say so once. Anything else is listed day by day.
                const empty = result.skipped.filter(s => s.reason === 'NOTHING_TO_CHANGE' || s.reason === 'NO_SHIFT');
                const problems = result.skipped.filter(s => !empty.includes(s));
                return (
                  <>
                    {empty.length > 0 && <p className="text-[var(--muted)] mt-1">{empty.length} day{empty.length === 1 ? ' has' : 's have'} no work shift, so nothing changed there.</p>}
                    {problems.length > 0 && (
                      <>
                        <p className="text-[var(--text)] font-semibold mt-1">Not changed:</p>
                        <ul className="list-disc pl-5 text-[var(--muted)]">
                          {problems.map(s => <li key={s.date}>{dayLabel(s.date)}: {skipReason(s.reason)}</li>)}
                        </ul>
                      </>
                    )}
                  </>
                );
              })()}
            </div>
          )}
          {!result && (
            <p className="text-xs text-[var(--muted)]" aria-live="polite">
              {chosen.size} of {days.length} days chosen{chosen.size < days.length && chosen.size > 0 ? ` · ${days.length - chosen.size} left as they are` : ''}
            </p>
          )}
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
      <label className="block mb-3">
        <span className="block text-xs font-semibold text-[var(--text)] mb-1.5">Break for the chosen days</span>
        <select
          value={choice}
          onChange={e => setChoice(e.target.value as BreakChoice)}
          className="w-full min-h-11 md:min-h-9 px-2 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] text-sm md:text-xs text-[var(--text)] cursor-pointer"
        >
          {(['standard', ...BREAK_LENGTHS.map(m => `${m}`), 'none'] as BreakChoice[]).map(c => (
            <option key={c} value={c}>{breakChoiceLabel(c)}</option>
          ))}
        </select>
        <span className="block mt-1 text-[11px] text-[var(--muted)]">Applies to the Normal Work shifts on each chosen day, rostered and worked. Leave is never changed.</span>
      </label>

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
                    className="flex flex-col items-center justify-center gap-0.5 min-h-11 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-1 py-1.5 text-[11px] text-[var(--muted)] cursor-pointer select-none has-[:checked]:border-[var(--primary)] has-[:checked]:bg-[var(--primary-light)] has-[:checked]:text-[var(--primary-text)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--primary)]"
                  >
                    <input type="checkbox" className="sr-only" checked={chosen.has(i)} onChange={() => toggle(i)} aria-label={dayLabel(d)} />
                    <span className="font-semibold uppercase text-[10px]">{weekdayShort(d)}</span>
                    <span className="font-bold">{dayOfMonth(d)}</span>
                    {chosen.has(i)
                      ? <Check className="w-3 h-3" aria-hidden="true" />
                      : <span className="text-[9px] leading-3" aria-hidden="true">no change</span>}
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
