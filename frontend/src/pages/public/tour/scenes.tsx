import type { CSSProperties, ReactNode } from 'react';
import {
  BarChart3,
  Building2,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  CheckSquare,
  ClipboardCopy,
  Clock,
  Copy,
  Download,
  FileText,
  Globe,
  LayoutDashboard,
  Lock,
  LockOpen,
  MapPin,
  MessageSquare,
  Plus,
  Printer,
  Sliders,
  UserCog,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { TimesheetStatusBadge, type TimesheetState } from '../../../components/TimesheetStatus';
import { DayLines, PlannedWorkedKey } from '../../../components/roster/DayBox';
import { DEFAULT_BREAK_SETTINGS, breakRuleFor, entryWhen, formatHours, previewDayHours, type Entry, type EntryType } from '../../../components/roster/day';
import { dayLabel, dayOfMonth, periodLabel, weekdayShort } from '../../../components/roster/dates';
import type { TourChapter } from './chapters';
import {
  DEMO_BRANCH_ADMINS,
  DEMO_BRANCHES,
  DEMO_LEAVE_EDIT,
  DEMO_ORGANISATION,
  DEMO_PERIOD_START,
  DEMO_REPORT,
  DEMO_REPORT_COLUMNS,
  DEMO_ROSTER_CHANGE,
  DEMO_SIGN_IN_LINK,
  DEMO_TIMESHEETS,
  DEMO_WEEK,
  DEMO_WORKERS,
  type DemoShift,
} from './demoData';

/**
 * The screens of the product tour. They are drawn from the app's own pieces wherever possible:
 * roster days use the real DayLines, hours come from the real break-rule maths (previewDayHours),
 * dates from the roster's own formatters, and labels are the app's labels. Everything shown is the
 * example organisation from demoData.ts.
 *
 * Purely visual: the player hides the stage from assistive technology and gives the same story as
 * text (captions and transcript), so nothing in here is focusable or interactive.
 */

export interface SceneProps {
  step: number;
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

const PERIOD = periodLabel(DEMO_PERIOD_START);
const BRANCH = DEMO_BRANCHES[0];

/** An element that appears (with the entrance animation) once `show` is true. */
function Reveal({
  show,
  delay = 0,
  className = '',
  as: Tag = 'div',
  children,
}: {
  show: boolean;
  delay?: number;
  className?: string;
  as?: 'div' | 'span' | 'li';
  children: ReactNode;
}) {
  const style: CSSProperties | undefined = show && delay ? { animationDelay: `${delay}ms` } : undefined;
  return (
    <Tag className={`${show ? 'ptour-anim ptour-in' : 'ptour-hidden'} ${className}`} style={style}>
      {children}
    </Tag>
  );
}

/** Looks like the app's primary/secondary buttons (roster/Dialog.tsx `buttonClass`); `pressed` plays a click. */
function FakeButton({
  children,
  variant = 'secondary',
  pressed = false,
  pressDelay = 0,
  className = '',
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  pressed?: boolean;
  pressDelay?: number;
  className?: string;
}) {
  const look =
    variant === 'primary'
      ? 'bg-[var(--primary)] text-white'
      : 'border border-[var(--border)] bg-[var(--panel-subtle)] text-[var(--text)]';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap ${look} ${
        pressed ? 'ptour-anim ptour-press' : ''
      } ${className}`}
      style={pressed && pressDelay ? { animationDelay: `${pressDelay}ms` } : undefined}
    >
      {children}
    </span>
  );
}

const fieldLabel = 'block text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]';
const inputLook = 'flex h-8 items-center rounded-lg border bg-[var(--input-bg)] px-2.5 text-xs text-[var(--text)]';

/** A form field that shows its placeholder, then "types" its value when `filled`. */
function Field({ label, value, placeholder = '', filled, active }: { label: string; value: string; placeholder?: string; filled: boolean; active: boolean }) {
  return (
    <div className="min-w-0 space-y-1">
      <span className={fieldLabel}>{label}</span>
      <span
        className={`${inputLook} ${active ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]' : 'border-[var(--border)]'} overflow-hidden`}
      >
        {filled ? (
          <span className="ptour-anim ptour-type truncate">{value}</span>
        ) : (
          <span className="truncate text-[var(--muted)]/70">{placeholder}</span>
        )}
      </span>
    </div>
  );
}

/** The app's page header: title, a line of context, and the page's own buttons. */
function Page({ title, meta, actions, children }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 sm:px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm font-bold text-[var(--text)] sm:text-base">{title}</div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
        {meta && <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--muted)]">{meta}</div>}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden p-2.5 sm:p-3 lg:p-4">{children}</div>
    </div>
  );
}

function BranchChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--panel-subtle)] px-1.5 py-px text-[10px] font-medium text-[var(--text)]">
      <MapPin className="h-2.5 w-2.5 text-[var(--success)]" aria-hidden="true" />
      {BRANCH.name}
    </span>
  );
}

/** A modal dialog over a dimmed page, like the app's Dialog. */
function FakeDialog({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="ptour-anim ptour-fade absolute inset-0 z-10 flex items-end justify-center bg-black/45 p-2.5 sm:items-center sm:p-4">
      <div className="ptour-anim ptour-in w-full max-w-sm overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3.5 py-2.5">
          <span className="truncate text-xs font-bold text-[var(--text)]">{title}</span>
          <X className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" aria-hidden="true" />
        </div>
        <div className="space-y-3 px-3.5 py-3">{children}</div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--panel-subtle)]/60 px-3.5 py-2.5">{footer}</div>
      </div>
    </div>
  );
}

