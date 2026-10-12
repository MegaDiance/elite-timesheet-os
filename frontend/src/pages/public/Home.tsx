import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, ClipboardCheck, FileSpreadsheet, PlayCircle } from 'lucide-react';
import { CtaLink, Eyebrow } from './ui';
import { RosterIllustration } from './illustrations';
import { ProductTour } from './tour/ProductTour';
import { loadTourPlayer } from './tour/loadPlayer';

/**
 * The public home page: what SimpleHours is, a short tour, and the way in. The detail lives on
 * /features. Static content only: it never calls the API or reads account data, so it looks the
 * same whether or not the visitor is signed in.
 */

const container = 'mx-auto max-w-7xl px-4 sm:px-6 lg:px-8';

const FEATURES = [
  {
    icon: CalendarDays,
    title: 'Roster the fortnight',
    body: 'Plan each employee’s fortnight on one screen. Start from default rosters and change only what’s different.',
  },
  {
    icon: ClipboardCheck,
    title: 'Record what was worked',
    body: 'Worked hours sit next to the roster, unpaid breaks are worked out for you, and you approve each timesheet.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Hand over a clean report',
    body: 'Ordinary, weekend, public holiday and leave hours per employee, as CSV or PDF. It prepares the hours; it doesn’t run payroll.',
  },
];

function Hero() {
  return (
    <section aria-labelledby="hero-title" className={`${container} pt-12 pb-16 sm:pt-20 sm:pb-24`}>
      <div className="mx-auto max-w-3xl text-center">
        <div className="flex justify-center">
          <Eyebrow>For Australian organisations</Eyebrow>
        </div>
        <h1
          id="hero-title"
          className="mt-6 text-[2.25rem] leading-[1.1] font-semibold tracking-tight text-[var(--text)] sm:text-5xl xl:text-[3.5rem]"
        >
          Rosters and timesheets, ready for payroll
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[var(--text)]/75">
          Plan the fortnight, record the hours worked, approve them, and hand a clear report to whoever runs payroll.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <CtaLink to="/pricing" size="lg">
            Get started
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </CtaLink>
          {/* Fetches the tour's player as soon as the visitor shows interest, so it's ready on arrival. */}
          <CtaLink to="#how-it-works" size="lg" variant="secondary" onPointerEnter={loadTourPlayer} onFocus={loadTourPlayer}>
            <PlayCircle aria-hidden="true" className="h-4 w-4" />
            Watch how it works
          </CtaLink>
        </div>
      </div>

      <RosterIllustration className="mt-12 sm:mt-16" />
    </section>
  );
}

function Features() {
  return (
    <section aria-labelledby="features-title" className="border-t border-[var(--border)]">
      <div className={`${container} py-16 sm:py-24`}>
        <h2 id="features-title" className="sr-only">What it does</h2>
        <ul className="grid gap-10 md:grid-cols-3 md:gap-8">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li key={title}>
              <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--primary-light)] text-[var(--primary-text)]">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-[var(--text)]">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[var(--text)]/75">{body}</p>
            </li>
          ))}
        </ul>
        <Link
          to="/features"
          className="mt-10 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--primary-text)] hover:underline hover:underline-offset-4"
        >
          See all features
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="border-t border-[var(--border)]">
      <div className={`${container} py-16 sm:py-24`}>
        <div className="flex flex-col gap-8 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 sm:p-10 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <h2 id="cta-title" className="text-3xl font-semibold tracking-tight text-[var(--text)] sm:text-4xl">
              Ready to plan your next fortnight?
            </h2>
            <p className="mt-3 text-base leading-relaxed text-[var(--text)]/75 sm:text-lg">
              Sign up with your email and set up your first branch.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
            <CtaLink to="/pricing" size="lg">
              Get started
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </CtaLink>
            <Link to="/recover-link" className="text-sm text-[var(--text)]/75 hover:text-[var(--text)] hover:underline hover:underline-offset-4">
              Already a customer? Recover your company link
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export const Home: React.FC = () => {
  return (
    <>
      <Hero />
      <ProductTour />
      <Features />
      <FinalCta />
    </>
  );
};
