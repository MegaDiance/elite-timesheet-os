import React from 'react';
import { ArrowRight, Building2, Clock3, EyeOff, KeyRound, Link2, ScrollText, ServerCog, UserRound } from 'lucide-react';
import { CtaLink, Eyebrow, Point, SectionIntro } from './ui';
import {
  BranchAccessIllustration,
  DefaultRosterIllustration,
  PayrollReportIllustration,
  RosterIllustration,
  TimesheetDayIllustration,
} from './illustrations';

/**
 * The public home page. Static content only: it never calls the API or reads account data,
 * so it looks the same whether or not the visitor is signed in.
 */

const container = 'mx-auto max-w-7xl px-4 sm:px-6 lg:px-8';
const sectionPad = 'py-16 sm:py-24';

const STEPS = [
  {
    title: 'Set up',
    body: 'Create your organisation and its branches, add your workers and invite your Branch Admins.',
  },
  {
    title: 'Roster',
    body: 'Plan each fortnight from every worker’s default roster, then adjust the days that are different.',
  },
  {
    title: 'Record hours',
    body: 'Enter the hours actually worked beside what was rostered, including any part-day leave.',
  },
  {
    title: 'Approve and export',
    body: 'Approve each worker’s timesheet, lock the pay period and export the report for payroll.',
  },
];

const SECURITY = [
  {
    icon: Building2,
    title: 'Organisations kept apart',
    body: 'Each organisation’s data is kept separate from every other organisation’s.',
  },
  {
    icon: EyeOff,
    title: 'Access by branch',
    body: 'Branch Admins only see the branches they’re assigned to. The Organisation Owner sees them all.',
  },
  {
    icon: ServerCog,
    title: 'Checked on the server',
    body: 'Every request is checked on the server, not just hidden on screen.',
  },
  {
    icon: Link2,
    title: 'Your own sign-in link',
    body: 'Each organisation signs in through its own private sign-in link.',
  },
  {
    icon: KeyRound,
    title: 'Two-step verification',
    body: 'Optionally, confirm each sign-in with a code sent by email.',
  },
  {
    icon: Clock3,
    title: 'Automatic sign-out',
    body: 'Sessions end after 15 minutes of inactivity.',
  },
  {
    icon: ScrollText,
    title: 'Audit log',
    body: 'The Organisation Owner can review a log of the changes made in the organisation.',
  },
];

const SETUP = [
  {
    title: 'Sign up with your email',
    body: 'We email you a link to set up your organisation. It works once and expires after 24 hours.',
  },
  {
    title: 'Set up your organisation and first branch',
    body: 'Name your organisation, create your account, add your first branch and choose your break rule. You’ll get your organisation’s private sign-in link.',
  },
  {
    title: 'Add your workers',
    body: 'Add the people you roster. Workers don’t sign in, so there’s nothing for them to install or remember.',
  },
  {
    title: 'Invite your Branch Admins',
    body: 'Invite the people who run each branch and choose which branches they can see.',
  },
];

function Hero() {
  return (
    <section aria-labelledby="hero-title" className={`${container} pt-12 pb-16 sm:pt-20 sm:pb-24`}>
      <Eyebrow>For Australian organisations with one branch or many</Eyebrow>

      <div className="mt-6 grid gap-8 lg:grid-cols-12 lg:items-end lg:gap-12">
        <h1
          id="hero-title"
          className="text-[2.25rem] leading-[1.1] font-semibold tracking-tight text-[var(--text)] sm:text-5xl lg:col-span-7 xl:text-[3.75rem]"
        >
          Rosters, timesheets and payroll preparation for every branch
        </h1>

        <div className="lg:col-span-5">
          <p className="text-lg leading-relaxed text-[var(--text)]/75">
            Plan each fortnight’s roster, record the hours actually worked, approve them and hand a clear report to
            whoever runs your payroll. Branch by branch, in one place.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <CtaLink to="/pricing" size="lg">
              Get started
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </CtaLink>
          </div>
        </div>
      </div>

      <RosterIllustration className="mt-12 sm:mt-16" />
    </section>
  );
}

