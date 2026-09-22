import React from 'react';
import { ArrowRight } from 'lucide-react';
import { CtaLink, Point } from './ui';

/**
 * No prices or plan limits are defined for SimpleHours yet, so this page lists what's included
 * and says plainly that prices aren't published. Don't add figures here until they are real.
 */

const INCLUDED: Array<{ title: string; body: string }> = [
  { title: 'Branches', body: 'One branch or many, each with its own roster, timesheets and locks.' },
  { title: 'Two kinds of account', body: 'The Organisation Owner, and Branch Admins who see only the branches they’re assigned to.' },
  { title: 'Fortnightly rosters', body: 'Default rosters per worker, copy a day to other days, apply default rosters.' },
  { title: 'Timesheets', body: 'Worked hours beside rostered hours, part-day leave, the unpaid break worked out automatically, approve and reopen.' },
  { title: 'Pay period locks', body: 'Lock a branch’s roster and timesheets for the fortnight, with password confirmation.' },
  { title: 'Payroll preparation', body: 'A report per fortnight with ordinary, weekend, public holiday and leave hours, as CSV or PDF.' },
  { title: 'Security', body: 'A private sign-in link, optional two-step verification by email, automatic sign-out and an audit log.' },
];

export const Pricing: React.FC = () => {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--text)] sm:text-5xl">Pricing</h1>
        <p className="mt-4 text-lg leading-relaxed text-[var(--text)]/75">
          Every organisation gets all of SimpleHours. There are no feature tiers to choose between.
        </p>
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-12 lg:gap-12">
        <section aria-labelledby="included-title" className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 sm:p-8 lg:col-span-8">
          <h2 id="included-title" className="text-xl font-semibold text-[var(--text)]">What’s included</h2>
          <ul className="mt-6 grid gap-x-8 gap-y-4 text-[15px] leading-relaxed md:grid-cols-2">
            {INCLUDED.map(item => (
              <Point key={item.title} title={item.title}>
                {item.body}
              </Point>
            ))}
          </ul>
          <p className="mt-6 border-t border-[var(--border)] pt-4 text-sm text-[var(--text)]/70">
            SimpleHours prepares hours for payroll. It doesn’t pay anyone, calculate tax or super, or connect to payroll
            software.
          </p>
        </section>

        <section aria-labelledby="cost-title" className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 sm:p-8 lg:col-span-4">
          <h2 id="cost-title" className="text-xl font-semibold text-[var(--text)]">What it costs</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--text)]/75">
            Prices aren’t published on this site yet.
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-[var(--text)]/75">
            Signing up only needs an email address. There are no payment details to enter.
          </p>
          <div className="mt-8 flex flex-col gap-3 lg:mt-auto lg:pt-8">
            <CtaLink to="/signup" size="lg">
              Get started
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </CtaLink>
            <CtaLink to="/login" size="lg" variant="secondary">
              Sign in
            </CtaLink>
          </div>
        </section>
      </div>
    </div>
  );
};
