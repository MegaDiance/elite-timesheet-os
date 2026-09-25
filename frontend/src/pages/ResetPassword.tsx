import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../services/apiClient';
import { portalLoginPath } from '../services/portal';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Clock, AlertCircle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { friendlyError } from '../services/errors';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const [checkingToken, setCheckingToken] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [accountEmail, setAccountEmail] = useState('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Set when the password changed but the server could not tell which organisation to return to.
  const [doneWithoutPortal, setDoneWithoutPortal] = useState(false);
  const backTo = portalLoginPath();
  const backLabel = backTo === '/' ? 'Back to the home page' : 'Back to sign in';

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setCheckingToken(false);
      setTokenValid(false);
      return;
    }

    api.get('/auth/verify-reset-token', { params: { token } })
      .then(res => {
        if (res.data?.valid) {
          setTokenValid(true);
          setAccountEmail(res.data.email || '');
        } else {
          setTokenValid(false);
        }
      })
      .catch(() => {
        setTokenValid(false);
      })
      .finally(() => {
        setCheckingToken(false);
      });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password must contain both letters and numbers.');
      return;
    }

    if (password !== confirmPassword) {
      setError('The passwords don\u2019t match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.post('/auth/reset-password', { token, password });
      // Every session was ended by the reset, so sign in again — at the organisation's own sign-in
      // page, which the server works out from the reset link. There is no generic page to fall back to.
      const loginPath: string | null = res.data?.data?.login_path || null;
      if (loginPath && /^\/login\/[a-z0-9-]+$/.test(loginPath)) {
        navigate(`${loginPath}?reason=password-reset`, { replace: true });
      } else if (portalLoginPath() !== '/') {
        navigate(portalLoginPath('password-reset'), { replace: true });
      } else {
        setDoneWithoutPortal(true);
      }
    } catch (err: any) {
      setError(friendlyError(err, 'We couldn\u2019t reset your password. The link may have expired.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--bg)] text-[var(--text)] p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-xl bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center mx-auto">
            <Clock className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
            Choose a new password
          </h1>
          <p className="text-xs text-[var(--muted)]">
            Set a new password for your SimpleHours account
          </p>
        </div>

        <Card className="p-6 sm:p-8 space-y-5">
          {checkingToken ? (
            <div className="text-center py-10 space-y-3">
              <Clock className="w-6 h-6 animate-spin text-[var(--primary)] mx-auto" />
              <p className="text-xs font-medium text-[var(--muted)]">Checking your reset link…</p>
            </div>
          ) : doneWithoutPortal ? (
            <div className="text-center py-4 space-y-3">
              <div className="w-12 h-12 rounded-full bg-[var(--success-light)] text-[var(--success)] flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-[var(--text)]">Your password has been changed</h2>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Sign in with your new password using your organisation’s sign-in link.
              </p>
            </div>
          ) : !tokenValid ? (
            <div className="text-center py-4 space-y-4">
              <div className="w-12 h-12 rounded-full bg-[var(--danger-light)] text-[var(--danger)] flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-[var(--text)]">This reset link can't be used</h2>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                It may have expired or already been used. Reset links work once and expire after 1 hour.
              </p>
              <div className="pt-2 space-y-2">
                <Link to="/forgot-password" className="block">
                  <Button variant="primary" size="md" className="w-full">
                    Request a new link
                  </Button>
                </Link>
                <Link to={backTo} className="block">
                  <Button variant="ghost" size="sm" className="w-full">
                    {backLabel}
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {accountEmail && (
                <div className="p-3 rounded-lg bg-[var(--panel-subtle)] border border-[var(--border)] text-xs text-[var(--muted)]">
                  Account: <strong className="text-[var(--text)]">{accountEmail}</strong>
                </div>
              )}

              {error && (
                <div className="p-3 rounded-lg bg-[var(--danger-light)] border border-[var(--danger)]/25 text-[var(--danger)] text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-semibold text-[var(--text)]">New password</label>
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-xs text-[var(--primary)] hover:underline focus:outline-none"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input 
                  type={showPassword ? 'text' : 'password'} 
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  className="w-full px-3.5 py-2 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)]"
                />
                <p className="text-[11px] text-[var(--muted)] mt-1">Must contain both letters and numbers</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1">Confirm new password</label>
                <input 
                  type={showPassword ? 'text' : 'password'} 
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  required
                  className="w-full px-3.5 py-2 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)]"
                />
              </div>

              <Button 
                type="submit" 
                variant="primary"
                size="md"
                className="w-full"
                loading={isSubmitting}
              >
                Save new password
              </Button>

              <div className="text-center pt-2">
                <Link to={backTo} className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)]">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{backLabel}</span>
                </Link>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
