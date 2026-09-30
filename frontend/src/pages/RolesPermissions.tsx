import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAccess } from '../hooks/useAccess';
import { EmptyState } from '../components/ui/EmptyState';
import { Tabs } from '../components/ui/Tabs';
import { useToast } from '../components/ui/Toast';
import { InviteModal } from '../components/roles/AssignModals';
import CopyLinkModal, { type LinkToShare } from '../components/roles/CopyLinkModal';
import PeopleTab from '../components/roles/PeopleTab';
import RolesTab from '../components/roles/RolesTab';
import { useRolesData } from '../components/roles/useRolesData';

type TabId = 'roles' | 'people';

/**
 * Settings → Roles & permissions. Two tabs: Roles (what each role can do, who holds it) and People
 * (who has access, with which roles and where). The server decides what each person may change and
 * answers with a plain-language refusal, which is shown as it is.
 */
export default function RolesPermissions() {
  const { can, loading: accessLoading } = useAccess();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const canRoles = can('roles.manage') || can('users.manage');
  const canPeople = can('users.manage');
  const { roles, catalogue, team, reloadRoles, reloadTeam, refreshAll } = useRolesData(canRoles, canPeople);

  const [invite, setInvite] = useState<{ roleId?: string } | null>(null);
  const [link, setLink] = useState<LinkToShare | null>(null);

  const requested: TabId = params.get('tab') === 'people' ? 'people' : 'roles';
  const tab: TabId = requested === 'people' && canPeople ? 'people' : canRoles ? 'roles' : 'people';
  const changeTab = useCallback((id: string) => {
    setParams(id === 'people' ? { tab: 'people' } : {}, { replace: true });
  }, [setParams]);

  if (accessLoading) return null;

  if (!canRoles && !canPeople) {
    return (
      <div className="max-w-2xl mx-auto pt-6">
        <EmptyState
          icon={<Lock className="w-5 h-5" />}
          title="You don’t have access to Roles & permissions"
          description="Only the owner, or people who have been given permission to manage users or roles, can open this page. Ask the owner if you need it."
        />
      </div>
    );
  }

  const tabs = [
    ...(canRoles ? [{ id: 'roles', label: 'Roles', badge: roles.data?.roles.length }] : []),
    ...(canPeople ? [{ id: 'people', label: 'People', badge: team.data ? team.data.members.length + team.data.invitations.length : undefined }] : []),
  ].map(t => (t.badge === undefined ? { id: t.id, label: t.label } : t));

  const branches = team.data?.branches ?? [];

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <div className="pb-4 border-b border-[var(--border)]">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Roles &amp; permissions</h1>
        <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl">
          Decide who can do what in your organisation, and where. Nobody can give someone access that they don’t have themselves.
        </p>
      </div>

      {tabs.length > 1 && (
        <nav aria-label="Roles and permissions sections">
          <Tabs tabs={tabs} activeTab={tab} onChange={changeTab} />
        </nav>
      )}

      {tab === 'roles' && canRoles && (
        <RolesTab
          roles={roles}
          catalogue={catalogue}
          team={team.data}
          canManageUsers={canPeople}
          onRetry={reloadRoles}
          onChanged={refreshAll}
          onInvite={roleId => setInvite({ roleId })}
        />
      )}

      {tab === 'people' && canPeople && (
        <PeopleTab
          team={team}
          roles={roles.data}
          catalogue={catalogue.data}
          onRetry={reloadTeam}
          onChanged={refreshAll}
          onInvite={() => setInvite({})}
          onShowLink={setLink}
        />
      )}

      {invite && roles.data && catalogue.data && (
        <InviteModal
          roles={roles.data.roles}
          catalogue={catalogue.data}
          branches={branches}
          presetRoleId={invite.roleId}
          onClose={() => setInvite(null)}
          onInvited={result => {
            setInvite(null);
            refreshAll();
            if (result.link) {
              setLink({
                title: 'Invitation link',
                description: `Email is turned off. Copy this link and share it with ${result.email} yourself.`,
                url: result.link,
                note: 'It works once and expires in 7 days.',
              });
            } else if (result.failed) {
              toast.warning(result.message);
            } else {
              toast.success(result.message);
            }
          }}
        />
      )}

      <CopyLinkModal link={link} onClose={() => setLink(null)} />
    </div>
  );
}
