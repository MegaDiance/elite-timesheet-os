import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Lock, Mail, ShieldCheck, ArrowRight, KeyRound, AlertCircle, ArrowLeft, Loader2, Clock, Building2, Info } from 'lucide-react';
import api from '../../services/apiClient';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { ROLE_LABEL, storeSession, type Role } from '../../hooks/useAccess';

interface OrganisationBrand {
  name: string;
  logo_url: string | null;
}

interface OrganisationOption {
  id: string;
  name: string;
  role: Role;
}

type Step = 'credentials' | 'organisation' | 'code';

const GENERIC_FAILURE = 'Email or password is incorrect.';

const REASONS: Record<string, { text: string; tone: 'info' | 'warning' | 'danger' }> = {
  inactivity: { text: 'You were signed out after 15 minutes without activity.', tone: 'warning' },
  revoked: { text: 'Your session was ended from another device. Please sign in again.', tone: 'warning' },
  deactivated: { text: 'This account has been deactivated. Contact your Organisation Owner if you think this is a mistake.', tone: 'danger' },
  'access-ended': { text: 'Your access to this organisation has ended. Contact your Organisation Owner if you still need it.', tone: 'danger' },
  logout: { text: 'You have signed out.', tone: 'info' },
  'password-reset': { text: 'Your password has been changed. Sign in with your new password.', tone: 'info' },
};

const toneClasses = {
  info: 'bg-[var(--primary-light)] border-[var(--primary)]/25 text-[var(--text)]',
  warning: 'bg-[var(--warn-light)] border-[var(--warn)]/25 text-[var(--text)]',
  danger: 'bg-[var(--danger-light)] border-[var(--danger)]/25 text-[var(--danger)]',
};

/**
 * Sign-in page for `/login/:slug` (an organisation's private sign-in link) and `/login`
 * (email and password only; the account's organisations decide where it signs in).
 */
