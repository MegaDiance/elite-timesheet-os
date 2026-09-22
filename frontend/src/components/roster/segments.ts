import type { CSSProperties } from 'react';
import { isWeekendIso } from './dates';

/**
 * The client side of the one segment model shared by the roster and timesheets.
 *
 * A day is a list of segments. Each segment has a type and, independently, a rostered side
 * (roster_in / roster_out / roster_hours) and a worked side (actual_in / actual_out / actual_hours,
 * worked as actual_segment_type). A normal day is one segment; a split day such as
 *
 *     09:00–13:00 Sick Leave · 13:00–15:00 Annual Leave · 15:00–17:00 Normal Work
 *
 * is three segments of the same day.
 *
 * The server (backend/src/services/segments.ts) validates every day and computes every hour.
 * `validateDay` and `previewDayHours` below mirror it so the editor can explain problems and show
 * hours while the user types; keep them in step with the server.
 */

export const SEGMENT_TYPES = ['WORK', 'Sick', 'Annual', 'TIL', 'LWIP', 'Other'] as const;
export type SegmentType = (typeof SEGMENT_TYPES)[number];
export type Side = 'roster' | 'actual';

export const SEGMENT_LABEL: Record<SegmentType, string> = {
  WORK: 'Normal Work',
  Sick: 'Sick Leave',
  Annual: 'Annual Leave',
  TIL: 'TIL',
  LWIP: 'LWIP',
  Other: 'Other',
};

/** Text shown on compact grid chips. A Normal Work chip shows its times alone. */
export const SEGMENT_CODE: Record<SegmentType, string> = {
  WORK: '',
  Sick: 'Sick',
  Annual: 'AL',
  TIL: 'TIL',
  LWIP: 'LWIP',
  Other: 'Other',
};

export const SIDE_LABEL: Record<Side, string> = { roster: 'Rostered', actual: 'Worked' };

export const isSegmentType = (value: unknown): value is SegmentType =>
  typeof value === 'string' && (SEGMENT_TYPES as readonly string[]).includes(value);

/** Missing types are Normal Work; anything unrecognised is shown as Other. */
export const asSegmentType = (value: unknown): SegmentType =>
  isSegmentType(value) ? value : value === undefined || value === null || value === '' ? 'WORK' : 'Other';

// ── Colours ────────────────────────────────────────────────────────────────────────────────────
// Each hue is mixed with the theme's text colour, so chips stay readable in dark and light themes.
// Colour is never the only cue: chips always carry text (times, a type code, ✓ for worked, U for unplanned).

const HUES: Record<SegmentType, string> = {
  WORK: '#3b5bdb',
  Sick: '#d97706',
  Annual: '#9333ea',
  TIL: '#0891b2',
  LWIP: '#64748b',
  Other: '#db2777',
};
const WORKED_HUE = '#059669';
const UNPLANNED_HUE = '#dc2626';

export function segmentHue(type: SegmentType, side: Side, unplanned = false): string {
  if (unplanned) return UNPLANNED_HUE;
  if (type === 'WORK' && side === 'actual') return WORKED_HUE;
  return HUES[type];
}

export function chipStyle(type: SegmentType, side: Side, unplanned = false): CSSProperties {
  const hue = segmentHue(type, side, unplanned);
  return {
    color: `color-mix(in srgb, ${hue} 55%, var(--text))`,
    backgroundColor: `color-mix(in srgb, ${hue} 14%, transparent)`,
    borderColor: `color-mix(in srgb, ${hue} 45%, transparent)`,
  };
}

export const textStyle = (type: SegmentType, side: Side, unplanned = false): CSSProperties => ({
  color: `color-mix(in srgb, ${segmentHue(type, side, unplanned)} 60%, var(--text))`,
});

export const swatchStyle = (type: SegmentType, side: Side = 'roster', unplanned = false): CSSProperties => ({
  backgroundColor: segmentHue(type, side, unplanned),
});

// ── Times and hours ────────────────────────────────────────────────────────────────────────────

