import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { 
  Lock, 
  Mail, 
  ShieldCheck, 
  ArrowRight, 
  KeyRound, 
  AlertCircle, 
  ArrowLeft,
  Loader2
} from 'lucide-react';
import api from '../../services/apiClient';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

interface OrgMetadata {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
}

export const OrgLogin: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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

  // Org lookup state
  const [org, setOrg] = useState<OrgMetadata | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [orgNotFound, setOrgNotFound] = useState(false);

  // Form credentials
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 2FA state
  const [is2FA, setIs2FA] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  // Fetch tenant info by slug
  useEffect(() => {
    if (!slug) {
      setOrgNotFound(true);
      setOrgLoading(false);
      return;
    }

    const fetchOrg = async () => {
      setOrgLoading(true);
      try {
        const res = await api.get(`/organisation/lookup/${encodeURIComponent(slug)}`);
        if (res.data?.success && res.data?.data) {
          setOrg(res.data.data);
          localStorage.setItem('last_org_slug', res.data.data.slug);
          localStorage.setItem('last_org_name', res.data.data.name);
        } else {
          setOrgNotFound(true);
        }
      } catch (err: any) {
        console.error('Org lookup error:', err);
        setOrgNotFound(true);
      } finally {
        setOrgLoading(false);
      }
    };

    fetchOrg();
  }, [slug]);

  // Handle successful session storage & role-based redirect
  const handleAuthSuccess = (token: string, user: any) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    
    // Save current active organization context
    if (user.organisation_id) {
      localStorage.setItem('current_org_id', user.organisation_id);
    }
    window.dispatchEvent(new Event('auth-change'));

    const role = user.role;
    if (role === 'Employee') {
      navigate('/portal');
    } else if (role === 'Platform Admin') {
      navigate('/platform');
    } else {
      navigate('/roster');
    }
  };

  // Submit initial email/password
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please provide both email and password.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.post('/auth/login', { 
        email: email.trim(), 
        password,
        organisation_slug: slug
      });

      if (res.data?.require_login_verification) {
        navigate(`/verify-login?email=${encodeURIComponent(res.data.email || email.trim())}`);
        return;
      }

      if (res.data?.success) {
        if (res.data.require_2fa) {
          setIs2FA(true);
          setTempToken(res.data.temp_token);
        } else {
          handleAuthSuccess(res.data.data.token, res.data.data.user);
        }
      } else {
        setError(res.data?.error?.message || res.data?.error || 'Invalid email or password.');
      }
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.error || err.response?.data?.message || 'Login failed. Please check credentials.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Submit 2FA verification code
  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorCode || twoFactorCode.trim().length !== 6) {
      setError('Please enter the complete 6-digit verification code.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.post('/auth/verify-2fa', {
        temp_token: tempToken,
        code: twoFactorCode.trim()
      });

      if (res.data?.success) {
        handleAuthSuccess(res.data.data.token, res.data.data.user);
      } else {
        setError(res.data?.error?.message || 'Verification failed. Please try again.');
      }
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.message || 'Verification failed. Code may be invalid or expired.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Resend 2FA code
  const handleResend2FA = async () => {
    if (!tempToken) return;
    setResendLoading(true);
    setResendNotice(null);
    setError(null);

    try {
      const res = await api.post('/auth/resend-2fa', { temp_token: tempToken });
      if (res.data?.success) {
        setResendNotice('A fresh verification code was sent to your email.');
      } else {
        setError(res.data?.error?.message || 'Failed to dispatch code.');
      }
    } catch (err: any) {
      setError('Could not resend verification code. Please sign in again.');
    } finally {
      setResendLoading(false);
    }
  };

  if (orgLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <div className="flex flex-col items-center gap-3 text-[var(--muted)]">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
          <p className="text-xs font-medium">Resolving organization portal...</p>
        </div>
      </div>
    );
  }

  if (orgNotFound) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)]">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-[var(--text)]">Workplace Not Found</h2>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            No organisation was found matching the identifier <code className="font-mono text-indigo-400">@{slug}</code>. The workplace may have been renamed or unlisted.
          </p>
          <div className="pt-2 flex flex-col gap-2">
            <Link to="/portal-access">
              <Button variant="primary" size="md" className="w-full">
                Go to Workplace Portal
              </Button>
            </Link>
            <Link to="/">
              <Button variant="ghost" size="md" className="w-full">
                Back to Overview
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-[var(--bg)]">
      <div className="sm:mx-auto sm:w-full sm:max-w-md space-y-6">
        {/* Back Link */}
        <div className="flex items-center justify-between">
          <Link 
            to="/portal-access" 
            className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Switch Workplace / Different Portal</span>
          </Link>
          <Badge variant="purple" size="sm">@{org?.slug}</Badge>
        </div>

        {/* Branded Header */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center text-white font-bold text-xl shadow-md mx-auto">
            {org?.logo_url ? (
              <img src={org.logo_url} alt={org.name} className="w-full h-full object-cover rounded-2xl" />
            ) : (
              (org?.name || 'T').charAt(0).toUpperCase()
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
            {org?.name}
          </h1>
          <p className="text-xs text-[var(--muted)]">
            Timesheet & Workforce Management Portal
          </p>
        </div>

        {/* Login Card */}
        <Card className="p-8 space-y-6">
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

          {error && (
            <div className="p-3 rounded-md bg-rose-500/10 border border-rose-500/20 text-xs text-rose-500 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {resendNotice && (
            <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-500 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{resendNotice}</span>
            </div>
          )}

          {!is2FA ? (
            /* Step 1: Standard Credentials Form */
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <Input
                label="Work Email Address"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                leftIcon={<Mail className="w-4 h-4" />}
              />

              <div>
                <Input
                  label="Password"
                  type="password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
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
                loading={loading}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Sign In to {org?.name}
              </Button>
            </form>
          ) : (
            /* Step 2: 2FA Verification Form */
            <form onSubmit={handle2FASubmit} className="space-y-5">
              <div className="text-center space-y-1">
                <div className="w-10 h-10 rounded-full bg-indigo-600/10 text-indigo-400 flex items-center justify-center mx-auto">
                  <KeyRound className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-semibold text-[var(--text)]">Two-Factor Authentication</h3>
                <p className="text-xs text-[var(--muted)]">
                  Enter the 6-digit code sent to your email.
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
                  loading={loading}
                >
                  Verify & Enter Workspace
                </Button>

                <div className="flex items-center justify-between pt-2 text-xs">
                  <button
                    type="button"
                    onClick={() => { setIs2FA(false); setError(null); }}
                    className="text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    ← Back to credentials
                  </button>
                  <button
                    type="button"
                    onClick={handleResend2FA}
                    disabled={resendLoading}
                    className="text-indigo-400 hover:underline disabled:opacity-50"
                  >
                    {resendLoading ? 'Sending...' : 'Resend Code'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Tenant Isolation Info */}
          <div className="pt-4 border-t border-[var(--border)] flex items-center justify-center gap-1.5 text-[11px] text-[var(--muted)]">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>End-to-end encrypted tenant session</span>
          </div>
        </Card>

        {/* Security Help notice */}
        <p className="text-center text-xs text-[var(--muted)]">
          Need access assistance? Contact your workplace supervisor or administrator.
        </p>
      </div>
    </div>
  );
};
