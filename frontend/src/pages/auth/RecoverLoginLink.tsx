import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Building2, Check, Copy, Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';
import api from '../../services/apiClient';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { recoveryFailureMessage, validateRecovery, type RecoveryErrors } from '../../utils/recoveryForm';

interface RecoveredLink {
  path: string;
  url: string;
  expiresAt: string | null;
}

/**
 * Recovering a lost private login link — for the Organisation Owner only. This is not a sign-in
 * page: it asks for the organisation name, the owner's email and the owner's password, and on
 * success shows a new login link (the old one stops working). The result is held in memory only —
 * it is never put in the address bar, local storage or history — so reloading the page starts over.
 */
export default function RecoverLoginLink() {
  const [organisationName, setOrganisationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<RecoveryErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<RecoveredLink | null>(null);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

  // Not something a search engine should list.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const found = validateRecovery({ organisationName, email, password });
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;

    setLoading(true);
    try {
      const res = await api.post('/recovery/login-link', { organisation_name: organisationName.trim(), email: email.trim(), password });
      const data = res.data?.data;
      setPassword('');
      setLink({ path: data.login_path, url: data.login_url, expiresAt: data.expires_at ?? null });
    } catch (err: any) {
      setFailure(recoveryFailureMessage(err?.response?.status, err?.response?.data?.error?.message));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-[var(--bg)] text-[var(--text)]">
      <div className="sm:mx-auto sm:w-full sm:max-w-md space-y-6">{children}</div>
    </div>
  );

  if (link) {
    return shell(
      <>
        <div className="text-center space-y-2">
          <div className="w-10 h-10 rounded-full bg-[var(--success-light)] text-[var(--success)] flex items-center justify-center mx-auto">
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Your login link has been recovered</h1>
        </div>

        <Card className="p-6 sm:p-8 space-y-5">
          <div>
            <div className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">Login link</div>
            <p data-testid="recovered-link" className="text-sm font-mono break-all select-all p-3 rounded-md bg-[var(--input-bg)] border border-[var(--border)] text-[var(--text)]">
              {link.url}
            </p>
          </div>

          <p className="text-xs text-[var(--muted)] leading-relaxed">
            Keep this link somewhere secure. Anyone who has access to it may be able to access the associated SimpleHours account, so don’t share it publicly.
          </p>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            This is a new link. The previous one no longer works, so anyone who used it will need the new one.
            {link.expiresAt ? ` This link expires on ${new Date(link.expiresAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}.` : ''}
          </p>

          <div className="space-y-2">
            <Link to={link.path} className="block">
              <Button variant="primary" size="md" className="w-full">Open SimpleHours</Button>
            </Link>
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="w-full"
              onClick={copy}
              leftIcon={copied === 'done' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            >
              {copied === 'done' ? 'Copied' : 'Copy login link'}
            </Button>
            <p role="status" className="text-xs text-center text-[var(--muted)] min-h-4">
              {copied === 'failed' ? 'Couldn’t copy automatically. Select the link above and copy it.' : ''}
            </p>
          </div>
        </Card>
      </>
    );
  }

  return shell(
    <>
      <div className="text-center space-y-2">
        <div className="w-10 h-10 rounded-xl bg-[var(--primary-light)] text-[var(--primary-text)] flex items-center justify-center mx-auto">
          <KeyRound className="w-5 h-5" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Recover your login link</h1>
        <p className="text-xs text-[var(--muted)] leading-relaxed">
          Enter the organisation name and the Organisation Owner’s credentials to recover access to the private login link.
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
            label="Organisation name"
            type="text"
            autoComplete="organization"
            placeholder="Enter your company name"
            value={organisationName}
            onChange={e => setOrganisationName(e.target.value)}
            error={errors.organisationName}
            maxLength={200}
            required
            autoFocus
            leftIcon={<Building2 className="w-4 h-4" />}
          />
          <Input
            label="Owner email"
            type="email"
            autoComplete="username"
            placeholder="owner@company.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            error={errors.email}
            required
            leftIcon={<Mail className="w-4 h-4" />}
          />
          <Input
            label="Owner password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Owner password"
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
          <Button type="submit" variant="primary" size="md" className="w-full" loading={loading}>
            Recover login link
          </Button>
        </form>
      </Card>

      <div className="text-center">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Back to the home page</span>
        </Link>
      </div>
    </>
  );
}