function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="border-t border-[var(--border)] bg-[var(--panel)]">
      <div className={`${container} ${sectionPad}`}>
        <SectionIntro id="how-title" title="How it works" className="max-w-2xl">
          <p>Set up once. Then every fortnight follows the same four steps.</p>
        </SectionIntro>

        <ol className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="border-t-2 border-[var(--border-hover)] pt-5">
              <span className="flex items-center gap-2 font-mono text-sm font-semibold text-[var(--text)]/70">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]" />
                Step {i + 1}
              </span>
              <h3 className="mt-2 text-lg font-semibold text-[var(--text)]">{step.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[var(--text)]/75">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Rosters() {
  return (
    <section aria-labelledby="rosters-title" className="border-t border-[var(--border)]">
      <div className={`${container} ${sectionPad} grid items-center gap-12 lg:grid-cols-12 lg:gap-16`}>
        <div className="lg:col-span-5">
          <SectionIntro id="rosters-title" eyebrow="Rosters" title="Plan the whole fortnight in one place">
            <p>Rosters follow your pay period: 14 days, for every worker in the branch.</p>
          </SectionIntro>
          <ul className="mt-8 space-y-4 text-[15px] leading-relaxed">
            <Point title="Default rosters">
              Give each worker a default roster for the fortnight, then apply default rosters to fill a new pay period.
            </Point>
            <Point title="Copy a day">Copy a day to other days instead of typing the same shift again.</Point>
            <Point title="Change what’s different">Adjust any single day by hand without touching the rest.</Point>
            <Point title="Lock it when it’s final">
              Each branch can lock its roster for the pay period. Locking asks for a password.
            </Point>
          </ul>
        </div>
        <DefaultRosterIllustration className="lg:col-span-7" />
      </div>
    </section>
  );
}

function Timesheets() {
  return (
    <section aria-labelledby="timesheets-title" className="border-t border-[var(--border)]">
      <div className={`${container} ${sectionPad} grid items-center gap-12 lg:grid-cols-12 lg:gap-16`}>
        <div className="lg:order-2 lg:col-span-5">
          <SectionIntro id="timesheets-title" eyebrow="Timesheets" title="Record what was actually worked">
            <p>Hours worked sit right next to what was rostered, so differences are easy to see and fix.</p>
          </SectionIntro>
          <ul className="mt-8 space-y-4 text-[15px] leading-relaxed">
            <Point title="Planned and worked, side by side">
              Record each person’s real start and finish times against their roster.
            </Point>
            <Point title="Part-day leave">
              A day can mix Normal Work with Sick Leave, Annual Leave, <abbr title="time in lieu">TIL</abbr>,{' '}
              <abbr title="leave without pay">LWIP</abbr> or Other.
            </Point>
            <Point title="Breaks worked out for you">
              The unpaid break is worked out automatically, once per day, from your break rule. It’s never taken from
              leave.
            </Point>
            <Point title="Approve, or reopen">
              Approve each worker’s timesheet when it’s right. Reopen it if something needs to change.
            </Point>
          </ul>
        </div>
        <TimesheetDayIllustration className="lg:order-1 lg:col-span-7" />
      </div>
    </section>
  );
}