/** Longest single segment; a finish before the start runs past midnight, up to this long. */
export const MAX_SEGMENT_MINUTES = 14 * 60;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const hhmm = (t: string | null | undefined): string => (t ? String(t).slice(0, 5) : '');
const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** "09:00" → "9", "17:30" → "17:30". */
export function compactTime(t: string | null | undefined): string {
  const value = hhmm(t);
  if (!value) return '';
  const [h, m] = value.split(':');
  return m === '00' ? String(Number(h)) : `${Number(h)}:${m}`;
}

export const compactRange = (start: string | null | undefined, end: string | null | undefined): string =>
  `${compactTime(start)}–${compactTime(end)}`;

export const formatHours = (n: number | null | undefined): string => `${round2(Number(n) || 0)}h`;

// ── Break rule ─────────────────────────────────────────────────────────────────────────────────

export interface BreakSettings {
  break_mins_weekday: number;
  break_mins_weekend: number;
  break_threshold_hours: number;
}

/** The server's defaults, used until GET /organisation/me answers. */
export const DEFAULT_BREAK_SETTINGS: BreakSettings = { break_mins_weekday: 30, break_mins_weekend: 0, break_threshold_hours: 6 };

export interface BreakRule {
  breakMins: number;
  thresholdHours: number;
}

export function breakRuleFor(settings: BreakSettings, dateIso: string): BreakRule {
  return {
    breakMins: isWeekendIso(dateIso) ? settings.break_mins_weekend : settings.break_mins_weekday,
    thresholdHours: settings.break_threshold_hours,
  };
}

export function describeBreakRule(rule: BreakRule): string {
  if (rule.breakMins <= 0) return 'No unpaid break is deducted on this day.';
  return `A ${rule.breakMins} min unpaid break is deducted once on days of ${rule.thresholdHours} h or more, unless a gap of at least ${rule.breakMins} min is left between segments.`;
}

// ── API and editor shapes ──────────────────────────────────────────────────────────────────────

/** A segment as GET /records returns it (times "HH:MM:SS", hours possibly as strings). */
export interface ApiSegment {
  id?: string;
  segment_type: string;
  actual_segment_type?: string | null;
  is_unplanned?: boolean | null;
  roster_in?: string | null;
  roster_out?: string | null;
  roster_hours?: number | string | null;
  actual_in?: string | null;
  actual_out?: string | null;
  actual_hours?: number | string | null;
  notes?: string | null;
}

export interface DayRecord {
  id: string;
  employee_id: string;
  record_date: string;
  has_actuals: boolean;
  segments: ApiSegment[];
}

/** What POST /records receives for each segment. */
export interface SegmentPayload {
  segment_type: SegmentType;
  actual_segment_type: SegmentType | null;
  is_unplanned: boolean;
  roster_in: string | null;
  roster_out: string | null;
  roster_hours: number;
  actual_in: string | null;
  actual_out: string | null;
  actual_hours: number;
  notes: string | null;
}

/** One row of the day editor. Times are "HH:MM" or ''. Hours only count when a side has no times. */
export interface DraftSegment {
  key: string;
  segment_type: SegmentType;
  /** null = worked as the rostered type. */
  actual_segment_type: SegmentType | null;
  is_unplanned: boolean;
  roster_in: string;
  roster_out: string;
  roster_hours: number;
  actual_in: string;
  actual_out: string;
  actual_hours: number;
  notes: string;
}

let keySeq = 0;
const newKey = () => `seg-${Date.now().toString(36)}-${(keySeq++).toString(36)}`;

export const blankDraft = (): DraftSegment => ({
  key: newKey(),
  segment_type: 'WORK',
  actual_segment_type: null,
  is_unplanned: false,
  roster_in: '',
  roster_out: '',
  roster_hours: 0,
  actual_in: '',
  actual_out: '',
  actual_hours: 0,
  notes: '',
});

export function draftFromApi(s: ApiSegment): DraftSegment {
  const type = asSegmentType(s.segment_type);
  const worked = s.actual_segment_type ? asSegmentType(s.actual_segment_type) : null;
  return {
    key: newKey(),
    segment_type: type,
    actual_segment_type: worked && worked !== type ? worked : null,
    is_unplanned: Boolean(s.is_unplanned),
    roster_in: hhmm(s.roster_in),
    roster_out: hhmm(s.roster_out),
    roster_hours: Number(s.roster_hours) || 0,
    actual_in: hhmm(s.actual_in),
    actual_out: hhmm(s.actual_out),
    actual_hours: Number(s.actual_hours) || 0,
    notes: s.notes || '',
  };
}

