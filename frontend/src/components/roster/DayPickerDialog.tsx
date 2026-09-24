import { useState } from 'react';
import { Dialog, buttonClass } from './Dialog';
import { dayLabel, dayOfMonth, describeDays, isWeekendIso, weekdayShort } from './dates';

export type BulkFillMode = 'roster' | 'log';

interface DayPickerDialogProps {
  mode: BulkFillMode;
  days: string[];
  /** Who it applies to, e.g. "all workers in Melbourne". */
  scopeText: string;
  busy: boolean;
  onConfirm: (dayIndexes: number[]) => void;
  onClose: () => void;
}

const TEXT: Record<BulkFillMode, { title: string; body: string }> = {
  roster: {
    title: 'Apply default rosters',
    body: 'Each worker’s default roster (set on the Workers page) replaces the Normal Work rostered on the chosen days; days their default leaves empty are left alone. Workers without a default roster get 9:00 am – 5:00 pm. Leave is never replaced: shifts are fitted around part-day leave, and whole days of leave are kept as they are. Worked hours and notes are kept. Branches with a locked roster and approved timesheets are skipped.',
  },
  log: {
    title: 'Copy roster to worked hours',
    body: 'Records the whole rostered day, leave included, as worked on the chosen days. Days that already have any worked time are left as they are, so recorded hours are never changed. The roster itself is not changed. Branches with locked timesheets and approved timesheets are skipped.',
  },
};

/**
 * Confirms a bulk action for the whole branch filter: every worker in scope, on the days chosen
 * here. The confirm button states exactly who and which days, e.g.
 * "Apply default rosters — all workers in Melbourne (Mon 30 Mar – Fri 3 Apr)".
 */
export default function DayPickerDialog({ mode, days, scopeText, busy, onConfirm, onClose }: DayPickerDialogProps) {
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(days.map((_, i) => i)));
  const text = TEXT[mode];
  const chosenIndexes = [...chosen].sort((a, b) => a - b);
  const action = `${text.title} — ${scopeText} (${describeDays(chosenIndexes.map(i => days[i]))})`;

  const toggle = (i: number) =>
    setChosen(set => {
      const next = new Set(set);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });

  return (
    <Dialog
      title={`${text.title} — ${scopeText}`}
      onClose={onClose}
      closeDisabled={busy}
      size="md"
      footer={
        <div className="flex flex-col gap-2">
          <p className="text-xs text-[var(--muted)]" aria-live="polite">{chosen.size} of {days.length} days chosen</p>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={`${buttonClass.secondary} max-md:h-11`}>Cancel</button>
            <button
              type="button"
              disabled={chosen.size === 0 || busy}
              onClick={() => onConfirm(chosenIndexes)}
              className={`${buttonClass.primary} max-md:min-h-11 text-left whitespace-normal`}
            >
              {busy ? 'Working…' : action}
            </button>
          </div>
        </div>
      }
    >
      <p className="text-xs text-[var(--muted)] mb-3">{text.body}</p>
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
