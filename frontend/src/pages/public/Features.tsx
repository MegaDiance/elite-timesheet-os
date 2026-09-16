import React from 'react';
import { 
  Calendar, 
  Clock, 
  Lock, 
  Layers, 
  Check, 
  ArrowRight,
  Database,
  Building2,
  KeyRound
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

export const Features: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-20">
      {/* Header */}
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-[var(--text)]">
          Technical Specifications & Architecture
        </h1>
        <p className="text-base text-[var(--muted)] leading-relaxed">
          A granular look into the underlying algorithms, compliance models, and security guarantees built into Elite Timesheet OS Pro.
        </p>
      </div>

      {/* Deep Dive Section 1: Rostering */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-4">
          <div className="w-10 h-10 rounded-lg bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Calendar className="w-5 h-5" />
          </div>
          <h2 className="text-2xl font-bold text-[var(--text)]">
            Fortnight Rostering & Actual Shift Reconciliation
          </h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            The core scheduling engine operates on strict 14-day fortnight cycles mapped from Day 0 through Day 13. Shift segments differentiate between planned roster hours and verified actual hours worked.
          </p>
          <ul className="space-y-2.5 text-xs text-[var(--muted)]">
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <span><strong>Preserved Actuals:</strong> Updating future shifts never overwrites historic actual attendance or clock-in records.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <span><strong>Smart Time Input:</strong> Accepts flexible operator time entry (<code className="text-indigo-400">7</code>, <code className="text-indigo-400">0730</code>, <code className="text-indigo-400">3p</code>, <code className="text-indigo-400">15:30</code>) and standardizes automatically.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <span><strong>Roster Templates:</strong> Save recurring shift patterns per staff member and deploy across future fortnights in seconds.</span>
            </li>
          </ul>
        </div>
        <Card className="p-6 space-y-4 bg-[var(--panel-subtle)] font-mono text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-[var(--border)] text-[var(--muted)]">
            <span>SHIFT_SEGMENT_SPEC</span>
            <span className="text-emerald-400">STRICT_VALIDATION</span>
          </div>
          <div className="text-[var(--text)] space-y-1">
            <div><span className="text-indigo-400">segment_id:</span> "seg_91823-uuid"</div>
            <div><span className="text-indigo-400">roster_hours:</span> 8.00</div>
            <div><span className="text-indigo-400">actual_hours:</span> 8.50</div>
            <div><span className="text-indigo-400">break_deducted:</span> 0.50 (30 mins)</div>
            <div><span className="text-indigo-400">overtime_tier_1:</span> 0.50</div>
            <div><span className="text-indigo-400">is_published:</span> true</div>
          </div>
        </Card>
      </div>

      {/* Deep Dive Section 2: Break Deductions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <Card className="p-6 space-y-4 bg-[var(--panel-subtle)] font-mono text-xs order-2 lg:order-1">
          <div className="flex items-center justify-between pb-2 border-b border-[var(--border)] text-[var(--muted)]">
            <span>COMPLIANCE_RULES_ENGINE</span>
            <span className="text-indigo-400">ORG_CONFIGURABLE</span>
          </div>
          <div className="text-[var(--text)] space-y-1">
            <div><span className="text-indigo-400">break_mins_weekday:</span> 30</div>
            <div><span className="text-indigo-400">break_mins_weekend:</span> 0</div>
            <div><span className="text-indigo-400">break_threshold_hours:</span> 6.0</div>
            <div><span className="text-indigo-400">timezone_safe_date:</span> "YYYY-MM-DD" (OID 1082)</div>
          </div>
        </Card>
        <div className="space-y-4 order-1 lg:order-2">
          <div className="w-10 h-10 rounded-lg bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Clock className="w-5 h-5" />
          </div>
          <h2 className="text-2xl font-bold text-[var(--text)]">
            Automated Break Deductions & Fair Work Alignment
          </h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            Eliminate tedious manual math for break adjustments. The engine evaluates every shift segment against tenant-defined threshold policies.
          </p>
          <ul className="space-y-2.5 text-xs text-[var(--muted)]">
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <span><strong>Threshold Evaluation:</strong> Automatically subtracts designated meal breaks when continuous shift duration exceeds the threshold (e.g. 6.0 hours).</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <span><strong>Day-Specific Flexibility:</strong> Different deduction rates can be configured for weekday versus weekend shifts.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <span><strong>Public Holiday Calendar:</strong> Built-in public holiday tables overlay shift calculations for penalty rate determination.</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Deep Dive Section 3: Dual Passwords & Security */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-4">
          <div className="w-10 h-10 rounded-lg bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Lock className="w-5 h-5" />
          </div>
          <h2 className="text-2xl font-bold text-[var(--text)]">
            Dual-Password Fortnight Locks & Publication Control
          </h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            Separate operational milestones ensure draft schedules are protected from tampering and finalized payroll numbers are frozen.
          </p>
          <ul className="space-y-2.5 text-xs text-[var(--muted)]">
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <span><strong>Roster Lock Password:</strong> Restricts editing of scheduled shifts while permitting employee actual time entry.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <span><strong>Timesheet Lock Password:</strong> Freezes actuals completely once approved by management, safeguarding export data.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <span><strong>Automated Publication Alerts:</strong> Publishing a finalized roster dispatches an instant announcement to the staff portal.</span>
            </li>
          </ul>
        </div>
        <Card className="p-6 space-y-4 bg-[var(--panel-subtle)] font-mono text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-[var(--border)] text-[var(--muted)]">
            <span>LOCK_SECURITY_POLICY</span>
            <span className="text-rose-400">ENFORCED</span>
          </div>
          <div className="text-[var(--text)] space-y-1">
            <div><span className="text-indigo-400">roster_lock_status:</span> LOCKED</div>
            <div><span className="text-indigo-400">timesheet_lock_status:</span> LOCKED</div>
            <div><span className="text-indigo-400">auth_method:</span> DEDICATED_BCRYPT_HASH</div>
            <div><span className="text-indigo-400">master_admin_override:</span> ENABLED</div>
            <div><span className="text-indigo-400">audit_action:</span> "LOCKED_ROSTER_2026-03-30"</div>
          </div>
        </Card>
      </div>

      {/* Feature Badges Grid */}
      <div className="border-t border-[var(--border)] pt-16">
        <h3 className="text-xl font-bold text-center text-[var(--text)] mb-8">
          Enterprise Multi-Tenant Infrastructure
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-center space-y-1">
            <Database className="w-5 h-5 text-indigo-400 mx-auto" />
            <h4 className="font-semibold text-xs text-[var(--text)]">Supabase & PostgreSQL</h4>
            <p className="text-[11px] text-[var(--muted)]">Production-ready schema</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-center space-y-1">
            <Building2 className="w-5 h-5 text-indigo-400 mx-auto" />
            <h4 className="font-semibold text-xs text-[var(--text)]">Strict Tenant Isolation</h4>
            <p className="text-[11px] text-[var(--muted)]">No cross-org leaks</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-center space-y-1">
            <KeyRound className="w-5 h-5 text-indigo-400 mx-auto" />
            <h4 className="font-semibold text-xs text-[var(--text)]">Two-Factor Auth</h4>
            <p className="text-[11px] text-[var(--muted)]">Email OTP with lockouts</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--panel)] border border-[var(--border)] text-center space-y-1">
            <Layers className="w-5 h-5 text-indigo-400 mx-auto" />
            <h4 className="font-semibold text-xs text-[var(--text)]">Zero-Dependency Dev</h4>
            <p className="text-[11px] text-[var(--muted)]">Full in-memory pg-mem</p>
          </div>
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="text-center pt-8">
        <Link to="/portal-access">
          <Button variant="primary" size="lg" rightIcon={<ArrowRight className="w-4 h-4" />}>
            Go to Portal
          </Button>
        </Link>
      </div>
    </div>
  );
};