export const workedTypeOf = (d: DraftSegment): SegmentType => d.actual_segment_type ?? d.segment_type;
export const draftHasRoster = (d: DraftSegment): boolean => Boolean(d.roster_in || d.roster_out) || d.roster_hours > 0;
export const draftHasWorked = (d: DraftSegment): boolean => Boolean(d.actual_in || d.actual_out) || d.actual_hours > 0;

/** A row the user never filled in. The editor leaves these out instead of saving them. */
export const isBlankDraft = (d: DraftSegment): boolean =>
  !draftHasRoster(d) && !draftHasWorked(d) && !d.notes.trim() && !d.is_unplanned;

export function draftToPayload(d: DraftSegment): SegmentPayload {
  const rosterTimed = Boolean(d.roster_in || d.roster_out);
  const workedTimed = Boolean(d.actual_in || d.actual_out);
  const actualHours = workedTimed ? 0 : round2(d.actual_hours);
  const worked = workedTimed || actualHours > 0;
  const notes = d.notes.trim();
  return {
    segment_type: d.segment_type,
    actual_segment_type: worked ? workedTypeOf(d) : null,
    is_unplanned: d.is_unplanned,
    roster_in: d.roster_in || null,
    roster_out: d.roster_out || null,
    roster_hours: rosterTimed ? 0 : round2(d.roster_hours),
    actual_in: d.actual_in || null,
    actual_out: d.actual_out || null,
    actual_hours: actualHours,
    notes: notes ? notes.slice(0, 500) : null,
  };
}

// ── Helpers for saved segments (grid and review) ───────────────────────────────────────────────

export const apiHasRoster = (s: ApiSegment): boolean => Boolean(s.roster_in && s.roster_out) || Number(s.roster_hours) > 0;
export const apiHasWorked = (s: ApiSegment): boolean => Boolean(s.actual_in && s.actual_out) || Number(s.actual_hours) > 0;
export const apiWorkedType = (s: ApiSegment): SegmentType => asSegmentType(s.actual_segment_type || s.segment_type);

export function apiSideSummary(s: ApiSegment, side: Side): { type: SegmentType; range: string | null; hours: number } {
  const type = side === 'roster' ? asSegmentType(s.segment_type) : apiWorkedType(s);
  const start = side === 'roster' ? s.roster_in : s.actual_in;
  const end = side === 'roster' ? s.roster_out : s.actual_out;
  return {
    type,
    range: start && end ? compactRange(start, end) : null,
    hours: Number(side === 'roster' ? s.roster_hours : s.actual_hours) || 0,
  };
}

/** Segments with something on `side`, in time order. */
export function sideSegments(segments: ApiSegment[], side: Side): ApiSegment[] {
  const has = side === 'roster' ? apiHasRoster : apiHasWorked;
  const startOf = (s: ApiSegment) => hhmm(side === 'roster' ? s.roster_in : s.actual_in) || '99:99';
  return segments.filter(has).sort((a, b) => startOf(a).localeCompare(startOf(b)));
}

/** Plain-language description of one side of a day, for screen readers and tooltips. */
export function describeSide(segments: ApiSegment[], side: Side): string {
  const list = sideSegments(segments, side);
  if (list.length === 0) return `nothing ${side === 'roster' ? 'rostered' : 'worked'}`;
  return `${SIDE_LABEL[side].toLowerCase()} ${list
    .map(s => {
      const summary = apiSideSummary(s, side);
      const when = summary.range ?? formatHours(summary.hours);
      return `${SEGMENT_LABEL[summary.type]} ${when}${s.is_unplanned ? ' (unplanned)' : ''}`;
    })
    .join(', ')}`;
}

// ── Hours (mirror of computeDayHours on the server) ────────────────────────────────────────────

export interface TimedSpan {
  index: number;
  start: number;
  end: number;
  type: SegmentType;
}

