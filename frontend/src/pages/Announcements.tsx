import React, { useState, useEffect } from 'react';
import api from '../services/apiClient';

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
  created_at: string;
}

export default function Announcements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Composer state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

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
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to load announcements');
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
      showToast('Announcement posted successfully');
      fetchAnnouncements();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to post announcement');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    if (!window.confirm('Delete this announcement?')) return;
    try {
      await api.delete(`/announcements/${id}`);
      showToast('Announcement removed');
      setAnnouncements(prev => prev.filter(a => a.id !== id));
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'Failed to delete announcement');
    }
  };

  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto gap-6 mt-4 pb-16 px-4">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed top-20 right-6 z-50 bg-[var(--primary)] text-white font-bold text-xs px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2">
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[var(--border)] pb-4">
        <div>
          <h2 className="text-3xl font-black text-[var(--text)] tracking-tight">Team Announcements</h2>
          <p className="text-sm text-[var(--muted)] mt-1">
            Broadcast official notices, important updates, and automated roster release notifications
          </p>
        </div>
        <button
          onClick={fetchAnnouncements}
          disabled={loading}
          className="px-4 py-2 bg-[var(--panel-subtle)] text-[var(--text)] hover:bg-[var(--glass-4)] rounded-xl text-xs font-bold border border-[var(--border)] flex items-center gap-1.5 transition-colors self-start md:self-auto"
        >
          <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="p-4 bg-[var(--danger-light)] text-[var(--danger)] border border-[var(--danger)]/30 rounded-2xl text-xs font-bold flex items-center gap-2">
          {error}
        </div>
      )}

      {/* Composer Card */}
      <div className="bg-[var(--panel)] rounded-2xl border border-[var(--border)] p-6 shadow-sm">
        <h3 className="text-sm font-black text-[var(--text)] uppercase tracking-wider mb-4 flex items-center gap-2">
          <svg className="w-4 h-4 text-[var(--primary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
            <path d="M2 2l7.586 7.586"></path>
            <circle cx="11" cy="11" r="2"></circle>
          </svg>
          <span>Post Team Announcement</span>
        </h3>

        <form onSubmit={handleCreateAnnouncement} className="space-y-4">
          <div>
            <input
              type="text"
              placeholder="Title or Topic (Optional, e.g. Operational Notice)"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-xs text-[var(--text)] font-semibold outline-none focus:border-[var(--primary)]"
            />
          </div>

          <div>
            <textarea
              required
              rows={3}
              placeholder="Write your announcement or memo to the team here..."
              value={content}
              onChange={e => setContent(e.target.value)}
              className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl p-4 text-xs text-[var(--text)] outline-none focus:border-[var(--primary)]"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !content.trim()}
              className="px-6 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-black rounded-xl text-xs transition-colors shadow-md disabled:opacity-50 flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
              <span>{submitting ? 'Posting...' : 'Publish Announcement'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Feed List */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">
          Feed History ({announcements.length})
        </h3>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-[var(--muted)] font-bold text-xs gap-2">
            <div className="w-5 h-5 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin"></div>
            <span>Loading announcements...</span>
          </div>
        ) : announcements.length === 0 ? (
          <div className="bg-[var(--panel)] rounded-2xl border border-[var(--border)] p-12 text-center text-[var(--muted)]">
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-[var(--panel-subtle)] text-[var(--muted)] flex items-center justify-center">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
              </svg>
            </div>
            <div className="font-bold text-sm text-[var(--text)]">No announcements yet</div>
            <div className="text-xs mt-1">
              Automated roster publications and posts created above will be recorded in this timeline.
            </div>
          </div>
        ) : (
          announcements.map((item) => {
            const isRosterAlert = item.is_system || item.announcement_type === 'roster_publish';

            return (
              <div
                key={item.id}
                className={`p-6 rounded-2xl border transition-all ${
                  isRosterAlert
                    ? 'bg-[var(--primary-light)]/40 border-[var(--primary)]/30'
                    : 'bg-[var(--panel)] border-[var(--border)]'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3 border-b border-[var(--border)] pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                      isRosterAlert
                        ? 'bg-[var(--primary)] text-white'
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
                    <button
                      onClick={() => handleDeleteAnnouncement(item.id)}
                      className="text-xs text-[var(--danger)] hover:underline font-semibold"
                      title="Delete announcement"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {item.title && (
                  <h4 className="text-base font-black text-[var(--text)] mb-1.5">
                    {item.title}
                  </h4>
                )}

                <p className="text-xs text-[var(--text)] whitespace-pre-wrap leading-relaxed">
                  {item.content}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
