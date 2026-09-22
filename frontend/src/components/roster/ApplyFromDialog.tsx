import { useId, useState } from 'react';
import { DayChips } from './DayChips';
import { Dialog, buttonClass } from './Dialog';
import { dayLabel } from './dates';
import { apiHasRoster, type ApiSegment } from './segments';

interface ApplyFromDialogProps {
  workers: { id: string; full_name: string }[];
  days: string[];
  defaultWorkerId: string;
  segmentsFor: (workerId: string, dateIso: string) => ApiSegment[];
  targetCount: number;
  busy: boolean;
  onApply: (workerId: string, dateIso: string) => void;
  onClose: () => void;
}

/** Chooses the day whose rostered segments are applied to every selected cell. */
export default function ApplyFromDialog({ workers, days, defaultWorkerId, segmentsFor, targetCount, busy, onApply, onClose }: ApplyFromDialogProps) {
  const workerFieldId = useId();
  const dayFieldId = useId();
  const [workerId, setWorkerId] = useState(defaultWorkerId);
  const [dateIso, setDateIso] = useState(() => days.find(d => segmentsFor(defaultWorkerId, d).some(apiHasRoster)) ?? days[0]);

  const segments = segmentsFor(workerId, dateIso);
  const hasRoster = segments.some(apiHasRoster);

  return (
    <Dialog
      title="Apply segments from…"
      description={`The rostered segments you choose are copied to the ${targetCount} selected day${targetCount === 1 ? '' : 's'}.`}
      onClose={onClose}
      closeDisabled={busy}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={buttonClass.secondary}>Cancel</button>
          <button type="button" disabled={!hasRoster || busy} onClick={() => onApply(workerId, dateIso)} className={buttonClass.primary}>
            {busy ? 'Applying…' : `Apply to ${targetCount} day${targetCount === 1 ? '' : 's'}`}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label htmlFor={workerFieldId} className="block font-semibold text-[var(--text)] mb-1">Worker</label>
            <select
              id={workerFieldId}
              value={workerId}
              onChange={e => setWorkerId(e.target.value)}
              className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--primary)]"
            >
              {workers.map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={dayFieldId} className="block font-semibold text-[var(--text)] mb-1">Day</label>
            <select
              id={dayFieldId}
              value={dateIso}
              onChange={e => setDateIso(e.target.value)}
              className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--primary)]"
            >
              {days.map(d => (
                <option key={d} value={d}>
                  {dayLabel(d)}{segmentsFor(workerId, d).some(apiHasRoster) ? '' : ' (nothing rostered)'}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-subtle)] p-2.5" aria-live="polite">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)] mb-1.5">Rostered on that day</p>
          {hasRoster ? (
            <div className="flex flex-wrap gap-1"><DayChips segments={segments} side="roster" size="regular" /></div>
          ) : (
            <p className="text-[var(--muted)]">Nothing is rostered on that day. Choose another day.</p>
          )}
        </div>
        <p className="text-[11px] text-[var(--muted)]">
          Only rostered times are copied. Days that already have worked hours, approved timesheets or a locked roster are skipped and listed.
        </p>
      </div>
    </Dialog>
  );
}
