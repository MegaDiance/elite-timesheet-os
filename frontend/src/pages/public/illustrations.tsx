import { Chip, MockFrame } from './ui';

/**
 * Illustrations of SimpleHours screens for the public website, drawn in HTML so they follow the
 * light/dark theme and stay sharp at any size. Every name, date and time in here is an example.
 */

type LeaveKind = 'Sick Leave' | 'Annual Leave' | 'TIL' | 'LWIP' | 'Other';

const LEAVE_ACCENT: Record<LeaveKind, string> = {
  'Sick Leave': 'border-[var(--warn)] bg-[var(--warn-light)]',
  'Annual Leave': 'border-[var(--primary)] bg-[var(--primary-light)]',
  TIL: 'border-[var(--success)] bg-[var(--success-light)]',
  LWIP: 'border-[var(--danger)] bg-[var(--danger-light)]',
  Other: 'border-[var(--border-hover)] bg-[var(--panel-subtle)]',
};

function LeaveTag({ kind, time }: { kind: LeaveKind; time?: string }) {
  return (
    <span className={`flex flex-wrap items-baseline gap-x-1.5 rounded-sm border-l-2 px-1.5 py-0.5 text-[10px] leading-snug text-[var(--text)] ${LEAVE_ACCENT[kind]}`}>
      <span className="font-semibold">{kind}</span>
      {time && <span className="font-mono tabular-nums">{time}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Fortnight roster (hero)                                             */
/* ------------------------------------------------------------------ */

type RosterCell = null | { rostered: string; worked?: string; leave?: { kind: LeaveKind; time: string } };

// Visibility follows the illustration's own width (container queries), so it reads well in a
// narrow column as well as full width: Mon–Tue always, then Wed, Thu, Fri, and the weekend last.
const DAYS = [
  { name: 'Sun', date: '10', show: 'hidden @4xl:block' },
  { name: 'Mon', date: '11', show: 'block' },
  { name: 'Tue', date: '12', show: 'block' },
  { name: 'Wed', date: '13', show: 'hidden @md:block' },
  { name: 'Thu', date: '14', show: 'hidden @xl:block' },
  { name: 'Fri', date: '15', show: 'hidden @3xl:block' },
  { name: 'Sat', date: '16', show: 'hidden @4xl:block' },
];

const GRID =
  'grid gap-1.5 grid-cols-[5.25rem_repeat(2,minmax(0,1fr))] @md:grid-cols-[6.5rem_repeat(3,minmax(0,1fr))] @xl:grid-cols-[7.5rem_repeat(4,minmax(0,1fr))] @3xl:grid-cols-[8rem_repeat(5,minmax(0,1fr))] @4xl:grid-cols-[9rem_repeat(7,minmax(0,1fr))]';

const ROSTER: Array<{ name: string; days: RosterCell[] }> = [
  {
    name: 'Aisha Khan',
    days: [
      null,
      { rostered: '9:00–17:00', worked: '9:05–17:02' },
      { rostered: '9:00–17:00', worked: '8:58–17:00' },
      { rostered: '9:00–17:00', worked: '9:00–17:15' },
      { rostered: '9:00–17:00', worked: '9:02–17:00' },
      { rostered: '9:00–17:00' },
      null,
    ],
  },
  {
    name: 'Grace Wilson',
    days: [
      null,
      { rostered: '9:00–17:00', worked: '9:00–17:00' },
      { rostered: '9:00–17:00', worked: '9:00–13:00', leave: { kind: 'Sick Leave', time: '13:00–17:00' } },
      { rostered: '9:00–17:00', worked: '9:04–17:01' },
      { rostered: '9:00–15:00', worked: '9:00–15:00' },
      { rostered: '9:00–17:00' },
      null,
    ],
  },
  {
    name: 'Tom Nguyen',
    days: [
      { rostered: '8:00–14:00', worked: '8:00–14:10' },
      null,
      { rostered: '12:00–20:00', worked: '12:00–20:05' },
      { rostered: '12:00–20:00', worked: '11:55–20:00' },
      null,
      { rostered: '12:00–20:00' },
      { rostered: '8:00–14:00' },
    ],
  },
  {
    name: 'Liam O’Brien',
    days: [
      { rostered: '10:00–16:00', worked: '10:00–16:00' },
      { rostered: '7:00–15:30', worked: '7:00–15:30' },
      { rostered: '7:00–15:30', worked: '7:05–15:30' },
      null,
      { rostered: '7:00–15:30', worked: '7:00–11:00', leave: { kind: 'TIL', time: '11:00–15:30' } },
      { rostered: '7:00–15:30' },
      null,
    ],
  },
];

const cellLabel = 'text-[10px] font-medium uppercase tracking-wide text-[var(--text)]/65';

function RosterDay({ cell }: { cell: RosterCell }) {
  if (!cell) {
    return (
      <div className="flex h-full min-h-[6.5rem] items-center justify-center rounded-md border border-dashed border-[var(--border-hover)] text-[11px] text-[var(--text)]/65">
        Not rostered
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col rounded-md border border-[var(--border)] bg-[var(--panel)] p-2 text-xs leading-snug">
      <div className={cellLabel}>Rostered</div>
      <div className="font-mono tabular-nums text-[var(--text)]/80">{cell.rostered}</div>
      <div className={`mt-1.5 border-t border-[var(--border)] pt-1.5 ${cellLabel}`}>Worked</div>
      {cell.worked ? (
        <div className="font-mono font-semibold tabular-nums text-[var(--text)]">{cell.worked}</div>
      ) : (
        <div className="text-[var(--text)]/65">To record</div>
      )}
      {cell.leave && (
        <div className="mt-1">
          <LeaveTag kind={cell.leave.kind} time={cell.leave.time} />
        </div>
      )}
    </div>
  );
}

export function RosterIllustration({ className = '' }: { className?: string }) {
  return (
    <MockFrame
      className={className}
      title={
        <>
          <span>Roster</span>
          <Chip>Richmond</Chip>
        </>
      }
      meta={
        <>
          <span className="font-medium text-[var(--text)]">Fortnight 10–23 May</span>
          <span className="inline-flex overflow-hidden rounded-md border border-[var(--border)] text-[11px] font-medium">
            <span className="bg-[var(--panel-subtle)] px-2 py-0.5 text-[var(--text)]">Week 1</span>
            <span className="px-2 py-0.5">Week 2</span>
          </span>
        </>
      }
      caption="Illustration of the roster screen: what each person was rostered for, and what they actually worked. Names and times are examples."
    >
      <div className="@container">
        <div className={GRID}>
          <div className="self-end px-1 pb-1 text-[11px] font-semibold text-[var(--text)]/70">Worker</div>
          {DAYS.map(day => (
            <div key={day.name} className={`${day.show} px-1 pb-1 text-[11px] font-semibold text-[var(--text)]/70`}>
              {day.name} <span className="text-[var(--text)]">{day.date}</span>
            </div>
          ))}

          {ROSTER.map(row => (
            <div key={row.name} className="contents">
              <div className="flex items-center rounded-md px-1 text-xs font-semibold text-[var(--text)] @md:text-sm">
                {row.name}
              </div>
              {row.days.map((cell, i) => (
                <div key={DAYS[i].name} className={DAYS[i].show}>
                  <RosterDay cell={cell} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </MockFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Default roster and copy a day                                       */
/* ------------------------------------------------------------------ */

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DEFAULT_WEEKS: Array<Array<string | null>> = [
  [null, '9:00|17:00', '9:00|17:00', '9:00|17:00', '9:00|17:00', '9:00|17:00', null],
  [null, '9:00|17:00', '9:00|17:00', null, '9:00|17:00', '9:00|13:00', null],
];

export function DefaultRosterIllustration({ className = '' }: { className?: string }) {
  return (
    <MockFrame
      className={className}
      title={
        <>
          <span>Default roster</span>
          <span className="truncate font-normal text-[var(--text)]/70">Aisha Khan</span>
        </>
      }
      meta={<span>14-day pattern</span>}
      caption="Illustration of a worker's default roster and the copy-a-day option. Names and times are examples."
    >
      <div className="space-y-2">
        {DEFAULT_WEEKS.map((week, w) => (
          <div key={w} className="grid grid-cols-[1.75rem_repeat(7,minmax(0,1fr))] items-stretch gap-1 sm:grid-cols-[3.25rem_repeat(7,minmax(0,1fr))] sm:gap-1.5">
            <div className="flex items-center text-[11px] font-semibold text-[var(--text)]/70">
              <span className="sm:hidden">W{w + 1}</span>
              <span className="hidden sm:inline">Week {w + 1}</span>
            </div>
            {week.map((shift, d) => (
              <div
                key={d}
                className={`flex min-h-[3.25rem] flex-col items-center justify-center rounded-md px-0.5 py-1 text-center ${
                  shift ? 'border border-[var(--border)] bg-[var(--panel)]' : 'border border-dashed border-[var(--border-hover)]'
                }`}
              >
                <span className="text-[10px] font-semibold text-[var(--text)]/70">{WEEKDAY_INITIALS[d]}</span>
                {shift ? (
                  <span className="font-mono text-[9px] leading-tight tabular-nums text-[var(--text)] sm:text-[10px]">
                    {shift.split('|')[0]}
                    <br />
                    {shift.split('|')[1]}
                  </span>
                ) : (
                  <span className="text-[10px] text-[var(--text)]/70">off</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
        <div className="text-xs font-semibold text-[var(--text)]">
          Copy <span className="font-mono">Mon 11</span> (9:00–17:00) to
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { day: 'Tue 12', on: true },
            { day: 'Wed 13', on: true },
            { day: 'Thu 14', on: true },
            { day: 'Fri 15', on: false },
            { day: 'Sat 16', on: false },
          ].map(d => (
            <span
              key={d.day}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${
                d.on
                  ? 'border-[var(--primary)] bg-[var(--primary-light)] text-[var(--text)]'
                  : 'border-[var(--border)] text-[var(--text)]/70'
              }`}
            >
              <span
                className={`flex h-3 w-3 items-center justify-center rounded-[3px] border ${
                  d.on ? 'border-[var(--primary)] bg-[var(--primary)]' : 'border-[var(--border-hover)]'
                }`}
              >
                {d.on && (
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2.5 6.5 5 9l4.5-6" />
                  </svg>
                )}
              </span>
              {d.day}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
          <span className="rounded-md bg-[var(--primary)] px-2.5 py-1 text-[11px] font-semibold text-white">Copy to 3 days</span>
          <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text)]">
            Apply default rosters
          </span>
        </div>
      </div>
    </MockFrame>
  );
}

/* ------------------------------------------------------------------ */
/* One day of a timesheet                                              */
/* ------------------------------------------------------------------ */

function SegmentRow({ type, time, hours, note }: { type: string; time: string; hours: string; note?: string }) {
  const leave = type !== 'Normal Work';
  return (
    <div
      className={`rounded-md border-l-2 px-3 py-2 ${
        leave ? LEAVE_ACCENT[type as LeaveKind] : 'border-[var(--text)]/40 bg-[var(--panel)]'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-semibold text-[var(--text)]">{type}</span>
        <span className="font-mono font-semibold tabular-nums text-[var(--text)]">{hours}</span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-3 text-[11px] text-[var(--text)]/70">
        <span className="font-mono tabular-nums">{time}</span>
        {note && <span className="text-right">{note}</span>}
      </div>
    </div>
  );
}

export function TimesheetDayIllustration({ className = '' }: { className?: string }) {
  return (
    <MockFrame
      className={className}
      title={
        <>
          <span>Tue 12 May</span>
          <span className="truncate font-normal text-[var(--text)]/70">Grace Wilson</span>
        </>
      }
      meta={<Chip>Draft</Chip>}
      caption="Illustration of one day on a timesheet, with part-day sick leave and the unpaid break. Names, times and hours are examples."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className={cellLabel}>Rostered</div>
          <SegmentRow type="Normal Work" time="9:00–17:00" hours="7.50 h" note="less 30 min break" />
        </div>
        <div className="space-y-2">
          <div className={cellLabel}>Worked</div>
          <SegmentRow type="Normal Work" time="9:00–13:00" hours="3.50 h" note="less 30 min break" />
          <SegmentRow type="Sick Leave" time="13:00–17:00" hours="4.00 h" note="no break taken" />
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3 border-t border-[var(--border)] pt-3 text-xs sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[var(--text)]/75">
          Unpaid break: <span className="font-semibold text-[var(--text)]">30 min, once for the day</span>, from Normal Work
          only.
        </p>
        <span className="self-start rounded-md bg-[var(--primary)] px-2.5 py-1 text-[11px] font-semibold text-white sm:self-auto">
          Approve timesheet
        </span>
      </div>
    </MockFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Branches and who can see them                                       */
/* ------------------------------------------------------------------ */

export function BranchAccessIllustration({ className = '' }: { className?: string }) {
  const branches = [
    { name: 'Richmond', admins: ['Priya S.'] },
    { name: 'Footscray', admins: ['Priya S.'] },
    { name: 'Geelong', admins: ['Daniel M.'] },
  ];
  return (
    <MockFrame
      className={className}
      title={<span>Branches and access</span>}
      meta={<span>Example organisation</span>}
      caption="Illustration: the Organisation Owner sees every branch; each Branch Admin sees only the branches they are assigned to. Names are examples."
    >
      <div className="mx-auto max-w-md">
        <div className="rounded-lg border border-[var(--primary)] bg-[var(--panel)] px-4 py-3 text-center">
          <div className="text-sm font-semibold text-[var(--text)]">Organisation Owner</div>
          <div className="text-[11px] text-[var(--text)]/70">Settings, branches, Branch Admins, audit log · every branch</div>
        </div>

        {/* connectors */}
        <div className="relative h-6">
          <span className="absolute top-0 left-1/2 h-3 w-px bg-[var(--border-hover)]" />
          <span className="absolute top-3 right-[16.66%] left-[16.66%] h-px bg-[var(--border-hover)]" />
        </div>

        <div className="grid grid-cols-3 gap-2">
          {branches.map(branch => (
            <div key={branch.name} className="relative">
              <span className="absolute -top-3 left-1/2 h-3 w-px bg-[var(--border-hover)]" />
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-2.5 text-center">
                <div className="truncate text-xs font-semibold text-[var(--text)] sm:text-sm">{branch.name}</div>
                <div className="mt-0.5 text-[10px] text-[var(--text)]/70">Workers · roster · timesheets</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="col-span-2 rounded-md border border-dashed border-[var(--border-hover)] px-2 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--text)]/70">Branch Admin</div>
            <div className="text-xs font-semibold text-[var(--text)]">Priya S.</div>
            <div className="text-[10px] text-[var(--text)]/70">Richmond and Footscray only</div>
          </div>
          <div className="rounded-md border border-dashed border-[var(--border-hover)] px-2 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--text)]/70">Branch Admin</div>
            <div className="text-xs font-semibold text-[var(--text)]">Daniel M.</div>
            <div className="text-[10px] text-[var(--text)]/70">Geelong only</div>
          </div>
        </div>
      </div>
    </MockFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Payroll report                                                      */
/* ------------------------------------------------------------------ */

const REPORT_COLUMNS = ['Ordinary', 'Saturday', 'Sunday', 'Public holiday', 'Sick Leave', 'Annual Leave', 'TIL', 'LWIP', 'Other'];
const REPORT_ROWS: Array<{ name: string; hours: Array<string | null> }> = [
  { name: 'Aisha Khan', hours: ['75.00', null, null, null, null, null, null, null, null] },
  { name: 'Grace Wilson', hours: ['56.00', null, null, null, '4.00', '7.50', null, null, null] },
  { name: 'Tom Nguyen', hours: ['45.00', '12.00', '12.00', null, null, null, null, null, null] },
  { name: 'Liam O’Brien', hours: ['59.50', null, '12.00', null, null, null, '4.50', null, null] },
];

/** A real, accessible table (with a caption) so the example reads correctly with a screen reader too. */
export function PayrollReportIllustration({ className = '' }: { className?: string }) {
  return (
    <figure className={className}>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--border)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <span>Payroll report</span>
            <span className="font-normal text-[var(--text)]/70">Richmond · Fortnight 10–23 May</span>
          </div>
          <div aria-hidden="true" className="flex gap-2 select-none">
            <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text)]">CSV</span>
            <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text)]">PDF</span>
          </div>
        </div>
        <div
          className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--primary)]"
          tabIndex={0}
          role="region"
          aria-label="Example payroll report (scrolls sideways on small screens)"
        >
          <table className="w-full min-w-[46rem] border-collapse text-left text-xs">
            <caption className="sr-only">
              Example payroll report: hours per worker for one fortnight, split by category. A dash means no hours.
            </caption>
            <thead>
              <tr className="bg-[var(--panel-subtle)]">
                <th scope="col" className="sticky left-0 bg-[var(--panel-subtle)] px-4 py-2.5 font-semibold text-[var(--text)]/70">Worker</th>
                {REPORT_COLUMNS.map(col => (
                  <th key={col} scope="col" className="px-2 py-2.5 text-right font-semibold text-[var(--text)]/70">
                    {col}
                  </th>
                ))}
                <th scope="col" className="px-4 py-2.5 font-semibold text-[var(--text)]/70">Timesheet</th>
              </tr>
            </thead>
            <tbody>
              {REPORT_ROWS.map(row => (
                <tr key={row.name} className="border-t border-[var(--border)]">
                  <th scope="row" className="sticky left-0 bg-[var(--panel)] px-4 py-2.5 font-semibold whitespace-nowrap text-[var(--text)]">{row.name}</th>
                  {row.hours.map((h, i) => (
                    <td key={REPORT_COLUMNS[i]} className="px-2 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                      {h ?? <span className="text-[var(--text)]/40">–</span>}
                    </td>
                  ))}
                  <td className="px-4 py-2.5">
                    <Chip tone="success">Approved</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-[var(--text)]/70">
        Illustration of the fortnightly payroll report. Names and hours are examples.
      </figcaption>
    </figure>
  );
}
