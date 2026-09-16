import { useState, useEffect } from 'react';
import { jwtDecode } from 'jwt-decode';
import { MessageSquare, Smile, Trash2, Send, ShieldAlert } from 'lucide-react';
import api from '../services/apiClient';

interface DaySummary {
  date: string;
  dayIndex: number;
  dayOfWeek: string;
  isPublicHoliday: boolean;
  holidayName?: string;
  rosteredHours: number;
  actualHours: number;
  segments: any[];
}

interface LeaveRequest {
  id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  hours: number;
  reason?: string;
  status: string;
  rejection_reason?: string;
}

interface ReactionSummary {
  emoji: string;
  count: number;
  user_reacted: boolean;
  users: string[];
}

interface AnnouncementReply {
  id: string;
  announcement_id: string;
  org_id: string;
  author_id: string;
  author_name: string;
  author_role: string;
  content: string;
  created_at: string;
}

interface Announcement {
  id: string;
  org_id: string;
  author_id?: string;
  author_name: string;
  author_role: string;
  title?: string;
  content: string;
  is_system: boolean;
  announcement_type: string;
  reactions?: ReactionSummary[];
  replies?: AnnouncementReply[];
  reply_count?: number;
  created_at: string;
}

interface TeamMemberRoster {
  id: string;
  full_name: string;
  department: string;
  total_rostered_hours: number;
  days: {
    date: string;
    dayIndex: number;
    dayOfWeek: string;
    isPublicHoliday: boolean;
    holidayName?: string;
    rosteredHours: number;
    segments: {
      id: string;
      segment_type: string;
      roster_in: string;
      roster_out: string;
      roster_hours: number;
    }[];
  }[];
}

type TabType = 'schedule' | 'leave' | 'announcements';
type CalendarViewMode = 'day' | 'week' | 'fortnight';
type ScheduleScope = 'my_schedule' | 'team_roster';

const COMMON_EMOJIS = ['👍', '❤️', '🎉', '👏', '🚀', '👀'];

