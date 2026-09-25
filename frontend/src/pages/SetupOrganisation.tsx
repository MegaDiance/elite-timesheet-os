import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { MapPin, Clock, ArrowRight, ArrowLeft, CheckCircle2, Sliders, AlertCircle, Building2, UserRound, Lock, ShieldCheck } from 'lucide-react';
import api from '../services/apiClient';
import { Button } from '../components/ui/Button';

const TIMEZONES = [
  { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
  { value: 'Australia/Hobart', label: 'Hobart (AEST/AEDT)' },
  { value: 'Australia/Brisbane', label: 'Brisbane (AEST, no daylight saving)' },
  { value: 'Australia/Adelaide', label: 'Adelaide (ACST/ACDT)' },
  { value: 'Australia/Darwin', label: 'Darwin (ACST)' },
  { value: 'Australia/Perth', label: 'Perth (AWST)' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST/NZDT)' },
  { value: 'UTC', label: 'UTC' },
];

const STEPS = [
  { title: 'Your organisation', icon: Building2 },
  { title: 'Your account', icon: UserRound },
  { title: 'Your first branch', icon: MapPin },
  { title: 'Breaks and security', icon: Sliders },
] as const;

const inputClass =
  'w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] text-sm outline-none focus:border-[var(--primary)] disabled:opacity-70 disabled:cursor-not-allowed';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-bold text-[var(--muted)] uppercase tracking-wide">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

function isStrongPassword(value: string) {
  return value.length >= 8 && /[A-Za-z]/.test(value) && /[0-9]/.test(value);
}

/**
 * Completes sign-up from the emailed setup link: creates the organisation and its first branch,
 * and makes this account the Organisation Owner. No session is created; the owner then signs in
 * through the organisation's private sign-in link.
 */
export default function SetupOrganisation() {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('token') || '').trim();

  const [validating, setValidating] = useState(Boolean(token));
  const [invalidLink, setInvalidLink] = useState(!token);
  const [email, setEmail] = useState('');
  const [accountExists, setAccountExists] = useState(false);

  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loginPath, setLoginPath] = useState<string | null>(null);

  // Organisation
  const [organisationName, setOrganisationName] = useState('');
  // Account
  const [ownerName, setOwnerName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // First branch
  const [branchName, setBranchName] = useState('Main Branch');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchTimezone, setBranchTimezone] = useState('Australia/Melbourne');
  // Breaks and security
  const [breakWeekday, setBreakWeekday] = useState('30');
  const [breakWeekend, setBreakWeekend] = useState('0');
  const [breakThreshold, setBreakThreshold] = useState('6');
  const [rosterLockPassword, setRosterLockPassword] = useState('');
  const [timesheetLockPassword, setTimesheetLockPassword] = useState('');
  const [enable2fa, setEnable2fa] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.get('/signup/verify', { params: { token } })
      .then(res => {
        if (cancelled) return;
        setEmail(res.data.data.email);
        setAccountExists(Boolean(res.data.data.account_exists));
      })
      .catch(() => {
        if (!cancelled) setInvalidLink(true);
      })
      .finally(() => {
        if (!cancelled) setValidating(false);
      });
    return () => { cancelled = true; };
  }, [token]);

  const validateStep = (index: number): string => {
    if (index === 0) {
      if (!organisationName.trim()) return 'Enter your organisation’s name.';
      if (organisationName.trim().length > 120) return 'Keep the organisation name to 120 characters or fewer.';
    }
    if (index === 1) {
      if (accountExists) {
        if (!password) return 'Enter your current SimpleHours password.';
      } else {
        if (!ownerName.trim()) return 'Enter your name.';
        if (!isStrongPassword(password)) return 'Your password needs at least 8 characters, with both letters and numbers.';
        if (password !== confirmPassword) return 'The passwords don’t match.';
      }
    }
    if (index === 2) {
      if (!branchName.trim()) return 'Enter a name for your first branch.';
    }
    if (index === 3) {
      const weekday = Number(breakWeekday);
      const weekend = Number(breakWeekend);
      const threshold = Number(breakThreshold);
      if (!Number.isFinite(weekday) || weekday < 0 || weekday > 240) return 'Weekday break must be between 0 and 240 minutes.';
      if (!Number.isFinite(weekend) || weekend < 0 || weekend > 240) return 'Weekend break must be between 0 and 240 minutes.';
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 24) return 'The break threshold must be between 0 and 24 hours.';
      if (rosterLockPassword && rosterLockPassword.length < 4) return 'Lock passwords need at least 4 characters.';
      if (timesheetLockPassword && timesheetLockPassword.length < 4) return 'Lock passwords need at least 4 characters.';
    }
    return '';
  };

  const next = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateStep(step);
    setError(problem);
    if (!problem) setStep(s => s + 1);
  };

  const back = () => {
    setError('');
    setStep(s => Math.max(0, s - 1));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    for (let i = 0; i < STEPS.length; i++) {
      const problem = validateStep(i);
      if (problem) {
        setStep(i);
        setError(problem);
        return;
      }
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await api.post('/signup/complete', {
        token,
        organisation_name: organisationName.trim(),
        password,
        owner_name: accountExists ? undefined : ownerName.trim(),
        branch_name: branchName.trim(),
        branch_address: branchAddress.trim() || undefined,
        branch_timezone: branchTimezone,
        break_mins_weekday: Number(breakWeekday),
        break_mins_weekend: Number(breakWeekend),
        break_threshold_hours: Number(breakThreshold),
        roster_lock_password: rosterLockPassword || undefined,
        timesheet_lock_password: timesheetLockPassword || undefined,
        enable_2fa: accountExists ? undefined : enable2fa,
      });
      const path: string = res.data?.data?.login_path || '';
      setLoginPath(/^\/login\/[a-z0-9-]+$/.test(path) ? path : '/');
    } catch (err: any) {
      const code = err.response?.data?.error?.code;
      const message = err.response?.data?.error?.message;
      if (code === 'INVALID_SETUP_LINK') {
        setInvalidLink(true);
      } else if (code === 'INVALID_CREDENTIALS' || code === 'WEAK_PASSWORD') {
        setStep(1);
        setError(message || 'Check your password and try again.');
      } else {
        setError(message || 'We couldn’t set up your organisation. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const card = (children: React.ReactNode) => (
    <div className="flex items-center justify-center min-h-screen bg-[var(--bg)] text-[var(--text)] p-4">
      <div className="w-full max-w-xl p-6 sm:p-8 bg-[var(--panel)] rounded-3xl border border-[var(--border)] shadow-2xl space-y-6">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-[var(--primary)] text-white flex items-center justify-center">
            <Clock className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--primary-text)]">SimpleHours set-up</span>
        </div>
        {children}
      </div>
    </div>
  );

  if (validating) {
    return card(
      <div className="text-center py-12 text-[var(--muted)] text-xs flex items-center justify-center gap-2">
        <div className="w-4 h-4 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin"></div>
        <span>Checking your setup link…</span>
      </div>
    );
  }

  if (invalidLink) {
    return card(
      <div className="text-center space-y-4 py-4">
        <div className="w-12 h-12 rounded-full bg-[var(--danger-light)] text-[var(--danger)] flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-[var(--text)]">This setup link can't be used</h1>
        <p className="text-xs text-[var(--muted)] leading-relaxed max-w-sm mx-auto">
          It may have expired, already been used or been copied incorrectly. Setup links work once and expire after 24 hours.
        </p>
        <Link to="/signup" className="inline-block">
          <Button variant="primary" size="md">Request a new link</Button>
        </Link>
      </div>
    );
  }

  if (loginPath) {
    const fullLink = `${window.location.origin}${loginPath}`;
    return card(
      <div className="text-center space-y-4 py-4">
        <div className="w-12 h-12 rounded-full bg-[var(--success-light)] text-[var(--success)] flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Your organisation is ready</h1>
        <p className="text-sm text-[var(--muted)] leading-relaxed max-w-md mx-auto">
          {organisationName.trim()} has been set up with its first branch, {branchName.trim()}. Sign in to add workers,
          build your first roster and invite Branch Admins.
        </p>
        <div className="p-3 rounded-xl bg-[var(--panel-subtle)] border border-[var(--border)] text-xs text-left space-y-1">
          <div className="font-semibold text-[var(--text)]">Your organisation's private sign-in link</div>
          <div className="font-mono text-[var(--primary-text)] break-all">{fullLink}</div>
          <div className="text-[var(--muted)]">Bookmark it. You and your Branch Admins sign in here.</div>
        </div>
        <Link to={loginPath} className="inline-block">
          <Button variant="primary" size="lg" rightIcon={<ArrowRight className="w-4 h-4" />}>Sign in</Button>
        </Link>
      </div>
    );
  }

  const StepIcon = STEPS[step].icon;
  const isLast = step === STEPS.length - 1;

  return card(
    <>
      <div className="border-b border-[var(--border)] pb-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--primary-light)] text-[var(--primary-text)] flex items-center justify-center shrink-0">
              <StepIcon className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text)]">{STEPS[step].title}</h1>
              <p className="text-xs text-[var(--muted)] mt-0.5">Step {step + 1} of {STEPS.length} · Setting up as {email}</p>
            </div>
          </div>
        </div>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }}>
          {STEPS.map((s, i) => (
            <div key={s.title} className={`h-1.5 rounded-full transition-all duration-300 ${step >= i ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'}`} />
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="text-xs font-semibold text-[var(--danger)] p-3 bg-[var(--danger-light)] rounded-xl border border-[var(--danger)]/25 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={isLast ? submit : next} className="space-y-4" noValidate>
        {step === 0 && (
          <>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              You'll be the Organisation Owner: you can see every branch, invite Branch Admins and change organisation settings.
            </p>
            <Field label="Organisation name">
              <input
                type="text"
                placeholder="e.g. Harbourside Community Care"
                value={organisationName}
                onChange={e => setOrganisationName(e.target.value)}
                autoFocus
                maxLength={120}
                className={inputClass}
              />
            </Field>
          </>
        )}

        {step === 1 && (
          <>
            <Field label="Email">
              <input type="email" value={email} disabled className={inputClass} />
            </Field>
            {accountExists ? (
              <>
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  You already have a SimpleHours account with this email. Enter its current password to add this organisation to it.
                </p>
                <Field label="Current password">
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoFocus
                    className={inputClass}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Your name">
                  <input
                    type="text"
                    autoComplete="name"
                    placeholder="e.g. Alex Chen"
                    value={ownerName}
                    onChange={e => setOwnerName(e.target.value)}
                    autoFocus
                    maxLength={120}
                    className={inputClass}
                  />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Password" hint="At least 8 characters, with letters and numbers.">
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Confirm password">
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className={inputClass}
                    />
                  </Field>
                </div>
              </>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Branches are the places your workers are rostered. You can add more branches later from the Branches page.
            </p>
            <Field label="Branch name">
              <input
                type="text"
                placeholder="e.g. Richmond"
                value={branchName}
                onChange={e => setBranchName(e.target.value)}
                autoFocus
                maxLength={120}
                className={inputClass}
              />
            </Field>
            <Field label="Address (optional)">
              <input
                type="text"
                placeholder="e.g. 12 Swan Street, Richmond VIC 3121"
                value={branchAddress}
                onChange={e => setBranchAddress(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Timezone">
              <select value={branchTimezone} onChange={e => setBranchTimezone(e.target.value)} className={inputClass}>
                {TIMEZONES.map(tz => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </Field>
          </>
        )}

        {step === 3 && (
          <>
            <div className="p-4 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-2xl space-y-3">
              <div className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-[var(--primary-text)]" />
                <span>Unpaid break</span>
              </div>
              <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                Taken once per day when a day's hours reach the threshold. Weekends can use a different length. You can change this later in Settings.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Field label="Weekday (mins)">
                  <input type="number" min={0} max={240} value={breakWeekday} onChange={e => setBreakWeekday(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Weekend (mins)">
                  <input type="number" min={0} max={240} value={breakWeekend} onChange={e => setBreakWeekend(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Threshold (hours)">
                  <input type="number" min={0} max={24} step={0.5} value={breakThreshold} onChange={e => setBreakThreshold(e.target.value)} className={inputClass} />
                </Field>
              </div>
            </div>

            <div className="p-4 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-2xl space-y-3">
              <div className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-[var(--primary-text)]" />
                <span>Lock passwords (optional)</span>
              </div>
              <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                Each branch can lock its roster and its timesheets for a fortnight. Shared lock passwords let Branch Admins lock and
                unlock; anyone can also use their own sign-in password. Leave blank to skip.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Roster lock password">
                  <input type="password" autoComplete="new-password" value={rosterLockPassword} onChange={e => setRosterLockPassword(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Timesheet lock password">
                  <input type="password" autoComplete="new-password" value={timesheetLockPassword} onChange={e => setTimesheetLockPassword(e.target.value)} className={inputClass} />
                </Field>
              </div>
            </div>

            {!accountExists && (
              <label className="p-4 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-2xl flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enable2fa}
                  onChange={e => setEnable2fa(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[var(--primary)]"
                />
                <span className="space-y-0.5">
                  <span className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-[var(--primary-text)]" /> Turn on two-step verification
                  </span>
                  <span className="block text-[11px] text-[var(--muted)] leading-relaxed">
                    We'll email you a 6-digit code each time you sign in. You can change this later in Settings.
                  </span>
                </span>
              </label>
            )}

            <div className="p-4 bg-[var(--panel-subtle)]/60 border border-[var(--border)] rounded-2xl grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-[var(--muted)] block text-[10px] uppercase">Organisation</span>
                <strong className="text-[var(--text)] break-words">{organisationName.trim()}</strong>
              </div>
              <div>
                <span className="text-[var(--muted)] block text-[10px] uppercase">First branch</span>
                <strong className="text-[var(--text)] break-words">{branchName.trim()}</strong>
              </div>
            </div>
          </>
        )}

        <div className="pt-4 flex justify-between gap-3">
          {step > 0 ? (
            <Button type="button" variant="ghost" size="md" onClick={back} leftIcon={<ArrowLeft className="w-4 h-4" />}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {isLast ? (
            <Button type="submit" variant="primary" size="md" loading={submitting} leftIcon={<CheckCircle2 className="w-4 h-4" />}>
              Create organisation
            </Button>
          ) : (
            <Button type="submit" variant="primary" size="md" rightIcon={<ArrowRight className="w-4 h-4" />}>
              Continue
            </Button>
          )}
        </div>
      </form>
    </>
  );
}
