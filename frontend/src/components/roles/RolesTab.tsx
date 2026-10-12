import { useState } from 'react';
import { Copy, Pencil, Plus, Shield, Users } from 'lucide-react';
import api from '../../services/apiClient';
import { Menu } from '../ui/Menu';
import { useToast } from '../ui/Toast';
import { accessError } from './accessError';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import LoadFailed from './LoadFailed';
import RoleDrawer from './RoleDrawer';
import type { Loadable } from './useRolesData';
import { pluralPeople, roleDescription, type PermissionGroup, type RolesData, type TeamData } from './types';

interface Props {
  roles: Loadable<RolesData>;
  catalogue: Loadable<PermissionGroup[]>;
  team: TeamData | null;
  canManageUsers: boolean;
  onRetry: () => void;
  onChanged: () => void;
  onInvite: (roleId: string) => void;
}

export default function RolesTab({ roles, catalogue, team, canManageUsers, onRetry, onChanged, onInvite }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const toast = useToast();

  const duplicate = async (id: string) => {
    try {
      const res = await api.post(`/roles/${id}/duplicate`);
      toast.success(res.data?.message || 'Role duplicated');
      onChanged();
      setOpenId(res.data.data.id);
    } catch (err) {
      toast.error(accessError(err, 'Couldn’t duplicate role. Try again.'));
    }
  };

  const error = roles.error || catalogue.error;
  const loading = roles.loading || catalogue.loading;

  if (error) return <LoadFailed title="Couldn’t load roles" message={error} onRetry={onRetry} />;

  if (loading || !roles.data || !catalogue.data) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading roles">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-4 p-4 bg-[var(--panel)] border border-[var(--border)] rounded-lg">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    );
  }

  const { roles: list, can_manage } = roles.data;
  const selected = openId && openId !== 'new' ? list.find(r => r.id === openId) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm text-[var(--muted)] max-w-2xl">
          Each person’s role applies to the entire organisation or to branches you choose.
        </p>
        {can_manage && (
          <Button variant="primary" size="md" onClick={() => setOpenId('new')} leftIcon={<Plus className="w-4 h-4" />} className="shrink-0 self-start sm:self-auto">
            Create role
          </Button>
        )}
      </div>

      {!can_manage && (
        <p className="text-xs text-[var(--muted)] p-3 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)]">
          View only. Changing roles needs the “Manage roles and permissions” permission.
        </p>
      )}

      <ul className="rounded-lg border border-[var(--border)] bg-[var(--panel)] divide-y divide-[var(--border)] overflow-hidden">
        {list.map(role => (
          <li key={role.id} className="flex items-center gap-1 pr-2">
            <button
              type="button"
              onClick={() => setOpenId(role.id)}
              className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--hover-row)] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--primary)]"
            >
              <span className="w-9 h-9 rounded-lg bg-[var(--primary-light)] text-[var(--primary-text)] flex items-center justify-center shrink-0" aria-hidden="true">
                <Shield className="w-4 h-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-[var(--text)] break-words">{role.name}</span>
                  {role.is_system && <Badge variant="info" size="sm">Built-in</Badge>}
                </span>
                <span className="block text-xs text-[var(--muted)] mt-0.5 truncate">{roleDescription(role)}</span>
              </span>
              <span className="flex items-center gap-1.5 text-xs text-[var(--muted)] shrink-0">
                <Users className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{pluralPeople(role.member_count)}</span>
              </span>
              <span className="sr-only">Open {role.name}</span>
            </button>
            <Menu
              label={`More actions for ${role.name}`}
              items={[
                { label: role.can_edit_permissions || role.can_edit_details ? 'Edit' : 'View', icon: <Pencil />, onSelect: () => setOpenId(role.id) },
                { label: 'Duplicate', icon: <Copy />, onSelect: () => duplicate(role.id), disabled: !role.can_duplicate },
              ]}
            />
          </li>
        ))}
      </ul>

      {openId && (
        <RoleDrawer
          roleId={openId}
          summary={selected}
          roles={list}
          catalogue={catalogue.data}
          team={team}
          canManageUsers={canManageUsers}
          canManageRoles={can_manage}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
          onInvite={id => { setOpenId(null); onInvite(id); }}
        />
      )}
    </div>
  );
}
