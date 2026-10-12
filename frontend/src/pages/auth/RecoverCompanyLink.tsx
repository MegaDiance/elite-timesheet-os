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
 * "I've lost my company's private link". Not a sign-in page: the company name and the recovery
 * password the Owner set (Settings → Security) only prove which link to show, and no session is
 * created. The result is held in memory only (never in the address bar, storage or history), so
 * reloading starts over. While email is on there is also an "email me my link" option.
 */
export default function RecoverCompanyLink() {
  const [mode, setMode] = useState<'company' | 'email'>('company');
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
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
    const previousTitle = document.title;
    document.title = 'Recover your company link · SimpleHours';
    return () => { meta.remove(); document.title = previousTitle; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.get('/recovery/options')
      .then(res => { if (!cancelled) setEmailEnabled(res.data?.data?.email_enabled === true); })
      .catch(() => undefined); // without it the page still works: the company option needs no email
    return () => { cancelled = true; };
  }, []);

  const switchMode = (next: 'company' | 'email') => {
    setMode(next);
    setErrors({});
    setFailure(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const problems: RecoveryErrors = mode === 'company' ? validateRecovery({ companyName, password }) : { email: emailError(email) };
    if (!problems.email) delete problems.email;
    setErrors(problems);
    setFailure(null);
    if (Object.keys(problems).length > 0) return;

    setLoading(true);
    try {
      if (mode === 'company') {
        const res = await api.post('/recovery/company-link', { company_name: companyName.trim(), password });
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
        switchMode('company');
        setFailure('Email is turned off. Use the recovery password instead.');
      } else {
        setPassword('');
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
            <span>Home</span>
          </Link>
        </div>
      </div>
    </div>
  );

  if (found) {
    return shell(
      <>
        <h1 className="text-2xl font-bold tracking-tight text-center text-[var(--text)]">
          {found.length > 1 ? 'Your company links' : 'Your company link'}
        </h1>
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
          If <span className="font-medium text-[var(--text)]">{email.trim()}</span> has an account, its company link is on the way.
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
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Recover your company link</h1>
        <p className="text-sm text-[var(--muted)]">
          {mode === 'company' ? 'Lost your company’s private access link? Recover it here.' : 'We’ll email your company link to you.'}
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
          {mode === 'company' ? (
            <>
              <Input
                label="Company name"
                autoComplete="organization"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                error={errors.companyName}
                maxLength={120}
                required
                autoFocus
                leftIcon={<Building2 className="w-4 h-4" />}
              />
              <Input
                label="Company recovery password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="off"
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
            </>
          ) : (
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
          )}
          <Button type="submit" variant="primary" size="md" className="w-full" loading={loading}>
            {mode === 'company' ? 'Recover access link' : 'Email me my link'}
          </Button>
        </form>

        {emailEnabled && (
          <p className="text-center text-xs text-[var(--muted)]">
            <button
              type="button"
              onClick={() => switchMode(mode === 'company' ? 'email' : 'company')}
              className="font-medium text-[var(--primary-text)] hover:underline cursor-pointer"
            >
              {mode === 'company' ? 'Email me my link instead' : 'Use the recovery password'}
            </button>
          </p>
        )}
      </Card>

      <p className="text-center text-xs text-[var(--muted)] leading-relaxed">
        Your company’s Owner sets the recovery password. No access? Ask them for the link.
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
              The old link had stopped working, so this is a new one. Share it with your team.
            </p>
          )}
          {org.expires_at && (
            <p className="text-xs text-[var(--muted)]">
              Works until {new Date(org.expires_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="primary"
              size="md"
              className="w-full"
              onClick={copy}
              leftIcon={copied === 'done' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            >
              {copied === 'done' ? 'Copied' : 'Copy link'}
            </Button>
            <Link to={org.login_path!} className="block">
              <Button variant="secondary" size="md" className="w-full">Open</Button>
            </Link>
          </div>
          <p role="status" className="text-xs text-center text-[var(--muted)] empty:hidden">
            {copied === 'failed' ? 'Couldn’t copy. Select the link and copy it.' : ''}
          </p>
        </>
      ) : (
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          This link has stopped working. Ask your company’s Owner for the new one.
        </p>
      )}
    </Card>
  );
}
