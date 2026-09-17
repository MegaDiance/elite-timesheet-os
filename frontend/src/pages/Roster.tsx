import React, { useState, useEffect, useRef } from 'react';
import api from '../services/apiClient';
import SmartTimeInput from '../components/SmartTimeInput';

interface Segment {
  id?: string;
  segment_type: string;
  actual_segment_type?: string;
  is_unplanned: boolean;
  roster_in: string;
  roster_out: string;
  roster_hours: number;
  actual_in: string;
  actual_out: string;
  actual_hours: number;
  notes?: string;
}

interface Record {
  id: string;
  employee_id: string;
  record_date: string;
  has_actuals: boolean;
  segments: Segment[];
}

interface Employee {
  id: string;
  full_name: string;
  department: string;
  template: any[];
}

export default function Roster() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [records, setRecords] = useState<Record[]>([]);
  const [rosterLocked, setRosterLocked] = useState(false);
  const [timesheetLocked, setTimesheetLocked] = useState(false);
  const [isPublished, setIsPublished] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [activeDate, setActiveDate] = useState<Date>(new Date());
  const dateInputRef = useRef<HTMLInputElement>(null);
  
  // Confirmation Modals State for Auto-Roster / Auto-Log with day selection
  const [showAutoRosterModal, setShowAutoRosterModal] = useState(false);
  const [showAutoLogModal, setShowAutoLogModal] = useState(false);
  const [singleEmpTarget, setSingleEmpTarget] = useState<Employee | { id: string, full_name: string } | null>(null);
  const [selectedDays, setSelectedDays] = useState<number[]>(Array.from({ length: 14 }, (_, i) => i));

  // Lock Password Modal State
  const [lockModalType, setLockModalType] = useState<'roster' | 'timesheet' | null>(null);
  const [lockPasswordInput, setLockPasswordInput] = useState('');
  const [lockError, setLockError] = useState('');

  // Push & Finalise Roster Modal State
  const [showPushLockModal, setShowPushLockModal] = useState(false);
  const [pushLockPassword, setPushLockPassword] = useState('');
  const [pushLockError, setPushLockError] = useState('');

  // Notification toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modals state
  const [activeCell, setActiveCell] = useState<{empId: string, empName: string, dateIso: string, records: Record[]} | null>(null);
  const [loadingAction, setLoadingAction] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const getFortnightStart = (d: Date) => {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const dateNum = d.getUTCDate();
    const utcDate = new Date(Date.UTC(y, m, dateNum));
    const ref = new Date(Date.UTC(2026, 2, 29)); 
    const diff = Math.floor((utcDate.getTime() - ref.getTime()) / 86400000);
    const offset = Math.floor(diff / 14);
    return new Date(ref.getTime() + offset * 14 * 86400000);
  };

  const activeFortnightStart = getFortnightStart(activeDate);
  const fnIso = activeFortnightStart.toISOString().split('T')[0];

  const fetchData = async () => {
    try {
      const [empRes, recordsRes, locksRes] = await Promise.all([
        api.get('/employees'),
        api.get('/records'),
        api.get('/locks')
      ]);

      if (empRes.data?.data) setEmployees(empRes.data.data);
      if (recordsRes.data?.data) setRecords(recordsRes.data.data);
      if (locksRes.data?.data) {
        const lock = locksRes.data.data.find((l: any) => l.start_date === fnIso);
        if (lock) {
          setRosterLocked(!!lock.roster_locked);
          setTimesheetLocked(!!lock.timesheet_locked);
          setIsPublished(!!lock.is_published);
        } else {
          setRosterLocked(false);
          setTimesheetLocked(false);
          setIsPublished(false);
        }
      }
    } catch (err) {
      console.error('Failed to fetch roster data:', err);
    }
  };

  const handlePublishRoster = async () => {
    setPublishing(true);
    try {
      const nextState = !isPublished;
      await api.post('/locks/publish', { start_date: fnIso, is_published: nextState });
      setIsPublished(nextState);
      showToast(nextState ? 'Roster pushed & published to employees!' : 'Roster unpublished');
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to update roster publication');
    } finally {
      setPublishing(false);
    }
  };

  const handlePushRosterClick = () => {
    if (isPublished) {
      handlePublishRoster();
    } else if (!rosterLocked) {
      setPushLockPassword('');
      setPushLockError('');
      setShowPushLockModal(true);
    } else {
      handlePublishRoster();
    }
  };

  const handleConfirmPushAndLock = async (e: React.FormEvent) => {
    e.preventDefault();
    setPublishing(true);
    setPushLockError('');
    try {
      await api.post('/locks', {
        start_date: fnIso,
        roster_locked: true,
        timesheet_locked: timesheetLocked,
        password: pushLockPassword
      });
      setRosterLocked(true);

      await api.post('/locks/publish', {
        start_date: fnIso,
        is_published: true
      });
      setIsPublished(true);
      setShowPushLockModal(false);
      setPushLockPassword('');
      showToast('Roster finalised, locked & pushed to employees!');
    } catch (err: any) {
      setPushLockError(err.response?.data?.error?.message || 'Failed to finalise and push roster');
    } finally {
      setPublishing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fnIso]);

  const openLockModal = (type: 'roster' | 'timesheet') => {
    setLockModalType(type);
    setLockPasswordInput('');
    setLockError('');
  };

  const confirmLockToggle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lockModalType) return;
    setLockError('');
    try {
      const type = lockModalType;
      const newRosterLocked = type === 'roster' ? !rosterLocked : rosterLocked;
      const newTimesheetLocked = type === 'timesheet' ? !timesheetLocked : timesheetLocked;

      await api.post('/locks', {
        start_date: fnIso,
        roster_locked: newRosterLocked,
        timesheet_locked: newTimesheetLocked,
        password: lockPasswordInput
      });

      setRosterLocked(newRosterLocked);
      setTimesheetLocked(newTimesheetLocked);
      setLockModalType(null);
      setLockPasswordInput('');
      showToast(`${type.toUpperCase()} lock status updated`);
    } catch (err: any) {
        setLockError(err.response?.data?.error?.message || 'Failed to update locks');
    }
  };

  const openAutoRosterModal = () => {
    if (rosterLocked) return alert("Roster is locked");
    setSingleEmpTarget(null);
    setSelectedDays(Array.from({ length: 14 }, (_, i) => i));
    setShowAutoRosterModal(true);
  };

  const openAutoLogModal = () => {
    if (timesheetLocked) return alert("Timesheets are locked");
    setSingleEmpTarget(null);
    setSelectedDays(Array.from({ length: 14 }, (_, i) => i));
    setShowAutoLogModal(true);
  };

  const handleConfirmAutoRoster = async () => {
      if (selectedDays.length === 0) return alert("Please select at least one day to roster");
      setShowAutoRosterModal(false);
      setLoadingAction(true);
      try {
          if (singleEmpTarget) {
            const emp = singleEmpTarget as Employee;
            const hasCustomTemplate = emp.template && emp.template.some((t: any) => t.roster_in && t.roster_out);

            for (const i of selectedDays) {
              const dIso = fmtISO(addDays(activeFortnightStart, i));
              const customTmpl = emp.template?.find((t: any) => t.day_index === i && t.roster_in && t.roster_out);

              let rIn = '';
              let rOut = '';
              let segType = 'WORK';

              if (customTmpl) {
                rIn = customTmpl.roster_in;
                rOut = customTmpl.roster_out;
                segType = customTmpl.segment_type || 'WORK';
              } else if (!hasCustomTemplate) {
                rIn = '09:00';
                rOut = '17:00';
                segType = 'WORK';
              }

              if (rIn && rOut) {
                const existingRec = records.find(r => r.employee_id === emp.id && r.record_date === dIso);
                const existingSeg = existingRec?.segments?.[0];

                await api.post('/records', {
                  employee_id: emp.id,
                  record_date: dIso,
                  segments: [{
                    segment_type: segType,
                    roster_in: rIn,
                    roster_out: rOut,
                    roster_hours: 7.5,
                    actual_in: existingSeg?.actual_in || '',
                    actual_out: existingSeg?.actual_out || '',
                    actual_hours: existingSeg?.actual_hours || 0,
                    actual_segment_type: existingSeg?.actual_segment_type || '',
                    is_unplanned: false
                  }]
                });
              }
            }
            await fetchData();
            showToast(`Default roster template applied for ${emp.full_name} (${selectedDays.length} days)`);
          } else {
            await api.post('/roster/auto-roster', { start_date: fnIso, selected_days: selectedDays });
            await fetchData();
            showToast(`Roster templates applied for ${selectedDays.length} selected days`);
          }
      } catch (err: any) {
          alert(err.response?.data?.error?.message || 'Failed to Auto-Roster');
      } finally {
          setLoadingAction(false);
          setSingleEmpTarget(null);
      }
  };

  const handleConfirmAutoLog = async () => {
      if (selectedDays.length === 0) return alert("Please select at least one day to log");
      setShowAutoLogModal(false);
      setLoadingAction(true);
      try {
          if (singleEmpTarget) {
            for (const i of selectedDays) {
              const dIso = fmtISO(addDays(activeFortnightStart, i));
              const rec = records.find(r => r.employee_id === singleEmpTarget.id && r.record_date === dIso);
              if (rec && rec.segments?.length > 0) {
                const updatedSegments = rec.segments.map(s => ({
                  ...s,
                  actual_in: s.actual_in || s.roster_in,
                  actual_out: s.actual_out || s.roster_out,
                  actual_hours: s.actual_hours || s.roster_hours || 7.5,
                  actual_segment_type: s.actual_segment_type || s.segment_type
                }));
                await api.post('/records', {
                  employee_id: singleEmpTarget.id,
                  record_date: dIso,
                  segments: updatedSegments
                });
              }
            }
            await fetchData();
            showToast(`Actual timesheet logged for ${singleEmpTarget.full_name} (${selectedDays.length} days)`);
          } else {
            await api.post('/roster/auto-log', { start_date: fnIso, selected_days: selectedDays });
            await fetchData();
            showToast(`All rostered shifts logged for ${selectedDays.length} selected days`);
          }
      } catch (err: any) {
          alert(err.response?.data?.error?.message || 'Failed to Auto-Log');
      } finally {
          setLoadingAction(false);
          setSingleEmpTarget(null);
      }
  };

  // Single Employee Actions
  const handleSingleEmployeeRoster = (emp: Employee) => {
    if (rosterLocked) return alert("Roster is locked");
    setSingleEmpTarget(emp);
    setSelectedDays(Array.from({ length: 14 }, (_, i) => i));
    setShowAutoRosterModal(true);
  };

  const handleSingleEmployeeLogAll = (empId: string, empName: string) => {
    if (timesheetLocked) return alert("Timesheets are locked");
    setSingleEmpTarget({ id: empId, full_name: empName });
    setSelectedDays(Array.from({ length: 14 }, (_, i) => i));
    setShowAutoLogModal(true);
  };

  const handleSingleEmployeeClear = async (empId: string, empName: string) => {
    if (rosterLocked || timesheetLocked) return alert("Period is locked");
    if (!confirm(`Clear all shifts for ${empName} for this fortnight?`)) return;
    setLoadingAction(true);
    try {
      const dates = Array.from({ length: 14 }).map((_, i) => addDays(activeFortnightStart, i));
      for (const d of dates) {
        const dIso = fmtISO(d);
        await api.post('/records', {
          employee_id: empId,
          record_date: dIso,
          segments: []
        });
      }
      await fetchData();
      showToast(`Shifts cleared for ${empName}`);
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to clear shifts');
    } finally {
      setLoadingAction(false);
    }
  };

  // Export Handlers
  const handleExportCsv = async () => {
    try {
      const res = await api.get(`/reports/export/csv?start_date=${fnIso}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Payroll_${fnIso}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast('Payroll CSV downloaded');
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to export CSV');
    }
  };

  const handlePrintPdf = async () => {
    try {
      const res = await api.get(`/reports/export/pdf?start_date=${fnIso}`);
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(res.data);
        printWindow.document.close();
      }
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to generate printable report');
    }
  };

  const addDays = (d: Date, n: number) => {
    return new Date(d.getTime() + n * 86400000);
  };

  const fmtISO = (d: Date) => d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  
  const days = Array.from({ length: 14 }).map((_, i) => addDays(activeFortnightStart, i));
  const fnEnd = days[13];

  const handlePrev = () => setActiveDate(addDays(activeDate, -14));
  const handleNext = () => setActiveDate(addDays(activeDate, 14));

  const departments = [...new Set(employees.map(e => e.department || 'OTHER'))].sort();

  const handleCellClick = (empId: string, empName: string, dateIso: string) => {
      const rec = records.find(r => r.employee_id === empId && r.record_date === dateIso);
      setActiveCell({
          empId, 
          empName,
          dateIso, 
          records: rec ? [rec] : []
      });
  };

  const toggleDaySelection = (dayIdx: number) => {
    if (selectedDays.includes(dayIdx)) {
      setSelectedDays(selectedDays.filter(d => d !== dayIdx));
    } else {
      setSelectedDays([...selectedDays, dayIdx].sort((a,b) => a - b));
    }
  };

  const getSegmentBadgeColor = (type: string, isActual: boolean, isUnplanned: boolean, isWeekend = false) => {
    if (isUnplanned) {
      return 'bg-[#ef4444]/20 text-[#ef4444] border-[#ef4444]/40';
    }
    switch (type) {
      case 'Sick':
        return 'bg-[#f59e0b]/20 text-[#f59e0b] border-[#f59e0b]/40';
      case 'Annual':
        return 'bg-[#a855f7]/20 text-[#a855f7] border-[#a855f7]/40';
      case 'TIL':
        return 'bg-[#10b981]/20 text-[#10b981] border-[#10b981]/40';
      case 'WORK':
      default:
        if (isWeekend) {
          return isActual
            ? 'bg-[#ec4899]/20 text-[#ec4899] border-[#ec4899]/40'
            : 'bg-[#06b6d4]/20 text-[#06b6d4] border-[#06b6d4]/40';
        }
        return isActual 
          ? 'bg-[#10b981]/20 text-[#10b981] border-[#10b981]/40'
          : 'bg-[#6366f1]/20 text-[#6366f1] border-[#6366f1]/40';
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] overflow-hidden relative">
      {/* Toast Notification Popup */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-[var(--primary)] text-white font-bold text-xs px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Toolbar */}
      <div className="flex justify-between items-center bg-[var(--panel)] p-3 rounded-t-xl border border-[var(--border)] border-b-0">
        <div className="flex items-center gap-3">
          <button onClick={openAutoRosterModal} disabled={loadingAction} className="bg-[#f59e0b] hover:bg-[#d97706] text-black font-bold py-2 px-4 rounded-xl flex items-center gap-2 text-sm transition-colors shadow-lg disabled:opacity-50">
            Auto-Roster All
          </button>
          <button onClick={openAutoLogModal} disabled={loadingAction} className="bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold py-2 px-4 rounded-xl flex items-center gap-2 text-sm transition-colors shadow-lg shadow-[var(--primary-light)] disabled:opacity-50">
            Auto-Log All
          </button>
          
          {/* Calendar Fortnight Date Picker */}
          <div className="flex items-center gap-1 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-xl ml-4 p-1">
            <button onClick={handlePrev} className="px-3 py-1.5 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-4)] rounded-lg font-bold">←</button>
            <button 
              type="button"
              onClick={() => {
                try {
                  dateInputRef.current?.showPicker();
                } catch {
                  dateInputRef.current?.focus();
                }
              }}
              className="relative px-3 py-1 text-sm font-bold flex items-center justify-center gap-2 text-[var(--text)] hover:bg-[var(--glass-4)] rounded-lg cursor-pointer transition-colors"
            >
              <span>{activeFortnightStart.getDate()} {activeFortnightStart.toLocaleString('default', { month: 'short' })} — {fnEnd.getDate()} {fnEnd.toLocaleString('default', { month: 'short' })} {fnEnd.getFullYear()}</span>
              <input 
                ref={dateInputRef}
                type="date" 
                value={fmtISO(activeDate)}
                onChange={e => {
                  if (e.target.value) {
                    const [y, m, d] = e.target.value.split('-');
                    setActiveDate(new Date(Number(y), Number(m) - 1, Number(d)));
                  }
                }}
                className="absolute inset-0 opacity-0 pointer-events-none w-0 h-0"
              />
            </button>
            <button onClick={handleNext} className="px-3 py-1.5 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-4)] rounded-lg font-bold">→</button>
          </div>
        </div>

        {/* Shift Type Legend */}
        <div className="hidden lg:flex items-center gap-3 text-[0.7rem] font-bold">
          <span className="flex items-center gap-1 text-[var(--primary)]"><span className="w-2.5 h-2.5 rounded-full bg-[var(--primary)]"></span> Normal Work</span>
          <span className="flex items-center gap-1 text-[#10b981]"><span className="w-2.5 h-2.5 rounded-full bg-[#10b981]"></span> TIL</span>
          <span className="flex items-center gap-1 text-[#f59e0b]"><span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]"></span> Sick</span>
          <span className="flex items-center gap-1 text-[#a855f7]"><span className="w-2.5 h-2.5 rounded-full bg-[#a855f7]"></span> Annual</span>
          <span className="flex items-center gap-1 text-[#ef4444]"><span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]"></span> Unplanned</span>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          <button 
            onClick={handleExportCsv} 
            className="px-3 py-2 rounded-xl text-xs font-medium bg-[var(--panel-subtle)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-4)] border border-[var(--border)] flex items-center gap-1.5 transition-colors"
            title="Download Accountant Payroll CSV"
          >
            <span>Export CSV</span>
          </button>

          <button 
            onClick={handlePrintPdf} 
            className="px-3 py-2 rounded-xl text-xs font-medium bg-[var(--panel-subtle)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--glass-4)] border border-[var(--border)] flex items-center gap-1.5 transition-colors"
            title="Print or Save PDF Report"
          >
            <span>PDF Report</span>
          </button>

          <button 
            onClick={handlePushRosterClick}
            disabled={publishing}
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-md ${
              isPublished 
                ? 'bg-[#10b981] hover:bg-[#059669] text-white' 
                : 'bg-[#3b82f6] hover:bg-[#2563eb] text-white'
            }`}
            title={isPublished ? "Roster is visible to employees. Click to unpublish." : "Push roster shifts to Employee Portal"}
          >
            {publishing ? (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : isPublished ? (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            )}
            <span>{publishing ? 'Updating...' : isPublished ? 'Published' : 'Push Roster'}</span>
          </button>

          <button onClick={() => openLockModal('roster')} className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors flex items-center gap-1.5 ${rosterLocked ? 'bg-[var(--warn-light)] text-[var(--warn)] border-[var(--warn)]' : 'bg-[var(--panel-subtle)] text-[var(--muted)] hover:text-[var(--text)] border-[var(--border)]'}`}>
            <span>Roster</span>
            {rosterLocked ? (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
              </svg>
            )}
          </button>
          <button onClick={() => openLockModal('timesheet')} className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors flex items-center gap-1.5 ${timesheetLocked ? 'bg-[var(--warn-light)] text-[var(--warn)] border-[var(--warn)]' : 'bg-[var(--panel-subtle)] text-[var(--muted)] hover:text-[var(--text)] border-[var(--border)]'}`}>
            <span>Timesheet</span>
            {timesheetLocked ? (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Roster Grid Table */}
      <div className="flex-1 overflow-auto bg-[var(--panel)] rounded-b-xl border border-[var(--border)] relative">
        <table className="ag-table border-none">
          <thead>
            <tr>
              <th className="name-col py-3 text-[var(--muted)] font-bold text-xs uppercase tracking-wider">Elite Professional Workspace</th>
              {days.map((d, i) => (
                <th key={i} className={`py-3 text-center ${i === 6 ? '!border-r-2 !border-r-[var(--primary)]' : ''}`}>
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[var(--muted)] text-[0.65rem] uppercase font-bold">{d.getDate()}</span>
                    <span className="text-[var(--muted)] text-[0.65rem] uppercase font-bold">{d.toLocaleString('default', { weekday: 'short' })}</span>
                  </div>
                </th>
              ))}
              <th className="w-[80px] text-center text-[var(--muted)] text-xs font-bold">Roster</th>
              <th className="w-[140px] text-center text-[var(--muted)] text-xs font-bold">Actual</th>
              <th className="w-[80px] text-center text-[var(--muted)] text-xs font-bold">Variance</th>
            </tr>
          </thead>
          <tbody>
            {departments.map(dept => (
              <React.Fragment key={dept}>
                <tr>
                  <td colSpan={18} className="bg-[var(--panel-subtle)] text-[var(--primary)] font-bold text-xs px-4 py-2 uppercase tracking-widest sticky left-0 z-10 border-t border-[var(--border)]">
                    {dept}
                  </td>
                </tr>
                {employees.filter(e => e.department === dept).map(emp => {
                  let totalRoster = 0;
                  let totalTimesheet = 0;
                  const breakdown: { [key: string]: number } = {
                    Weekdays: 0,
                    Weekends: 0,
                    TIL: 0,
                    Sick: 0,
                    Annual: 0,
                    Unplanned: 0
                  };

                  days.forEach(d => {
                    const iso = fmtISO(d);
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    const rec = records.find(r => r.employee_id === emp.id && r.record_date === iso);
                    if (rec && rec.segments?.length > 0) {
                      rec.segments.forEach(s => {
                        totalRoster += Number(s.roster_hours || 0);
                        const actHrs = Number(s.actual_hours || 0);
                        if (actHrs > 0 || rec.has_actuals) {
                          totalTimesheet += actHrs;
                        }
                        
                        const effectiveHours = rec.has_actuals ? actHrs : Number(s.roster_hours || 0);
                        const segType = rec.has_actuals ? (s.actual_segment_type || s.segment_type) : s.segment_type;

                        if (s.is_unplanned) {
                          breakdown.Unplanned += effectiveHours;
                        } else if (segType === 'WORK' || segType === 'Normal') {
                          if (isWeekend) {
                            breakdown.Weekends += effectiveHours;
                          } else {
                            breakdown.Weekdays += effectiveHours;
                          }
                        } else if (segType === 'TIL') {
                          breakdown.TIL += effectiveHours;
                        } else if (segType === 'Sick') {
                          breakdown.Sick += effectiveHours;
                        } else if (segType === 'Annual') {
                          breakdown.Annual += effectiveHours;
                        }
                      });
                    }
                  });
                  
                  return (
                    <tr key={emp.id} className="hover:bg-[var(--hover-row)] group border-b border-[var(--border)]">
                      <td className="name-col p-2">
                        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                          <span className="font-bold text-sm text-[var(--text)]">{emp.full_name}</span>
                        </div>
                        <div className="flex items-center gap-1 flex-wrap">
                          <button onClick={() => handleSingleEmployeeRoster(emp)} className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded bg-[var(--primary-light)] text-[var(--primary)] hover:opacity-80 border border-[var(--primary)]/30">
                            Roster
                          </button>
                          <button onClick={() => handleSingleEmployeeLogAll(emp.id, emp.full_name)} className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded bg-[var(--success-light)] text-[var(--success)] hover:opacity-80 border border-[var(--success)]/30">
                            Log All
                          </button>
                          <button onClick={() => handleSingleEmployeeClear(emp.id, emp.full_name)} className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded bg-[var(--danger-light)] text-[var(--danger)] hover:opacity-80 border border-[var(--danger)]/30">
                            Clear
                          </button>
                        </div>
                      </td>
                      {days.map((d, i) => {
                        const iso = fmtISO(d);
                        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                        const rec = records.find(r => r.employee_id === emp.id && r.record_date === iso);
                        let cellContent = <span className="text-[var(--muted)] opacity-40">+</span>;
                        
                        if (rec && rec.segments?.length > 0) {
                          // Sort segments chronologically by start time
                          const sortedSegs = [...rec.segments].sort((a, b) => {
                            const tA = (a.roster_in || a.actual_in || '00:00');
                            const tB = (b.roster_in || b.actual_in || '00:00');
                            return tA.localeCompare(tB);
                          });

                          cellContent = <div className="flex flex-col gap-1">
                            {sortedSegs.map((s, idx) => {
                              const segType = rec.has_actuals ? (s.actual_segment_type || s.segment_type) : s.segment_type;
                              const colorStyle = getSegmentBadgeColor(segType, rec.has_actuals, s.is_unplanned, isWeekend);

                              return (
                                <div key={idx} title={s.notes ? `Note: ${s.notes}` : undefined} className={`text-[0.65rem] font-bold px-1 py-0.5 rounded border relative ${colorStyle}`}>
                                  {rec.has_actuals && s.actual_in && s.actual_out ? `${s.actual_in} - ${s.actual_out}` : (s.roster_in && s.roster_out ? `${s.roster_in} - ${s.roster_out}` : segType)}
                                  {s.notes && (
                                    <svg className="w-2.5 h-2.5 inline-block ml-1 opacity-70" viewBox="0 0 24 24" fill="currentColor">
                                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                    </svg>
                                  )}
                                </div>
                              );
                            })}
                          </div>;
                        }
                        return (
                          <td onClick={() => handleCellClick(emp.id, emp.full_name, iso)} key={i} className={`text-center align-middle cursor-pointer hover:bg-[var(--glass-4)] ${i === 6 ? '!border-r-2 !border-r-[var(--primary)]' : ''}`}>
                            {cellContent}
                          </td>
                        );
                      })}
                      <td className="text-center text-[var(--muted)] font-bold text-xs bg-[var(--panel)]">{totalRoster.toFixed(2)}h</td>
                      <td className="text-center text-[var(--success)] font-bold text-xs bg-[var(--panel)] p-2">
                        <div>{totalTimesheet.toFixed(2)}h</div>
                        {/* Actual Hours Breakdown */}
                        <div className="flex flex-col gap-0.5 mt-1 text-[0.6rem] font-bold">
                          {breakdown.Weekdays > 0 && <span className="text-[var(--primary)]">Weekdays: {breakdown.Weekdays.toFixed(2)}h</span>}
                          {breakdown.Weekends > 0 && <span className="text-[#06b6d4]">Weekends: {breakdown.Weekends.toFixed(2)}h</span>}
                          {breakdown.TIL > 0 && <span className="text-[#10b981]">TIL: {breakdown.TIL.toFixed(2)}h</span>}
                          {breakdown.Sick > 0 && <span className="text-[#f59e0b]">Sick: {breakdown.Sick.toFixed(2)}h</span>}
                          {breakdown.Annual > 0 && <span className="text-[#a855f7]">Annual: {breakdown.Annual.toFixed(2)}h</span>}
                          {breakdown.Unplanned > 0 && <span className="text-[#ef4444]">Unplanned: {breakdown.Unplanned.toFixed(2)}h</span>}
                        </div>
                      </td>
                      <td className={`text-center font-bold text-xs bg-[var(--panel)] ${totalTimesheet - totalRoster > 0 ? 'text-[var(--success)]' : totalTimesheet - totalRoster < 0 ? 'text-[var(--danger)]' : 'text-[var(--muted)]'}`}>
                        {(totalTimesheet - totalRoster) > 0 ? `+${(totalTimesheet - totalRoster).toFixed(2)}h` : `${(totalTimesheet - totalRoster).toFixed(2)}h`}
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Confirmation & Day Selection Modal for Auto-Roster All / Auto-Log All */}
      {(showAutoRosterModal || showAutoLogModal) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="bg-[var(--panel)] rounded-3xl w-full max-w-xl border border-[var(--border)] shadow-2xl p-6 flex flex-col">
            <div className="flex justify-between items-center mb-4 border-b border-[var(--border)] pb-3">
              <h3 className="text-xl font-bold text-[var(--text)]">
                {showAutoRosterModal 
                  ? (singleEmpTarget ? `Confirm Auto-Roster for ${singleEmpTarget.full_name}` : 'Confirm Auto-Roster All')
                  : (singleEmpTarget ? `Confirm Auto-Log for ${singleEmpTarget.full_name}` : 'Confirm Auto-Log All')}
              </h3>
              <button 
                onClick={() => { setShowAutoRosterModal(false); setShowAutoLogModal(false); setSingleEmpTarget(null); }}
                className="w-8 h-8 rounded-full bg-[var(--glass-4)] hover:bg-[var(--glass-8)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <p className="text-sm text-[var(--muted)] mb-4">
              {showAutoRosterModal 
                ? `Select the days of the fortnight you want to generate rosters for ${singleEmpTarget ? singleEmpTarget.full_name : 'all employees'} based on default templates:`
                : `Select the days of the fortnight you want to copy rostered shifts into actual logged timesheets for ${singleEmpTarget ? singleEmpTarget.full_name : 'all employees'}:`}
            </p>

            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">
                Select Days ({selectedDays.length} / 14 selected)
              </span>
              <div className="flex gap-2">
                <button 
                  type="button"
                  onClick={() => setSelectedDays(Array.from({ length: 14 }, (_, i) => i))}
                  className="text-xs font-bold text-[var(--primary)] hover:underline"
                >
                  Select All
                </button>
                <span className="text-xs text-[var(--muted)]">|</span>
                <button 
                  type="button"
                  onClick={() => setSelectedDays([])}
                  className="text-xs font-bold text-[var(--muted)] hover:underline"
                >
                  Deselect All
                </button>
              </div>
            </div>

            {/* 14-Day Selector Grid */}
            <div className="grid grid-cols-7 gap-2 mb-6">
              {days.map((d, i) => {
                const isSelected = selectedDays.includes(i);
                const weekNum = i < 7 ? 1 : 2;
                const dayName = d.toLocaleString('default', { weekday: 'short' });
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDaySelection(i)}
                    className={`p-2 rounded-xl text-center border transition-all cursor-pointer ${
                      isSelected 
                        ? 'bg-[var(--primary-light)] border-[var(--primary)] text-[var(--primary)] font-bold shadow-sm' 
                        : 'bg-[var(--input-bg)] border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    <div className="text-[0.65rem] uppercase font-bold opacity-75">W{weekNum} {dayName}</div>
                    <div className="text-xs font-bold">{d.getDate()}</div>
                  </button>
                );
              })}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border)]">
              <button 
                type="button"
                onClick={() => { setShowAutoRosterModal(false); setShowAutoLogModal(false); }}
                className="px-5 py-2.5 bg-[var(--panel-subtle)] hover:bg-[var(--glass-8)] text-[var(--text)] font-bold rounded-xl border border-[var(--border)] text-xs transition-colors"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={showAutoRosterModal ? handleConfirmAutoRoster : handleConfirmAutoLog}
                className="px-6 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-[var(--primary-light)]"
              >
                {showAutoRosterModal ? 'Run Auto-Roster' : 'Run Auto-Log'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lock Authentication Password Modal */}
      {lockModalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="bg-[var(--panel)] rounded-3xl w-full max-w-md border border-[var(--border)] shadow-2xl p-6 flex flex-col">
            <div className="flex justify-between items-center mb-4 border-b border-[var(--border)] pb-3">
              <h3 className="text-xl font-bold text-[var(--text)]">
                Authenticate Lock Status
              </h3>
              <button 
                onClick={() => setLockModalType(null)}
                className="w-8 h-8 rounded-full bg-[var(--glass-4)] hover:bg-[var(--glass-8)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <p className="text-sm text-[var(--muted)] mb-4">
              Enter your account password to confirm toggling <strong>{lockModalType === 'roster' ? 'Roster Lock' : 'Timesheet Lock'}</strong> for fortnight starting {activeFortnightStart.toLocaleDateString()}:
            </p>

            {lockError && (
              <div className="mb-4 text-xs font-bold text-[var(--danger)] bg-[var(--danger-light)] p-3 rounded-xl border border-[var(--danger)]/30">
                {lockError}
              </div>
            )}

            <form onSubmit={confirmLockToggle} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">Account Password</label>
                <input 
                  required
                  type="password"
                  placeholder="Enter your password"
                  value={lockPasswordInput}
                  onChange={e => setLockPasswordInput(e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] outline-none focus:border-[var(--primary)] text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border)]">
                <button 
                  type="button"
                  onClick={() => setLockModalType(null)}
                  className="px-5 py-2.5 bg-[var(--panel-subtle)] hover:bg-[var(--glass-8)] text-[var(--text)] font-bold rounded-xl border border-[var(--border)] text-xs transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-6 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-[var(--primary-light)]"
                >
                  Confirm Lock Toggle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeCell && (
          <CellEditorModal 
              empId={activeCell.empId} 
              empName={activeCell.empName}
              dateIso={activeCell.dateIso} 
              existingRecords={activeCell.records} 
              rosterLocked={rosterLocked}
              timesheetLocked={timesheetLocked}
              onClose={() => setActiveCell(null)} 
              onSave={fetchData} 
          />
      )}

      {/* Push & Finalise Roster Modal */}
      {showPushLockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="bg-[var(--panel)] rounded-3xl w-full max-w-md border border-[var(--border)] shadow-2xl p-6 flex flex-col">
            <div className="flex justify-between items-center mb-4 border-b border-[var(--border)] pb-3">
              <h3 className="text-xl font-bold text-[var(--text)]">
                Finalise & Lock Roster
              </h3>
              <button 
                onClick={() => setShowPushLockModal(false)}
                className="w-8 h-8 rounded-full bg-[var(--glass-4)] hover:bg-[var(--glass-8)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <p className="text-sm text-[var(--muted)] mb-3">
              The roster for fortnight starting <strong>{activeFortnightStart.toLocaleDateString()}</strong> must be finalised and locked before publishing shifts to employees.
            </p>
            <p className="text-xs text-[var(--muted)] mb-4">
              Enter your Roster Lock Password (or Account Master Password) to finalise, lock and publish immediately:
            </p>

            {pushLockError && (
              <div className="mb-4 text-xs font-bold text-[var(--danger)] bg-[var(--danger-light)] p-3 rounded-xl border border-[var(--danger)]/30">
                {pushLockError}
              </div>
            )}

            <form onSubmit={handleConfirmPushAndLock} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">Roster Lock Password</label>
                <input 
                  required
                  type="password"
                  placeholder="Enter lock password"
                  value={pushLockPassword}
                  onChange={e => setPushLockPassword(e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] outline-none focus:border-[var(--primary)] text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border)]">
                <button 
                  type="button"
                  onClick={() => setShowPushLockModal(false)}
                  className="px-5 py-2.5 bg-[var(--panel-subtle)] hover:bg-[var(--glass-8)] text-[var(--text)] font-bold rounded-xl border border-[var(--border)] text-xs transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={publishing}
                  className="px-6 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-[var(--primary-light)] disabled:opacity-50"
                >
                  {publishing ? 'Publishing...' : 'Finalise, Lock & Push'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function CellEditorModal({ empId, empName, dateIso, existingRecords, rosterLocked, timesheetLocked, onClose, onSave }: any) {
    const [segments, setSegments] = useState<Segment[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (existingRecords.length > 0 && existingRecords[0].segments?.length > 0) {
            setSegments(existingRecords[0].segments);
        } else {
            setSegments([{ segment_type: 'WORK', roster_in: '09:00', roster_out: '17:00', roster_hours: 7.5, actual_in: '', actual_out: '', actual_hours: 0, is_unplanned: false }]);
        }
    }, [existingRecords]);

    const formattedDate = () => {
      const dt = new Date(dateIso + 'T00:00:00');
      return dt.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    };

    const toMins = (t?: string): number => {
      if (!t) return 0;
      const [h, m] = t.split(':').map(Number);
      return h * 60 + (m || 0);
    };

    const checkOverlaps = (): string | null => {
      for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
          const s1 = segments[i], s2 = segments[j];
          if (!s1.is_unplanned && !s2.is_unplanned && s1.roster_in && s1.roster_out && s2.roster_in && s2.roster_out) {
            let start1 = toMins(s1.roster_in), end1 = toMins(s1.roster_out);
            let start2 = toMins(s2.roster_in), end2 = toMins(s2.roster_out);
            if (end1 <= start1) end1 += 1440;
            if (end2 <= start2) end2 += 1440;
            if (Math.max(start1, start2) < Math.min(end1, end2)) {
              return `Planned roster shift times overlap between Segment #${i+1} and Segment #${j+1}. Please adjust shift times.`;
            }
          }
          if (s1.actual_in && s1.actual_out && s2.actual_in && s2.actual_out) {
            let start1 = toMins(s1.actual_in), end1 = toMins(s1.actual_out);
            let start2 = toMins(s2.actual_in), end2 = toMins(s2.actual_out);
            if (end1 <= start1) end1 += 1440;
            if (end2 <= start2) end2 += 1440;
            if (Math.max(start1, start2) < Math.min(end1, end2)) {
              return `Logged timesheet shift times overlap between Segment #${i+1} and Segment #${j+1}. Please adjust shift times.`;
            }
          }
        }
      }
      return null;
    };

    const handleSave = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        setError('');

        const overlapError = checkOverlaps();
        if (overlapError) {
          setError(overlapError);
          return;
        }

        setLoading(true);
        try {
            await api.post('/records', {
                employee_id: empId,
                record_date: dateIso,
                segments: segments
            });
            onSave();
            onClose();
        } catch (err: any) {
            setError(err.response?.data?.error?.message || 'Failed to save shift');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm("Are you sure you want to delete shifts for this day?")) return;
        setLoading(true);
        try {
            await api.post('/records', {
                employee_id: empId,
                record_date: dateIso,
                segments: []
            });
            onSave();
            onClose();
        } catch (err: any) {
            setError(err.response?.data?.error?.message || 'Failed to delete shift');
        } finally {
            setLoading(false);
        }
    };

    const handleDefaultShift = () => {
        setSegments([{ segment_type: 'WORK', roster_in: '09:00', roster_out: '17:00', roster_hours: 7.5, actual_in: '09:00', actual_out: '17:00', actual_hours: 7.5, is_unplanned: false }]);
    };

    const updateSeg = (idx: number, field: string, val: any) => {
        const up = [...segments];
        (up[idx] as any)[field] = val;
        setSegments(up);
        setError('');
    };

    const addSeg = () => {
        setSegments([...segments, { segment_type: 'WORK', roster_in: '', roster_out: '', roster_hours: 0, actual_in: '', actual_out: '', actual_hours: 0, is_unplanned: false }]);
        setError('');
    };

    const removeSeg = (idx: number) => {
        if (segments.length === 1) {
            setSegments([{ segment_type: 'WORK', roster_in: '', roster_out: '', roster_hours: 0, actual_in: '', actual_out: '', actual_hours: 0, is_unplanned: false }]);
        } else {
            setSegments(segments.filter((_, i) => i !== idx));
        }
        setError('');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
            <div className="bg-[var(--panel)] rounded-3xl w-full max-w-4xl border border-[var(--border)] shadow-2xl p-6 sm:p-8 flex flex-col max-h-[90vh] relative">
                {/* Header */}
                <div className="flex justify-between items-start mb-4 pb-3 border-b border-[var(--border)]">
                    <div>
                        <h2 className="text-2xl sm:text-3xl font-black text-[var(--primary)] tracking-tight">{empName}</h2>
                        <p className="text-xs sm:text-sm font-semibold text-[var(--muted)] mt-0.5">{formattedDate()}</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-[var(--glass-4)] hover:bg-[var(--glass-8)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] transition-colors">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                {error && (
                  <div className="mb-4 p-4 bg-[var(--danger-light)] text-[var(--danger)] border border-[var(--danger)]/30 rounded-2xl text-sm font-bold flex items-center gap-2">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSave} className="flex flex-col flex-1 min-h-0 overflow-hidden">
                    {/* Scrollable Segments Container */}
                    <div className="flex-1 overflow-y-auto space-y-5 pr-1 pb-4">
                        {segments.map((s, idx) => (
                            <div key={idx} className="bg-[var(--input-bg)] p-5 sm:p-6 rounded-2xl border border-[var(--border)] space-y-4">
                                <div className="flex justify-between items-center border-b border-[var(--border)] pb-3">
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">Segment #{idx + 1}</span>
                                        <button 
                                          type="button" 
                                          disabled={rosterLocked || timesheetLocked}
                                          onClick={() => removeSeg(idx)} 
                                          className="text-[0.65rem] font-bold text-[var(--danger)] hover:underline px-2 py-0.5 rounded bg-[var(--danger-light)] border border-[var(--danger)]/20 transition-colors disabled:opacity-50"
                                        >
                                          Delete Segment
                                        </button>
                                    </div>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input 
                                          type="checkbox" 
                                          checked={s.is_unplanned} 
                                          onChange={e => updateSeg(idx, 'is_unplanned', e.target.checked)} 
                                          className="rounded bg-[var(--bg)] border-[var(--border)] text-[var(--primary)]"
                                        />
                                        <span className="text-[0.7rem] font-bold text-[var(--muted)] uppercase tracking-wider">UNPLANNED SHIFT / EXCEPTION</span>
                                    </label>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Left Column: PLANNED ROSTER */}
                                    <div className="space-y-3">
                                        <h4 className="text-[0.7rem] font-bold text-[var(--muted)] uppercase tracking-wider">PLANNED ROSTER</h4>
                                        <select 
                                          disabled={rosterLocked}
                                          value={s.segment_type} 
                                          onChange={e => updateSeg(idx, 'segment_type', e.target.value)} 
                                          className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-xl px-4 py-3 text-[var(--text)] text-sm outline-none focus:border-[var(--primary)] disabled:opacity-50"
                                        >
                                            <option value="WORK">Normal Work</option>
                                            <option value="Sick">Sick Leave</option>
                                            <option value="Annual">Annual Leave</option>
                                            <option value="TIL">Time In Lieu</option>
                                        </select>
                                        <div className="flex gap-3">
                                            <SmartTimeInput 
                                              disabled={rosterLocked} 
                                              value={s.roster_in || ''} 
                                              onChange={val => updateSeg(idx, 'roster_in', val)} 
                                              className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-xl px-4 py-3 text-[var(--text)] text-sm outline-none focus:border-[var(--primary)] disabled:opacity-50" 
                                            />
                                            <SmartTimeInput 
                                              disabled={rosterLocked} 
                                              value={s.roster_out || ''} 
                                              onChange={val => updateSeg(idx, 'roster_out', val)} 
                                              className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-xl px-4 py-3 text-[var(--text)] text-sm outline-none focus:border-[var(--primary)] disabled:opacity-50" 
                                            />
                                        </div>
                                    </div>

                                    {/* Right Column: LOGGED TIMESHEET */}
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center gap-2">
                                          <h4 className="text-[0.7rem] font-bold text-[var(--success)] uppercase tracking-wider">LOGGED TIMESHEET</h4>
                                          <select 
                                            disabled={timesheetLocked}
                                            value={s.actual_segment_type || s.segment_type || 'WORK'} 
                                            onChange={e => updateSeg(idx, 'actual_segment_type', e.target.value)} 
                                            className="bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-xs font-bold text-[var(--success)] outline-none focus:border-[var(--success)] disabled:opacity-50"
                                          >
                                              <option value="WORK">Normal</option>
                                              <option value="Sick">Sick Leave</option>
                                              <option value="Annual">Annual Leave</option>
                                              <option value="TIL">Time In Lieu (TIL)</option>
                                          </select>
                                        </div>
                                        <div className="h-[46px] hidden md:block"></div>
                                        <div className="flex gap-3">
                                            <SmartTimeInput 
                                              disabled={timesheetLocked} 
                                              placeholder="e.g. 9a, 1700" 
                                              value={s.actual_in || ''} 
                                              onChange={val => updateSeg(idx, 'actual_in', val)} 
                                              className="w-full bg-[var(--panel)] border border-[var(--success)]/40 rounded-xl px-4 py-3 text-[var(--text)] text-sm outline-none focus:border-[var(--success)] disabled:opacity-50" 
                                            />
                                            <SmartTimeInput 
                                              disabled={timesheetLocked} 
                                              placeholder="e.g. 5p, 1700" 
                                              value={s.actual_out || ''} 
                                              onChange={val => updateSeg(idx, 'actual_out', val)} 
                                              className="w-full bg-[var(--panel)] border border-[var(--success)]/40 rounded-xl px-4 py-3 text-[var(--text)] text-sm outline-none focus:border-[var(--success)] disabled:opacity-50" 
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Shift Segment Notes / Comments */}
                                <div className="pt-2 border-t border-[var(--border)]">
                                  <label className="block text-[0.7rem] font-bold text-[var(--muted)] uppercase tracking-wider mb-1">
                                    Comments / Shift Notes
                                  </label>
                                  <input 
                                    type="text"
                                    placeholder="Add optional comments or notes for this shift (e.g. Approved leave, overtime reason)"
                                    value={s.notes || ''}
                                    onChange={e => updateSeg(idx, 'notes', e.target.value)}
                                    className="w-full bg-[var(--panel)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-xs text-[var(--text)] outline-none focus:border-[var(--primary)]"
                                  />
                                </div>
                            </div>
                        ))}

                        <button 
                          type="button" 
                          disabled={rosterLocked || timesheetLocked}
                          onClick={addSeg} 
                          className="w-full py-3 bg-[var(--panel-subtle)] hover:bg-[var(--glass-8)] border border-[var(--border)] rounded-2xl text-xs font-bold text-[var(--text)] transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            + Add Another Split / Leave Segment
                        </button>
                    </div>

                    {/* Fixed Bottom Action Bar */}
                    <div className="flex items-center justify-between pt-4 border-t border-[var(--border)] gap-3 bg-[var(--panel)] mt-2">
                        <button 
                          type="submit" 
                          disabled={loading || (rosterLocked && timesheetLocked)} 
                          className="flex-1 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold py-3 rounded-2xl transition-all shadow-lg shadow-[var(--primary-light)] disabled:opacity-50 text-sm"
                        >
                            {loading ? 'Saving...' : 'Save Shifts'}
                        </button>
                        
                        <div className="flex gap-2">
                          <button 
                            type="button" 
                            disabled={rosterLocked || timesheetLocked}
                            onClick={handleDefaultShift} 
                            className="px-4 py-3 bg-[var(--panel-subtle)] hover:bg-[var(--glass-8)] text-[var(--muted)] hover:text-[var(--text)] font-bold rounded-2xl border border-[var(--border)] text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
                          >
                              Default Shift
                          </button>
                          <button 
                            type="button" 
                            disabled={rosterLocked || timesheetLocked}
                            onClick={handleDelete} 
                            className="px-4 py-3 bg-[var(--danger-light)] hover:bg-[var(--danger)]/20 text-[var(--danger)] font-bold rounded-2xl border border-[var(--danger)]/20 text-xs transition-colors disabled:opacity-50"
                          >
                              Clear Day
                          </button>
                          <button 
                            type="button" 
                            onClick={onClose} 
                            className="px-4 py-3 bg-[var(--panel-subtle)] hover:bg-[var(--glass-8)] text-[var(--text)] font-bold rounded-2xl border border-[var(--border)] text-xs transition-colors"
                          >
                              Cancel
                          </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