type Status = TimesheetState;

/* ------------------------------------------------------------------ */
/* Days                                                                */
/* ------------------------------------------------------------------ */

/** Entries for one part of a day, with hours worked out by the app's own break rule. */
function entries(lines: Array<{ type: EntryType; time: string }>, iso: string): Entry[] {
  const list: Entry[] = lines.map(({ type, time }) => {
    const [start, finish] = time.split('-');
    return { type, start, finish, hours: 0, has_break: true, break_mins: null };
  });
  const { perEntry } = previewDayHours(list, breakRuleFor(DEFAULT_BREAK_SETTINGS, iso));
  return list.map((entry, i) => ({ ...entry, hours: perEntry[i] ?? 0 }));
}

const work = (shift: DemoShift, iso: string) => (shift ? entries([{ type: 'WORK', time: shift }], iso) : []);

/** Worker × day: the default roster, with the one hand-changed day once `changed`. */
function rosteredShift(worker: number, day: number, changed: boolean): DemoShift {
  if (changed && worker === DEMO_ROSTER_CHANGE.worker && day === DEMO_ROSTER_CHANGE.day) return DEMO_ROSTER_CHANGE.shift;
  return DEMO_WORKERS[worker].week[day];
}

const isLeaveEditDay = (worker: number, day: number) => worker === DEMO_LEAVE_EDIT.worker && day === DEMO_LEAVE_EDIT.day;

function leaveEditEntries(): Entry[] {
  return entries(
    [
      { type: 'WORK', time: DEMO_LEAVE_EDIT.work },
      { type: DEMO_LEAVE_EDIT.leave.type, time: DEMO_LEAVE_EDIT.leave.time },
    ],
    DEMO_WEEK[DEMO_LEAVE_EDIT.day],
  );
}

/*
 * Which days show at which width, following the stage's own width (container queries), the same
 * way the homepage roster illustration does: Mon–Tue always, then Wed, Thu, Fri, then the weekend.
 */
const DAY_SHOW = ['hidden @4xl:block', 'block', 'block', 'hidden @md:block', 'hidden @xl:block', 'hidden @3xl:block', 'hidden @4xl:block'];
const GRID =
  'grid gap-1 @md:gap-1.5 grid-cols-[6rem_repeat(2,minmax(0,1fr))] @md:grid-cols-[7rem_repeat(3,minmax(0,1fr))] @xl:grid-cols-[7.5rem_repeat(4,minmax(0,1fr))] @3xl:grid-cols-[8rem_repeat(5,minmax(0,1fr))] @4xl:grid-cols-[9.5rem_repeat(7,minmax(0,1fr))]';

interface GridState {
  rostered: boolean;
  /** Stagger the rostered days in, as when default rosters are applied. */
  rosterFill?: boolean;
  changed: boolean;
  worked: boolean;
  workedFill?: boolean;
  leaveEdited: boolean;
  /** One day ringed to draw the eye. */
  highlight?: { worker: number; day: number } | null;
  status: Status;
  statusFlip?: boolean;
}

