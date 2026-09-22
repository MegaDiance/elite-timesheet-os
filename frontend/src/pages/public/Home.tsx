import React from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  Lock,
  FileSpreadsheet,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Layers,
  ClipboardCheck,
  SlidersHorizontal,
  Building2,
  UserCog,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

const pillars = [
  {
    icon: <CalendarDays className="w-5 h-5 text-[var(--primary)]" />,
    title: 'Fortnightly roster',
    description: 'Plan all 14 days of a pay period on one screen. Start from each worker’s template, copy a day across the team, or auto-roster the fortnight.',
  },
  {
    icon: <Layers className="w-5 h-5 text-[var(--primary)]" />,
    title: 'Multi-segment days',
    description: 'Split shifts and part-day leave are just more segments on the day: Normal Work, Sick Leave, Annual Leave, TIL, LWIP or Other.',
  },
  {
    icon: <SlidersHorizontal className="w-5 h-5 text-[var(--primary)]" />,
    title: 'Breaks worked out for you',
    description: 'Set your unpaid break once, with separate weekday and weekend lengths. It’s taken once per day when the day reaches your threshold.',
  },
  {
    icon: <ClipboardCheck className="w-5 h-5 text-[var(--primary)]" />,
    title: 'Timesheets and approval',
    description: 'Record the hours actually worked beside the roster, see the variance, approve each worker’s fortnight and reopen it if something needs fixing.',
  },
  {
    icon: <Lock className="w-5 h-5 text-[var(--primary)]" />,
    title: 'Per-branch locks',
    description: 'Each branch locks its roster and its timesheets for a fortnight, protected by a password, so finished periods stay finished.',
  },
  {
    icon: <FileSpreadsheet className="w-5 h-5 text-[var(--primary)]" />,
    title: 'Payroll-hours reports',
    description: 'Hours by category for every worker: normal, Saturday, Sunday, public holiday, leave and LWIP. Export to CSV or PDF for your payroll.',
  },
];

