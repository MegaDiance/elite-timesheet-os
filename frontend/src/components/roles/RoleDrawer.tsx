import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Building2, Copy, Globe2, Lock, Trash2, UserPlus, X } from 'lucide-react';
import api from '../../services/apiClient';
import { accessError } from './accessError';
import { useAccess } from '../../hooks/useAccess';
import { useDialogFocus } from '../roster/Dialog';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Input } from '../ui/Input';
import { Skeleton } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { AssignRoleModal, ChangeScopeModal } from './AssignModals';
import PermissionList from './PermissionList';
import RoleSummaryView from './RoleSummary';
import DeleteRoleModal from './DeleteRoleModal';
import {
  isAssignable, pluralPeople, personName, roleDescription, scopeFullText, scopeText,
  type PermissionGroup, type RoleDetail, type RoleMember, type RoleSummary, type TeamData,
} from './types';

interface Props {
  /** An existing role's id, or 'new' to create one. */
  roleId: string;
  summary: RoleSummary | null;
  roles: RoleSummary[];
  catalogue: PermissionGroup[];
  team: TeamData | null;
  /** May give roles to people (users.manage). */
  canManageUsers: boolean;
  /** May create roles (roles.manage). */
  canManageRoles: boolean;
  onClose: () => void;
  /** Something changed on the server: reload the lists behind the panel. */
  onChanged: () => void;
  onInvite: (roleId: string) => void;
}