export default function Portal() {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [portalData, setPortalData] = useState<any>(null);
  const [activeDate, setActiveDate] = useState<Date>(new Date());
  
  // Navigation & View State
  const [activeTab, setActiveTab] = useState<TabType>('schedule');
  const [scheduleScope, setScheduleScope] = useState<ScheduleScope>('my_schedule');
  const [calendarView, setCalendarView] = useState<CalendarViewMode>('week');
  
  // Team Roster State
  const [teamRosterData, setTeamRosterData] = useState<{ is_published: boolean; team: TeamMemberRoster[]; days: any[] } | null>(null);
  const [loadingTeamRoster, setLoadingTeamRoster] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState('All');
  const [teamWeekView, setTeamWeekView] = useState<'all' | 'w1' | 'w2'>('all');

  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Leave Request Modal State
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [leaveType, setLeaveType] = useState('Sick');
  const [leaveStartDate, setLeaveStartDate] = useState('');
  const [leaveEndDate, setLeaveEndDate] = useState('');
  const [leaveHours, setLeaveHours] = useState('7.6');
  const [leaveReason, setLeaveReason] = useState('');
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);

  // Announcements / Team Chat State
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(false);
  const [allowEmployeeChat, setAllowEmployeeChat] = useState(true);
  const [chatContent, setChatContent] = useState('');
  const [chatSubmitting, setChatSubmitting] = useState(false);
  const [submittingTimesheet, setSubmittingTimesheet] = useState(false);
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});
  const [replyInputs, setReplyInputs] = useState<Record<string, string>>({});
  const [submittingReplies, setSubmittingReplies] = useState<Record<string, boolean>>({});
  const [activePickerId, setActivePickerId] = useState<string | null>(null);

  // User auth context
  const token = localStorage.getItem('token');
  let currentUserId = '';
  let currentUserRole = 'Employee';
  if (token) {
    try {
      const decoded: any = jwtDecode(token);
      currentUserId = decoded.id || '';
      currentUserRole = decoded.role || 'Employee';
    } catch {}
  }
  const isMgmt = ['Admin', 'Company Admin', 'Platform Admin', 'Manager'].includes(currentUserRole);
  const [seenAnnouncementIds, setSeenAnnouncementIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('seen_announcement_ids');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const markAnnouncementsAsSeen = (items: Announcement[]) => {
    if (!items || items.length === 0) return;
    const currentSeen = new Set(seenAnnouncementIds);
    let changed = false;
    items.forEach(a => {
      if (!currentSeen.has(a.id)) {
        currentSeen.add(a.id);
        changed = true;
      }
    });
    if (changed) {
      const updated = Array.from(currentSeen);
      setSeenAnnouncementIds(updated);
      try {
        localStorage.setItem('seen_announcement_ids', JSON.stringify(updated));
      } catch {}
    }
  };

  const unreadAnnouncementsCount = announcements.filter(a => !seenAnnouncementIds.includes(a.id)).length;

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
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

  const fetchPortal = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.get(`/portal/my-timesheet?start_date=${fnIso}`);
      if (res.data?.data) {
        setPortalData(res.data.data);
      }
    } catch (err: any) {
      console.warn('My timesheet error:', err);
      setErrorMsg(err.response?.data?.error?.message || 'Unable to load personal timesheet. You may not be assigned to an employee profile.');
    } finally {
      setLoading(false);
    }
  };

  const fetchLeaveRequests = async () => {
    try {
      const res = await api.get('/portal/leave-requests');
      if (res.data?.data) {
        setLeaveRequests(res.data.data);
      }
    } catch (err) {
      console.warn('Failed to fetch leave requests', err);
    }
  };

  const fetchAnnouncements = async () => {
    setLoadingAnnouncements(true);
    try {
      const res = await api.get('/announcements');
      if (res.data?.data) {
        setAnnouncements(res.data.data);
        if (activeTab === 'announcements') {
          markAnnouncementsAsSeen(res.data.data);
        }
      }
      if (res.data?.permissions) {
        setAllowEmployeeChat(res.data.permissions.allow_employee_chat !== false);
      }
    } catch (err) {
      console.warn('Failed to fetch announcements', err);
    } finally {
      setLoadingAnnouncements(false);
    }
  };

  const handleToggleReaction = async (announcementId: string, emoji: string) => {
    try {
      const res = await api.post(`/announcements/${announcementId}/reactions`, { emoji });
      if (res.data?.data?.reactions) {
        const updatedReactions = res.data.data.reactions;
        setAnnouncements(prev => prev.map(a => a.id === announcementId ? { ...a, reactions: updatedReactions } : a));
      }
    } catch (err) {
      console.error('Failed to toggle reaction', err);
    } finally {
      setActivePickerId(null);
    }
  };

  const handleToggleThread = (announcementId: string) => {
    setExpandedThreads(prev => ({ ...prev, [announcementId]: !prev[announcementId] }));
  };

  const handlePostReply = async (announcementId: string, e: React.FormEvent) => {
    e.preventDefault();
    const replyText = replyInputs[announcementId]?.trim();
    if (!replyText) return;

    setSubmittingReplies(prev => ({ ...prev, [announcementId]: true }));
    try {
      const res = await api.post(`/announcements/${announcementId}/replies`, { content: replyText });
      if (res.data?.data) {
        const newReply = res.data.data;
        setAnnouncements(prev => prev.map(a => {
          if (a.id === announcementId) {
            const currentReplies = a.replies || [];
            return {
              ...a,
              replies: [...currentReplies, newReply],
              reply_count: (a.reply_count || currentReplies.length) + 1
            };
          }
          return a;
        }));
        setReplyInputs(prev => ({ ...prev, [announcementId]: '' }));
        showToast('Reply added');
      }
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to post reply');
    } finally {
      setSubmittingReplies(prev => ({ ...prev, [announcementId]: false }));
    }
  };

  const handleDeleteReply = async (announcementId: string, replyId: string) => {
    if (!window.confirm('Delete this reply?')) return;
    try {
      await api.delete(`/announcements/${announcementId}/replies/${replyId}`);
      setAnnouncements(prev => prev.map(a => {
        if (a.id === announcementId) {
          const currentReplies = a.replies || [];
          const updated = currentReplies.filter(r => r.id !== replyId);
          return {
            ...a,
            replies: updated,
            reply_count: Math.max(0, (a.reply_count || 1) - 1)
          };
        }
        return a;
      }));
      showToast('Reply removed');
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to delete reply');
    }
  };

  const fetchTeamRoster = async () => {
    setLoadingTeamRoster(true);
    try {
      const res = await api.get(`/portal/team-roster?start_date=${fnIso}`);
      if (res.data?.data) {
        setTeamRosterData(res.data.data);
      }
    } catch (err) {
      console.warn('Failed to fetch team roster', err);
    } finally {
      setLoadingTeamRoster(false);
    }
  };

  useEffect(() => {
    fetchPortal();
    fetchLeaveRequests();
    fetchAnnouncements();
    fetchTeamRoster();
  }, [fnIso]);

  useEffect(() => {
    if (activeTab === 'announcements' && announcements.length > 0) {
      markAnnouncementsAsSeen(announcements);
    }
  }, [activeTab, announcements]);



  const handleCreateLeaveRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLeaveSubmitting(true);
    try {
      await api.post('/portal/leave-requests', {
        leave_type: leaveType,
        start_date: leaveStartDate,
        end_date: leaveEndDate,
        hours: Number(leaveHours),
        reason: leaveReason
      });
      showToast('Leave request submitted successfully');
      setShowLeaveModal(false);
      setLeaveReason('');
      fetchLeaveRequests();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to submit leave request');
    } finally {
      setLeaveSubmitting(false);
    }
  };

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatContent.trim()) return;
    setChatSubmitting(true);
    try {
      await api.post('/announcements', { content: chatContent.trim() });
      setChatContent('');
      showToast('Message posted to Team Chat');
      fetchAnnouncements();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to post message');
    } finally {
      setChatSubmitting(false);
    }
  };

  const handleDeleteChatMessage = async (id: string) => {
    if (!window.confirm('Delete this message?')) return;
    try {
      await api.delete(`/announcements/${id}`);
      showToast('Message deleted');
      setAnnouncements(prev => prev.filter(a => a.id !== id));
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to delete message');
    }
  };

  const handleSubmitTimesheet = async () => {
    setSubmittingTimesheet(true);
    try {
      const res = await api.post('/submissions/submit', { start_date: fnIso });
      if (res.data?.success) {
        showToast('Timesheet submitted successfully for review');
        fetchPortal();
      }
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to submit timesheet');
    } finally {
      setSubmittingTimesheet(false);
    }
  };

  const formatDateStr = (d: Date) => d.toISOString().split('T')[0];

  // Helper date manipulators
  const handleNavPrev = () => {
    const d = new Date(activeDate);
    if (calendarView === 'day') d.setDate(d.getDate() - 1);
    else if (calendarView === 'week') d.setDate(d.getDate() - 7);
    else if (calendarView === 'fortnight') d.setDate(d.getDate() - 14);
    else d.setDate(d.getDate() - 14);
    setActiveDate(d);
  };

  const handleNavNext = () => {
    const d = new Date(activeDate);
    if (calendarView === 'day') d.setDate(d.getDate() + 1);
    else if (calendarView === 'week') d.setDate(d.getDate() + 7);
    else if (calendarView === 'fortnight') d.setDate(d.getDate() + 14);
    else d.setDate(d.getDate() + 14);
    setActiveDate(d);
  };

  const handleNavToday = () => {
    setActiveDate(new Date());
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--muted)] font-bold">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin"></div>
          Loading employee portal...
        </div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="max-w-xl mx-auto mt-16 p-6 bg-[var(--panel)] border border-[var(--border)] rounded-2xl shadow-lg text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center">
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
        </div>
        <h3 className="text-xl font-black text-[var(--text)]">Employee Profile Required</h3>
        <p className="text-sm text-[var(--muted)]">{errorMsg}</p>
        <p className="text-xs text-[var(--muted)]">If you are an administrator, please use the Roster or Employees tab, or link your user account to an employee record in Team Directory.</p>
      </div>
    );
  }

  const days: DaySummary[] = portalData?.days || [];

  // Selected date ISO
  const activeDateIso = formatDateStr(activeDate);
  const selectedDayObj = days.find(d => d.date === activeDateIso) || {
    date: activeDateIso,
    dayOfWeek: activeDate.toLocaleDateString('en-US', { weekday: 'short' }),
    rosteredHours: 0,
    actualHours: 0,
    isPublicHoliday: false,
    segments: []
  };

  const allTeamDays = teamRosterData?.days || [];
  const displayDays = teamWeekView === 'w1'
    ? allTeamDays.slice(0, 7)
    : teamWeekView === 'w2'
    ? allTeamDays.slice(7, 14)
    : allTeamDays;

  const filteredTeam = (teamRosterData?.team || []).filter(member => {
    if (selectedDeptFilter !== 'All' && member.department !== selectedDeptFilter) return false;
    if (teamSearch.trim()) {
      const q = teamSearch.toLowerCase();
      return member.full_name.toLowerCase().includes(q) || member.department.toLowerCase().includes(q);
    }
    return true;
  });

  const isTeamRosterView = activeTab === 'schedule' && scheduleScope === 'team_roster';

  return (
    <div className={`flex flex-col h-full mx-auto gap-6 mt-4 pb-16 transition-all duration-200 ${
      isTeamRosterView ? 'w-full max-w-[98vw] xl:max-w-[1680px] px-2 sm:px-4' : 'max-w-6xl px-2'
    }`}>
      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-20 right-6 z-50 bg-[var(--primary)] text-white font-bold text-xs px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2">
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 max-w-full">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-2xl sm:text-3xl font-black text-[var(--text)] tracking-tight">Employee Portal</h2>
            {portalData?.employee && (
              <span className="bg-[var(--primary-light)] text-[var(--primary)] text-xs font-bold px-2.5 py-1 rounded-md border border-[var(--primary)]/25 tracking-wide">
                {portalData.employee.full_name} <span className="opacity-70">({portalData.employee.department || 'General'})</span>
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-[var(--muted)] mt-1">Overview of your shifts, timesheet submissions, leave, and team chat</p>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center bg-[var(--panel-subtle)] p-1 rounded-2xl border border-[var(--border)] shadow-sm gap-1">
          <button
            onClick={() => setActiveTab('schedule')}
            className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'schedule'
                ? 'bg-[var(--panel)] text-[var(--primary)] shadow-sm'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span>My Schedule</span>
          </button>
          <button
            onClick={() => setActiveTab('leave')}
            className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'leave'
                ? 'bg-[var(--panel)] text-[var(--primary)] shadow-sm'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
            <span>Leave Requests</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('announcements');
              markAnnouncementsAsSeen(announcements);
            }}
            className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'announcements'
                ? 'bg-[var(--panel)] text-[var(--primary)] shadow-sm'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>Team Chat</span>
            {unreadAnnouncementsCount > 0 && (
              <span className="bg-[var(--primary)] text-white text-[10px] font-black px-1.5 py-0.2 rounded-full">
                {unreadAnnouncementsCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Timesheet Submission & Approval Status Bar */}
      <div className="bg-[var(--panel)] rounded-2xl border border-[var(--border)] p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${
            portalData?.submission?.status === 'Approved'
              ? 'bg-emerald-500/20 text-emerald-400'
              : portalData?.submission?.status === 'Submitted' || portalData?.submission?.status === 'Under Review'
              ? 'bg-blue-500/20 text-blue-400'
              : portalData?.submission?.status === 'Rejected'
              ? 'bg-rose-500/20 text-rose-400'
              : 'bg-zinc-500/20 text-zinc-400'
          }`}>
            {portalData?.submission?.status === 'Approved' ? '✓' : '⏱'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">Timesheet Status:</span>
              <span className={`text-xs font-black px-2.5 py-0.5 rounded-full ${
                portalData?.submission?.status === 'Approved'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : portalData?.submission?.status === 'Submitted'
                  ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                  : portalData?.submission?.status === 'Under Review'
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : portalData?.submission?.status === 'Rejected'
                  ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                  : 'bg-zinc-500/15 text-zinc-300 border border-zinc-500/30'
              }`}>
                {portalData?.submission?.status || 'Draft'}
              </span>
            </div>
            {portalData?.submission?.rejection_reason && (
              <p className="text-xs text-rose-400 font-medium mt-1">
                Feedback: {portalData.submission.rejection_reason}
              </p>
            )}
          </div>
        </div>

        {/* 1-Click Submission Action */}
        {(!portalData?.submission?.status || portalData?.submission?.status === 'Draft' || portalData?.submission?.status === 'Rejected') && (
          <button
            onClick={handleSubmitTimesheet}
            disabled={submittingTimesheet}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-colors shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50 self-end sm:self-auto"
          >
            <span>{submittingTimesheet ? 'Submitting...' : 'Submit Fortnight Timesheet'}</span>
          </button>
        )}
      </div>

      {/* TAB 1: MY SCHEDULE & FULL ROSTER */}
      {activeTab === 'schedule' && (
        <div className="space-y-4">
          {/* Sub-navigation: My Shifts vs Entire Team Roster */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--panel)] p-3 rounded-2xl border border-[var(--border)] shadow-sm">
            <div className="flex items-center gap-1 bg-[var(--panel-subtle)] p-1 rounded-xl border border-[var(--border)]">
              <button
                type="button"
                onClick={() => setScheduleScope('my_schedule')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                  scheduleScope === 'my_schedule'
                    ? 'bg-[var(--panel)] text-[var(--primary)] shadow-sm'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                <span>My Shifts</span>
              </button>
              <button
                type="button"
                onClick={() => setScheduleScope('team_roster')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                  scheduleScope === 'team_roster'
                    ? 'bg-[var(--panel)] text-[var(--primary)] shadow-sm'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                <span>Entire Team Roster</span>
              </button>
            </div>

            <div className="text-xs text-[var(--muted)] font-semibold flex items-center gap-2">
              <span>Fortnight:</span>
              <span className="font-bold text-[var(--text)]">
                {fnIso} → {(() => {
                  const [y, m, d] = fnIso.split('-').map(Number);
                  const end = new Date(Date.UTC(y, m - 1, d + 13));
                  return end.toISOString().split('T')[0];
                })()}
              </span>
            </div>
          </div>

          {scheduleScope === 'my_schedule' && (
            <div className="space-y-4">
              {!portalData?.locks?.is_published && (
            <div className="bg-[#f59e0b]/15 border border-[#f59e0b]/40 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#f59e0b]/20 text-[#f59e0b] flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </div>
              <div>
                <div className="font-bold text-sm text-[#f59e0b]">Roster Pending Publication</div>
                <div className="text-xs text-[var(--text)] mt-0.5 font-medium">
                  Management is currently finalizing shifts for this fortnight. Your official schedule will appear here as soon as it is published.
                </div>
              </div>
            </div>
          )}

          {/* Calendar Controls Bar */}
          <div className="bg-[var(--panel)] rounded-2xl border border-[var(--border)] p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center gap-2">
              <button
                onClick={handleNavPrev}
                className="px-3 py-1.5 bg-[var(--panel-subtle)] text-[var(--text)] rounded-xl border border-[var(--border)] text-xs font-bold hover:bg-[var(--glass-4)]"
              >
                ← Prev
              </button>
              <button
                onClick={handleNavToday}
                className="px-3 py-1.5 bg-[var(--primary-light)] text-[var(--primary)] rounded-xl text-xs font-bold hover:opacity-90"
              >
                Today
              </button>
              <button
                onClick={handleNavNext}
                className="px-3 py-1.5 bg-[var(--panel-subtle)] text-[var(--text)] rounded-xl border border-[var(--border)] text-xs font-bold hover:bg-[var(--glass-4)]"
              >
                Next →
              </button>
              <span className="ml-2 text-sm font-black text-[var(--text)]">
                {activeDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric', day: 'numeric' })}
              </span>
            </div>

            {/* View Mode Buttons */}
            <div className="flex items-center bg-[var(--panel-subtle)] p-1 rounded-xl border border-[var(--border)]">
              {(['day', 'week', 'fortnight'] as CalendarViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setCalendarView(mode)}
                  className={`px-3 py-1 text-xs font-bold rounded-lg capitalize transition-all ${
                    calendarView === mode
                      ? 'bg-[var(--panel)] text-[var(--primary)] shadow-sm'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* DAY VIEW */}
          {calendarView === 'day' && (
            <div className="bg-[var(--panel)] rounded-2xl border border-[var(--border)] p-6 shadow-sm space-y-4">
              <div className="flex justify-between items-center border-b border-[var(--border)] pb-3">
                <h3 className="text-lg font-black text-[var(--text)]">
                  {selectedDayObj.date} ({selectedDayObj.dayOfWeek})
                </h3>
                {selectedDayObj.isPublicHoliday && (
                  <span className="bg-[#ec4899]/20 text-[#ec4899] text-xs font-black px-3 py-1 rounded-full">
                    {selectedDayObj.holidayName || 'Public Holiday'}
                  </span>
                )}
              </div>

              {selectedDayObj.segments && selectedDayObj.segments.length > 0 ? (
                <div className="space-y-3">
                  {selectedDayObj.segments.map((seg: any, i: number) => (
                    <div key={i} className="p-4 bg-[var(--panel-subtle)] rounded-xl border border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <span className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider block">Shift Segment</span>
                        <div className="text-base font-black text-[var(--text)] mt-0.5">
                          {seg.roster_in && seg.roster_out ? `${seg.roster_in} – ${seg.roster_out}` : 'No Rostered Times'}
                        </div>
                        {seg.segment_type && (
                          <span className="inline-block mt-2 px-2.5 py-0.5 rounded text-xs font-bold bg-[var(--primary-light)] text-[var(--primary)] border border-[var(--primary)]/30">
                            {seg.segment_type}
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider block">Hours</span>
                        <span className="text-xl font-black text-[var(--primary)]">
                          {selectedDayObj.rosteredHours.toFixed(4)}h
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-[var(--muted)]">
                  <div className="w-10 h-10 mx-auto mb-2 rounded-xl bg-[var(--panel-subtle)] text-[var(--muted)] flex items-center justify-center">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="4"></circle>
                      <path d="M12 2v2"></path>
                      <path d="M12 20v2"></path>
                      <path d="m4.93 4.93 1.41 1.41"></path>
                      <path d="m17.66 17.66 1.41 1.41"></path>
                      <path d="M2 12h2"></path>
                      <path d="M20 12h2"></path>
                      <path d="m6.34 17.66-1.41 1.41"></path>
                      <path d="m19.07 4.93-1.41 1.41"></path>
                    </svg>
                  </div>
                  <div className="font-bold text-sm">No rostered shift for this date</div>
                  <div className="text-xs mt-1">Scheduled rest day</div>
                </div>
              )}
            </div>
          )}

          {/* WEEK VIEW */}
          {calendarView === 'week' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-7 gap-3">
              {days.slice(0, 7).map((d) => {
                const isWeekend = ['Sat', 'Sun'].includes(d.dayOfWeek);
                const seg = d.segments[0] || {};
                const isSelected = d.date === activeDateIso;

                return (
                  <div
                    key={d.date}
                    onClick={() => setActiveDate(new Date(d.date))}
                    className={`bg-[var(--panel)] p-3 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between min-h-[140px] ${
                      isSelected
                        ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/30 shadow-md'
                        : isWeekend
                        ? 'border-[var(--border)] bg-[var(--panel-subtle)]/40 hover:border-[var(--muted)]'
                        : 'border-[var(--border)] hover:border-[var(--muted)]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-black ${isWeekend ? 'text-[var(--primary)]' : 'text-[var(--text)]'}`}>
                          {d.dayOfWeek}
                        </span>
                        <span className="text-[11px] text-[var(--muted)] font-medium">{d.date.split('-').slice(1).join('/')}</span>
                      </div>

                      {d.isPublicHoliday && (
                        <div className="mt-1 bg-[#ec4899]/20 text-[#ec4899] text-[9px] font-black px-1.5 py-0.5 rounded">
                          Holiday
                        </div>
                      )}

                      <div className="mt-3">
                        {seg.roster_in && seg.roster_out ? (
                          <div className="bg-[var(--primary-light)] border border-[var(--primary)]/30 rounded-xl p-2">
                            <div className="text-[11px] font-bold text-[var(--primary)]">
                              {seg.roster_in} – {seg.roster_out}
                            </div>
                            <div className="text-[10px] text-[var(--muted)] mt-0.5">
                              {seg.segment_type || 'Shift'}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[11px] text-[var(--muted)] italic">Off</div>
                        )}
                      </div>
                    </div>

                    {d.rosteredHours > 0 && (
                      <div className="mt-2 pt-2 border-t border-[var(--border)] text-right">
                        <span className="text-[11px] font-extrabold text-[var(--primary)]">{d.rosteredHours.toFixed(2)}h</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* FORTNIGHT VIEW */}
          {calendarView === 'fortnight' && (
            <div className="bg-[var(--panel)] rounded-2xl border border-[var(--border)] p-4 shadow-sm overflow-x-auto">
              <div className="min-w-[700px]">
                <div className="grid grid-cols-7 gap-2 mb-2 text-center text-xs font-black text-[var(--muted)] uppercase">
                  <div className="text-[var(--primary)]">Sun</div>
                  <div>Mon</div>
                  <div>Tue</div>
                  <div>Wed</div>
                  <div>Thu</div>
                  <div>Fri</div>
                  <div className="text-[var(--primary)]">Sat</div>
                </div>

                <div className="grid grid-cols-7 gap-2">
                  {days.map((d) => {
                    const isWeekend = ['Sat', 'Sun'].includes(d.dayOfWeek);
                    const seg = d.segments[0] || {};
                    const isSelected = d.date === activeDateIso;

                    return (
                      <div
                        key={d.date}
                        onClick={() => setActiveDate(new Date(d.date))}
                        className={`p-2 rounded-xl border text-left min-h-[80px] transition-all cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/30 bg-[var(--panel)]'
                            : isWeekend
                            ? 'border-[var(--border)] bg-[var(--panel-subtle)]/40 hover:bg-[var(--glass-4)]'
                            : 'border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--glass-4)]'
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <span className="text-xs font-bold text-[var(--text)]">{d.dayOfWeek} {d.date.split('-').slice(1).join('/')}</span>
                          {d.isPublicHoliday && (
                            <span className="w-2 h-2 rounded-full bg-[#ec4899]" title={d.holidayName || 'Public Holiday'}></span>
                          )}
                        </div>

                        {seg.roster_in && seg.roster_out ? (
                          <div className="bg-[var(--primary-light)] text-[var(--primary)] rounded text-[9px] px-1 py-0.5 truncate font-bold">
                            {seg.roster_in} - {seg.roster_out}
                          </div>
                        ) : (
                          <div className="text-[10px] text-[var(--muted)] opacity-50">—</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ENTIRE TEAM ROSTER VIEW */}
      {scheduleScope === 'team_roster' && (
        <div className="space-y-4">
          {!teamRosterData?.is_published ? (
            <div className="bg-[var(--panel)] rounded-2xl border border-[var(--border)] p-12 text-center space-y-3 shadow-sm">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-[#f59e0b]/20 text-[#f59e0b] flex items-center justify-center">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
              </div>
              <h3 className="text-lg font-black text-[var(--text)]">Team Roster Pending Release</h3>
              <p className="text-xs text-[var(--muted)] max-w-md mx-auto">
                The official schedule for the fortnight starting {fnIso} has not been finalised and released by management yet. Once published, the complete team schedule will appear here.
              </p>
            </div>
          ) : (
            <div className="bg-[var(--panel)] rounded-2xl border border-[var(--border)] p-6 shadow-sm space-y-4">
              {/* Controls: Search, Department, Week Filter */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--border)] pb-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <input
                      type="text"
                      placeholder="Search colleague..."
                      value={teamSearch}
                      onChange={e => setTeamSearch(e.target.value)}
                      className="bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-xs text-[var(--text)] font-semibold w-48"
                    />
                  </div>
                  <div>
                    <select
                      value={selectedDeptFilter}
                      onChange={e => setSelectedDeptFilter(e.target.value)}
                      className="bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-xs text-[var(--text)] font-semibold"
                    >
                      <option value="All">All Departments</option>
                      {Array.from(new Set((teamRosterData?.team || []).map(t => t.department).filter(Boolean))).map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-[var(--panel-subtle)] p-1 rounded-xl border border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => setTeamWeekView('all')}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                        teamWeekView === 'all'
                          ? 'bg-[var(--panel)] text-[var(--primary)] shadow-sm'
                          : 'text-[var(--muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      Fortnight (14d)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTeamWeekView('w1')}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                        teamWeekView === 'w1'
                          ? 'bg-[var(--panel)] text-[var(--primary)] shadow-sm'
                          : 'text-[var(--muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      Week 1
                    </button>
                    <button
                      type="button"
                      onClick={() => setTeamWeekView('w2')}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                        teamWeekView === 'w2'
                          ? 'bg-[var(--panel)] text-[var(--primary)] shadow-sm'
                          : 'text-[var(--muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      Week 2
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={fetchTeamRoster}
                    disabled={loadingTeamRoster}
                    className="px-3 py-1.5 bg-[var(--panel-subtle)] text-[var(--text)] hover:bg-[var(--glass-4)] rounded-xl text-xs font-bold border border-[var(--border)] flex items-center gap-1.5 transition-colors"
                  >
                    <svg className={`w-3.5 h-3.5 ${loadingTeamRoster ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10"></polyline>
                      <polyline points="1 20 1 14 7 14"></polyline>
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {/* Team Roster Grid */}
              {loadingTeamRoster ? (
                <div className="flex items-center justify-center py-16 text-[var(--muted)] font-bold text-xs gap-2">
                  <div className="w-4 h-4 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin"></div>
                  Loading team roster...
                </div>
              ) : (
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-left text-xs border-collapse table-fixed">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[var(--muted)] font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-2.5 px-2.5 w-[130px] sm:w-[150px] sticky left-0 bg-[var(--panel)] z-10">Colleague</th>
                        <th className="py-2.5 px-1 text-center w-[48px]">Rostered</th>
                        {displayDays.map(day => (
                          <th key={day.date} className="py-2.5 px-0.5 text-center min-w-[62px] w-[5.8%]">
                            <div className="font-bold text-[var(--text)] text-[10px] leading-tight">{day.dayOfWeek.slice(0, 3)}</div>
                            <div className="text-[9px] text-[var(--muted)] font-normal">{day.date.split('-').slice(1).join('/')}</div>
                            {day.isPublicHoliday && (
                              <span className="text-[8px] bg-[#ec4899]/20 text-[#ec4899] px-1 py-0.2 rounded font-black block mt-0.5 truncate">
                                PH
                              </span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {filteredTeam.map(member => {
                        const isMe = member.id === portalData?.employee?.id;
                        return (
                          <tr key={member.id} className={isMe ? 'bg-[var(--primary-light)]/20' : 'hover:bg-[var(--glass-2)]'}>
                            <td className="py-2 px-2.5 sticky left-0 bg-[var(--panel)] z-10 w-[130px] sm:w-[150px]">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-[var(--text)] text-xs truncate max-w-[110px]">{member.full_name}</span>
                                {isMe && (
                                  <span className="text-[8px] font-black bg-[var(--primary)] text-white px-1 py-0.2 rounded uppercase shrink-0">
                                    You
                                  </span>
                                )}
                              </div>
                              <div className="text-[9px] text-[var(--muted)] font-medium truncate max-w-[110px]">{member.department}</div>
                            </td>
                            <td className="py-2 px-1 text-center font-black text-[var(--text)] text-xs">
                              {member.total_rostered_hours}h
                            </td>
                            {displayDays.map(day => {
                              const dayInfo = member.days.find(d => d.date === day.date);
                              const segments = dayInfo?.segments || [];
                              return (
                                <td key={day.date} className="py-1.5 px-0.5 text-center align-middle">
                                  {segments.length === 0 ? (
                                    <span className="text-[9px] text-[var(--muted)] opacity-35 font-bold">-</span>
                                  ) : (
                                    <div className="space-y-0.5">
                                      {segments.map((seg, sIdx) => (
                                        <div
                                          key={sIdx}
                                          className="bg-[var(--panel-subtle)] border border-[var(--border)] rounded-md px-1 py-0.5 text-[9px] shadow-xs"
                                          title={`${seg.segment_type}: ${seg.roster_in} - ${seg.roster_out} (${seg.roster_hours}h)`}
                                        >
                                          <div className="font-bold text-[var(--text)] whitespace-nowrap text-[9px] leading-tight">
                                            {seg.roster_in.replace(/^0/, '')}-{seg.roster_out.replace(/^0/, '')}
                                          </div>
                                          <div className="text-[8px] text-indigo-400 font-semibold leading-tight truncate">
                                            {seg.roster_hours}h
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="pt-3 border-t border-[var(--border)] text-[11px] text-[var(--muted)] flex items-center justify-between">
                <span>Showing published staff schedule. Timesheets and actual clocked hours are omitted.</span>
                <span>{filteredTeam.length} staff member{filteredTeam.length === 1 ? '' : 's'}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )}



      {/* TAB 3: LEAVE REQUESTS */}
      {activeTab === 'leave' && (
        <div className="bg-[var(--panel)] rounded-2xl border border-[var(--border)] p-6 shadow-sm space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-black text-[var(--text)]">My Leave Requests</h3>
              <p className="text-xs text-[var(--muted)]">Submit leave applications and track approval status</p>
            </div>
            <button
              onClick={() => {
                setLeaveStartDate(fnIso);
                setLeaveEndDate(fnIso);
                setShowLeaveModal(true);
              }}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-xl text-xs font-black hover:bg-[var(--primary-h)] shadow-md flex items-center gap-1.5"
            >
              + Request Leave
            </button>
          </div>

          {leaveRequests.length === 0 ? (
            <div className="text-center py-12 text-[var(--muted)]">
              <div className="w-10 h-10 mx-auto mb-2 rounded-xl bg-[var(--panel-subtle)] text-[var(--muted)] flex items-center justify-center">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
              </div>
              <div className="font-bold text-sm">No leave requests submitted</div>
              <div className="text-xs mt-1">Click "+ Request Leave" to submit a request</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--muted)] font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4">Leave Type</th>
                    <th className="py-3 px-4">Date Range</th>
                    <th className="py-3 px-4">Total Hours</th>
                    <th className="py-3 px-4">Reason</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {leaveRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-[var(--glass-2)]">
                      <td className="py-3 px-4 font-bold text-[var(--text)]">{req.leave_type}</td>
                      <td className="py-3 px-4 text-[var(--muted)] font-semibold">{req.start_date} → {req.end_date}</td>
                      <td className="py-3 px-4 font-black text-[var(--text)]">{req.hours}h</td>
                      <td className="py-3 px-4 text-[var(--muted)] italic">{req.reason || '—'}</td>
                      <td className="py-3 px-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider ${
                          req.status === 'Approved' ? 'bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/40' :
                          req.status === 'Rejected' ? 'bg-[#ef4444]/20 text-[#ef4444] border border-[#ef4444]/40' :
                          'bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/40'
                        }`}>
                          {req.status}
                        </span>
                        {req.status === 'Rejected' && req.rejection_reason && (
                          <div className="text-[10px] text-red-500 font-semibold mt-1 max-w-xs">
                            Reason: {req.rejection_reason}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: TEAM CHAT & WORKPLACE FEED */}
      {activeTab === 'announcements' && (
        <div className="bg-[var(--panel)] rounded-2xl border border-[var(--border)] p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
            <div>
              <h3 className="text-xl font-black text-[var(--text)]">Team Chat & Feed</h3>
              <p className="text-xs text-[var(--muted)]">Communicate with colleagues, discuss shifts, and view roster alerts</p>
            </div>
            <button
              onClick={fetchAnnouncements}
              disabled={loadingAnnouncements}
              className="px-3.5 py-2 bg-[var(--panel-subtle)] text-[var(--text)] hover:bg-[var(--glass-4)] rounded-xl text-xs font-bold border border-[var(--border)] flex items-center gap-1.5 transition-colors cursor-pointer self-start sm:self-auto"
            >
              <svg className={`w-3.5 h-3.5 ${loadingAnnouncements ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
              <span>Refresh</span>
            </button>
          </div>

          {/* Restriction Notice or Composer */}
          {!isMgmt && !allowEmployeeChat ? (
            <div className="p-4 bg-amber-500/10 border border-amber-500/25 rounded-2xl text-xs text-amber-300 font-medium flex items-center gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Team chat is currently set to read-only by management. You can review all notices and updates below.</span>
            </div>
          ) : (
            /* Quick Team Chat Composer */
            <div className="bg-[var(--panel-subtle)] border border-[var(--border)] rounded-2xl p-4 shadow-inner">
              <form onSubmit={handleSendChatMessage} className="space-y-3">
                <textarea
                  rows={2}
                  value={chatContent}
                  onChange={e => setChatContent(e.target.value)}
                  placeholder="Write a message to your team (e.g. Can someone cover Friday morning?)..."
                  className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl p-3 text-xs text-[var(--text)] outline-none focus:border-[var(--primary)] resize-none"
                />
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-[var(--muted)] font-medium">Visible to all active team members</span>
                  <button
                    type="submit"
                    disabled={chatSubmitting || !chatContent.trim()}
                    className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold rounded-xl text-xs transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{chatSubmitting ? 'Posting...' : 'Post Message'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {loadingAnnouncements ? (
            <div className="flex items-center justify-center py-12 text-[var(--muted)] font-bold text-xs gap-2">
              <div className="w-4 h-4 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin"></div>
              Loading conversation...
            </div>
          ) : announcements.length === 0 ? (
            <div className="text-center py-14 text-[var(--muted)]">
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-[var(--panel-subtle)] text-[var(--muted)] flex items-center justify-center">
                <MessageSquare className="w-6 h-6" />
              </div>
              <div className="font-bold text-sm text-[var(--text)]">No messages yet</div>
              <div className="text-xs mt-1">Start the conversation by posting a message above!</div>
            </div>
          ) : (
            <div className="space-y-4">
              {announcements.map((item) => {
                const isRosterAlert = item.is_system || item.announcement_type === 'roster_publish';
                const canDelete = (isMgmt || item.author_id === currentUserId) && !isRosterAlert;
                const isThreadExpanded = Boolean(expandedThreads[item.id]);
                const reactions = item.reactions || [];
                const replies = item.replies || [];
                const replyCount = item.reply_count !== undefined ? item.reply_count : replies.length;

                return (
                  <div 
                    key={item.id} 
                    className={`p-5 rounded-2xl border transition-all space-y-3 ${
                      isRosterAlert
                        ? 'bg-[var(--primary-light)]/40 border-[var(--primary)]/30'
                        : 'bg-[var(--panel-subtle)] border-[var(--border)]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                          isRosterAlert
                            ? 'bg-[var(--primary)] text-white'
                            : item.author_role === 'Employee'
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-[var(--panel)] text-[var(--primary)] border border-[var(--primary)]/30'
                        }`}>
                          {isRosterAlert ? 'Roster Release' : item.author_role}
                        </span>
                        <span className="font-bold text-xs text-[var(--text)]">
                          {item.author_name}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-[var(--muted)] font-medium">
                          {new Date(item.created_at).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                        {canDelete && (
                          <button
                            onClick={() => handleDeleteChatMessage(item.id)}
                            className="text-xs text-[var(--danger)] hover:underline font-semibold cursor-pointer"
                            title="Delete message"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>

                    {item.title && (
                      <h4 className="text-sm font-black text-[var(--text)] mb-1">
                        {item.title}
                      </h4>
                    )}

                    <p className="text-xs text-[var(--text)] whitespace-pre-wrap leading-relaxed">
                      {item.content}
                    </p>

                    {/* Action Bar: Reactions & Replies */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border)]/60 text-xs">
                      {/* Reactions */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {reactions.map((r) => (
                          <button
                            key={r.emoji}
                            type="button"
                            onClick={() => handleToggleReaction(item.id, r.emoji)}
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                              r.user_reacted
                                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-xs'
                                : 'bg-[var(--panel)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--glass-4)]'
                            }`}
                            title={`Reacted by: ${r.users.join(', ')}`}
                          >
                            <span>{r.emoji}</span>
                            <span className="text-[10px] font-bold">{r.count}</span>
                          </button>
                        ))}

                        {/* Quick Reaction Button */}
                        <div className="relative inline-block">
                          <button
                            type="button"
                            onClick={() => setActivePickerId(activePickerId === item.id ? null : item.id)}
                            className="p-1 px-2 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel)] rounded-full border border-dashed border-[var(--border)] transition-colors cursor-pointer text-xs flex items-center gap-1"
                            title="Add emoji reaction"
                          >
                            <Smile className="w-3.5 h-3.5" />
                            <span className="text-[10px]">+</span>
                          </button>

                          {activePickerId === item.id && (
                            <div className="absolute left-0 bottom-full mb-1 z-20 flex items-center gap-1 p-1.5 bg-[var(--panel)] border border-[var(--border)] rounded-full shadow-xl animate-in fade-in zoom-in-95">
                              {COMMON_EMOJIS.map(emoji => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() => handleToggleReaction(item.id, emoji)}
                                  className="w-7 h-7 hover:bg-[var(--panel-subtle)] rounded-full flex items-center justify-center text-sm cursor-pointer transition-transform hover:scale-125"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Reply Toggle Button */}
                      <button
                        type="button"
                        onClick={() => handleToggleThread(item.id)}
                        className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)] font-semibold px-2 py-1 rounded-lg hover:bg-[var(--panel)] transition-colors cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
                        <span>{replyCount > 0 ? `${replyCount} ${replyCount === 1 ? 'Reply' : 'Replies'}` : 'Reply'}</span>
                      </button>
                    </div>

                    {/* Thread Drawer */}
                    {isThreadExpanded && (
                      <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-2.5 animate-in fade-in">
                        {replies.length > 0 ? (
                          <div className="space-y-2 pl-3 border-l-2 border-indigo-500/20">
                            {replies.map((reply) => {
                              const canDeleteReply = isMgmt || reply.author_id === currentUserId;
                              return (
                                <div key={reply.id} className="bg-[var(--panel)] p-2.5 rounded-xl border border-[var(--border)] text-xs space-y-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-bold text-[var(--text)]">{reply.author_name}</span>
                                      <span className="text-[8px] uppercase font-semibold px-1 py-0.2 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                        {reply.author_role}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-[var(--muted)]">
                                        {new Date(reply.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                      {canDeleteReply && (
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteReply(item.id, reply.id)}
                                          className="text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
                                          title="Delete reply"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  <p className="text-[var(--text)] text-xs whitespace-pre-wrap leading-relaxed">
                                    {reply.content}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-[11px] text-[var(--muted)] italic pl-3">
                            No replies yet. Be the first to start the thread.
                          </p>
                        )}

                        {/* Inline Reply Composer */}
                        {(isMgmt || allowEmployeeChat) ? (
                          <form onSubmit={(e) => handlePostReply(item.id, e)} className="flex items-center gap-2 pt-1 pl-3">
                            <input
                              type="text"
                              placeholder="Write a reply..."
                              value={replyInputs[item.id] || ''}
                              onChange={(e) => setReplyInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                              className="flex-1 bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--primary)]"
                            />
                            <button
                              type="submit"
                              disabled={submittingReplies[item.id] || !replyInputs[item.id]?.trim()}
                              className="px-3 py-1.5 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold rounded-xl text-xs transition-colors shadow-xs disabled:opacity-50 flex items-center gap-1 cursor-pointer shrink-0"
                            >
                              <Send className="w-3 h-3" />
                              <span>Reply</span>
                            </button>
                          </form>
                        ) : (
                          <div className="pl-3 text-[11px] text-[var(--muted)] italic">
                            Replies are currently restricted by management.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Leave Request Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-black text-[var(--text)]">Submit Leave Request</h3>
            <form onSubmit={handleCreateLeaveRequest} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-[var(--muted)] block mb-1">Leave Type</label>
                <select
                  value={leaveType}
                  onChange={e => setLeaveType(e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs font-bold text-[var(--text)]"
                >
                  <option value="Sick">Sick Leave</option>
                  <option value="Annual">Annual Leave</option>
                  <option value="TIL">Time in Lieu (TIL)</option>
                  <option value="Unpaid">Unpaid Leave</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-[var(--muted)] block mb-1">Start Date</label>
                  <input
                    type="date"
                    required
                    value={leaveStartDate}
                    onChange={e => setLeaveStartDate(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs font-bold text-[var(--text)]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[var(--muted)] block mb-1">End Date</label>
                  <input
                    type="date"
                    required
                    value={leaveEndDate}
                    onChange={e => setLeaveEndDate(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs font-bold text-[var(--text)]"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-[var(--muted)] block mb-1">Total Hours</label>
                <input
                  type="number"
                  step="0.1"
                  required
                  value={leaveHours}
                  onChange={e => setLeaveHours(e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs font-bold text-[var(--text)]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[var(--muted)] block mb-1">Reason / Notes (Optional)</label>
                <textarea
                  rows={2}
                  value={leaveReason}
                  onChange={e => setLeaveReason(e.target.value)}
                  placeholder="Medical certificate, vacation, personal days..."
                  className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowLeaveModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold border border-[var(--border)] hover:bg-[var(--glass-4)] text-[var(--text)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={leaveSubmitting}
                  className="px-4 py-2 bg-[var(--primary)] text-white rounded-xl text-xs font-black hover:bg-[var(--primary-h)] shadow-md"
                >
                  {leaveSubmitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

