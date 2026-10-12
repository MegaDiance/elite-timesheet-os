import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Mail, Send, UserPlus } from 'lucide-react';
import api from '../../services/apiClient';
import { accessError } from './accessError';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import ScopePicker from './ScopePicker';
import { choiceFromScope, initialScope, scopeProblem } from './scopeHelpers';
import {
  isAssignable, personName, roleScopeTraits, scopeBody,
  type Assignment, type PermissionGroup, type RoleSummary, type ScopeChoice, type TeamMember,
} from './types';

type Branches = Array<{ id: string; name: string }>;

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="p-3 rounded-md text-xs bg-[var(--danger-light)] border border-[var(--danger)]/30 text-[var(--danger)]">
      {message}
    </div>
  );
}

function Footer({ onCancel, busy, submitLabel, icon }: { onCancel: () => void; busy: boolean; submitLabel: string; icon?: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--border)]">
      <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
      <Button type="submit" variant="primary" size="sm" loading={busy} leftIcon={icon}>{submitLabel}</Button>
    </div>
  );
}

/**
 * The scope after switching roles: organisation-only roles are forced to the entire organisation;
 * moving off one goes back to "nothing chosen"; otherwise the person's choice is kept.
 */
function scopeAfterRoleChange(prev: RoleSummary | undefined, next: RoleSummary | undefined, catalogue: PermissionGroup[], scope: ScopeChoice): ScopeChoice {
  const nextOnly = next ? roleScopeTraits(next, catalogue).entireOnly : false;
  const prevOnly = prev ? roleScopeTraits(prev, catalogue).entireOnly : false;
  if (nextOnly) return { mode: 'all', branchIds: [] };
  if (prevOnly) return { mode: null, branchIds: [] };
  return scope;
}

/** The role's own scope hint: forces the entire organisation for organisation-only roles. */
function useRoleScope(role: RoleSummary | undefined, catalogue: PermissionGroup[]) {
  const traits = useMemo(() => (role ? roleScopeTraits(role, catalogue) : { entireOnly: false, mixed: false }), [role, catalogue]);
  return traits;
}

interface AssignProps {
  /** Give this person another role, or add a person to this role. */
  target: { kind: 'person'; person: TeamMember } | { kind: 'role'; role: RoleSummary };
  roles: RoleSummary[];
  people: TeamMember[];
  catalogue: PermissionGroup[];
  branches: Branches;
  onClose: () => void;
  onSaved: (message: string) => void;
  /** From the "add member" dialog: invite someone who isn't on the team yet. */
  onInviteInstead?: () => void;
}

