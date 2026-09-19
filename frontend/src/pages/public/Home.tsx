import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  CalendarDays, 
  Lock, 
  FileSpreadsheet, 
  ShieldCheck, 
  ArrowRight, 
  CheckCircle2,
  Sparkles,
  Smartphone,
  BarChart3,
  SlidersHorizontal
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

export const Home: React.FC = () => {
  const [activeScreenshot, setActiveScreenshot] = useState<'roster' | 'portal'>('roster');

  const pillars = [
    {
      icon: <CalendarDays className="w-5 h-5 text-[var(--primary)]" />,
      title: '14-Day Fortnight Scheduling',
      description: 'Build balanced shift rosters mapped to two-week pay cycles without horizontal spreadsheet friction.',
    },
    {
      icon: <SlidersHorizontal className="w-5 h-5 text-[var(--primary)]" />,
      title: 'Automated Break Deductions',
      description: 'Define weekday and weekend meal break thresholds that calculate automatically when shifts exceed designated hours.',
    },
    {
      icon: <Lock className="w-5 h-5 text-[var(--primary)]" />,
      title: 'Dual-Password Fortnight Locks',
      description: 'Lock draft rosters before publishing to staff, and lock completed timesheets separately to seal payroll data.',
    },
    {
      icon: <FileSpreadsheet className="w-5 h-5 text-[var(--primary)]" />,
      title: 'Payroll Preparation & CSV Export',
      description: 'Export clean RFC 4180 CSV files and printable summaries separated by standard, weekend, holiday, and overtime hours.',
    },
    {
      icon: <Smartphone className="w-5 h-5 text-[var(--primary)]" />,
      title: 'Mobile Employee Self-Service',
      description: 'Staff view their scheduled shifts, record clock-in/out actuals, request leave, and submit timesheets from any device.',
    },
    {
      icon: <ShieldCheck className="w-5 h-5 text-[var(--primary)]" />,
      title: 'Strict Multi-Tenant Isolation',
      description: 'Every organization is completely partitioned with isolated workspace URLs, role permissions, and immutable audit logs.',
    },
  ];

  return (
    <div className="space-y-24 py-12 md:py-20">
      {/* 1. Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--panel-subtle)] border border-[var(--border)] text-xs text-[var(--muted)] font-medium">
            <Sparkles className="w-3.5 h-3.5 text-[var(--primary)]" />
            <span>Workforce Management Built for Shift Teams</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[var(--text)] leading-[1.12]">
            Scheduling and timesheets, without the chaos.
          </h1>

          <p className="text-base sm:text-lg text-[var(--muted)] leading-relaxed max-w-2xl mx-auto">
            Simple Hours helps clinics, retail, logistics, and shift-based teams draft 14-day rosters in minutes, track real attendance, and approve payroll-ready timesheets with confidence.
          </p>

          {/* Hero CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link to="/portal-access" className="w-full sm:w-auto">
              <Button variant="primary" size="lg" className="w-full" rightIcon={<ArrowRight className="w-4 h-4" />}>
                Go to Workspace Login
              </Button>
            </Link>
            <Link to="/features" className="w-full sm:w-auto">
              <Button variant="secondary" size="lg" className="w-full">
                Explore Product Features
              </Button>
            </Link>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 pt-4 text-xs text-[var(--muted)]">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--success)]" />
              14-Day Fortnight Grid
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--success)]" />
              Automated Break Calculations
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--success)]" />
              Dual-Gate Payroll Protection
            </span>
          </div>
        </div>

        {/* 2. Product Interface Visual Showcase */}
        <div className="mt-16 relative max-w-5xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-1 p-1 bg-[var(--panel-subtle)] border border-[var(--border)] rounded-lg">
              <button
                type="button"
                onClick={() => setActiveScreenshot('roster')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeScreenshot === 'roster'
                    ? 'bg-[var(--panel)] text-[var(--text)] shadow-xs font-semibold'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                14-Day Manager Roster
              </button>
              <button
                type="button"
                onClick={() => setActiveScreenshot('portal')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeScreenshot === 'portal'
                    ? 'bg-[var(--panel)] text-[var(--text)] shadow-xs font-semibold'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                Employee Self-Service
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs text-[var(--muted)] font-medium">
              <span className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse" />
              <span>Production Product Views</span>
            </div>
          </div>

          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden">
            {/* Window Frame Bar */}
            <div className="px-4 py-3 bg-[var(--panel-subtle)] border-b border-[var(--border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                <div className="ml-3 hidden sm:flex items-center px-3 py-1 rounded bg-[var(--panel)] border border-[var(--border)] text-xs font-mono text-[var(--muted)]">
                  {activeScreenshot === 'roster'
                    ? 'https://app.simplehours.com/roster?cycle=2026-03-29'
                    : 'https://app.simplehours.com/portal'}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {activeScreenshot === 'roster' ? (
                  <>
                    <Badge variant="success" size="sm">Dual Locked</Badge>
                    <Badge variant="info" size="sm">14-Day View</Badge>
                  </>
                ) : (
                  <>
                    <Badge variant="success" size="sm">Timesheet Approved</Badge>
                    <Badge variant="outline" size="sm">Employee Self-Service</Badge>
                  </>
                )}
              </div>
            </div>

            {/* Actual Screenshot Visual */}
            <div className="relative bg-black/5 overflow-hidden flex items-center justify-center min-h-[360px] sm:min-h-[480px]">
              <img
                src={activeScreenshot === 'roster' ? '/screenshots/roster_overview.jpg' : '/screenshots/employee_portal.jpg'}
                alt={activeScreenshot === 'roster' ? 'Simple Hours 14-Day Roster Grid' : 'Simple Hours Employee Portal'}
                className="w-full h-auto object-cover object-top border-b border-[var(--border)]"
                loading="eager"
              />
            </div>

            {/* Visual Footer Caption */}
            <div className="p-4 sm:p-5 bg-[var(--panel)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs border-t border-[var(--border)]">
              <div>
                <div className="font-semibold text-sm text-[var(--text)]">
                  {activeScreenshot === 'roster'
                    ? 'Complete 14-Day Fortnight Grid on One Screen'
                    : 'Simple, Focused Staff Portal for Shifts & Submissions'}
                </div>
                <div className="text-xs text-[var(--muted)] mt-0.5">
                  {activeScreenshot === 'roster'
                    ? 'Edit shifts in seconds, auto-apply meal break deductions, and prevent shift overlaps.'
                    : 'Staff inspect their rostered shifts, log actual attendance, submit leave, and review approvals.'}
                </div>
              </div>
              <Link to="/features" className="shrink-0">
                <Button variant="secondary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                  Explore Details
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Core Capability Pillars */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-14 space-y-3">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">
            Everything your shift team needs, nothing they don't
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Designed to replace error-prone spreadsheets with a reliable, structured scheduling and timesheet workflow.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {pillars.map((p, idx) => (
            <Card key={idx} hoverable className="space-y-3 p-6">
              <div className="w-10 h-10 rounded-lg bg-[var(--primary-light)] border border-[var(--primary)]/20 flex items-center justify-center">
                {p.icon}
              </div>
              <h3 className="font-semibold text-base text-[var(--text)]">
                {p.title}
              </h3>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                {p.description}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* 4. How Scheduling & Timesheets Work */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 border-y border-[var(--border)] bg-[var(--panel-subtle)]/40">
        <div className="text-center max-w-2xl mx-auto mb-12 space-y-2">
          <Badge variant="info" size="sm">Simple 3-Step Process</Badge>
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)]">
            How Simple Hours Works
          </h2>
          <p className="text-xs sm:text-sm text-[var(--muted)]">
            From shift planning to payroll sign-off, every step has clear ownership.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <div className="bg-[var(--panel)] p-6 rounded-xl border border-[var(--border)] space-y-3">
            <div className="w-8 h-8 rounded-full bg-[var(--primary)] text-white font-bold text-sm flex items-center justify-center">
              1
            </div>
            <h3 className="font-semibold text-sm text-[var(--text)]">Draft & Publish the Roster</h3>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Managers assign shifts across the 14-day cycle using employee templates or flexible time inputs. Once finalized, lock the roster and publish it to the team.
            </p>
          </div>

          <div className="bg-[var(--panel)] p-6 rounded-xl border border-[var(--border)] space-y-3">
            <div className="w-8 h-8 rounded-full bg-[var(--primary)] text-white font-bold text-sm flex items-center justify-center">
              2
            </div>
            <h3 className="font-semibold text-sm text-[var(--text)]">Staff Work & Submit Actuals</h3>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Employees see their published shifts on web or mobile. At the end of the pay period, they confirm actual hours worked, note any variations, and submit for review.
            </p>
          </div>

          <div className="bg-[var(--panel)] p-6 rounded-xl border border-[var(--border)] space-y-3">
            <div className="w-8 h-8 rounded-full bg-[var(--primary)] text-white font-bold text-sm flex items-center justify-center">
              3
            </div>
            <h3 className="font-semibold text-sm text-[var(--text)]">Review, Lock & Export</h3>
            <p className="text-xs text-[var(--muted)] leading-relaxed">
              Managers compare rostered vs actual hours, approve submissions with one click, lock the timesheet fortnight, and export clean CSV reports ready for payroll.
            </p>
          </div>
        </div>
      </section>

      {/* 5. Manager vs Employee Experience Side-by-Side */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12 space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)]">
            Tailored Experiences for Every Role
          </h2>
          <p className="text-xs sm:text-sm text-[var(--muted)]">
            Managers get dense operational control; employees get a clean, uncluttered self-service schedule.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Manager Experience Card */}
          <Card className="p-6 sm:p-8 space-y-5 border-[var(--border)]">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-[var(--text)]">Manager Command Centre</h3>
                  <p className="text-xs text-[var(--muted)]">Operational oversight & compliance control</p>
                </div>
              </div>
              <Badge variant="purple" size="sm">Manager View</Badge>
            </div>

            <ul className="space-y-3 text-xs text-[var(--text)]">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
                <span><strong>Live Shift Attendance:</strong> See who is scheduled, who is on the floor, and track unplanned shifts in real time.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
                <span><strong>14-Day Roster Grid:</strong> Fast keyboard-driven time entry with conflict warnings and automatic break deductions.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
                <span><strong>Bulk Timesheet Approvals:</strong> Compare planned vs logged hours, return timesheets with feedback, or approve with one click.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
                <span><strong>Dual Fortnight Locks:</strong> Enforce separate passwords for finalizing shift schedules and sealing payroll cycles.</span>
              </li>
            </ul>
          </Card>

          {/* Employee Experience Card */}
          <Card className="p-6 sm:p-8 space-y-5 border-[var(--border)]">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[var(--success-light)] text-[var(--success)] flex items-center justify-center">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-[var(--text)]">Employee Portal</h3>
                  <p className="text-xs text-[var(--muted)]">Mobile-friendly shifts and timesheets</p>
                </div>
              </div>
              <Badge variant="success" size="sm">Staff View</Badge>
            </div>

            <ul className="space-y-3 text-xs text-[var(--text)]">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[var(--success)] shrink-0 mt-0.5" />
                <span><strong>Personal Shift Schedule:</strong> Clear view of upcoming shifts once published by management.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[var(--success)] shrink-0 mt-0.5" />
                <span><strong>Actual Hours Logging:</strong> Log start, finish, and break times directly from phone or desktop.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[var(--success)] shrink-0 mt-0.5" />
                <span><strong>Fortnight Submission:</strong> One-tap timesheet submission with real-time status tracking (Draft, Under Review, Approved).</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[var(--success)] shrink-0 mt-0.5" />
                <span><strong>Leave Application:</strong> Request annual, sick, or personal leave with transparent manager approvals.</span>
              </li>
            </ul>
          </Card>
        </div>
      </section>

      {/* 6. Security & Compliance */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 sm:p-10 space-y-6">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--primary)]">
            <ShieldCheck className="w-4 h-4" />
            <span>Enterprise Security & Data Protection</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            <div className="space-y-2">
              <h4 className="font-semibold text-sm text-[var(--text)]">Tenant Data Isolation</h4>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Every business accesses their dedicated workspace via private URLs. Database queries are strictly scoped by organisation membership to prevent cross-tenant exposure.
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="font-semibold text-sm text-[var(--text)]">Immutable Audit Trail</h4>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Every shift update, lock change, approval, and payroll export is permanently recorded with actor stamps, timestamp, and entity details.
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="font-semibold text-sm text-[var(--text)]">Session Security & 2FA</h4>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Optional email-based two-factor authentication, suspicious login detection, 15-minute inactivity timeouts, and active session management.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Call to Action Banner */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-[var(--panel-subtle)] border border-[var(--border)] rounded-2xl p-8 sm:p-12 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <h2 className="text-2xl font-bold text-[var(--text)]">
              Ready to streamline your team's scheduling?
            </h2>
            <p className="text-xs sm:text-sm text-[var(--muted)] leading-relaxed">
              Sign in with your organisation's dedicated workspace URL, or contact your administrator for your invitation.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
            <Link to="/portal-access" className="w-full sm:w-auto">
              <Button variant="primary" size="lg" className="w-full" rightIcon={<ArrowRight className="w-4 h-4" />}>
                Workspace Sign In
              </Button>
            </Link>
            <Link to="/features" className="w-full sm:w-auto">
              <Button variant="outline" size="lg" className="w-full">
                Learn More
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};