export const Home: React.FC = () => {
  return (
    <div className="space-y-24 py-12 md:py-20">
      {/* Hero */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--panel-subtle)] border border-[var(--border)] text-xs text-[var(--muted)] font-medium">
            <Sparkles className="w-3.5 h-3.5 text-[var(--primary)]" />
            <span>Rosters and timesheets for teams with one branch or many</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[var(--text)] leading-[1.12]">
            Rosters and timesheets, without the spreadsheet.
          </h1>

          <p className="text-base sm:text-lg text-[var(--muted)] leading-relaxed max-w-2xl mx-auto">
            SimpleHours lets you plan each fortnight, record the hours actually worked, approve them and hand payroll a clean
            report. The Organisation Owner sets things up; Branch Admins run their own branches.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link to="/signup" className="w-full sm:w-auto">
              <Button variant="primary" size="lg" className="w-full" rightIcon={<ArrowRight className="w-4 h-4" />}>
                Get started
              </Button>
            </Link>
            <Link to="/features" className="w-full sm:w-auto">
              <Button variant="secondary" size="lg" className="w-full">
                See how it works
              </Button>
            </Link>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 pt-4 text-xs text-[var(--muted)]">
            {['14-day roster grid', 'Split shifts and part-day leave', 'CSV and PDF payroll exports'].map(point => (
              <span key={point} className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-[var(--success)]" />
                {point}
              </span>
            ))}
          </div>
        </div>

        {/* Product view */}
        <div className="mt-16 relative max-w-5xl mx-auto">
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden">
            <div className="px-4 py-3 bg-[var(--panel-subtle)] border-b border-[var(--border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                <span className="ml-3 hidden sm:inline text-xs font-medium text-[var(--muted)]">Roster · fortnight starting Sunday 29 March</span>
              </div>
              <Badge variant="info" size="sm">14-day view</Badge>
            </div>

            <div className="relative bg-black/5 overflow-hidden flex items-center justify-center min-h-[360px] sm:min-h-[480px]">
              <img
                src="/screenshots/roster_overview.jpg"
                alt="The SimpleHours fortnightly roster"
                className="w-full h-auto object-cover object-top border-b border-[var(--border)]"
                loading="eager"
              />
            </div>

            <div className="p-4 sm:p-5 bg-[var(--panel)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs border-t border-[var(--border)]">
              <div>
                <div className="font-semibold text-sm text-[var(--text)]">The whole fortnight on one screen</div>
                <div className="text-xs text-[var(--muted)] mt-0.5">
                  Rostered and worked hours side by side, with overlaps caught and breaks worked out as you type.
                </div>
              </div>
              <Link to="/features" className="shrink-0">
                <Button variant="secondary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                  Explore features
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-14 space-y-3">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">Everything a fortnight needs</h2>
          <p className="text-sm text-[var(--muted)]">From the first shift you plan to the report you send to payroll.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {pillars.map(p => (
            <Card key={p.title} hoverable className="space-y-3 p-6">
              <div className="w-10 h-10 rounded-lg bg-[var(--primary-light)] border border-[var(--primary)]/20 flex items-center justify-center">
                {p.icon}
              </div>
              <h3 className="font-semibold text-base text-[var(--text)]">{p.title}</h3>
              <p className="text-xs text-[var(--muted)] leading-relaxed">{p.description}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 border-y border-[var(--border)] bg-[var(--panel-subtle)]/40">
        <div className="text-center max-w-2xl mx-auto mb-12 space-y-2">
          <Badge variant="info" size="sm">Three steps</Badge>
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)]">How SimpleHours works</h2>
          <p className="text-xs sm:text-sm text-[var(--muted)]">Every step has a clear owner.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {[
            {
              title: 'Set up your organisation',
              body: 'The Organisation Owner signs up, creates the branches and invites a Branch Admin for each one. Each Branch Admin sees only the branches they’re given.',
            },
            {
              title: 'Roster and record',
              body: 'Branch Admins add their workers, build the fortnight roster and record the hours actually worked, including split shifts and leave.',
            },
            {
              title: 'Approve, lock and export',
              body: 'Approve each worker’s timesheet, lock the branch’s fortnight so it can’t drift, and export payroll hours as CSV or PDF.',
            },
          ].map((stepItem, idx) => (
            <div key={stepItem.title} className="bg-[var(--panel)] p-6 rounded-xl border border-[var(--border)] space-y-3">
              <div className="w-8 h-8 rounded-full bg-[var(--primary)] text-white font-bold text-sm flex items-center justify-center">{idx + 1}</div>
              <h3 className="font-semibold text-sm text-[var(--text)]">{stepItem.title}</h3>
              <p className="text-xs text-[var(--muted)] leading-relaxed">{stepItem.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Two roles */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12 space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)]">Two roles, no guesswork</h2>
          <p className="text-xs sm:text-sm text-[var(--muted)]">
            Only the people who manage rosters and timesheets sign in. Workers don't need an account.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card className="p-6 sm:p-8 space-y-5">
            <div className="flex items-center gap-2.5 pb-3 border-b border-[var(--border)]">
              <div className="w-8 h-8 rounded-lg bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-base text-[var(--text)]">Organisation Owner</h3>
                <p className="text-xs text-[var(--muted)]">The whole organisation</p>
              </div>
            </div>
            <ul className="space-y-3 text-xs text-[var(--text)]">
              {[
                'Creates branches and invites Branch Admins',
                'Sees every branch’s roster, timesheets and reports',
                'Sets break rules, lock passwords and public holidays',
                'Reviews the audit log of who changed what',
              ].map(item => (
                <li key={item} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-6 sm:p-8 space-y-5">
            <div className="flex items-center gap-2.5 pb-3 border-b border-[var(--border)]">
              <div className="w-8 h-8 rounded-lg bg-[var(--success-light)] text-[var(--success)] flex items-center justify-center">
                <UserCog className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-base text-[var(--text)]">Branch Admin</h3>
                <p className="text-xs text-[var(--muted)]">Only the branches they’re given</p>
              </div>
            </div>
            <ul className="space-y-3 text-xs text-[var(--text)]">
              {[
                'Adds and updates the workers in their branches',
                'Builds the fortnight roster, including split shifts and leave',
                'Records worked hours, then approves or reopens timesheets',
                'Locks their branch’s fortnight and runs payroll-hours reports',
              ].map(item => (
                <li key={item} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[var(--success)] shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>

      {/* Security */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 sm:p-10 space-y-6">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--primary)]">
            <ShieldCheck className="w-4 h-4" />
            <span>Security</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            <div className="space-y-2">
              <h4 className="font-semibold text-sm text-[var(--text)]">Access by branch</h4>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Every request is checked on the server against the account's role and branches. Each organisation has its own private sign-in link.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-sm text-[var(--text)]">Audit log</h4>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Sign-ins, approvals, lock changes and other edits are recorded with who made them and when.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-sm text-[var(--text)]">Sign-in protection</h4>
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Optional two-step verification by email, checks on sign-ins from new places and automatic sign-out after 15 minutes without activity.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Call to action */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-[var(--panel-subtle)] border border-[var(--border)] rounded-2xl p-8 sm:p-12 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <h2 className="text-2xl font-bold text-[var(--text)]">Ready for an easier fortnight?</h2>
            <p className="text-xs sm:text-sm text-[var(--muted)] leading-relaxed">
              Set up your organisation in a few minutes: add your first branch, then invite your Branch Admins.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
            <Link to="/signup" className="w-full sm:w-auto">
              <Button variant="primary" size="lg" className="w-full" rightIcon={<ArrowRight className="w-4 h-4" />}>
                Get started
              </Button>
            </Link>
            <Link to="/login" className="w-full sm:w-auto">
              <Button variant="outline" size="lg" className="w-full">
                Sign in
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};
