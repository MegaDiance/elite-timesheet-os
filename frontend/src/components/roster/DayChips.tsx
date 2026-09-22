import { Check, MessageSquare } from 'lucide-react';
import {
  SEGMENT_CODE,
  SEGMENT_LABEL,
  SEGMENT_TYPES,
  apiSideSummary,
  chipStyle,
  formatHours,
  sideSegments,
  type ApiSegment,
  type Side,
} from './segments';

interface DayChipsProps {
  segments: ApiSegment[];
  side: Side;
  /** Grid cells use the compact size; the timesheet review uses the roomier one. */
  size?: 'compact' | 'regular';
}

/**
 * One side (rostered or worked) of a day as small chips: type code + times (or hours).
 * Worked chips carry a ✓, unplanned ones a "U", so meaning never depends on colour alone.
 */
export function DayChips({ segments, side, size = 'compact' }: DayChipsProps) {
  const list = sideSegments(segments, side);
  const compact = size === 'compact';
  if (list.length === 0) {
    return <span className={`text-[var(--muted)] opacity-40 ${compact ? 'text-[0.62rem]' : 'text-xs'}`} aria-hidden="true">—</span>;
  }
  return (
    <>
      {list.map((s, i) => {
        const { type, range, hours } = apiSideSummary(s, side);
        const code = SEGMENT_CODE[type];
        const when = range ?? formatHours(hours);
        const unplanned = Boolean(s.is_unplanned) && side === 'actual';
        const title = `${side === 'roster' ? 'Rostered' : 'Worked'}: ${SEGMENT_LABEL[type]} ${when}${range ? ` (${formatHours(hours)})` : ''}${unplanned ? ' · unplanned' : ''}${s.notes ? ` · Note: ${s.notes}` : ''}`;
        return (
          <span
            key={s.id ?? i}
            title={title}
            style={chipStyle(type, side, unplanned)}
            className={`inline-flex items-center justify-center gap-0.5 max-w-full rounded border font-bold leading-tight ${
              compact ? 'w-full text-[0.62rem] px-0.5 py-px tracking-tight' : 'text-[11px] px-1.5 py-0.5'
            }`}
          >
            {side === 'actual' && <Check className={compact ? 'w-2.5 h-2.5 shrink-0' : 'w-3 h-3 shrink-0'} aria-hidden="true" strokeWidth={3} />}
            {unplanned && <span className="shrink-0 font-black">U</span>}
            <span className="truncate">{code ? `${code} ${when}` : when}</span>
            {s.notes && <MessageSquare className="w-2.5 h-2.5 shrink-0 opacity-70" aria-hidden="true" />}
          </span>
        );
      })}
    </>
  );
}

/** Colour key with text, for the roster status bar. */
export function SegmentLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[var(--muted)]" aria-label="Segment types">
      {SEGMENT_TYPES.map(type => (
        <li key={type}>
          <span style={chipStyle(type, 'roster')} className="inline-block rounded border px-1 py-px font-bold text-[10px]">
            {SEGMENT_CODE[type] || '9–17'}
          </span>{' '}
          {SEGMENT_LABEL[type]}
        </li>
      ))}
      <li>
        <span style={chipStyle('WORK', 'actual')} className="inline-flex items-center gap-0.5 rounded border px-1 py-px font-bold text-[10px]">
          <Check className="w-2.5 h-2.5" aria-hidden="true" strokeWidth={3} />9–17
        </span>{' '}
        Worked
      </li>
      <li>
        <span style={chipStyle('WORK', 'actual', true)} className="inline-block rounded border px-1 py-px font-black text-[10px]">U</span> Unplanned
      </li>
    </ul>
  );
}
