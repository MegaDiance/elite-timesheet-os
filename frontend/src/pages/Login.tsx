import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../services/apiClient';
import { 
  Lock, 
  Mail, 
  ArrowRight, 
  KeyRound, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  ArrowLeft,
  Briefcase
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';

interface UserOrg {
  id: string;
  name: string;
  slug?: string;
  role: string;
  logo_url?: string | null;
}

export default function Login() {
  const [step, setStep] = useState<'credentials' | '2fa' | 'select_org'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Authenticated user data and organisations list
  const [authToken, setAuthToken] = useState<string>('');
  const [authUser, setAuthUser] = useState<any>(null);
  const [userOrgs, setUserOrgs] = useState<UserOrg[]>([]);
  const [selectingOrgId, setSelectingOrgId] = useState<string | null>(null);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isResetSuccess = searchParams.get('reset') === 'success';
  const isSetupSuccess = searchParams.get('setup') === 'success';
  const reasonParam = searchParams.get('reason');

  const getReasonNotice = () => {
    if (reasonParam === 'inactivity') {
      return { text: 'You were signed out due to 15 minutes of inactivity for your data protection.', variant: 'warning' };
    }
    if (reasonParam === 'deactivated') {
      return { text: 'Your account has been deactivated. Please contact your company administrator.', variant: 'danger' };
    }
    if (reasonParam === 'revoked') {
      return { text: 'Your session has ended or was revoked from another device.', variant: 'warning' };
    }
    if (reasonParam === 'logout') {
      return { text: 'You have been securely signed out.', variant: 'info' };
    }
    return null;
  };

  const reasonNotice = getReasonNotice();

  const [recentSlug, setRecentSlug] = useState<string | null>(null);
  const [recentName, setRecentName] = useState<string | null>(null);

  useEffect(() => {
    const slug = localStorage.getItem('last_org_slug');
    const name = localStorage.getItem('last_org_name');
    if (slug) {
      setRecentSlug(slug);
      setRecentName(name || slug);
    }
  }, []);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Navigate to appropriate role page once organization context is finalized
  const finalizeLoginToOrg = (token: string, orgId: string, role: string) => {
    localStorage.setItem('token', token);
    localStorage.setItem('current_org_id', orgId);
    window.dispatchEvent(new Event('auth-change'));

    if (role === 'Employee') {
      navigate('/portal');
    } else if (role === 'Platform Admin') {
      navigate('/platform');
    } else {
      navigate('/roster');
    }
  };

  // Called when credentials or 2FA are validated
  const handleAuthenticationSuccess = (token: string, user: any) => {
    setAuthToken(token);
    setAuthUser(user);
    localStorage.setItem('user', JSON.stringify(user));

    const orgs: UserOrg[] = Array.isArray(user.organisations) ? user.organisations : [];
    setUserOrgs(orgs);

    // Transition to the "Select Your Organisation" step
    setStep('select_org');
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setIsLoading(true);

    try {
      const response = await api.post('/auth/login', { 
        email: email.trim(), 
        password 
      });

      if (response.data.require_login_verification) {
        navigate(`/verify-login?email=${encodeURIComponent(response.data.email || email.trim())}`);
        return;
      }

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
        handleAuthenticationSuccess(response.data.data.token, response.data.data.user);
      } else {
        setError(response.data?.error?.message || response.data?.error || 'Invalid credentials');
      }
    } catch (err: any) {
      if (err.response?.status === 429) {
        setError(err.response.data.error?.message || 'Too many failed attempts. Try again in 15 minutes.');
      } else {
        setError(err.response?.data?.error?.message || err.response?.data?.error || 'Invalid email or password.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorCode.trim() || twoFactorCode.trim().length !== 6) {
      setError('Please enter the complete 6-digit verification code.');
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
        handleAuthenticationSuccess(response.data.data.token, response.data.data.user);
      } else {
        setError(response.data?.error?.message || 'Failed to verify authentication code.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Invalid or expired verification code.');
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

  // Called when user selects an organisation from the list
  const handleSelectOrganisation = async (org: UserOrg) => {
    setSelectingOrgId(org.id);
    setError('');

    // Save remembered org info
    localStorage.setItem('last_org_slug', org.slug || org.id);
    localStorage.setItem('last_org_name', org.name);

    try {
      // If the current token is already scoped to this organisation, enter directly
      const currentOrgId = authUser?.organisation_id;
      if (currentOrgId === org.id) {
        finalizeLoginToOrg(authToken, org.id, org.role);
        return;
      }

      // Otherwise, request a token scoped to the selected organisation
      const res = await api.post(
        '/auth/switch-organisation',
        { organisation_id: org.id },
        { headers: { Authorization: `Bearer ${authToken}` } }
      );

      if (res.data?.success && res.data?.data?.token) {
        finalizeLoginToOrg(res.data.data.token, org.id, res.data.data.user?.role || org.role);
      } else {
        // Fallback: enter with active token
        finalizeLoginToOrg(authToken, org.id, org.role);
      }
    } catch (err: any) {
      console.warn('Switch organisation error:', err);
      // Fallback
      finalizeLoginToOrg(authToken, org.id, org.role);
    } finally {
      setSelectingOrgId(null);
    }
  };

  const handleSignOutAndReset = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setAuthToken('');
    setAuthUser(null);
    setUserOrgs([]);
    setStep('credentials');
    setEmail('');
    setPassword('');
    setError('');
    setSuccessMsg('');
  };

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-[var(--bg)] text-[var(--text)]">
      <div className="sm:mx-auto sm:w-full sm:max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <Link to="/" className="inline-flex items-center gap-2 group">
            <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm group-hover:bg-indigo-500 transition-colors">
              <Clock className="w-5 h-5" />
            </div>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
            Elite Timesheet OS <span className="text-indigo-400 font-mono text-xs uppercase px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20">Pro</span>
          </h1>
          <p className="text-xs text-[var(--muted)]">
            {step === 'select_org'
              ? 'Choose your organisation to continue'
              : 'Sign in to access your organisation portal'}
          </p>
        </div>

        {/* Notices */}
        {reasonNotice && (
          <div className={`p-3 rounded-md text-xs flex items-center gap-2 border ${
            reasonNotice.variant === 'warning'
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              : reasonNotice.variant === 'danger'
              ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
              : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-300'
          }`}>
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{reasonNotice.text}</span>
          </div>
        )}

        {(isResetSuccess || isSetupSuccess) && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 p-3 rounded-md text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              {isResetSuccess
                ? 'Password reset successfully. You can now sign in with your new password.'
                : 'Account setup complete. Please sign in below.'}
            </span>
          </div>
        )}

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-500 p-3 rounded-md text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 p-3 rounded-md text-xs flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Card Container */}
        <Card className="p-8 shadow-sm">
          {/* ============================================================ */}
          {/* STEP 1: CREDENTIALS                                          */}
          {/* ============================================================ */}
          {step === 'credentials' && (
            <div className="space-y-4">
              {recentSlug && (
                <div className="p-3.5 bg-indigo-500/5 border border-indigo-500/20 rounded-lg flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                      {(recentName || recentSlug).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider">Your Workplace</div>
                      <div className="text-xs font-bold text-[var(--text)] truncate">{recentName}</div>
                    </div>
                  </div>
                  <Link to={`/login/${recentSlug}`}>
                    <Button variant="primary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                      Go to Portal
                    </Button>
                  </Link>
                </div>
              )}

              <div className="text-center pb-1">
                <Link to="/portal-access" className="text-xs text-indigo-400 hover:underline inline-flex items-center gap-1 font-medium">
                  <span>Locate your organisation portal</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              <form onSubmit={handleLoginSubmit} className="space-y-4">
              <Input
                label="Work Email Address"
                type="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoFocus
                leftIcon={<Mail className="w-4 h-4" />}
              />

              <div>
                <Input
                  label="Password"
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  leftIcon={<Lock className="w-4 h-4" />}
                />
                <div className="flex justify-end mt-1.5">
                  <Link to="/forgot-password" className="text-xs text-indigo-400 hover:underline">
                    Forgot password?
                  </Link>
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full"
                loading={isLoading}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Sign In to Continue
              </Button>
            </form>
            </div>
          )}

          {/* ============================================================ */}
          {/* STEP 2: 2FA VERIFICATION                                     */}
          {/* ============================================================ */}
          {step === '2fa' && (
            <form onSubmit={handleVerify2FASubmit} className="space-y-5">
              <div className="text-center space-y-1">
                <div className="w-10 h-10 rounded-full bg-indigo-600/10 text-indigo-400 flex items-center justify-center mx-auto">
                  <KeyRound className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-semibold text-[var(--text)]">Two-Step Verification</h3>
                <p className="text-xs text-[var(--muted)]">
                  Enter the 6-digit verification code dispatched to <strong className="text-[var(--text)]">{maskedEmail}</strong>.
                </p>
              </div>

              <Input
                type="text"
                placeholder="123456"
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                required
                autoFocus
                className="text-center text-lg tracking-widest font-mono py-2.5"
              />

              <div className="space-y-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  className="w-full"
                  loading={isLoading}
                >
                  Verify & Select Organisation
                </Button>

                <div className="flex items-center justify-between pt-2 text-xs">
                  <button
                    type="button"
                    onClick={() => { setStep('credentials'); setError(''); }}
                    className="text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
                  >
                    ← Back to credentials
                  </button>
                  <button
                    type="button"
                    onClick={handleResend2FA}
                    disabled={resendCooldown > 0 || isLoading}
                    className="text-indigo-400 hover:underline disabled:opacity-50 cursor-pointer"
                  >
                    {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend Code'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* ============================================================ */}
          {/* STEP 3: SELECT YOUR ORGANISATION                             */}
          {/* ============================================================ */}
          {step === 'select_org' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                <div>
                  <h3 className="text-sm font-bold text-[var(--text)]">Select Your Organisation</h3>
                  <p className="text-xs text-[var(--muted)]">
                    Signed in as <span className="font-semibold text-[var(--text)]">{authUser?.email}</span>
                  </p>
                </div>
                <Badge variant="purple" size="sm">
                  {userOrgs.length} {userOrgs.length === 1 ? 'Workplace' : 'Workplaces'}
                </Badge>
              </div>

              {userOrgs.length > 0 ? (
                <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
                  {userOrgs.map((org) => {
                    const isSelected = selectingOrgId === org.id;
                    return (
                      <div
                        key={org.id}
                        onClick={() => !isSelected && handleSelectOrganisation(org)}
                        className="p-4 hover:bg-[var(--hover-row)] flex items-center justify-between cursor-pointer transition-colors group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-md bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-bold text-sm">
                            {org.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-sm text-[var(--text)] group-hover:text-indigo-400 transition-colors">
                              {org.name}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant={org.role === 'Employee' ? 'default' : 'purple'} size="sm">
                                {org.role}
                              </Badge>
                              {org.slug && (
                                <span className="text-[11px] text-[var(--muted)] font-mono">
                                  @{org.slug}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <Button
                          variant="secondary"
                          size="sm"
                          loading={isSelected}
                          rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                        >
                          Enter
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-6 text-center space-y-2 border border-dashed border-[var(--border)] rounded-lg">
                  <Briefcase className="w-8 h-8 text-[var(--muted)] mx-auto" />
                  <div className="text-xs font-semibold text-[var(--text)]">No Active Workplaces Found</div>
                  <p className="text-[11px] text-[var(--muted)]">
                    Your account ({authUser?.email}) has not been assigned to any organisation yet. Please ask your administrator for an invite.
                  </p>
                </div>
              )}

              <div className="pt-2 flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={handleSignOutAndReset}
                  className="text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Sign in with different account</span>
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* Footer info */}
        <p className="text-center text-xs text-[var(--muted)]">
          Need an invitation to join your workplace? Contact your supervisor or company administrator.
        </p>
      </div>
    </div>
  );
}
