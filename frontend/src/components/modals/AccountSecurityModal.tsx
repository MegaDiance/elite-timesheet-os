import React, { useState, useEffect } from 'react';
import api from '../../services/apiClient';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { 
  ShieldCheck, 
  Laptop, 
  Smartphone, 
  Globe, 
  Clock, 
  AlertCircle, 
  Trash2, 
  RefreshCw,
  MapPin,
  CheckCircle2,
  XCircle,
  AlertTriangle
} from 'lucide-react';

interface SessionItem {
  id: string;
  ip_address: string | null;
  approx_location: string;
  device_info: string;
  created_at: string;
  last_active_at: string;
  is_current: boolean;
}

type SignInStatus = 'SUCCESS' | 'FAILED' | 'CHALLENGE_REQUIRED' | 'CHALLENGE_VERIFIED' | 'RATE_LIMITED';

interface SignInHistoryItem {
  id: string;
  created_at: string;
  approx_location: string | null;
  device_info: string | null;
  auth_method: string | null;
  status: SignInStatus;
}

interface SecurityActivityData {
  last_login: {
    timestamp: string;
    approx_location: string | null;
    device_info: string | null;
  } | null;
  active_sessions: SessionItem[];
  recent_history: SignInHistoryItem[];
}

const STATUS_LABEL: Record<SignInStatus, string> = {
  SUCCESS: 'Signed in',
  CHALLENGE_VERIFIED: 'Signed in (verified)',
  CHALLENGE_REQUIRED: 'Verification sent',
  FAILED: 'Failed',
  RATE_LIMITED: 'Blocked (too many attempts)',
};

const isSuccess = (status: SignInStatus) => status === 'SUCCESS' || status === 'CHALLENGE_VERIFIED';

