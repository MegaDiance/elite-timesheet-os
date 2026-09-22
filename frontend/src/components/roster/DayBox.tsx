import type { CSSProperties } from 'react';
import { MessageSquare } from 'lucide-react';
import {
  PART_LABEL, TYPE_LABEL, TYPE_SHORT, describePart, entryWhen, formatHours,
  type Entry, type EntryType, type Part,
} from './day';

/**
 * The same visual language everywhere: ROSTERED (planned) is muted with a dashed edge, WORKED (what
 * actually happened) is solid with a solid edge — and both always carry their label, so the meaning
 * never depends on colour alone. Leave always shows its name.
 */
export const PART_STYLE: Record<Part, string> = {
  roster: 'border-l-2 border-dashed border-[var(--muted)] text-[var(--muted)]',
  timesheet: 'border-l-[3px] border-solid border-[var(--success)] text-[var(--text)]',
};

const LEAVE_HUE: Record<Exclude<EntryType, 'WORK'>, string> = {
  Sick: '#d97706',
  Annual: '#9333ea',
  TIL: '#0891b2',
  LWIP: '#64748b',
  Other: '#db2777',
};

/** Leave names are tinted (mixed with the theme's text colour so they read in dark and light). */
const typeStyle = (type: EntryType): CSSProperties | undefined =>
  type === 'WORK' ? undefined : { color: `color-mix(in srgb, ${LEAVE_HUE[type]} 65%, var(--text))` };

export interface DayContent {
  roster: Entry[];
  timesheet: Entry[];
  note: string | null;
}

/** Plain words for a whole day, for screen readers and tooltips. */
export function describeDay(day: DayContent): string {
  return `${describePart('roster', day.roster)}; ${describePart('timesheet', day.timesheet)}${day.note ? `; note: ${day.note}` : ''}`;
}

function CompactPart({ part, entries }: { part: Part; entries: Entry[] }) {
  const worked = part === 'timesheet';
  return (
    <span className={`block pl-1.5 min-w-0 ${PART_STYLE[part]}`}>
      <span className={`block text-[9px] leading-3 uppercase tracking-wide ${worked ? 'font-bold' : 'font-medium'}`}>{PART_LABEL[part]}</span>
      {entries.map((e, i) => (
        <span key={i} className={`block truncate text-[11px] leading-4 tabular-nums ${worked ? 'font-semibold' : ''}`}>
          {TYPE_SHORT[e.type] && <span style={typeStyle(e.type)}>{TYPE_SHORT[e.type]} </span>}
          {entryWhen(e, 'short')}
        </span>
      ))}
    </span>
  );
}

/** One part of a day as plain lines ("Rostered 9:00 am – 5:00 pm · Normal Work · 7.5 h"). */
export function PartLines({ part, entries, emptyText }: { part: Part; entries: Entry[]; emptyText: string }) {
  return (
    <div className={`grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-2 pl-2 ${PART_STYLE[part]}`}>
      <span className={`text-xs leading-5 ${part === 'timesheet' ? 'font-semibold' : ''}`}>{PART_LABEL[part]}</span>
      {entries.length === 0 ? (
        <span className="text-xs leading-5 text-[var(--muted)] italic">{emptyText}</span>
      ) : (
        <ul className="min-w-0">
          {entries.map((e, i) => (
            <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] leading-5">
              <span className={`tabular-nums ${part === 'timesheet' ? 'font-semibold' : ''}`}>{entryWhen(e)}</span>
              <span className="text-xs text-[var(--muted)] tabular-nums">
                <span style={typeStyle(e.type)}>{TYPE_LABEL[e.type]}</span>
                {e.start ? ` · ${formatHours(e.hours)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One worker-day as a single box of plain lines: "Rostered 9:00 am – 5:00 pm", "Worked 9:05 am –
 * 5:02 pm", and only when needed more lines (part-day leave, a second shift, a note). The box grows
 * taller with the day instead of splitting into many small boxes.
 */
export function DayLines({ day, variant }: { day: DayContent; variant: 'compact' | 'regular' }) {
  const { roster, timesheet, note } = day;

  if (variant === 'compact') {
    return (
      <span className="flex flex-col gap-1 w-full text-left">
        {roster.length > 0 && <CompactPart part="roster" entries={roster} />}
        {timesheet.length > 0 && <CompactPart part="timesheet" entries={timesheet} />}
        {note && (
          <span className="flex items-center gap-1 text-[10px] leading-[15px] text-[var(--muted)] min-w-0">
            <MessageSquare className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{note}</span>
          </span>
        )}
      </span>
    );
  }

  if (roster.length === 0 && timesheet.length === 0 && !note) {
    return <p className="text-xs leading-5 text-[var(--muted)] italic">Nothing rostered or worked</p>;
  }
  return (
    <div className="space-y-1.5 w-full text-left">
      <PartLines part="roster" entries={roster} emptyText="Nothing rostered" />
      <PartLines part="timesheet" entries={timesheet} emptyText={roster.length > 0 ? 'Not recorded yet' : 'Nothing worked'} />
      {note && (
        <p className="flex items-start gap-1.5 text-xs text-[var(--muted)]">
          <MessageSquare className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          <span className="min-w-0 break-words">{note}</span>
        </p>
      )}
    </div>
  );
}

/** Key for the page header: what the two treatments mean. */
export function PlannedWorkedKey() {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      <span className={`pl-1.5 ${PART_STYLE.roster}`}>Rostered = planned</span>
      <span className={`pl-1.5 font-semibold ${PART_STYLE.timesheet}`}>Worked = what actually happened</span>
    </span>
  );
}