function computeDay(spans: TimedSpan[], rule: BreakRule): { hours: Map<number, number>; breakIndex: number | null } {
  const hours = new Map<number, number>();
  if (spans.length === 0) return { hours, breakIndex: null };

  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const totalMinutes = sorted.reduce((acc, s) => acc + (s.end - s.start), 0);
  let gapMinutes = 0;
  for (let i = 1; i < sorted.length; i++) gapMinutes += Math.max(0, sorted[i].start - sorted[i - 1].end);

  const deduct = rule.breakMins > 0 && totalMinutes >= rule.thresholdHours * 60 && gapMinutes < rule.breakMins;
  const longestOf = (list: TimedSpan[]) => list.reduce((best, s) => (s.end - s.start > best.end - best.start ? s : best), list[0]);
  const work = sorted.filter(s => s.type === 'WORK' && s.end - s.start >= rule.breakMins);
  const longest = longestOf(work.length > 0 ? work : sorted);

  for (const span of spans) {
    let minutes = span.end - span.start;
    if (deduct && span === longest) minutes = Math.max(0, minutes - rule.breakMins);
    hours.set(span.index, round2(minutes / 60));
  }
  return { hours, breakIndex: deduct ? longest.index : null };
}

/**
 * Hours for one side of a whole day, exactly as the server computes them: the break is deducted
 * once when the timed segments reach the threshold and the gaps between them are shorter than the
 * break; it comes off the longest Normal Work segment at least as long as the break, otherwise off
 * the longest segment.
 */
export const computeDayHours = (spans: TimedSpan[], rule: BreakRule): Map<number, number> => computeDay(spans, rule).hours;

const sideTimes = (d: DraftSegment, side: Side): [string, string] =>
  side === 'roster' ? [d.roster_in, d.roster_out] : [d.actual_in, d.actual_out];

/** Start/end in minutes from midnight, an overnight finish after 1440; null when the times are not a valid span. */
function spanMinutes(start: string, end: string): { start: number; end: number } | null {
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return null;
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (e === s) return null;
  if (e < s) e += 1440;
  if (e - s > MAX_SEGMENT_MINUTES) return null;
  return { start: s, end: e };
}

export interface DayPreview {
  /** Hours per segment (same order as the input), or null when that side is empty or not yet valid. */
  roster: (number | null)[];
  actual: (number | null)[];
  rosterTotal: number;
  actualTotal: number;
  /** Index of the segment the break was taken from, if one was deducted. */
  rosterBreakAt: number | null;
  actualBreakAt: number | null;
}

export function previewDayHours(segments: DraftSegment[], rule: BreakRule): DayPreview {
  const side = (which: Side) => {
    const spans: TimedSpan[] = [];
    segments.forEach((d, index) => {
      const [start, end] = sideTimes(d, which);
      const span = start && end ? spanMinutes(start, end) : null;
      if (span) spans.push({ index, ...span, type: which === 'roster' ? d.segment_type : workedTypeOf(d) });
    });
    const { hours, breakIndex } = computeDay(spans, rule);
    const perSegment = segments.map((d, index) => {
      if (hours.has(index)) return hours.get(index)!;
      const [start, end] = sideTimes(d, which);
      if (start || end) return null;
      const manual = which === 'roster' ? d.roster_hours : d.actual_hours;
      return manual > 0 ? round2(manual) : null;
    });
    const total = round2(perSegment.reduce<number>((acc, h) => acc + (h ?? 0), 0));
    return { perSegment, total, breakIndex };
  };
  const roster = side('roster');
  const actual = side('actual');
  return {
    roster: roster.perSegment,
    actual: actual.perSegment,
    rosterTotal: roster.total,
    actualTotal: actual.total,
    rosterBreakAt: roster.breakIndex,
    actualBreakAt: actual.breakIndex,
  };
}

// ── Validation (mirror of normaliseDaySegments on the server) ──────────────────────────────────

export interface SegmentIssue {
  message: string;
  /** The side the problem is on, or null when it concerns the whole segment. */
  side: Side | null;
}

export interface DayValidation {
  ok: boolean;
  /** A problem with the day as a whole (e.g. too many segments). */
  dayMessage: string | null;
  /** The first problem with each segment, in the same order as the input. */
  issues: (SegmentIssue | null)[];
  /** The first problem overall, ready to show next to the Save button. */
  first: string | null;
}