function RoleList({ icon: Icon, title, scope, items }: { icon: typeof UserRound; title: string; scope: string; items: string[] }) {
  return (
    <div className="border-t border-[var(--border)] pt-5">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--primary-light)] text-[var(--primary)]">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div>
          <h3 className="text-base font-semibold text-[var(--text)]">{title}</h3>
          <p className="text-sm text-[var(--text)]/70">{scope}</p>
        </div>
      </div>
      <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-[var(--text)]/75 marker:text-[var(--text)]/40">
        {items.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Branches() {
  return (
    <section aria-labelledby="branches-title" className="border-t border-[var(--border)]">
      <div className={`${container} ${sectionPad}`}>
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionIntro id="branches-title" eyebrow="Branches and access" title="Each branch run by the right people">
              <p>
                Two kinds of account, and nothing in between. Workers don’t sign in at all: they’re records your admins
                look after, so there are no extra logins to manage.
              </p>
            </SectionIntro>
          </div>
          <BranchAccessIllustration className="lg:col-span-7" />
        </div>

        <div className="mt-14 grid gap-10 md:grid-cols-2 md:gap-12">
          <RoleList
            icon={Building2}
            title="Organisation Owner"
            scope="The whole organisation"
            items={[
              'Sets up the organisation and creates its branches',
              'Invites Branch Admins and chooses their branches',
              'Manages organisation settings and reviews the audit log',
              'Sees every branch, and can do everything a Branch Admin can',
            ]}
          />
          <RoleList
            icon={UserRound}
            title="Branch Admin"
            scope="Only the branches they’re assigned to"
            items={[
              'Invited by the Organisation Owner to one or more branches',
              'Manages the workers, roster and timesheets of those branches',
              'Locks their branches’ pay periods and runs their reports',
              'Can’t see other branches or organisation settings',
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function PayrollPreparation() {
  return (
    <section aria-labelledby="payroll-title" className="border-t border-[var(--border)]">
      <div className={`${container} ${sectionPad}`}>
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
          <SectionIntro
            id="payroll-title"
            eyebrow="Payroll preparation"
            title="Hours ready for whoever runs your payroll"
            className="lg:col-span-6"
          >
            <p>
              Each fortnight’s report splits every worker’s hours into ordinary, Saturday, Sunday and public holiday
              hours, and each type of leave. Export it as CSV, or print it or save it as a PDF.
            </p>
          </SectionIntro>

          <div className="space-y-6 lg:col-span-6 lg:pt-10">
            <ul className="space-y-4 text-[15px] leading-relaxed">
              <Point title="Approve first">The report shows whether each worker’s timesheet has been approved.</Point>
              <Point title="Lock the pay period">
                Each branch can lock its timesheets for the fortnight, so the numbers you export don’t change
                afterwards. Locking asks for a password.
              </Point>
            </ul>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[15px] leading-relaxed">
              <p className="font-semibold text-[var(--text)]">SimpleHours prepares the hours. It doesn’t run payroll.</p>
              <p className="mt-1 text-[var(--text)]/75">
                It doesn’t pay anyone, calculate tax or super, or connect to payroll software. Your payroll person or
                system takes it from the report.
              </p>
            </div>
          </div>
        </div>

        <PayrollReportIllustration className="mt-12" />
      </div>
    </section>
  );
}

function Security() {
  return (
    <section id="security" aria-labelledby="security-title" className="border-t border-[var(--border)] bg-[var(--panel)] scroll-mt-16">
      <div className={`${container} ${sectionPad} grid gap-12 lg:grid-cols-12 lg:gap-16`}>
        <SectionIntro id="security-title" eyebrow="Security" title="Access kept to the right people" className="lg:col-span-4">
          <p>Exactly what SimpleHours does to control who can see and change your rosters and timesheets.</p>
        </SectionIntro>

        <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:col-span-8">
          {SECURITY.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)]"
              >
                <Icon className="h-4.5 w-4.5" />
              </span>
              <div>
                <h3 className="text-base font-semibold text-[var(--text)]">{title}</h3>
                <p className="mt-1 text-[15px] leading-relaxed text-[var(--text)]/75">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Setup() {
  return (
    <section aria-labelledby="setup-title" className="border-t border-[var(--border)]">
      <div className={`${container} ${sectionPad} grid gap-12 lg:grid-cols-12 lg:gap-16`}>
        <div className="lg:col-span-5">
          <SectionIntro id="setup-title" eyebrow="Getting set up" title="What your first ten minutes look like">
            <p>No software to install and nothing for your workers to download. You need an email address and a list of the people you roster.</p>
          </SectionIntro>
          <div className="mt-8">
            <CtaLink to="/pricing" size="lg">
              Get started
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </CtaLink>
          </div>
        </div>

        <div className="lg:col-span-7">
        <ol>
          {SETUP.map((step, i) => (
            <li key={step.title} className="relative flex gap-5 pb-8 last:pb-0">
              {i < SETUP.length - 1 && (
                <span aria-hidden="true" className="absolute top-10 bottom-2 left-[1.1875rem] w-px bg-[var(--border-hover)]" />
              )}
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border-hover)] bg-[var(--panel)] font-mono text-sm font-semibold text-[var(--text)]"
              >
                {i + 1}
              </span>
              <div className="pt-1.5">
                <h3 className="text-lg font-semibold text-[var(--text)]">{step.title}</h3>
                <p className="mt-1 text-[15px] leading-relaxed text-[var(--text)]/75">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-8 ml-15 border-t border-[var(--border)] pt-5 text-[15px] text-[var(--text)]/75">
          Then roster your first fortnight.
        </p>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="border-t border-[var(--border)]">
      <div className={`${container} ${sectionPad}`}>
        <div className="flex flex-col gap-8 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 sm:p-10 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <h2 id="cta-title" className="text-3xl font-semibold tracking-tight text-[var(--text)] sm:text-4xl">
              Ready to plan your next fortnight?
            </h2>
            <p className="mt-3 text-base leading-relaxed text-[var(--text)]/75 sm:text-lg">
              Set up your organisation and first branch, then invite your Branch Admins.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            <CtaLink to="/pricing" size="lg">
              Get started
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </CtaLink>
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
      <HowItWorks />
      <Rosters />
      <Timesheets />
      <Branches />
      <PayrollPreparation />
      <Security />
      <Setup />
      <FinalCta />
    </>
  );
};
