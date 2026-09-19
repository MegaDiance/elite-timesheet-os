import React, { useState, useEffect, useRef } from 'react';
import { Search, FileSpreadsheet, Plus, Phone, Mail } from 'lucide-react';
import api from '../services/apiClient';
import SmartTimeInput from '../components/SmartTimeInput';
import { getFortnightStartIso } from '../utils/fortnight';

interface Employee {
  id: string;
  user_account_id?: string | null;
  full_name: string;
  email: string | null;
  department: string | null;
  phone: string | null;
  contracted_hours: number;
  status: string;
  template: any[];
}

export default function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  
  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<Employee | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState<Employee | null>(null);
  const [showHolidaysModal, setShowHolidaysModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [inviteModalData, setInviteModalData] = useState<{ name: string; link: string } | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const fetchEmployees = async () => {
    try {
      setLoading(true);
      const res = await api.get('/employees?include_inactive=true');
      if (res.data?.data) {
        setEmployees(res.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch employees:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Permanently delete employee "${name}"? This action cannot be undone.`)) {
      try {
        await api.delete(`/employees/${id}`);
        showToast(`Employee "${name}" deleted.`);
        await fetchEmployees();
      } catch (err: any) {
        showToast(err.response?.data?.error?.message || 'Failed to delete employee');
      }
    }
  };

  const handleDeactivate = async (id: string) => {
    if (confirm('Deactivate employee?')) {
      try {
        await api.post(`/employees/${id}/deactivate`);
        showToast('Employee deactivated.');
        await fetchEmployees();
      } catch (err: any) {
        showToast(err.response?.data?.error?.message || 'Failed to deactivate');
      }
    }
  };

  const handleReactivate = async (id: string) => {
    if (confirm('Reactivate employee?')) {
      try {
        await api.post(`/employees/${id}/reactivate`);
        showToast('Employee reactivated.');
        await fetchEmployees();
      } catch (err: any) {
        showToast(err.response?.data?.error?.message || 'Failed to reactivate');
      }
    }
  };

  const handleResendInvite = async (id: string) => {
    try {
      const res = await api.post(`/employees/${id}/send-invitation`);
      const msg = res.data?.data?.message || 'Invitation email dispatched successfully!';
      showToast(msg);
      fetchEmployees();
    } catch (err: any) {
      showToast(err.response?.data?.error?.message || 'Failed to send invite');
    }
  };

  const handleEmployeeSaved = (link?: string, name?: string) => {
    fetchEmployees();
    if (link) {
      setInviteModalData({ name: name || 'Employee', link });
    } else {
      showToast('Employee details saved successfully.');
    }
  };

  const handleExportStaffCsv = () => {
    const headers = ['Full Name', 'Email', 'Phone', 'Department', 'Contracted Hours', 'Status'];
    const rows = employees.map(e => [
      `"${(e.full_name || '').replace(/"/g, '""')}"`,
      `"${(e.email || '').replace(/"/g, '""')}"`,
      `"${(e.phone || '').replace(/"/g, '""')}"`,
      `"${(e.department || '').replace(/"/g, '""')}"`,
      e.contracted_hours ?? 76,
      `"${(e.status || '').replace(/"/g, '""')}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `staff-directory-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const departments = Array.from(new Set(employees.map(e => e.department).filter(Boolean))) as string[];

  const filteredEmployees = employees.filter(emp => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q || 
      emp.full_name.toLowerCase().includes(q) || 
      (emp.email && emp.email.toLowerCase().includes(q)) || 
      (emp.phone && emp.phone.includes(q));
    const matchesDept = departmentFilter === 'ALL' || emp.department === departmentFilter;
    const matchesStatus = statusFilter === 'ALL' || emp.status === statusFilter;
    return matchesSearch && matchesDept && matchesStatus;
  });

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] overflow-hidden space-y-4">
      {/* Header & Primary Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--text)] mb-1">Staff Registry</h2>
          <p className="text-sm text-[var(--muted)]">Manage employee profiles, phone contact records, shift templates, and portal access.</p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button 
            onClick={handleExportStaffCsv}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--panel-subtle)] text-[var(--text)] hover:bg-[var(--hover-row)] border border-[var(--border)] flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Export Staff Directory as CSV"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
            <span>Export CSV</span>
          </button>

          <button 
            onClick={() => setShowAddModal(true)} 
            className="bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold py-2 px-4 rounded-xl flex items-center gap-2 text-sm transition-colors shadow-lg shadow-[var(--primary-light)] cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Employee</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3 bg-[var(--panel)] p-3 rounded-xl border border-[var(--border)]">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by name, email, or phone number..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-[var(--panel-subtle)] border border-[var(--border)] rounded-lg text-[var(--text)] placeholder-[var(--muted)] outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={departmentFilter}
            onChange={e => setDepartmentFilter(e.target.value)}
            className="px-3 py-1.5 text-xs bg-[var(--panel-subtle)] border border-[var(--border)] rounded-lg text-[var(--text)] outline-none cursor-pointer"
          >
            <option value="ALL">All Departments</option>
            {departments.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-xs bg-[var(--panel-subtle)] border border-[var(--border)] rounded-lg text-[var(--text)] outline-none cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Pending Setup">Pending Setup</option>
            <option value="Deleted">Deleted / Inactive</option>
          </select>
        </div>
      </div>

      {/* Staff Table */}
      <div className="flex-1 overflow-auto bg-[var(--panel)] rounded-xl border border-[var(--border)] relative">
        <table className="w-full text-left border-collapse">
          <thead className="bg-[var(--table-header)] sticky top-0 z-20">
            <tr>
              <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Name & Email</th>
              <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Phone Number</th>
              <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Department</th>
              <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Contract (Fortnight)</th>
              <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Status</th>
              <th className="py-3 px-4 text-right text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredEmployees.map(emp => (
              <tr key={emp.id} className="hover:bg-[var(--hover-row)] border-b border-[var(--border)] group">
                <td className="py-3 px-4">
                  <div className="font-bold text-sm text-[var(--text)]">{emp.full_name}</div>
                  <div className="text-xs text-[var(--muted)] flex items-center gap-1 mt-0.5">
                    <Mail className="w-3 h-3 opacity-70" />
                    <span>{emp.email || 'No email provided'}</span>
                  </div>
                </td>
                <td className="py-3 px-4">
                  {emp.phone ? (
                    <div className="flex items-center gap-1.5 text-sm text-[var(--text)] font-mono">
                      <Phone className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{emp.phone}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--muted)] italic">No phone recorded</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  <span className="text-sm text-[var(--muted)]">{emp.department || '—'}</span>
                </td>
                <td className="py-3 px-4">
                  <span className="text-sm font-semibold text-[var(--text)]">{emp.contracted_hours}h</span>
                </td>
                <td className="py-3 px-4">
                  {emp.status === 'Active' ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--success-light)] text-[var(--success)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span> Active
                    </span>
                  ) : emp.status === 'Deleted' ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--danger-light)] text-[var(--danger)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--danger)]"></span> Deleted
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--glass-8)] text-[var(--muted)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--muted)]"></span> {emp.status}
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-right">
                  {/* Action buttons always visible and mobile-friendly */}
                  <div className="flex justify-end gap-1.5 flex-wrap">
                    <button onClick={() => setShowTemplateModal(emp)} className="px-2.5 py-1 rounded-lg text-xs font-bold text-[var(--primary)] bg-[var(--primary-light)] hover:opacity-80 transition-colors touch-manipulation cursor-pointer">
                      Template
                    </button>
                    <button onClick={() => setShowEditModal(emp)} className="px-2.5 py-1 rounded-lg text-xs font-bold text-[var(--muted)] bg-[var(--glass-4)] hover:bg-[var(--glass-8)] transition-colors border border-[var(--border)] touch-manipulation cursor-pointer">
                      Edit
                    </button>
                    {(emp.status === 'Pending Setup' || !emp.user_account_id) && (
                      <button onClick={() => handleResendInvite(emp.id)} className="px-2.5 py-1 rounded-lg text-xs font-bold text-[var(--primary)] bg-[var(--primary-light)] hover:opacity-80 transition-colors border border-[var(--primary)]/20 touch-manipulation cursor-pointer">
                        {emp.user_account_id ? 'Resend Invite' : 'Invite'}
                      </button>
                    )}
                    {emp.status === 'Deleted' ? (
                      <button onClick={() => handleReactivate(emp.id)} className="px-2.5 py-1 rounded-lg text-xs font-bold text-[var(--success)] bg-[var(--success-light)] hover:opacity-80 transition-colors touch-manipulation cursor-pointer">
                        Restore
                      </button>
                    ) : (
                      <button onClick={() => handleDeactivate(emp.id)} className="px-2.5 py-1 rounded-lg text-xs font-bold text-[var(--warn)] bg-[var(--warn-light)] hover:opacity-80 transition-colors touch-manipulation cursor-pointer">
                        Deactivate
                      </button>
                    )}
                    <button onClick={() => handleDelete(emp.id, emp.full_name)} className="px-2.5 py-1 rounded-lg text-xs font-bold text-[var(--danger)] bg-[var(--danger-light)] hover:opacity-80 transition-colors touch-manipulation cursor-pointer">
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredEmployees.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-[var(--muted)] text-sm">
                  {searchQuery ? 'No employees match your search criteria.' : 'No employees found.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <EmployeeFormModal
          onClose={() => setShowAddModal(false)}
          onSave={(link?: string, name?: string) => handleEmployeeSaved(link, name)}
        />
      )}
      {showEditModal && (
        <EmployeeFormModal
          employee={showEditModal}
          onClose={() => setShowEditModal(null)}
          onSave={() => handleEmployeeSaved()}
        />
      )}
      {showTemplateModal && (
        <TemplateModal
          employee={showTemplateModal}
          onClose={() => setShowTemplateModal(null)}
          onSave={fetchEmployees}
        />
      )}
      {showHolidaysModal && (
        <HolidaysModal
          onClose={() => setShowHolidaysModal(false)}
        />
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-[var(--primary)] text-white font-bold text-xs px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Employee Account Invite Modal */}
      {inviteModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--panel)] rounded-2xl w-full max-w-md border border-[var(--border)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h3 className="text-base font-bold text-[var(--text)]">Employee Invite Link</h3>
              <button
                onClick={() => setInviteModalData(null)}
                className="w-7 h-7 rounded-full bg-[var(--glass-4)] hover:bg-[var(--glass-8)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-[var(--muted)]">
              Account created for <span className="font-bold text-[var(--text)]">{inviteModalData.name}</span>. Share this private activation link with them:
            </p>
            <div className="flex items-center gap-2 bg-[var(--panel-subtle)] p-2 rounded-xl border border-[var(--border)]">
              <input
                type="text"
                readOnly
                value={inviteModalData.link}
                className="w-full bg-transparent text-xs text-[var(--text)] font-mono outline-none select-all"
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(inviteModalData.link);
                  showToast('Invite link copied to clipboard!');
                }}
                className="px-3 py-1.5 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white text-xs font-semibold rounded-lg shrink-0 cursor-pointer"
              >
                Copy
              </button>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setInviteModalData(null)}
                className="px-4 py-2 bg-[var(--panel-subtle)] hover:bg-[var(--glass-4)] text-[var(--text)] text-xs font-semibold rounded-xl cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HolidaysModal({ onClose }: { onClose: () => void }) {
  const [holidays, setHolidays] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHolidays = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/organisation/holidays');
      if (res.data?.data) setHolidays(res.data.data);
    } catch (err: any) {
      console.warn(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHolidays();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !name.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await api.post('/organisation/holidays', { holiday_date: date, name: name.trim() });
      setDate('');
      setName('');
      fetchHolidays();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to add holiday');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this public holiday?')) return;
    setError(null);
    try {
      await api.delete(`/organisation/holidays/${id}`);
      fetchHolidays();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to delete holiday');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[var(--panel)] rounded-2xl w-full max-w-lg border border-[var(--border)] shadow-2xl p-6 flex flex-col max-h-[85vh] space-y-4">
        <div className="flex justify-between items-center pb-3 border-b border-[var(--border)]">
          <div>
            <h3 className="text-xl font-black text-[var(--text)]">Configured Public Holidays</h3>
            <p className="text-xs text-[var(--muted)]">Automatic Public Holiday time categorization</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-[var(--glass-4)] hover:bg-[var(--glass-8)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] cursor-pointer">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {error && (
          <div className="text-xs text-[var(--danger)] bg-[var(--danger-light)] p-2.5 rounded-lg border border-[var(--danger)]/20">
            {error}
          </div>
        )}

        {/* Add Holiday Form */}
        <form onSubmit={handleAdd} className="bg-[var(--input-bg)] p-4 rounded-xl border border-[var(--border)] space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-[var(--muted)] uppercase mb-1">Date</label>
              <input 
                type="date" 
                required 
                value={date} 
                onChange={e => setDate(e.target.value)} 
                className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--primary)]" 
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[var(--muted)] uppercase mb-1">Holiday Name</label>
              <input 
                type="text" 
                required 
                placeholder="e.g. Easter Monday" 
                value={name} 
                onChange={e => setName(e.target.value)} 
                className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--primary)]" 
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button 
              type="submit" 
              disabled={adding} 
              className="px-4 py-1.5 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white text-xs font-black rounded-lg shadow-sm"
            >
              {adding ? 'Adding...' : '+ Add Holiday'}
            </button>
          </div>
        </form>

        {/* Holidays List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center py-6 text-xs text-[var(--muted)]">Loading holidays...</div>
          ) : holidays.length === 0 ? (
            <div className="text-center py-6 text-xs text-[var(--muted)]">No public holidays configured. Add one above.</div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted)] uppercase font-bold text-[10px]">
                  <th className="py-2">Date</th>
                  <th className="py-2">Holiday Name</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {holidays.map(h => (
                  <tr key={h.id}>
                    <td className="py-2.5 font-bold text-[var(--text)]">{h.holiday_date}</td>
                    <td className="py-2.5 text-[var(--muted)] font-medium">{h.name}</td>
                    <td className="py-2.5 text-right">
                      <button 
                        onClick={() => handleDelete(h.id)} 
                        className="text-[var(--danger)] hover:underline font-bold text-xs"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="pt-3 border-t border-[var(--border)] flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-[var(--panel-subtle)] text-[var(--text)] font-bold rounded-xl text-xs hover:bg-[var(--glass-4)]">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function EmployeeFormModal({ employee, onClose, onSave }: { employee?: Employee, onClose: () => void, onSave: (inviteLink?: string, name?: string) => void }) {
  const [formData, setFormData] = useState({
    full_name: employee?.full_name || '',
    email: employee?.email || '',
    department: employee?.department || '',
    phone: employee?.phone || '',
    contracted_hours: employee?.contracted_hours || 76,
    create_account: false,
    role: 'Employee'
  });
  const [configureSchedule, setConfigureSchedule] = useState(false);
  const [scheduleDays, setScheduleDays] = useState<any[]>(() => {
    const arr = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 0; i < 14; i++) {
      const weekNum = i < 7 ? 1 : 2;
      const dayName = dayNames[i % 7];
      const existing = employee?.template?.find(t => t.day_index === i);
      if (existing) {
        const hasTimes = Boolean(existing.roster_in && existing.roster_out);
        arr.push({ ...existing, label: `W${weekNum} ${dayName}`, enabled: hasTimes });
      } else {
        const dayOfWeekIndex = i % 7;
        const isWeekday = dayOfWeekIndex >= 1 && dayOfWeekIndex <= 5;
        arr.push({
          day_index: i,
          label: `W${weekNum} ${dayName}`,
          segment_type: 'WORK',
          roster_in: isWeekday ? '09:00' : '',
          roster_out: isWeekday ? '17:00' : '',
          enabled: isWeekday
        });
      }
    }
    return arr;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const updateScheduleDay = (index: number, field: string, val: any) => {
    const updated = [...scheduleDays];
    updated[index][field] = val;
    setScheduleDays(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (employee) {
        await api.put(`/employees/${employee.id}`, formData);
        if (configureSchedule) {
          const validTemplates = scheduleDays.map(d => ({
            day_index: d.day_index,
            segment_type: d.segment_type || 'WORK',
            roster_in: d.enabled ? d.roster_in : '',
            roster_out: d.enabled ? d.roster_out : ''
          }));
          await api.post(`/employees/${employee.id}/templates`, { templates: validTemplates });
        }
        onSave();
        onClose();
      } else {
        const res = await api.post('/employees', formData);
        const newEmpId = res.data?.data?.id;

        if (newEmpId && configureSchedule) {
          const validTemplates = scheduleDays.map(d => ({
            day_index: d.day_index,
            segment_type: d.segment_type || 'WORK',
            roster_in: d.enabled ? d.roster_in : '',
            roster_out: d.enabled ? d.roster_out : ''
          }));
          await api.post(`/employees/${newEmpId}/templates`, { templates: validTemplates });
        }

        const link = res.data?.data?.inviteLink;
        if (link) {
          try {
            await navigator.clipboard.writeText(link);
          } catch (clipErr) {
            console.warn('Clipboard write failed:', clipErr);
          }
        }
        onSave(link, formData.full_name);
        onClose();
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to save employee');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className={`bg-[var(--panel)] rounded-2xl w-full ${configureSchedule ? 'max-w-4xl' : 'max-w-lg'} border border-[var(--border)] shadow-2xl p-6 max-h-[90vh] overflow-y-auto transition-all`}>
        <h3 className="text-xl font-bold text-[var(--text)] mb-6">{employee ? 'Edit Employee' : 'Add New Employee'}</h3>
        {error && <div className="mb-4 text-sm text-[var(--danger)] bg-[var(--danger-light)] p-3 rounded-xl">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">Full Name</label>
            <input required type="text" value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})} className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2 text-[var(--text)] outline-none focus:border-[var(--primary)]" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">Email</label>
              <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2 text-[var(--text)] outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">Phone</label>
              <input type="tel" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2 text-[var(--text)] outline-none focus:border-[var(--primary)]" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">Department</label>
              <input type="text" value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})} className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2 text-[var(--text)] outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">Contract (Hrs/Fn)</label>
              <input type="number" step="0.5" value={formData.contracted_hours} onChange={e => setFormData({...formData, contracted_hours: Number(e.target.value)})} className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2 text-[var(--text)] outline-none focus:border-[var(--primary)]" />
            </div>
          </div>
          
          <div className="pt-4 border-t border-[var(--border)] mt-4">
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input type="checkbox" checked={configureSchedule} onChange={e => setConfigureSchedule(e.target.checked)} className="rounded bg-[var(--bg)] border-[var(--border)]" />
              <span className="text-sm font-bold text-[var(--text)]">Set up default schedule template</span>
            </label>
            {configureSchedule && (
              <div className="bg-[var(--panel-subtle)] p-4 rounded-2xl border border-[var(--border)] space-y-3 mt-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-extrabold text-[var(--text)] uppercase tracking-wider">14-Day Fortnight Schedule Grid</span>
                  <span className="text-[11px] text-[var(--muted)]">Check day to enable shift</span>
                </div>
                <div className="grid grid-cols-7 gap-2">
                  {scheduleDays.map((d, idx) => (
                    <div key={idx} className="bg-[var(--input-bg)] p-2.5 rounded-xl border border-[var(--border)] space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] font-bold text-[var(--text)]">{d.label}</span>
                        <input 
                          type="checkbox" 
                          checked={d.enabled !== false} 
                          onChange={e => updateScheduleDay(idx, 'enabled', e.target.checked)} 
                          className="rounded bg-[var(--bg)] border-[var(--border)] text-[var(--primary)] w-3.5 h-3.5"
                        />
                      </div>
                      <div className="space-y-1">
                        <SmartTimeInput 
                          value={d.roster_in || ''} 
                          disabled={d.enabled === false} 
                          onChange={val => updateScheduleDay(idx, 'roster_in', val)} 
                          className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-lg px-1.5 py-1 text-center text-[11px] font-bold text-[var(--text)] outline-none focus:border-[var(--primary)] disabled:opacity-30" 
                        />
                        <SmartTimeInput 
                          value={d.roster_out || ''} 
                          disabled={d.enabled === false} 
                          onChange={val => updateScheduleDay(idx, 'roster_out', val)} 
                          className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-lg px-1.5 py-1 text-center text-[11px] font-bold text-[var(--text)] outline-none focus:border-[var(--primary)] disabled:opacity-30" 
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {(!employee || !employee.user_account_id) && (
            <div className="pt-4 border-t border-[var(--border)]">
              <label className="flex items-center gap-2 cursor-pointer mb-4">
                <input type="checkbox" checked={formData.create_account} onChange={e => setFormData({...formData, create_account: e.target.checked})} className="rounded bg-[var(--bg)] border-[var(--border)]" />
                <span className="text-sm font-semibold text-[var(--text)]">Create login account & send invite</span>
              </label>
              {formData.create_account && (
                <div>
                  <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">System Role</label>
                  <select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2 text-[var(--text)] outline-none focus:border-[var(--primary)]">
                    <option value="Employee">Employee (View Own)</option>
                    <option value="Manager">Manager (Edit Roster)</option>
                    <option value="Company Admin">Company Admin (Full Access)</option>
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 mt-8 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-bold text-[var(--muted)] hover:text-[var(--text)] transition-colors">Cancel</button>
            <button type="submit" disabled={loading} className="px-6 py-2 rounded-xl text-sm font-bold bg-[var(--primary)] text-white hover:bg-[var(--primary-h)] transition-colors shadow-lg disabled:opacity-50">
              {loading ? 'Saving...' : 'Save Employee'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TemplateModal({ employee, onClose, onSave }: { employee: Employee, onClose: () => void, onSave: () => void }) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [autoSaving, setAutoSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const arr = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for(let i=0; i<14; i++) {
      const existing = employee.template?.find(t => t.day_index === i);
      const weekNum = i < 7 ? 1 : 2;
      const dayName = dayNames[i % 7];
      if (existing) {
        const hasTimes = Boolean(existing.roster_in && existing.roster_out);
        arr.push({ ...existing, label: `W${weekNum} ${dayName}`, enabled: hasTimes });
      } else {
        const isWeekday = (i % 7 < 5);
        arr.push({ 
          day_index: i, 
          label: `W${weekNum} ${dayName}`, 
          segment_type: 'WORK', 
          roster_in: isWeekday ? '09:00' : '', 
          roster_out: isWeekday ? '17:00' : '', 
          enabled: isWeekday 
        });
      }
    }
    setTemplates(arr);
  }, [employee]);

  const debounceTimerRef = useRef<any>(null);

  const saveCurrentTemplates = async (updatedList: any[], applyToRoster = false) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    setAutoSaving(true);
    try {
      const valid = updatedList.map(t => ({
        day_index: t.day_index,
        segment_type: t.segment_type || 'WORK',
        roster_in: t.enabled ? t.roster_in : '',
        roster_out: t.enabled ? t.roster_out : ''
      }));
      await api.post(`/employees/${employee.id}/templates`, { templates: valid });
      if (applyToRoster) {
        const fnIso = getFortnightStartIso();
        await api.post('/roster/auto-roster', { start_date: fnIso });
      }
      onSave();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to save template');
    } finally {
      setAutoSaving(false);
    }
  };

  const updateCell = (index: number, field: string, val: any) => {
    const updated = [...templates];
    updated[index][field] = val;
    setTemplates(updated);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      saveCurrentTemplates(updated);
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
      <div className="bg-[var(--panel)] rounded-3xl w-full max-w-6xl border border-[var(--border)] shadow-2xl p-8 flex flex-col relative">
        {/* Top Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-3xl font-black text-[var(--text)] tracking-tight">{employee.full_name}</h2>
            <p className="text-sm font-semibold text-[var(--muted)] mt-1">Default Roster Template (14-Day Cycle)</p>
          </div>
          <button 
            onClick={onClose} 
            className="px-5 py-2.5 bg-[var(--panel-subtle)] hover:bg-[var(--glass-8)] text-[var(--text)] font-bold rounded-2xl border border-[var(--border)] text-xs transition-colors"
          >
            Back to Directory
          </button>
        </div>

        {error && <div className="mb-4 text-sm text-[var(--danger)] bg-[var(--danger-light)] p-3 rounded-xl">{error}</div>}

        {/* 14-Day Grid (7 cols x 2 rows) */}
        <div className="grid grid-cols-7 gap-3 mb-8">
          {templates.map((t, idx) => (
            <div key={idx} className="bg-[var(--input-bg)] p-3.5 rounded-2xl border border-[var(--border)] space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-[var(--text)]">{t.label}</span>
                <input 
                  type="checkbox" 
                  checked={t.enabled !== false} 
                  onChange={e => updateCell(idx, 'enabled', e.target.checked)} 
                  className="rounded bg-[var(--bg)] border-[var(--border)] text-[var(--primary)]"
                />
              </div>
              <div className="space-y-1.5 pt-1">
                <SmartTimeInput 
                  value={t.roster_in || ''} 
                  disabled={t.enabled === false} 
                  onChange={val => updateCell(idx, 'roster_in', val)} 
                  className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-xl px-2.5 py-1.5 text-center text-xs font-bold text-[var(--text)] outline-none focus:border-[var(--primary)] disabled:opacity-30" 
                />
                <SmartTimeInput 
                  value={t.roster_out || ''} 
                  disabled={t.enabled === false} 
                  onChange={val => updateCell(idx, 'roster_out', val)} 
                  className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-xl px-2.5 py-1.5 text-center text-xs font-bold text-[var(--text)] outline-none focus:border-[var(--primary)] disabled:opacity-30" 
                />
              </div>
            </div>
          ))}
        </div>

        {/* Bottom Bar */}
        <div className="flex items-center justify-between pt-6 border-t border-[var(--border)]">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--warn-light)] text-[var(--warn)] border border-[var(--warn)]/20 rounded-xl text-xs font-bold">
            {autoSaving ? 'Saving...' : 'Autosaving — all changes are saved instantly'}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-[var(--muted)]">Apply this template to:</span>
            <button 
              onClick={() => saveCurrentTemplates(templates, true)} 
              className="px-5 py-2.5 bg-[var(--panel-subtle)] hover:bg-[var(--glass-8)] text-[var(--text)] font-bold rounded-xl border border-[var(--border)] text-xs transition-colors shadow-lg"
            >
              Apply to Active Fortnight
            </button>
            <button 
              onClick={onClose} 
              className="px-6 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-[var(--primary-light)]"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
