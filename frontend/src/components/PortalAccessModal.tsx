import { useState } from 'react';
import { Copy, KeyRound, Mail, Send, UserX } from 'lucide-react';
import api from '../services/apiClient';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { useToast } from './ui/Toast';

export type PortalStatus = 'none' | 'invited' | 'active';

interface PortalWorker {
  id: string;
  full_name: string;
  email: string | null;
  is_active: boolean;
  portal_status: PortalStatus;
}

const errorMessage = (err: any, fallback: string): string => err?.response?.data?.error?.message || fallback;

/**
 * Gives one worker a login to the employee portal, or takes it away. Everything here is a call to
 * /api/employee-accounts, which authorises the caller against the worker's own branch.
 *
 * While email is turned off the server hands back the invitation / reset link instead of emailing
 * it; it is shown here once to copy and pass on.
 */
export default function PortalAccessModal({ worker, onClose, onChanged }: {
  worker: PortalWorker;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ label: string; url: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err, 'That didn’t work. Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  const invite = () => run('invite', async () => {
    const res = await api.post(`/employee-accounts/${worker.id}/invitations`);
    if (res.data?.data?.invite_link) setLink({ label: 'Invitation link', url: res.data.data.invite_link });
    toast.success(res.data?.message || 'Invitation created.');
    onChanged();
  });

  const resend = () => run('resend', async () => {
    const res = await api.post(`/employee-accounts/${worker.id}/invitations/resend`);
    if (res.data?.data?.invite_link) setLink({ label: 'New invitation link', url: res.data.data.invite_link });
    toast.success(res.data?.message || 'Invitation re-sent.');
  });

  const revokeInvite = () => run('revoke', async () => {
    await api.delete(`/employee-accounts/${worker.id}/invitations`);
    setLink(null);
    toast.success('Invitation revoked.');
    onChanged();
  });

  const resetLink = () => run('reset', async () => {
    const res = await api.post(`/employee-accounts/${worker.id}/reset-password-link`);
    setLink({ label: 'Password reset link', url: res.data.data.reset_link });
  });

  const removeAccess = () => run('remove', async () => {
    await api.delete(`/employee-accounts/${worker.id}`);
    setConfirmRemove(false);
    setLink(null);
    toast.success(`${worker.full_name} can no longer sign in.`);
    onChanged();
  });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied.');
    } catch {
      toast.error('Couldn’t copy automatically. Select the link and copy it.');
    }
  };

  const statusText: Record<PortalStatus, string> = {
    none: 'No portal access. They can’t sign in.',
    invited: 'Invited. Waiting for them to accept.',
    active: 'Has portal access. They sign in at your organisation’s sign-in link.',
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Portal access: ${worker.full_name}`}
      description="With portal access, a worker can see their own schedule, request leave and, if your organisation allows it, record their own hours. They never see anyone else’s."
      maxWidth="lg"
    >
      <div className="space-y-4">
        <div className="p-3 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] text-xs text-[var(--text)]">
          {statusText[worker.portal_status]}
        </div>

        {error && (
          <div role="alert" className="p-3 rounded-md text-xs bg-[var(--danger-light)] border border-[var(--danger)]/30 text-[var(--danger)]">{error}</div>
        )}

        {link && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-[var(--text)]">{link.label}</div>
            <div className="flex gap-2">
              <input
                readOnly
                value={link.url}
                onFocus={e => e.currentTarget.select()}
                className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono bg-[var(--input-bg)] border border-[var(--border)] rounded-md text-[var(--text)]"
                aria-label={link.label}
              />
              <Button variant="secondary" size="sm" onClick={() => copy(link.url)} leftIcon={<Copy className="w-3.5 h-3.5" />}>Copy</Button>
            </div>
            <p className="text-[11px] text-[var(--muted)]">Share it with {worker.full_name} yourself. It works once.</p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
          {worker.portal_status === 'none' && (
            worker.email ? (
              <Button variant="primary" size="sm" loading={busy === 'invite'} disabled={!worker.is_active || Boolean(busy)} onClick={invite} leftIcon={<Send className="w-3.5 h-3.5" />}>
                Invite {worker.email}
              </Button>
            ) : (
              <p className="text-xs text-[var(--muted)]">Add an email address to this worker (Edit) before inviting them.</p>
            )
          )}
          {worker.portal_status === 'invited' && (
            <>
              <Button variant="primary" size="sm" loading={busy === 'resend'} disabled={Boolean(busy)} onClick={resend} leftIcon={<Mail className="w-3.5 h-3.5" />}>
                Resend invitation
              </Button>
              <Button variant="ghost" size="sm" loading={busy === 'revoke'} disabled={Boolean(busy)} onClick={revokeInvite}>
                Revoke invitation
              </Button>
            </>
          )}
          {worker.portal_status === 'active' && (
            <>
              <Button variant="secondary" size="sm" loading={busy === 'reset'} disabled={Boolean(busy)} onClick={resetLink} leftIcon={<KeyRound className="w-3.5 h-3.5" />}>
                Create password reset link
              </Button>
              {confirmRemove ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <Button variant="danger" size="sm" loading={busy === 'remove'} disabled={Boolean(busy)} onClick={removeAccess}>Remove access</Button>
                  <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => setConfirmRemove(false)}>Keep access</Button>
                </span>
              ) : (
                <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => setConfirmRemove(true)} leftIcon={<UserX className="w-3.5 h-3.5" />}>
                  Remove portal access
                </Button>
              )}
            </>
          )}
        </div>
        {!worker.is_active && worker.portal_status === 'none' && (
          <p className="text-xs text-[var(--muted)]">Reactivate this worker before inviting them.</p>
        )}

        <div className="flex justify-end pt-3 border-t border-[var(--border)]">
          <Button variant="secondary" size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