export const MAX_SEGMENTS_PER_DAY = 12;

/**
 * Checks a day the way the server does: both times on a side, not zero-length, not backwards
 * (overnight up to 14 h), no overlap within a side, no empty segment and no accidental duplicate
 * of an untimed segment. `name(i)` says how to refer to segment i in messages.
 */
export function validateDay(segments: DraftSegment[], name: (index: number) => string = i => `segment ${i + 1}`): DayValidation {
  const issues: (SegmentIssue | null)[] = segments.map(() => null);
  const flag = (index: number, message: string, side: Side | null) => {
    if (!issues[index]) issues[index] = { message, side };
  };
  const dayMessage = segments.length > MAX_SEGMENTS_PER_DAY ? `A day can have at most ${MAX_SEGMENTS_PER_DAY} segments.` : null;
  const payloads = segments.map(draftToPayload);
  const sides: Side[] = ['roster', 'actual'];

  // Both ends of a side, valid times, hours in range.
  segments.forEach((d, i) => {
    for (const side of sides) {
      const label = SIDE_LABEL[side];
      const [start, end] = sideTimes(d, side);
      if (start && !TIME_RE.test(start)) flag(i, `${label} start is not a valid time.`, side);
      if (end && !TIME_RE.test(end)) flag(i, `${label} finish is not a valid time.`, side);
      if (start && !end) flag(i, `Enter a ${label.toLowerCase()} finish time.`, side);
      if (!start && end) flag(i, `Enter a ${label.toLowerCase()} start time.`, side);
      const hours = side === 'roster' ? payloads[i].roster_hours : payloads[i].actual_hours;
      if (!Number.isFinite(hours) || hours < 0 || hours > 24) flag(i, `${label} hours must be between 0 and 24.`, side);
    }
  });

  // Zero-length and backwards spans, then overlaps within each side.
  for (const side of sides) {
    const label = SIDE_LABEL[side];
    const spans: TimedSpan[] = [];
    segments.forEach((d, i) => {
      const [start, end] = sideTimes(d, side);
      if (!start || !end || !TIME_RE.test(start) || !TIME_RE.test(end)) return;
      const s = toMinutes(start);
      let e = toMinutes(end);
      if (e === s) return flag(i, `${label} start and finish are the same time.`, side);
      if (e < s) e += 1440;
      if (e - s > MAX_SEGMENT_MINUTES) {
        return flag(i, `${label} finish is before the start. (A shift can run past midnight for up to 14 hours.)`, side);
      }
      spans.push({ index: i, start: s, end: e, type: side === 'roster' ? d.segment_type : workedTypeOf(d) });
    });
    const sorted = [...spans].sort((a, b) => a.start - b.start);
    for (let a = 0; a < sorted.length; a++) {
      for (let b = a + 1; b < sorted.length && sorted[b].start < sorted[a].end; b++) {
        flag(sorted[a].index, `${label} times overlap ${name(sorted[b].index)}.`, side);
        flag(sorted[b].index, `${label} times overlap ${name(sorted[a].index)}.`, side);
      }
    }
  }

  // Empty segments and accidental copies of an untimed segment.
  const seen = new Map<string, number>();
  payloads.forEach((p, i) => {
    const workedSide = Boolean(p.actual_in) || p.actual_hours > 0;
    if (!p.roster_in && p.roster_hours === 0 && !workedSide) {
      flag(i, 'This segment is empty. Enter times or hours, or remove it.', null);
      return;
    }
    if (p.roster_in || p.actual_in) return;
    const key = [p.segment_type, p.actual_segment_type, p.roster_hours, p.actual_hours].join('|');
    const twin = seen.get(key);
    if (twin !== undefined) flag(i, `This is the same as ${name(twin)}. Remove one of them.`, null);
    else seen.set(key, i);
  });

  const firstIndex = issues.findIndex(Boolean);
  const firstName = firstIndex >= 0 ? name(firstIndex) : '';
  const first = dayMessage
    ?? (firstIndex >= 0 ? `${firstName.charAt(0).toUpperCase()}${firstName.slice(1)}: ${issues[firstIndex]!.message}` : null);
  return { ok: !dayMessage && firstIndex < 0, dayMessage, issues, first };
}
