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
