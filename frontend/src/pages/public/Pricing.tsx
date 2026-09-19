import React from 'react';
import { Check, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';

export const Pricing: React.FC = () => {
  const tiers = [
    {
      name: 'Starter Tier',
      badge: 'Core Features',
      description: 'Ideal for single-location operations needing reliable fortnight rostering and break compliance.',
      features: [
        'Up to 25 Active Staff Members',
        '14-Day Fortnight Rostering Cycle',
        'Automated 30m Weekday Break Deduction',
        'Standard Time Entry & Smart Parser',
        'Employee Self-Service Shift View',
        'RFC 4180 CSV Payroll Export',
        'Standard Email Authentication',
      ],
      popular: false,
    },
    {
      name: 'Professional Tier',
      badge: 'Most Deployed',
      description: 'Built for scaling logistics, healthcare, and transport operations requiring dual-password locks.',
      features: [
        'Up to 150 Active Staff Members',
        'Everything in Starter Tier',
        'Dual-Password Fortnight Locks (Roster & Timesheet)',
        'Printable Formatted HTML/PDF Reports',
        'Leave Management & Public Holiday Calendar',
        'Automated Roster Publication Alerts',
        'Two-Factor Authentication (Email OTP)',
        'Full System Audit Logs with State Diffs',
      ],
      popular: true,
    },
    {
      name: 'Enterprise Tier',
      badge: 'Multi-Tenant Compliance',
      description: 'Custom setups for high-volume enterprise operators needing dedicated tenant isolation and integrations.',
      features: [
        'Unlimited Staff Members',
        'Everything in Professional Tier',
        'Multi-Tenant Workspace Partitioning',
        'Dedicated Custom Slug & Branded Login',
        'Xero Accounting Integration',
        'Custom Overtime Tiers & Weekend Rules',
        'Platform Admin Tenant Management',
        'Priority Technical Support & SLA',
      ],
      popular: false,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-16">
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <Badge variant="purple" size="md">Platform Tenant Plans</Badge>
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-[var(--text)]">
          Simple, Transparent Workforce Plans
        </h1>
        <p className="text-base text-[var(--muted)] leading-relaxed">
          Simple Hours is provisioned directly through authorized platform administrators. Every tier includes our complete database schema, break engine, and security layer.
        </p>
      </div>

      {/* Pricing Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
        {tiers.map((tier, idx) => (
          <Card 
            key={idx} 
            className={`flex flex-col justify-between p-8 relative ${
              tier.popular ? 'border-indigo-500 shadow-lg ring-1 ring-indigo-500/30' : ''
            }`}
          >
            {tier.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-indigo-600 text-white text-[11px] font-semibold px-3 py-1 rounded-full uppercase tracking-wider shadow-sm">
                  Most Popular
                </span>
              </div>
            )}

            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-[var(--text)]">{tier.name}</h3>
                  <Badge variant={tier.popular ? 'purple' : 'default'} size="sm">{tier.badge}</Badge>
                </div>
                <p className="text-xs text-[var(--muted)] mt-2 leading-relaxed">
                  {tier.description}
                </p>
              </div>

              <div className="pt-4 border-t border-[var(--border)]">
                <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-3">
                  Included Features
                </div>
                <ul className="space-y-2.5 text-xs text-[var(--text)]">
                  {tier.features.map((feat, fIdx) => (
                    <li key={fIdx} className="flex items-start gap-2.5">
                      <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="pt-8 mt-8 border-t border-[var(--border)] space-y-3">
              <Link to="/features" className="block w-full">
                <Button 
                  variant={tier.popular ? 'primary' : 'secondary'} 
                  size="md" 
                  className="w-full"
                  rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                >
                  {tier.name.includes('Enterprise') ? 'Contact Sales' : 'Get Started'}
                </Button>
              </Link>
              <p className="text-xs text-center text-[var(--muted)]">
                {tier.name.includes('Enterprise') ? 'Custom onboarding & compliance' : '14-day free trial • No credit card required'}
              </p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
