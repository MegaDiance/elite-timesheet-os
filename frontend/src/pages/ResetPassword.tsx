import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../services/apiClient';

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

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setCheckingToken(false);
      setTokenValid(false);
      return;
    }

    api.get(`/auth/verify-reset-token?token=${token}`)
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
      setError('Passwords do not match. Please re-enter your new password.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/login?reset=success');
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.error?.message || 'Failed to reset password. The link may have expired.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--bg)] text-[var(--text)] font-['Inter',sans-serif] p-4">
      <div className="w-full max-w-md p-8 bg-[var(--panel)] rounded-2xl border border-[var(--border)] shadow-2xl">
        
        {checkingToken ? (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-4 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-sm font-medium text-[var(--muted)]">Verifying password reset link...</p>
          </div>
        ) : !tokenValid ? (
          <div className="text-center py-6 space-y-4">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-[var(--danger-light)] text-[var(--danger)] rounded-2xl mb-2">
              <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
              </svg>
            </div>
            <h2 className="text-xl font-bold text-[var(--text)]">Invalid or Expired Link</h2>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              This password reset link is invalid or has already expired. Password reset links are single-use and valid for 1 hour.
            </p>
            <div className="pt-4 space-y-2">
              <Link 
                to="/forgot-password" 
                className="block w-full bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold py-3 rounded-xl text-sm transition-colors text-center"
              >
                Request a New Reset Link
              </Link>
              <Link 
                to="/login" 
                className="block w-full text-center text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)] py-2"
              >
                Return to Login
              </Link>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-[var(--primary-light)] text-[var(--primary)] rounded-2xl mb-4 border border-[var(--primary)]/20">
                <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
              </div>
              <h2 className="text-2xl font-black text-[var(--text)]">Create New Password</h2>
              {accountEmail && (
                <p className="text-xs text-[var(--muted)] mt-1">
                  For account <strong className="text-[var(--text)]">{accountEmail}</strong>
                </p>
              )}
            </div>

            {error && (
              <div className="bg-[var(--danger-light)] border border-[var(--danger)]/20 text-[var(--danger)] p-3 rounded-xl mb-4 text-xs font-semibold">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">New Password</label>
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-xs font-semibold text-[var(--primary)] hover:underline focus:outline-none"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input 
                  type={showPassword ? 'text' : 'password'} 
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters (letters & numbers)" 
                  className="w-full px-4 py-2.5 bg-[var(--input-bg)] border border-[var(--border)] rounded-xl text-[var(--text)] outline-none focus:border-[var(--primary)] text-sm"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">Confirm New Password</label>
                <input 
                  type={showPassword ? 'text' : 'password'} 
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password" 
                  className="w-full px-4 py-2.5 bg-[var(--input-bg)] border border-[var(--border)] rounded-xl text-[var(--text)] outline-none focus:border-[var(--primary)] text-sm"
                  required
                />
              </div>

              <div className="text-[11px] text-[var(--muted)] space-y-1 pt-1">
                <div className="flex items-center gap-1.5">
                  <span className={password.length >= 8 ? 'text-[var(--success)] font-bold flex items-center gap-1' : 'text-[var(--muted)] flex items-center gap-1'}>
                    {password.length >= 8 ? (
                      <svg className="w-3.5 h-3.5 text-[var(--success)] inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    ) : (
                      <span>-</span>
                    )}
                    At least 8 characters
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={(password && /[A-Za-z]/.test(password) && /[0-9]/.test(password)) ? 'text-[var(--success)] font-bold flex items-center gap-1' : 'text-[var(--muted)] flex items-center gap-1'}>
                    {(password && /[A-Za-z]/.test(password) && /[0-9]/.test(password)) ? (
                      <svg className="w-3.5 h-3.5 text-[var(--success)] inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    ) : (
                      <span>-</span>
                    )}
                    Contains letters and numbers
                  </span>
                </div>
              </div>

              <button 
                type="submit" 
                disabled={isSubmitting || password.length < 8}
                className="w-full bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold py-3 rounded-xl shadow-lg transition-colors text-sm cursor-pointer disabled:opacity-50 mt-2"
              >
                {isSubmitting ? 'Updating Password...' : 'Set New Password'}
              </button>

              <div className="text-center pt-2">
                <Link to="/login" className="text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)] hover:underline">
                  Back to Login
                </Link>
              </div>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}
