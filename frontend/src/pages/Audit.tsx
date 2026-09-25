import { useEffect, useState } from 'react';
import { FileSpreadsheet, Filter, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import api from '../services/apiClient';
import { useAccess } from '../hooks/useAccess';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { friendlyError } from '../services/errors';

interface AuditEntry {
  id: string;
  location_id: string | null;
  actor_id: string | null;
  target_user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: string | null;
  previous_value: string | null;
  new_value: string | null;
  ip_address: string | null;
  created_at: string | null;
  actor_email: string | null;
  actor_full_name: string | null;
}

const PAGE_SIZE = 100;

const entryTime = (e: AuditEntry) => e.created_at || '';
const actorLabel = (e: AuditEntry) => e.actor_full_name || e.actor_email || 'System';
const humanise = (code: string | null) => {
  if (!code) return '';
  const text = code.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** Details are free text or a small JSON object; objects are shown as "key: value" pairs. */
function formatDetails(details: string | null): string {
  if (!details) return '';
  try {
    const parsed = JSON.parse(details);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed).map(([k, v]) => `${humanise(k)}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' • ');
    }
  } catch {
    // Plain text.
  }
  return details;
}

function actionTone(action: string): string {
  if (/DELETE|REMOVE|REVOKE|DEACTIVATE|FAILED|REJECT/.test(action)) return 'bg-[var(--danger-light)] text-[var(--danger)]';
  if (/CREATE|ADD|APPROVE|INVITE|ACCEPT|REACTIVATE|CONFIGURED/.test(action)) return 'bg-[var(--success-light)] text-[var(--success)]';
  if (/UPDATE|CHANGE|LOCK|MOVE|TRANSFER|REGENERATE|REOPEN/.test(action)) return 'bg-[var(--primary-light)] text-[var(--primary-text)]';
  return 'bg-[var(--glass-8)] text-[var(--muted)]';
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function Audit() {
  const { access } = useAccess();
  const branchName = new Map((access?.branches ?? []).map(b => [b.id, b.name]));

  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/audit');
      setLogs(res.data.data || []);
    } catch (err: any) {
      setError(friendlyError(err, 'The audit log could not be loaded.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const actions = Array.from(new Set(logs.map(l => l.action).filter(Boolean))).sort();
  const entities = Array.from(new Set(logs.map(l => l.entity_type).filter(Boolean) as string[])).sort();

  const q = searchQuery.trim().toLowerCase();
  const filteredLogs = logs.filter(log => {
    if (actionFilter && log.action !== actionFilter) return false;
    if (entityFilter && log.entity_type !== entityFilter) return false;
    const day = entryTime(log).slice(0, 10);
    if (fromDate && day < fromDate) return false;
    if (toDate && day > toDate) return false;
    if (!q) return true;
    return [
      log.action, log.entity_type, log.details, log.previous_value, log.new_value,
      log.actor_email, log.actor_full_name, log.location_id ? branchName.get(log.location_id) : '',
    ].some(v => (v || '').toLowerCase().includes(q));
  });

  const hasFilters = Boolean(q || actionFilter || entityFilter || fromDate || toDate);

  const handleExportCsv = () => {
    const headers = ['Time', 'Actor', 'Actor email', 'Action', 'Entity', 'Entity ID', 'Branch', 'Details', 'Previous value', 'New value', 'IP address'];
    const rows = filteredLogs.map(l => [
      entryTime(l) ? new Date(entryTime(l)).toISOString() : '',
      actorLabel(l),
      l.actor_email || '',
      l.action,
      l.entity_type || '',
      l.entity_id || '',
      l.location_id ? branchName.get(l.location_id) || l.location_id : '',
      formatDetails(l.details),
      l.previous_value || '',
      l.new_value || '',
      l.ip_address || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetFilters = () => {
    setSearchQuery('');
    setActionFilter('');
    setEntityFilter('');
    setFromDate('');
    setToDate('');
    setVisible(PAGE_SIZE);
  };

  const controlClass = 'px-3 py-1.5 text-xs bg-[var(--panel-subtle)] border border-[var(--border)] rounded-lg text-[var(--text)] outline-none focus:border-[var(--primary)]';

  return (
    <div className="flex flex-col md:h-[calc(100dvh-5rem)] md:overflow-hidden space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--text)] mb-1">Audit log</h1>
            <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--success-light)] text-[var(--success)] border border-[var(--success)]/20">
              <ShieldCheck className="w-3.5 h-3.5" /> Cannot be edited
            </span>
          </div>
          <p className="text-sm text-[var(--muted)]">
            Every change made in your organisation: who did it, when, and what changed.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="md"
            onClick={fetchLogs}
            disabled={loading}
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={handleExportCsv}
            disabled={filteredLogs.length === 0}
            leftIcon={<FileSpreadsheet className="w-4 h-4 text-[var(--success)]" />}
          >
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col xl:flex-row xl:items-center gap-3 bg-[var(--panel)] p-3 rounded-xl border border-[var(--border)]">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search actor, action, details or values…"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setVisible(PAGE_SIZE); }}
            className={`w-full pl-9 pr-4 ${controlClass}`}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-[var(--muted)]" />
          <select aria-label="Action" value={actionFilter} onChange={e => { setActionFilter(e.target.value); setVisible(PAGE_SIZE); }} className={`${controlClass} cursor-pointer`}>
            <option value="">All actions</option>
            {actions.map(a => <option key={a} value={a}>{humanise(a)}</option>)}
          </select>
          <select aria-label="Entity" value={entityFilter} onChange={e => { setEntityFilter(e.target.value); setVisible(PAGE_SIZE); }} className={`${controlClass} cursor-pointer`}>
            <option value="">All record types</option>
            {entities.map(en => <option key={en} value={en}>{humanise(en)}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            From
            <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setVisible(PAGE_SIZE); }} className={controlClass} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            To
            <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setVisible(PAGE_SIZE); }} className={controlClass} />
          </label>
          {hasFilters && (
            <button onClick={resetFilters} className="text-xs font-semibold text-[var(--primary-text)] hover:underline cursor-pointer px-1">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto bg-[var(--panel)] rounded-xl border border-[var(--border)] relative">
        {error ? (
          <EmptyState
            className="m-4"
            icon={<ShieldCheck className="w-5 h-5" />}
            title="The audit log could not be loaded"
            description={error}
            actionLabel="Try again"
            onAction={fetchLogs}
          />
        ) : (
          <>
          <table className="hidden md:table w-full text-left border-collapse">
            <thead className="bg-[var(--table-header)] sticky top-0 z-20">
              <tr>
                {['Time', 'Actor', 'Action', 'Record', 'Details', 'Change'].map(h => (
                  <th key={h} className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredLogs.slice(0, visible).map(log => {
                const time = entryTime(log);
                const details = formatDetails(log.details);
                const branch = log.location_id ? branchName.get(log.location_id) : null;
                return (
                  <tr key={log.id} className="hover:bg-[var(--hover-row)] border-b border-[var(--border)] align-top">
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="text-xs text-[var(--text)] font-mono">
                        {time ? new Date(time).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                      </div>
                      {log.ip_address && <div className="text-[10px] text-[var(--muted)] font-mono">{log.ip_address}</div>}
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-sm font-semibold text-[var(--text)]">{actorLabel(log)}</div>
                      {log.actor_full_name && log.actor_email && <div className="text-xs text-[var(--muted)]">{log.actor_email}</div>}
                    </td>
                    <td className="py-3 px-4">
                      <span title={log.action} className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap ${actionTone(log.action)}`}>
                        {humanise(log.action)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-xs text-[var(--text)]">{humanise(log.entity_type) || '—'}</div>
                      {branch && <div className="text-[11px] text-[var(--muted)]">Branch: {branch}</div>}
                    </td>
                    <td className="py-3 px-4 max-w-md">
                      {details ? <div className="text-xs text-[var(--muted)] break-words">{details}</div> : <span className="text-xs text-[var(--muted)]">—</span>}
                    </td>
                    <td className="py-3 px-4 max-w-xs">
                      {log.previous_value || log.new_value ? (
                        <div className="text-xs space-y-0.5 break-words">
                          {log.previous_value && <div className="text-[var(--danger)] line-through opacity-80">{log.previous_value}</div>}
                          {log.new_value && <div className="text-[var(--success)]">{log.new_value}</div>}
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredLogs.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[var(--muted)] text-sm">
                    {hasFilters ? 'No entries match your filters.' : 'Nothing has been recorded yet.'}
                  </td>
                </tr>
              )}
              {loading && logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[var(--muted)] text-sm">Loading the audit log…</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Phones: one entry per card, the same information stacked */}
          <ul className="md:hidden divide-y divide-[var(--border)]">
            {filteredLogs.slice(0, visible).map(log => {
              const time = entryTime(log);
              const details = formatDetails(log.details);
              const branch = log.location_id ? branchName.get(log.location_id) : null;
              return (
                <li key={log.id} className="p-4 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span title={log.action} className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${actionTone(log.action)}`}>{humanise(log.action)}</span>
                    <span className="text-xs text-[var(--muted)] text-right">{time ? new Date(time).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</span>
                  </div>
                  <p className="text-sm text-[var(--text)]"><span className="font-semibold">{actorLabel(log)}</span>{log.entity_type && <span className="text-[var(--muted)]"> · {humanise(log.entity_type)}</span>}{branch && <span className="text-[var(--muted)]"> · {branch}</span>}</p>
                  {details && <p className="text-sm text-[var(--muted)] break-words">{details}</p>}
                  {(log.previous_value || log.new_value) && (
                    <p className="text-sm break-words">
                      {log.previous_value && <span className="text-[var(--danger)] line-through mr-2"><span className="sr-only">Before: </span>{log.previous_value}</span>}
                      {log.new_value && <span className="text-[var(--success)]"><span className="sr-only">After: </span>{log.new_value}</span>}
                    </p>
                  )}
                </li>
              );
            })}
            {filteredLogs.length === 0 && !loading && (
              <li className="p-8 text-center text-sm text-[var(--muted)]">{hasFilters ? 'No entries match your filters.' : 'Nothing has been recorded yet.'}</li>
            )}
            {loading && logs.length === 0 && <li className="p-8 text-center text-sm text-[var(--muted)]">Loading the audit log…</li>}
          </ul>
          </>
        )}
        {!error && filteredLogs.length > visible && (
          <div className="p-3 flex items-center justify-center gap-3 border-t border-[var(--border)] text-xs text-[var(--muted)]">
            <span>Showing {visible} of {filteredLogs.length}</span>
            <Button variant="outline" size="sm" onClick={() => setVisible(v => v + PAGE_SIZE)}>Show more</Button>
          </div>
        )}
      </div>
    </div>
  );
}
