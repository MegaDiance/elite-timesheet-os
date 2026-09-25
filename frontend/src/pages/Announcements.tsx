import React, { useEffect, useState } from 'react';
import { MessageSquare, RefreshCw, Send, Smile, Trash2 } from 'lucide-react';
import api from '../services/apiClient';
import { Button } from '../components/ui/Button';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useToast } from '../components/ui/Toast';
import { friendlyError } from '../services/errors';

interface ReactionSummary {
  emoji: string;
  count: number;
  user_reacted: boolean;
  users: string[];
}

interface Reply {
  id: string;
  author_id: string | null;
  author_name: string;
  author_role: string | null;
  content: string;
  created_at: string;
  can_delete: boolean;
}

interface Post {
  id: string;
  author_id: string | null;
  author_name: string;
  author_role: string | null;
  title: string | null;
  content: string;
  created_at: string;
  can_delete: boolean;
  reactions: ReactionSummary[];
  replies: Reply[];
  reply_count: number;
}

interface ChatPermissions {
  can_post: boolean;
  can_moderate: boolean;
}

type PendingDelete = { kind: 'post'; postId: string } | { kind: 'reply'; postId: string; replyId: string };

const COMMON_EMOJIS = ['👍', '❤️', '🎉', '👏', '🚀', '👀'];

const errorMessage = friendlyError;

