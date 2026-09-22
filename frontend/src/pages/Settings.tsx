import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRightLeft,
  Building2,
  Check,
  Copy,
  KeyRound,
  Laptop,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  Sliders,
  UserRound,
} from 'lucide-react';
import api from '../services/apiClient';
import { useAccess, ROLE_LABEL } from '../hooks/useAccess';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Tabs, type TabItem } from '../components/ui/Tabs';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { EmptyState } from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { TwoFactorModal } from '../components/modals/TwoFactorModal';
import { AccountSecurityModal } from '../components/modals/AccountSecurityModal';
import { LockPasswordsModal } from '../components/modals/LockPasswordsModal';
import { BreakSettingsModal } from '../components/modals/BreakSettingsModal';

interface OrganisationSettings {
  id: string;
  name: string;
  portal_slug?: string;
  portal_url?: string;
  break_mins_weekday: number;
  break_mins_weekend: number;
  break_threshold_hours: number;
  has_roster_lock_password: boolean;
  has_timesheet_lock_password: boolean;
}

interface BranchAdminOption {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
}

type TabId = 'account' | 'organisation' | 'security' | 'ownership';

const errorMessage = (err: any, fallback: string): string => err?.response?.data?.error?.message || fallback;

function SectionHeader({ icon, title, description, action }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div>
          <h2 className="text-sm font-bold text-[var(--text)]">{title}</h2>
          <p className="text-xs text-[var(--muted)]">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

export default function Settings() {
  const toast = useToast();
  const navigate = useNavigate();
  const { access, can, refresh } = useAccess();
  const canManageOrganisation = can('organisation.manage');
  const canManageSecurity = can('security.manage');
  const [searchParams, setSearchParams] = useSearchParams();

  const tabs: TabItem[] = [
    { id: 'account', label: 'My account', icon: <UserRound className="w-3.5 h-3.5" /> },
    ...(canManageOrganisation ? [{ id: 'organisation', label: 'Organisation', icon: <Building2 className="w-3.5 h-3.5" /> }] : []),
    ...(canManageSecurity ? [
      { id: 'security', label: 'Security', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
      { id: 'ownership', label: 'Ownership', icon: <ArrowRightLeft className="w-3.5 h-3.5" /> },
    ] : []),
  ];
  const requestedTab = searchParams.get('tab');
  const activeTab = (tabs.some(t => t.id === requestedTab) ? requestedTab : 'account') as TabId;
  const selectTab = (id: string) => setSearchParams(id === 'account' ? {} : { tab: id }, { replace: true });

  // My account
  const [fullName, setFullName] = useState(access?.user.full_name || '');
  const [savingName, setSavingName] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [show2FAModal, setShow2FAModal] = useState(false);
  const [twoFactorChanged, setTwoFactorChanged] = useState(false);
  const [showActivityModal, setShowActivityModal] = useState(false);

  // Owner sections
  const [org, setOrg] = useState<OrganisationSettings | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [savingDisplayName, setSavingDisplayName] = useState(false);
  const [showBreakModal, setShowBreakModal] = useState(false);
  const [showLockModal, setShowLockModal] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Ownership transfer
  const [branchAdmins, setBranchAdmins] = useState<BranchAdminOption[] | null>(null);
  const [transferTo, setTransferTo] = useState('');
  const [transferPassword, setTransferPassword] = useState('');
  const [transferError, setTransferError] = useState<string | null>(null);
  const [showTransferConfirm, setShowTransferConfirm] = useState(false);
  const [transferring, setTransferring] = useState(false);

  const fetchOrganisation = async () => {
    try {
      const res = await api.get('/organisation/me');
      setOrg(res.data.data);
      setDisplayName(res.data.data.name || '');
      setOrgError(null);
    } catch (err: any) {
      setOrgError(errorMessage(err, 'Organisation settings could not be loaded.'));
    }
  };

  useEffect(() => {
    if (canManageOrganisation || canManageSecurity) fetchOrganisation();
  }, [canManageOrganisation, canManageSecurity]);

  useEffect(() => {
    if (activeTab !== 'ownership' || !canManageSecurity || branchAdmins !== null) return;
    api.get('/branch-admins')
      .then(res => setBranchAdmins((res.data.data?.branch_admins || []).filter((a: BranchAdminOption) => a.is_active)))
      .catch(err => {
        setBranchAdmins([]);
        setTransferError(errorMessage(err, 'Branch Admins could not be loaded.'));
      });
  }, [activeTab, canManageSecurity, branchAdmins]);

  if (!access) return null;

  // --- My account -----------------------------------------------------------
  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error('Enter your name.');
      return;
    }
    setSavingName(true);
    try {
      await api.put('/auth/me', { full_name: fullName.trim() });
      toast.success('Your name has been updated.');
      refresh();
    } catch (err: any) {
      toast.error(errorMessage(err, 'Your name could not be updated.'));
    } finally {
      setSavingName(false);
    }
  };

  const handleSendReset = async () => {
    setSendingReset(true);
    try {
      await api.post('/auth/forgot-password', { email: access.user.email });
      toast.success(`We have emailed a password reset link to ${access.user.email}.`);
    } catch (err: any) {
      toast.error(errorMessage(err, 'The reset link could not be sent. Try again in a few minutes.'));
    } finally {
      setSendingReset(false);
    }
  };

  const handleClose2FA = () => {
    setShow2FAModal(false);
    if (twoFactorChanged) {
      setTwoFactorChanged(false);
      refresh();
    }
  };

  // --- Organisation -----------------------------------------------------------
  const handleSaveDisplayName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      toast.error('Enter an organisation name.');
      return;
    }
    setSavingDisplayName(true);
    try {
      await api.put('/organisation/settings', { name: displayName.trim() });
      toast.success('Organisation name saved.');
      refresh();
    } catch (err: any) {
      toast.error(errorMessage(err, 'The organisation name could not be saved.'));
    } finally {
      setSavingDisplayName(false);
    }
  };

  // --- Security ----------------------------------------------------------------
  const handleCopyLink = async () => {
    if (!org?.portal_url) return;
    try {
      await navigator.clipboard.writeText(org.portal_url);
      setCopied(true);
      toast.success('Sign-in link copied.');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('The link could not be copied. Select it and copy it manually.');
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res = await api.post('/organisation/regenerate-portal-url');
      const { portal_slug, portal_url } = res.data.data;
      setOrg(prev => (prev ? { ...prev, portal_slug, portal_url } : prev));
      localStorage.setItem('last_org_slug', portal_slug);
      toast.success(res.data?.message || 'A new sign-in link has been created.');
      setShowRegenerateModal(false);
    } catch (err: any) {
      toast.error(errorMessage(err, 'The sign-in link could not be regenerated.'));
    } finally {
      setRegenerating(false);
    }
  };

  // --- Ownership ---------------------------------------------------------------
  const transferTarget = branchAdmins?.find(a => a.id === transferTo) || null;

  const handleRequestTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferTarget) {
      setTransferError('Choose the Branch Admin who will become the owner.');
      return;
    }
    if (!transferPassword) {
      setTransferError('Enter your password to confirm.');
      return;
    }
    setTransferError(null);
    setShowTransferConfirm(true);
  };

  const handleTransfer = async () => {
    if (!transferTarget) return;
    setTransferring(true);
    try {
      const res = await api.post('/organisation/transfer-ownership', {
        user_id: transferTarget.id,
        current_password: transferPassword,
      });
      toast.success(res.data?.message || `${transferTarget.email} is now the organisation owner.`);
      setShowTransferConfirm(false);
      // This account is now a Branch Admin: leave the owner settings, then reload what it may do.
      navigate('/dashboard', { replace: true });
      await refresh();
    } catch (err: any) {
      setTransferError(errorMessage(err, 'Ownership could not be transferred.'));
      setShowTransferConfirm(false);
      setTransferring(false);
    }
  };

  const orgUnavailable = orgError && (
    <EmptyState
      icon={<Building2 className="w-5 h-5" />}
      title="Organisation settings could not be loaded"
      description={orgError}
      actionLabel="Try again"
      onAction={fetchOrganisation}
    />
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Settings</h1>
          <p className="text-xs text-[var(--muted)] mt-1">
            {canManageOrganisation ? 'Your account, your organisation and its security.' : 'Your account and sign-in security.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="purple" size="md">{ROLE_LABEL[access.role]}</Badge>
          <span className="text-xs font-semibold text-[var(--text)] bg-[var(--panel-subtle)] px-2.5 py-1 rounded-md border border-[var(--border)]">
            {access.organisation.name}
          </span>
        </div>
      </div>

      {tabs.length > 1 && (
        <Tabs tabs={tabs} activeTab={activeTab} onChange={selectTab} variant="underline" className="overflow-x-auto" />
      )}

      {/* MY ACCOUNT (everyone) */}
      {activeTab === 'account' && (
        <div className="space-y-6">
          <Card className="p-6 space-y-4">
            <SectionHeader icon={<UserRound className="w-4 h-4" />} title="Your details" description="How your name appears to others in this organisation." />
            <form onSubmit={handleSaveName} className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <Input label="Email" value={access.user.email} disabled helperText="Your sign-in email cannot be changed here." />
              <Input label="Name" value={fullName} onChange={e => setFullName(e.target.value)} maxLength={120} required />
              <div className="sm:col-span-2 flex justify-end">
                <Button type="submit" variant="primary" size="sm" loading={savingName} disabled={fullName.trim() === (access.user.full_name || '')}>
                  Save name
                </Button>
              </div>
            </form>
          </Card>

          <Card className="p-6 space-y-4">
            <SectionHeader
              icon={<KeyRound className="w-4 h-4" />}
              title="Password"
              description={`We email a reset link to ${access.user.email}. It expires after an hour.`}
              action={(
                <Button variant="outline" size="sm" onClick={handleSendReset} loading={sendingReset} leftIcon={<Mail className="w-3.5 h-3.5" />}>
                  Email me a reset link
                </Button>
              )}
            />
            <p className="text-xs text-[var(--muted)]">Your password is shared by every organisation you sign in to with this email.</p>
          </Card>

          <Card className="p-6 space-y-4">
            <SectionHeader
              icon={<ShieldCheck className="w-4 h-4" />}
              title="Two-step verification"
              description="A code is emailed to you each time you sign in."
              action={(
                <div className="flex items-center gap-2">
                  <Badge variant={access.user.two_factor_enabled ? 'success' : 'warning'} size="sm">
                    {access.user.two_factor_enabled ? 'On' : 'Off'}
                  </Badge>
                  <Button variant="outline" size="sm" onClick={() => setShow2FAModal(true)}>
                    {access.user.two_factor_enabled ? 'Manage' : 'Turn on'}
                  </Button>
                </div>
              )}
            />
            <p className="text-xs text-[var(--muted)]">Recommended for everyone who can approve timesheets or change rosters.</p>
          </Card>

          <Card className="p-6 space-y-4">
            <SectionHeader
              icon={<Laptop className="w-4 h-4" />}
              title="Sign-in activity"
              description="Devices signed in to your account, and recent sign-ins."
              action={(
                <Button variant="outline" size="sm" onClick={() => setShowActivityModal(true)} leftIcon={<Laptop className="w-3.5 h-3.5" />}>
                  View activity
                </Button>
              )}
            />
            <p className="text-xs text-[var(--muted)]">Sign out any device you don't recognise. Sessions end automatically after 15 minutes without activity.</p>
          </Card>
        </div>
      )}

      {/* ORGANISATION (Organisation Owner) */}
      {activeTab === 'organisation' && canManageOrganisation && (
        orgUnavailable || (
          <div className="space-y-6">
            <Card className="p-6 space-y-4">
              <SectionHeader icon={<Building2 className="w-4 h-4" />} title="Organisation name" description="Shown on your sign-in page, reports and exports." />
              <form onSubmit={handleSaveDisplayName} className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="flex-1">
                  <Input label="Display name" value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={120} required disabled={!org} />
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  loading={savingDisplayName}
                  disabled={!org || displayName.trim() === (org.name || '')}
                >
                  Save
                </Button>
              </form>
            </Card>

            <Card className="p-6 space-y-4">
              <SectionHeader
                icon={<Sliders className="w-4 h-4" />}
                title="Break rules"
                description="The unpaid break taken off each day's hours, in every branch."
                action={(
                  <Button variant="outline" size="sm" onClick={() => setShowBreakModal(true)} leftIcon={<Sliders className="w-3.5 h-3.5" />}>
                    Change break rules
                  </Button>
                )}
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div className="p-3.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)]">
                  <div className="text-[var(--muted)]">Threshold</div>
                  <div className="text-xl font-bold text-[var(--text)] mt-1 font-mono">{org?.break_threshold_hours ?? '—'} h</div>
                  <div className="text-[10px] text-[var(--muted)] mt-0.5">Days at least this long get a break</div>
                </div>
                <div className="p-3.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)]">
                  <div className="text-[var(--muted)]">Weekday break</div>
                  <div className="text-xl font-bold text-[var(--text)] mt-1 font-mono">{org?.break_mins_weekday ?? '—'} min</div>
                  <div className="text-[10px] text-[var(--muted)] mt-0.5">Monday to Friday</div>
                </div>
                <div className="p-3.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)]">
                  <div className="text-[var(--muted)]">Weekend break</div>
                  <div className="text-xl font-bold text-[var(--text)] mt-1 font-mono">{org?.break_mins_weekend ?? '—'} min</div>
                  <div className="text-[10px] text-[var(--muted)] mt-0.5">Saturday and Sunday</div>
                </div>
              </div>
            </Card>
          </div>
        )
      )}

      {/* SECURITY (Organisation Owner) */}
      {activeTab === 'security' && canManageSecurity && (
        orgUnavailable || (
          <div className="space-y-6">
            <Card className="p-6 space-y-4">
              <SectionHeader
                icon={<Lock className="w-4 h-4" />}
                title="Private sign-in link"
                description="Your organisation's own sign-in page. Share it only with your Branch Admins."
              />
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex-1 min-w-0 px-3.5 py-2.5 rounded-lg bg-[var(--input-bg)] border border-[var(--border)] font-mono text-xs text-[var(--text)] select-all truncate">
                  {org?.portal_url || 'Loading…'}
                </div>
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleCopyLink}
                  disabled={!org?.portal_url}
                  leftIcon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                >
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => setShowRegenerateModal(true)}
                  disabled={!org}
                  leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                >
                  Regenerate
                </Button>
              </div>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Knowing the link does not give anyone access: people still need an account in {access.organisation.name}.
                If the link has been shared too widely, regenerate it and send the new one to your Branch Admins.
              </p>
            </Card>

            <Card className="p-6 space-y-4">
              <SectionHeader
                icon={<Lock className="w-4 h-4" />}
                title="Lock passwords"
                description="Optional shared passwords for locking and unlocking rosters and timesheets."
                action={(
                  <Button variant="outline" size="sm" onClick={() => setShowLockModal(true)} disabled={!org} leftIcon={<Lock className="w-3.5 h-3.5" />}>
                    Change lock passwords
                  </Button>
                )}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="p-3.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)]">
                  <div className="text-[var(--muted)]">Roster lock</div>
                  <div className="text-sm font-semibold text-[var(--text)] mt-1">
                    {org?.has_roster_lock_password ? 'Lock password set' : 'Account passwords only'}
                  </div>
                </div>
                <div className="p-3.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)]">
                  <div className="text-[var(--muted)]">Timesheet lock</div>
                  <div className="text-sm font-semibold text-[var(--text)] mt-1">
                    {org?.has_timesheet_lock_password ? 'Lock password set' : 'Account passwords only'}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )
      )}

      {/* OWNERSHIP (Organisation Owner) */}
      {activeTab === 'ownership' && canManageSecurity && (
        <Card className="p-6 space-y-4">
          <SectionHeader
            icon={<ArrowRightLeft className="w-4 h-4" />}
            title="Transfer ownership"
            description="Hand the organisation over to one of your current Branch Admins."
          />
          <ul className="text-xs text-[var(--muted)] leading-relaxed list-disc pl-5 space-y-1">
            <li>The new owner gets full control, including settings, branches, Branch Admins and the audit log.</li>
            <li>You become a Branch Admin of every active branch. The new owner can change or remove your access.</li>
            <li>An organisation has exactly one owner, and only the new owner can transfer it back.</li>
          </ul>

          {branchAdmins === null ? (
            <p className="text-xs text-[var(--muted)]">Loading Branch Admins…</p>
          ) : branchAdmins.length === 0 ? (
            <EmptyState
              icon={<UserRound className="w-5 h-5" />}
              title="No Branch Admins yet"
              description="Ownership can only go to someone who is already a Branch Admin here. Invite them first."
              action={<Link to="/branch-admins"><Button variant="outline" size="sm">Go to Branch Admins</Button></Link>}
            />
          ) : (
            <form onSubmit={handleRequestTransfer} className="space-y-4 max-w-md">
              {transferError && (
                <div className="p-3 rounded-md text-xs bg-[var(--danger-light)] border border-[var(--danger)]/30 text-[var(--danger)]">
                  {transferError}
                </div>
              )}
              <Select label="New owner" value={transferTo} onChange={e => setTransferTo(e.target.value)} required>
                <option value="" disabled>Choose a Branch Admin…</option>
                {branchAdmins.map(a => (
                  <option key={a.id} value={a.id}>{a.full_name ? `${a.full_name} (${a.email})` : a.email}</option>
                ))}
              </Select>
              <Input
                label="Your password"
                type="password"
                autoComplete="current-password"
                value={transferPassword}
                onChange={e => setTransferPassword(e.target.value)}
                required
              />
              <Button type="submit" variant="danger" size="sm" leftIcon={<ArrowRightLeft className="w-3.5 h-3.5" />}>
                Transfer ownership
              </Button>
            </form>
          )}
        </Card>
      )}

      {/* Modals */}
      <TwoFactorModal isOpen={show2FAModal} onClose={handleClose2FA} onChange={() => setTwoFactorChanged(true)} />
      <AccountSecurityModal isOpen={showActivityModal} onClose={() => setShowActivityModal(false)} />
      {canManageOrganisation && (
        <BreakSettingsModal isOpen={showBreakModal} onClose={() => { setShowBreakModal(false); fetchOrganisation(); }} />
      )}
      {canManageSecurity && (
        <>
          <LockPasswordsModal
            isOpen={showLockModal}
            onClose={() => { setShowLockModal(false); fetchOrganisation(); }}
            hasRosterLockPassword={org?.has_roster_lock_password}
            hasTimesheetLockPassword={org?.has_timesheet_lock_password}
          />
          <ConfirmModal
            isOpen={showRegenerateModal}
            onClose={() => setShowRegenerateModal(false)}
            onConfirm={handleRegenerate}
            title="Regenerate the sign-in link?"
            message="The current link stops working straight away. Anyone who uses it, including your Branch Admins, will need the new link."
            confirmLabel="Regenerate link"
            variant="warning"
            loading={regenerating}
          />
          <ConfirmModal
            isOpen={showTransferConfirm}
            onClose={() => setShowTransferConfirm(false)}
            onConfirm={handleTransfer}
            title={`Make ${transferTarget?.full_name || transferTarget?.email || 'this person'} the owner?`}
            message={`${transferTarget?.email ?? 'They'} will own ${access.organisation.name}. You will become a Branch Admin of every active branch and lose access to owner settings.`}
            confirmLabel="Transfer ownership"
            variant="danger"
            loading={transferring}
          />
        </>
      )}
    </div>
  );
}
