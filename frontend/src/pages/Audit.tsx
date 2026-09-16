import { useState, useEffect } from 'react';
import api from '../services/apiClient';

export default function Audit() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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

  const handleClear = async () => {
    if(confirm('Are you sure you want to securely clear all audit logs for this organization?')) {
        try {
            await api.delete('/audit');
            fetchLogs();
        } catch (err: any) {
            alert(err.response?.data?.error?.message || 'Failed to clear logs');
        }
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] overflow-hidden">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-[var(--text)] mb-1">System Audit Logs</h2>
          <p className="text-sm text-[var(--muted)]">Immutable record of all modifications, roster generations, and security events.</p>
        </div>
        <button onClick={handleClear} className="bg-[var(--danger-light)] hover:opacity-80 text-[var(--danger)] font-bold py-2 px-4 rounded-xl flex items-center gap-2 text-sm transition-colors border border-[var(--danger)]/30">
          Clear Logs
        </button>
      </div>

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
            {logs.map((log: any) => (
              <tr key={log.id} className="hover:bg-[var(--hover-row)] border-b border-[var(--border)]">
                <td className="py-3 px-4 whitespace-nowrap">
                  <div className="text-sm text-[var(--text)] font-mono">{new Date(log.created_at).toLocaleString()}</div>
                </td>
                <td className="py-3 px-4">
                  <div className="text-sm font-semibold text-[var(--text)]">{log.actor_email}</div>
                  <div className="text-xs text-[var(--muted)]">{log.actor_role}</div>
                </td>
                <td className="py-3 px-4">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                    log.action_type?.includes('DELETE') || log.action_type?.includes('DEACTIVATE') ? 'bg-[var(--danger-light)] text-[var(--danger)]' :
                    log.action_type?.includes('CREATE') || log.action_type?.includes('AUTO') ? 'bg-[var(--success-light)] text-[var(--success)]' :
                    log.action_type?.includes('UPDATE') ? 'bg-[var(--primary-light)] text-[var(--primary)]' :
                    'bg-[var(--glass-8)] text-[var(--muted)]'
                  }`}>
                    {log.action_type}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <div className="text-sm text-[var(--muted)]">{log.target_entity} {log.target_id}</div>
                  {log.details && (
                    <div className="text-xs text-[var(--muted)] mt-1 font-mono bg-[var(--input-bg)] border border-[var(--border)] p-2 rounded max-w-lg overflow-x-auto">
                      {JSON.stringify(log.details)}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {logs.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-[var(--muted)] text-sm">No audit logs found for this organization.</td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-[var(--muted)] text-sm">Loading logs...</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
