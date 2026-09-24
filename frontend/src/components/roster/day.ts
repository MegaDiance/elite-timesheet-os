import { isWeekendIso } from './dates';

/**
 * A worker's day as people think about it: what was ROSTERED (planned) and what was WORKED (the
 * timesheet), each a short list of times with a type, plus one optional note.
 *
 * The server (backend/src/services/segments.ts) validates every day and computes every hour.
 * `checkLines` and `previewDayHours` below mirror it so the editor can explain problems and show
 * hours while the user types; keep them in step with the server.
 */

export const ENTRY_TYPES = ['WORK', 'Sick', 'Annual', 'TIL', 'LWIP', 'Other'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const TYPE_LABEL: Record<EntryType, string> = {
  WORK: 'Normal Work',
  Sick: 'Sick Leave',
  Annual: 'Annual Leave',
  TIL: 'TIL',
  LWIP: 'LWIP',
  Other: 'Other',
};

/** Names used in the compact roster grid; Normal Work shows its times alone. */
export const TYPE_SHORT: Record<EntryType, string> = {
  WORK: '',
  Sick: 'Sick',
  Annual: 'Annual',
  TIL: 'TIL',
  LWIP: 'LWIP',
  Other: 'Other',
};

export const isEntryType = (value: unknown): value is EntryType =>
  typeof value === 'string' && (ENTRY_TYPES as readonly string[]).includes(value);

/** One time on the roster or the timesheet: timed (start + finish) or hours only (whole-day leave). */
export interface Entry {
  type: EntryType;
  start: string | null;
  finish: string | null;
  hours: number;
  /** Whether an unpaid break may be deducted from this entry. Defaults to true. */
  has_break: boolean;
  /** Explicit break length in minutes; null = the organisation's rule for the day. */
  break_mins: number | null;
}

export interface DayRecord {
  id: string;
  employee_id: string;
  record_date: string;
  roster: Entry[];
  timesheet: Entry[];
  note: string | null;
}

export type Part = 'roster' | 'timesheet';
export type Scope = 'ROSTER' | 'TIMESHEET' | 'BOTH';

export const PART_LABEL: Record<Part, string> = { roster: 'Rostered', timesheet: 'Worked' };
export const PART_HINT: Record<Part, string> = { roster: 'what was planned', timesheet: 'what actually happened' };

// ── Reading the API ────────────────────────────────────────────────────────────────────────────

const hhmm = (t: unknown): string | null => (typeof t === 'string' && t ? t.slice(0, 5) : null);
const round2 = (n: number): number => Math.round(n * 100) / 100;

function readEntries(list: unknown): Entry[] {
  if (!Array.isArray(list)) return [];
  return list.map((e: Record<string, unknown>) => ({
    type: isEntryType(e?.type) ? e.type : 'Other',
    start: hhmm(e?.start),
    finish: hhmm(e?.finish),
    hours: Number(e?.hours) || 0,
    has_break: e?.has_break !== false,
    break_mins: e?.break_mins === null || e?.break_mins === undefined ? null : Number(e.break_mins),
  }));
}

/** A day as GET /records returns it. */
export function readDay(raw: Record<string, unknown>): DayRecord {
  return {
    id: String(raw.id ?? ''),
    employee_id: String(raw.employee_id ?? ''),
    record_date: String(raw.record_date ?? '').slice(0, 10),
    roster: readEntries(raw.roster),
    timesheet: readEntries(raw.timesheet),
    note: typeof raw.note === 'string' && raw.note ? raw.note : null,
  };
}

/** The saved day as POST /records returns it ({ roster, timesheet, note }). */
export const readSavedDay = (raw: Record<string, unknown>) => ({
  roster: readEntries(raw.roster),
  timesheet: readEntries(raw.timesheet),
  note: typeof raw.note === 'string' && raw.note ? raw.note : null,
});

export const dayIsEmpty = (day: Pick<DayRecord, 'roster' | 'timesheet' | 'note'> | undefined): boolean =>
  !day || (day.roster.length === 0 && day.timesheet.length === 0 && !day.note);

export const partTotal = (entries: Entry[]): number => round2(entries.reduce((acc, e) => acc + e.hours, 0));

// ── Showing times and hours ────────────────────────────────────────────────────────────────────

/** "09:00" → "9:00 am", "17:30" → "5:30 pm". */
export function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** "09:00" → "9a", "17:30" → "5:30p" (for the compact grid). */
function shortTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`;
}

export const formatHours = (n: number): string => `${round2(n)} h`;

/** "9:00 am – 5:00 pm", "9a–5p", or the hours for an hours-only entry. */
export function entryWhen(e: Entry, style: 'long' | 'short' = 'long'): string {
  if (e.start && e.finish) {
    return style === 'long' ? `${formatTime(e.start)} – ${formatTime(e.finish)}` : `${shortTime(e.start)}–${shortTime(e.finish)}`;
  }
  return formatHours(e.hours);
}

/** Plain words for one part of a day, for screen readers and tooltips. */
export function describePart(part: Part, entries: Entry[]): string {
  if (entries.length === 0) return part === 'roster' ? 'nothing rostered' : 'nothing worked yet';
  return `${PART_LABEL[part]} ${entries.map(e => `${TYPE_LABEL[e.type]} ${entryWhen(e)}${e.start ? ` (${formatHours(e.hours)})` : ''}`).join(', ')}`;
}

// ── Break rule (mirror of computeDayHours on the server) ───────────────────────────────────────

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

export const breakRuleFor = (settings: BreakSettings, dateIso: string): BreakRule => ({
  breakMins: isWeekendIso(dateIso) ? settings.break_mins_weekend : settings.break_mins_weekday,
  thresholdHours: settings.break_threshold_hours,
});

/**
 * One break control for a Normal Work shift: the organisation's standard rule, an explicit length
 * (deducted whatever the day's length), or no break. Stored as has_break + break_mins.
 */
export type BreakChoice = 'standard' | 'none' | `${number}`;
export const BREAK_LENGTHS = [15, 20, 30, 45, 60] as const;

export const breakChoiceOf = (hasBreak: boolean, breakMins: number | null): BreakChoice =>
  !hasBreak ? 'none' : breakMins === null ? 'standard' : `${breakMins}`;

export const breakFromChoice = (choice: BreakChoice): { has_break: boolean; break_mins: number | null } =>
  choice === 'none' ? { has_break: false, break_mins: null }
    : choice === 'standard' ? { has_break: true, break_mins: null }
      : { has_break: true, break_mins: Number(choice) };

/** "Standard break (30 min at 6 h+)" / "45 min break" / "No break". */
export function breakChoiceLabel(choice: BreakChoice, rule?: BreakRule): string {
  if (choice === 'none') return 'No break';
  if (choice === 'standard') {
    if (!rule) return 'Standard break';
    return rule.breakMins > 0 ? `Standard (${rule.breakMins} min at ${rule.thresholdHours} h+)` : 'Standard (none this day)';
  }
  return `${choice} min break`;
}

export function describeBreakRule(rule: BreakRule): string {
  if (rule.breakMins <= 0) return 'No unpaid break on this day.';
  return `A ${rule.breakMins} min unpaid break comes off Normal Work on days of ${rule.thresholdHours} h or more.`;
}

/** Longest single time; a finish before the start runs past midnight, up to this long. */
const MAX_MINUTES = 14 * 60;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

interface Span {
  index: number;
  start: number;
  end: number;
  type: EntryType;
  hasBreak: boolean;
  breakMins: number | null;
}

type SpanResult = { start: number; end: number } | 'same' | 'backwards' | null;

/** Minutes from midnight of the day (an overnight finish ends after 1440). */
function spanOf(start: string, finish: string): SpanResult {
  if (!TIME_RE.test(start) || !TIME_RE.test(finish)) return null;
  const s = toMinutes(start);
  let e = toMinutes(finish);
  if (e === s) return 'same';
  if (e < s) e += 1440;
  if (e - s > MAX_MINUTES) return 'backwards';
  return { start: s, end: e };
}

/**
 * Exactly the server's rule: the break is deducted at most ONCE per day per part, never when the
 * gaps between entries are already at least as long as the break, and only off Normal Work — the
 * longest Normal Work entry with its break on that is at least as long as the break (the earliest
 * one on a tie). An explicit break length on that entry is always deducted; otherwise the
 * organisation's break applies once the day's timed entries reach the threshold. Leave is never
 * reduced, so a day without such work has no deduction.
 */
function computeDayHours(spans: Span[], rule: BreakRule): { hours: Map<number, number>; breakAt: number | null; breakMins: number } {
  const hours = new Map<number, number>();
  if (spans.length === 0) return { hours, breakAt: null, breakMins: 0 };

  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const totalMinutes = sorted.reduce((acc, s) => acc + (s.end - s.start), 0);
  let gapMinutes = 0;
  for (let i = 1; i < sorted.length; i++) gapMinutes += Math.max(0, sorted[i].start - sorted[i - 1].end);

  const breakFor = (s: Span) => s.breakMins ?? rule.breakMins;
  const work = sorted.filter(s => s.type === 'WORK' && s.hasBreak && breakFor(s) > 0 && s.end - s.start >= breakFor(s));
  const longest = work.reduce<Span | undefined>((best, s) => (!best || s.end - s.start > best.end - best.start ? s : best), undefined);
  const breakMins = longest ? breakFor(longest) : 0;
  const reachesThreshold = longest?.breakMins != null || totalMinutes >= rule.thresholdHours * 60;
  const deduct = Boolean(longest) && reachesThreshold && gapMinutes < breakMins;

  // Summed rather than overwritten: mergeLeaveSpans can hand back several sub-spans that share the
  // original line's index (a WORK line split around a leave line), and their hours add up onto it.
  for (const span of spans) {
    let minutes = span.end - span.start;
    if (deduct && span === longest) minutes = Math.max(0, minutes - breakMins);
    hours.set(span.index, round2((hours.get(span.index) ?? 0) + minutes / 60));
  }
  return { hours, breakAt: deduct && longest ? longest.index : null, breakMins: deduct ? breakMins : 0 };
}

/**
 * Frontend mirror of the server's mergeLeaveIntoRoster (backend/src/services/segments.ts): splits
 * each WORK span around any leave span (Sick/Annual/TIL/LWIP/Other) it overlaps, into the gaps
 * before/between/after the leave. Only used when the organisation's automatically_merge_leave_with_roster
 * setting is on — otherwise a WORK/leave overlap is always rejected, unchanged from before. A split
 * sub-span keeps its original line's `index` so hours and validation issues still attribute to it.
 */
function mergeLeaveSpans(spans: Span[]): Span[] {
  const leaveSpans = spans.filter(s => s.type !== 'WORK');
  const workSpans = spans.filter(s => s.type === 'WORK');
  if (leaveSpans.length === 0 || workSpans.length === 0) return spans;

  const result: Span[] = [...leaveSpans];
  for (const w of workSpans) {
    const overlapping = leaveSpans
      .filter(l => l.start < w.end && l.end > w.start)
      .sort((a, b) => a.start - b.start);
    if (overlapping.length === 0) {
      result.push(w);
      continue;
    }
    let cursor = w.start;
    for (const l of overlapping) {
      if (l.start > cursor) result.push({ ...w, start: cursor, end: Math.min(l.start, w.end) });
      cursor = Math.max(cursor, l.end);
    }
    if (cursor < w.end) result.push({ ...w, start: cursor, end: w.end });
  }
  return result;
}

export interface HoursPreview {
  /** Hours per entry (same order as the input); null while an entry is incomplete or invalid. */
  perEntry: (number | null)[];
  total: number;
  /** Minutes of unpaid break deducted from this part (0 when none). */
  breakMins: number;
}

/**
 * Hours for one part of a day as the server will compute them. When `mergeLeave` is on (the
 * organisation's automatically_merge_leave_with_roster setting), a WORK entry that overlaps a leave
 * entry is previewed as the server will actually save it — split around the leave — instead of
 * being flagged as an overlap; a WORK entry entirely covered by leave previews as 0 h rather than
 * the incomplete/invalid `null`.
 */
export function previewDayHours(entries: Entry[], rule: BreakRule, mergeLeave = false): HoursPreview {
  const spans: Span[] = [];
  const hadSpan = new Set<number>();
  entries.forEach((e, index) => {
    const span = e.start && e.finish ? spanOf(e.start, e.finish) : null;
    if (span && typeof span === 'object') {
      spans.push({ index, ...span, type: e.type, hasBreak: e.has_break, breakMins: e.break_mins });
      hadSpan.add(index);
    }
  });
  const { hours, breakMins } = computeDayHours(mergeLeave ? mergeLeaveSpans(spans) : spans, rule);
  const perEntry = entries.map((e, index) => {
    if (hours.has(index)) return hours.get(index)!;
    if (hadSpan.has(index)) return 0;
    if (e.start || e.finish) return null;
    return e.hours > 0 ? round2(e.hours) : null;
  });
  return {
    perEntry,
    total: round2(perEntry.reduce<number>((acc, h) => acc + (h ?? 0), 0)),
    breakMins,
  };
}

// ── Editor lines ───────────────────────────────────────────────────────────────────────────────

/** One line in the day editor. Times are "HH:MM" or ''. */
export interface DraftLine {
  key: string;
  type: EntryType;
  hoursOnly: boolean;
  start: string;
  finish: string;
  hours: number;
  has_break: boolean;
  break_mins: number | null;
}

export const MAX_LINES = 12;

let keySeq = 0;
const newKey = () => `line-${(keySeq++).toString(36)}`;

export const blankLine = (start = ''): DraftLine => ({ key: newKey(), type: 'WORK', hoursOnly: false, start, finish: '', hours: 0, has_break: true, break_mins: null });

export const lineFromEntry = (e: Entry): DraftLine => ({
  key: newKey(),
  type: e.type,
  hoursOnly: !e.start && !e.finish,
  start: e.start ?? '',
  finish: e.finish ?? '',
  hours: !e.start && !e.finish ? e.hours : 0,
  has_break: e.has_break,
  break_mins: e.break_mins,
});

/** A line nobody has filled in. It is left out when saving, so an empty part saves as nothing. */
export const isUntouched = (l: DraftLine): boolean => !l.hoursOnly && !l.start && !l.finish;

/** What a line saves (a timed line's hours are computed by the server). */
export const lineToEntry = (l: DraftLine): Entry => (l.hoursOnly
  ? { type: l.type, start: null, finish: null, hours: round2(l.hours), has_break: true, break_mins: null }
  : { type: l.type, start: l.start || null, finish: l.finish || null, hours: 0, has_break: l.has_break, break_mins: l.has_break ? l.break_mins : null });

export const linesToEntries = (lines: DraftLine[]): Entry[] => lines.filter(l => !isUntouched(l)).map(lineToEntry);

/** Lines for an editable part: the saved entries, or a single blank Normal Work line. */
export const linesFor = (entries: Entry[]): DraftLine[] => (entries.length > 0 ? entries.map(lineFromEntry) : [blankLine()]);

/** A comparable fingerprint of what a part would save. */
export const partKey = (entries: Entry[]): string =>
  JSON.stringify(entries.map(e => (e.start || e.finish ? [e.type, e.start, e.finish, e.has_break, e.break_mins] : [e.type, round2(e.hours)])));

export interface LinesCheck {
  /** The problem with each line (same order as the input), or null. */
  issues: (string | null)[];
  first: string | null;
}

/**
 * Checks a part the way the server does: both times entered, not the same time, not backwards
 * (overnight up to 14 h), no overlaps, hours between 0 and 24, and no accidental duplicate of an
 * hours-only line. Lines nobody filled in are ignored. When `mergeLeave` is on, a WORK line is
 * split around any leave line it overlaps before the overlap check runs, so it is never flagged —
 * the server will save it split, not reject it — while a WORK/WORK or leave/leave overlap is still
 * always flagged (splitting never touches those, exactly like the server).
 */
export function checkLines(lines: DraftLine[], mergeLeave = false): LinesCheck {
  const issues: (string | null)[] = lines.map(() => null);
  const flag = (i: number, message: string) => {
    if (!issues[i]) issues[i] = message;
  };
  const spans: Span[] = [];
  const seen = new Map<string, number>();

  lines.forEach((l, i) => {
    if (isUntouched(l)) return;
    if (l.hoursOnly) {
      if (!(l.hours > 0)) return flag(i, 'Enter the hours, or remove this line.');
      if (l.hours > 24) return flag(i, 'Hours must be 24 or less.');
      const key = `${l.type}|${round2(l.hours)}`;
      if (seen.has(key)) return flag(i, 'This is the same as another line. Remove one of them.');
      seen.set(key, i);
      return;
    }
    if (!l.finish) return flag(i, 'Enter a finish time.');
    if (!l.start) return flag(i, 'Enter a start time.');
    const span = spanOf(l.start, l.finish);
    if (span === null) return flag(i, 'Enter times like 9, 5p or 17:30.');
    if (span === 'same') return flag(i, 'The start and finish are the same time.');
    if (span === 'backwards') return flag(i, 'The finish is before the start. (A shift can run past midnight for up to 14 hours.)');
    spans.push({ index: i, ...span, type: l.type, hasBreak: l.has_break, breakMins: l.break_mins });
  });

  const sorted = [...(mergeLeave ? mergeLeaveSpans(spans) : spans)].sort((a, b) => a.start - b.start);
  for (let a = 0; a < sorted.length; a++) {
    for (let b = a + 1; b < sorted.length && sorted[b].start < sorted[a].end; b++) {
      const la = lines[sorted[a].index];
      const lb = lines[sorted[b].index];
      flag(sorted[a].index, `Overlaps ${formatTime(lb.start)} – ${formatTime(lb.finish)}.`);
      flag(sorted[b].index, `Overlaps ${formatTime(la.start)} – ${formatTime(la.finish)}.`);
    }
  }

  const count = lines.filter(l => !isUntouched(l)).length;
  const firstIndex = issues.findIndex(Boolean);
  const first = count > MAX_LINES ? `A day can have at most ${MAX_LINES} times in each part.` : firstIndex >= 0 ? issues[firstIndex] : null;
  return { issues, first };
}
