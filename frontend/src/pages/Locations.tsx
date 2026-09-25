import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  Edit2,
  Globe,
  MapPin,
  Plus,
  Power,
  Search,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react';
import api from '../services/apiClient';
import { useAccess } from '../hooks/useAccess';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { EmptyState } from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { friendlyError } from '../services/errors';

interface BranchItem {
  id: string;
  name: string;
  address: string | null;
  timezone: string | null;
  is_active: boolean;
  active_staff_count: number;
  admins: Array<{ id: string; email: string; full_name: string | null }>;
}

const TIMEZONES = [
  { value: 'Australia/Melbourne', label: 'Australia/Melbourne (AEST/AEDT)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT)' },
  { value: 'Australia/Brisbane', label: 'Australia/Brisbane (AEST, no daylight saving)' },
  { value: 'Australia/Adelaide', label: 'Australia/Adelaide (ACST/ACDT)' },
  { value: 'Australia/Darwin', label: 'Australia/Darwin (ACST)' },
  { value: 'Australia/Hobart', label: 'Australia/Hobart (AEST/AEDT)' },
  { value: 'Australia/Perth', label: 'Australia/Perth (AWST)' },
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland (NZST/NZDT)' },
  { value: 'UTC', label: 'UTC' },
];
const DEFAULT_TIMEZONE = 'Australia/Melbourne';

function timezoneLabel(tz: string | null): string {
  if (!tz) return DEFAULT_TIMEZONE.split('/')[1];
  return tz.includes('/') ? tz.split('/').pop()!.replace(/_/g, ' ') : tz;
}

