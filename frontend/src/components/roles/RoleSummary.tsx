import { Check, X } from 'lucide-react';
import type { PermissionGroup } from './types';

/** The things people most often need to know a role does NOT allow, in this order. */
const NOTABLE: readonly string[] = [
  'timesheets.approve', 'timesheets.lock', 'payroll.export', 'employees.archive',
  'users.manage', 'roles.manage', 'branches.manage', 'organisation.edit', 'security.manage', 'audit.view',
];

interface Props {
  permissions: Set<string> | string[];
  catalogue: PermissionGroup[];
  /** Owner: everything, said plainly instead of listed. */
  everything?: boolean;
}

/**
 * A plain-language summary of a role: what it can do, grouped, and the important things it
 * cannot. Built from the same catalogue as the checkboxes, so it always matches them. Ticks and
 * crosses come with words, so meaning never depends on colour.
 */
export default function RoleSummary({ permissions, catalogue, everything = false }: Props) {
  const held = permissions instanceof Set ? permissions : new Set(permissions);
  const label = new Map<string, string>();
  for (const g of catalogue) for (const p of g.permissions) label.set(p.key, p.label);

  const can = catalogue
    .map(group => {
      const assignable = group.permissions.filter(p => p.assignable || held.has(p.key));
      const mine = assignable.filter(p => held.has(p.key));
      if (mine.length === 0) return null;
      return mine.length === assignable.length && assignable.length > 1
        ? `Everything in ${group.category}`
        : mine.map(p => p.label).join(', ');
    })
    .filter((line): line is string => line !== null);
  const cannot = NOTABLE.filter(key => label.has(key) && !held.has(key)).map(key => label.get(key)!);

  if (everything) {
    return (
      <p className="flex items-start gap-2 text-sm text-[var(--text)]">
        <Check className="w-4 h-4 mt-0.5 shrink-0 text-[var(--success)]" aria-hidden="true" />
        Everything, across the entire organisation.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 text-sm">
      <div>
        <h4 className="text-xs font-semibold text-[var(--muted)] mb-1.5">Can</h4>
        {can.length === 0 ? (
          <p className="text-[var(--muted)]">Nothing yet. Tick permissions below.</p>
        ) : (
          <ul className="space-y-1">
            {can.map(line => (
              <li key={line} className="flex items-start gap-2 text-[var(--text)]">
                <Check className="w-4 h-4 mt-0.5 shrink-0 text-[var(--success)]" aria-hidden="true" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {cannot.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-[var(--muted)] mb-1.5">Cannot</h4>
          <ul className="space-y-1">
            {cannot.map(line => (
              <li key={line} className="flex items-start gap-2 text-[var(--muted)]">
                <X className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="sm:col-span-2 text-xs text-[var(--muted)]">
        Applies only where it’s given to each person.
      </p>
    </div>
  );
}
