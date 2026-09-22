import { useId, useState, type FormEvent } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import api from '../../services/apiClient';
import { Dialog, buttonClass, inputClass } from './Dialog';
import { apiErrorMessage, type LockRow } from './api';

export type LockFlag = 'roster' | 'timesheet';

interface LockDialogProps {
  flag: LockFlag;
  startDate: string;
  periodText: string;
  /** Branches the user may lock. */
  branches: { id: string; name: string }[];
  /** The branch chosen in the page filter, or null when "All my branches" is selected. */
  fixedBranchId: string | null;
  lockFor: (branchId: string) => LockRow | undefined;
  onClose: () => void;
  onChanged: (row: LockRow) => void;
}

const FLAG_TEXT: Record<LockFlag, { name: string; lockEffect: string; passwordHint: string }> = {
  roster: {
    name: 'Roster',
    lockEffect: 'Rostered times for this branch and pay period can’t change while the roster is locked. Worked hours can still be recorded.',
    passwordHint: 'Your own password, or the organisation’s roster lock password.',
  },
  timesheet: {
    name: 'Timesheets',
    lockEffect: 'Worked hours for this branch and pay period can’t change, and timesheets can’t be approved or reopened, while timesheets are locked.',
    passwordHint: 'Your own password, or the organisation’s timesheet lock password.',
  },
};

/** Locks or unlocks one flag for one branch and pay period (POST /locks). A wrong password never signs anyone out. */
export default function LockDialog({ flag, startDate, periodText, branches, fixedBranchId, lockFor, onClose, onChanged }: LockDialogProps) {
  const branchFieldId = useId();
  const passwordId = useId();
  const [branchId, setBranchId] = useState(fixedBranchId ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const text = FLAG_TEXT[flag];
  const branch = branches.find(b => b.id === branchId);
  const lock = branchId ? lockFor(branchId) : undefined;
  const locked = Boolean(flag === 'roster' ? lock?.roster_locked : lock?.timesheet_locked);
  const verb = locked ? 'Unlock' : 'Lock';

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!branchId || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/locks', {
        location_id: branchId,
        start_date: startDate,
        [flag === 'roster' ? 'roster_locked' : 'timesheet_locked']: !locked,
        password,
      });
      onChanged(res.data.data as LockRow);
      onClose();
    } catch (err) {
      setPassword('');
      setError(apiErrorMessage(err, `The ${text.name.toLowerCase()} lock could not be changed.`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={branch ? `${verb} ${text.name.toLowerCase()} · ${branch.name}` : `${text.name} lock`}
      description={periodText}
      onClose={onClose}
      closeDisabled={busy}
      size="sm"
      onSubmit={submit}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={buttonClass.secondary}>Cancel</button>
          <button type="submit" disabled={!branchId || !password || busy} className={buttonClass.primary}>
            {locked ? <LockOpen className="w-3.5 h-3.5" aria-hidden="true" /> : <Lock className="w-3.5 h-3.5" aria-hidden="true" />}
            {busy ? 'Saving…' : branch ? `${verb} ${text.name.toLowerCase()}` : 'Choose a branch'}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-xs">
        {fixedBranchId === null && (
          <div>
            <label htmlFor={branchFieldId} className="block font-semibold text-[var(--text)] mb-1">Branch</label>
            <select
              id={branchFieldId}
              value={branchId}
              onChange={e => { setBranchId(e.target.value); setError(null); }}
              className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-2 text-xs text-[var(--text)] outline-none focus:border-[var(--primary)]"
            >
              <option value="">Choose a branch…</option>
              {branches.map(b => {
                const row = lockFor(b.id);
                const isLocked = flag === 'roster' ? row?.roster_locked : row?.timesheet_locked;
                return <option key={b.id} value={b.id}>{b.name} — {isLocked ? 'locked' : 'open'}</option>;
              })}
            </select>
            <p className="mt-1 text-[11px] text-[var(--muted)]">Locks apply to one branch at a time.</p>
          </div>
        )}

        {branch && (
          <p className="text-[var(--text)]">
            {text.name} for <strong>{branch.name}</strong> {flag === 'roster' ? 'is' : 'are'}{' '}
            <strong className={locked ? 'text-[var(--warn)]' : 'text-[var(--success)]'}>{locked ? 'locked' : 'open'}</strong>.{' '}
            <span className="text-[var(--muted)]">{text.lockEffect}</span>
          </p>
        )}

        <div>
          <label htmlFor={passwordId} className="block font-semibold text-[var(--text)] mb-1">Password</label>
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={e => { setPassword(e.target.value); setError(null); }}
            className={`${inputClass} w-full py-2`}
            aria-describedby={`${passwordId}-hint`}
            aria-invalid={error ? true : undefined}
          />
          <p id={`${passwordId}-hint`} className="mt-1 text-[11px] text-[var(--muted)]">{text.passwordHint}</p>
        </div>

        {error && <p role="alert" className="font-semibold text-[var(--danger)]">{error}</p>}
      </div>
    </Dialog>
  );
}
