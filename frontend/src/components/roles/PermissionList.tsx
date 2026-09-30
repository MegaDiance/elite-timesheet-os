import { Check, X } from 'lucide-react';
import { Badge } from '../ui/Badge';
import type { PermissionGroup } from './types';

interface Props {
  groups: PermissionGroup[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  readOnly: boolean;
}

/**
 * Permissions grouped by category. Each is a real checkbox with its label and description, so it
 * works with a keyboard and a screen reader. Read-only lists show a tick or a cross with words, so
 * meaning never depends on colour.
 */
export default function PermissionList({ groups, selected, onChange, readOnly }: Props) {
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  const setGroup = (group: PermissionGroup, on: boolean) => {
    const next = new Set(selected);
    for (const p of group.permissions) {
      if (on) next.add(p.key);
      else next.delete(p.key);
    }
    onChange(next);
  };

  return (
    <div className="space-y-5">
      {groups.map(group => {
        const count = group.permissions.filter(p => selected.has(p.key)).length;
        const allOn = count === group.permissions.length;
        return (
          <section key={group.category} aria-labelledby={`perm-${group.category}`}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <h4 id={`perm-${group.category}`} className="text-xs font-bold text-[var(--text)] uppercase tracking-wider">
                {group.category}
                <span className="ml-2 font-medium normal-case tracking-normal text-[var(--muted)]">{count} of {group.permissions.length}</span>
              </h4>
              {!readOnly && group.permissions.length > 1 && (
                <button
                  type="button"
                  onClick={() => setGroup(group, !allOn)}
                  className="text-xs font-semibold text-[var(--primary-text)] hover:underline cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                >
                  {allOn ? 'Clear' : 'Select all'}
                  <span className="sr-only"> {group.category} permissions</span>
                </button>
              )}
            </div>
            <ul className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
              {group.permissions.map(p => {
                const on = selected.has(p.key);
                return (
                  <li key={p.key}>
                    <label className={`flex items-start gap-3 px-3 py-2.5 ${readOnly ? '' : 'cursor-pointer hover:bg-[var(--hover-row)]'} has-[:focus-visible]:bg-[var(--hover-row)]`}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={readOnly}
                        onChange={() => toggle(p.key)}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 w-5 h-5 shrink-0 rounded flex items-center justify-center border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--primary)] peer-focus-visible:ring-offset-1 ${
                          on
                            ? readOnly
                              ? 'bg-[var(--success-light)] border-[var(--success)] text-[var(--success)]'
                              : 'bg-[var(--primary)] border-[var(--primary)] text-white'
                            : readOnly
                              ? 'border-[var(--border)] text-[var(--muted)]'
                              : 'border-[var(--border-hover)] bg-[var(--input-bg)]'
                        }`}
                      >
                        {on ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : readOnly ? <X className="w-3.5 h-3.5" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className={`text-sm font-medium ${on || !readOnly ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}>{p.label}</span>
                          {p.level === 'organisation' && <Badge variant="outline" size="sm" title="Only works when the role is given across the entire organisation">Whole organisation only</Badge>}
                        </span>
                        <span className="block text-xs text-[var(--muted)] leading-relaxed mt-0.5">{p.description}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