export const OrgLogin: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reason = REASONS[searchParams.get('reason') || ''];

  // Organisation named by the private sign-in link
  const [brand, setBrand] = useState<OrganisationBrand | null>(null);
  const [lookupState, setLookupState] = useState<'loading' | 'ready' | 'invalid'>(slug ? 'loading' : 'ready');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>('credentials');
  const [organisations, setOrganisations] = useState<OrganisationOption[]>([]);
  const [tempToken, setTempToken] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setBrand(null);
      setLookupState('ready');
      return;
    }
    let cancelled = false;
    setLookupState('loading');
    api.get(`/organisation/lookup/${encodeURIComponent(slug)}`)
      .then(res => {
        if (cancelled) return;
        setBrand(res.data.data);
        setLookupState('ready');
      })
      .catch(err => {
        if (cancelled) return;
        // Only a 404 means the link is wrong; otherwise show the form without the organisation's name.
        if (err?.response?.status === 404) {
          setLookupState('invalid');
        } else {
          setBrand(null);
          setLookupState('ready');
        }
      });
    return () => { cancelled = true; };
  }, [slug]);

  const failureMessage = (err: any): string => {
    const status = err?.response?.status;
    if (status === 429 || status === 503) {
      return err.response.data?.error?.message || 'Sign-in is unavailable right now. Please try again in a few minutes.';
    }
    if (!err?.response) return 'We couldn’t reach SimpleHours. Check your connection and try again.';
    return GENERIC_FAILURE;
  };

  /** Handles every sign-in response shape from /auth/login and /auth/verify-2fa. */
  const handleSignInResponse = (body: any) => {
    if (body?.require_organisation_selection) {
      setOrganisations(Array.isArray(body.organisations) ? body.organisations : []);
      setStep('organisation');
      return;
    }
    if (body?.require_login_verification) {
      navigate(`/verify-login?challenge=${encodeURIComponent(body.challenge_id || '')}`);
      return;
    }
    if (body?.require_2fa) {
      setTempToken(body.temp_token || '');
      setMaskedEmail(body.masked_email || '');
      setCode('');
      setStep('code');
      return;
    }
    if (body?.data?.token) {
      storeSession(body.data.token);
      navigate('/dashboard', { replace: true });
      return;
    }
    setError(GENERIC_FAILURE);
  };

  const signIn = async (organisationId?: string) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const payload: Record<string, string> = { email: email.trim(), password };
      if (slug) payload.organisation_slug = slug;
      else if (organisationId) payload.organisation_id = organisationId;
      const res = await api.post('/auth/login', payload);
      handleSignInResponse(res.data);
    } catch (err: any) {
      setError(failureMessage(err));
      if (organisationId) setStep('credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleCredentialsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    void signIn();
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post('/auth/verify-2fa', { temp_token: tempToken, code });
      handleSignInResponse(res.data);
    } catch (err: any) {
      if (err?.response?.status === 401) {
        setStep('credentials');
        setPassword('');
      }
      setError(err?.response?.data?.error?.message || 'That code didn’t work. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post('/auth/resend-2fa', { temp_token: tempToken });
      setNotice(res.data?.message || 'A new code has been sent to your email.');
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'We couldn’t send a new code. Please sign in again.');
    } finally {
      setResending(false);
    }
  };

  const backToCredentials = () => {
    setStep('credentials');
    setError(null);
    setNotice(null);
    setCode('');
  };

  if (lookupState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <div className="flex flex-col items-center gap-3 text-[var(--muted)]">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--primary)]" />
          <p className="text-xs font-medium">Loading sign-in page…</p>
        </div>
      </div>
    );
  }

  if (lookupState === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)]">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-[var(--danger-light)] text-[var(--danger)] flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-[var(--text)]">This sign-in link isn't valid</h1>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            Check the link you were given, or sign in with your email and password instead.
          </p>
          <Link to="/login" className="block pt-2">
            <Button variant="primary" size="md" className="w-full">Go to sign in</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const title = brand ? brand.name : 'Sign in to SimpleHours';

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-[var(--bg)] text-[var(--text)]">
      <div className="sm:mx-auto sm:w-full sm:max-w-md space-y-6">
        <div className="text-center space-y-2">
          <Link to="/" className="inline-flex" aria-label="SimpleHours home">
            <div className="w-12 h-12 rounded-xl bg-[var(--primary)] flex items-center justify-center text-white font-bold text-xl shadow-xs mx-auto overflow-hidden">
              {brand?.logo_url ? (
                <img src={brand.logo_url} alt="" className="w-full h-full object-cover" />
              ) : brand ? (
                brand.name.charAt(0).toUpperCase()
              ) : (
                <Clock className="w-6 h-6" />
              )}
            </div>
          </Link>
          {brand && (
            <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--primary)]">SimpleHours</div>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">{title}</h1>
          <p className="text-xs text-[var(--muted)]">
            {brand ? 'Sign in to manage rosters, timesheets and reports' : 'For Organisation Owners and Branch Admins'}
          </p>
        </div>

        <Card className="p-8 space-y-5">
          {reason && step === 'credentials' && (
            <div className={`p-3 rounded-md text-xs flex items-start gap-2 border ${toneClasses[reason.tone]}`}>
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{reason.text}</span>
            </div>
          )}

          {error && (
            <div role="alert" className="p-3 rounded-md bg-[var(--danger-light)] border border-[var(--danger)]/25 text-xs text-[var(--danger)] flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {notice && (
            <div className="p-3 rounded-md bg-[var(--success-light)] border border-[var(--success)]/25 text-xs text-[var(--success)] flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{notice}</span>
            </div>
          )}

          {step === 'credentials' && (
            <form onSubmit={handleCredentialsSubmit} className="space-y-4" noValidate>
              <Input
                label="Email"
                type="email"
                autoComplete="username"
                placeholder="you@example.com.au"
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
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  leftIcon={<Lock className="w-4 h-4" />}
                />
                <div className="flex justify-end mt-1.5">
                  <Link to="/forgot-password" className="text-xs text-[var(--primary)] hover:underline">
                    Forgot password?
                  </Link>
                </div>
              </div>
              <Button type="submit" variant="primary" size="md" className="w-full" loading={loading} rightIcon={<ArrowRight className="w-4 h-4" />}>
                Sign in
              </Button>
            </form>
          )}

          {step === 'organisation' && (
            <div className="space-y-4">
              <div className="text-center space-y-1">
                <h2 className="text-sm font-bold text-[var(--text)]">Choose an organisation</h2>
                <p className="text-xs text-[var(--muted)]">Your account has access to more than one organisation.</p>
              </div>
              <div className="space-y-2">
                {organisations.map(org => (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => void signIn(org.id)}
                    disabled={loading}
                    className="w-full p-3.5 rounded-xl border border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--panel-subtle)] text-left transition-colors flex items-center justify-between gap-3 disabled:opacity-60"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Building2 className="w-4 h-4 text-[var(--primary)] shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[var(--text)] truncate">{org.name}</div>
                        <div className="text-[11px] text-[var(--muted)]">{ROLE_LABEL[org.role] ?? ''}</div>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-[var(--muted)] shrink-0" />
                  </button>
                ))}
              </div>
              <button type="button" onClick={backToCredentials} className="text-xs text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
            </div>
          )}

          {step === 'code' && (
            <form onSubmit={handleCodeSubmit} className="space-y-5">
              <div className="text-center space-y-1">
                <div className="w-10 h-10 rounded-full bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center mx-auto">
                  <KeyRound className="w-5 h-5" />
                </div>
                <h2 className="text-sm font-semibold text-[var(--text)]">Two-step verification</h2>
                <p className="text-xs text-[var(--muted)]">
                  Enter the 6-digit code we emailed{maskedEmail ? ` to ${maskedEmail}` : ''}.
                </p>
              </div>

              <Input
                aria-label="Verification code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                required
                autoFocus
                className="text-center text-lg tracking-widest font-mono py-2.5"
              />

              <Button type="submit" variant="primary" size="md" className="w-full" loading={loading}>
                Verify and sign in
              </Button>

              <div className="flex items-center justify-between text-xs">
                <button type="button" onClick={backToCredentials} className="text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>
                <button type="button" onClick={handleResend} disabled={resending} className="text-[var(--primary)] hover:underline disabled:opacity-50">
                  {resending ? 'Sending…' : 'Send a new code'}
                </button>
              </div>
            </form>
          )}
        </Card>

        <p className="text-center text-xs text-[var(--muted)]">
          New to SimpleHours?{' '}
          <Link to="/signup" className="font-semibold text-[var(--primary)] hover:underline">
            Set up a new organisation
          </Link>
        </p>
      </div>
    </div>
  );
};
