import React from 'react';
import { Check, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';

const tiers = [
  {
    name: 'Starter',
    badge: 'One branch',
    description: 'For a single site that wants its roster and timesheets out of spreadsheets.',
    features: [
      'One branch, up to 25 active workers',
      'Fortnightly roster with multi-segment days',
      'Timesheets with approve and reopen',
      'Automatic unpaid break rule',
      'Payroll-hours report with CSV export',
    ],
    popular: false,
  },
  {
    name: 'Professional',
    badge: 'Most popular',
    description: 'For organisations with several branches, each run by its own Branch Admin.',
    features: [
      'Up to 10 branches and 150 active workers',
      'Everything in Starter',
      'Branch Admins with access to their branches only',
      'Per-branch roster and timesheet locks',
      'PDF reports and public holiday hours',
      'Two-step verification and audit log',
    ],
    popular: true,
  },
  {
    name: 'Enterprise',
    badge: 'Larger organisations',
    description: 'For organisations with many branches that need help getting set up.',
    features: [
      'Unlimited branches and workers',
      'Everything in Professional',
      'Help setting up branches and Branch Admins',
      'Priority support',
    ],
    popular: false,
  },
];

export const Pricing: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-16">
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <Badge variant="purple" size="md">Plans</Badge>
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-[var(--text)]">Simple plans for every size of team</h1>
        <p className="text-base text-[var(--muted)] leading-relaxed">
          Every plan includes the fortnightly roster, timesheets and payroll-hours reports. Set up your organisation online
          in a few minutes.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
        {tiers.map(tier => (
          <Card
            key={tier.name}
            className={`flex flex-col justify-between p-8 relative ${tier.popular ? 'border-[var(--primary)] shadow-lg ring-1 ring-[var(--primary)]/30' : ''}`}
          >
            {tier.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-[var(--primary)] text-white text-[11px] font-semibold px-3 py-1 rounded-full uppercase tracking-wider shadow-sm">
                  Most popular
                </span>
              </div>
            )}

            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xl font-bold text-[var(--text)]">{tier.name}</h3>
                  <Badge variant={tier.popular ? 'purple' : 'default'} size="sm">{tier.badge}</Badge>
                </div>
                <p className="text-xs text-[var(--muted)] mt-2 leading-relaxed">{tier.description}</p>
              </div>

              <div className="pt-4 border-t border-[var(--border)]">
                <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-3">Included</div>
                <ul className="space-y-2.5 text-xs text-[var(--text)]">
                  {tier.features.map(feat => (
                    <li key={feat} className="flex items-start gap-2.5">
                      <Check className="w-4 h-4 text-[var(--success)] shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="pt-8 mt-8 border-t border-[var(--border)]">
              <Link to="/signup" className="block w-full">
                <Button
                  variant={tier.popular ? 'primary' : 'secondary'}
                  size="md"
                  className="w-full"
                  rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                >
                  Get started
                </Button>
              </Link>
            </div>
          </Card>
        ))}
      </div>

      <p className="text-center text-xs text-[var(--muted)]">
        Already set up?{' '}
        <Link to="/login" className="font-semibold text-[var(--primary)] hover:underline">Sign in</Link>
      </p>
    </div>
  );
};
