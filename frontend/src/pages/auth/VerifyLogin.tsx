import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../../services/apiClient';
import {
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  KeyRound,
  Clock,
  ArrowLeft
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';

/**
 * Confirms a suspicious sign-in. The request is always bound to one challenge:
 * either the single-use link token from the email (?token=...) or the challenge
 * reference returned by the sign-in form (?challenge=...) plus the emailed code.
 * If the account uses two-factor authentication, that step follows.
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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const autoSubmitted = useRef(false);

  const completeSignIn = (data: any) => {
    const { token: sessionToken, user } = data;
    localStorage.setItem('token', sessionToken);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('session_last_active', Date.now().toString());
    if (user?.organisation_id) {
      localStorage.setItem('current_org_id', user.organisation_id);
    }
    window.dispatchEvent(new Event('auth-change'));
    setSuccess(true);
    setTimeout(() => navigate('/app'), 1200);
  };

  const handleResponse = (resData: any) => {
    if (resData?.require_2fa && resData.temp_token) {
      setTempToken(resData.temp_token);
      setMaskedEmail(resData.masked_email || '');
      return;
    }
    if (resData?.success && resData?.data?.token) {
      completeSignIn(resData.data);
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
      submitChallenge({ token: linkToken });
    }
  }, [linkToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    submitChallenge({ challenge_id: challengeId, code: code.trim() });
  };

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/auth/verify-2fa', { temp_token: tempToken, code: twoFactorCode.trim() });
      handleResponse(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Incorrect code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const hasChallenge = Boolean(linkToken || challengeId);

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-[var(--bg)] text-[var(--text)]">
      <div className="sm:mx-auto sm:w-full sm:max-w-md space-y-6">
        <div className="text-center space-y-2">
          <Link to="/" className="inline-flex items-center gap-2 group">
            <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm group-hover:bg-indigo-500 transition-colors">
              <Clock className="w-5 h-5" />
            </div>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
            Security Verification
          </h1>
          <p className="text-xs text-[var(--muted)]">
            Confirm your identity for an unrecognised sign-in attempt
          </p>
        </div>

        <Card className="p-8 shadow-sm space-y-5">
          {success ? (
            <div className="text-center py-6 space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-[var(--text)]">Identity Verified</h3>
              <p className="text-xs text-[var(--muted)]">
                Your sign-in has been confirmed. Redirecting to your workspace...
              </p>
            </div>
          ) : (
            <>
              <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-[var(--text)] space-y-1">
                  <div className="font-semibold text-amber-400">
                    {tempToken ? 'Two-step verification' : 'New sign-in location'}
                  </div>
                  <p className="text-[var(--muted)] leading-relaxed">
                    {tempToken
                      ? `Enter the 6-digit code we emailed${maskedEmail ? ` to ${maskedEmail}` : ''}.`
                      : 'We noticed a sign-in from a new device or location. Enter the 6-digit code from the email we just sent you, or open the link in that email.'}
                  </p>
                </div>
              </div>

              {error && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-500 p-3 rounded-md text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
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
                    maxLength={6}
                    placeholder="123456"
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                    leftIcon={<KeyRound className="w-4 h-4" />}
                    className="font-mono text-sm tracking-widest"
                  />
                  <Button type="submit" variant="primary" size="md" className="w-full" loading={loading} rightIcon={<ArrowRight className="w-4 h-4" />}>
                    Verify & Sign In
                  </Button>
                </form>
              ) : !hasChallenge ? (
                <p className="text-xs text-[var(--muted)]">
                  This page needs the link from your verification email. Please sign in again to receive a new one.
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
                    maxLength={6}
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    leftIcon={<KeyRound className="w-4 h-4" />}
                    className="font-mono text-sm tracking-widest"
                  />
                  <Button type="submit" variant="primary" size="md" className="w-full" loading={loading} rightIcon={<ArrowRight className="w-4 h-4" />}>
                    Verify & Sign In
                  </Button>
                </form>
              )}

              <div className="pt-2 flex items-center justify-between text-xs border-t border-[var(--border)]">
                <Link
                  to="/login"
                  className="text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Sign In</span>
                </Link>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