function RosterGrid({ state }: { state: GridState }) {
  return (
    <div className={GRID}>
      <div className="self-end px-1 pb-0.5 text-[10px] font-semibold text-[var(--muted)]">Workers</div>
      {DEMO_WEEK.map((iso, d) => (
        <div key={iso} className={`${DAY_SHOW[d]} px-1 pb-0.5 text-[10px] font-semibold text-[var(--muted)]`}>
          {weekdayShort(iso)} <span className="text-[var(--text)]">{dayOfMonth(iso)}</span>
        </div>
      ))}

      {DEMO_WORKERS.map((worker, w) => (
        <div key={worker.name} className="contents">
          <div className="flex min-w-0 flex-col justify-center gap-0.5 rounded-md px-1">
            <span className="truncate text-[11px] font-semibold text-[var(--text)] @md:text-xs">{worker.name}</span>
            <span className="truncate text-[9.5px] text-[var(--muted)] @md:text-[10px]">
              {worker.department} · {worker.contractHours} h contract
            </span>
            <span className="hidden @xl:block" key={`${state.status}`}>
              <span className={state.statusFlip ? 'ptour-anim ptour-in inline-block' : 'inline-block'} style={state.statusFlip ? { animationDelay: `${w * 120}ms` } : undefined}>
                <TimesheetStatusBadge status={state.status} />
              </span>
            </span>
          </div>
          {DEMO_WEEK.map((iso, d) => {
            const shift = rosteredShift(w, d, state.changed);
            const edited = state.leaveEdited && isLeaveEditDay(w, d);
            const roster = state.rostered ? work(shift, iso) : [];
            const timesheet = !state.worked ? [] : edited ? leaveEditEntries() : work(shift, iso);
            const ringed = state.highlight?.worker === w && state.highlight?.day === d;
            const rosterChanged = ringed && state.changed && w === DEMO_ROSTER_CHANGE.worker && d === DEMO_ROSTER_CHANGE.day;
            const filled = roster.length > 0 || timesheet.length > 0;
            const weekend = d === 0 || d === 6;
            const stagger = d * 70 + w * 30;
            return (
              <div
                key={iso}
                className={`${DAY_SHOW[d]} min-h-[4.1rem] rounded-md border p-1 @4xl:p-1.5 ${
                  filled ? 'border-[var(--border)] bg-[var(--panel)]' : `border-dashed border-[var(--border-hover)] ${weekend ? 'bg-[var(--glass-4)]' : ''}`
                } ${ringed ? 'ptour-anim ptour-ring' : ''}`}
              >
                {(roster.length > 0 || timesheet.length > 0) && (
                  <span className="flex flex-col gap-1">
                    {roster.length > 0 && (
                      <span
                        key={`r-${shift}`}
                        className={state.rosterFill || rosterChanged ? 'ptour-anim ptour-in block' : 'block'}
                        style={state.rosterFill ? { animationDelay: `${stagger}ms` } : undefined}
                      >
                        <DayLines day={{ roster, timesheet: [], note: null }} variant="compact" />
                      </span>
                    )}
                    {timesheet.length > 0 && (
                      <span
                        key={`t-${edited}`}
                        className={state.workedFill || (edited && ringed) ? 'ptour-anim ptour-in block' : 'block'}
                        style={state.workedFill ? { animationDelay: `${stagger}ms` } : undefined}
                      >
                        <DayLines day={{ roster: [], timesheet, note: null }} variant="compact" />
                      </span>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function RosterPage({ actions, badges, children }: { actions?: ReactNode; badges?: ReactNode; children: ReactNode }) {
  return (
    <Page
      title={
        <>
          <span>Roster</span>
          <span className="hidden text-xs font-normal @2xl:inline-flex">
            <PlannedWorkedKey />
          </span>
        </>
      }
      meta={
        <>
          <span className="font-medium text-[var(--text)]">{PERIOD}</span>
          <BranchChip />
          {badges}
        </>
      }
      actions={actions}
    >
      {children}
    </Page>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Organisation                                                     */
/* ------------------------------------------------------------------ */

function OrganisationScene({ step }: SceneProps) {
  if (step >= 5) {
    return (
      <div className="flex h-full items-center justify-center p-3 sm:p-6">
        <div className="ptour-anim ptour-in w-full max-w-md space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 text-center shadow-sm sm:p-5">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[var(--success-light)] text-[var(--success)]">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="text-lg font-bold text-[var(--text)]">Your organisation is ready</div>
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            {DEMO_ORGANISATION} has been set up with its first branch, {BRANCH.name}.
          </p>
          <div className="space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-3 text-left text-xs">
            <div className="font-semibold text-[var(--text)]">Your organisation's private sign-in link</div>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[11px] text-[var(--muted)]">{DEMO_SIGN_IN_LINK}</span>
              <FakeButton>
                <Copy className="h-3 w-3" aria-hidden="true" />
                Copy link
              </FakeButton>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-md space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm sm:p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--primary-light)] text-[var(--text)]">
            <Building2 className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <div className="text-base font-bold text-[var(--text)]">Set up your organisation</div>
            <div className="text-[11px] text-[var(--muted)]">Organisation, first branch and breaks</div>
          </div>
        </div>
        <Field label="Organisation name" value={DEMO_ORGANISATION} placeholder="e.g. Harbourside Community Care" filled={step >= 1} active={step === 1} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Branch name" value={BRANCH.name} placeholder="e.g. Richmond" filled={step >= 2} active={step === 2} />
          <Field label="Timezone" value={BRANCH.timeZone} filled={step >= 2} active={false} />
        </div>
        <div className="space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--panel-subtle)] p-2.5">
          <div className="text-[11px] font-bold text-[var(--text)]">Unpaid break</div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Weekday (mins)" value={String(DEFAULT_BREAK_SETTINGS.break_mins_weekday)} filled={step >= 3} active={step === 3} />
            <Field label="Weekend (mins)" value={String(DEFAULT_BREAK_SETTINGS.break_mins_weekend)} filled={step >= 3} active={false} />
            <Field label="Threshold (hours)" value={String(DEFAULT_BREAK_SETTINGS.break_threshold_hours)} filled={step >= 3} active={false} />
          </div>
        </div>
        <div className="flex justify-end">
          <FakeButton variant="primary" pressed={step === 4}>
            Create organisation
          </FakeButton>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Branches and Branch Admins                                       */
/* ------------------------------------------------------------------ */

function BranchesScene({ step }: SceneProps) {
  if (step >= 4) return <BranchAdminsPage step={step} />;
  return (
    <Page
      title="Branches"
      meta={
        <>
          <span>{DEMO_ORGANISATION}</span>
          <span aria-hidden="true">·</span>
          <span>{step} active</span>
        </>
      }
      actions={
        <FakeButton variant="primary" pressed={step === 1}>
          <Plus className="h-3 w-3" aria-hidden="true" />
          Add branch
        </FakeButton>
      }
    >
      <div className="grid gap-2 @2xl:grid-cols-3 @2xl:gap-3">
        {DEMO_BRANCHES.map((branch, i) => (
          <Reveal key={branch.name} show={step >= i + 1} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-2.5 @2xl:p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-[var(--text)]">{branch.name}</span>
              <Badge variant="success" size="sm">
                Active
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--muted)]">
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" aria-hidden="true" />
                {branch.activeWorkers} active workers
              </span>
              <span className="hidden items-center gap-1 @md:inline-flex">
                <Globe className="h-3 w-3" aria-hidden="true" />
                {branch.timeZone}
              </span>
            </div>
            <div className="mt-2 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--muted)] italic">No Branch Admin assigned</div>
          </Reveal>
        ))}
      </div>
    </Page>
  );
}

/** The Branch Admins page (Owner only): invite someone and choose which branches they run. */
function BranchAdminsPage({ step }: SceneProps) {
  const [daniel, priya] = DEMO_BRANCH_ADMINS;
  const invited = step >= 7;
  const table = 'overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] text-xs';
  const head = 'grid gap-3 border-b border-[var(--border)] bg-[var(--table-header)] px-3 py-2 text-[10px] font-bold text-[var(--muted)] uppercase';
  const row = 'grid items-center gap-3 px-3 py-2';
  const cols = 'grid-cols-[minmax(0,1fr)_auto] @xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem]';
  return (
    <div className="ptour-anim ptour-fade h-full">
      <Page
        title="Branch Admins"
        meta={<span>Who runs each branch</span>}
        actions={
          <FakeButton variant="primary">
            <UserCog className="h-3 w-3" aria-hidden="true" />
            Invite Branch Admin
          </FakeButton>
        }
      >
        <div className={table}>
          <div className={`${head} ${cols}`}>
            <span>Name</span>
            <span className="hidden @xl:block">Branches</span>
            <span>Account</span>
          </div>
          <div className={`${row} ${cols}`}>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-[var(--text)]">{daniel.name}</span>
              <span className="block truncate text-[10.5px] text-[var(--muted)]">
                <span className="@xl:hidden">{daniel.branches.join(', ')}</span>
                <span className="hidden @xl:inline">{daniel.email}</span>
              </span>
            </span>
            <span className="hidden truncate text-[var(--text)] @xl:block">{daniel.branches.join(', ')}</span>
            <span>
              <Badge variant="success" size="sm">
                Active
              </Badge>
            </span>
          </div>
        </div>

        {invited && (
          <div className="ptour-anim ptour-in mt-3">
            <div className="mb-1.5 text-[11px] font-semibold text-[var(--text)]">Pending invitations (1)</div>
            <div className={table}>
              <div className={`${head} ${cols}`}>
                <span>Invited</span>
                <span className="hidden @xl:block">Branches</span>
                <span>Expires</span>
              </div>
              <div className={`${row} ${cols}`}>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-[var(--text)]">{priya.name}</span>
                  <span className="block truncate text-[10.5px] text-[var(--muted)]">
                    <span className="@xl:hidden">{priya.branches.join(', ')}</span>
                    <span className="hidden @xl:inline">{priya.email}</span>
                  </span>
                </span>
                <span className="hidden truncate text-[var(--text)] @xl:block">{priya.branches.join(', ')}</span>
                <span className="text-[var(--muted)]">In 7 days</span>
              </div>
            </div>
          </div>
        )}

        <Reveal
          show={step >= 8}
          className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text)]"
        >
          <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted)]" aria-hidden="true" />
          <span>
            Priya will see only {priya.branches.join(' and ')}, and Daniel only {daniel.branches.join(', ')}. The Organisation Owner sees
            every branch.
          </span>
        </Reveal>

        {step < 7 && (
          <FakeDialog
            title="Invite a Branch Admin"
            footer={
              <>
                <FakeButton>Cancel</FakeButton>
                <FakeButton variant="primary" pressed={step === 6}>
                  Send invitation
                </FakeButton>
              </>
            }
          >
            <div className="grid grid-cols-2 gap-2">
              <Field label="Email address" value={priya.email} placeholder="name@example.com" filled active={step === 4} />
              <Field label="Name (optional)" value={priya.name} placeholder="e.g. Sam Nguyen" filled active={false} />
            </div>
            <div className="space-y-1">
              <span className={fieldLabel}>Branches</span>
              <div className="flex flex-wrap gap-1.5">
                {DEMO_BRANCHES.map(branch => {
                  const on = step >= 5 && priya.branches.includes(branch.name);
                  return (
                    <span
                      key={branch.name}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${
                        on ? 'border-[var(--primary)] bg-[var(--primary-light)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--muted)]'
                      }`}
                    >
                      <span
                        className={`flex h-3 w-3 items-center justify-center rounded-[3px] border ${
                          on ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'border-[var(--border-hover)]'
                        }`}
                      >
                        {on && <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />}
                      </span>
                      {branch.name}
                    </span>
                  );
                })}
              </div>
            </div>
            <p className="text-[10.5px] leading-relaxed text-[var(--muted)]">
              Branch Admins manage the workers, roster and timesheets of their branches. They cannot change organisation settings or
              other admins.
            </p>
          </FakeDialog>
        )}
      </Page>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Workers                                                          */
/* ------------------------------------------------------------------ */

function WorkersScene({ step }: SceneProps) {
  const shown = (i: number) => step >= (i < 3 ? i + 1 : 5);
  const count = DEMO_WORKERS.filter((_, i) => shown(i)).length;
  const defaultFor = DEMO_WORKERS[0];
  return (
    <Page
      title="Workers"
      meta={
        <>
          <BranchChip />
          <span>{count} active workers</span>
        </>
      }
      actions={
        <>
          <span className="hidden @xl:inline-flex">
            <FakeButton>Export CSV</FakeButton>
          </span>
          <FakeButton variant="primary" pressed={step === 4}>
            <Plus className="h-3 w-3" aria-hidden="true" />
            Add worker
          </FakeButton>
        </>
      }
    >
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] text-xs">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[var(--border)] bg-[var(--table-header)] px-3 py-2 text-[10px] font-bold text-[var(--muted)] uppercase @xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_5rem]">
          <span>Name &amp; contact</span>
          <span className="hidden @xl:block">Department</span>
          <span className="hidden @xl:block">Contract (fortnight)</span>
          <span>Status</span>
        </div>
        {DEMO_WORKERS.map((worker, i) => (
          <Reveal
            key={worker.name}
            show={shown(i)}
            className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--border)] px-3 py-2 last:border-b-0 @xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_5rem] ${
              step >= 6 && i === 0 ? 'bg-[var(--primary-light)]' : ''
            }`}
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold text-[var(--text)]">{worker.name}</span>
              <span className="block truncate text-[10.5px] text-[var(--muted)]">
                <span className="@xl:hidden">
                  {worker.department} · {worker.contractHours} h
                </span>
                <span className="hidden @xl:inline">{worker.email}</span>
              </span>
            </span>
            <span className="hidden truncate text-[var(--text)] @xl:block">{worker.department}</span>
            <span className="hidden tabular-nums text-[var(--text)] @xl:block">{formatHours(worker.contractHours)}</span>
            <span>
              <Badge variant="success" size="sm">
                Active
              </Badge>
            </span>
          </Reveal>
        ))}
      </div>

      {step >= 6 && (
        <div className="ptour-anim ptour-in absolute inset-x-2.5 bottom-2.5 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow-[var(--shadow)] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[19rem]">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-bold text-[var(--text)]">Default roster: {defaultFor.name}</span>
            <X className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" aria-hidden="true" />
          </div>
          <div className="mt-2 space-y-1">
            {['Week 1', 'Week 2'].map(week => (
              <div key={week} className="grid grid-cols-[2.6rem_repeat(7,minmax(0,1fr))] items-stretch gap-0.5">
                <span className="self-center text-[9.5px] font-semibold text-[var(--muted)]">{week}</span>
                {defaultFor.week.map((shift, d) => (
                  <span
                    key={d}
                    className={`flex min-h-[1.9rem] flex-col items-center justify-center rounded border text-center leading-tight ${
                      shift ? 'border-[var(--border)] bg-[var(--panel-subtle)]' : 'border-dashed border-[var(--border-hover)]'
                    }`}
                  >
                    <span className="text-[8.5px] font-semibold text-[var(--muted)]">{weekdayShort(DEMO_WEEK[d]).charAt(0)}</span>
                    <span className="text-[8.5px] font-medium text-[var(--text)] tabular-nums">{shift ? entryWhen(work(shift, DEMO_WEEK[d])[0], 'short') : ''}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1 text-[10.5px] text-[var(--muted)]">
            <CheckCircle2 className="h-3 w-3 text-[var(--success)]" aria-hidden="true" />
            All changes saved
          </div>
        </div>
      )}
    </Page>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Roster                                                           */
/* ------------------------------------------------------------------ */

function RosterScene({ step }: SceneProps) {
  const change = { worker: DEMO_ROSTER_CHANGE.worker, day: DEMO_ROSTER_CHANGE.day };
  return (
    <RosterPage
      actions={
        <FakeButton variant="primary" pressed={step === 1}>
          <Wand2 className="h-3 w-3" aria-hidden="true" />
          Apply default rosters…
        </FakeButton>
      }
    >
      <RosterGrid
        state={{
          rostered: step >= 2,
          rosterFill: step === 2,
          changed: step >= 3,
          highlight: step >= 3 ? change : null,
          worked: false,
          leaveEdited: false,
          status: 'Draft',
        }}
      />
    </RosterPage>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Hours worked, with part-day leave                                */
/* ------------------------------------------------------------------ */

function HoursScene({ step }: SceneProps) {
  const edit = DEMO_LEAVE_EDIT;
  const iso = DEMO_WEEK[edit.day];
  const worker = DEMO_WORKERS[edit.worker];
  const roster = work(worker.week[edit.day], iso);
  const worked = step >= 4 ? leaveEditEntries() : roster;
  const { total, breakMins } = previewDayHours(worked, breakRuleFor(DEFAULT_BREAK_SETTINGS, iso));
  return (
    <RosterPage
      actions={
        <FakeButton variant="primary" pressed={step === 1}>
          <ClipboardCopy className="h-3 w-3" aria-hidden="true" />
          Copy roster to worked hours…
        </FakeButton>
      }
    >
      <RosterGrid
        state={{
          rostered: true,
          changed: true,
          worked: step >= 2,
          workedFill: step === 2,
          leaveEdited: step >= 6,
          highlight: step >= 6 ? { worker: edit.worker, day: edit.day } : null,
          status: 'Draft',
        }}
      />
      {step >= 3 && step < 6 && (
        <FakeDialog
          title={`${worker.name} — ${dayLabel(iso, 'long')}`}
          footer={
            <>
              <span className="mr-auto text-[11px] text-[var(--muted)]">
                Total <strong className="text-[var(--text)]">{formatHours(total)}</strong>
                {breakMins > 0 && <> · incl. {breakMins} min unpaid break</>}
              </span>
              <FakeButton>Cancel</FakeButton>
              <FakeButton variant="primary" pressed={step === 5}>
                Save worked hours
              </FakeButton>
            </>
          }
        >
          <div key={step >= 4 ? 'split' : 'copied'} className={step === 4 ? 'ptour-anim ptour-in' : ''}>
            <DayLines day={{ roster, timesheet: worked, note: null }} variant="regular" />
          </div>
        </FakeDialog>
      )}
    </RosterPage>
  );
}

/* ------------------------------------------------------------------ */
/* 6. Approve, then lock                                               */
/* ------------------------------------------------------------------ */

function signed(n: number): string {
  if (n === 0) return formatHours(0);
  return `${n > 0 ? '+' : '−'}${formatHours(Math.abs(n))}`;
}

function ApproveScene({ step }: SceneProps) {
  if (step < 3) {
    const approved = step >= 2;
    const cols = 'grid-cols-[minmax(0,1fr)_auto] @xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.8fr))_6.5rem]';
    return (
      <Page
        title="Timesheets"
        meta={
          <>
            <span>Pay period {PERIOD}</span>
            <span aria-hidden="true">·</span>
            <span>{DEMO_TIMESHEETS.length} workers</span>
          </>
        }
        actions={
          <FakeButton variant="primary" pressed={step === 1} className={approved ? 'opacity-50' : ''}>
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            Approve all waiting ({approved ? 0 : DEMO_TIMESHEETS.length})
          </FakeButton>
        }
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex overflow-hidden rounded-lg border border-[var(--border)] text-[10.5px] font-medium">
            {['Waiting', 'Approved', 'Locked', 'All'].map(tab => (
              <span key={tab} className={`px-2 py-1 ${tab === 'All' ? 'bg-[var(--panel-subtle)] text-[var(--text)]' : 'text-[var(--muted)]'}`}>
                {tab}
              </span>
            ))}
          </span>
          <span key={String(approved)} className="ptour-anim ptour-fade text-[11px] text-[var(--muted)]">
            {approved ? 'Every timesheet in this view is approved' : `${DEMO_TIMESHEETS.length} timesheets waiting for approval`}
          </span>
        </div>
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] text-xs">
          <div className={`grid ${cols} gap-3 border-b border-[var(--border)] bg-[var(--table-header)] px-3 py-2 text-[10px] font-bold text-[var(--muted)] uppercase`}>
            <span>Worker</span>
            <span className="hidden text-right @xl:block">Rostered</span>
            <span className="hidden text-right @xl:block">Worked</span>
            <span className="hidden text-right @xl:block">vs contract</span>
            <span>Status</span>
          </div>
          {DEMO_TIMESHEETS.map((row, i) => {
            const diff = row.worked - row.contractHours;
            const tone = diff === 0 ? 'text-[var(--success)]' : diff > 0 ? 'text-[var(--warn)]' : 'text-[var(--danger)]';
            return (
              <div key={row.name} className={`grid ${cols} items-center gap-3 border-b border-[var(--border)] px-3 py-2 last:border-b-0`}>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-[var(--text)]">{row.name}</span>
                  <span className="block text-[10.5px] text-[var(--muted)] @xl:hidden">
                    Worked {formatHours(row.worked)} · rostered {formatHours(row.rostered)}
                  </span>
                </span>
                <span className="hidden text-right tabular-nums text-[var(--text)] @xl:block">{formatHours(row.rostered)}</span>
                <span className="hidden text-right font-semibold tabular-nums text-[var(--text)] @xl:block">{formatHours(row.worked)}</span>
                <span className={`hidden text-right font-medium tabular-nums @xl:block ${tone}`}>{signed(diff)}</span>
                <span key={String(approved)} className={approved ? 'ptour-anim ptour-in' : ''} style={approved ? { animationDelay: `${i * 140}ms` } : undefined}>
                  <TimesheetStatusBadge status={approved ? 'Approved' : 'Draft'} />
                </span>
              </div>
            );
          })}
        </div>
      </Page>
    );
  }

  const locked = step >= 7;
  return (
    <div className="ptour-anim ptour-fade h-full">
      <RosterPage
        badges={
          locked && (
            <span className="ptour-anim ptour-in inline-flex">
              <Badge variant="warning" size="sm">
                <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                Timesheets locked
              </Badge>
            </span>
          )
        }
        actions={
          <FakeButton pressed={step === 3} pressDelay={350}>
            {locked ? <Lock className="h-3 w-3" aria-hidden="true" /> : <LockOpen className="h-3 w-3" aria-hidden="true" />}
            {locked ? 'Timesheets locked' : 'Timesheets open'}
          </FakeButton>
        }
      >
        <RosterGrid
          state={{ rostered: true, changed: true, worked: true, leaveEdited: true, status: locked ? 'Locked' : 'Approved', statusFlip: locked }}
        />
        {step >= 4 && step < 7 && (
          <FakeDialog
            title={`Lock timesheets · ${BRANCH.name}`}
            footer={
              <>
                <FakeButton>Cancel</FakeButton>
                <FakeButton variant="primary" pressed={step === 6}>
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  Lock timesheets
                </FakeButton>
              </>
            }
          >
            <p className="text-[11px] leading-relaxed text-[var(--muted)]">
              Worked hours for this branch and pay period can’t change, and timesheets can’t be approved or reopened, while
              timesheets are locked.
            </p>
            <div className="space-y-1">
              <span className="block text-[11px] font-semibold text-[var(--text)]">Password</span>
              <span className={`${inputLook} ${step === 5 ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]' : 'border-[var(--border)]'}`}>
                {step >= 5 && <span className="ptour-anim ptour-type tracking-[0.2em]">••••••••••</span>}
              </span>
            </div>
          </FakeDialog>
        )}
      </RosterPage>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 7. Payroll report                                                   */
/* ------------------------------------------------------------------ */

/*
 * Report columns by stage width: the worker, ordinary hours and the total always; weekend and leave
 * columns join as the stage gets wider, and every column shows at full width.
 */
const REPORT_SHOW: Record<(typeof DEMO_REPORT_COLUMNS)[number], string> = {
  Ordinary: 'table-cell',
  Saturday: 'hidden @xl:table-cell',
  Sunday: 'hidden @md:table-cell',
  'Public holiday': 'hidden @4xl:table-cell',
  'Annual Leave': 'hidden @3xl:table-cell',
  'Sick Leave': 'hidden @xl:table-cell',
  TIL: 'hidden @3xl:table-cell',
  LWIP: 'hidden @4xl:table-cell',
  Other: 'hidden @4xl:table-cell',
};

const hoursCell = (h: number) => (h === 0 ? <span className="text-[var(--muted)]/60">–</span> : h.toFixed(2));

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** The key figures at the top of Reports, from the same example fortnight. */
const REPORT_TILES = (() => {
  const worked = sum(DEMO_TIMESHEETS.map(t => t.worked));
  const contracted = sum(DEMO_TIMESHEETS.map(t => t.contractHours));
  const leaveColumns = ['Annual Leave', 'Sick Leave', 'TIL', 'LWIP', 'Other'].map(c => DEMO_REPORT_COLUMNS.indexOf(c as (typeof DEMO_REPORT_COLUMNS)[number]));
  return [
    { label: 'Rostered', value: formatHours(sum(DEMO_TIMESHEETS.map(t => t.rostered))), show: '' },
    { label: 'Worked', value: formatHours(worked), show: '' },
    { label: 'Variance vs contract', value: signed(worked - contracted), show: '', tone: worked === contracted ? 'text-[var(--success)]' : worked > contracted ? 'text-[var(--warn)]' : 'text-[var(--danger)]' },
    { label: 'Unplanned', value: formatHours(0), show: 'hidden @3xl:block' },
    { label: 'Leave', value: formatHours(sum(DEMO_REPORT.flatMap(row => leaveColumns.map(c => row.hours[c])))), show: 'hidden @3xl:block' },
  ];
})();

function ReportScene({ step }: SceneProps) {
  return (
    <Page
      title="Reports"
      meta={
        <>
          <span className="font-medium text-[var(--text)]">{PERIOD}</span>
          <BranchChip />
        </>
      }
      actions={
        <>
          <span className="hidden @md:inline-flex">
            <FakeButton>
              <Printer className="h-3 w-3" aria-hidden="true" />
              Print / PDF
            </FakeButton>
          </span>
          <FakeButton variant="primary" pressed={step === 2}>
            <Download className="h-3 w-3" aria-hidden="true" />
            Export CSV
          </FakeButton>
        </>
      }
    >
      <div className="mb-3 grid grid-cols-3 gap-2 @3xl:grid-cols-5">
        {REPORT_TILES.map(tile => (
          <div key={tile.label} className={`${tile.show} min-w-0 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-2.5 py-2`}>
            <div className="truncate text-[9.5px] font-semibold tracking-wider text-[var(--muted)] uppercase">{tile.label}</div>
            <div className={`mt-0.5 text-sm font-bold tabular-nums @xl:text-base ${tile.tone ?? 'text-[var(--text)]'}`}>{tile.value}</div>
          </div>
        ))}
      </div>
      <div className="mb-2 flex gap-1 border-b border-[var(--border)] text-[11px] font-medium">
        {['Summary', 'Hours by category', 'Exceptions'].map(tab => (
          <span
            key={tab}
            className={`-mb-px border-b-2 px-2 pb-1.5 ${
              tab === 'Hours by category' ? 'border-[var(--primary)] text-[var(--text)]' : 'border-transparent text-[var(--muted)]'
            }`}
          >
            {tab}
          </span>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <table className="w-full border-collapse text-left text-[11px]">
          <thead>
            <tr className="bg-[var(--table-header)] text-[10px] text-[var(--muted)]">
              <th className="px-3 py-2 font-semibold">Worker</th>
              {DEMO_REPORT_COLUMNS.map(column => (
                <th key={column} className={`${REPORT_SHOW[column]} px-2 py-2 text-right font-semibold`}>
                  {column}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-semibold">Total worked</th>
            </tr>
          </thead>
          <tbody>
            {DEMO_REPORT.map((row, i) => (
              <tr
                key={row.name}
                className={`border-t border-[var(--border)] ${step >= 1 ? 'ptour-anim ptour-in' : 'ptour-hidden'}`}
                style={step >= 1 ? { animationDelay: `${i * 110}ms` } : undefined}
              >
                <td className="truncate px-3 py-2 font-semibold whitespace-nowrap text-[var(--text)]">{row.name}</td>
                {DEMO_REPORT_COLUMNS.map((column, c) => (
                  <td key={column} className={`${REPORT_SHOW[column]} px-2 py-2 text-right font-mono tabular-nums text-[var(--text)]`}>
                    {hoursCell(row.hours[c])}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-[var(--text)]">
                  {row.hours.reduce((sum, h) => sum + h, 0).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Reveal show={step >= 2} className="mt-2.5 flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
        <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        One row per worker, ready for whoever runs your payroll.
      </Reveal>
    </Page>
  );
}

/* ------------------------------------------------------------------ */
/* The app around the scenes                                           */
/* ------------------------------------------------------------------ */

type NavKey = 'today' | 'roster' | 'timesheets' | 'leave' | 'workers' | 'branch-admins' | 'reports' | 'audit' | 'branches' | 'chat' | 'settings';

/** The manager menu, in the app's order and words (components/Layout.tsx). */
const NAV: Array<{ title: string; items: Array<{ key: NavKey; label: string; icon: typeof Calendar }> }> = [
  {
    title: 'Daily work',
    items: [
      { key: 'today', label: 'Today', icon: LayoutDashboard },
      { key: 'roster', label: 'Roster', icon: Calendar },
      { key: 'timesheets', label: 'Timesheets', icon: CheckSquare },
      { key: 'leave', label: 'Leave requests', icon: CalendarDays },
    ],
  },
  {
    title: 'People',
    items: [
      { key: 'workers', label: 'Workers', icon: Users },
      { key: 'branch-admins', label: 'Branch Admins', icon: UserCog },
    ],
  },
  {
    title: 'Records',
    items: [
      { key: 'reports', label: 'Reports', icon: BarChart3 },
      { key: 'audit', label: 'Audit log', icon: FileText },
    ],
  },
  {
    title: 'Organisation',
    items: [
      { key: 'branches', label: 'Branches', icon: Building2 },
      { key: 'chat', label: 'Team chat', icon: MessageSquare },
      { key: 'settings', label: 'Settings', icon: Sliders },
    ],
  },
];

function Sidebar({ active, ready }: { active: NavKey | null; ready: boolean }) {
  const chip = 'flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10.5px] font-semibold text-white';
  const placeholder = <span className="h-2 w-20 rounded-full bg-white/15" />;
  return (
    <div className="hidden w-44 shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] lg:flex xl:w-48">
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--primary)] text-white">
          <Clock className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
        </span>
        <span className="text-xs font-semibold text-white">SimpleHours</span>
      </div>
      <div className="space-y-1.5 px-2.5">
        <div className={chip}>
          <Building2 className="h-3 w-3 shrink-0 text-[var(--sidebar-text)]" aria-hidden="true" />
          {ready ? <span className="ptour-anim ptour-fade truncate">{DEMO_ORGANISATION}</span> : placeholder}
        </div>
        <div className={chip}>
          <MapPin className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden="true" />
          {ready ? <span className="ptour-anim ptour-fade truncate">{BRANCH.name}</span> : placeholder}
        </div>
      </div>
      <div className={`mt-2.5 space-y-1.5 px-2 transition-opacity duration-300 ${ready ? '' : 'opacity-40'}`}>
        {NAV.map(section => (
          <div key={section.title} className="space-y-px">
            <div className="px-2.5 pb-0.5 text-[9px] font-bold tracking-wider text-[var(--sidebar-text)] uppercase opacity-60">{section.title}</div>
            {section.items.map(({ key, label, icon: Icon }) => (
              <div
                key={key}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-1 text-[11px] ${
                  key === active
                    ? 'bg-[var(--sidebar-active-bg)] font-semibold text-[var(--sidebar-active-text)]'
                    : 'font-medium text-[var(--sidebar-text)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const SCENES: Record<TourChapter['id'], { Scene: (props: SceneProps) => ReactNode; nav: (step: number) => NavKey | null; page: (step: number) => string }> = {
  organisation: { Scene: OrganisationScene, nav: () => null, page: () => 'setup' },
  branches: { Scene: BranchesScene, nav: step => (step < 4 ? 'branches' : 'branch-admins'), page: step => (step < 4 ? 'branches' : 'branch-admins') },
  workers: { Scene: WorkersScene, nav: () => 'workers', page: () => 'workers' },
  roster: { Scene: RosterScene, nav: () => 'roster', page: () => 'roster' },
  hours: { Scene: HoursScene, nav: () => 'roster', page: () => 'roster' },
  approve: { Scene: ApproveScene, nav: step => (step < 3 ? 'timesheets' : 'roster'), page: step => (step < 3 ? 'timesheets' : 'roster') },
  report: { Scene: ReportScene, nav: () => 'reports', page: () => 'reports' },
};

/**
 * One frame of the tour: the app's sidebar (from large screens up) and the chapter's screen at
 * `step`. `from` is the chapter shown before; moving between chapters on the same screen (roster
 * to hours worked) doesn't fade, so the grid carries straight on.
 */
export function TourStage({ chapter, step, run, from }: { chapter: TourChapter; step: number; run: number; from: TourChapter | null }) {
  const { Scene, nav } = SCENES[chapter.id];
  const samePage = from !== null && SCENES[from.id].page(Number.MAX_SAFE_INTEGER) === SCENES[chapter.id].page(0);
  return (
    <div className="flex h-full bg-[var(--bg)]">
      <Sidebar active={nav(step)} ready={chapter.id !== 'organisation' || step >= 5} />
      <div key={run} className={`@container min-w-0 flex-1 ${samePage ? '' : 'ptour-anim ptour-fade'}`}>
        <Scene step={step} />
      </div>
    </div>
  );
}
