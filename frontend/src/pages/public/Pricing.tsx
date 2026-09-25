import React from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { CtaLink } from './ui';

/**
 * SimpleHours is one product — every organisation gets the full feature set. The three plans below
 * differ only by price and the size of organisation each suits; nothing is feature-gated by plan.
 */

const INCLUDED: string[] = [
  'Every branch has its own roster, timesheets and pay-period locks',
  'The Organisation Owner, and Branch Admins who see only their assigned branches',
  'Fortnightly rosters: default rosters per worker, copy a day, apply defaults',
  'Timesheets: worked hours beside rostered hours, part-day leave, the unpaid break worked out automatically',
  'Payroll preparation reports, as CSV or PDF',
  'A private sign-in link, optional two-step verification, automatic sign-out and an audit log',
];

interface Plan {
  name: string;
  price: number;
  suited: string;
}

const PLANS: Plan[] = [
  { name: 'Basic', price: 99, suited: 'A single branch getting started' },
  { name: 'Standard', price: 499, suited: 'A growing organisation with several branches' },
  { name: 'Premium', price: 999, suited: 'A larger organisation with many branches' },
];

export const Pricing: React.FC = () => {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--text)] sm:text-5xl">Pricing</h1>
        <p className="mt-4 text-lg leading-relaxed text-[var(--text)]/75">
          Every plan includes all of SimpleHours — nothing is held back by tier. Choose by the size of your
          organisation. Signing up only needs an email address; there are no payment details to enter to get started.
        </p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {PLANS.map((plan, i) => (
          <section
            key={plan.name}
            aria-labelledby={`${plan.name}-title`}
            className={`flex flex-col rounded-xl border p-6 sm:p-8 ${
              i === 1 ? 'border-[var(--primary)] bg-[var(--panel)] shadow-sm' : 'border-[var(--border)] bg-[var(--panel)]'
            }`}
          >
            <h2 id={`${plan.name}-title`} className="text-lg font-semibold text-[var(--text)]">{plan.name}</h2>
            <p className="mt-1 text-sm text-[var(--text)]/70">{plan.suited}</p>
            <p className="mt-6 flex items-baseline gap-1">
              <span className="text-4xl font-semibold tracking-tight text-[var(--text)]">${plan.price}</span>
              <span className="text-sm text-[var(--text)]/70">/ month</span>
            </p>
            <CtaLink to="/signup" size="lg" variant={i === 1 ? 'primary' : 'secondary'} className="mt-6">
              Get started
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </CtaLink>
          </section>
        ))}
      </div>

      <section aria-labelledby="included-title" className="mt-12 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 sm:p-8">
        <h2 id="included-title" className="text-xl font-semibold text-[var(--text)]">Included in every plan</h2>
        <ul className="mt-6 grid gap-x-8 gap-y-4 text-[15px] leading-relaxed md:grid-cols-2">
          {INCLUDED.map(item => (
            <li key={item} className="flex gap-3">
              <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--primary-light)] text-[var(--primary-text)]">
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              </span>
              <span className="text-[var(--text)]/75">{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 border-t border-[var(--border)] pt-4 text-sm text-[var(--text)]/70">
          SimpleHours prepares hours for payroll. It doesn’t pay anyone, calculate tax or super, or connect to payroll
          software.
        </p>
      </section>
    </div>
  );
};
