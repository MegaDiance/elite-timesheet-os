import { useState } from 'react';
import { Dialog, buttonClass } from './Dialog';
import { dayLabel, dayOfMonth, isWeekendIso, weekdayShort } from './dates';

export type BulkFillMode = 'roster' | 'log';

interface DayPickerDialogProps {
  mode: BulkFillMode;
  days: string[];
  /** e.g. "Main Street" or "all your branches". */
  scopeText: string;
  busy: boolean;
  onConfirm: (dayIndexes: number[]) => void;
  onClose: () => void;
}

const TEXT: Record<BulkFillMode, { title: string; body: string; action: string }> = {
  roster: {
    title: 'Auto-Roster',
    body: 'Applies each worker’s default roster template to the chosen days. Worked hours are kept. Branches with a locked roster and approved timesheets are skipped.',
    action: 'Apply templates',
  },
  log: {
    title: 'Auto-Log',
    body: 'Copies rostered times into worked hours on the chosen days. Only segments with no worked hours are filled; hours already recorded are never overwritten. Branches with locked timesheets and approved timesheets are skipped.',
    action: 'Copy roster to worked hours',
  },
};

/** Chooses the days of the pay period for Auto-Roster or Auto-Log. */
export default function DayPickerDialog({ mode, days, scopeText, busy, onConfirm, onClose }: DayPickerDialogProps) {
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(days.map((_, i) => i)));
  const text = TEXT[mode];

  const toggle = (i: number) =>
    setChosen(set => {
      const next = new Set(set);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });

  return (
    <Dialog
      title={`${text.title} · ${scopeText}`}
      onClose={onClose}
      closeDisabled={busy}
      size="md"
      footer={
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <p className="text-xs text-[var(--muted)]" aria-live="polite">{chosen.size} of {days.length} days chosen</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={buttonClass.secondary}>Cancel</button>
            <button
              type="button"
              disabled={chosen.size === 0 || busy}
              onClick={() => onConfirm([...chosen].sort((a, b) => a - b))}
              className={buttonClass.primary}
            >
              {busy ? 'Working…' : text.action}
            </button>
          </div>
        </div>
      }
    >
      <p className="text-xs text-[var(--muted)] mb-3">{text.body}</p>
      <div className="flex gap-1 mb-2">
        <button type="button" className={buttonClass.quiet} onClick={() => setChosen(new Set(days.map((_, i) => i)))}>All days</button>
        <button type="button" className={buttonClass.quiet} onClick={() => setChosen(new Set(days.flatMap((d, i) => (isWeekendIso(d) ? [] : [i]))))}>Weekdays</button>
        <button type="button" className={buttonClass.quiet} onClick={() => setChosen(new Set())}>None</button>
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
                    className="flex flex-col items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-1 py-1.5 text-[11px] text-[var(--muted)] cursor-pointer select-none has-[:checked]:border-[var(--primary)] has-[:checked]:bg-[var(--primary-light)] has-[:checked]:text-[var(--primary)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--primary)]"
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