export function AssignRoleModal({ target, roles, people, catalogue, branches, onClose, onSaved, onInviteInstead }: AssignProps) {
  const [roleId, setRoleId] = useState(target.kind === 'role' ? target.role.id : '');
  const [userId, setUserId] = useState(target.kind === 'person' ? target.person.user_id : '');
  const [scope, setScope] = useState<ScopeChoice>(() => initialScope(target.kind === 'role' ? roleScopeTraits(target.role, catalogue).entireOnly : false));
  const [error, setError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const role = roles.find(r => r.id === roleId);
  const { entireOnly, mixed } = useRoleScope(role, catalogue);

  const roleOptions = useMemo(() => {
    if (target.kind !== 'person') return [];
    const held = new Set(target.person.assignments.map(a => a.role_id));
    return roles.filter(r => isAssignable(r) && !held.has(r.id));
  }, [target, roles]);

  const personOptions = useMemo(() => {
    if (target.kind !== 'role') return [];
    return people.filter(p => !p.is_owner && !p.is_self && !p.assignments.some(a => a.role_id === target.role.id));
  }, [target, people]);

  const chooseRole = (id: string) => {
    setRoleId(id);
    setError(null);
    setScopeError(null);
    setScope(scopeAfterRoleChange(role, roles.find(r => r.id === id), catalogue, scope));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!userId) { setError('Choose a person.'); return; }
    if (!roleId) { setError('Choose a role.'); return; }
    const problem = scopeProblem(scope, entireOnly);
    if (problem) { setScopeError(problem); return; }
    setScopeError(null);
    setBusy(true);
    try {
      const res = await api.post(`/team/${userId}/roles`, { role_id: roleId, scope: scopeBody(scope) });
      onSaved(res.data?.message || 'Role added');
    } catch (err) {
      setError(accessError(err, 'Couldn’t add role. Try again.'));
      setBusy(false);
    }
  };

  const title = target.kind === 'person' ? `Add a role for ${personName(target.person)}` : `Add a member to ${target.role.name}`;

  return (
    <Modal isOpen onClose={busy ? () => undefined : onClose} title={title} maxWidth="md">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={error} />
        {target.kind === 'person' ? (
          roleOptions.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{personName(target.person)} already has every available role. To change where one applies, use their row.</p>
          ) : (
            <Select id="assign-role" label="Role" value={roleId} onChange={e => chooseRole(e.target.value)} required>
              <option value="">Choose a role</option>
              {roleOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          )
        ) : personOptions.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-[var(--muted)]">Everyone eligible already has this role.</p>
            {onInviteInstead && <Button type="button" variant="outline" size="sm" onClick={onInviteInstead} leftIcon={<UserPlus className="w-3.5 h-3.5" />}>Invite someone new</Button>}
          </div>
        ) : (
          <div className="space-y-1.5">
            <Select id="assign-person" label="Person" value={userId} onChange={e => setUserId(e.target.value)} required>
              <option value="">Choose a person</option>
              {personOptions.map(p => <option key={p.user_id} value={p.user_id}>{personName(p)}{p.full_name ? ` (${p.email})` : ''}</option>)}
            </Select>
            {onInviteInstead && (
              <button type="button" onClick={onInviteInstead} className="text-xs font-semibold text-[var(--primary-text)] hover:underline cursor-pointer">
                Not on the list? Invite someone new
              </button>
            )}
          </div>
        )}

        {(target.kind === 'role' || roleId) && (
          <ScopePicker value={scope} onChange={s => { setScope(s); setScopeError(null); }} branches={branches} entireOnly={entireOnly} mixedNote={mixed} error={scopeError} />
        )}
        <Footer onCancel={onClose} busy={busy} submitLabel="Add role" />
      </form>
    </Modal>
  );
}