interface AccountSecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AccountSecurityModal: React.FC<AccountSecurityModalProps> = ({ isOpen, onClose }) => {
  const [data, setData] = useState<SecurityActivityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingAllOthers, setRevokingAllOthers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchSecurityActivity();
    }
  }, [isOpen]);

  const fetchSecurityActivity = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/auth/security/activity');
      if (res.data?.success && res.data?.data) {
        setData(res.data.data);
      } else {
        setError('Your sign-in activity could not be loaded.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Your sign-in activity could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingId(sessionId);
    setError(null);
    setSuccessNotice(null);
    try {
      const res = await api.post('/auth/security/revoke-session', { session_id: sessionId });
      if (res.data?.success) {
        setSuccessNotice('That device has been signed out.');
        await fetchSecurityActivity();
      } else {
        setError(res.data?.error?.message || 'That session could not be signed out.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'That session could not be signed out.');
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeOtherSessions = async () => {
    setRevokingAllOthers(true);
    setError(null);
    setSuccessNotice(null);
    try {
      const res = await api.post('/auth/security/revoke-other-sessions');
      if (res.data?.success) {
        setSuccessNotice('All your other devices have been signed out.');
        await fetchSecurityActivity();
      } else {
        setError(res.data?.error?.message || 'Your other devices could not be signed out.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Your other devices could not be signed out.');
    } finally {
      setRevokingAllOthers(false);
    }
  };

  const formatDate = (isoString: string) => {
    if (!isoString) return 'Unknown';
    try {
      const d = new Date(isoString);
      return d.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return isoString;
    }
  };

  const getDeviceIcon = (summary: string | null) => {
    const s = (summary || '').toLowerCase();
    if (s.includes('mobile') || s.includes('iphone') || s.includes('android')) {
      return <Smartphone className="w-4 h-4 text-indigo-400 shrink-0" />;
    }
    return <Laptop className="w-4 h-4 text-indigo-400 shrink-0" />;
  };

  const otherSessionsCount = (data?.active_sessions || []).filter(s => !s.is_current).length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Sign-in activity"
      description="Where your account is signed in, and its recent sign-ins."
      maxWidth="2xl"
    >
      <div className="space-y-6 max-h-[75vh] overflow-y-auto pr-1">
        {error && (
          <div className="p-3 rounded-md bg-rose-500/10 border border-rose-500/20 text-xs text-rose-500 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {successNotice && (
          <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-500 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{successNotice}</span>
          </div>
        )}

        {loading && !data ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-[var(--muted)]">
            <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
            <p className="text-xs">Loading your sign-in activity…</p>
          </div>
        ) : (
          <>
            {/* Last Login Summary Card */}
            {data?.last_login && (
              <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-indigo-400 uppercase tracking-wider">
                      Previous sign-in
                    </div>
                    <div className="text-xs font-semibold text-[var(--text)] mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{formatDate(data.last_login.timestamp)}</span>
                      <span className="text-[var(--border)]">•</span>
                      <span className="flex items-center gap-1 text-[var(--muted)] font-normal">
                        <MapPin className="w-3 h-3 text-indigo-400" />
                        {data.last_login.approx_location || 'Unknown location'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right sm:self-center">
                  <span className="text-[11px] font-mono text-[var(--muted)] bg-[var(--panel-subtle)] px-2 py-0.5 rounded border border-[var(--border)]">
                    {data.last_login.device_info || 'Unknown device'}
                  </span>
                </div>
              </div>
            )}

            {/* Active Sessions List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-[var(--text)] uppercase tracking-wider">
                    Signed-in devices ({data?.active_sessions.length || 0})
                  </h4>
                  <p className="text-[11px] text-[var(--muted)]">
                    Devices where your account is signed in right now.
                  </p>
                </div>
                {otherSessionsCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRevokeOtherSessions}
                    loading={revokingAllOthers}
                    className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 text-xs"
                    leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                  >
                    Sign out other devices ({otherSessionsCount})
                  </Button>
                )}
              </div>

              <div className="space-y-2.5">
                {data?.active_sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`p-3.5 rounded-lg border transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      session.is_current
                        ? 'bg-emerald-500/5 border-emerald-500/30'
                        : 'bg-[var(--panel-subtle)] border-[var(--border)]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {getDeviceIcon(session.device_info)}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-[var(--text)]">
                            {session.device_info}
                          </span>
                          {session.is_current ? (
                            <Badge variant="success" size="sm">
                              This device
                            </Badge>
                          ) : session.ip_address ? (
                            <span className="text-[11px] text-[var(--muted)]">
                              IP: {session.ip_address}
                            </span>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-[var(--muted)] flex-wrap">
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-indigo-400" />
                            {session.approx_location}
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Last active: {formatDate(session.last_active_at)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {!session.is_current && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleRevokeSession(session.id)}
                        loading={revokingId === session.id}
                        className="text-xs sm:self-center"
                      >
                        Sign out
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Login Activity History */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-[var(--text)] uppercase tracking-wider">
                    Recent sign-ins
                  </h4>
                  <p className="text-[11px] text-[var(--muted)]">
                    The latest sign-in attempts on your account.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchSecurityActivity}
                  loading={loading}
                  leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                >
                  Refresh
                </Button>
              </div>

              {(!data?.recent_history || data.recent_history.length === 0) ? (
                <div className="p-4 text-center text-xs text-[var(--muted)] border border-dashed border-[var(--border)] rounded-lg">
                  No sign-ins recorded yet.
                </div>
              ) : (
                <div className="border border-[var(--border)] rounded-lg overflow-hidden divide-y divide-[var(--border)] text-xs">
                  {data.recent_history.map((act) => (
                    <div key={act.id} className="p-3 flex items-center justify-between gap-3 hover:bg-[var(--hover-row)] transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {isSuccess(act.status) ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : act.status === 'CHALLENGE_REQUIRED' ? (
                          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[var(--text)] truncate">
                              {act.device_info || 'Unknown device'}
                            </span>
                            <Badge
                              variant={isSuccess(act.status) ? 'success' : act.status === 'CHALLENGE_REQUIRED' ? 'warning' : 'danger'}
                              size="sm"
                            >
                              {STATUS_LABEL[act.status] || act.status}
                            </Badge>
                          </div>
                          <div className="text-[11px] text-[var(--muted)] flex items-center gap-2 mt-0.5">
                            <span>{act.approx_location || 'Unknown location'}</span>
                            <span>•</span>
                            <span>{formatDate(act.created_at)}</span>
                          </div>
                        </div>
                      </div>

                      {act.auth_method && (
                        <div className="text-right shrink-0">
                          <span className="text-[10px] font-mono text-[var(--muted)] uppercase px-1.5 py-0.5 rounded bg-[var(--panel-subtle)] border border-[var(--border)]">
                            {act.auth_method.replace(/_/g, ' ')}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Security Policy Reminder */}
        <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between text-[11px] text-[var(--muted)]">
          <div className="flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-indigo-400" />
            <span>Locations are approximate, based on network address.</span>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
};
