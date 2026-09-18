import { useState, useEffect } from 'react';
import { ShieldCheck, Search, FileSpreadsheet, RefreshCw, Filter } from 'lucide-react';
import api from '../services/apiClient';

export default function Audit() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const res = await api.get('/audit');
      setLogs(res.data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleExportCsv = () => {
    const headers = ['Timestamp', 'Actor Email', 'Actor Role', 'Action Type', 'Entity', 'Details'];
    const rows = filteredLogs.map(l => [
      `"${new Date(l.created_at || l.timestamp).toISOString()}"`,
      `"${(l.actor_email || '').replace(/"/g, '""')}"`,
      `"${(l.actor_role || '').replace(/"/g, '""')}"`,
      `"${(l.action_type || l.action || '').replace(/"/g, '""')}"`,
      `"${(l.target_entity || l.entity_type || '').replace(/"/g, '""')}"`,
      `"${JSON.stringify(l.details || {}).replace(/"/g, '""')}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-trail-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const actionTypes = Array.from(new Set(logs.map(l => l.action_type || l.action).filter(Boolean))) as string[];

  const filteredLogs = logs.filter(log => {
    const q = searchQuery.toLowerCase();
    const action = (log.action_type || log.action || '').toLowerCase();
    const actor = (log.actor_email || '').toLowerCase();
    const entity = (log.target_entity || log.entity_type || '').toLowerCase();

    const matchesSearch = !q || action.includes(q) || actor.includes(q) || entity.includes(q);
    const matchesAction = actionFilter === 'ALL' || (log.action_type || log.action) === actionFilter;

    return matchesSearch && matchesAction;
  });

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] overflow-hidden space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-[var(--text)] mb-1">System Audit Trail</h2>
            <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-3.5 h-3.5" /> Immutable Ledger
            </span>
          </div>
          <p className="text-sm text-[var(--muted)]">
            Permanent, tamper-evident record of all operational modifications, approvals, roster locks, and security events.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button 
            onClick={fetchLogs} 
            disabled={loading}
            className="px-3 py-2 rounded-xl text-xs font-semibold bg-[var(--panel-subtle)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button 
            onClick={handleExportCsv} 
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--panel-subtle)] text-[var(--text)] hover:bg-[var(--hover-row)] border border-[var(--border)] flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Download Audit Log Export (CSV)"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3 bg-[var(--panel)] p-3 rounded-xl border border-[var(--border)]">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by actor email, action type, or target..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-[var(--panel-subtle)] border border-[var(--border)] rounded-lg text-[var(--text)] placeholder-[var(--muted)] outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-3.5 h-3.5 text-[var(--muted)]" />
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="px-3 py-1.5 text-xs bg-[var(--panel-subtle)] border border-[var(--border)] rounded-lg text-[var(--text)] outline-none cursor-pointer"
          >
            <option value="ALL">All Actions ({actionTypes.length})</option>
            {actionTypes.map(act => (
              <option key={act} value={act}>{act}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto bg-[var(--panel)] rounded-xl border border-[var(--border)] relative">
        <table className="w-full text-left border-collapse">
          <thead className="bg-[var(--table-header)] sticky top-0 z-20">
            <tr>
              <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Timestamp</th>
              <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Actor</th>
              <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Action Type</th>
              <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Target / Details</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map((log: any) => {
              const act = log.action_type || log.action || '';
              return (
                <tr key={log.id} className="hover:bg-[var(--hover-row)] border-b border-[var(--border)]">
                  <td className="py-3 px-4 whitespace-nowrap">
                    <div className="text-sm text-[var(--text)] font-mono">
                      {new Date(log.created_at || log.timestamp).toLocaleString()}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-sm font-semibold text-[var(--text)]">{log.actor_email || 'System'}</div>
                    <div className="text-xs text-[var(--muted)]">{log.actor_role || 'Background Task'}</div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                      act.includes('DELETE') || act.includes('DEACTIVATE') || act.includes('REJECT') ? 'bg-[var(--danger-light)] text-[var(--danger)]' :
                      act.includes('CREATE') || act.includes('AUTO') || act.includes('APPROVE') ? 'bg-[var(--success-light)] text-[var(--success)]' :
                      act.includes('UPDATE') || act.includes('LOCK') ? 'bg-[var(--primary-light)] text-[var(--primary)]' :
                      'bg-[var(--glass-8)] text-[var(--muted)]'
                    }`}>
                      {act}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-sm text-[var(--muted)]">{log.target_entity || log.entity_type} {log.target_id || log.entity_id}</div>
                    {log.details && (
                      <div className="text-xs text-[var(--muted)] mt-1 font-mono bg-[var(--input-bg)] border border-[var(--border)] p-2 rounded max-w-lg overflow-x-auto">
                        {typeof log.details === 'string' ? log.details : JSON.stringify(log.details)}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredLogs.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-[var(--muted)] text-sm">
                  {searchQuery ? 'No audit entries match your query.' : 'No audit logs found.'}
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-[var(--muted)] text-sm">Loading audit trail...</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
