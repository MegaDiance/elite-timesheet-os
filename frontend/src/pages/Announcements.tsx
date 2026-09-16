import React, { useState, useEffect } from 'react';
import { jwtDecode } from 'jwt-decode';
import { MessageSquare, Smile, Trash2, Send, ShieldAlert } from 'lucide-react';
import api from '../services/apiClient';

interface DecodedToken {
  id: string;
  email: string;
  role?: string;
  organisation_id?: string;
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

const COMMON_EMOJIS = ['👍', '❤️', '🎉', '👏', '🚀', '👀'];

export default function Announcements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [allowEmployeeChat, setAllowEmployeeChat] = useState(true);
  const [togglingPermission, setTogglingPermission] = useState(false);
  
  // Composer state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Thread replies state
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
      const decoded = jwtDecode<DecodedToken>(token);
      currentUserId = decoded.id || '';
      currentUserRole = decoded.role || 'Employee';
    } catch {}
  }
  const isMgmt = ['Admin', 'Company Admin', 'Platform Admin', 'Manager'].includes(currentUserRole);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const fetchAnnouncements = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/announcements');
      if (res.data?.data) {
        setAnnouncements(res.data.data);
      }
      if (res.data?.permissions) {
        setAllowEmployeeChat(res.data.permissions.allow_employee_chat !== false);
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await api.post('/announcements', {
        title: title.trim() || undefined,
        content: content.trim()
      });
      setTitle('');
      setContent('');
      showToast('Message posted successfully');
      fetchAnnouncements();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to post message');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    if (!window.confirm('Delete this message?')) return;
    try {
      await api.delete(`/announcements/${id}`);
      showToast('Message removed');
      setAnnouncements(prev => prev.filter(a => a.id !== id));
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to delete message');
    }
  };

  const handleToggleReaction = async (announcementId: string, emoji: string) => {
    try {
      const res = await api.post(`/announcements/${announcementId}/reactions`, { emoji });
      if (res.data?.data?.reactions) {
        const updatedReactions = res.data.data.reactions;
        setAnnouncements(prev => prev.map(a => {
          if (a.id === announcementId) {
            return { ...a, reactions: updatedReactions };
          }
          return a;
        }));
      }
    } catch (err: any) {
      console.error('Failed to toggle reaction', err);
    } finally {
      setActivePickerId(null);
    }
  };

  const handleToggleThread = (announcementId: string) => {
    setExpandedThreads(prev => ({
      ...prev,
      [announcementId]: !prev[announcementId]
    }));
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

  const handleTogglePermission = async () => {
    if (!isMgmt || togglingPermission) return;
    setTogglingPermission(true);
    try {
      const targetState = !allowEmployeeChat;
      const res = await api.patch('/announcements/permissions', { allow_employee_chat: targetState });
      if (res.data?.success) {
        setAllowEmployeeChat(res.data.allow_employee_chat);
        showToast(res.data.message || 'Permissions updated');
        fetchAnnouncements();
      }
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to update chat permissions');
    } finally {
      setTogglingPermission(false);
    }
  };

  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto gap-6 mt-4 pb-16 px-4">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed top-20 right-6 z-50 bg-[var(--primary)] text-white font-bold text-xs px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2 animate-in fade-in">
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Header Bar with Admin Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--border)] pb-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-[var(--text)] tracking-tight">Team Chat & Notices</h2>
          <p className="text-xs sm:text-sm text-[var(--muted)] mt-1">
            Workplace discussions, announcements, emoji reactions, and reply threads
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Admin Chat Permission Toggle */}
          {isMgmt && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--panel-subtle)] border border-[var(--border)] text-xs">
              <span className="text-[var(--muted)] font-medium">Employee Chat:</span>
              <button
                type="button"
                onClick={handleTogglePermission}
                disabled={togglingPermission}
                className={`px-2.5 py-1 rounded-lg font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer ${
                  allowEmployeeChat
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30'
                }`}
                title="Toggle whether employees can post messages and replies"
              >
                <span className={`w-2 h-2 rounded-full ${allowEmployeeChat ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                <span>{allowEmployeeChat ? 'Allowed' : 'Restricted'}</span>
              </button>
            </div>
          )}

          <button
            onClick={fetchAnnouncements}
            disabled={loading}
            className="px-3.5 py-1.5 bg-[var(--panel-subtle)] text-[var(--text)] hover:bg-[var(--glass-4)] rounded-xl text-xs font-bold border border-[var(--border)] flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-[var(--danger-light)] text-[var(--danger)] border border-[var(--danger)]/30 rounded-2xl text-xs font-bold flex items-center gap-2">
          {error}
        </div>
      )}

      {/* Employee Restricted Notice */}
      {!isMgmt && !allowEmployeeChat && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/25 rounded-2xl text-xs text-amber-300 font-medium flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
          <span>Team chat and replies are currently set to read-only by administrators. You can view all workplace notices below.</span>
        </div>
      )}

      {/* Composer Card (if user can post) */}
      {(isMgmt || allowEmployeeChat) ? (
        <div className="bg-[var(--panel)] rounded-2xl border border-[var(--border)] p-5 sm:p-6 shadow-sm">
          <h3 className="text-xs font-black text-[var(--text)] uppercase tracking-wider mb-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-[var(--primary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
              <path d="M2 2l7.586 7.586"></path>
              <circle cx="11" cy="11" r="2"></circle>
            </svg>
            <span>Post a Message or Team Notice</span>
          </h3>

          <form onSubmit={handleCreateAnnouncement} className="space-y-3">
            <div>
              <input
                type="text"
                placeholder="Subject or Topic (Optional, e.g. Shift Coverage Question)"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3.5 py-2 text-xs text-[var(--text)] font-semibold outline-none focus:border-[var(--primary)]"
              />
            </div>

            <div>
              <textarea
                required
                rows={3}
                placeholder="Share a message, feedback, or update with your team..."
                value={content}
                onChange={e => setContent(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl p-3.5 text-xs text-[var(--text)] outline-none focus:border-[var(--primary)]"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting || !content.trim()}
                className="px-5 py-2 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold rounded-xl text-xs transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{submitting ? 'Sending...' : 'Send Message'}</span>
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Feed List */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">
          Feed History ({announcements.length})
        </h3>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-[var(--muted)] font-bold text-xs gap-2">
            <div className="w-5 h-5 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin"></div>
            <span>Loading messages...</span>
          </div>
        ) : announcements.length === 0 ? (
          <div className="bg-[var(--panel)] rounded-2xl border border-[var(--border)] p-12 text-center text-[var(--muted)]">
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-[var(--panel-subtle)] text-[var(--muted)] flex items-center justify-center">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div className="font-bold text-sm text-[var(--text)]">No messages yet</div>
            <div className="text-xs mt-1">
              Roster alerts, management announcements, and team messages will appear here.
            </div>
          </div>
        ) : (
          announcements.map((item) => {
            const isRosterAlert = item.is_system || item.announcement_type === 'roster_publish';
            const canDelete = (isMgmt || item.author_id === currentUserId) && !isRosterAlert;
            const isThreadExpanded = Boolean(expandedThreads[item.id]);
            const reactions = item.reactions || [];
            const replies = item.replies || [];
            const replyCount = item.reply_count !== undefined ? item.reply_count : replies.length;

            return (
              <div
                key={item.id}
                className={`p-5 rounded-2xl border transition-all space-y-4 ${
                  isRosterAlert
                    ? 'bg-[var(--primary-light)]/40 border-[var(--primary)]/30'
                    : 'bg-[var(--panel)] border-[var(--border)] shadow-xs'
                }`}
              >
                {/* Header info */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                      isRosterAlert
                        ? 'bg-[var(--primary)] text-white'
                        : item.author_role === 'Employee'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-[var(--panel-subtle)] text-[var(--primary)] border border-[var(--primary)]/20'
                    }`}>
                      {isRosterAlert ? 'System Roster Notice' : item.author_role}
                    </span>
                    <span className="font-bold text-xs text-[var(--text)]">
                      {item.author_name}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[var(--muted)] font-medium">
                      {new Date(item.created_at).toLocaleString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                    {canDelete && (
                      <button
                        onClick={() => handleDeleteAnnouncement(item.id)}
                        className="text-xs text-[var(--danger)] hover:underline font-semibold cursor-pointer"
                        title="Delete message"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {/* Content */}
                <div>
                  {item.title && (
                    <h4 className="text-sm sm:text-base font-black text-[var(--text)] mb-1">
                      {item.title}
                    </h4>
                  )}
                  <p className="text-xs text-[var(--text)] whitespace-pre-wrap leading-relaxed">
                    {item.content}
                  </p>
                </div>

                {/* Action Bar: Emoji Reactions & Reply Toggle */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border)]/60 text-xs">
                  {/* Left: Reactions list and picker */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {reactions.map((r) => (
                      <button
                        key={r.emoji}
                        onClick={() => handleToggleReaction(item.id, r.emoji)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                          r.user_reacted
                            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-xs'
                            : 'bg-[var(--panel-subtle)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--glass-4)]'
                        }`}
                        title={`Reacted by: ${r.users.join(', ')}`}
                      >
                        <span>{r.emoji}</span>
                        <span className="text-[11px] font-bold">{r.count}</span>
                      </button>
                    ))}

                    {/* Quick Reaction Button Bar */}
                    <div className="relative inline-block">
                      <button
                        type="button"
                        onClick={() => setActivePickerId(activePickerId === item.id ? null : item.id)}
                        className="p-1 px-2 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] rounded-full border border-dashed border-[var(--border)] transition-colors cursor-pointer text-xs flex items-center gap-1"
                        title="Add emoji reaction"
                      >
                        <Smile className="w-3.5 h-3.5" />
                        <span className="text-[10px]">+</span>
                      </button>

                      {/* Emoji Picker Popover */}
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

                  {/* Right: Reply Thread Toggle */}
                  <button
                    type="button"
                    onClick={() => handleToggleThread(item.id)}
                    className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)] font-semibold px-2.5 py-1 rounded-lg hover:bg-[var(--panel-subtle)] transition-colors cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{replyCount > 0 ? `${replyCount} ${replyCount === 1 ? 'Reply' : 'Replies'}` : 'Reply'}</span>
                  </button>
                </div>

                {/* Threaded Comments & Replies Drawer */}
                {isThreadExpanded && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-3 animate-in fade-in">
                    {/* Replies List */}
                    {replies.length > 0 ? (
                      <div className="space-y-2.5 pl-3 border-l-2 border-indigo-500/20">
                        {replies.map((reply) => {
                          const canDeleteReply = isMgmt || reply.author_id === currentUserId;
                          return (
                            <div key={reply.id} className="bg-[var(--panel-subtle)] p-3 rounded-xl border border-[var(--border)] text-xs space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-[var(--text)]">{reply.author_name}</span>
                                  <span className="text-[9px] uppercase font-semibold px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
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
                          className="px-3.5 py-1.5 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold rounded-xl text-xs transition-colors shadow-xs disabled:opacity-50 flex items-center gap-1 cursor-pointer shrink-0"
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
          })
        )}
      </div>
    </div>
  );
}
