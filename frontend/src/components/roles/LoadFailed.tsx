import { AlertTriangle } from 'lucide-react';
import { Button } from '../ui/Button';

/** A failed load is never an empty state: say what failed, in plain words, and offer to try again. */
export default function LoadFailed({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="p-8 text-center bg-[var(--panel)] border border-[var(--danger)]/30 rounded-lg flex flex-col items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-[var(--danger-light)] text-[var(--danger)] flex items-center justify-center">
        <AlertTriangle className="w-5 h-5" aria-hidden="true" />
      </div>
      <div className="space-y-1 max-w-md">
        <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
        <p className="text-xs text-[var(--muted)] leading-relaxed">{message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
    </div>
  );
}
