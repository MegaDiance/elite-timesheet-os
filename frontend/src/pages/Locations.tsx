import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  Plus, 
  MapPin, 
  Globe, 
  Users, 
  Mail, 
  Check, 
  Copy, 
  Edit2, 
  Power, 
  Search, 
  ShieldCheck
} from 'lucide-react';
import api from '../services/apiClient';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useToast } from '../components/ui/Toast';

interface LocationItem {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  is_active: boolean;
  active_staff_count?: number;
  managers?: Array<{ id: string; email: string; role: string }>;
  created_at: string;
}

const TIMEZONES = [
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEDT/AEST)' },
  { value: 'Australia/Melbourne', label: 'Australia/Melbourne (AEDT/AEST)' },
  { value: 'Australia/Brisbane', label: 'Australia/Brisbane (AEST - No DST)' },
  { value: 'Australia/Perth', label: 'Australia/Perth (AWST)' },
  { value: 'Australia/Adelaide', label: 'Australia/Adelaide (ACDT/ACST)' },
  { value: 'Australia/Hobart', label: 'Australia/Hobart (AEDT/AEST)' },
  { value: 'Australia/Darwin', label: 'Australia/Darwin (ACST)' },
  { value: 'UTC', label: 'UTC' }
];

export default function Locations() {
  const toast = useToast();
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all');

  // Add / Edit Modal state
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<LocationItem | null>(null);
  const [locName, setLocName] = useState('');
  const [locAddress, setLocAddress] = useState('');
  const [locTimezone, setLocTimezone] = useState('Australia/Sydney');
  const [savingLocation, setSavingLocation] = useState(false);

  // Invite Modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [targetLocation, setTargetLocation] = useState<LocationItem | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'manager' | 'admin' | 'employee'>('manager');
  const [inviting, setInviting] = useState(false);
  const [inviteSuccessData, setInviteSuccessData] = useState<{ invite_url: string; email: string; delivery_status: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Deactivate Confirm Modal state
  const [deactivatingLocation, setDeactivatingLocation] = useState<LocationItem | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    setLoading(true);
    try {
      const res = await api.get('/locations?include_inactive=true');
      if (res.data?.success && Array.isArray(res.data.data)) {
        setLocations(res.data.data);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Failed to load locations.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingLocation(null);
    setLocName('');
    setLocAddress('');
    setLocTimezone('Australia/Sydney');
    setShowLocationModal(true);
  };

  const handleOpenEdit = (loc: LocationItem) => {
    setEditingLocation(loc);
    setLocName(loc.name);
    setLocAddress(loc.address || '');
    setLocTimezone(loc.timezone || 'Australia/Sydney');
    setShowLocationModal(true);
  };

  const handleSaveLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locName.trim()) {
      toast.error('Location name is required');
      return;
    }

    setSavingLocation(true);
    try {
      if (editingLocation) {
        const res = await api.put(`/locations/${editingLocation.id}`, {
          name: locName.trim(),
          address: locAddress.trim() || null,
          timezone: locTimezone
        });
        if (res.data?.success) {
          toast.success(`Location "${locName.trim()}" updated successfully`);
          setShowLocationModal(false);
          fetchLocations();
        }
      } else {
        const res = await api.post('/locations', {
          name: locName.trim(),
          address: locAddress.trim() || null,
          timezone: locTimezone
        });
        if (res.data?.success) {
          toast.success(`Location "${locName.trim()}" created successfully`);
          setShowLocationModal(false);
          fetchLocations();
        }
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Failed to save location.');
    } finally {
      setSavingLocation(false);
    }
  };

  const handleToggleActive = async (loc: LocationItem) => {
    if (loc.is_active) {
      setDeactivatingLocation(loc);
    } else {
      try {
        const res = await api.post(`/locations/${loc.id}/reactivate`);
        if (res.data?.success) {
          toast.success(`Location "${loc.name}" reactivated`);
          fetchLocations();
        }
      } catch (err: any) {
        toast.error(err.response?.data?.error?.message || 'Failed to reactivate location.');
      }
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivatingLocation) return;
    setDeactivating(true);
    try {
      const res = await api.post(`/locations/${deactivatingLocation.id}/deactivate`);
      if (res.data?.success) {
        toast.success(`Location "${deactivatingLocation.name}" deactivated`);
        setDeactivatingLocation(null);
        fetchLocations();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Failed to deactivate location.');
    } finally {
      setDeactivating(false);
    }
  };

  const handleOpenInvite = (loc: LocationItem) => {
    setTargetLocation(loc);
    setInviteEmail('');
    setInviteRole('manager');
    setInviteSuccessData(null);
    setCopiedLink(false);
    setShowInviteModal(true);
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetLocation || !inviteEmail.trim()) return;

    setInviting(true);
    try {
      const res = await api.post(`/locations/${targetLocation.id}/invite`, {
        email: inviteEmail.trim(),
        role: inviteRole
      });
      if (res.data?.success) {
        toast.success(res.data.message || `Invitation dispatched to ${inviteEmail.trim()}`);
        setInviteSuccessData({
          invite_url: res.data.data.invite_url,
          email: inviteEmail.trim(),
          delivery_status: res.data.data.delivery_status
        });
        fetchLocations();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || 'Failed to invite manager.');
    } finally {
      setInviting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!inviteSuccessData?.invite_url) return;
    try {
      await navigator.clipboard.writeText(inviteSuccessData.invite_url);
      setCopiedLink(true);
      toast.success('Invitation URL copied to clipboard');
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  // Filtered locations
  const filtered = locations.filter(loc => {
    const matchesSearch = loc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (loc.address && loc.address.toLowerCase().includes(searchQuery.toLowerCase()));
    if (!matchesSearch) return false;
    if (filterActive === 'active') return loc.is_active;
    if (filterActive === 'inactive') return !loc.is_active;
    return true;
  });

  const totalLocations = locations.length;
  const activeLocations = locations.filter(l => l.is_active).length;
  const totalStaff = locations.reduce((sum, l) => sum + (l.active_staff_count || 0), 0);

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12 font-['Inter',sans-serif]">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-md bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center">
              <Building2 className="w-3.5 h-3.5" />
            </div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--primary)]">
              Multi-Location Hierarchy
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
            Locations Management
          </h1>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Configure branches, assign operational managers, and enforce strict location isolation.
          </p>
        </div>

        <Button
          variant="primary"
          size="md"
          onClick={handleOpenAdd}
          leftIcon={<Plus className="w-4 h-4" />}
          className="shadow-sm"
        >
          Add Location
        </Button>
      </div>

      {/* Metrics Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Total Locations</div>
            <div className="text-2xl font-bold text-[var(--text)] mt-1">{totalLocations}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
        </Card>

        <Card className="p-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Active Branches</div>
            <div className="text-2xl font-bold text-emerald-500 mt-1">{activeLocations}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
        </Card>

        <Card className="p-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Assigned Staff</div>
            <div className="text-2xl font-bold text-[var(--primary)] mt-1">{totalStaff}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
        </Card>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="text"
            placeholder="Search locations by name or address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl pl-9 pr-4 py-2 text-xs text-[var(--text)] placeholder-[var(--muted)] outline-none focus:border-[var(--primary)] transition-colors"
          />
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-xl self-start sm:self-auto">
          <button
            onClick={() => setFilterActive('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filterActive === 'all' 
                ? 'bg-[var(--panel)] text-[var(--text)] shadow-xs' 
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            All ({locations.length})
          </button>
          <button
            onClick={() => setFilterActive('active')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filterActive === 'active' 
                ? 'bg-[var(--panel)] text-emerald-500 shadow-xs' 
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            Active ({activeLocations})
          </button>
          <button
            onClick={() => setFilterActive('inactive')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filterActive === 'inactive' 
                ? 'bg-[var(--panel)] text-[var(--muted)] shadow-xs' 
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            Inactive ({totalLocations - activeLocations})
          </button>
        </div>
      </div>

      {/* Locations List */}
      {loading ? (
        <div className="py-16 text-center text-xs text-[var(--muted)] flex items-center justify-center gap-2">
          <div className="w-4 h-4 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin"></div>
          <span>Loading locations...</span>
        </div>
      ) : filtered.length === 0 ? (
        <Card className="py-16 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-[var(--panel-subtle)] border border-[var(--border)] text-[var(--muted)] flex items-center justify-center mx-auto">
            <Building2 className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-[var(--text)]">No locations found</h3>
          <p className="text-xs text-[var(--muted)] max-w-sm mx-auto">
            {searchQuery 
              ? `No locations matched "${searchQuery}". Try a different search.` 
              : 'Add your first branch or site location to begin organizing your workforce.'}
          </p>
          {!searchQuery && (
            <div className="pt-2">
              <Button variant="primary" size="sm" onClick={handleOpenAdd} leftIcon={<Plus className="w-3.5 h-3.5" />}>
                Create Primary Location
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(loc => (
            <Card key={loc.id} className={`p-5 space-y-4 border transition-all ${!loc.is_active ? 'opacity-70 bg-[var(--panel-subtle)]/40' : 'hover:border-[var(--primary)]/40'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    loc.is_active ? 'bg-[var(--primary-light)] text-[var(--primary)]' : 'bg-zinc-500/10 text-zinc-400'
                  }`}>
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-[var(--text)] truncate">{loc.name}</h3>
                      <Badge variant={loc.is_active ? 'success' : 'default'} size="sm">
                        {loc.is_active ? 'Active' : 'Deactivated'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-[var(--muted)] mt-1 truncate">
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{loc.address || 'No street address specified'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleOpenEdit(loc)}
                    className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] transition-colors"
                    title="Edit Location"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleToggleActive(loc)}
                    className={`p-1.5 rounded-lg transition-colors ${
                      loc.is_active ? 'text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10' : 'text-emerald-500 hover:bg-emerald-500/10'
                    }`}
                    title={loc.is_active ? 'Deactivate Location' : 'Reactivate Location'}
                  >
                    <Power className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Location Details & Stats */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--border)] text-xs">
                <div className="p-2.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)]">
                  <div className="text-[10px] uppercase font-semibold text-[var(--muted)] flex items-center gap-1">
                    <Users className="w-3 h-3" /> Staff Count
                  </div>
                  <div className="text-xs font-bold text-[var(--text)] mt-0.5">
                    {loc.active_staff_count || 0} active employees
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)]">
                  <div className="text-[10px] uppercase font-semibold text-[var(--muted)] flex items-center gap-1">
                    <Globe className="w-3 h-3" /> Timezone
                  </div>
                  <div className="text-xs font-bold text-[var(--text)] mt-0.5 truncate" title={loc.timezone}>
                    {loc.timezone ? loc.timezone.split('/')[1]?.replace('_', ' ') || loc.timezone : 'Sydney'}
                  </div>
                </div>
              </div>

              {/* Location Managers */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-[var(--muted)] uppercase tracking-wider">
                    Location Managers
                  </span>
                  <button
                    onClick={() => handleOpenInvite(loc)}
                    disabled={!loc.is_active}
                    className="text-[var(--primary)] hover:underline font-bold text-[11px] disabled:opacity-50 flex items-center gap-1"
                  >
                    <Mail className="w-3 h-3" />
                    <span>Invite Manager</span>
                  </button>
                </div>

                {loc.managers && loc.managers.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {loc.managers.map((m) => (
                      <span
                        key={m.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--panel-subtle)] border border-[var(--border)] text-[11px] font-medium text-[var(--text)]"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        <span className="truncate max-w-[150px]">{m.email}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-[var(--muted)] italic">
                    No manager directly assigned. Organisation owner oversees this branch.
                  </p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ADD / EDIT LOCATION MODAL */}
      <Modal
        isOpen={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        title={editingLocation ? `Edit "${editingLocation.name}"` : 'Create New Location'}
        maxWidth="md"
      >
        <form onSubmit={handleSaveLocation} className="space-y-4">
          <Input
            label="Location / Branch Name *"
            placeholder="e.g. Sydney Central Office, Westside Warehouse"
            value={locName}
            onChange={(e) => setLocName(e.target.value)}
            required
            autoFocus
          />

          <Input
            label="Street Address"
            placeholder="e.g. 100 Main Street, Suite 400"
            value={locAddress}
            onChange={(e) => setLocAddress(e.target.value)}
          />

          <div>
            <label className="block text-xs font-semibold text-[var(--text)] mb-1.5">
              Operating Timezone
            </label>
            <select
              value={locTimezone}
              onChange={(e) => setLocTimezone(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border)] rounded-xl text-xs text-[var(--text)] outline-none focus:border-[var(--primary)]"
            >
              {TIMEZONES.map(tz => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-[var(--muted)] mt-1">
              Rosters and shift timestamps for this location will snap to this timezone.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--border)]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowLocationModal(false)}
              disabled={savingLocation}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={savingLocation}
            >
              {editingLocation ? 'Save Changes' : 'Create Location'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* INVITE LOCATION MANAGER MODAL */}
      <Modal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title={`Invite Workforce Member — ${targetLocation?.name || ''}`}
        maxWidth="md"
      >
        {!inviteSuccessData ? (
          <form onSubmit={handleSendInvite} className="space-y-4">
            <div className="p-3 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-xl space-y-1">
              <div className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[var(--primary)]" />
                <span>Strict Location Isolation Enforced</span>
              </div>
              <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                Invited managers gain operational access only to <strong>{targetLocation?.name}</strong>. They cannot view or manage employees, rosters, or timesheets in other branches.
              </p>
            </div>

            <Input
              label="Manager Email Address *"
              type="email"
              placeholder="manager@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              autoFocus
              leftIcon={<Mail className="w-4 h-4" />}
            />

            <div>
              <label className="block text-xs font-semibold text-[var(--text)] mb-1.5">
                Role within this Location
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setInviteRole('manager')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    inviteRole === 'manager'
                      ? 'border-[var(--primary)] bg-[var(--primary-light)]/20 text-[var(--primary)]'
                      : 'border-[var(--border)] hover:bg-[var(--panel-subtle)] text-[var(--text)]'
                  }`}
                >
                  <div className="text-xs font-bold">Location Manager</div>
                  <div className="text-[10px] text-[var(--muted)] mt-0.5">Rosters, timesheets & approvals</div>
                </button>

                <button
                  type="button"
                  onClick={() => setInviteRole('admin')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    inviteRole === 'admin'
                      ? 'border-[var(--primary)] bg-[var(--primary-light)]/20 text-[var(--primary)]'
                      : 'border-[var(--border)] hover:bg-[var(--panel-subtle)] text-[var(--text)]'
                  }`}
                >
                  <div className="text-xs font-bold">Location Admin</div>
                  <div className="text-[10px] text-[var(--muted)] mt-0.5">Full location configuration</div>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--border)]">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowInviteModal(false)}
                disabled={inviting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={inviting}
                leftIcon={<Mail className="w-3.5 h-3.5" />}
              >
                Send Invitation
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4 text-center py-2">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto">
              <Check className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text)]">Invitation Link Ready</h3>
              <p className="text-xs text-[var(--muted)] mt-1">
                {inviteSuccessData.delivery_status === 'delivered' || inviteSuccessData.delivery_status === 'sent'
                  ? `An email has been dispatched to ${inviteSuccessData.email}. You can also share the direct link below:`
                  : `Email delivery could not be completed. Please share the direct invitation link below with ${inviteSuccessData.email}:`}
              </p>
            </div>

            <div className="p-3 bg-[var(--input-bg)] border border-[var(--border)] rounded-xl font-mono text-[11px] text-[var(--text)] break-all text-left select-all">
              {inviteSuccessData.invite_url}
            </div>

            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleCopyLink}
                leftIcon={copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              >
                {copiedLink ? 'Copied to Clipboard' : 'Copy Direct Link'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowInviteModal(false)}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* CONFIRM DEACTIVATE MODAL */}
      <ConfirmModal
        isOpen={!!deactivatingLocation}
        onClose={() => setDeactivatingLocation(null)}
        onConfirm={handleConfirmDeactivate}
        title={`Deactivate "${deactivatingLocation?.name}"?`}
        message={`Deactivating this location will prevent new rosters and shifts from being recorded. All historical timesheets, shifts, and audit records will remain permanently preserved.`}
        confirmLabel="Deactivate Location"
        variant="danger"
        loading={deactivating}
      />
    </div>
  );
}
