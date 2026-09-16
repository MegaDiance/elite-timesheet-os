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
  Sparkles,
  Building
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

export const Home: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const handleQuickSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/find-organisation?q=${encodeURIComponent(searchQuery.trim())}`);
    } else {
      navigate('/find-organisation');
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

          {/* Quick Search Workplace Form */}
          <form onSubmit={handleQuickSearch} className="max-w-xl mx-auto pt-2">
            <div className="flex flex-col sm:flex-row items-center gap-2 bg-[var(--panel)] p-2 rounded-lg border border-[var(--border)] shadow-sm">
              <div className="relative flex-1 w-full flex items-center">
                <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Enter your organisation name or slug..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent pl-9 pr-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)]/60 focus:outline-none"
                />
              </div>
              <Button type="submit" variant="primary" size="md" className="w-full sm:w-auto shrink-0">
                Find Workplace
              </Button>
            </div>
            <p className="text-xs text-[var(--muted)] mt-2 text-left sm:text-center">
              Looking for a specific tenant? You can search by workplace name or custom subdomain.
            </p>
          </form>
        </div>

        {/* Live UI Mock / Architecture Preview */}
        <div className="mt-16 relative max-w-5xl mx-auto">
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
            {/* Window header */}
            <div className="px-4 py-3 bg-[var(--panel-subtle)] border-b border-[var(--border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-rose-500/80" />
                <span className="w-3 h-3 rounded-full bg-amber-500/80" />
                <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
                <span className="ml-2 text-xs font-mono text-[var(--muted)]">fortnight-view / 2026-03-30 → 2026-04-12</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="success" size="sm">Roster Locked</Badge>
                <Badge variant="purple" size="sm">Published to Staff</Badge>
              </div>
            </div>

            {/* Mock Roster Grid */}
            <div className="p-6 space-y-4 overflow-x-auto font-sans">
              <div className="grid grid-cols-12 gap-3 pb-3 border-b border-[var(--border)] text-xs font-semibold text-[var(--muted)]">
                <div className="col-span-3">STAFF MEMBER</div>
                <div className="col-span-2 text-center">MON 30 MAR</div>
                <div className="col-span-2 text-center">TUE 31 MAR</div>
                <div className="col-span-2 text-center">WED 01 APR</div>
                <div className="col-span-3 text-right">TOTAL RECORDED</div>
              </div>

              {/* Row 1 */}
              <div className="grid grid-cols-12 gap-3 items-center text-xs py-2 border-b border-[var(--border)]/50">
                <div className="col-span-3">
                  <div className="font-semibold text-[var(--text)]">Alice Springs</div>
                  <div className="text-[11px] text-[var(--muted)]">Logistics • Transport</div>
                </div>
                <div className="col-span-2 text-center">
                  <span className="inline-block px-2 py-1 rounded bg-[var(--panel-subtle)] border border-[var(--border)] font-mono text-[11px]">
                    07:00 - 15:30
                  </span>
                  <div className="text-[10px] text-emerald-400 mt-0.5">8.0 hrs (-30m break)</div>
                </div>
                <div className="col-span-2 text-center">
                  <span className="inline-block px-2 py-1 rounded bg-[var(--panel-subtle)] border border-[var(--border)] font-mono text-[11px]">
                    07:00 - 15:30
                  </span>
                  <div className="text-[10px] text-emerald-400 mt-0.5">8.0 hrs (-30m break)</div>
                </div>
                <div className="col-span-2 text-center">
                  <span className="inline-block px-2 py-1 rounded bg-[var(--panel-subtle)] border border-[var(--border)] font-mono text-[11px]">
                    06:30 - 15:00
                  </span>
                  <div className="text-[10px] text-emerald-400 mt-0.5">8.0 hrs (-30m break)</div>
                </div>
                <div className="col-span-3 text-right">
                  <div className="font-mono font-semibold text-[var(--text)]">76.0 hrs</div>
                  <div className="text-[10px] text-indigo-400">Normal: 76.0h • Overtime: 0.0h</div>
                </div>
              </div>

              {/* Row 2 */}
              <div className="grid grid-cols-12 gap-3 items-center text-xs py-2">
                <div className="col-span-3">
                  <div className="font-semibold text-[var(--text)]">Bob Vance</div>
                  <div className="text-[11px] text-[var(--muted)]">Warehouse Ops</div>
                </div>
                <div className="col-span-2 text-center">
                  <span className="inline-block px-2 py-1 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 font-mono text-[11px]">
                    Annual Leave
                  </span>
                  <div className="text-[10px] text-[var(--muted)] mt-0.5">Approved</div>
                </div>
                <div className="col-span-2 text-center">
                  <span className="inline-block px-2 py-1 rounded bg-[var(--panel-subtle)] border border-[var(--border)] font-mono text-[11px]">
                    08:00 - 16:30
                  </span>
                  <div className="text-[10px] text-emerald-400 mt-0.5">8.0 hrs (-30m break)</div>
                </div>
                <div className="col-span-2 text-center">
                  <span className="inline-block px-2 py-1 rounded bg-[var(--panel-subtle)] border border-[var(--border)] font-mono text-[11px]">
                    08:00 - 16:30
                  </span>
                  <div className="text-[10px] text-emerald-400 mt-0.5">8.0 hrs (-30m break)</div>
                </div>
                <div className="col-span-3 text-right">
                  <div className="font-mono font-semibold text-[var(--text)]">76.0 hrs</div>
                  <div className="text-[10px] text-amber-400">Leave: 7.6h • Worked: 68.4h</div>
                </div>
              </div>
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
            <Link to="/find-organisation" className="w-full sm:w-auto">
              <Button variant="primary" size="lg" className="w-full" leftIcon={<Building className="w-4 h-4" />}>
                Find My Organisation
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
