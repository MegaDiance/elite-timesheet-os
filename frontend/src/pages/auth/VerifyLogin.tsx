import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ShieldAlert, CheckCircle2, AlertCircle, ArrowRight, KeyRound, Clock, ArrowLeft, ShieldCheck } from 'lucide-react';
import api from '../../services/apiClient';
import { storeSession } from '../../hooks/useAccess';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';

/**
 * Confirms a sign-in from a new device or location. The request is always bound to one challenge:
 * either the single-use link token from the email (?token=...) or the challenge reference returned
 * by the sign-in form (?challenge=...) plus the emailed code. If the account uses two-step
 * verification, that step follows on this page.
 */
export default function VerifyLogin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const linkToken = searchParams.get('token') || '';
  const challengeId = searchParams.get('challenge') || '';

  const [code, setCode] = useState('');
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const autoSubmitted = useRef(false);

  const handleResponse = (body: any) => {
    if (body?.require_2fa && body.temp_token) {
      setTempToken(body.temp_token);
      setMaskedEmail(body.masked_email || '');
      setTwoFactorCode('');
      return;
    }
    if (body?.data?.token) {
      storeSession(body.data.token);
      setSuccess(true);
      navigate('/dashboard', { replace: true });
      return;
    }
    setError('Verification failed. Please sign in again.');
  };

  const submitChallenge = async (payload: Record<string, string>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/auth/verify-login', payload);
      handleResponse(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'This verification request is invalid or has expired. Please sign in again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (linkToken && !autoSubmitted.current) {
      autoSubmitted.current = true;
      void submitChallenge({ token: linkToken });
    }
  }, [linkToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    void submitChallenge({ challenge_id: challengeId, code: code.trim() });
  };

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempToken) return;
    if (!/^\d{6}$/.test(twoFactorCode.trim())) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post('/auth/verify-2fa', { temp_token: tempToken, code: twoFactorCode.trim() });
      handleResponse(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'That code didn’t work. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!tempToken) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post('/auth/resend-2fa', { temp_token: tempToken });
      setNotice(res.data?.message || 'A new code has been sent to your email.');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'We couldn’t send a new code. Please sign in again.');
    } finally {
      setResending(false);
    }
  };

  const hasChallenge = Boolean(linkToken || challengeId);

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-[var(--bg)] text-[var(--text)]">
      <div className="sm:mx-auto sm:w-full sm:max-w-md space-y-6">
        <div className="text-center space-y-2">
          <Link to="/" className="inline-flex items-center gap-2 group" aria-label="SimpleHours home">
            <div className="w-10 h-10 rounded-lg bg-[var(--primary)] flex items-center justify-center text-white shadow-sm group-hover:bg-[var(--primary-h)] transition-colors">
              <Clock className="w-5 h-5" />
            </div>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Confirm it's you</h1>
          <p className="text-xs text-[var(--muted)]">We need to confirm a sign-in from a new device or location</p>
        </div>

        <Card className="p-8 shadow-sm space-y-5">
          {success ? (
            <div className="text-center py-6 space-y-3">
              <div className="w-12 h-12 rounded-full bg-[var(--success-light)] text-[var(--success)] border border-[var(--success)]/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h2 className="text-base font-bold text-[var(--text)]">Sign-in confirmed</h2>
              <p className="text-xs text-[var(--muted)]">Taking you to your dashboard…</p>
            </div>
          ) : (
            <>
              <div className="p-3.5 rounded-lg bg-[var(--warn-light)] border border-[var(--warn)]/25 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-[var(--warn)] shrink-0 mt-0.5" />
                <div className="text-xs text-[var(--text)] space-y-1">
                  <div className="font-semibold">{tempToken ? 'Two-step verification' : 'New sign-in location'}</div>
                  <p className="text-[var(--muted)] leading-relaxed">
                    {tempToken
                      ? `Enter the 6-digit code we emailed${maskedEmail ? ` to ${maskedEmail}` : ''}.`
                      : 'Enter the 6-digit code from the email we just sent you, or open the link in that email.'}
                  </p>
                </div>
              </div>

              {error && (
                <div role="alert" className="bg-[var(--danger-light)] border border-[var(--danger)]/25 text-[var(--danger)] p-3 rounded-md text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {notice && (
                <div className="bg-[var(--success-light)] border border-[var(--success)]/25 text-[var(--success)] p-3 rounded-md text-xs flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{notice}</span>
                </div>
              )}

              {tempToken ? (
                <form onSubmit={handleTwoFactorSubmit} className="space-y-4">
                  <Input
                    label="Verification code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    autoFocus
                    maxLength={6}
                    placeholder="123456"
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    leftIcon={<KeyRound className="w-4 h-4" />}
                    className="font-mono text-sm tracking-widest"
                  />
                  <Button type="submit" variant="primary" size="md" className="w-full" loading={loading} rightIcon={<ArrowRight className="w-4 h-4" />}>
                    Verify and sign in
                  </Button>
                  <div className="flex justify-end text-xs">
                    <button type="button" onClick={handleResend} disabled={resending} className="text-[var(--primary)] hover:underline disabled:opacity-50">
                      {resending ? 'Sending…' : 'Send a new code'}
                    </button>
                  </div>
                </form>
              ) : !hasChallenge ? (
                <p className="text-xs text-[var(--muted)]">
                  This page needs the link or code from your verification email. Please sign in again to get a new one.
                </p>
              ) : linkToken ? (
                <p className="text-xs text-[var(--muted)]">{loading ? 'Checking your link…' : ''}</p>
              ) : (
                <form onSubmit={handleCodeSubmit} className="space-y-4">
                  <Input
                    label="Verification code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    autoFocus
                    maxLength={6}
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    leftIcon={<KeyRound className="w-4 h-4" />}
                    className="font-mono text-sm tracking-widest"
                  />
                  <Button type="submit" variant="primary" size="md" className="w-full" loading={loading} rightIcon={<ArrowRight className="w-4 h-4" />}>
                    Verify and sign in
                  </Button>
                </form>
              )}

              <div className="pt-3 flex items-center justify-between text-xs border-t border-[var(--border)]">
                <Link to="/login" className="text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to sign in</span>
                </Link>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
