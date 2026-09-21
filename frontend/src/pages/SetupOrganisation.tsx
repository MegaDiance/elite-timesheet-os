import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { 
  MapPin, 
  Clock, 
  Mail, 
  ShieldCheck, 
  Check, 
  ArrowRight, 
  ArrowLeft, 
  CheckCircle2, 
  Sliders, 
  Users, 
  AlertCircle 
} from 'lucide-react';
import api from '../services/apiClient';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

const TIMEZONES = [
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEDT/AEST)' },
  { value: 'Australia/Melbourne', label: 'Australia/Melbourne (AEDT/AEST)' },
  { value: 'Australia/Brisbane', label: 'Australia/Brisbane (AEST - No DST)' },
  { value: 'Australia/Perth', label: 'Australia/Perth (AWST)' },
  { value: 'Australia/Adelaide', label: 'Australia/Adelaide (ACDT/ACST)' },
  { value: 'Australia/Hobart', label: 'Australia/Hobart (AEDT/AEST)' },
  { value: 'Australia/Darwin', label: 'Australia/Darwin (ACST)' },
  { value: 'UTC', label: 'UTC' }
];

export default function SetupOrganisation() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  // 5-Step State: 1 | 2 | 3 | 4 | 5
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 1: Organisation Details
  const [orgName, setOrgName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Step 2: Primary Location
  const [locationName, setLocationName] = useState('Main Branch');
  const [locationAddress, setLocationAddress] = useState('');
  const [locationTimezone, setLocationTimezone] = useState('Australia/Sydney');

  // Step 3: Timesheet Workflow Mode
  const [timesheetMode, setTimesheetMode] = useState<'employee' | 'manager'>('employee');

  // Step 4: Manager Invitations (Optional)
  const [inviteManagerEmail, setInviteManagerEmail] = useState('');

  // Step 5: Advanced Options (Break Defaults)
  const [breakMinsWeekday, setBreakMinsWeekday] = useState(30);
  const [breakMinsWeekend, setBreakMinsWeekend] = useState(0);
  const [breakThresholdHours, setBreakThresholdHours] = useState(6);

  // Status State
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError('Missing organization invitation token in URL.');
      setValidating(false);
      return;
    }

    api.get(`/platform/verify-invite?token=${encodeURIComponent(token.trim())}`)
      .then(res => {
        if (res.data?.data?.email) {
          setAdminEmail(res.data.data.email);
        }
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
      setError('Master password must be at least 8 characters long.');
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
    if (!locationName.trim()) {
      setError('Please provide a name for your primary location.');
      return;
    }
    setStep(3);
  };

  const handleNextStep3 = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStep(4);
  };

  const handleNextStep4 = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (inviteManagerEmail.trim() && !inviteManagerEmail.includes('@')) {
      setError('Please provide a valid email address or leave blank.');
      return;
    }
    setStep(5);
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post('/platform/claim-invite', {
        token: token?.trim(),
        name: orgName.trim(),
        display_name: displayName.trim() || orgName.trim(),
        admin_email: adminEmail.trim(),
        admin_password: adminPassword,
        primary_location_name: locationName.trim(),
        primary_location_address: locationAddress.trim() || null,
        primary_location_timezone: locationTimezone,
        timesheet_entry_mode: timesheetMode,
        invite_manager_email: inviteManagerEmail.trim() || null,
        roster_lock_password: null,
        timesheet_lock_password: null,
        break_mins_weekday: Number(breakMinsWeekday),
        break_mins_weekend: Number(breakMinsWeekend),
        break_threshold_hours: Number(breakThresholdHours),
        enable_2fa: false
      });

      navigate('/login?setup=success');
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to complete organisation setup.');
    } finally {
      setLoading(false);
    }
  };

  const stepTitles = [
    'Organisation Details',
    'Primary Location',
    'Timesheet Workflow',
    'Manager Invitation',
    'Review & Finish'
  ];

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--bg)] text-[var(--text)] p-4 font-['Inter',sans-serif]">
      <div className="w-full max-w-xl p-8 bg-[var(--panel)] rounded-3xl border border-[var(--border)] shadow-2xl space-y-6">
        {/* Header */}
        <div className="border-b border-[var(--border)] pb-5">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-md bg-[var(--primary)] text-white flex items-center justify-center">
              <Clock className="w-3.5 h-3.5" />
            </div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--primary)]">
              SimpleHours Onboarding Wizard
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-[var(--text)]">
                {stepTitles[step - 1]}
              </h2>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Step {step} of 5: Set up your workforce structure with strict location isolation
              </p>
            </div>
            <span className="text-xs font-bold px-3 py-1 bg-[var(--primary-light)] text-[var(--primary)] rounded-full uppercase tracking-wider">
              {step}/5
            </span>
          </div>

          {/* 5-Step Progress Indicator */}
          <div className="grid grid-cols-5 gap-1.5 mt-5">
            {[1, 2, 3, 4, 5].map((s) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  step >= s ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'
                }`}
              />
            ))}
          </div>
        </div>

        {validating ? (
          <div className="text-center py-12 text-[var(--muted)] text-xs flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin"></div>
            <span>Validating workspace invitation...</span>
          </div>
        ) : error && !adminEmail ? (
          <div className="text-center text-xs font-bold text-rose-500 py-6 bg-rose-500/10 rounded-2xl border border-rose-500/20 space-y-3">
            <AlertCircle className="w-6 h-6 mx-auto text-rose-500" />
            <div>{error}</div>
            <Link to="/portal-access">
              <Button variant="ghost" size="sm">Back to Portal Access</Button>
            </Link>
          </div>
        ) : (
          <>
            {error && (
              <div className="text-xs font-semibold text-rose-500 p-3 bg-rose-500/10 rounded-xl border border-rose-500/20 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* STEP 1: ORGANISATION DETAILS */}
            {step === 1 && (
              <form onSubmit={handleNextStep1} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">
                    Organisation Legal Name *
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. Apex Logistics Solutions"
                    value={orgName}
                    onChange={e => setOrgName(e.target.value)}
                    autoFocus
                    className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] text-xs outline-none focus:border-[var(--primary)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">
                    Display Name / Brand Label (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Apex Logistics"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] text-xs outline-none focus:border-[var(--primary)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">
                    Owner Admin Email
                  </label>
                  <input
                    type="email"
                    disabled
                    value={adminEmail}
                    className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--muted)] text-xs cursor-not-allowed opacity-75"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">
                      Master Password *
                    </label>
                    <input
                      required
                      type="password"
                      placeholder="At least 8 characters"
                      value={adminPassword}
                      onChange={e => setAdminPassword(e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] text-xs outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">
                      Confirm Password *
                    </label>
                    <input
                      required
                      type="password"
                      placeholder="Repeat password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] text-xs outline-none focus:border-[var(--primary)]"
                    />
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    rightIcon={<ArrowRight className="w-4 h-4" />}
                  >
                    Continue to Primary Location
                  </Button>
                </div>
              </form>
            )}

            {/* STEP 2: PRIMARY LOCATION */}
            {step === 2 && (
              <form onSubmit={handleNextStep2} className="space-y-4">
                <div className="p-3.5 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-2xl space-y-1">
                  <div className="text-xs font-bold text-[var(--primary)] flex items-center gap-1.5">
                    <MapPin className="w-4 h-4" />
                    <span>Multi-Location Architecture</span>
                  </div>
                  <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                    SimpleHours isolates data across locations. Create your first operational site (e.g. Headquarters or Primary Warehouse).
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">
                    Primary Location Name *
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. Sydney Central Office or HQ"
                    value={locationName}
                    onChange={e => setLocationName(e.target.value)}
                    autoFocus
                    className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] text-xs outline-none focus:border-[var(--primary)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">
                    Physical Address (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 100 Main Street, Sydney NSW 2000"
                    value={locationAddress}
                    onChange={e => setLocationAddress(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] text-xs outline-none focus:border-[var(--primary)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">
                    Operating Timezone *
                  </label>
                  <select
                    value={locationTimezone}
                    onChange={e => setLocationTimezone(e.target.value)}
                    className="w-full px-4 py-2.5 bg-[var(--input-bg)] border border-[var(--border)] rounded-xl text-xs text-[var(--text)] outline-none focus:border-[var(--primary)]"
                  >
                    {TIMEZONES.map(tz => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                </div>

                <div className="pt-4 flex justify-between">
                  <Button type="button" variant="ghost" size="md" onClick={() => setStep(1)} leftIcon={<ArrowLeft className="w-4 h-4" />}>
                    Back
                  </Button>
                  <Button type="submit" variant="primary" size="md" rightIcon={<ArrowRight className="w-4 h-4" />}>
                    Continue to Workflow Mode
                  </Button>
                </div>
              </form>
            )}

            {/* STEP 3: TIMESHEET WORKFLOW MODE */}
            {step === 3 && (
              <form onSubmit={handleNextStep3} className="space-y-4">
                <div className="space-y-1">
                  <h3 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">
                    Select Timesheet Entry Mode
                  </h3>
                  <p className="text-xs text-[var(--muted)]">
                    Choose how timesheet actual hours are submitted and reviewed across your workforce.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {/* Mode 1: Employee Submission */}
                  <div
                    onClick={() => setTimesheetMode('employee')}
                    className={`p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                      timesheetMode === 'employee'
                        ? 'border-[var(--primary)] bg-[var(--primary-light)]/20'
                        : 'border-[var(--border)] hover:border-[var(--border-h)] bg-[var(--panel-subtle)]'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-[var(--primary)] text-white flex items-center justify-center font-bold text-xs">
                          <Users className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-[var(--text)]">Employee Submission Mode (Standard)</h4>
                          <span className="text-[10px] text-emerald-500 font-semibold">Recommended for distributed teams</span>
                        </div>
                      </div>
                      {timesheetMode === 'employee' && (
                        <div className="w-5 h-5 rounded-full bg-[var(--primary)] text-white flex items-center justify-center">
                          <Check className="w-3 h-3" />
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--muted)] mt-2.5 leading-relaxed">
                      Staff submit their actual shifts each fortnight for manager review and approval. Managers receive alerts and can approve or decline with feedback.
                    </p>
                  </div>

                  {/* Mode 2: Manager Entry */}
                  <div
                    onClick={() => setTimesheetMode('manager')}
                    className={`p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                      timesheetMode === 'manager'
                        ? 'border-[var(--primary)] bg-[var(--primary-light)]/20'
                        : 'border-[var(--border)] hover:border-[var(--border-h)] bg-[var(--panel-subtle)]'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500 text-white flex items-center justify-center font-bold text-xs">
                          <ShieldCheck className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-[var(--text)]">Manager Entry Mode</h4>
                          <span className="text-[10px] text-indigo-400 font-semibold">For supervisor-clocked operations</span>
                        </div>
                      </div>
                      {timesheetMode === 'manager' && (
                        <div className="w-5 h-5 rounded-full bg-[var(--primary)] text-white flex items-center justify-center">
                          <Check className="w-3 h-3" />
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--muted)] mt-2.5 leading-relaxed">
                      Location managers directly record actual hours or convert roster templates. The employee portal remains strictly view-only with direct submission disabled.
                    </p>
                  </div>
                </div>

                <div className="pt-4 flex justify-between">
                  <Button type="button" variant="ghost" size="md" onClick={() => setStep(2)} leftIcon={<ArrowLeft className="w-4 h-4" />}>
                    Back
                  </Button>
                  <Button type="submit" variant="primary" size="md" rightIcon={<ArrowRight className="w-4 h-4" />}>
                    Continue to Manager Invite
                  </Button>
                </div>
              </form>
            )}

            {/* STEP 4: MANAGER INVITATION (OPTIONAL) */}
            {step === 4 && (
              <form onSubmit={handleNextStep4} className="space-y-4">
                <div className="p-3.5 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-2xl space-y-1">
                  <div className="text-xs font-bold text-[var(--primary)] flex items-center gap-1.5">
                    <Mail className="w-4 h-4" />
                    <span>Assign Primary Location Manager (Optional)</span>
                  </div>
                  <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                    You can immediately invite the site manager who will handle daily rosters and timesheets for <strong>{locationName}</strong>, or skip and invite them later.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[var(--muted)] uppercase mb-1">
                    Manager Email Address
                  </label>
                  <input
                    type="email"
                    placeholder="manager@yourcompany.com (leave blank to skip)"
                    value={inviteManagerEmail}
                    onChange={e => setInviteManagerEmail(e.target.value)}
                    autoFocus
                    className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-[var(--text)] text-xs outline-none focus:border-[var(--primary)]"
                  />
                  <span className="text-[11px] text-[var(--muted)] mt-1 block">
                    An onboarding link will be sent to set up their manager profile.
                  </span>
                </div>

                <div className="pt-4 flex justify-between">
                  <Button type="button" variant="ghost" size="md" onClick={() => setStep(3)} leftIcon={<ArrowLeft className="w-4 h-4" />}>
                    Back
                  </Button>
                  <Button type="submit" variant="primary" size="md" rightIcon={<ArrowRight className="w-4 h-4" />}>
                    Continue to Review & Finish
                  </Button>
                </div>
              </form>
            )}

            {/* STEP 5: REVIEW & FINISH */}
            {step === 5 && (
              <form onSubmit={handleFinalSubmit} className="space-y-5">
                {/* Summary Box */}
                <div className="p-4 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-2xl space-y-3 text-xs">
                  <h4 className="font-bold text-[var(--text)] uppercase text-[11px] tracking-wider">
                    Configuration Summary
                  </h4>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <span className="text-[var(--muted)] block text-[10px] uppercase">Organisation</span>
                      <strong className="text-[var(--text)]">{orgName}</strong>
                    </div>
                    <div>
                      <span className="text-[var(--muted)] block text-[10px] uppercase">Primary Location</span>
                      <strong className="text-[var(--text)]">{locationName}</strong>
                    </div>
                    <div>
                      <span className="text-[var(--muted)] block text-[10px] uppercase">Workflow Mode</span>
                      <Badge variant="purple" size="sm">
                        {timesheetMode === 'employee' ? 'Employee Submission' : 'Manager Entry'}
                      </Badge>
                    </div>
                    <div>
                      <span className="text-[var(--muted)] block text-[10px] uppercase">Location Manager</span>
                      <strong className="text-[var(--text)] truncate block">
                        {inviteManagerEmail.trim() || 'Unassigned (Owner oversees)'}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Optional Policies Toggle */}
                <div className="p-4 bg-[var(--panel-subtle)]/50 border border-[var(--border)] rounded-2xl space-y-3">
                  <div className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-[var(--primary)]" />
                    <span>Unpaid Break Policy Defaults</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-[var(--muted)] font-semibold mb-0.5">Weekday (mins)</label>
                      <input
                        type="number"
                        min="0"
                        max="180"
                        value={breakMinsWeekday}
                        onChange={e => setBreakMinsWeekday(Number(e.target.value))}
                        className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text)] font-semibold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[var(--muted)] font-semibold mb-0.5">Weekend (mins)</label>
                      <input
                        type="number"
                        min="0"
                        max="180"
                        value={breakMinsWeekend}
                        onChange={e => setBreakMinsWeekend(Number(e.target.value))}
                        className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text)] font-semibold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[var(--muted)] font-semibold mb-0.5">Threshold (hrs)</label>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={breakThresholdHours}
                        onChange={e => setBreakThresholdHours(Number(e.target.value))}
                        className="w-full bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text)] font-semibold outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 flex justify-between">
                  <Button type="button" variant="ghost" size="md" onClick={() => setStep(4)} leftIcon={<ArrowLeft className="w-4 h-4" />}>
                    Back
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    loading={loading}
                    leftIcon={<CheckCircle2 className="w-4 h-4" />}
                  >
                    Complete Setup & Create Organisation
                  </Button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
