import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { MapPin, Lock, User, Mail, ArrowRight, AlertCircle, Clock, CheckCircle2 } from 'lucide-react';
import api from '../../services/apiClient';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { friendlyError } from '../../services/errors';

interface Invitation {
  email: string;
  organisation_name: string;
  /** Team invitations only: the role offered and where it applies. */
  role_name?: string;
  all_branches?: boolean;
  branches?: string[];
  account_exists: boolean;
}

type InviteKind = 'team' | 'employee';

const API_BASE: Record<InviteKind, string> = {
  team: '/team/invitations',
  employee: '/employee-accounts/invitations',
};

/** "all branches", "Melbourne", "Melbourne and Sydney", "Melbourne, Sydney and Perth". */
const whereItApplies = (inv: Invitation): string => {
  if (inv.all_branches) return 'all branches';
  const names = inv.branches ?? [];
  if (names.length <= 1) return names[0] ?? 'the branches you are given';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

const INVALID_MESSAGE: Record<InviteKind, string> = {
  team: 'This invitation has expired, was already used or isn’t valid. Ask whoever invited you for a new one.',
  employee: 'This invitation has expired, was already used or isn’t valid. Ask your manager for a new one.',
};

/**
 * Accepts a team invitation, a role in the organisation (/accept-invite) or an employee portal invitation
 * (/accept-employee-invite). Accepting never signs anyone in: the server answers with the
 * organisation's own sign-in link, and the person signs in there afterwards.
 */
export default function AcceptInvite({ kind = 'team' }: { kind?: InviteKind }) {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('token') || '').trim();

  const [loading, setLoading] = useState(Boolean(token));
  const [invalid, setInvalid] = useState(!token);
  const [invitation, setInvitation] = useState<Invitation | null>(null);

  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginPath, setLoginPath] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.get(`${API_BASE[kind]}/verify`, { params: { token } })
      .then(res => {
        if (!cancelled) setInvitation(res.data.data);
      })
      .catch(() => {
        if (!cancelled) setInvalid(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token, kind]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invitation) return;
    setError(null);

    if (!invitation.account_exists) {
      if (!fullName.trim()) {
        setError('Enter your name.');
        return;
      }
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        setError('Your password needs at least 8 characters, with both letters and numbers.');
        return;
      }
      if (password !== confirmPassword) {
        setError('The passwords don’t match.');
        return;
      }
    } else if (!password) {
      setError('Enter your current SimpleHours password.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post(`${API_BASE[kind]}/accept`, {
        token,
        password,
        full_name: invitation.account_exists ? undefined : fullName.trim(),
      });
      const path: string = res.data?.data?.login_path || '';
      // Always the organisation's own sign-in link; there is no generic sign-in page to fall back to.
      // 'none' = accepted, but the organisation's link has expired (the owner must share a new one).
      setLoginPath(/^\/login\/[a-z0-9-]+$/.test(path) ? path : 'none');
    } catch (err: any) {
      const code = err.response?.data?.error?.code;
      if (code === 'INVALID_INVITATION') {
        setInvalid(true);
      } else if (code === 'INVALID_CREDENTIALS') {
        setError('That password isn’t right. Enter your current SimpleHours password.');
      } else {
        setError(friendlyError(err, 'We couldn’t accept the invitation. Try again.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-[var(--bg)] text-[var(--text)]">
      <div className="sm:mx-auto sm:w-full sm:max-w-md space-y-6">
        <div className="text-center space-y-2">
          <Link to="/" className="inline-flex" aria-label="SimpleHours home">
            <div className="w-12 h-12 rounded-xl bg-[var(--primary)] flex items-center justify-center text-white mx-auto shadow-sm">
              <Clock className="w-6 h-6" />
            </div>
          </Link>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--primary-text)]">SimpleHours</div>
        </div>
        {children}
      </div>
    </div>
  );

  if (loading) {
    return shell(
      <div className="flex flex-col items-center gap-3 text-[var(--muted)] py-8">
        <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-medium">Checking your invitation…</p>
      </div>
    );
  }

  if (invalid || !invitation) {
    return shell(
      <Card className="p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-[var(--danger-light)] text-[var(--danger)] flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-[var(--text)]">This invitation can't be used</h1>
        <p className="text-xs text-[var(--muted)] leading-relaxed">{INVALID_MESSAGE[kind]}</p>
        <Link to="/" className="block pt-2">
          <Button variant="secondary" size="md" className="w-full">Go to home page</Button>
        </Link>
      </Card>
    );
  }

  if (loginPath) {
    return shell(
      <Card className="p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-[var(--success-light)] text-[var(--success)] flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-[var(--text)]">{kind === 'employee' ? 'Your account is ready' : `You’re now ${invitation.role_name ?? 'a team member'}`}</h1>
        <p className="text-xs text-[var(--muted)] leading-relaxed">
          {kind === 'employee'
            ? `Bookmark the sign-in page — it’s ${invitation.organisation_name}’s own link.`
            : `At ${invitation.organisation_name}, covering ${whereItApplies(invitation)}.`}
        </p>
        {loginPath === 'none' ? (
          <p className="text-sm text-[var(--text)] bg-[var(--panel-subtle)] rounded-md p-3">
            Your organisation’s link has changed. Ask your manager for the new one.
          </p>
        ) : (
          <Link to={loginPath} className="block pt-2">
            <Button variant="primary" size="md" className="w-full" rightIcon={<ArrowRight className="w-4 h-4" />}>
              Sign in to {invitation.organisation_name}
            </Button>
          </Link>
        )}
      </Card>
    );
  }

  return shell(
    <>
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Accept your invitation</h1>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          {kind === 'employee' ? (
            <><strong className="text-[var(--text)]">{invitation.organisation_name}</strong> invited you to SimpleHours.</>
          ) : (
            <>
              You’ve been invited to join <strong className="text-[var(--text)]">{invitation.organisation_name}</strong> as{' '}
              <strong className="text-[var(--text)]">{invitation.role_name ?? 'a team member'}</strong>, covering{' '}
              <strong className="text-[var(--text)]">{whereItApplies(invitation)}</strong>.
            </>
          )}
        </p>
      </div>

      <Card className="p-8 space-y-5">
        <div className="p-3.5 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-xl flex items-start gap-2.5 text-xs">
          <div className="w-8 h-8 rounded-lg bg-[var(--primary-light)] text-[var(--primary-text)] flex items-center justify-center shrink-0">
            <MapPin className="w-4 h-4" />
          </div>
          <div className="text-[var(--muted)] leading-relaxed">
            {kind === 'employee'
              ? 'You’ll see your schedule and request leave and, if your organisation allows it, record your own hours.'
              : 'You’ll only see and do what your role allows.'}
          </div>
        </div>

        {error && (
          <div role="alert" className="p-3 rounded-xl bg-[var(--danger-light)] border border-[var(--danger)]/25 text-xs text-[var(--danger)] flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Input label="Email" type="email" value={invitation.email} disabled leftIcon={<Mail className="w-4 h-4" />} />

          {invitation.account_exists ? (
            <>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                You already have an account. Enter its password to add this access.
              </p>
              <Input
                label="Current password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                leftIcon={<Lock className="w-4 h-4" />}
              />
            </>
          ) : (
            <>
              <Input
                label="Your name"
                type="text"
                autoComplete="name"
                placeholder="e.g. Sam Nguyen"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoFocus
                leftIcon={<User className="w-4 h-4" />}
              />
              <Input
                label="Create a password"
                type="password"
                autoComplete="new-password"
                helperText="At least 8 characters, with letters and numbers."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                leftIcon={<Lock className="w-4 h-4" />}
              />
              <Input
                label="Confirm password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                leftIcon={<Lock className="w-4 h-4" />}
              />
            </>
          )}

          <Button type="submit" variant="primary" size="md" className="w-full" loading={submitting} rightIcon={<ArrowRight className="w-4 h-4" />}>
            Accept invitation
          </Button>
        </form>
      </Card>
    </>
  );
}
