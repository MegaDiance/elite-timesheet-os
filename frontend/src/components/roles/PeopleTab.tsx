import { useMemo, useState, type ReactNode } from 'react';
import { Building2, KeyRound, Pencil, Search, Send, UserMinus, UserPlus, Users, X } from 'lucide-react';
import api from '../../services/apiClient';
import { accessError } from './accessError';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { EmptyState } from '../ui/EmptyState';
import { HelpTip } from '../ui/HelpTip';
import { TableSkeleton } from '../ui/Skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/Table';
import { useToast } from '../ui/Toast';
import { AssignRoleModal, ChangeScopeModal } from './AssignModals';
import type { LinkToShare } from './CopyLinkModal';
import LoadFailed from './LoadFailed';
import type { Loadable } from './useRolesData';
import {
  formatDate, personName, scopeFullText, scopeText,
  type Assignment, type Invitation, type PermissionGroup, type RolesData, type TeamData, type TeamMember,
} from './types';

interface Props {
  team: Loadable<TeamData>;
  roles: RolesData | null;
  catalogue: PermissionGroup[] | null;
  onRetry: () => void;
  onChanged: () => void;
  onInvite: () => void;
  onShowLink: (link: LinkToShare) => void;
}

type Row = { kind: 'person'; member: TeamMember } | { kind: 'invite'; invitation: Invitation };

/** Where a role chip applies, as text. */
const chipScope = (scope: Assignment['scope']) => scopeText(scope);

