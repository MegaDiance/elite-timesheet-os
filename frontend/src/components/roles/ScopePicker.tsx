import { useId } from 'react';
import { Building2, Globe2 } from 'lucide-react';
import type { ScopeChoice } from './types';

interface Props {
  value: ScopeChoice;
  onChange: (next: ScopeChoice) => void;
  branches: Array<{ id: string; name: string }>;
  /** The role only holds organisation-level permissions, so it can't be limited to branches. */
  entireOnly?: boolean;
  /** The role also holds organisation-level permissions, which do nothing on chosen branches. */
  mixedNote?: boolean;
  error?: string | null;
  legend?: string;
}

/** "Where does this apply": the entire organisation, or chosen branches (at least one). */
export default function ScopePicker({ value, onChange, branches, entireOnly = false, mixedNote = false, error, legend = 'Where it applies' }: Props) {
  const uid = useId();
  const toggle = (id: string) =>
    onChange({ ...value, branchIds: value.branchIds.includes(id) ? value.branchIds.filter(x => x !== id) : [...value.branchIds, id] });
  const allSelected = branches.length > 0 && branches.every(b => value.branchIds.includes(b.id));

  const optionClass = (selected: boolean, disabled = false) =>
    `flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
      disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
    } ${selected ? 'border-[var(--primary)] bg-[var(--primary-light)]' : 'border-[var(--border)] hover:border-[var(--border-hover)]'}`;

  return (
    <fieldset className="space-y-2 min-w-0" aria-describedby={error ? `${uid}-error` : undefined}>
      <legend className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">{legend}</legend>

      <label className={optionClass(value.mode === 'all')}>
        <input
          type="radio"
          name={`${uid}-scope`}
          checked={value.mode === 'all'}
          onChange={() => onChange({ mode: 'all', branchIds: value.branchIds })}
          className="mt-0.5 accent-[var(--primary)] w-4 h-4 shrink-0"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--text)]"><Globe2 className="w-3.5 h-3.5 text-[var(--muted)]" aria-hidden="true" />Entire organisation</span>
          <span className="block text-xs text-[var(--muted)] mt-0.5">Every branch, including branches added later.</span>
        </span>
      </label>

      <label className={optionClass(value.mode === 'branches', entireOnly)}>
        <input
          type="radio"
          name={`${uid}-scope`}
          checked={value.mode === 'branches'}
          disabled={entireOnly}
          onChange={() => onChange({ mode: 'branches', branchIds: value.branchIds })}
          className="mt-0.5 accent-[var(--primary)] w-4 h-4 shrink-0"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--text)]"><Building2 className="w-3.5 h-3.5 text-[var(--muted)]" aria-hidden="true" />Selected branches</span>
          <span className="block text-xs text-[var(--muted)] mt-0.5">
            {entireOnly ? 'Not available: this role only works across the entire organisation.' : 'Only the branches you tick below.'}
          </span>
        </span>
      </label>

      {value.mode === 'branches' && !entireOnly && (
        <div className="space-y-2 pl-1">
          {branches.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">There are no active branches yet. Add a branch first, or choose the entire organisation.</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--muted)]">Choose at least one branch</span>
                {branches.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...value, branchIds: allSelected ? [] : branches.map(b => b.id) })}
                    className="text-xs font-semibold text-[var(--primary-text)] hover:underline cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                  >
                    {allSelected ? 'Clear all' : 'Select all'}
                  </button>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
                {branches.map(branch => (
                  <label key={branch.id} className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-[var(--text)] cursor-pointer hover:bg-[var(--hover-row)]">
                    <input
                      type="checkbox"
                      checked={value.branchIds.includes(branch.id)}
                      onChange={() => toggle(branch.id)}
                      className="w-4 h-4 rounded accent-[var(--primary)]"
                    />
                    <span className="font-medium">{branch.name}</span>
                  </label>
                ))}
              </div>
            </>
          )}
          {mixedNote && (
            <p className="text-xs text-[var(--muted)]">Organisation-level permissions in this role only apply when it is given across the entire organisation.</p>
          )}
        </div>
      )}

      {error && <p id={`${uid}-error`} role="alert" className="text-xs font-medium text-[var(--danger)]">{error}</p>}
    </fieldset>
  );
}
