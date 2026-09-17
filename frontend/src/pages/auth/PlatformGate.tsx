import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { 
  Terminal, 
  ShieldAlert, 
  KeyRound, 
  Lock, 
  ArrowRight, 
  AlertTriangle, 
  ArrowLeft, 
  RefreshCw, 
  Cpu, 
  CheckCircle2,
  Mail
} from 'lucide-react';
import api from '../../services/apiClient';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

export default function PlatformGate() {
  const [step, setStep] = useState<'credentials' | '2fa'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [error, setError] = useState('');
  const [forbiddenError, setForbiddenError] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const navigate = useNavigate();

  // Escape key returns to public portal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        navigate('/portal-access');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setForbiddenError(false);
    setSuccessMsg('');
    setIsLoading(true);

    try {
      const response = await api.post('/auth/platform-login', {
        email: email.trim(),
        password
      });

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
        const { token, user } = response.data.data;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        if (user.organisation_id) {
          localStorage.setItem('current_org_id', user.organisation_id);
        }
        window.dispatchEvent(new Event('auth-change'));
        navigate('/platform');
      } else {
        setError(response.data?.error?.message || 'Administrative verification failed.');
      }
    } catch (err: any) {
      if (err.response?.status === 403) {
        setForbiddenError(true);
        setError(err.response?.data?.error?.message || 'Access Denied: Account does not possess Platform Administrator clearance.');
      } else if (err.response?.status === 429) {
        setError('Too many failed attempts. Console locked for 15 minutes.');
      } else {
        setError(err.response?.data?.error?.message || 'Invalid administrative credentials.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorCode.trim()) {
      setError('Please input the 6-digit verification code.');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const response = await api.post('/auth/verify-2fa', {
        temp_token: tempToken,
        code: twoFactorCode.trim()
      });

      if (response.data.success && response.data.data?.token) {
        const { token, user } = response.data.data;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        if (user.organisation_id) {
          localStorage.setItem('current_org_id', user.organisation_id);
        }
        window.dispatchEvent(new Event('auth-change'));
        navigate('/platform');
      } else {
        setError(response.data?.error?.message || 'Invalid code.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Two-step verification failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#070b14] text-slate-100 p-4 font-sans selection:bg-indigo-500/30 selection:text-indigo-300">
      {/* Background terminal grid effect */}
      <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:20px_20px] opacity-20 pointer-events-none" />

      {/* Center Console Container */}
      <div className="w-full max-w-md relative z-10">
        {/* Terminal Header Badge */}
        <div className="flex items-center justify-between px-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
            <span className="text-[11px] font-mono text-slate-500 ml-1">platform.root.session</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>RESTRICTED GATEWAY</span>
          </div>
        </div>

        {/* Main Card */}
        <Card className="bg-[#0f172a]/95 border-slate-800 shadow-2xl p-6 sm:p-8 backdrop-blur-xl">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-indigo-950/60 border border-indigo-700/50 flex items-center justify-center text-indigo-400 mx-auto mb-3 shadow-inner">
              <Terminal className="w-6 h-6" />
            </div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center justify-center gap-2">
              <span>Platform Infrastructure Console</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              Root clearance level required.
            </p>
          </div>

          {/* Security Alert / Error Box */}
          {error && (
            <div className={`mb-5 p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
              forbiddenError 
                ? 'bg-red-950/40 border-red-800/60 text-red-300' 
                : 'bg-amber-950/40 border-amber-800/60 text-amber-300'
            }`}>
              {forbiddenError ? (
                <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <span className="font-semibold block mb-0.5">
                  {forbiddenError ? 'SECURITY CLEARANCE DENIED' : 'AUTHENTICATION FAILED'}
                </span>
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Success Notice */}
          {successMsg && (
            <div className="mb-5 p-3 rounded-lg bg-indigo-950/40 border border-indigo-800/60 text-indigo-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-indigo-400" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* STEP 1: CREDENTIALS */}
          {step === 'credentials' && (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-mono font-medium text-slate-300 mb-1.5">
                  Platform Admin Email
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@platform.internal"
                    className="w-full bg-slate-900 text-white placeholder-slate-600 text-xs rounded-lg pl-9 pr-3 py-2.5 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono font-medium text-slate-300 mb-1.5">
                  Master Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••••••"
                    className="w-full bg-slate-900 text-white placeholder-slate-600 text-xs rounded-lg pl-9 pr-3 py-2.5 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono py-2.5 shadow-md flex items-center justify-center gap-2"
                  disabled={isLoading || !email.trim() || !password}
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Verifying Security Clearance...</span>
                    </>
                  ) : (
                    <>
                      <span>Authenticate Session</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}

          {/* STEP 2: TWO-FACTOR AUTHENTICATION */}
          {step === '2fa' && (
            <form onSubmit={handleVerify2FASubmit} className="space-y-4">
              <div className="text-center p-3 rounded-lg bg-slate-900 border border-slate-800 mb-4">
                <KeyRound className="w-6 h-6 text-indigo-400 mx-auto mb-1.5" />
                <h3 className="text-xs font-semibold text-white">Multi-Factor Challenge</h3>
                <p className="text-[11px] text-slate-400 mt-1">
                  A single-use verification code was dispatched to <strong className="text-slate-200 font-mono">{maskedEmail}</strong>
                </p>
              </div>

              <div>
                <label className="block text-xs font-mono font-medium text-slate-300 mb-1.5 text-center">
                  Enter 6-Digit OTP Code
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="000000"
                  className="w-full bg-slate-900 text-center text-xl tracking-[0.5em] font-mono text-white placeholder-slate-600 rounded-lg py-3 border border-slate-800 focus:border-indigo-500 focus:outline-none"
                  autoFocus
                />
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono py-2.5 shadow-md"
                  disabled={isLoading || twoFactorCode.length < 6}
                >
                  {isLoading ? 'Confirming Clearance...' : 'Validate & Unlock Console'}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800/50 text-xs font-mono"
                  onClick={() => {
                    setStep('credentials');
                    setError('');
                  }}
                >
                  Back to Credentials
                </Button>
              </div>
            </form>
          )}

          {/* Security Disclaimer */}
          <div className="mt-6 pt-4 border-t border-slate-800/80 text-[11px] text-slate-500 font-mono text-center flex items-center justify-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-slate-600" />
            <span>Audit Trail Active • AES-256 GCM</span>
          </div>
        </Card>

        {/* Escape / Return Link */}
        <div className="mt-4 text-center">
          <Link
            to="/portal-access"
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors font-mono"
          >
            <ArrowLeft className="w-3 h-3" />
            <span>Return to Workplace Portal (Esc)</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