export default function Locations() {
  const toast = useToast();
  const { can, refresh } = useAccess();
  const canManage = can('branches.manage');
  const canManageAdmins = can('branch_admins.manage');

  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all');

  // Create / edit
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BranchItem | null>(null);
  const [formName, setFormName] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formTimezone, setFormTimezone] = useState(DEFAULT_TIMEZONE);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Deactivate / reactivate
  const [deactivating, setDeactivating] = useState<BranchItem | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchBranches = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get('/locations', { params: { include_inactive: 'true' } });
      setBranches(res.data.data || []);
    } catch (err: any) {
      setLoadError(friendlyError(err, 'Branches could not be loaded.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  /** Branch changes also change which branches the account can pick elsewhere, so the access list is reloaded too. */
  const afterChange = () => {
    fetchBranches();
    refresh();
  };

  const openCreate = () => {
    setEditing(null);
    setFormName('');
    setFormAddress('');
    setFormTimezone(DEFAULT_TIMEZONE);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (branch: BranchItem) => {
    setEditing(branch);
    setFormName(branch.name);
    setFormAddress(branch.address || '');
    setFormTimezone(branch.timezone || DEFAULT_TIMEZONE);
    setFormError(null);
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('Enter a branch name.');
      return;
    }
    setSaving(true);
    setFormError(null);
    const body = { name: formName.trim(), address: formAddress.trim() || null, timezone: formTimezone };
    try {
      if (editing) {
        await api.put(`/locations/${editing.id}`, body);
        toast.success(`Branch "${body.name}" updated.`);
      } else {
        await api.post('/locations', body);
        toast.success(`Branch "${body.name}" created.`);
      }
      setShowForm(false);
      afterChange();
    } catch (err: any) {
      setFormError(friendlyError(err, 'The branch could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const handleReactivate = async (branch: BranchItem) => {
    setTogglingId(branch.id);
    try {
      const res = await api.post(`/locations/${branch.id}/reactivate`);
      toast.success(res.data?.message || `Branch "${branch.name}" reactivated.`);
      afterChange();
    } catch (err: any) {
      toast.error(friendlyError(err, 'The branch could not be reactivated.'));
    } finally {
      setTogglingId(null);
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivating) return;
    const branch = deactivating;
    setTogglingId(branch.id);
    try {
      const res = await api.post(`/locations/${branch.id}/deactivate`);
      toast.success(res.data?.message || `Branch "${branch.name}" deactivated.`);
      setDeactivating(null);
      afterChange();
    } catch (err: any) {
      const code = err.response?.data?.error?.code;
      const message = err.response?.data?.error?.message;
      toast.error(code === 'LAST_BRANCH'
        ? message || 'An organisation needs at least one active branch.'
        : message || 'The branch could not be deactivated.');
      setDeactivating(null);
    } finally {
      setTogglingId(null);
    }
  };

  const q = searchQuery.trim().toLowerCase();
  const filtered = branches.filter(b => {
    const matches = !q || b.name.toLowerCase().includes(q) || (b.address || '').toLowerCase().includes(q);
    if (!matches) return false;
    if (filterActive === 'active') return b.is_active;
    if (filterActive === 'inactive') return !b.is_active;
    return true;
  });

  const activeCount = branches.filter(b => b.is_active).length;
  const workerCount = branches.reduce((sum, b) => sum + (b.active_staff_count || 0), 0);
  const timezoneOptions = TIMEZONES.some(t => t.value === formTimezone)
    ? TIMEZONES
    : [{ value: formTimezone, label: formTimezone }, ...TIMEZONES];

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Branches</h1>
          <p className="text-xs text-[var(--muted)] mt-1 max-w-2xl">
            {canManage
              ? 'Each worker belongs to one branch. Branch Admins manage the workers, roster and timesheets of the branches assigned to them.'
              : 'These are the branches assigned to you. Only the Organisation Owner can add or change branches.'}
          </p>
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            {canManageAdmins && (
              <Link to="/branch-admins">
                <Button variant="outline" size="md" leftIcon={<UserCog className="w-4 h-4" />}>
                  Branch Admins
                </Button>
              </Link>
            )}
            <Button variant="primary" size="md" onClick={openCreate} leftIcon={<Plus className="w-4 h-4" />}>
              Add branch
            </Button>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Branches</div>
            <div className="text-2xl font-bold text-[var(--text)] mt-1">{branches.length}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
        </Card>
        <Card className="p-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Active branches</div>
            <div className="text-2xl font-bold text-[var(--success)] mt-1">{activeCount}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[var(--success-light)] text-[var(--success)] flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
        </Card>
        <Card className="p-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Active workers</div>
            <div className="text-2xl font-bold text-[var(--primary)] mt-1">{workerCount}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
        </Card>
      </div>

      {/* Search & filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="text"
            placeholder="Search branches by name or address…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl pl-9 pr-4 py-2 text-xs text-[var(--text)] placeholder-[var(--muted)] outline-none focus:border-[var(--primary)] transition-colors"
          />
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-xl self-start sm:self-auto">
          {([
            ['all', `All (${branches.length})`],
            ['active', `Active (${activeCount})`],
            ['inactive', `Deactivated (${branches.length - activeCount})`],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilterActive(value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                filterActive === value ? 'bg-[var(--panel)] text-[var(--text)] shadow-xs' : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading && branches.length === 0 ? (
        <div className="py-16 text-center text-xs text-[var(--muted)] flex items-center justify-center gap-2">
          <div className="w-4 h-4 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
          <span>Loading branches…</span>
        </div>
      ) : loadError ? (
        <EmptyState
          icon={<Building2 className="w-5 h-5" />}
          title="Branches could not be loaded"
          description={loadError}
          actionLabel="Try again"
          onAction={fetchBranches}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Building2 className="w-5 h-5" />}
          title="No branches found"
          description={q ? `No branches match "${searchQuery}".` : 'There are no branches in this view.'}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(branch => (
            <Card
              key={branch.id}
              className={`p-5 space-y-4 ${branch.is_active ? 'hover:border-[var(--primary)]/40' : 'opacity-75 bg-[var(--panel-subtle)]'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    branch.is_active ? 'bg-[var(--primary-light)] text-[var(--primary)]' : 'bg-[var(--glass-8)] text-[var(--muted)]'
                  }`}>
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-[var(--text)] truncate">{branch.name}</h3>
                      <Badge variant={branch.is_active ? 'success' : 'default'} size="sm">
                        {branch.is_active ? 'Active' : 'Deactivated'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-[var(--muted)] mt-1">
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{branch.address || 'No address entered'}</span>
                    </div>
                  </div>
                </div>

                {canManage && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(branch)}
                      className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] transition-colors cursor-pointer"
                      title="Edit branch"
                      aria-label={`Edit ${branch.name}`}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => (branch.is_active ? setDeactivating(branch) : handleReactivate(branch))}
                      disabled={togglingId === branch.id}
                      className={`p-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${
                        branch.is_active
                          ? 'text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-light)]'
                          : 'text-[var(--success)] hover:bg-[var(--success-light)]'
                      }`}
                      title={branch.is_active ? 'Deactivate branch' : 'Reactivate branch'}
                      aria-label={branch.is_active ? `Deactivate ${branch.name}` : `Reactivate ${branch.name}`}
                    >
                      <Power className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--border)] text-xs">
                <div className="p-2.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)]">
                  <div className="text-[10px] uppercase font-semibold text-[var(--muted)] flex items-center gap-1">
                    <Users className="w-3 h-3" /> Workers
                  </div>
                  <div className="text-xs font-bold text-[var(--text)] mt-0.5">
                    {branch.active_staff_count || 0} active worker{branch.active_staff_count === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)]">
                  <div className="text-[10px] uppercase font-semibold text-[var(--muted)] flex items-center gap-1">
                    <Globe className="w-3 h-3" /> Time zone
                  </div>
                  <div className="text-xs font-bold text-[var(--text)] mt-0.5 truncate" title={branch.timezone || DEFAULT_TIMEZONE}>
                    {timezoneLabel(branch.timezone)}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-[var(--muted)] uppercase tracking-wider">Branch Admins</span>
                  {canManageAdmins && (
                    <Link to="/branch-admins" className="text-[var(--primary)] hover:underline font-bold">
                      Manage
                    </Link>
                  )}
                </div>
                {branch.admins.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {branch.admins.map(admin => (
                      <span
                        key={admin.id}
                        title={admin.email}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--panel-subtle)] border border-[var(--border)] text-[11px] font-medium text-[var(--text)]"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" />
                        <span className="truncate max-w-[180px]">{admin.full_name || admin.email}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-[var(--muted)] italic">
                    No Branch Admin assigned. The Organisation Owner manages this branch.
                  </p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create / edit */}
      {canManage && (
        <Modal
          isOpen={showForm}
          onClose={() => setShowForm(false)}
          title={editing ? `Edit ${editing.name}` : 'Add a branch'}
          maxWidth="md"
        >
          <form onSubmit={handleSave} className="space-y-4">
            {formError && (
              <div className="p-3 rounded-md text-xs bg-[var(--danger-light)] border border-[var(--danger)]/30 text-[var(--danger)]">
                {formError}
              </div>
            )}
            <Input
              label="Branch name"
              placeholder="e.g. Richmond"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              maxLength={120}
              required
              autoFocus
            />
            <Input
              label="Address (optional)"
              placeholder="e.g. 100 Swan Street, Richmond VIC"
              value={formAddress}
              onChange={e => setFormAddress(e.target.value)}
            />
            <Select
              label="Time zone"
              value={formTimezone}
              onChange={e => setFormTimezone(e.target.value)}
              options={timezoneOptions}
              helperText="Used to work out what 'today' is for this branch."
            />
            <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--border)]">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" loading={saving}>
                {editing ? 'Save changes' : 'Create branch'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmModal
        isOpen={Boolean(deactivating)}
        onClose={() => setDeactivating(null)}
        onConfirm={handleConfirmDeactivate}
        title={`Deactivate ${deactivating?.name ?? 'branch'}?`}
        message="Branch Admins lose access to this branch straight away. Its workers, rosters, timesheets and audit history are kept, and you can reactivate it at any time."
        confirmLabel="Deactivate branch"
        variant="danger"
        loading={Boolean(deactivating) && togglingId === deactivating?.id}
      />
    </div>
  );
}
