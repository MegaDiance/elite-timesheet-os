import { useState, useEffect } from 'react';
import api from '../services/apiClient';

export default function PlatformAdmin() {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Security Lock & Invite Modal State
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(true);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<{
    status: 'idle' | 'sent' | 'failed';
    email: string;
    message?: string;
    error?: string;
    inviteId?: string;
    debugLink?: string;
  }>({ status: 'idle', email: '' });
  const [modalError, setModalError] = useState('');

  // Table action & debug states
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showEmergencyLinks, setShowEmergencyLinks] = useState(false);

  const fetchOrgsAndInvites = async () => {
    try {
      setLoading(true);
      const [orgsRes, invitesRes] = await Promise.all([
        api.get('/platform/organisations'),
        api.get('/platform/invitations')
      ]);
      setOrgs(orgsRes.data.data || []);
      setInvitations(invitesRes.data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrgsAndInvites();
  }, []);

  const handleUnlockPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput === 'admin123' || pinInput === 'password123') {
      setIsUnlocked(true);
      setModalError('');
    } else {
      setModalError('Invalid security password. Access denied.');
    }
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    setIsSending(true);

    try {
      const res = await api.post('/platform/send-invite', { email: recipientEmail });
      setInviteResult({
        status: 'sent',
        email: recipientEmail,
        message: res.data.data?.message || `Invitation email sent to ${recipientEmail}`,
        inviteId: res.data.data?.id,
        debugLink: res.data.data?.inviteLink
      });
      fetchOrgsAndInvites();
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.message || err.message || 'Failed to dispatch invitation email';
      const inviteId = err.response?.data?.data?.id;
      setInviteResult({
        status: 'failed',
        email: recipientEmail,
        error: errMsg,
        inviteId: inviteId
      });
      fetchOrgsAndInvites();
    } finally {
      setIsSending(false);
    }
  };

  const handleRetryFromModal = async () => {
    if (!inviteResult.email && !inviteResult.inviteId) return;
    setIsSending(true);
    setModalError('');

    try {
      const res = await api.post('/platform/resend-invite', {
        id: inviteResult.inviteId,
        email: inviteResult.email
      });
      setInviteResult({
        status: 'sent',
        email: inviteResult.email,
        message: res.data.data?.message || `Invitation email sent to ${inviteResult.email}`,
        inviteId: res.data.data?.id
      });
      fetchOrgsAndInvites();
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.message || err.message || 'Retry failed to deliver email';
      setInviteResult(prev => ({
        ...prev,
        status: 'failed',
        error: errMsg
      }));
    } finally {
      setIsSending(false);
    }
  };

  const handleRetryFromTable = async (inv: any) => {
    setRetryingId(inv.id);
    setActionNotice(null);
    try {
      const res = await api.post('/platform/resend-invite', { id: inv.id, email: inv.email });
      setActionNotice({
        type: 'success',
        message: res.data.data?.message || `Invitation email resent to ${inv.email}`
      });
      fetchOrgsAndInvites();
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.message || err.message || 'Failed to resend invitation email';
      setActionNotice({
        type: 'error',
        message: errMsg
      });
      fetchOrgsAndInvites();
    } finally {
      setRetryingId(null);
    }
  };

  const closeInviteModal = () => {
    setShowInviteModal(false);
    setIsUnlocked(false);
    setPinInput('');
    setRecipientEmail('');
    setInviteResult({ status: 'idle', email: '' });
    setModalError('');
    setIsSending(false);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] overflow-hidden">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-[var(--text)] mb-1">Platform Administration</h2>
          <p className="text-sm text-[var(--muted)]">Manage multi-tenant organizations and invite new organization administrators.</p>
        </div>
        <button 
          onClick={() => setShowInviteModal(true)} 
          className="bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold py-2.5 px-4 rounded-xl flex items-center gap-2 text-sm transition-colors shadow-lg shadow-[var(--primary-light)] cursor-pointer"
        >
          Invite Organisation
        </button>
      </div>

      {actionNotice && (
        <div className={`mb-4 px-4 py-3 rounded-xl border text-sm flex justify-between items-center ${
          actionNotice.type === 'success' 
            ? 'bg-[var(--success-light)] text-[var(--success)] border-[var(--success)]/20' 
            : 'bg-[var(--danger-light)] text-[var(--danger)] border-[var(--danger)]/20'
        }`}>
          <span>{actionNotice.message}</span>
          <button onClick={() => setActionNotice(null)} className="text-xs font-bold underline ml-4 cursor-pointer">Dismiss</button>
        </div>
      )}

      <div className="flex-1 overflow-auto space-y-6">
        {/* Active Organisations Table */}
        <div className="bg-[var(--panel)] rounded-xl border border-[var(--border)] overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--panel-subtle)] flex justify-between items-center">
            <h3 className="text-sm font-bold text-[var(--text)]">Active Organisations & Admins</h3>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[var(--glass-8)] text-[var(--muted)]">
              {orgs.length} Total
            </span>
          </div>
          <table className="w-full text-left border-collapse">
            <thead className="bg-[var(--table-header)] sticky top-0 z-20">
              <tr>
                <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Organization Name</th>
                <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Admin Email</th>
                <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Users</th>
                <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">ID</th>
                <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Status</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org: any) => (
                <tr key={org.id} className="hover:bg-[var(--hover-row)] border-b border-[var(--border)]">
                  <td className="py-3 px-4">
                    <div className="font-bold text-sm text-[var(--text)]">{org.name}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-sm font-medium text-[var(--text)] flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[var(--primary)] inline-block"></span>
                      {org.admin_email || <span className="text-xs text-[var(--muted)] italic">No admin assigned</span>}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-[var(--input-bg)] border border-[var(--border)] text-[var(--text)]">
                      {org.user_count || 1} users
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-xs font-mono text-[var(--muted)] bg-[var(--input-bg)] border border-[var(--border)] px-2 py-1 rounded">{org.id}</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-[var(--success-light)] text-[var(--success)]">
                      Active
                    </span>
                  </td>
                </tr>
              ))}
              {orgs.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[var(--muted)] text-sm">No organizations found.</td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[var(--muted)] text-sm">Loading organizations...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Organisation Invitations & Delivery Status Table */}
        <div className="bg-[var(--panel)] rounded-xl border border-[var(--border)] overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--panel-subtle)] flex justify-between items-center">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-[var(--text)]">Organisation Invitations & Delivery Status</h3>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[var(--glass-8)] text-[var(--muted)]">
                {invitations.length} Total
              </span>
            </div>
            <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer select-none">
              <input 
                type="checkbox" 
                checked={showEmergencyLinks} 
                onChange={e => setShowEmergencyLinks(e.target.checked)} 
                className="rounded border-[var(--border)] text-[var(--primary)] focus:ring-0"
              />
              Emergency Debug URLs
            </label>
          </div>
          <table className="w-full text-left border-collapse">
            <thead className="bg-[var(--table-header)] sticky top-0 z-20">
              <tr>
                <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Recipient Email</th>
                <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Sent At</th>
                <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Email Delivery</th>
                <th className="py-3 px-4 text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Setup Status</th>
                <th className="py-3 px-4 text-right text-[var(--muted)] font-bold text-xs uppercase tracking-wider border-b border-[var(--border)]">Action</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv: any) => {
                const isRetrying = retryingId === inv.id;
                const isFailed = inv.delivery_status === 'failed';
                const isSent = inv.delivery_status === 'sent';
                const inviteUrl = `${window.location.origin}/setup-org?token=${inv.token}`;

                return (
                  <tr key={inv.id} className="hover:bg-[var(--hover-row)] border-b border-[var(--border)]">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-sm text-[var(--text)]">{inv.email}</div>
                      {showEmergencyLinks && !inv.used && (
                        <div className="text-[10px] font-mono text-[var(--muted)] break-all mt-1">
                          {inviteUrl}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-xs text-[var(--muted)]">
                        {inv.created_at ? new Date(inv.created_at).toLocaleString() : '—'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {isSent ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[var(--success-light)] text-[var(--success)]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
                          Sent
                        </span>
                      ) : isFailed ? (
                        <div className="flex flex-col">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[var(--danger-light)] text-[var(--danger)] w-fit">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--danger)]"></span>
                            Failed
                          </span>
                          {inv.last_error && (
                            <span className="text-[11px] text-[var(--danger)] mt-1 max-w-xs truncate" title={inv.last_error}>
                              {inv.last_error}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-[var(--input-bg)] text-[var(--muted)] border border-[var(--border)]">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {inv.used ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-[var(--success-light)] text-[var(--success)]">
                          Claimed & Provisioned
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-[var(--warn-light)] text-[var(--warn)]">
                          Pending Setup
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!inv.used && (
                          <button
                            disabled={isRetrying}
                            onClick={() => handleRetryFromTable(inv)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                              isFailed
                                ? 'bg-[var(--danger-light)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white'
                                : 'bg-[var(--primary-light)] text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white'
                            }`}
                          >
                            {isRetrying ? 'Sending...' : isFailed ? 'Retry Email' : 'Resend Email'}
                          </button>
                        )}
                        {showEmergencyLinks && !inv.used && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(inviteUrl);
                              alert('Debug Link copied:\n\n' + inviteUrl);
                            }}
                            className="px-2 py-1 rounded text-[11px] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)]"
                          >
                            Copy Link
                          </button>
                        )}
                        {inv.used && (
                          <span className="text-xs text-[var(--muted)] italic">Completed</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {invitations.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-[var(--muted)] text-sm">No invitations sent yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Protected Organisation Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--panel)] rounded-2xl w-full max-w-md border border-[var(--border)] shadow-2xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
                Organisation Invitation
              </h3>
              <button onClick={closeInviteModal} className="text-[var(--muted)] hover:text-[var(--text)] cursor-pointer">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            {modalError && (
              <div className="mb-4 text-sm text-[var(--danger)] bg-[var(--danger-light)] p-3 rounded-xl border border-[var(--danger)]/20">
                {modalError}
              </div>
            )}

            {!isUnlocked ? (
              <form onSubmit={handleUnlockPin} className="space-y-4">
                <p className="text-xs text-[var(--muted)]">Security Authentication Required. Enter master password to access organisation provisioning.</p>
                <div>
                  <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">Master Password / PIN</label>
                  <input 
                    required 
                    type="password" 
                    placeholder="Enter password (e.g. admin123)" 
                    value={pinInput} 
                    onChange={e => setPinInput(e.target.value)} 
                    className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] outline-none focus:border-[var(--primary)] text-sm" 
                  />
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <button type="button" onClick={closeInviteModal} className="px-4 py-2 rounded-xl text-sm font-bold text-[var(--muted)] cursor-pointer">Cancel</button>
                  <button type="submit" className="px-6 py-2 rounded-xl text-sm font-bold bg-[var(--primary)] text-white hover:bg-[var(--primary-h)] transition-colors cursor-pointer">Authenticate</button>
                </div>
              </form>
            ) : inviteResult.status === 'sent' ? (
              /* Success Card */
              <div className="space-y-5 py-2">
                <div className="p-4 bg-[var(--success-light)] border border-[var(--success)]/30 rounded-2xl text-center space-y-2">
                  <div className="w-10 h-10 mx-auto rounded-full bg-[var(--success)] text-white flex items-center justify-center shadow">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                  <div className="text-base font-bold text-[var(--text)]">Organisation invited</div>
                  <div className="text-sm text-[var(--muted)]">
                    Invitation email sent to: <span className="font-semibold text-[var(--text)]">{inviteResult.email}</span>
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[var(--panel)] text-[var(--success)] border border-[var(--success)]/20">
                    <span className="w-2 h-2 rounded-full bg-[var(--success)]"></span>
                    Status: Sent
                  </div>
                </div>

                <p className="text-xs text-center text-[var(--muted)] leading-relaxed">
                  The recipient will receive an onboarding email with a secure link to set up their company workspace and administrator password.
                </p>

                {showEmergencyLinks && inviteResult.debugLink && (
                  <div className="p-3 bg-[var(--input-bg)] border border-[var(--border)] rounded-xl space-y-1">
                    <div className="text-[10px] font-bold uppercase text-[var(--muted)]">Emergency Debug Link:</div>
                    <div className="font-mono text-[11px] text-[var(--text)] break-all select-all">
                      {inviteResult.debugLink}
                    </div>
                  </div>
                )}

                <button 
                  onClick={closeInviteModal} 
                  className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold rounded-xl text-sm transition-colors shadow-lg shadow-[var(--primary-light)] cursor-pointer"
                >
                  Done
                </button>
              </div>
            ) : inviteResult.status === 'failed' ? (
              /* Failure Card */
              <div className="space-y-5 py-2">
                <div className="p-4 bg-[var(--danger-light)] border border-[var(--danger)]/30 rounded-2xl text-center space-y-2">
                  <div className="w-10 h-10 mx-auto rounded-full bg-[var(--danger)] text-white flex items-center justify-center shadow">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </div>
                  <div className="text-base font-bold text-[var(--text)]">Organisation invitation created</div>
                  <div className="text-sm text-[var(--danger)] font-medium">
                    Email could not be sent:
                  </div>
                  <div className="p-2.5 bg-[var(--panel)] rounded-xl border border-[var(--danger)]/20 text-xs text-[var(--text)] text-left break-words">
                    {inviteResult.error || 'Provider rejected email delivery'}
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[var(--panel)] text-[var(--danger)] border border-[var(--danger)]/20">
                    <span className="w-2 h-2 rounded-full bg-[var(--danger)]"></span>
                    Status: Delivery Failed
                  </div>
                </div>

                <div className="flex gap-3">
                  <button 
                    type="button" 
                    onClick={closeInviteModal} 
                    className="flex-1 py-2.5 bg-[var(--input-bg)] hover:bg-[var(--hover-row)] border border-[var(--border)] text-[var(--muted)] font-bold rounded-xl text-sm transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                  <button 
                    type="button" 
                    disabled={isSending}
                    onClick={handleRetryFromModal} 
                    className="flex-1 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold rounded-xl text-sm transition-colors shadow-lg shadow-[var(--primary-light)] cursor-pointer disabled:opacity-50"
                  >
                    {isSending ? 'Retrying...' : 'Retry Email'}
                  </button>
                </div>
              </div>
            ) : (
              /* Send Form */
              <form onSubmit={handleSendInvite} className="space-y-4">
                <p className="text-xs text-[var(--muted)]">
                  Enter the recipient email address. The backend will automatically generate a secure setup token and dispatch an onboarding email.
                </p>
                <div>
                  <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">Recipient Email</label>
                  <input 
                    required 
                    type="email" 
                    placeholder="newadmin@company.com" 
                    value={recipientEmail} 
                    onChange={e => setRecipientEmail(e.target.value)} 
                    disabled={isSending}
                    className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] outline-none focus:border-[var(--primary)] text-sm disabled:opacity-50" 
                  />
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <button 
                    type="button" 
                    onClick={closeInviteModal} 
                    disabled={isSending}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-[var(--muted)] cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    disabled={isSending}
                    className="px-6 py-2.5 rounded-xl text-sm font-bold bg-[var(--primary)] text-white hover:bg-[var(--primary-h)] transition-colors shadow-lg shadow-[var(--primary-light)] cursor-pointer disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSending ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                        Sending invitation email...
                      </>
                    ) : (
                      'Send Invite'
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
