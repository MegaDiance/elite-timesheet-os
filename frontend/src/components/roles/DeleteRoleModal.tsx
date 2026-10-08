import { useState, type FormEvent } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { pluralPeople, type RoleSummary } from './types';

interface Props {
  role: RoleSummary;
  /** Roles people can be moved to (never Owner or Employee, never this one). */
  otherRoles: RoleSummary[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (members?: { members: 'move' | 'remove'; move_to_role_id?: string }) => void;
}

/**
 * Deleting a role never silently leaves people without it: when people hold it, the owner
 * chooses to move them to another role (kept where they had this one) or to take it away.
 */
export default function DeleteRoleModal({ role, otherRoles, busy, onCancel, onConfirm }: Props) {
  const held = role.member_count > 0;
  const [choice, setChoice] = useState<'move' | 'remove'>('move');
  const [target, setTarget] = useState(otherRoles[0]?.id ?? '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!held) onConfirm();
    else if (choice === 'move') onConfirm({ members: 'move', move_to_role_id: target });
    else onConfirm({ members: 'remove' });
  };

  return (
    <Modal isOpen onClose={busy ? () => undefined : onCancel} title={`Delete the ${role.name} role?`} maxWidth="md">
      <form onSubmit={submit} className="space-y-4">
        {held ? (
          <fieldset className="space-y-2">
            <legend className="text-sm text-[var(--text)] mb-2">
              {pluralPeople(role.member_count)} {role.member_count === 1 ? 'has' : 'have'} this role. What should happen to them?
            </legend>
            <label className="flex items-start gap-3 p-3 rounded-md border border-[var(--border)] cursor-pointer">
              <input type="radio" name="members" className="mt-1" checked={choice === 'move'} onChange={() => setChoice('move')} disabled={otherRoles.length === 0} />
              <span className="flex-1 min-w-0 space-y-2">
                <span className="block text-sm font-medium text-[var(--text)]">Give them another role instead</span>
                <span className="block text-xs text-[var(--muted)]">It applies where this role applied for each person.</span>
                {choice === 'move' && otherRoles.length > 0 && (
                  <Select
                    aria-label="Role to move them to"
                    value={target}
                    onChange={e => setTarget(e.target.value)}
                    options={otherRoles.map(r => ({ value: r.id, label: r.name }))}
                  />
                )}
              </span>
            </label>
            <label className="flex items-start gap-3 p-3 rounded-md border border-[var(--border)] cursor-pointer">
              <input type="radio" name="members" className="mt-1" checked={choice === 'remove'} onChange={() => setChoice('remove')} />
              <span>
                <span className="block text-sm font-medium text-[var(--text)]">Take the role away</span>
                <span className="block text-xs text-[var(--muted)]">They keep their other roles. Employees keep the employee portal. Anyone left with no access is signed out.</span>
              </span>
            </label>
          </fieldset>
        ) : (
          <p className="text-sm text-[var(--muted)]">Nobody has this role. This can’t be undone.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="danger" size="sm" loading={busy} disabled={held && choice === 'move' && !target}>Delete role</Button>
        </div>
      </form>
    </Modal>
  );
}