interface Form {
  name: string;
  description: string;
  permissions: Set<string>;
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(x => b.has(x));

const formFrom = (role: RoleSummary | null): Form => ({
  name: role?.name ?? '',
  description: role?.description ?? '',
  permissions: new Set(role?.permissions ?? []),
});

function readOnlyReason(role: RoleSummary, isOwner: boolean, canManageRoles: boolean): string | null {
  if (role.system_key === 'OWNER') return 'The Owner role always has full access and can’t be changed.';
  if (role.system_key === 'EMPLOYEE') return 'The Employee role covers the employee portal only, and can’t be changed.';
  if (role.system_key === 'ADMIN' && !role.can_edit_permissions) {
    return isOwner || canManageRoles ? `Only the owner can change what the ${role.name} role can do.` : `View only. Only the owner can change the ${role.name} role.`;
  }
  if (!role.can_edit_permissions) return 'View only. Changing it needs the “Manage roles and permissions” permission.';
  return null;
}

/**
 * One role in a side panel (a full-screen sheet on phones): its details, who holds it and where,
 * and its permissions. Custom roles and (for the owner) the Manager role can be edited; the rest are
 * read-only. Changes are saved together with one Save button; who holds the role changes at once.
 */
export default function RoleDrawer({ roleId, summary, roles, catalogue, team, canManageUsers, canManageRoles, onClose, onChanged, onInvite }: Props) {
  const toast = useToast();
  const { access, isOwner } = useAccess();
  const selfId = access?.user.id;
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const [currentId, setCurrentId] = useState(roleId);
  const isNew = currentId === 'new';
  const [role, setRole] = useState<RoleDetail | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(() => {
    if (!isNew) return formFrom(summary);
    const first = roles.find(r => isAssignable(r));
    return { name: '', description: '', permissions: new Set(first?.permissions ?? []) };
  });
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // New roles start from an existing one by default: far quicker than ticking boxes from nothing.
  const templates = useMemo(() => roles.filter(r => isAssignable(r)), [roles]);
  const [startFrom, setStartFrom] = useState<string>(() => (isNew ? templates[0]?.id ?? 'blank' : 'blank'));
  const [addingMember, setAddingMember] = useState(false);
  const [changing, setChanging] = useState<RoleMember | null>(null);
  const [removing, setRemoving] = useState<RoleMember | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const load = useCallback(async (id: string, resetForm: boolean) => {
    try {
      const res = await api.get(`/roles/${id}`);
      const detail: RoleDetail = res.data.data;
      setLoadError(null);
      setRole(detail);
      if (resetForm) setForm(formFrom(detail));
    } catch (err) {
      setLoadError(accessError(err, 'Couldn’t load this role. Try again.'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Setting `loading` back on happens where the id changes (creating a role) or on retry, not here.
  useEffect(() => {
    if (currentId !== 'new') load(currentId, true);
  }, [currentId, load]);

  const editPermissions = isNew ? canManageRoles : Boolean(role?.can_edit_permissions);
  const editDetails = isNew ? canManageRoles : Boolean(role?.can_edit_details);
  const canDelete = !isNew && Boolean(role?.can_delete);
  const canDuplicate = !isNew && Boolean(role?.can_duplicate);

  const dirty = useMemo(() => {
    if (isNew) {
      const start = new Set(templates.find(r => r.id === startFrom)?.permissions ?? []);
      return form.name.trim() !== '' || form.description.trim() !== '' || !sameSet(form.permissions, start);
    }
    if (!role) return false;
    return form.name.trim() !== role.name
      || form.description.trim() !== (role.description ?? '')
      || !sameSet(form.permissions, new Set(role.permissions));
  }, [form, role, isNew, templates, startFrom]);

  const requestClose = useCallback(() => {
    if (dirty && !saving) setConfirmDiscard(true);
    else onClose();
  }, [dirty, saving, onClose]);

  useDialogFocus(panelRef, requestClose, saving || deleting, bodyRef);

  const groups = useMemo(() => {
    if (role?.system_key === 'EMPLOYEE') return catalogue.filter(g => g.category === 'Employee portal');
    return catalogue.filter(g => g.permissions.some(p => p.assignable));
  }, [catalogue, role]);

  const save = async () => {
    setSaveError(null);
    const name = form.name.trim().replace(/\s+/g, ' ');
    if (editDetails && !name) {
      setNameError('Enter a role name.');
      return;
    }
    setNameError(null);
    setSaving(true);
    try {
      const permissions = [...form.permissions];
      if (isNew) {
        const res = await api.post('/roles', { name, description: form.description.trim() || undefined, permissions });
        toast.success(res.data?.message || `Role “${name}” created.`);
        onChanged();
        setCurrentId(res.data.data.id);
        setLoading(true);
      } else if (role) {
        const body: Record<string, unknown> = {};
        if (editDetails && name !== role.name) body.name = name;
        if (editDetails && form.description.trim() !== (role.description ?? '')) body.description = form.description.trim();
        if (editPermissions && !sameSet(form.permissions, new Set(role.permissions))) body.permissions = permissions;
        const res = await api.put(`/roles/${role.id}`, body);
        toast.success(res.data?.message || 'Role saved');
        await load(role.id, true);
        onChanged();
      }
    } catch (err) {
      setSaveError(accessError(err, 'Couldn’t save the role. Your changes are kept.'));
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    if (role) setForm(formFrom(role));
    setNameError(null);
    setSaveError(null);
  };

  const chooseStart = (id: string) => {
    setStartFrom(id);
    const template = templates.find(r => r.id === id);
    setForm(f => ({ ...f, permissions: new Set(template?.permissions ?? []) }));
  };

  const duplicate = async () => {
    if (!role) return;
    setDuplicating(true);
    setSaveError(null);
    try {
      const res = await api.post(`/roles/${role.id}/duplicate`);
      toast.success(res.data?.message || 'Role duplicated');
      onChanged();
      setLoading(true);
      setCurrentId(res.data.data.id);
    } catch (err) {
      setSaveError(accessError(err, 'Couldn’t duplicate role. Try again.'));
    } finally {
      setDuplicating(false);
    }
  };

  const deleteRole = async (members?: { members: 'move' | 'remove'; move_to_role_id?: string }) => {
    if (!role) return;
    setDeleting(true);
    try {
      const res = await api.delete(`/roles/${role.id}`, { data: members ?? {} });
      toast.success(res.data?.message || `Role “${role.name}” deleted.`);
      onChanged();
      onClose();
    } catch (err) {
      setConfirmDelete(false);
      setSaveError(accessError(err, 'Couldn’t delete role. Try again.'));
    } finally {
      setDeleting(false);
    }
  };

  const removeMember = async () => {
    if (!removing || !role || !removing.assignment_id) return;
    setRemoveBusy(true);
    try {
      const res = await api.delete(`/team/${removing.user_id}/roles/${removing.assignment_id}`);
      toast.success(res.data?.message || `${role.name} role removed.`);
      setRemoving(null);
      await load(role.id, false);
      onChanged();
    } catch (err) {
      setRemoving(null);
      setSaveError(accessError(err, 'Couldn’t remove the role from this person. Try again.'));
    } finally {
      setRemoveBusy(false);
    }
  };

  const afterMemberChange = async (message: string) => {
    toast.success(message);
    setAddingMember(false);
    setChanging(null);
    if (role) await load(role.id, false);
    onChanged();
  };

  const heading = isNew ? 'New role' : role?.name ?? summary?.name ?? 'Role';
  const reason = role ? readOnlyReason(role, isOwner, canManageRoles) : null;
  const assignable = role ? isAssignable(role) : false;
  const branches = team?.branches ?? [];
  const showFooter = isNew || editPermissions || editDetails || canDelete || canDuplicate;

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end">
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs" aria-hidden="true" onClick={saving || deleting ? undefined : requestClose} />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="relative z-10 w-full md:max-w-xl h-dvh flex flex-col bg-[var(--panel)] text-[var(--text)] md:border-l border-[var(--border)] shadow-lg outline-none"
        >
          <div className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-[var(--border)] shrink-0">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={titleId} className="text-base font-bold text-[var(--text)] leading-snug break-words">{heading}</h2>
                {role?.is_system && <Badge variant="info" size="sm">Built-in</Badge>}
              </div>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                {isNew ? 'Name the role and choose its permissions.' : role ? `${pluralPeople(role.member_count)} · ${role.is_system ? 'Built-in role' : 'Custom role'}` : ' '}
              </p>
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving || deleting}
              aria-label="Close"
              className="shrink-0 w-11 h-11 -m-1.5 md:m-0 md:w-8 md:h-8 rounded-full flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-8)] transition-colors disabled:opacity-40 cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-5 space-y-6">
            {loading ? (
              <div className="space-y-4" aria-busy="true" aria-label="Loading role">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : loadError ? (
              <div role="alert" className="p-4 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-light)] space-y-3">
                <p className="text-sm text-[var(--danger)]">{loadError}</p>
                <Button variant="outline" size="sm" onClick={() => { setLoading(true); load(currentId, true); }}>Try again</Button>
              </div>
            ) : (
              <>
                {reason && (
                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] text-xs text-[var(--text)]">
                    <Lock className="w-3.5 h-3.5 mt-0.5 text-[var(--muted)] shrink-0" aria-hidden="true" />
                    <p>{reason}</p>
                  </div>
                )}

                <section className="space-y-3" aria-label="Role details">
                  <Input
                    label="Role name"
                    value={form.name}
                    onChange={e => { setForm({ ...form, name: e.target.value }); setNameError(null); }}
                    readOnly={!editDetails}
                    maxLength={60}
                    placeholder="e.g. Payroll Manager"
                    error={nameError ?? undefined}
                    aria-required={editDetails}
                    autoComplete="off"
                    className="read-only:opacity-80 read-only:cursor-default"
                    id="role-name"
                  />
                  <div>
                    <label htmlFor="role-description" className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">Description</label>
                    <textarea
                      id="role-description"
                      value={!editDetails && role ? roleDescription(role) : form.description}
                      onChange={e => setForm({ ...form, description: e.target.value })}
                      readOnly={!editDetails}
                      maxLength={300}
                      rows={2}
                      placeholder="What this role is for (optional)"
                      className="w-full text-sm bg-[var(--input-bg)] text-[var(--text)] border border-[var(--border)] rounded-md px-3 py-2 placeholder:text-[var(--muted)]/60 focus:outline-none focus:ring-2 focus:border-[var(--primary)] focus:ring-[var(--primary)]/25 read-only:opacity-80 read-only:resize-none resize-y"
                    />
                  </div>
                </section>

                {!isNew && role && (
                  <section aria-labelledby="role-members" className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 id="role-members" className="text-xs font-bold text-[var(--text)] uppercase tracking-wider">
                        Members <span className="ml-1 font-medium normal-case tracking-normal text-[var(--muted)]">{role.members.length}</span>
                      </h3>
                      {assignable && canManageUsers && team && (
                        <Button variant="outline" size="sm" onClick={() => setAddingMember(true)} leftIcon={<UserPlus className="w-3.5 h-3.5" />}>Add member</Button>
                      )}
                    </div>
                    {role.members.length === 0 ? (
                      <div className="p-4 rounded-lg border border-dashed border-[var(--border)] text-center">
                        <p className="text-sm font-medium text-[var(--text)]">Nobody has this role yet</p>
                        <p className="text-xs text-[var(--muted)] mt-1">{assignable && canManageUsers ? 'Add someone from your team or invite someone new.' : 'Assign it from the People tab.'}</p>
                      </div>
                    ) : (
                      <ul className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)] max-h-72 overflow-y-auto">
                        {role.members.map(member => {
                          const isSelf = member.user_id === selfId;
                          const canChange = assignable && canManageUsers && member.assignment_id !== null && !isSelf;
                          return (
                            <li key={`${member.user_id}-${member.assignment_id ?? 'x'}`} className="flex items-center gap-3 px-3 py-2.5">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-[var(--text)] truncate">
                                  {personName(member)}
                                  {isSelf && <Badge variant="info" size="sm" className="ml-2 align-middle">You</Badge>}
                                  {!member.is_active && <Badge variant="danger" size="sm" className="ml-2 align-middle">Disabled</Badge>}
                                </p>
                                {member.full_name && <p className="text-xs text-[var(--muted)] truncate">{member.email}</p>}
                                <p className="text-xs text-[var(--muted)] mt-0.5 flex items-center gap-1">
                                  {member.scope.all ? <Globe2 className="w-3 h-3 shrink-0" aria-hidden="true" /> : <Building2 className="w-3 h-3 shrink-0" aria-hidden="true" />}
                                  <span>Applies to: {scopeFullText(member.scope)}</span>
                                </p>
                              </div>
                              {canChange && (
                                <div className="flex items-center gap-1 shrink-0">
                                  <Button variant="ghost" size="sm" onClick={() => setChanging(member)} aria-label={`Change where ${role.name} applies for ${personName(member)}`}>Change</Button>
                                  <Button variant="ghost" size="sm" className="text-[var(--danger)] hover:text-[var(--danger)]" onClick={() => setRemoving(member)} aria-label={`Remove ${role.name} from ${personName(member)}`}>Remove</Button>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                )}

                {isNew && (
                  <p className="text-xs text-[var(--muted)]">Add people after saving. You choose where it applies for each person.</p>
                )}

                {isNew && templates.length > 0 && (
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-semibold text-[var(--text)] mb-1">Start from</legend>
                    <p className="text-xs text-[var(--muted)]">Copy an existing role’s permissions, then adjust them.</p>
                    <div className="grid gap-1.5">
                      {[...templates.map(r => ({ id: r.id, name: r.name, hint: roleDescription(r) })), { id: 'blank', name: 'Blank role', hint: 'No permissions' }].map(option => (
                        <label key={option.id} className={`flex items-start gap-3 px-3 py-2 rounded-md border cursor-pointer ${startFrom === option.id ? 'border-[var(--primary)] bg-[var(--primary-light)]' : 'border-[var(--border)] hover:border-[var(--border-hover)]'}`}>
                          <input type="radio" name="start-from" className="mt-1" checked={startFrom === option.id} onChange={() => chooseStart(option.id)} />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-[var(--text)]">{option.name}</span>
                            <span className="block text-xs text-[var(--muted)] truncate">{option.hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}

                <section aria-labelledby="role-summary" className="space-y-2">
                  <h3 id="role-summary" className="text-sm font-semibold text-[var(--text)]">What this role can do</h3>
                  <RoleSummaryView permissions={form.permissions} catalogue={catalogue} everything={role?.system_key === 'OWNER'} />
                </section>

                <section aria-labelledby="role-permissions" className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 id="role-permissions" className="text-sm font-semibold text-[var(--text)]">Permissions</h3>
                    {!editPermissions && (
                      <button type="button" onClick={() => setShowAll(v => !v)} aria-expanded={showAll} className="text-xs font-semibold text-[var(--primary-text)] hover:underline cursor-pointer">
                        {showAll ? 'Hide permissions' : 'Show all permissions'}
                      </button>
                    )}
                  </div>
                  {(editPermissions || showAll) && (
                    <>
                      {editPermissions && <p className="text-xs text-[var(--muted)]">Permissions marked “Entire organisation only” work only when the role is given across the entire organisation.</p>}
                      {groups.length === 0 ? (
                        <p className="text-xs text-[var(--muted)]">Permissions couldn’t be loaded.</p>
                      ) : (
                        <PermissionList groups={groups} selected={form.permissions} onChange={permissions => setForm({ ...form, permissions })} readOnly={!editPermissions} />
                      )}
                    </>
                  )}
                </section>
              </>
            )}
          </div>

          {showFooter && !loading && !loadError && (
            <div className="shrink-0 border-t border-[var(--border)] bg-[var(--panel)] px-4 sm:px-5 py-3 space-y-2 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {saveError && <p role="alert" className="text-xs font-medium text-[var(--danger)]">{saveError}</p>}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                  {canDuplicate && (
                    <Button variant="ghost" size="sm" onClick={duplicate} loading={duplicating} disabled={saving || dirty} title={dirty ? 'Save or discard your changes first' : undefined} leftIcon={<Copy className="w-3.5 h-3.5" />}>Duplicate</Button>
                  )}
                  {canDelete && (
                    <Button variant="ghost" size="sm" className="text-[var(--danger)] hover:text-[var(--danger)]" onClick={() => setConfirmDelete(true)} disabled={saving} leftIcon={<Trash2 className="w-3.5 h-3.5" />}>Delete</Button>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <span role="status" className="text-xs text-[var(--muted)]">{dirty ? 'Unsaved changes' : ''}</span>
                  <Button variant="ghost" size="sm" onClick={dirty && !isNew ? resetForm : requestClose} disabled={saving}>{dirty ? (isNew ? 'Cancel' : 'Discard changes') : 'Close'}</Button>
                  {(editPermissions || editDetails) && (
                    <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!dirty}>{isNew ? 'Create role' : 'Save changes'}</Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => { setConfirmDiscard(false); onClose(); }}
        title="Discard your changes?"
        message="Your unsaved changes will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        variant="warning"
      />

      {confirmDelete && role && (
        <DeleteRoleModal
          role={role}
          otherRoles={templates.filter(r => r.id !== role.id)}
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={deleteRole}
        />
      )}

      <ConfirmModal
        isOpen={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={removeMember}
        title={`Remove ${role?.name ?? 'this role'} from ${removing ? personName(removing) : 'this person'}?`}
        message={`They lose what this role gives them${removing ? ` (${scopeText(removing.scope)})` : ''}. Their other roles are not affected.`}
        confirmLabel="Remove role"
        variant="danger"
        loading={removeBusy}
      />

      {addingMember && role && team && (
        <AssignRoleModal
          target={{ kind: 'role', role }}
          roles={roles}
          people={team.members}
          catalogue={catalogue}
          branches={branches}
          onClose={() => setAddingMember(false)}
          onSaved={afterMemberChange}
          onInviteInstead={() => { setAddingMember(false); onInvite(role.id); }}
        />
      )}

      {changing && changing.assignment_id && role && (
        <ChangeScopeModal
          personName={personName(changing)}
          userId={changing.user_id}
          assignment={{ id: changing.assignment_id, role_id: role.id, role_name: role.name, system_key: role.system_key, scope: changing.scope }}
          role={role}
          catalogue={catalogue}
          branches={branches}
          onClose={() => setChanging(null)}
          onSaved={afterMemberChange}
        />
      )}
    </>
  );
}
