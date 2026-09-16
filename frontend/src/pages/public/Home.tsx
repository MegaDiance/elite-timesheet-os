import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { 
  CalendarDays, 
  Clock, 
  Lock, 
  FileSpreadsheet, 
  ShieldCheck, 
  Users, 
  ArrowRight, 
  Search,
  Sparkles
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

export const Home: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeScreenshot, setActiveScreenshot] = useState<'roster' | 'portal'>('roster');
  const navigate = useNavigate();

  const handleQuickSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/portal-access?q=${encodeURIComponent(searchQuery.trim())}`);
    } else {
      navigate('/portal-access');
    }
  };

  const coreFeatures = [
    {
      icon: <CalendarDays className="w-5 h-5 text-indigo-400" />,
      title: 'Fortnight Rostering & Actuals',
      description: 'Manage 14-day shift schedules with side-by-side roster vs actual comparisons. Preserve timesheet history while updating future schedules.',
    },
    {
      icon: <Clock className="w-5 h-5 text-indigo-400" />,
      title: 'Automated Break Rules',
      description: 'Configurable weekday and weekend meal break deductions automatically trigger when shifts exceed specified duration thresholds.',
    },
    {
      icon: <Lock className="w-5 h-5 text-indigo-400" />,
      title: 'Dual-Password Fortnight Locks',
      description: 'Separate passwords for locking draft rosters vs finalising timesheets. Prevent unintended edits before payroll submission.',
    },
    {
      icon: <FileSpreadsheet className="w-5 h-5 text-indigo-400" />,
      title: 'Accountant-Ready Payroll Export',
      description: 'Generate standard RFC 4180 CSV exports and printable HTML/PDF summaries with overtime and normal hours breakdowns.',
    },
    {
      icon: <Users className="w-5 h-5 text-indigo-400" />,
      title: 'Role-Based Workspace Access',
      description: 'Tailored interfaces for Employees, Managers, Company Admins, and Platform Operators with strict multi-tenant isolation.',
    },
    {
      icon: <ShieldCheck className="w-5 h-5 text-indigo-400" />,
      title: 'Enterprise Audit Trail & 2FA',
      description: 'Every shift creation, time adjustment, lock toggle, and export is recorded in an immutable audit ledger with user ID stamps.',
    },
  ];

  return (
    <div className="space-y-24 py-12 md:py-20">
      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--panel-subtle)] border border-[var(--border)] text-xs text-[var(--muted)]">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Multi-Tenant Workforce Architecture</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[var(--text)] leading-[1.1]">
            Precision Rostering & Timesheet Compliance
          </h1>

          <p className="text-base sm:text-lg text-[var(--muted)] leading-relaxed max-w-2xl mx-auto">
            Built for shift-based teams, logistics, healthcare, and enterprise operators. Streamline fortnightly rosters, enforce break policies, and eliminate timesheet disputes.
          </p>

          {/* Hero CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link to="/portal-access">
              <Button variant="primary" size="lg" rightIcon={<ArrowRight className="w-4 h-4" />}>
                Go to Portal
              </Button>
            </Link>
            <Link to="/features">
              <Button variant="secondary" size="lg">
                Explore Features
              </Button>
            </Link>
          </div>

          {/* Quick Workplace Search / Portal Entry */}
          <form onSubmit={handleQuickSearch} className="max-w-xl mx-auto pt-4">
            <div className="flex flex-col sm:flex-row items-center gap-2 bg-[var(--panel)] p-2 rounded-lg border border-[var(--border)] shadow-sm">
              <div className="relative flex-1 w-full flex items-center">
                <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Enter organisation name or slug (e.g. acme)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent pl-9 pr-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)]/60 focus:outline-none"
                />
              </div>
              <Button type="submit" variant="primary" size="md" className="w-full sm:w-auto shrink-0" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                Go to Portal
              </Button>
            </div>
            <p className="text-xs text-[var(--muted)] mt-2 text-left sm:text-center">
              Locate your organisation to access your dedicated workplace login.
            </p>
          </form>
        </div>

        {/* Realistic Product Showcase / Screenshot Gallery */}
        <div className="mt-16 relative max-w-6xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-1.5 p-1 bg-[var(--panel)] border border-[var(--border)] rounded-lg">
              <button
                type="button"
                onClick={() => setActiveScreenshot('roster')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeScreenshot === 'roster'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                14-Day Master Roster
              </button>
              <button
                type="button"
                onClick={() => setActiveScreenshot('portal')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeScreenshot === 'portal'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                Employee Portal & Approvals
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Production UI Screenshots</span>
            </div>
          </div>

          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden group">
            {/* macOS-style Window Header */}
            <div className="px-4 py-3 bg-[var(--panel-subtle)] border-b border-[var(--border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-rose-500/80" />
                <span className="w-3 h-3 rounded-full bg-amber-500/80" />
                <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
                <div className="ml-3 hidden sm:flex items-center px-2.5 py-0.5 rounded bg-[var(--panel)] border border-[var(--border)] text-[11px] font-mono text-[var(--muted)]">
                  {activeScreenshot === 'roster' 
                    ? 'https://app.timesheetos.com/app/roster?fortnight=2026-03-30'
                    : 'https://app.timesheetos.com/app/portal?view=shifts'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {activeScreenshot === 'roster' ? (
                  <>
                    <Badge variant="success" size="sm">Dual-Locked</Badge>
                    <Badge variant="purple" size="sm">14-Day Fit</Badge>
                  </>
                ) : (
                  <>
                    <Badge variant="success" size="sm">Timesheet Approved</Badge>
                    <Badge variant="info" size="sm">One-Click Submit</Badge>
                  </>
                )}
              </div>
            </div>

            {/* Screenshot Display */}
            <div className="relative bg-black/40 overflow-hidden flex items-center justify-center min-h-[380px] sm:min-h-[500px]">
              <img
                src={activeScreenshot === 'roster' ? '/screenshots/roster_overview.jpg' : '/screenshots/employee_portal.jpg'}
                alt={activeScreenshot === 'roster' ? '14-Day Master Fortnight Roster View' : 'Employee Self-Service Timesheet Portal'}
                className="w-full h-auto object-cover object-top border-b border-[var(--border)] transition-transform duration-300 group-hover:scale-[1.008]"
                loading="eager"
              />
            </div>

            {/* Caption & Quick Insights */}
            <div className="p-4 sm:p-5 bg-[var(--panel)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs border-t border-[var(--border)]">
              <div className="space-y-0.5">
                <div className="font-semibold text-[var(--text)]">
                  {activeScreenshot === 'roster'
                    ? 'Full 14-Day Fortnight Grid without Horizontal Scrolling'
                    : 'Streamlined Employee Submission & Approval Workflow'}
                </div>
                <div className="text-[var(--muted)]">
                  {activeScreenshot === 'roster'
                    ? 'Automated break deductions, overtime breakdowns, shift publishing, and dual-password protection.'
                    : 'Real-time shift summary, leave requests, announcements with emoji reactions, and instant lock compliance.'}
                </div>
              </div>
              <Link to="/features" className="shrink-0">
                <Button variant="secondary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                  Explore Full Tech Specs
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Grid Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-16 space-y-3">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">
            Architected for Operational Integrity
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Every feature is designed to reduce payroll preparation overhead and enforce Fair Work award compliance.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {coreFeatures.map((feat, idx) => (
            <Card key={idx} hoverable className="space-y-3 p-6">
              <div className="w-10 h-10 rounded-lg bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center">
                {feat.icon}
              </div>
              <h3 className="font-semibold text-base text-[var(--text)] tracking-tight">
                {feat.title}
              </h3>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                {feat.description}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* Direct Navigation Call to Action */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 sm:p-12 flex flex-col md:flex-row items-center justify-between gap-8 shadow-sm">
          <div className="space-y-2 max-w-xl">
            <h2 className="text-2xl font-bold text-[var(--text)]">
              Already have an organisation registered?
            </h2>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              Find your company’s branded workspace portal to access your roster, view team shifts, and submit timesheets.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
            <Link to="/portal-access" className="w-full sm:w-auto">
              <Button variant="primary" size="lg" className="w-full" rightIcon={<ArrowRight className="w-4 h-4" />}>
                Go to Portal
              </Button>
            </Link>
            <Link to="/features" className="w-full sm:w-auto">
              <Button variant="outline" size="lg" className="w-full" rightIcon={<ArrowRight className="w-4 h-4" />}>
                Learn More
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};
