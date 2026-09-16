import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/apiClient';

export default function SetupOrganisation() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  // Step state
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Form State: Step 1
  const [orgName, setOrgName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Form State: Step 2 (Dedicated Lock Passwords)
  const [useSeparateLocks, setUseSeparateLocks] = useState(true);
  const [rosterLockPassword, setRosterLockPassword] = useState('');
  const [timesheetLockPassword, setTimesheetLockPassword] = useState('');

  // Form State: Step 3 (Shift Breaks & 2FA)
  const [breakMinsWeekday, setBreakMinsWeekday] = useState(30);
  const [breakMinsWeekend, setBreakMinsWeekend] = useState(0);
  const [breakThresholdHours, setBreakThresholdHours] = useState(6);
  const [enable2FA, setEnable2FA] = useState(false);

  // Status State
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError('Missing invitation token.');
      setValidating(false);
      return;
    }

    api.get(`/platform/verify-invite?token=${token}`)
      .then(res => {
        setAdminEmail(res.data.data.email);
        setValidating(false);
      })
      .catch(err => {
        setError(err.response?.data?.error?.message || 'Invalid or expired invitation token.');
        setValidating(false);
      });
  }, [token]);

  const handleNextStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!orgName.trim()) {
      setError('Please provide an organisation name.');
      return;
    }
    if (adminPassword.length < 8) {
      setError('Admin password must be at least 8 characters.');
      return;
    }
    if (adminPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setStep(2);
  };

  const handleNextStep2 = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStep(3);
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post('/platform/claim-invite', {
        token,
        name: orgName.trim(),
        admin_email: adminEmail.trim(),
        admin_password: adminPassword,
        roster_lock_password: useSeparateLocks && rosterLockPassword ? rosterLockPassword : null,
        timesheet_lock_password: useSeparateLocks && timesheetLockPassword ? timesheetLockPassword : null,
        break_mins_weekday: Number(breakMinsWeekday),
        break_mins_weekend: Number(breakMinsWeekend),
        break_threshold_hours: Number(breakThresholdHours),
        enable_2fa: Boolean(enable2FA)
      });
      navigate('/login?setup=success');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to complete organisation setup');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--bg)] text-[var(--text)] p-4 font-['Inter',sans-serif]">
      <div className="w-full max-w-xl p-8 bg-[var(--panel)] rounded-3xl border border-[var(--border)] shadow-2xl space-y-6">
        {/* Header */}
        <div className="border-b border-[var(--border)] pb-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-black tracking-tight text-[var(--text)]">Organisation Setup Wizard</h2>
              <p className="text-xs text-[var(--muted)] mt-1">Configure your corporate workspace, security locks, and shift policies</p>
            </div>
            <span className="text-xs font-bold px-3 py-1 bg-[var(--primary-light)] text-[var(--primary)] rounded-full uppercase tracking-wider">
              Step {step} of 3
            </span>
          </div>

          {/* Stepper Progress Bar */}
          <div className="grid grid-cols-3 gap-2 mt-5">
            <div className={`h-1.5 rounded-full transition-all ${step >= 1 ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'}`} />
            <div className={`h-1.5 rounded-full transition-all ${step >= 2 ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'}`} />
            <div className={`h-1.5 rounded-full transition-all ${step >= 3 ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'}`} />
          </div>
        </div>

        {validating ? (
          <div className="text-center py-12 text-[var(--muted)] text-sm flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin"></div>
            <span>Validating invitation token...</span>
          </div>
        ) : error && !adminEmail ? (
          <div className="text-center text-sm font-bold text-[var(--danger)] py-4 bg-[var(--danger-light)] rounded-2xl border border-[var(--danger)]/30">
            {error}
          </div>
        ) : (
          <>
            {error && (
              <div className="text-xs font-bold text-[var(--danger)] p-3 bg-[var(--danger-light)] rounded-xl border border-[var(--danger)]/30">
                {error}
              </div>
            )}

            {/* STEP 1: ORGANISATION & ADMIN ACCOUNT */}
            {step === 1 && (
              <form onSubmit={handleNextStep1} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">Organisation Name</label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. Apex Logistics Solutions"
                    value={orgName}
                    onChange={e => setOrgName(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] text-sm outline-none focus:border-[var(--primary)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">Admin Email</label>
                  <input
                    required
                    type="email"
                    disabled
                    value={adminEmail}
                    className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--muted)] text-sm cursor-not-allowed opacity-75"
                  />
                  <span className="text-[11px] text-[var(--muted)] mt-1 block">Verified invitation address</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">Admin Master Password</label>
                    <input
                      required
                      type="password"
                      placeholder="At least 8 characters"
                      value={adminPassword}
                      onChange={e => setAdminPassword(e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] text-sm outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">Confirm Password</label>
                    <input
                      required
                      type="password"
                      placeholder="Repeat password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] text-sm outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <button
                    type="submit"
                    className="px-6 py-3 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold rounded-xl text-xs transition-all shadow-md flex items-center gap-2"
                  >
                    <span>Continue to Lock Passwords</span>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                      <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                  </button>
                </div>
              </form>
            )}

            {/* STEP 2: DEDICATED LOCK PASSWORDS */}
            {step === 2 && (
              <form onSubmit={handleNextStep2} className="space-y-5">
                <div className="p-4 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-2xl space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-[var(--primary)]">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                    <span>Independent Period Protection</span>
                  </div>
                  <p className="text-xs text-[var(--muted)] leading-relaxed">
                    Set up dedicated passwords to secure roster finalisation and timesheet locking independently. 
                    If left blank, locking and unlocking will default to your admin account master password.
                  </p>
                </div>

                <label className="flex items-center gap-2.5 cursor-pointer p-3.5 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-xl">
                  <input
                    type="checkbox"
                    checked={useSeparateLocks}
                    onChange={e => setUseSeparateLocks(e.target.checked)}
                    className="rounded bg-[var(--bg)] border-[var(--border)] text-[var(--primary)]"
                  />
                  <div>
                    <span className="text-xs font-bold text-[var(--text)] block">
                      Configure separate dedicated passwords for period locks
                    </span>
                    <span className="text-[11px] text-[var(--muted)] mt-0.5 block">
                      Allows delegating or restricting lock privileges separately from full admin access
                    </span>
                  </div>
                </label>

                {useSeparateLocks ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">
                        Dedicated Roster Lock Password
                      </label>
                      <input
                        type="password"
                        placeholder="Set dedicated roster lock password"
                        value={rosterLockPassword}
                        onChange={e => setRosterLockPassword(e.target.value)}
                        className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] text-sm outline-none focus:border-[var(--primary)]"
                      />
                      <span className="text-[11px] text-[var(--muted)] mt-1 block">
                        Required when finalising, locking, or unlocking roster schedules
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">
                        Dedicated Timesheet Lock Password
                      </label>
                      <input
                        type="password"
                        placeholder="Set dedicated timesheet lock password"
                        value={timesheetLockPassword}
                        onChange={e => setTimesheetLockPassword(e.target.value)}
                        className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] text-sm outline-none focus:border-[var(--primary)]"
                      />
                      <span className="text-[11px] text-[var(--muted)] mt-1 block">
                        Required when finalising and locking timesheets for payroll export
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-[var(--muted)] italic p-3 bg-[var(--panel-subtle)]/50 rounded-xl border border-[var(--border)]">
                    Locking operations will authenticate using your Admin Master Password.
                  </div>
                )}

                <div className="pt-4 flex justify-between">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold border border-[var(--border)] hover:bg-[var(--glass-4)] text-[var(--text)] transition-colors"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold rounded-xl text-xs transition-all shadow-md flex items-center gap-2"
                  >
                    <span>Continue to Policies & 2FA</span>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                      <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                  </button>
                </div>
              </form>
            )}

            {/* STEP 3: SHIFT POLICIES & 2-STEP VERIFICATION */}
            {step === 3 && (
              <form onSubmit={handleFinalSubmit} className="space-y-6">
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">
                    Unpaid Shift Break Defaults
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-[var(--muted)] mb-1">Weekday Break (mins)</label>
                      <input
                        type="number"
                        min="0"
                        max="180"
                        value={breakMinsWeekday}
                        onChange={e => setBreakMinsWeekday(Number(e.target.value))}
                        className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] font-bold outline-none focus:border-[var(--primary)]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-[var(--muted)] mb-1">Weekend Break (mins)</label>
                      <input
                        type="number"
                        min="0"
                        max="180"
                        value={breakMinsWeekend}
                        onChange={e => setBreakMinsWeekend(Number(e.target.value))}
                        className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] font-bold outline-none focus:border-[var(--primary)]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-[var(--muted)] mb-1">Threshold (hours)</label>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={breakThresholdHours}
                        onChange={e => setBreakThresholdHours(Number(e.target.value))}
                        className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] font-bold outline-none focus:border-[var(--primary)]"
                      />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-2xl space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enable2FA}
                      onChange={e => setEnable2FA(e.target.checked)}
                      className="mt-0.5 rounded bg-[var(--bg)] border-[var(--border)] text-[var(--primary)]"
                    />
                    <div>
                      <span className="text-xs font-bold text-[var(--text)] block">
                        Enable 2-Step Verification (2FA) for this Admin account
                      </span>
                      <span className="text-[11px] text-[var(--muted)] mt-0.5 block leading-relaxed">
                        When enabled, each login requires a one-time verification passcode delivered to your email. 
                        If left unchecked, 2-Step Verification remains inactive until explicitly enabled later.
                      </span>
                    </div>
                  </label>
                </div>

                <div className="pt-4 flex justify-between">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold border border-[var(--border)] hover:bg-[var(--glass-4)] text-[var(--text)] transition-colors"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-6 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-black rounded-xl text-xs transition-all shadow-lg shadow-[var(--primary-light)] disabled:opacity-50 flex items-center gap-2"
                  >
                    {loading ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Provisioning Organisation...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        <span>Complete Setup & Create Organisation</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