function RoleChip({ tone = 'role', name, scope, full, onChange, onRemove, person }: {
  tone?: 'owner' | 'role' | 'pending';
  name: string;
  scope: string;
  full: string;
  onChange?: () => void;
  onRemove?: () => void;
  person: string;
}) {
  const toneClass = tone === 'owner'
    ? 'bg-[var(--primary-light)] border-[var(--primary)]/30 text-[var(--primary-text)]'
    : tone === 'pending'
      ? 'bg-transparent border-dashed border-[var(--border-hover)] text-[var(--text)]'
      : 'bg-[var(--panel-subtle)] border-[var(--border)] text-[var(--text)]';
  return (
    <span className={`inline-flex items-center max-w-full rounded-md border text-xs ${toneClass}`}>
      <span className="px-2 py-1 min-w-0" title={full}>
        <span className="font-semibold">{name}</span>
        <span aria-hidden="true" className="text-[var(--muted)]"> · </span>
        <span className="sr-only">, applies to </span>
        <span className="text-[var(--muted)]">{scope}</span>
        {scope !== full && <span className="sr-only"> ({full})</span>}
      </span>
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          aria-label={`Change where ${name} applies for ${person}`}
          title="Change where this applies"
          className="p-1.5 border-l border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-8)] cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
        >
          <Pencil className="w-3 h-3" aria-hidden="true" />
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name} from ${person}`}
          title="Remove this role"
          className="p-1.5 border-l border-[var(--border)] rounded-r-md text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-light)] cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
        >
          <X className="w-3 h-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

/**
 * "All branches", "Melbourne, Geelong" or "4 branches": where the person can work with branch data.
 * A role made only of organisation-level permissions doesn't give access to any branch's data.
 */
function branchAccess(member: TeamMember, givesBranchAccess: (roleId: string) => boolean): { text: string; full: string } {
  if (member.is_owner) return { text: 'All branches', full: 'All branches' };
  const relevant = member.assignments.filter(a => givesBranchAccess(a.role_id));
  if (relevant.some(a => a.scope.all)) return { text: 'All branches', full: 'All branches' };
  const names = new Set<string>();
  for (const a of relevant) for (const b of a.scope.branches) names.add(b.name);
  if (member.worker) names.add(member.worker.branch_name);
  const list = [...names].sort();
  if (list.length === 0) return { text: 'None', full: 'No branches' };
  return { text: list.length <= 3 ? list.join(', ') : `${list.length} branches`, full: list.join(', ') };
}

export default function PeopleTab({ team, roles, catalogue, onRetry, onChanged, onInvite, onShowLink }: Props) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<TeamMember | null>(null);
  const [changing, setChanging] = useState<{ member: TeamMember; assignment: Assignment } | null>(null);
  const [removingRole, setRemovingRole] = useState<{ member: TeamMember; assignment: Assignment } | null>(null);
  const [removingAll, setRemovingAll] = useState<TeamMember | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resetBusyId, setResetBusyId] = useState<string | null>(null);

  const data = team.data;
  const rolesReady = Boolean(roles && catalogue);

  const givesBranchAccess = (roleId: string): boolean => {
    const role = roles?.roles.find(r => r.id === roleId);
    if (!role || !catalogue) return true;
    const branchLevel = new Set(catalogue.flatMap(g => g.permissions).filter(p => p.level === 'branch').map(p => p.key));
    return role.permissions.some(key => branchLevel.has(key));
  };

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const all: Row[] = [
      ...data.members.map(member => ({ kind: 'person' as const, member })),
      ...data.invitations.map(invitation => ({ kind: 'invite' as const, invitation })),
    ];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(row => {
      const hay = row.kind === 'person'
        ? [row.member.full_name, row.member.email, row.member.is_owner ? 'owner' : '', row.member.worker ? 'employee' : '', ...row.member.assignments.map(a => a.role_name)]
        : [row.invitation.full_name, row.invitation.email, row.invitation.role_name, 'invited'];
      return hay.filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [data, search]);

  if (team.error) return <LoadFailed title="The people list could not be loaded" message={team.error} onRetry={onRetry} />;
  if (team.loading || !data) return <div aria-busy="true" aria-label="Loading people"><TableSkeleton rows={4} /></div>;

  const branches = data.branches;

  const removeRole = async () => {
    if (!removingRole) return;
    setBusy(true);
    try {
      const res = await api.delete(`/team/${removingRole.member.user_id}/roles/${removingRole.assignment.id}`);
      toast.success(res.data?.message || 'Role removed.');
      setRemovingRole(null);
      onChanged();
    } catch (err) {
      setRemovingRole(null);
      toast.error(accessError(err, 'The role could not be removed.'));
    } finally {
      setBusy(false);
    }
  };

  const removeAll = async () => {
    if (!removingAll) return;
    setBusy(true);
    try {
      const res = await api.delete(`/team/${removingAll.user_id}`);
      toast.success(res.data?.message || 'Access removed.');
      setRemovingAll(null);
      onChanged();
    } catch (err) {
      setRemovingAll(null);
      toast.error(accessError(err, 'Access could not be removed.'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      const res = await api.delete(`/team/invitations/${revoking.id}`);
      toast.success(res.data?.message || 'Invitation revoked.');
      setRevoking(null);
      onChanged();
    } catch (err) {
      setRevoking(null);
      toast.error(accessError(err, 'The invitation could not be revoked.'));
    } finally {
      setBusy(false);
    }
  };

  const resend = async (invitation: Invitation) => {
    setResendingId(invitation.id);
    try {
      const res = await api.post(`/team/invitations/${invitation.id}/resend`);
      const link = res.data?.data?.invite_link;
      if (link) {
        onShowLink({
          title: 'New invitation link',
          description: `Email is turned off. Copy this link and share it with ${invitation.email} yourself.`,
          url: link,
          note: 'It works once and expires in 7 days. The previous link no longer works.',
        });
      } else if (res.data?.success) {
        toast.success(res.data.message || 'Invitation re-sent.');
      } else {
        toast.error(res.data?.message || 'The email could not be delivered.');
      }
      onChanged();
    } catch (err) {
      toast.error(accessError(err, 'The invitation could not be re-sent.'));
    } finally {
      setResendingId(null);
    }
  };

  const resetLink = async (member: TeamMember) => {
    setResetBusyId(member.user_id);
    try {
      const res = await api.post(`/team/${member.user_id}/reset-password-link`);
      onShowLink({
        title: 'Password reset link',
        description: `Copy this link and share it with ${personName(member)} yourself, so they can choose a new password.`,
        url: res.data.data.reset_link,
        note: 'It works once and expires in 1 hour.',
      });
    } catch (err) {
      toast.error(accessError(err, 'A reset link could not be created.'));
    } finally {
      setResetBusyId(null);
    }
  };

  const afterAssign = (message: string) => {
    toast.success(message);
    setAdding(null);
    setChanging(null);
    onChanged();
  };

  const locked = (member: TeamMember) => member.is_self || member.is_owner;

  const lockedHelp = (member: TeamMember) => (
    <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
      {member.is_self ? 'You can’t change your own access' : 'The owner’s access is fixed'}
      <HelpTip label={member.is_self ? 'Your own access' : 'The owner’s access'} align="right">
        {member.is_self
          ? 'You can’t change your own access. Ask the owner or another administrator.'
          : 'The owner always has full access to the organisation. It can’t be assigned or removed here.'}
      </HelpTip>
    </span>
  );

  const chips = (member: TeamMember) => {
    const person = personName(member);
    const list = [];
    if (member.is_owner) list.push(<RoleChip key="owner" tone="owner" name="Owner" scope="Entire organisation" full="Entire organisation" person={person} />);
    for (const a of member.assignments) {
      const editable = !locked(member) && rolesReady;
      list.push(
        <RoleChip
          key={a.id}
          name={a.role_name}
          scope={chipScope(a.scope)}
          full={scopeFullText(a.scope)}
          person={person}
          onChange={editable ? () => setChanging({ member, assignment: a }) : undefined}
          onRemove={editable ? () => setRemovingRole({ member, assignment: a }) : undefined}
        />
      );
    }
    if (member.worker) list.push(<RoleChip key="employee" name="Employee" scope={member.worker.branch_name} full={member.worker.branch_name} person={person} />);
    return list.length > 0 ? <div className="flex flex-wrap gap-1.5">{list}</div> : <span className="text-xs text-[var(--muted)]">No roles</span>;
  };

  const personActions = (member: TeamMember, compact: boolean) => {
    if (locked(member)) return lockedHelp(member);
    const hasRoles = member.assignments.length > 0;
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => setAdding(member)} disabled={!rolesReady} leftIcon={<UserPlus className="w-3.5 h-3.5" />}>Add role</Button>
        {hasRoles && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => resetLink(member)}
              loading={resetBusyId === member.user_id}
              title="Create a password reset link to share with them yourself"
              aria-label={`Create a password reset link for ${personName(member)}`}
              leftIcon={<KeyRound className="w-3.5 h-3.5" />}
            >
              {compact ? 'Reset link' : <span className="sr-only">Reset password link</span>}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-[var(--danger)] hover:text-[var(--danger)]"
              onClick={() => setRemovingAll(member)}
              title="Remove all of their roles"
              aria-label={`Remove all access for ${personName(member)}`}
              leftIcon={<UserMinus className="w-3.5 h-3.5" />}
            >
              {compact ? 'Remove all access' : <span className="sr-only">Remove all access</span>}
            </Button>
          </>
        )}
      </div>
    );
  };

  const statusBadge = (member: TeamMember) => member.status === 'active'
    ? <Badge variant="success" size="sm">Active</Badge>
    : <Badge variant="danger" size="sm">Disabled</Badge>;

  const identity = (name: string, email: string, hasName: boolean, extra?: ReactNode) => (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold text-[var(--text)] break-words">{name}</span>
        {extra}
      </div>
      {hasName && <div className="text-xs text-[var(--muted)] break-all">{email}</div>}
    </div>
  );

  const inviteChip = (i: Invitation) => (
    <RoleChip
      tone="pending"
      name={i.role_name}
      scope={i.scope_all ? 'Entire organisation' : scopeText({ all: false, branches: i.branches })}
      full={i.scope_all ? 'Entire organisation' : i.branches.map(b => b.name).join(', ')}
      person={i.email}
    />
  );

  const inviteBranches = (i: Invitation) => (i.scope_all ? 'All branches' : i.branches.length <= 3 ? i.branches.map(b => b.name).join(', ') : `${i.branches.length} branches`);

  const inviteActions = (i: Invitation) => (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Button variant="outline" size="sm" onClick={() => resend(i)} loading={resendingId === i.id} leftIcon={<Send className="w-3.5 h-3.5" />} aria-label={`Resend the invitation to ${i.email}`}>Resend</Button>
      <Button variant="ghost" size="sm" className="text-[var(--danger)] hover:text-[var(--danger)]" onClick={() => setRevoking(i)} aria-label={`Revoke the invitation to ${i.email}`}>Revoke</Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search people by name, email or role"
            placeholder="Search by name, email or role"
            className="w-full text-sm bg-[var(--input-bg)] text-[var(--text)] border border-[var(--border)] rounded-md pl-9 pr-3 py-2 placeholder:text-[var(--muted)]/60 focus:outline-none focus:ring-2 focus:border-[var(--primary)] focus:ring-[var(--primary)]/25"
          />
        </div>
        <Button variant="primary" size="md" onClick={onInvite} disabled={!rolesReady} leftIcon={<UserPlus className="w-4 h-4" />} className="shrink-0 self-start sm:self-auto">
          Invite person
        </Button>
      </div>

      {rows.length === 0 ? (
        data.members.length + data.invitations.length === 0 ? (
          <EmptyState icon={<Users className="w-5 h-5" />} title="No one has access yet" description="Invite someone and choose what they can do. They get a private link to set up their sign-in." actionLabel="Invite person" onAction={onInvite} />
        ) : (
          <EmptyState icon={<Search className="w-5 h-5" />} title="No one matches your search" description="Try a different name, email or role." actionLabel="Clear search" onAction={() => setSearch('')} />
        )
      ) : (
        <>
          {/* Wide screens: a table */}
          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Person</TableHead>
                  <TableHead scope="col">Roles</TableHead>
                  <TableHead scope="col">Branch access</TableHead>
                  <TableHead scope="col">Account</TableHead>
                  <TableHead scope="col" className="text-right"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => row.kind === 'person' ? (
                  <TableRow key={row.member.user_id}>
                    <TableCell>{identity(personName(row.member), row.member.email, Boolean(row.member.full_name), row.member.is_self && <Badge variant="info" size="sm">You</Badge>)}</TableCell>
                    <TableCell className="max-w-sm">{chips(row.member)}</TableCell>
                    <TableCell className="text-xs text-[var(--text)]"><span title={branchAccess(row.member, givesBranchAccess).full}>{branchAccess(row.member, givesBranchAccess).text}</span></TableCell>
                    <TableCell>{statusBadge(row.member)}</TableCell>
                    <TableCell>{personActions(row.member, false)}</TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={row.invitation.id}>
                    <TableCell>{identity(personName(row.invitation), row.invitation.email, Boolean(row.invitation.full_name))}</TableCell>
                    <TableCell className="max-w-sm">{inviteChip(row.invitation)}</TableCell>
                    <TableCell className="text-xs text-[var(--text)]">{inviteBranches(row.invitation)}</TableCell>
                    <TableCell>
                      <Badge variant="warning" size="sm">Invited</Badge>
                      <div className="text-[11px] text-[var(--muted)] mt-1">Expires {formatDate(row.invitation.expires_at)}</div>
                    </TableCell>
                    <TableCell>{inviteActions(row.invitation)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Narrow screens: stacked cards */}
          <ul className="lg:hidden space-y-3">
            {rows.map(row => row.kind === 'person' ? (
              <li key={row.member.user_id} className="p-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] space-y-3">
                <div className="flex items-start justify-between gap-2">
                  {identity(personName(row.member), row.member.email, Boolean(row.member.full_name), row.member.is_self && <Badge variant="info" size="sm">You</Badge>)}
                  {statusBadge(row.member)}
                </div>
                {chips(row.member)}
                <p className="text-xs text-[var(--muted)] flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Branch access: <span className="text-[var(--text)]">{branchAccess(row.member, givesBranchAccess).full}</span></span>
                </p>
                <div className="pt-1">{personActions(row.member, true)}</div>
              </li>
            ) : (
              <li key={row.invitation.id} className="p-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] space-y-3">
                <div className="flex items-start justify-between gap-2">
                  {identity(personName(row.invitation), row.invitation.email, Boolean(row.invitation.full_name))}
                  <Badge variant="warning" size="sm">Invited</Badge>
                </div>
                {inviteChip(row.invitation)}
                <p className="text-xs text-[var(--muted)]">Expires {formatDate(row.invitation.expires_at)}</p>
                {inviteActions(row.invitation)}
              </li>
            ))}
          </ul>
        </>
      )}

      {adding && roles && catalogue && (
        <AssignRoleModal
          target={{ kind: 'person', person: adding }}
          roles={roles.roles}
          people={data.members}
          catalogue={catalogue}
          branches={branches}
          onClose={() => setAdding(null)}
          onSaved={afterAssign}
        />
      )}

      {changing && catalogue && (
        <ChangeScopeModal
          personName={personName(changing.member)}
          userId={changing.member.user_id}
          assignment={changing.assignment}
          role={roles?.roles.find(r => r.id === changing.assignment.role_id)}
          catalogue={catalogue}
          branches={branches}
          onClose={() => setChanging(null)}
          onSaved={afterAssign}
        />
      )}

      <ConfirmModal
        isOpen={Boolean(removingRole)}
        onClose={() => setRemovingRole(null)}
        onConfirm={removeRole}
        title={`Remove ${removingRole?.assignment.role_name ?? 'this role'} from ${removingRole ? personName(removingRole.member) : 'this person'}?`}
        message={`They lose what this role gives them${removingRole ? ` (${scopeText(removingRole.assignment.scope)})` : ''}. Their other roles are not affected.`}
        confirmLabel="Remove role"
        variant="danger"
        loading={busy}
      />

      <ConfirmModal
        isOpen={Boolean(removingAll)}
        onClose={() => setRemovingAll(null)}
        onConfirm={removeAll}
        title={`Remove all access for ${removingAll ? personName(removingAll) : 'this person'}?`}
        message={`They lose every role they hold here (${removingAll?.assignments.map(a => a.role_name).join(', ') ?? ''}). Their account stays, and if they have no other access here they are signed out of this organisation. You can add roles again later.`}
        confirmLabel="Remove all access"
        variant="danger"
        loading={busy}
      />

      <ConfirmModal
        isOpen={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        onConfirm={revoke}
        title="Revoke this invitation?"
        message={`The link for ${revoking?.email ?? 'this person'} stops working straight away. You can send a new invitation later.`}
        confirmLabel="Revoke invitation"
        variant="danger"
        loading={busy}
      />
    </div>
  );
}