export default function Announcements() {
  const toast = useToast();
  const [posts, setPosts] = useState<Post[]>([]);
  const [permissions, setPermissions] = useState<ChatPermissions>({ can_post: false, can_moderate: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Composer
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Threads
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});
  const [replyInputs, setReplyInputs] = useState<Record<string, string>>({});
  const [submittingReplies, setSubmittingReplies] = useState<Record<string, boolean>>({});
  const [activePickerId, setActivePickerId] = useState<string | null>(null);

  // Deleting
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchPosts = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/announcements');
      setPosts(res.data?.data || []);
      if (res.data?.permissions) setPermissions(res.data.permissions);
    } catch (err: any) {
      setError(errorMessage(err, 'Messages could not be loaded.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, []);

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      const res = await api.post('/announcements', {
        title: title.trim() || undefined,
        content: content.trim(),
      });
      setTitle('');
      setContent('');
      if (res.data?.data) setPosts(prev => [res.data.data, ...prev]);
      toast.success('Message posted.');
    } catch (err: any) {
      toast.error(errorMessage(err, 'Your message could not be posted.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleReaction = async (postId: string, emoji: string) => {
    setActivePickerId(null);
    try {
      const res = await api.post(`/announcements/${postId}/reactions`, { emoji });
      const reactions = res.data?.data?.reactions;
      if (reactions) setPosts(prev => prev.map(p => (p.id === postId ? { ...p, reactions } : p)));
    } catch (err: any) {
      toast.error(errorMessage(err, 'Your reaction could not be saved.'));
    }
  };

  const handlePostReply = async (postId: string, e: React.FormEvent) => {
    e.preventDefault();
    const text = replyInputs[postId]?.trim();
    if (!text) return;
    setSubmittingReplies(prev => ({ ...prev, [postId]: true }));
    try {
      const res = await api.post(`/announcements/${postId}/replies`, { content: text });
      const reply: Reply | undefined = res.data?.data;
      if (reply) {
        setPosts(prev => prev.map(p => (p.id === postId
          ? { ...p, replies: [...p.replies, reply], reply_count: p.replies.length + 1 }
          : p)));
      }
      setReplyInputs(prev => ({ ...prev, [postId]: '' }));
    } catch (err: any) {
      toast.error(errorMessage(err, 'Your reply could not be posted.'));
    } finally {
      setSubmittingReplies(prev => ({ ...prev, [postId]: false }));
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (pendingDelete.kind === 'post') {
        await api.delete(`/announcements/${pendingDelete.postId}`);
        setPosts(prev => prev.filter(p => p.id !== pendingDelete.postId));
        toast.success('Message deleted.');
      } else {
        const { postId, replyId } = pendingDelete;
        await api.delete(`/announcements/${postId}/replies/${replyId}`);
        setPosts(prev => prev.map(p => {
          if (p.id !== postId) return p;
          const replies = p.replies.filter(r => r.id !== replyId);
          return { ...p, replies, reply_count: replies.length };
        }));
        toast.success('Reply deleted.');
      }
    } catch (err: any) {
      toast.error(errorMessage(err, 'It could not be deleted.'));
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const formatPostTime = (iso: string) =>
    new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto gap-6 mt-4 pb-16 px-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--border)] pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-[var(--text)] tracking-tight">Team chat</h1>
          <p className="text-xs sm:text-sm text-[var(--muted)] mt-1">
            Notices and discussion for your organisation's Owner and Branch Admins. Workers do not see this page.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={fetchPosts}
          disabled={loading}
          leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
        >
          Refresh
        </Button>
      </div>

      {error && (
        <div className="p-4 bg-[var(--danger-light)] text-[var(--danger)] border border-[var(--danger)]/30 rounded-2xl text-xs font-bold">
          {error}
        </div>
      )}

      {/* Composer */}
      {permissions.can_post && (
        <div className="bg-[var(--panel)] rounded-2xl border border-[var(--border)] p-5 sm:p-6 shadow-sm">
          <h2 className="text-xs font-black text-[var(--text)] uppercase tracking-wider mb-3 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[var(--primary-text)]" />
            <span>Post a message</span>
          </h2>
          <form onSubmit={handleCreatePost} className="space-y-3">
            <input
              type="text"
              placeholder="Subject (optional)"
              value={title}
              maxLength={200}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3.5 py-2 text-xs text-[var(--text)] font-semibold outline-none focus:border-[var(--primary)]"
            />
            <textarea
              required
              rows={3}
              maxLength={5000}
              placeholder="Share an update with the team…"
              value={content}
              onChange={e => setContent(e.target.value)}
              className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl p-3.5 text-xs text-[var(--text)] outline-none focus:border-[var(--primary)]"
            />
            <div className="flex justify-end">
              <Button type="submit" variant="primary" size="sm" loading={submitting} disabled={!content.trim()} leftIcon={<Send className="w-3.5 h-3.5" />}>
                Post
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Feed */}
      <div className="space-y-4">
        <h2 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">Messages ({posts.length})</h2>

        {loading && posts.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-[var(--muted)] font-bold text-xs gap-2">
            <div className="w-5 h-5 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
            <span>Loading messages…</span>
          </div>
        ) : posts.length === 0 ? (
          <div className="bg-[var(--panel)] rounded-2xl border border-[var(--border)] p-12 text-center text-[var(--muted)]">
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-[var(--panel-subtle)] text-[var(--muted)] flex items-center justify-center">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div className="font-bold text-sm text-[var(--text)]">No messages yet</div>
            <div className="text-xs mt-1">Messages from the Owner and Branch Admins will appear here.</div>
          </div>
        ) : (
          posts.map(post => {
            const expanded = Boolean(expandedThreads[post.id]);
            const replyCount = post.replies.length;

            return (
              <div
                key={post.id}
                className="p-5 rounded-2xl border transition-all space-y-4 bg-[var(--panel)] border-[var(--border)] shadow-xs"
              >
                {/* Author */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[var(--panel-subtle)] text-[var(--primary-text)] border border-[var(--primary)]/20">
                      {post.author_role || 'Team'}
                    </span>
                    <span className="font-bold text-xs text-[var(--text)]">{post.author_name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[var(--muted)] font-medium">{formatPostTime(post.created_at)}</span>
                    {post.can_delete && (
                      <button
                        onClick={() => setPendingDelete({ kind: 'post', postId: post.id })}
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
                  {post.title && <h3 className="text-sm sm:text-base font-black text-[var(--text)] mb-1">{post.title}</h3>}
                  <p className="text-xs text-[var(--text)] whitespace-pre-wrap leading-relaxed">{post.content}</p>
                </div>

                {/* Reactions & replies toggle */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border)]/60 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {post.reactions.map(r => (
                      <button
                        key={r.emoji}
                        onClick={() => handleToggleReaction(post.id, r.emoji)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                          r.user_reacted
                            ? 'bg-[var(--primary-light)] text-[var(--primary-text)] border-[var(--primary)]/40 shadow-xs'
                            : 'bg-[var(--panel-subtle)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--glass-4)]'
                        }`}
                        title={r.users.join(', ')}
                      >
                        <span>{r.emoji}</span>
                        <span className="text-[11px] font-bold">{r.count}</span>
                      </button>
                    ))}

                    <div className="relative inline-block">
                      <button
                        type="button"
                        onClick={() => setActivePickerId(activePickerId === post.id ? null : post.id)}
                        className="p-1 px-2 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] rounded-full border border-dashed border-[var(--border)] transition-colors cursor-pointer text-xs flex items-center gap-1"
                        title="Add a reaction"
                        aria-label="Add a reaction"
                      >
                        <Smile className="w-3.5 h-3.5" />
                        <span className="text-[10px]">+</span>
                      </button>
                      {activePickerId === post.id && (
                        <div className="absolute left-0 bottom-full mb-1 z-20 flex items-center gap-1 p-1.5 bg-[var(--panel)] border border-[var(--border)] rounded-full shadow-xl">
                          {COMMON_EMOJIS.map(emoji => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => handleToggleReaction(post.id, emoji)}
                              className="w-7 h-7 hover:bg-[var(--panel-subtle)] rounded-full flex items-center justify-center text-sm cursor-pointer transition-transform hover:scale-125"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedThreads(prev => ({ ...prev, [post.id]: !prev[post.id] }))}
                    className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)] font-semibold px-2.5 py-1 rounded-lg hover:bg-[var(--panel-subtle)] transition-colors cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-[var(--primary-text)]" />
                    <span>{replyCount > 0 ? `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}` : 'Reply'}</span>
                  </button>
                </div>

                {/* Thread */}
                {expanded && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-3">
                    {post.replies.length > 0 ? (
                      <div className="space-y-2.5 pl-3 border-l-2 border-[var(--primary)]/20">
                        {post.replies.map(reply => (
                          <div key={reply.id} className="bg-[var(--panel-subtle)] p-3 rounded-xl border border-[var(--border)] text-xs space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-[var(--text)]">{reply.author_name}</span>
                                {reply.author_role && (
                                  <span className="text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded bg-[var(--primary-light)] text-[var(--primary-text)] border border-[var(--primary)]/20">
                                    {reply.author_role}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-[var(--muted)]">{formatPostTime(reply.created_at)}</span>
                                {reply.can_delete && (
                                  <button
                                    type="button"
                                    onClick={() => setPendingDelete({ kind: 'reply', postId: post.id, replyId: reply.id })}
                                    className="text-[var(--danger)] hover:opacity-80 transition-opacity cursor-pointer"
                                    title="Delete reply"
                                    aria-label="Delete reply"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="text-[var(--text)] text-xs whitespace-pre-wrap leading-relaxed">{reply.content}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-[var(--muted)] italic pl-3">No replies yet.</p>
                    )}

                    {permissions.can_post && (
                      <form onSubmit={e => handlePostReply(post.id, e)} className="flex items-center gap-2 pt-1 pl-3">
                        <input
                          type="text"
                          placeholder="Write a reply…"
                          maxLength={5000}
                          value={replyInputs[post.id] || ''}
                          onChange={e => setReplyInputs(prev => ({ ...prev, [post.id]: e.target.value }))}
                          className="flex-1 bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--primary)]"
                        />
                        <Button
                          type="submit"
                          variant="primary"
                          size="sm"
                          loading={Boolean(submittingReplies[post.id])}
                          disabled={!replyInputs[post.id]?.trim()}
                          leftIcon={<Send className="w-3 h-3" />}
                        >
                          Reply
                        </Button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <ConfirmModal
        isOpen={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
        title={pendingDelete?.kind === 'reply' ? 'Delete this reply?' : 'Delete this message?'}
        message={pendingDelete?.kind === 'reply'
          ? 'The reply is removed for everyone.'
          : 'The message, its reactions and its replies are removed for everyone.'}
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}
