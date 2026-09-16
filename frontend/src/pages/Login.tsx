import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/apiClient';
import { jwtDecode } from 'jwt-decode';

export default function Login() {
  const [step, setStep] = useState<'credentials' | '2fa'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isResetSuccess = searchParams.get('reset') === 'success';
  const isSetupSuccess = searchParams.get('setup') === 'success';

  // Cooldown countdown timer for resend
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleAuthSuccess = (token: string) => {
    localStorage.setItem('token', token);
    window.dispatchEvent(new Event('auth-change'));
    try {
      const decoded: any = jwtDecode(token);
      if (decoded.role === 'Platform Admin') {
        navigate('/platform');
        return;
      }
    } catch {
      // fallback
    }
    navigate('/');
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setIsLoading(true);

    try {
      const response = await api.post('/auth/login', { email, password });
      
      if (response.data.require_2fa) {
        setTempToken(response.data.temp_token);
        setMaskedEmail(response.data.masked_email || email);
        if (response.data.delivery_notice) {
          setSuccessMsg(response.data.delivery_notice);
        }
        setStep('2fa');
        setTwoFactorCode('');
        setResendCooldown(60);
        return;
      }

      if (response.data.success && response.data.data?.token) {
        handleAuthSuccess(response.data.data.token);
      }
    } catch (err: any) {
      if (err.response?.status === 429) {
        setError(err.response.data.error?.message || 'Too many failed attempts. Try again in 15 minutes.');
      } else {
        setError(err.response?.data?.error || 'Invalid credentials');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorCode.trim()) {
      setError('Please enter the 6-digit verification code.');
      return;
    }

    setError('');
    setSuccessMsg('');
    setIsLoading(true);

    try {
      const response = await api.post('/auth/verify-2fa', {
        temp_token: tempToken,
        code: twoFactorCode.trim()
      });

      if (response.data.success && response.data.data?.token) {
        handleAuthSuccess(response.data.data.token);
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to verify authentication code.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend2FA = async () => {
    if (resendCooldown > 0 || isLoading) return;
    setError('');
    setSuccessMsg('');
    setIsLoading(true);

    try {
      const response = await api.post('/auth/resend-2fa', { temp_token: tempToken });
      setSuccessMsg(response.data.delivery_notice || response.data.message || 'Fresh verification code dispatched to your email.');
      setResendCooldown(60);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to resend code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--bg)] text-[var(--text)] font-['Inter',sans-serif] p-4">
      <div className="w-full max-w-md p-8 bg-[var(--panel)] rounded-2xl border border-[var(--border)] shadow-2xl">
        
        {step === 'credentials' ? (
          <>
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-[var(--primary-light)] text-[var(--primary)] rounded-2xl mb-4 border border-[var(--primary)]/20">
                <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                </svg>
              </div>
              <h1 className="text-2xl font-black tracking-tight text-[var(--text)] flex items-center justify-center gap-2">
                Elite Timesheet OS <span className="text-[var(--primary)]">Pro</span>
              </h1>
              <p className="text-xs font-medium text-[var(--muted)] mt-2">Sign in to your business account</p>
            </div>

            {(isResetSuccess || isSetupSuccess) && (
              <div className="mb-6 bg-[var(--success-light)] text-[var(--success)] border border-[var(--success)]/20 p-4 rounded-xl text-center text-sm font-medium">
                {isResetSuccess ? 'Password reset successfully. You can now sign in.' : 'Account setup complete. You can now sign in.'}
              </div>
            )}

            <form onSubmit={handleLoginSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">Email Address</label>
                <input 
                  type="email" 
                  required 
                  placeholder="admin@elite.local"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="username"
                  className="w-full px-4 py-3 bg-[var(--input-bg)] border border-[var(--border)] rounded-xl focus:ring-2 focus:ring-[var(--primary)] focus:border-[var(--primary)] text-[var(--text)] outline-none transition-all placeholder:text-[var(--muted)] text-sm"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">Password</label>
                  <div className="flex items-center gap-3">
                    <button 
                      type="button" 
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-xs font-semibold text-[var(--primary)] hover:underline focus:outline-none"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                    <a 
                      href="/forgot-password"
                      className="text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)] hover:underline"
                    >
                      Forgot?
                    </a>
                  </div>
                </div>
                <input 
                  type={showPassword ? 'text' : 'password'} 
                  required 
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full px-4 py-3 bg-[var(--input-bg)] border border-[var(--border)] rounded-xl focus:ring-2 focus:ring-[var(--primary)] focus:border-[var(--primary)] text-[var(--text)] outline-none transition-all placeholder:text-[var(--muted)] text-sm"
                />
              </div>

              {error && (
                <div className="bg-[var(--danger-light)] border border-[var(--danger)]/20 text-[var(--danger)] p-3 rounded-xl text-sm font-semibold">
                  {error}
                </div>
              )}

              <button 
                type="submit" 
                disabled={isLoading}
                className="w-full bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold py-3 px-4 rounded-xl transition-all shadow-lg shadow-[var(--primary-light)] disabled:opacity-50 text-sm cursor-pointer mt-2"
              >
                {isLoading ? 'Verifying...' : 'Sign In'}
              </button>
            </form>
          </>
        ) : (
          /* Step 2: Two-Step Verification Screen */
          <div>
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-indigo-500/10 text-indigo-400 rounded-2xl mb-4 border border-indigo-500/20">
                <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                  <path d="m9 12 2 2 4-4"></path>
                </svg>
              </div>
              <div className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-500/10 text-indigo-400 mb-2">
                2-Step Verification
              </div>
              <h2 className="text-xl font-black tracking-tight text-[var(--text)]">
                Check Your Email
              </h2>
              <p className="text-xs text-[var(--muted)] mt-2 leading-relaxed">
                We sent a 6-digit verification code to <strong className="text-[var(--text)] font-semibold">{maskedEmail}</strong>. Enter it below to complete sign in.
              </p>
            </div>

            {error && (
              <div className="mb-4 bg-[var(--danger-light)] border border-[var(--danger)]/20 text-[var(--danger)] p-3 rounded-xl text-sm font-semibold">
                {error}
              </div>
            )}

            {successMsg && (
              <div className="mb-4 bg-[var(--success-light)] border border-[var(--success)]/20 text-[var(--success)] p-3 rounded-xl text-sm font-semibold">
                {successMsg}
              </div>
            )}

            <form onSubmit={handleVerify2FASubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider block text-center">
                  6-Digit Verification Code
                </label>
                <input 
                  type="text" 
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoFocus
                  required 
                  placeholder="123456"
                  value={twoFactorCode}
                  onChange={e => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full text-center text-2xl font-mono font-bold tracking-[0.4em] py-3 bg-[var(--input-bg)] border border-[var(--border)] rounded-xl focus:ring-2 focus:ring-[var(--primary)] focus:border-[var(--primary)] text-[var(--text)] outline-none transition-all placeholder:text-[var(--muted)]/40"
                />
              </div>

              <button 
                type="submit" 
                disabled={isLoading || twoFactorCode.length < 6}
                className="w-full bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold py-3 px-4 rounded-xl transition-all shadow-lg shadow-[var(--primary-light)] disabled:opacity-50 text-sm cursor-pointer"
              >
                {isLoading ? 'Verifying Code...' : 'Verify & Continue'}
              </button>

              <div className="flex items-center justify-between text-xs pt-2">
                <button
                  type="button"
                  disabled={resendCooldown > 0 || isLoading}
                  onClick={handleResend2FA}
                  className="font-semibold text-[var(--primary)] hover:underline disabled:opacity-50 disabled:no-underline cursor-pointer"
                >
                  {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStep('credentials');
                    setError('');
                    setSuccessMsg('');
                    setTwoFactorCode('');
                  }}
                  className="font-semibold text-[var(--muted)] hover:text-[var(--text)] hover:underline cursor-pointer"
                >
                  Use a different email
                </button>
              </div>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}