interface ChangeProps {
  personName: string;
  userId: string;
  assignment: Assignment;
  role: RoleSummary | undefined;
  catalogue: PermissionGroup[];
  branches: Branches;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function ChangeScopeModal({ personName: who, userId, assignment, role, catalogue, branches, onClose, onSaved }: ChangeProps) {
  const [scope, setScope] = useState<ScopeChoice>(() => choiceFromScope(assignment.scope));
  const [error, setError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { entireOnly, mixed } = useRoleScope(role, catalogue);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = scopeProblem(scope, entireOnly);
    if (problem) { setScopeError(problem); return; }
    setBusy(true);
    try {
      const res = await api.put(`/team/${userId}/roles/${assignment.id}`, { scope: scopeBody(scope) });
      onSaved(res.data?.message || 'Access updated');
    } catch (err) {
      setError(accessError(err, 'Couldn’t update where the role applies. Try again.'));
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={busy ? () => undefined : onClose} title={`Where ${assignment.role_name} applies`} description={`For ${who}`} maxWidth="md">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={error} />
        <ScopePicker value={scope} onChange={s => { setScope(s); setScopeError(null); }} branches={branches} entireOnly={entireOnly} mixedNote={mixed} error={scopeError} />
        <Footer onCancel={onClose} busy={busy} submitLabel="Save" />
      </form>
    </Modal>
  );
}

interface InviteProps {
  roles: RoleSummary[];
  catalogue: PermissionGroup[];
  branches: Branches;
  presetRoleId?: string;
  onClose: () => void;
  /** Called with what the server said, and the link when email is off. */
  onInvited: (result: { email: string; message: string; link: string | null; failed: boolean }) => void;
}

export function InviteModal({ roles, catalogue, branches, presetRoleId, onClose, onInvited }: InviteProps) {
  const assignable = useMemo(() => roles.filter(isAssignable), [roles]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState(presetRoleId ?? '');
  const [scope, setScope] = useState<ScopeChoice>(() => {
    const preset = roles.find(r => r.id === presetRoleId);
    return initialScope(preset ? roleScopeTraits(preset, catalogue).entireOnly : false);
  });
  const [error, setError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const role = roles.find(r => r.id === roleId);
  const { entireOnly, mixed } = useRoleScope(role, catalogue);

  const chooseRole = (id: string) => {
    setRoleId(id);
    setScopeError(null);
    setScope(scopeAfterRoleChange(role, roles.find(r => r.id === id), catalogue, scope));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
    if (!roleId) { setError('Choose a role.'); return; }
    const problem = scopeProblem(scope, entireOnly);
    if (problem) { setScopeError(problem); return; }
    setBusy(true);
    try {
      const res = await api.post('/team/invitations', {
        email: email.trim(),
        full_name: name.trim() || undefined,
        role_id: roleId,
        scope: scopeBody(scope),
      });
      onInvited({
        email: email.trim(),
        message: res.data?.message || `Invitation created for ${email.trim()}`,
        link: res.data?.data?.invite_link ?? null,
        failed: res.data?.data?.delivery_status === 'failed',
      });
    } catch (err) {
      setError(accessError(err, 'Couldn’t create invitation. Try again.'));
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={busy ? () => undefined : onClose}
      title="Invite a person"
      description="They get an invitation link, valid for 7 days. If email is off, you share the link yourself."
      maxWidth="md"
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={error} />
        <Input id="invite-email" label="Email address" type="email" placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)} leftIcon={<Mail className="w-4 h-4" />} autoFocus autoComplete="off" />
        <Input id="invite-name" label="Name (optional)" placeholder="e.g. Sam Nguyen" value={name} onChange={e => setName(e.target.value)} maxLength={120} autoComplete="off" />
        <Select id="invite-role" label="Role" value={roleId} onChange={e => chooseRole(e.target.value)}>
          <option value="">Choose a role</option>
          {assignable.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        {roleId && <ScopePicker value={scope} onChange={s => { setScope(s); setScopeError(null); }} branches={branches} entireOnly={entireOnly} mixedNote={mixed} error={scopeError} />}
        <Footer onCancel={onClose} busy={busy} submitLabel="Send invitation" icon={<Send className="w-3.5 h-3.5" />} />
      </form>
    </Modal>
  );
}

interface BulkProps {
  people: TeamMember[];
  roles: RoleSummary[];
  catalogue: PermissionGroup[];
  branches: Branches;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** One role, with one "where it applies", for several people at once. All or nothing on the server. */
export function BulkAssignModal({ people, roles, catalogue, branches, onClose, onSaved }: BulkProps) {
  const [roleId, setRoleId] = useState('');
  const [scope, setScope] = useState<ScopeChoice>(() => initialScope(false));
  const [error, setError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const role = roles.find(r => r.id === roleId);
  const { entireOnly, mixed } = useRoleScope(role, catalogue);
  const options = roles.filter(r => isAssignable(r));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!roleId) { setError('Choose a role.'); return; }
    const problem = scopeProblem(scope, entireOnly);
    if (problem) { setScopeError(problem); return; }
    setBusy(true);
    try {
      const res = await api.post('/team/bulk-assign', { user_ids: people.map(p => p.user_id), role_id: roleId, scope: scopeBody(scope) });
      onSaved(res.data?.message || 'Role given');
    } catch (err) {
      setError(accessError(err, 'Couldn’t give the role. Nobody was changed.'));
      setBusy(false);
    }
  };

  const names = people.map(personName);
  return (
    <Modal
      isOpen
      onClose={busy ? () => undefined : onClose}
      title={`Give a role to ${people.length} ${people.length === 1 ? 'person' : 'people'}`}
      description={names.length <= 4 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`}
      maxWidth="md"
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={error} />
        <Select id="bulk-role" label="Role" value={roleId} onChange={e => {
          const next = roles.find(r => r.id === e.target.value);
          setScope(scopeAfterRoleChange(role, next, catalogue, scope));
          setRoleId(e.target.value);
          setScopeError(null);
        }} required>
          <option value="">Choose a role</option>
          {options.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        {roleId && (
          <ScopePicker value={scope} onChange={s => { setScope(s); setScopeError(null); }} branches={branches} entireOnly={entireOnly} mixedNote={mixed} error={scopeError} />
        )}
        <p className="text-xs text-[var(--muted)]">Anyone who already has this role keeps it as it is.</p>
        <Footer onCancel={onClose} busy={busy} submitLabel="Give role" />
      </form>
    </Modal>
  );
}
