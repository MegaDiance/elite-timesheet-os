import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
  ShieldOff,
  UserCog,
  UserMinus,
  UserPlus,
  XCircle,
} from 'lucide-react';
import api from '../services/apiClient';
import { useAccess, type Branch } from '../hooks/useAccess';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { EmptyState } from '../components/ui/EmptyState';
import { TableSkeleton } from '../components/ui/Skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { useToast } from '../components/ui/Toast';

interface BranchAdmin {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  two_factor_enabled: boolean;
  branches: Array<{ id: string; name: string; is_active: boolean }>;
}

interface Invitation {
  id: string;
  email: string;
  full_name: string | null;
  expires_at: string;
  delivery_status: string | null;
  created_at: string;
  branches: Array<{ id: string; name: string }>;
}

const errorMessage = (err: any, fallback: string): string => err?.response?.data?.error?.message || fallback;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

function BranchChecklist({ branches, selected, onChange }: {
  branches: Branch[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  const allSelected = branches.length > 0 && branches.every(b => selected.includes(b.id));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Branches</span>
        {branches.length > 1 && (
          <button
            type="button"
            onClick={() => onChange(allSelected ? [] : branches.map(b => b.id))}
            className="text-[11px] font-semibold text-[var(--primary)] hover:underline cursor-pointer"
          >
            {allSelected ? 'Clear all' : 'Select all'}
          </button>
        )}
      </div>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
        {branches.map(branch => (
          <label key={branch.id} className="flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text)] cursor-pointer hover:bg-[var(--hover-row)]">
            <input
              type="checkbox"
              checked={selected.includes(branch.id)}
              onChange={() => toggle(branch.id)}
              className="rounded border-[var(--border)] accent-[var(--primary)]"
            />
            <Building2 className="w-3.5 h-3.5 text-[var(--muted)]" />
            <span className="font-medium">{branch.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function BranchAdmins() {
  const toast = useToast();
  const { access } = useAccess();
  const activeBranches = (access?.branches ?? []).filter(b => b.is_active);

  const [admins, setAdmins] = useState<BranchAdmin[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Invite
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteBranches, setInviteBranches] = useState<string[]>([]);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  // Change branches
  const [editing, setEditing] = useState<BranchAdmin | null>(null);
  const [editBranches, setEditBranches] = useState<string[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingBranches, setSavingBranches] = useState(false);

  // Remove access / revoke invitation
  const [removing, setRemoving] = useState<BranchAdmin | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get('/branch-admins');
      setAdmins(res.data.data?.branch_admins || []);
      setInvitations(res.data.data?.invitations || []);
    } catch (err: any) {
      setLoadError(errorMessage(err, 'Branch Admins could not be loaded.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openInvite = () => {
    setInviteEmail('');
    setInviteName('');
    setInviteBranches(activeBranches.length === 1 ? [activeBranches[0].id] : []);
    setInviteError(null);
    setShowInvite(true);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) {
      setInviteError('Enter an email address.');
      return;
    }
    if (inviteBranches.length === 0) {
      setInviteError('Choose at least one branch.');
      return;
    }
    setInviting(true);
    setInviteError(null);
    try {
      const res = await api.post('/branch-admins/invitations', {
        email: inviteEmail.trim(),
        full_name: inviteName.trim() || undefined,
        location_ids: inviteBranches,
      });
      const message = res.data?.message || `Invitation sent to ${inviteEmail.trim()}.`;
      if (res.data?.data?.delivery_status === 'failed') toast.warning(message);
      else toast.success(message);
      setShowInvite(false);
      fetchData();
    } catch (err: any) {
      setInviteError(errorMessage(err, 'The invitation could not be created.'));
    } finally {
      setInviting(false);
    }
  };

  const handleResend = async (invitation: Invitation) => {
    setResendingId(invitation.id);
    try {
      const res = await api.post(`/branch-admins/invitations/${invitation.id}/resend`);
      if (res.data?.success) toast.success(res.data.message || 'Invitation re-sent.');
      else toast.error(res.data?.message || 'The email could not be delivered.');
      fetchData();
    } catch (err: any) {
      toast.error(errorMessage(err, 'The invitation could not be re-sent.'));
    } finally {
      setResendingId(null);
    }
  };

  const handleRevoke = async () => {
    if (!revoking) return;
    setRevokeBusy(true);
    try {
      await api.delete(`/branch-admins/invitations/${revoking.id}`);
      toast.success(`Invitation for ${revoking.email} revoked.`);
      setRevoking(null);
      fetchData();
    } catch (err: any) {
      toast.error(errorMessage(err, 'The invitation could not be revoked.'));
    } finally {
      setRevokeBusy(false);
    }
  };

  const openChangeBranches = (admin: BranchAdmin) => {
    setEditing(admin);
    setEditBranches(admin.branches.filter(b => b.is_active).map(b => b.id));
    setEditError(null);
  };

  const handleSaveBranches = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (editBranches.length === 0) {
      setEditError('Choose at least one branch. To take away all access, use Remove access instead.');
      return;
    }
    setSavingBranches(true);
    setEditError(null);
    try {
      const res = await api.put(`/branch-admins/${editing.id}/branches`, { location_ids: editBranches });
      toast.success(res.data?.message || 'Branch assignments updated.');
      setEditing(null);
      fetchData();
    } catch (err: any) {
      setEditError(errorMessage(err, 'The branches could not be changed.'));
    } finally {
      setSavingBranches(false);
    }
  };

  const handleRemove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await api.delete(`/branch-admins/${removing.id}`);
      toast.success(`${removing.full_name || removing.email} no longer has access.`);
      setRemoving(null);
      fetchData();
    } catch (err: any) {
      toast.error(errorMessage(err, 'Access could not be removed.'));
    } finally {
      setRemoveBusy(false);
    }
  };

  const editingHasInactive = Boolean(editing?.branches.some(b => !b.is_active));

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Branch Admins</h1>
            <Badge variant="purple" size="sm">Owner only</Badge>
          </div>
          <p className="text-xs text-[var(--muted)] mt-1 max-w-2xl">
            Branch Admins manage the workers, roster and timesheets of their branches. They cannot change organisation settings or other admins.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="md"
            onClick={fetchData}
            disabled={loading}
            leftIcon={<RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={openInvite}
            disabled={activeBranches.length === 0}
            leftIcon={<UserPlus className="w-4 h-4" />}
          >
            Invite Branch Admin
          </Button>
        </div>
      </div>

      {activeBranches.length === 0 && (
        <div className="p-3 rounded-lg bg-[var(--warn-light)] border border-[var(--warn)]/30 text-xs text-[var(--warn)]">
          You need at least one active branch before you can invite a Branch Admin. <Link to="/branches" className="font-semibold underline">Go to Branches</Link>
        </div>
      )}

      {loadError && (
        <EmptyState
          icon={<UserCog className="w-5 h-5" />}
          title="Branch Admins could not be loaded"
          description={loadError}
          actionLabel="Try again"
          onAction={fetchData}
        />
      )}

      {/* Current Branch Admins */}
      {!loadError && (
        <section className="space-y-3">
          <h2 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">
            Branch Admins ({admins.length})
          </h2>
          {loading && admins.length === 0 ? (
            <TableSkeleton rows={3} />
          ) : admins.length === 0 ? (
            <EmptyState
              icon={<UserCog className="w-5 h-5" />}
              title="No Branch Admins yet"
              description="Invite someone to manage the workers, roster and timesheets of one or more branches. You can keep managing every branch yourself."
              actionLabel={activeBranches.length > 0 ? 'Invite Branch Admin' : undefined}
              onAction={activeBranches.length > 0 ? openInvite : undefined}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Branches</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.map(admin => (
                  <TableRow key={admin.id}>
                    <TableCell>
                      <div className="font-semibold text-sm text-[var(--text)]">{admin.full_name || admin.email}</div>
                      {admin.full_name && <div className="text-xs text-[var(--muted)]">{admin.email}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5 max-w-md">
                        {admin.branches.map(b => (
                          <Badge key={b.id} variant={b.is_active ? 'outline' : 'default'} size="sm" title={b.is_active ? undefined : 'This branch is deactivated'}>
                            <Building2 className="w-3 h-3" />
                            {b.name}{b.is_active ? '' : ' (deactivated)'}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {admin.two_factor_enabled
                          ? <Badge variant="success" size="sm"><ShieldCheck className="w-3 h-3" />2FA on</Badge>
                          : <Badge variant="default" size="sm"><ShieldOff className="w-3 h-3" />2FA off</Badge>}
                        {!admin.is_active && <Badge variant="danger" size="sm">Account disabled</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openChangeBranches(admin)}
                          disabled={activeBranches.length === 0}
                          leftIcon={<Building2 className="w-3.5 h-3.5" />}
                        >
                          Change branches
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRemoving(admin)}
                          className="text-[var(--danger)] hover:text-[var(--danger)]"
                          leftIcon={<UserMinus className="w-3.5 h-3.5" />}
                        >
                          Remove access
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {/* Pending invitations */}
      {!loadError && (
        <section className="space-y-3">
          <h2 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">
            Pending invitations ({invitations.length})
          </h2>
          {invitations.length === 0 ? (
            <Card className="p-4 text-xs text-[var(--muted)]">
              No invitations waiting. Invitations are only sent by email and expire after 7 days.
            </Card>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invited</TableHead>
                  <TableHead>Branches</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map(invitation => (
                  <TableRow key={invitation.id}>
                    <TableCell>
                      <div className="font-semibold text-sm text-[var(--text)]">{invitation.full_name || invitation.email}</div>
                      {invitation.full_name && <div className="text-xs text-[var(--muted)]">{invitation.email}</div>}
                      <div className="text-[11px] text-[var(--muted)]">Sent {formatDate(invitation.created_at)}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5 max-w-md">
                        {invitation.branches.map(b => (
                          <Badge key={b.id} variant="outline" size="sm"><Building2 className="w-3 h-3" />{b.name}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {invitation.delivery_status === 'sent' ? (
                        <Badge variant="success" size="sm"><Mail className="w-3 h-3" />Delivered</Badge>
                      ) : invitation.delivery_status === 'failed' ? (
                        <Badge variant="danger" size="sm"><XCircle className="w-3 h-3" />Not delivered</Badge>
                      ) : (
                        <Badge variant="default" size="sm">Sending</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-[var(--muted)] whitespace-nowrap">{formatDate(invitation.expires_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleResend(invitation)}
                          loading={resendingId === invitation.id}
                          leftIcon={<Send className="w-3.5 h-3.5" />}
                        >
                          Resend
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRevoking(invitation)}
                          className="text-[var(--danger)] hover:text-[var(--danger)]"
                        >
                          Revoke
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {/* Invite */}
      <Modal
        isOpen={showInvite}
        onClose={() => setShowInvite(false)}
        title="Invite a Branch Admin"
        description="We email them a private link to accept. The link expires after 7 days."
        maxWidth="md"
      >
        <form onSubmit={handleInvite} className="space-y-4">
          {inviteError && (
            <div className="p-3 rounded-md text-xs bg-[var(--danger-light)] border border-[var(--danger)]/30 text-[var(--danger)]">
              {inviteError}
            </div>
          )}
          <Input
            label="Email address"
            type="email"
            placeholder="name@example.com"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            leftIcon={<Mail className="w-4 h-4" />}
            required
            autoFocus
          />
          <Input
            label="Name (optional)"
            placeholder="e.g. Sam Nguyen"
            value={inviteName}
            onChange={e => setInviteName(e.target.value)}
            maxLength={120}
          />
          <BranchChecklist branches={activeBranches} selected={inviteBranches} onChange={setInviteBranches} />
          <p className="text-[11px] text-[var(--muted)] leading-relaxed">
            Branch Admins manage the workers, roster and timesheets of their branches. They cannot change organisation settings or other admins.
          </p>
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--border)]">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowInvite(false)} disabled={inviting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={inviting} leftIcon={<Send className="w-3.5 h-3.5" />}>
              Send invitation
            </Button>
          </div>
        </form>
      </Modal>

      {/* Change branches */}
      <Modal
        isOpen={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Change branches for ${editing?.full_name || editing?.email || ''}`}
        description="They can manage the workers, roster and timesheets of the branches you tick."
        maxWidth="md"
      >
        <form onSubmit={handleSaveBranches} className="space-y-4">
          {editError && (
            <div className="p-3 rounded-md text-xs bg-[var(--danger-light)] border border-[var(--danger)]/30 text-[var(--danger)]">
              {editError}
            </div>
          )}
          <BranchChecklist branches={activeBranches} selected={editBranches} onChange={setEditBranches} />
          {editingHasInactive && (
            <p className="text-[11px] text-[var(--muted)]">
              Deactivated branches are not listed. Saving removes them from this Branch Admin.
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--border)]">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={savingBranches}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={savingBranches} disabled={editBranches.length === 0}>
              Save branches
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        isOpen={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={handleRemove}
        title={`Remove access for ${removing?.full_name || removing?.email || 'this Branch Admin'}?`}
        message="They are signed out of this organisation and lose access to all of its branches. Their account and any other organisations they belong to are not affected. You can invite them again later."
        confirmLabel="Remove access"
        variant="danger"
        loading={removeBusy}
      />

      <ConfirmModal
        isOpen={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        onConfirm={handleRevoke}
        title="Revoke this invitation?"
        message={`The link emailed to ${revoking?.email ?? 'this person'} stops working straight away. You can send a new invitation later.`}
        confirmLabel="Revoke invitation"
        variant="danger"
        loading={revokeBusy}
      />
    </div>
  );
}
