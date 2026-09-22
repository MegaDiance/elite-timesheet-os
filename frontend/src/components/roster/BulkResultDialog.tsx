import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Dialog, buttonClass } from './Dialog';

export interface ResultProblem {
  label: string;
  detail: string;
}

export interface BulkResult {
  title: string;
  summary: string;
  problems: ResultProblem[];
  /** Heading above the problem list, e.g. "Skipped" or "Not approved". */
  problemHeading?: string;
  /** False when the action did nothing at all (the summary then carries a warning icon, not a tick). */
  anyDone?: boolean;
}

/** What a bulk action did, including every item it could not do and why. */
export function ResultSummary({ summary, problems, problemHeading = 'Not done', anyDone = true }: Omit<BulkResult, 'title'>) {
  return (
    <div role="status" className="space-y-2 text-xs">
      <p className="flex items-start gap-1.5 font-semibold text-[var(--text)]">
        {anyDone
          ? <CheckCircle2 className="w-4 h-4 shrink-0 text-[var(--success)]" aria-hidden="true" />
          : <AlertTriangle className="w-4 h-4 shrink-0 text-[var(--warn)]" aria-hidden="true" />}
        <span>{summary}</span>
      </p>
      {problems.length > 0 && (
        <div className="rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-light)] p-2.5">
          <p className="flex items-center gap-1.5 font-semibold text-[var(--warn)] mb-1">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            {problemHeading} ({problems.length})
          </p>
          <ul className="space-y-0.5 max-h-56 overflow-y-auto text-[var(--text)]">
            {problems.map((p, i) => (
              <li key={`${p.label}-${i}`}>
                <span className="font-semibold">{p.label}</span>
                <span className="text-[var(--muted)]"> — {p.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function BulkResultDialog({ result, onClose }: { result: BulkResult; onClose: () => void }) {
  return (
    <Dialog
      title={result.title}
      onClose={onClose}
      size="sm"
      footer={
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={buttonClass.primary}>Done</button>
        </div>
      }
    >
      <ResultSummary summary={result.summary} problems={result.problems} problemHeading={result.problemHeading} anyDone={result.anyDone} />
    </Dialog>
  );
}
