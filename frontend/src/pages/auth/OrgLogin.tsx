import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Lock, Mail, ShieldCheck, ArrowRight, KeyRound, AlertCircle, ArrowLeft, Loader2, Info } from 'lucide-react';
import api from '../../services/apiClient';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { storeSession } from '../../hooks/useAccess';
import { friendlyError } from '../../services/errors';

interface OrganisationBrand {
  name: string;
}

type Step = 'credentials' | 'code';

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
 * Sign-in page for `/login/:slug`, an organisation's own sign-in link — the only sign-in page
 * SimpleHours has. The link names the organisation; the server still checks that the account
 * belongs to it, exactly as for any other request. There is no organisation picker and no
 * slug-less mode (`/login` itself is a "page not found").
 */
export const OrgLogin: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reason = REASONS[searchParams.get('reason') || ''];

  // Organisation named by the private sign-in link
  const [brand, setBrand] = useState<OrganisationBrand | null>(null);
  const [lookupState, setLookupState] = useState<'loading' | 'ready' | 'invalid' | 'expired' | 'unavailable'>('loading');
  const [lookupAttempt, setLookupAttempt] = useState(0);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>('credentials');
  const [tempToken, setTempToken] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setLookupState('invalid');
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
        // The form is only ever shown for a link the server has confirmed. Anything else — wrong,
        // expired, rate-limited or unreachable — shows a message instead of a sign-in form.
        const status = err?.response?.status;
        setBrand(null);
        setLookupState(status === 404 ? 'invalid' : status === 410 ? 'expired' : 'unavailable');
      });
    return () => { cancelled = true; };
  }, [slug, lookupAttempt]);

  const failureMessage = (err: any): string => {
    const status = err?.response?.status;
    if (status === 429 || status === 503) {
      return friendlyError(err, 'Sign-in is unavailable right now. Please try again in a few minutes.');
    }
    if (!err?.response) return 'We couldn’t reach SimpleHours. Check your connection and try again.';
    return GENERIC_FAILURE;
  };

  /** Handles every sign-in response shape from /auth/login and /auth/verify-2fa. */
  const handleSignInResponse = (body: any) => {
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
      storeSession(body.data.token, body.data.portal_path);
      // /app sends each role to its own home (employees to their schedule, managers to the dashboard).
      navigate('/app', { replace: true });
      return;
    }
    setError(GENERIC_FAILURE);
  };

  const signIn = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post('/auth/login', { email: email.trim(), password, organisation_slug: slug });
      handleSignInResponse(res.data);
    } catch (err: any) {
      setError(failureMessage(err));
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
      setError(friendlyError(err, 'That code didn’t work. Please try again.'));
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
      setError(friendlyError(err, 'We couldn’t send a new code. Please sign in again.'));
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
          <Loader2 className="w-6 h-6 animate-spin text-[var(--primary-text)]" />
          <p className="text-xs font-medium">Loading sign-in page…</p>
        </div>
      </div>
    );
  }

  if (lookupState !== 'ready') {
    const copy = {
      invalid: {
        title: 'This sign-in link isn’t valid',
        body: 'Check that you copied the whole link. If it still doesn’t work, ask your manager for your organisation’s sign-in link.',
      },
      expired: {
        title: 'This sign-in link has expired',
        body: 'Your organisation has replaced this link. Ask your manager for the new sign-in link.',
      },
      unavailable: {
        title: 'We couldn’t check this sign-in link',
        body: 'This is usually a connection problem, or too many attempts in a short time. Wait a moment, then try again.',
      },
    }[lookupState];
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)]">
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-[var(--danger-light)] text-[var(--danger)] flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold text-[var(--text)]">{copy.title}</h1>
          <p className="text-sm text-[var(--muted)] leading-relaxed">{copy.body}</p>
          {lookupState === 'unavailable' ? (
            <Button variant="primary" size="md" className="w-full" onClick={() => setLookupAttempt(n => n + 1)}>Try again</Button>
          ) : (
            <Link to="/" className="block pt-2">
              <Button variant="secondary" size="md" className="w-full">Go to the SimpleHours home page</Button>
            </Link>
          )}
        </Card>
      </div>
    );
  }

  const title = brand?.name || 'Sign in';

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-[var(--bg)] text-[var(--text)]">
      <div className="sm:mx-auto sm:w-full sm:max-w-md space-y-6">
        <div className="text-center space-y-2">
          <Link to="/" className="inline-flex" aria-label="SimpleHours home">
            <div className="w-12 h-12 rounded-xl bg-[var(--primary)] flex items-center justify-center text-white font-bold text-xl shadow-xs mx-auto overflow-hidden">
              {(brand?.name || 'S').charAt(0).toUpperCase()}
            </div>
          </Link>
          <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--primary-text)]">SimpleHours</div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">{title}</h1>
          <p className="text-xs text-[var(--muted)]">
            Sign in to your rosters, timesheets and schedule
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
                  <Link to={`/forgot-password?org=${encodeURIComponent(slug || '')}`} className="text-xs text-[var(--primary-text)] hover:underline">
                    Forgot password?
                  </Link>
                </div>
              </div>
              <Button type="submit" variant="primary" size="md" className="w-full" loading={loading} rightIcon={<ArrowRight className="w-4 h-4" />}>
                Sign in
              </Button>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={handleCodeSubmit} className="space-y-5">
              <div className="text-center space-y-1">
                <div className="w-10 h-10 rounded-full bg-[var(--primary-light)] text-[var(--primary-text)] flex items-center justify-center mx-auto">
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
                <button type="button" onClick={handleResend} disabled={resending} className="text-[var(--primary-text)] hover:underline disabled:opacity-50">
                  {resending ? 'Sending…' : 'Send a new code'}
                </button>
              </div>
            </form>
          )}
        </Card>

        <p className="text-center text-xs text-[var(--muted)]">
          New to SimpleHours?{' '}
          <Link to="/signup" className="font-semibold text-[var(--primary-text)] hover:underline">
            Set up a new organisation
          </Link>
        </p>
      </div>
    </div>
  );
};
