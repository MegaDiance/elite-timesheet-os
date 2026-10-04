import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Building2, Check, Copy, Eye, EyeOff, KeyRound, Lock, Mail, MailCheck } from 'lucide-react';
import api from '../../services/apiClient';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { emailError, recoveryFailureMessage, validateRecovery, type RecoveryErrors } from '../../utils/recoveryForm';

interface FoundOrganisation {
  name: string;
  login_path: string | null;
  expires_at: string | null;
  replaced: boolean;
}

/**
 * "I've lost my company's login link" — for anyone with an account. This is not a sign-in page:
 * the email and password only prove whose links to show, and no session is created. The result is
 * held in memory only (never in the address bar, storage or history), so reloading starts over.
 * While email is on there is also an "email it to me" option that needs no password.
 */
export default function RecoverLoginLink() {
  const [mode, setMode] = useState<'password' | 'email'>('password');
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<RecoveryErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [found, setFound] = useState<FoundOrganisation[] | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  // Not something a search engine should list.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.get('/recovery/options')
      .then(res => { if (!cancelled) setEmailEnabled(res.data?.data?.email_enabled === true); })
      .catch(() => undefined); // without it the page still works: the password option needs no email
    return () => { cancelled = true; };
  }, []);

  const switchMode = (next: 'password' | 'email') => {
    setMode(next);
    setErrors({});
    setFailure(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const problems: RecoveryErrors = mode === 'password' ? validateRecovery({ email, password }) : { email: emailError(email) };
    if (!problems.email) delete problems.email;
    setErrors(problems);
    setFailure(null);
    if (Object.keys(problems).length > 0) return;

    setLoading(true);
    try {
      if (mode === 'password') {
        const res = await api.post('/recovery/login-link', { email: email.trim(), password });
        setPassword('');
        setFound(res.data?.data?.organisations ?? []);
      } else {
        await api.post('/recovery/login-link/email', { email: email.trim() });
        setEmailSent(true);
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (mode === 'email' && status === 409) {
        setEmailEnabled(false);
        switchMode('password');
        setFailure('Sending login links by email is turned off. Use your email and password instead.');
      } else {
        setFailure(recoveryFailureMessage(status, err?.response?.data?.error?.message));
      }
    } finally {
      setLoading(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-[var(--bg)] text-[var(--text)]">
      <div className="sm:mx-auto sm:w-full sm:max-w-md space-y-6">
        {children}
        <div className="text-center">
          <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Back to the home page</span>
          </Link>
        </div>
      </div>
    </div>
  );

  if (found) {
    return shell(
      <>
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
            {found.length === 1 ? 'Here’s your login link' : found.length > 1 ? 'Here are your login links' : 'No company found'}
          </h1>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            {found.length > 0
              ? `Bookmark ${found.length === 1 ? 'it' : 'the one you use'} so it’s one click next time. You’ll still enter your password to sign in.`
              : 'Your account isn’t part of any active company right now. Ask your manager to invite you again.'}
          </p>
        </div>
        {found.map((org, i) => <FoundLinkCard key={`${org.name}-${i}`} org={org} />)}
      </>
    );
  }

  if (emailSent) {
    return shell(
      <Card className="p-6 sm:p-8 text-center space-y-3">
        <div className="w-10 h-10 rounded-full bg-[var(--success-light)] text-[var(--success)] flex items-center justify-center mx-auto">
          <MailCheck className="w-5 h-5" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold text-[var(--text)]">Check your inbox</h1>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          If <span className="font-medium text-[var(--text)]">{email.trim()}</span> belongs to a SimpleHours account, we’ve sent its login link there. It can take a minute to arrive.
        </p>
      </Card>
    );
  }

  return shell(
    <>
      <div className="text-center space-y-2">
        <div className="w-10 h-10 rounded-xl bg-[var(--primary-light)] text-[var(--primary-text)] flex items-center justify-center mx-auto">
          <KeyRound className="w-5 h-5" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Find your login link</h1>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          Every company signs in through its own private link.{' '}
          {mode === 'password'
            ? 'Enter the email and password you use for SimpleHours and we’ll show you yours.'
            : 'Enter your email and we’ll send yours there.'}
        </p>
      </div>

      <Card className="p-6 sm:p-8 space-y-5">
        {failure && (
          <div role="alert" className="p-3 rounded-md bg-[var(--danger-light)] border border-[var(--danger)]/25 text-xs text-[var(--danger)] flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{failure}</span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4" noValidate>
          <Input
            label="Email"
            type="email"
            autoComplete="username"
            placeholder="you@company.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            error={errors.email}
            required
            autoFocus
            leftIcon={<Mail className="w-4 h-4" />}
          />
          {mode === 'password' && (
            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Your SimpleHours password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              error={errors.password}
              required
              leftIcon={<Lock className="w-4 h-4" />}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="p-1 -mr-1 rounded text-[var(--muted)] hover:text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
            />
          )}
          <Button type="submit" variant="primary" size="md" className="w-full" loading={loading}>
            {mode === 'password' ? 'Show my login link' : 'Email me my login link'}
          </Button>
        </form>

        {emailEnabled && (
          <p className="text-center text-xs text-[var(--muted)]">
            {mode === 'password' ? 'Don’t remember your password? ' : 'Rather see it right away? '}
            <button
              type="button"
              onClick={() => switchMode(mode === 'password' ? 'email' : 'password')}
              className="font-medium text-[var(--primary-text)] hover:underline cursor-pointer"
            >
              {mode === 'password' ? 'Email it to me instead' : 'Use my password'}
            </button>
          </p>
        )}
      </Card>

      <p className="text-center text-xs text-[var(--muted)] leading-relaxed">
        Forgotten your password too? Ask your manager to send you your company’s link and a password reset.
      </p>
    </>
  );
}

function FoundLinkCard({ org }: { org: FoundOrganisation }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  // Built from the address this page was opened at, so it is never a placeholder or a development URL.
  const url = org.login_path ? `${window.location.origin}${org.login_path}` : null;

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <Card className="p-5 sm:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="w-9 h-9 shrink-0 rounded-lg bg-[var(--primary-light)] text-[var(--primary-text)] flex items-center justify-center">
          <Building2 className="w-4.5 h-4.5" />
        </span>
        <h2 className="text-base font-semibold text-[var(--text)] break-words">{org.name}</h2>
      </div>

      {url ? (
        <>
          <p data-testid="recovered-link" className="text-xs font-mono break-all select-all p-3 rounded-md bg-[var(--input-bg)] border border-[var(--border)] text-[var(--text)]">
            {url}
          </p>
          {org.replaced && (
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              The old link had stopped working, so we made this new one. Send it to your team.
            </p>
          )}
          {org.expires_at && (
            <p className="text-xs text-[var(--muted)]">
              Works until {new Date(org.expires_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Link to={org.login_path!} className="block">
              <Button variant="primary" size="md" className="w-full">Open</Button>
            </Link>
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="w-full"
              onClick={copy}
              leftIcon={copied === 'done' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            >
              {copied === 'done' ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p role="status" className="text-xs text-center text-[var(--muted)] empty:hidden">
            {copied === 'failed' ? 'Couldn’t copy automatically. Select the link above and copy it.' : ''}
          </p>
        </>
      ) : (
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          This company’s login link has stopped working. Ask your Organisation Owner for the new one.
        </p>
      )}
    </Card>
  );
}
