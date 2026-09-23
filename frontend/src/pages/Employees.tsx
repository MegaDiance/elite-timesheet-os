import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  CalendarDays,
  FileSpreadsheet,
  Mail,
  Phone,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import api from '../services/apiClient';
import SmartTimeInput from '../components/SmartTimeInput';
import { useAccess, type Branch } from '../hooks/useAccess';
import { useActiveBranch } from '../hooks/useActiveBranch';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { EmptyState } from '../components/ui/EmptyState';
import { TableSkeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';

const SEGMENT_TYPES = [
  { value: 'WORK', label: 'Normal Work' },
  { value: 'Sick', label: 'Sick Leave' },
  { value: 'Annual', label: 'Annual Leave' },
  { value: 'TIL', label: 'TIL' },
  { value: 'LWIP', label: 'LWIP' },
  { value: 'Other', label: 'Other' },
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface TemplateRow {
  day_index: number;
  segment_type: string;
  roster_in: string | null;
  roster_out: string | null;
  roster_hours: number | string | null;
  has_break?: boolean;
}

interface Worker {
  id: string;
  location_id: string;
  location_name: string | null;
  full_name: string;
  department: string | null;
  email: string | null;
  phone: string | null;
  contracted_hours: number | string | null;
  is_active: boolean;
  status: 'Active' | 'Inactive';
  template: TemplateRow[];
}

const errorMessage = (err: any, fallback: string): string => err?.response?.data?.error?.message || fallback;
const isActiveWorker = (w: Worker) => w.is_active;

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function Employees() {
  const toast = useToast();
  const { access, can } = useAccess();
  const { activeBranchId } = useActiveBranch();
  const branches = access?.branches ?? [];
  const activeBranches = branches.filter(b => b.is_active);
  const canManageHolidays = can('holidays.manage');

  // Defaults to, and follows, the branch switched in the sidebar; "All my branches" stays available below.
  const [branchFilter, setBranchFilter] = useState(activeBranchId || '');
  useEffect(() => {
    if (activeBranchId) setBranchFilter(activeBranchId);
  }, [activeBranchId]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');

  const [formWorker, setFormWorker] = useState<Worker | 'new' | null>(null);
  const [templateWorker, setTemplateWorker] = useState<Worker | null>(null);
  const [showHolidays, setShowHolidays] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ kind: 'deactivate' | 'delete'; worker: Worker } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  const reload = () => setReloadKey(k => k + 1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const params: Record<string, string> = {};
    if (branchFilter) params.location_id = branchFilter;
    if (includeInactive) params.include_inactive = 'true';
    api.get('/employees', { params })
      .then(res => {
        if (!cancelled) setWorkers(res.data.data || []);
      })
      .catch(err => {
        if (!cancelled) setLoadError(errorMessage(err, 'Workers could not be loaded.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [branchFilter, includeInactive, reloadKey]);

  const handleConfirmAction = async () => {
    if (!pendingAction) return;
    const { kind, worker } = pendingAction;
    setActionBusy(true);
    try {
      if (kind === 'deactivate') {
        await api.post(`/employees/${worker.id}/deactivate`);
        toast.success(`${worker.full_name} has been deactivated.`);
      } else {
        await api.delete(`/employees/${worker.id}`);
        toast.success(`${worker.full_name} has been deleted.`);
      }
      reload();
    } catch (err: any) {
      toast.error(errorMessage(err, kind === 'delete' ? 'The worker could not be deleted.' : 'The worker could not be deactivated.'));
    } finally {
      setActionBusy(false);
      setPendingAction(null);
    }
  };

  const handleReactivate = async (worker: Worker) => {
    setReactivatingId(worker.id);
    try {
      await api.post(`/employees/${worker.id}/reactivate`);
      toast.success(`${worker.full_name} has been reactivated.`);
      reload();
    } catch (err: any) {
      toast.error(errorMessage(err, 'The worker could not be reactivated.'));
    } finally {
      setReactivatingId(null);
    }
  };

  const departments = Array.from(new Set(workers.map(w => w.department).filter(Boolean) as string[])).sort();

  const q = searchQuery.trim().toLowerCase();
  const filtered = workers.filter(w => {
    const matchesSearch = !q
      || w.full_name.toLowerCase().includes(q)
      || (w.email || '').toLowerCase().includes(q)
      || (w.phone || '').includes(q);
    const matchesDept = !departmentFilter || w.department === departmentFilter;
    return matchesSearch && matchesDept;
  });

  const handleExportCsv = () => {
    const headers = ['Full name', 'Branch', 'Department', 'Email', 'Phone', 'Contracted hours per fortnight', 'Status'];
    const rows = filtered.map(w => [
      w.full_name,
      w.location_name || '',
      w.department || '',
      w.email || '',
      w.phone || '',
      Number(w.contracted_hours ?? 0),
      isActiveWorker(w) ? 'Active' : 'Deactivated',
    ]);
    const csv = [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `workers-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const defaultBranchId = activeBranches.some(b => b.id === branchFilter)
    ? branchFilter
    : activeBranches.length === 1 ? activeBranches[0].id : '';

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] overflow-hidden space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)] mb-1">Workers</h1>
          <p className="text-sm text-[var(--muted)] max-w-2xl">
            Workers are the people you roster and pay. They don't sign in to SimpleHours: you keep their details, default roster and timesheets here.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canManageHolidays && (
            <Button variant="outline" size="md" onClick={() => setShowHolidays(true)} leftIcon={<CalendarDays className="w-4 h-4" />}>
              Public holidays
            </Button>
          )}
          <Button
            variant="secondary"
            size="md"
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
            leftIcon={<FileSpreadsheet className="w-4 h-4 text-[var(--success)]" />}
          >
            Export CSV
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => setFormWorker('new')}
            disabled={activeBranches.length === 0}
            title={activeBranches.length === 0 ? 'An active branch is needed before adding workers' : undefined}
            leftIcon={<Plus className="w-4 h-4" />}
          >
            Add worker
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 bg-[var(--panel)] p-3 rounded-xl border border-[var(--border)]">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by name, email or phone…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-[var(--panel-subtle)] border border-[var(--border)] rounded-lg text-[var(--text)] placeholder-[var(--muted)] outline-none focus:border-[var(--primary)]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {branches.length > 1 && (
            <div className="w-48">
              <Select aria-label="Branch" value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="text-xs py-1.5">
                <option value="">All my branches</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}{b.is_active ? '' : ' (deactivated)'}</option>
                ))}
              </Select>
            </div>
          )}
          <div className="w-44">
            <Select aria-label="Department" value={departmentFilter} onChange={e => setDepartmentFilter(e.target.value)} className="text-xs py-1.5">
              <option value="">All departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </Select>
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer select-none px-1">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={e => setIncludeInactive(e.target.checked)}
              className="rounded border-[var(--border)] accent-[var(--primary)]"
            />
            Show deactivated
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto bg-[var(--panel)] rounded-xl border border-[var(--border)] relative">
        {loading && workers.length === 0 ? (
          <div className="p-4"><TableSkeleton rows={6} /></div>
        ) : loadError ? (
          <EmptyState
            className="m-4"
            icon={<Users className="w-5 h-5" />}
            title="Workers could not be loaded"
            description={loadError}
            actionLabel="Try again"
            onAction={reload}
          />
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="bg-[var(--table-header)] sticky top-0 z-20">
              <tr>
                {['Name & contact', 'Branch', 'Department', 'Contracted (fortnight)', 'Status'].map(h => (
                  <th key={h} className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">{h}</th>
                ))}
                <th className="py-3 px-4 text-right text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(worker => {
                const active = isActiveWorker(worker);
                return (
                  <tr key={worker.id} className={`hover:bg-[var(--hover-row)] border-b border-[var(--border)] ${active ? '' : 'opacity-70'}`}>
                    <td className="py-3 px-4">
                      <div className="font-bold text-sm text-[var(--text)]">{worker.full_name}</div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-[var(--muted)]">
                        {worker.email && (
                          <span className="flex items-center gap-1"><Mail className="w-3 h-3 opacity-70" />{worker.email}</span>
                        )}
                        {worker.phone && (
                          <span className="flex items-center gap-1 font-mono"><Phone className="w-3 h-3 opacity-70" />{worker.phone}</span>
                        )}
                        {!worker.email && !worker.phone && <span className="italic">No contact details</span>}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1.5 text-sm text-[var(--text)]">
                        <Building2 className="w-3.5 h-3.5 text-[var(--muted)]" />
                        {worker.location_name || '—'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-[var(--muted)]">{worker.department || '—'}</td>
                    <td className="py-3 px-4 text-sm font-semibold text-[var(--text)]">{Number(worker.contracted_hours ?? 0)}h</td>
                    <td className="py-3 px-4">
                      {active ? <Badge variant="success" size="sm">Active</Badge> : <Badge variant="default" size="sm">Deactivated</Badge>}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex justify-end gap-1.5 flex-wrap">
                        <button onClick={() => setTemplateWorker(worker)} className="px-2.5 py-1 rounded-lg text-xs font-bold text-[var(--primary)] bg-[var(--primary-light)] hover:opacity-80 transition-colors cursor-pointer">
                          Default roster
                        </button>
                        <button onClick={() => setFormWorker(worker)} className="px-2.5 py-1 rounded-lg text-xs font-bold text-[var(--muted)] bg-[var(--glass-4)] hover:bg-[var(--glass-8)] border border-[var(--border)] transition-colors cursor-pointer">
                          Edit
                        </button>
                        {active ? (
                          <button onClick={() => setPendingAction({ kind: 'deactivate', worker })} className="px-2.5 py-1 rounded-lg text-xs font-bold text-[var(--warn)] bg-[var(--warn-light)] hover:opacity-80 transition-colors cursor-pointer">
                            Deactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => handleReactivate(worker)}
                            disabled={reactivatingId === worker.id}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold text-[var(--success)] bg-[var(--success-light)] hover:opacity-80 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            Reactivate
                          </button>
                        )}
                        <button onClick={() => setPendingAction({ kind: 'delete', worker })} className="px-2.5 py-1 rounded-lg text-xs font-bold text-[var(--danger)] bg-[var(--danger-light)] hover:opacity-80 transition-colors cursor-pointer">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[var(--muted)] text-sm">
                    {q || departmentFilter ? 'No workers match your filters.' : 'No workers yet. Add your first worker to start rostering.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {formWorker && (
        <WorkerFormModal
          worker={formWorker === 'new' ? null : formWorker}
          branches={branches}
          defaultBranchId={defaultBranchId}
          onClose={() => setFormWorker(null)}
          onSaved={(message, warning) => {
            toast.success(message);
            if (warning) toast.warning(warning);
            setFormWorker(null);
            reload();
          }}
        />
      )}

      {templateWorker && (
        <TemplateModal worker={templateWorker} onClose={() => setTemplateWorker(null)} onSaved={reload} />
      )}

      {canManageHolidays && <HolidaysModal isOpen={showHolidays} onClose={() => setShowHolidays(false)} />}

      <ConfirmModal
        isOpen={Boolean(pendingAction)}
        onClose={() => setPendingAction(null)}
        onConfirm={handleConfirmAction}
        title={pendingAction?.kind === 'delete'
          ? `Delete ${pendingAction.worker.full_name} permanently?`
          : `Deactivate ${pendingAction?.worker.full_name ?? 'this worker'}?`}
        message={pendingAction?.kind === 'delete'
          ? 'Their rosters and timesheets are deleted too, and this cannot be undone. Workers with approved timesheets cannot be deleted; deactivate them instead.'
          : 'They no longer appear in active lists, rosters or timesheets. Their history is kept and you can reactivate them at any time.'}
        confirmLabel={pendingAction?.kind === 'delete' ? 'Delete worker' : 'Deactivate worker'}
        variant={pendingAction?.kind === 'delete' ? 'danger' : 'warning'}
        loading={actionBusy}
      />
    </div>
  );
}

function WorkerFormModal({ worker, branches, defaultBranchId, onClose, onSaved }: {
  worker: Worker | null;
  branches: Branch[];
  defaultBranchId: string;
  onClose: () => void;
  onSaved: (message: string, warning?: string) => void;
}) {
  const [form, setForm] = useState({
    full_name: worker?.full_name || '',
    location_id: worker?.location_id || defaultBranchId,
    department: worker?.department || '',
    email: worker?.email || '',
    phone: worker?.phone || '',
    contracted_hours: String(worker ? Number(worker.contracted_hours ?? 76) : 76),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active branches, plus the worker's current branch if it has since been deactivated.
  const branchOptions = branches.filter(b => b.is_active || b.id === worker?.location_id);
  const moving = Boolean(worker && form.location_id && form.location_id !== worker.location_id);

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) {
      setError('Enter the worker’s full name.');
      return;
    }
    if (!form.location_id) {
      setError('Choose the branch this worker belongs to.');
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      full_name: form.full_name.trim(),
      location_id: form.location_id,
      department: form.department.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      contracted_hours: form.contracted_hours === '' ? undefined : Number(form.contracted_hours),
    };
    try {
      if (worker) {
        const res = await api.put(`/employees/${worker.id}`, body);
        const movedRecords = Number(res.data?.data?.historical_records_affected || 0);
        const warning = moving && movedRecords > 0
          ? `${body.full_name}’s ${movedRecords} past roster/timesheet day${movedRecords === 1 ? '' : 's'} will now show under the new branch, not where the work actually happened.`
          : undefined;
        onSaved(`${body.full_name} has been updated${moving ? ` and moved to ${branchOptions.find(b => b.id === form.location_id)?.name ?? 'the new branch'}` : ''}.`, warning);
      } else {
        await api.post('/employees', body);
        onSaved(`${body.full_name} has been added.`);
      }
    } catch (err: any) {
      setError(errorMessage(err, 'The worker could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={worker ? `Edit ${worker.full_name}` : 'Add a worker'} maxWidth="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-md text-xs bg-[var(--danger-light)] border border-[var(--danger)]/30 text-[var(--danger)]">{error}</div>
        )}
        <Input label="Full name" value={form.full_name} onChange={set('full_name')} maxLength={120} required autoFocus />
        <Select
          label="Branch"
          value={form.location_id}
          onChange={set('location_id')}
          required
          helperText={moving ? 'Saving moves this worker to the selected branch.' : 'Every worker belongs to one branch.'}
        >
          <option value="" disabled>Choose a branch…</option>
          {branchOptions.map(b => (
            <option key={b.id} value={b.id}>{b.name}{b.is_active ? '' : ' (deactivated)'}</option>
          ))}
        </Select>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Department (optional)" value={form.department} onChange={set('department')} maxLength={120} />
          <Input
            label="Contracted hours per fortnight"
            type="number"
            min={0}
            max={336}
            step={0.5}
            value={form.contracted_hours}
            onChange={set('contracted_hours')}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Email (optional)" type="email" value={form.email} onChange={set('email')} leftIcon={<Mail className="w-4 h-4" />} />
          <Input label="Phone (optional)" type="tel" value={form.phone} onChange={set('phone')} leftIcon={<Phone className="w-4 h-4" />} />
        </div>
        <p className="text-[11px] text-[var(--muted)]">Contact details are for your records only. Workers are never emailed and do not sign in.</p>
        <div className="flex justify-end gap-2 pt-4 border-t border-[var(--border)]">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="primary" size="sm" loading={saving}>{worker ? 'Save changes' : 'Add worker'}</Button>
        </div>
      </form>
    </Modal>
  );
}

interface DraftSegment {
  key: number;
  segment_type: string;
  roster_in: string;
  roster_out: string;
  /** Only used for untimed segments (e.g. a leave day entered as hours); timed segments are calculated by the server. */
  roster_hours: number;
  has_break: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'incomplete' | 'error';

let segmentKeySeq = 0;
const nextKey = () => ++segmentKeySeq;

/** The worker's default fortnight (day 0 = the Sunday a pay period starts). Changes save automatically. */
function TemplateModal({ worker, onClose, onSaved }: { worker: Worker; onClose: () => void; onSaved: () => void }) {
  const [days, setDays] = useState<DraftSegment[][]>(() =>
    Array.from({ length: 14 }, (_, dayIndex) =>
      worker.template
        // Rows with neither times nor hours are days off.
        .filter(t => t.day_index === dayIndex && ((t.roster_in && t.roster_out) || Number(t.roster_hours) > 0))
        .map(t => ({
          key: nextKey(),
          segment_type: t.segment_type || 'WORK',
          roster_in: (t.roster_in || '').slice(0, 5),
          roster_out: (t.roster_out || '').slice(0, 5),
          roster_hours: Number(t.roster_hours) || 0,
          has_break: t.has_break !== false,
        }))
    )
  );
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<DraftSegment[][] | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const save = (list: DraftSegment[][]) => {
    const incomplete = list.some(day => day.some(s => Boolean(s.roster_in) !== Boolean(s.roster_out)));
    if (incomplete) {
      setSaveState('incomplete');
      return;
    }
    type TemplatePayload = { day_index: number; segment_type: string; roster_in?: string; roster_out?: string; roster_hours?: number; has_break: boolean };
    const templates = list.flatMap((day, dayIndex) =>
      day.flatMap((s): TemplatePayload[] => {
        if (s.roster_in && s.roster_out) return [{ day_index: dayIndex, segment_type: s.segment_type, roster_in: s.roster_in, roster_out: s.roster_out, has_break: s.has_break }];
        if (s.roster_hours > 0) return [{ day_index: dayIndex, segment_type: s.segment_type, roster_hours: s.roster_hours, has_break: s.has_break }];
        return [];
      })
    );
    setSaveState('saving');
    // Saves run one after another so an older request can never overwrite a newer one.
    chainRef.current = chainRef.current.then(async () => {
      try {
        await api.post(`/employees/${worker.id}/templates`, { templates });
        setError(null);
        setSaveState('saved');
        onSaved();
      } catch (err: any) {
        setError(errorMessage(err, 'The default roster could not be saved.'));
        setSaveState('error');
      }
    });
  };

  const update = (next: DraftSegment[][]) => {
    setDays(next);
    pendingRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      pendingRef.current = null;
      save(next);
    }, 700);
  };

  const handleClose = () => {
    if (timerRef.current && pendingRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      save(pendingRef.current);
      pendingRef.current = null;
    }
    onClose();
  };

  const changeSegment = (dayIndex: number, key: number, field: 'segment_type' | 'roster_in' | 'roster_out', value: string) =>
    update(days.map((day, i) => (i === dayIndex ? day.map(s => (s.key === key ? { ...s, [field]: value } : s)) : day)));

  const toggleSegmentBreak = (dayIndex: number, key: number, hasBreak: boolean) =>
    update(days.map((day, i) => (i === dayIndex ? day.map(s => (s.key === key ? { ...s, has_break: hasBreak } : s)) : day)));

  const addSegment = (dayIndex: number) =>
    setDays(days.map((day, i) => (i === dayIndex
      ? [...day, { key: nextKey(), segment_type: 'WORK', roster_in: '', roster_out: '', roster_hours: 0, has_break: true }]
      : day)));

  const removeSegment = (dayIndex: number, key: number) =>
    update(days.map((day, i) => (i === dayIndex ? day.filter(s => s.key !== key) : day)));

  const statusText: Record<SaveState, string> = {
    idle: 'Changes save automatically',
    saving: 'Saving…',
    saved: 'All changes saved',
    incomplete: 'Enter both a start and a finish time to save',
    error: 'Not saved: fix the highlighted problem',
  };
  const statusTone = saveState === 'error' ? 'text-[var(--danger)] bg-[var(--danger-light)] border-[var(--danger)]/20'
    : saveState === 'incomplete' ? 'text-[var(--warn)] bg-[var(--warn-light)] border-[var(--warn)]/20'
    : saveState === 'saved' ? 'text-[var(--success)] bg-[var(--success-light)] border-[var(--success)]/20'
    : 'text-[var(--muted)] bg-[var(--panel-subtle)] border-[var(--border)]';

  const inputClass = 'w-20 bg-[var(--panel)] border border-[var(--border)] rounded-md px-2 py-1 text-center text-xs font-semibold text-[var(--text)] outline-none focus:border-[var(--primary)]';

  return (
    <Modal
      isOpen
      onClose={handleClose}
      title={`Default roster: ${worker.full_name}`}
      description="The fortnight Auto-roster copies onto the Roster page. A day can have several segments, e.g. Sick Leave in the morning and Normal Work in the afternoon."
      maxWidth="4xl"
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 rounded-md text-xs bg-[var(--danger-light)] border border-[var(--danger)]/30 text-[var(--danger)]">{error}</div>
        )}

        <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-4">
          {[0, 1].map(week => (
            <div key={week} className="space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">Week {week + 1}</div>
              <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
                {days.slice(week * 7, week * 7 + 7).map((segments, offset) => {
                  const dayIndex = week * 7 + offset;
                  const weekend = offset === 0 || offset === 6;
                  return (
                    <div key={dayIndex} className="flex flex-col sm:flex-row sm:items-start gap-2 px-3 py-2">
                      <div className={`w-16 shrink-0 pt-1 text-xs font-bold ${weekend ? 'text-[var(--muted)]' : 'text-[var(--text)]'}`}>
                        {DAY_NAMES[offset]}
                      </div>
                      <div className="flex-1 space-y-1.5">
                        {segments.length === 0 && <div className="pt-1 text-xs text-[var(--muted)] italic">Not rostered</div>}
                        {segments.map(segment => (
                          <div key={segment.key} className="flex flex-wrap items-center gap-2">
                            <select
                              aria-label="Segment type"
                              value={segment.segment_type}
                              onChange={e => changeSegment(dayIndex, segment.key, 'segment_type', e.target.value)}
                              className="bg-[var(--input-bg)] border border-[var(--border)] rounded-md px-2 py-1 text-xs text-[var(--text)] outline-none focus:border-[var(--primary)] cursor-pointer"
                            >
                              {SEGMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                            <SmartTimeInput
                              value={segment.roster_in}
                              placeholder="Start"
                              onChange={val => changeSegment(dayIndex, segment.key, 'roster_in', val)}
                              className={inputClass}
                            />
                            <span className="text-xs text-[var(--muted)]">to</span>
                            <SmartTimeInput
                              value={segment.roster_out}
                              placeholder="Finish"
                              onChange={val => changeSegment(dayIndex, segment.key, 'roster_out', val)}
                              className={inputClass}
                            />
                            {!segment.roster_in && !segment.roster_out && segment.roster_hours > 0 && (
                              <Badge size="sm" title="Entered as hours without times">{segment.roster_hours}h, no times</Badge>
                            )}
                            {segment.roster_in && segment.roster_out && segment.segment_type === 'WORK' && (
                              <label className="flex items-center gap-1 text-[11px] text-[var(--muted)] cursor-pointer" title="Whether the org's unpaid break rule applies to this shift">
                                <input
                                  type="checkbox"
                                  checked={segment.has_break}
                                  onChange={e => toggleSegmentBreak(dayIndex, segment.key, e.target.checked)}
                                  className="h-3.5 w-3.5 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)] cursor-pointer"
                                />
                                Break
                              </label>
                            )}
                            <button
                              type="button"
                              onClick={() => removeSegment(dayIndex, segment.key)}
                              className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-light)] transition-colors cursor-pointer"
                              aria-label="Remove segment"
                              title="Remove segment"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => addSegment(dayIndex)}
                        disabled={segments.length >= 12}
                        className="shrink-0 self-start px-2 py-1 rounded-md text-[11px] font-semibold text-[var(--primary)] hover:bg-[var(--primary-light)] transition-colors cursor-pointer disabled:opacity-40"
                      >
                        + Segment
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-[var(--border)]">
          <span className={`inline-flex items-center px-3 py-1.5 rounded-lg border text-xs font-semibold ${statusTone}`}>
            {statusText[saveState]}
          </span>
          <Button variant="primary" size="sm" onClick={handleClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}

interface Holiday {
  id: string;
  holiday_date: string;
  name: string;
}

function HolidaysModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const toast = useToast();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchHolidays = async () => {
    setLoading(true);
    try {
      const res = await api.get('/organisation/holidays');
      setHolidays(res.data.data || []);
    } catch (err: any) {
      setError(errorMessage(err, 'Public holidays could not be loaded.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setConfirmId(null);
      fetchHolidays();
    }
  }, [isOpen]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !name.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await api.post('/organisation/holidays', { holiday_date: date, name: name.trim() });
      toast.success(`${name.trim()} added.`);
      setDate('');
      setName('');
      fetchHolidays();
    } catch (err: any) {
      setError(errorMessage(err, 'The holiday could not be added.'));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (holiday: Holiday) => {
    setDeletingId(holiday.id);
    setError(null);
    try {
      await api.delete(`/organisation/holidays/${holiday.id}`);
      toast.success(`${holiday.name} removed.`);
      setConfirmId(null);
      fetchHolidays();
    } catch (err: any) {
      setError(errorMessage(err, 'The holiday could not be removed.'));
    } finally {
      setDeletingId(null);
    }
  };

  const formatHoliday = (d: string) =>
    new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Public holidays"
      description="Hours worked on these dates are reported as public holiday hours, in every branch."
      maxWidth="lg"
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 rounded-md text-xs bg-[var(--danger-light)] border border-[var(--danger)]/30 text-[var(--danger)]">{error}</div>
        )}

        <form onSubmit={handleAdd} className="p-4 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Date" type="date" required value={date} onChange={e => setDate(e.target.value)} />
            <Input label="Name" required placeholder="e.g. Australia Day" value={name} onChange={e => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="sm" loading={adding} leftIcon={<Plus className="w-3.5 h-3.5" />}>
              Add holiday
            </Button>
          </div>
        </form>

        <div className="max-h-72 overflow-y-auto">
          {loading && holidays.length === 0 ? (
            <div className="text-center py-6 text-xs text-[var(--muted)]">Loading holidays…</div>
          ) : holidays.length === 0 ? (
            <div className="text-center py-6 text-xs text-[var(--muted)]">No public holidays yet. Add one above.</div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted)] uppercase font-bold text-[10px]">
                  <th className="py-2">Date</th>
                  <th className="py-2">Name</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {holidays.map(h => (
                  <tr key={h.id}>
                    <td className="py-2.5 font-semibold text-[var(--text)] whitespace-nowrap">{formatHoliday(h.holiday_date)}</td>
                    <td className="py-2.5 text-[var(--muted)]">{h.name}</td>
                    <td className="py-2.5 text-right">
                      {confirmId === h.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Button variant="danger" size="sm" loading={deletingId === h.id} onClick={() => handleDelete(h)}>Remove</Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmId(null)}>Keep</Button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmId(h.id)}
                          className="inline-flex items-center gap-1 text-[var(--danger)] hover:underline font-semibold cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" /> Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="pt-3 border-t border-[var(--border)] flex justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
