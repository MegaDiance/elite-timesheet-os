import crypto from 'crypto';
import { query, withTransaction } from './db';
import { parseSmartTime } from './timeParser';
import { badRequest, HttpError } from './policy';
import { getFortnightStartIso } from './periodUtils';
import { getPeriodLock, isTimesheetApproved, rosterLockedError, timesheetLockedError } from './periodLocks';

/**
 * The one segment model shared by the roster, roster templates and timesheets.
 *
 * A day is a list of segments. Each segment has a type and, independently, a rostered side
 * (roster_in / roster_out / roster_hours) and a worked side (actual_in / actual_out /
 * actual_hours / actual_segment_type). A simple day is one segment; a split day such as
 *
 *     09:00–13:00 Sick Leave · 13:00–15:00 Annual Leave · 15:00–17:00 Normal Work
 *
 * is three segments of the same day — not three separate entries.
 */
export const SEGMENT_TYPES = ['WORK', 'Sick', 'Annual', 'TIL', 'LWIP', 'Other'] as const;
export type SegmentType = typeof SEGMENT_TYPES[number];

export const isSegmentType = (value: unknown): value is SegmentType =>
    typeof value === 'string' && (SEGMENT_TYPES as readonly string[]).includes(value);

/**
 * Longest single segment accepted. A finish earlier than the start means the segment runs past
 * midnight (e.g. 22:00 → 06:00); anything longer than this is treated as a mistyped, backwards time.
 */
const MAX_SEGMENT_MINUTES = 14 * 60;

export interface BreakRule {
    breakMins: number;
    thresholdHours: number;
}

export interface SegmentInput {
    segment_type?: unknown;
    actual_segment_type?: unknown;
    is_unplanned?: unknown;
    roster_in?: unknown;
    roster_out?: unknown;
    roster_hours?: unknown;
    actual_in?: unknown;
    actual_out?: unknown;
    actual_hours?: unknown;
    notes?: unknown;
    /** Whether the org's unpaid break may be deducted from the ROSTERED side. Defaults to true (today's implicit rule) when absent. */
    has_break?: unknown;
    /** Explicit break length for the rostered side; absent/null = the organisation's rule. */
    break_mins?: unknown;
    /** The WORKED side's own break flag and length. Absent = the same as the rostered side (callers that only know one flag). */
    actual_has_break?: unknown;
    actual_break_mins?: unknown;
}

export interface NormalisedSegment {
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
    has_break: boolean;
    break_mins: number | null;
    actual_has_break: boolean;
    actual_break_mins: number | null;
}

/** Longest explicit break accepted for one shift. */
export const MAX_BREAK_MINS = 240;

const round2 = (n: number) => Math.round(n * 100) / 100;

const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

function readTime(value: unknown, label: string): string | null {
    if (value === undefined || value === null || value === '') return null;
    const parsed = typeof value === 'string' ? parseSmartTime(value) : '';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(parsed)) {
        throw badRequest('INVALID_TIME', `${label} is not a valid time.`);
    }
    return parsed;
}

function readHours(value: unknown, label: string): number {
    if (value === undefined || value === null || value === '') return 0;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 24) {
        throw badRequest('INVALID_DURATION', `${label} must be between 0 and 24 hours.`);
    }
    return round2(n);
}

/** An explicit break length: null when absent (the organisation's rule applies), else whole minutes 0–240. */
export function readBreakMins(value: unknown, label: string): number | null {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > MAX_BREAK_MINS) {
        throw badRequest('INVALID_BREAK', `${label} must be a whole number of minutes from 0 to ${MAX_BREAK_MINS}.`);
    }
    return n;
}

interface TimedSpan { index: number; start: number; end: number; type: SegmentType; hasBreak: boolean; breakMins: number | null }

/** Start/end in minutes from midnight of the record date; an overnight segment ends after 1440. */
function spanOf(index: number, type: SegmentType, start: string, end: string, label: string, hasBreak: boolean, breakMins: number | null = null): TimedSpan {
    const s = toMinutes(start);
    let e = toMinutes(end);
    if (e === s) throw badRequest('EMPTY_SEGMENT', `${label}: start and finish are the same time.`);
    if (e < s) e += 1440;
    if (e - s > MAX_SEGMENT_MINUTES) {
        throw badRequest('BACKWARDS_TIME', `${label}: the finish time is before the start time.`);
    }
    return { index, start: s, end: e, type, hasBreak, breakMins };
}

function assertNoOverlap(spans: TimedSpan[], side: string) {
    const sorted = [...spans].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start < sorted[i - 1].end) {
            throw badRequest('OVERLAP', `${side} times overlap between segment ${sorted[i - 1].index + 1} and segment ${sorted[i].index + 1}.`);
        }
    }
}

/**
 * Hours for one side (rostered or worked) of a whole day.
 *
 * The unpaid break is a property of the DAY, not of each segment: it is deducted at most once, and
 * never when the segments already leave a gap at least as long as the break (it was taken between
 * them). It only ever comes off Normal Work — the longest Normal Work segment that has its break
 * switched on and is at least as long as the break. Leave (Sick, Annual, TIL, LWIP, Other) is
 * never reduced, so a day with no such work has no deduction.
 *
 * The break's length is that segment's explicit `breakMins` when it has one — an explicit break is
 * deducted whatever the day's length — otherwise the organisation's rule for the day, which only
 * applies once the day's timed segments reach the threshold. With no explicit lengths anywhere
 * (every row stored before explicit lengths existed) this is exactly the previous calculation.
 */
export function computeDayHours(spans: TimedSpan[], rule: BreakRule): Map<number, number> {
    const hours = new Map<number, number>();
    if (spans.length === 0) return hours;

    const sorted = [...spans].sort((a, b) => a.start - b.start);
    const totalMinutes = sorted.reduce((acc, s) => acc + (s.end - s.start), 0);
    let gapMinutes = 0;
    for (let i = 1; i < sorted.length; i++) gapMinutes += Math.max(0, sorted[i].start - sorted[i - 1].end);

    const breakFor = (s: TimedSpan) => s.breakMins ?? rule.breakMins;
    const work = sorted.filter(s => s.type === 'WORK' && s.hasBreak && breakFor(s) > 0 && s.end - s.start >= breakFor(s));
    const longest = work.reduce<TimedSpan | undefined>((best, s) => (!best || s.end - s.start > best.end - best.start ? s : best), undefined);
    const breakMins = longest ? breakFor(longest) : 0;
    const reachesThreshold = longest?.breakMins != null || totalMinutes >= rule.thresholdHours * 60;
    const deduct = Boolean(longest) && reachesThreshold && gapMinutes < breakMins;

    for (const span of spans) {
        let minutes = span.end - span.start;
        if (deduct && span === longest) minutes = Math.max(0, minutes - breakMins);
        hours.set(span.index, round2(minutes / 60));
    }
    return hours;
}

/**
 * Validates and normalises the segments of one day. Rejects overlapping, backwards,
 * zero-length, half-entered, empty and accidentally duplicated segments.
 */
export function normaliseDaySegments(inputs: unknown, rule: BreakRule): { segments: NormalisedSegment[]; hasActuals: boolean } {
    if (!Array.isArray(inputs)) throw badRequest('VALIDATION_FAILED', 'segments must be a list.');
    if (inputs.length > 12) throw badRequest('VALIDATION_FAILED', 'A day can have at most 12 segments.');

    const drafts = (inputs as SegmentInput[]).map((raw, index) => {
        const label = `Segment ${index + 1}`;
        if (!isSegmentType(raw?.segment_type ?? 'WORK')) throw badRequest('INVALID_TYPE', `${label}: unknown segment type.`);
        const actualType = raw.actual_segment_type === undefined || raw.actual_segment_type === null || raw.actual_segment_type === ''
            ? null : raw.actual_segment_type;
        if (actualType !== null && !isSegmentType(actualType)) throw badRequest('INVALID_TYPE', `${label}: unknown segment type.`);

        const rosterIn = readTime(raw.roster_in, `${label} rostered start`);
        const rosterOut = readTime(raw.roster_out, `${label} rostered finish`);
        const actualIn = readTime(raw.actual_in, `${label} worked start`);
        const actualOut = readTime(raw.actual_out, `${label} worked finish`);
        if (Boolean(rosterIn) !== Boolean(rosterOut)) throw badRequest('INCOMPLETE_SEGMENT', `${label}: enter both a rostered start and finish.`);
        if (Boolean(actualIn) !== Boolean(actualOut)) throw badRequest('INCOMPLETE_SEGMENT', `${label}: enter both a worked start and finish.`);

        return {
            index, label,
            segment_type: (raw.segment_type ?? 'WORK') as SegmentType,
            actual_segment_type: actualType as SegmentType | null,
            is_unplanned: raw.is_unplanned === true,
            rosterIn, rosterOut, actualIn, actualOut,
            manualRosterHours: readHours(raw.roster_hours, `${label} rostered hours`),
            manualActualHours: readHours(raw.actual_hours, `${label} worked hours`),
            notes: typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim().slice(0, 500) : null,
            hasBreak: raw.has_break !== false,
            breakMins: readBreakMins(raw.break_mins, `${label} break`),
            // The worked side has its own break; callers that only send one flag mean both sides.
            actualHasBreak: raw.actual_has_break === undefined ? raw.has_break !== false : raw.actual_has_break !== false,
            actualBreakMins: raw.actual_break_mins === undefined
                ? readBreakMins(raw.break_mins, `${label} break`)
                : readBreakMins(raw.actual_break_mins, `${label} worked break`),
        };
    });

    const rosterSpans = drafts.filter(d => d.rosterIn && d.rosterOut).map(d => spanOf(d.index, d.segment_type, d.rosterIn!, d.rosterOut!, `${d.label} (rostered)`, d.hasBreak, d.breakMins));
    const actualSpans = drafts.filter(d => d.actualIn && d.actualOut).map(d => spanOf(d.index, d.actual_segment_type || d.segment_type, d.actualIn!, d.actualOut!, `${d.label} (worked)`, d.actualHasBreak, d.actualBreakMins));
    assertNoOverlap(rosterSpans, 'Rostered');
    assertNoOverlap(actualSpans, 'Worked');

    const rosterHours = computeDayHours(rosterSpans, rule);
    const actualHours = computeDayHours(actualSpans, rule);

    const seen = new Set<string>();
    let hasActuals = false;
    const segments = drafts.map((d) => {
        const roster_hours = rosterHours.get(d.index) ?? d.manualRosterHours;
        const actual_hours = actualHours.get(d.index) ?? d.manualActualHours;
        const workedSide = Boolean(d.actualIn) || actual_hours > 0;
        if (!d.rosterIn && roster_hours === 0 && !workedSide) {
            throw badRequest('EMPTY_SEGMENT', `${d.label} is empty. Enter times or hours, or remove it.`);
        }

        // Untimed segments cannot overlap, so catch accidental copies of the same entry instead.
        if (!d.rosterIn && !d.actualIn) {
            const key = [d.segment_type, d.actual_segment_type, roster_hours, actual_hours].join('|');
            if (seen.has(key)) throw badRequest('DUPLICATE_SEGMENT', `${d.label} is a duplicate of another segment.`);
            seen.add(key);
        }

        if (workedSide) hasActuals = true;
        return {
            segment_type: d.segment_type,
            actual_segment_type: workedSide ? (d.actual_segment_type || d.segment_type) : null,
            is_unplanned: d.is_unplanned,
            roster_in: d.rosterIn, roster_out: d.rosterOut, roster_hours,
            actual_in: d.actualIn, actual_out: d.actualOut, actual_hours,
            notes: d.notes,
            has_break: d.hasBreak,
            break_mins: d.breakMins,
            actual_has_break: d.actualHasBreak,
            actual_break_mins: d.actualBreakMins,
        };
    });

    return { segments, hasActuals };
}

/** Day of week from a 'YYYY-MM-DD' calendar date, computed in UTC so it never drifts with the server timezone. */
export function isWeekendDate(dateIso: string): boolean {
    const [y, m, d] = dateIso.split('-').map(Number);
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return day === 0 || day === 6;
}

export interface OrgBreakSettings {
    break_mins_weekday: number;
    break_mins_weekend: number;
    break_threshold_hours: number;
}

export async function loadBreakSettings(orgId: string): Promise<OrgBreakSettings> {
    const res = await query('SELECT break_mins_weekday, break_mins_weekend, break_threshold_hours FROM organisations WHERE id = $1', [orgId]);
    const row = res.rows[0] || {};
    return {
        break_mins_weekday: Number(row.break_mins_weekday ?? 30),
        break_mins_weekend: Number(row.break_mins_weekend ?? 0),
        break_threshold_hours: Number(row.break_threshold_hours ?? 6),
    };
}

export function breakRuleFor(settings: OrgBreakSettings, dateIso: string): BreakRule {
    return {
        breakMins: isWeekendDate(dateIso) ? settings.break_mins_weekend : settings.break_mins_weekday,
        thresholdHours: settings.break_threshold_hours,
    };
}

/**
 * The day as users see it: what was ROSTERED (planned) and what was WORKED (the timesheet), each a
 * simple list of times. Storage pairs the two lists into rows; nobody outside this module needs to
 * know how.
 */
export type DayScope = 'ROSTER' | 'TIMESHEET' | 'BOTH';

export interface DayEntry {
    type: SegmentType;
    start: string | null;
    finish: string | null;
    hours: number;
    has_break: boolean;
    /** Explicit break length for this shift; null = the organisation's rule. */
    break_mins: number | null;
}

export interface DayView {
    roster: DayEntry[];
    timesheet: DayEntry[];
    note: string | null;
}

const hhmm = (t: unknown) => (t ? String(t).slice(0, 5) : null);
const byStart = <T extends { start: string | null }>(list: T[]) =>
    [...list].sort((a, b) => (a.start && b.start ? a.start.localeCompare(b.start) : a.start ? -1 : b.start ? 1 : 0));

/** Stored rows → the day's two lists. */
export function rowsToDay(rows: any[]): DayView {
    const roster: DayEntry[] = [];
    const timesheet: DayEntry[] = [];
    const notes: string[] = [];
    const mins = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    for (const row of rows) {
        if (row.roster_in || Number(row.roster_hours) > 0) {
            roster.push({
                type: row.segment_type, start: hhmm(row.roster_in), finish: hhmm(row.roster_out), hours: Number(row.roster_hours) || 0,
                has_break: row.has_break !== false, break_mins: mins(row.break_mins),
            });
        }
        if (row.actual_in || Number(row.actual_hours) > 0) {
            timesheet.push({
                type: row.actual_segment_type || row.segment_type, start: hhmm(row.actual_in), finish: hhmm(row.actual_out), hours: Number(row.actual_hours) || 0,
                has_break: (row.actual_has_break ?? row.has_break) !== false, break_mins: mins(row.actual_break_mins),
            });
        }
        if (row.notes) notes.push(row.notes);
    }
    return { roster: byStart(roster), timesheet: byStart(timesheet), note: notes.length ? notes.join(' · ') : null };
}

function readEntries(value: unknown, label: string): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) throw badRequest('VALIDATION_FAILED', `${label} must be a list.`);
    return value.map(v => (v && typeof v === 'object' ? v as Record<string, unknown> : {}));
}

/**
 * The day's two lists → row inputs for normaliseDaySegments. Entries are paired in start-time order;
 * worked time with no rostered counterpart is flagged unplanned.
 */
export function dayToRows(roster: Array<Record<string, unknown>>, timesheet: Array<Record<string, unknown>>, note: string | null): SegmentInput[] {
    const sortEntries = (list: Array<Record<string, unknown>>) =>
        [...list].sort((a, b) => {
            const sa = typeof a.start === 'string' ? parseSmartTime(a.start) : '';
            const sb = typeof b.start === 'string' ? parseSmartTime(b.start) : '';
            return sa && sb ? sa.localeCompare(sb) : sa ? -1 : sb ? 1 : 0;
        });
    const r = sortEntries(roster);
    const t = sortEntries(timesheet);
    const rows: SegmentInput[] = [];
    for (let i = 0; i < Math.max(r.length, t.length); i++) {
        const planned = r[i];
        const worked = t[i];
        rows.push({
            segment_type: planned ? (planned.type ?? 'WORK') : (worked!.type ?? 'WORK'),
            roster_in: planned?.start, roster_out: planned?.finish, roster_hours: planned?.hours,
            actual_segment_type: worked ? (worked.type ?? 'WORK') : null,
            actual_in: worked?.start, actual_out: worked?.finish, actual_hours: worked?.hours,
            // Each side keeps its own break, so pairing a rostered and a worked entry in one row
            // never lets one side's break setting overwrite the other's.
            has_break: (planned ? planned.has_break : worked?.has_break) !== false,
            break_mins: planned ? planned.break_mins : worked?.break_mins,
            actual_has_break: worked ? worked.has_break !== false : undefined,
            actual_break_mins: worked ? worked.break_mins ?? null : undefined,
            is_unplanned: !planned && Boolean(worked),
            notes: i === 0 ? note : null,
        });
    }
    return rows;
}

const fromMinutes = (m: number): string => {
    const wrapped = ((m % 1440) + 1440) % 1440;
    return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
};

/**
 * Splits each WORK entry around any leave entry (Sick/Annual/TIL/LWIP/Other) it overlaps, on one
 * side (roster or timesheet) of a day. Used when `automatically_merge_leave_with_roster` is on,
 * so an employee's leave no longer has to be entered as a manual delete-and-recreate around the
 * rostered shift — it covers every example in the spec (leave at the start/middle/end of a shift,
 * multiple leave periods in one shift, leave covering the whole shift) with one algorithm: carve
 * the WORK span into the gaps before/between/after the leave spans that overlap it.
 *
 * Only timed entries participate — an hours-only leave entry (e.g. a whole day with no times) has
 * no window to overlap against, so it and any WORK entry it doesn't overlap pass through
 * unchanged. Leave-vs-leave and WORK-vs-WORK overlaps are deliberately left alone: they flow into
 * `assertNoOverlap` unchanged and are still rejected as `OVERLAP`, exactly as before.
 */
export function mergeLeaveIntoRoster(entries: DayEntry[]): DayEntry[] {
    const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
    const parsed = entries.map(e => {
        const start = typeof e.start === 'string' ? parseSmartTime(e.start) : '';
        const finish = typeof e.finish === 'string' ? parseSmartTime(e.finish) : '';
        return { entry: e, start: TIME_RE.test(start) ? start : null, finish: TIME_RE.test(finish) ? finish : null };
    });
    // Entries with an unparseable time are left exactly as given — normaliseDaySegments's own
    // validation surfaces a clear INVALID_TIME error for them; this function never invents one.
    const timed = parsed.filter(p => p.start && p.finish);
    const untimed = parsed.filter(p => !(p.start && p.finish)).map(p => p.entry);
    const spans = timed.map(p => {
        const start = toMinutes(p.start!);
        let end = toMinutes(p.finish!);
        if (end <= start) end += 1440;
        return { entry: p.entry, start, end };
    });
    const leaveSpans = spans.filter(s => s.entry.type !== 'WORK');
    const workSpans = spans.filter(s => s.entry.type === 'WORK');
    if (leaveSpans.length === 0 || workSpans.length === 0) return entries;

    const result: DayEntry[] = [...untimed, ...leaveSpans.map(s => s.entry)];
    for (const w of workSpans) {
        const overlapping = leaveSpans
            .filter(l => l.start < w.end && l.end > w.start)
            .sort((a, b) => a.start - b.start);
        if (overlapping.length === 0) {
            result.push(w.entry);
            continue;
        }
        let cursor = w.start;
        for (const l of overlapping) {
            if (l.start > cursor) result.push({ ...w.entry, start: fromMinutes(cursor), finish: fromMinutes(Math.min(l.start, w.end)), hours: 0 });
            cursor = Math.max(cursor, l.end);
        }
        if (cursor < w.end) result.push({ ...w.entry, start: fromMinutes(cursor), finish: fromMinutes(w.end), hours: 0 });
    }
    return result;
}

/**
 * Builds the rows to store for a write of `scope`. The side that is not in scope is taken from the
 * stored day, so a roster-only change can never alter worked hours and a timesheet-only change can
 * never alter the roster.
 */
export function mergeDayWrite(existing: DayView, body: Record<string, unknown>, mergeLeave = false): SegmentInput[] {
    const scope = (body.scope ?? 'BOTH') as DayScope;
    if (!['ROSTER', 'TIMESHEET', 'BOTH'].includes(scope)) throw badRequest('VALIDATION_FAILED', 'scope must be ROSTER, TIMESHEET or BOTH.');
    if (scope === 'ROSTER' && body.timesheet !== undefined) throw badRequest('SCOPE_VIOLATION', 'A roster-only change cannot include worked hours.');
    if (scope === 'TIMESHEET' && body.roster !== undefined) throw badRequest('SCOPE_VIOLATION', 'A timesheet-only change cannot include rostered hours.');

    const keep = (list: DayEntry[]) => list.map(e => ({ ...e }));
    let roster = scope === 'TIMESHEET' ? keep(existing.roster) : readEntries(body.roster ?? [], 'roster');
    let timesheet = scope === 'ROSTER' ? keep(existing.timesheet) : readEntries(body.timesheet ?? [], 'timesheet');
    const rawNote = body.note === undefined ? existing.note : body.note;
    const note = typeof rawNote === 'string' && rawNote.trim() ? rawNote.trim().slice(0, 500) : null;
    for (const entry of [...roster, ...timesheet]) {
        if (entry.type !== undefined && !isSegmentType(entry.type)) throw badRequest('INVALID_TYPE', 'Unknown time type.');
    }
    if (mergeLeave) {
        roster = mergeLeaveIntoRoster(roster as DayEntry[]);
        timesheet = mergeLeaveIntoRoster(timesheet as DayEntry[]);
    }
    return dayToRows(roster as any, timesheet as any, note);
}

// ── Shared day-write pipeline ───────────────────────────────────────────────────────────────────
// One side (roster or worked) is "the same" across a save when its set of (type, times-or-hours)
// values is unchanged, regardless of segment order — used to tell whether a locked side actually
// changed, so an unrelated change to the other side is never blocked by that lock.

const hhmmKey = (t: unknown): string => (t ? String(t).slice(0, 5) : '');

// A timed Normal Work entry's break is part of its identity: changing it changes the day's hours,
// so on a locked side it counts as a change like any other.
function sideKey(type: unknown, start: unknown, end: unknown, hours: unknown, hasBreak: unknown, breakMins: unknown): string | null {
    const brk = type === 'WORK' ? `${hasBreak !== false}:${breakMins ?? ''}` : '';
    if (start) return [type, hhmmKey(start), hhmmKey(end), brk].join('|');
    return Number(hours) > 0 ? [type, Number(hours).toFixed(2)].join('|') : null;
}

export const rosterSide = (s: any): string | null => sideKey(s.segment_type, s.roster_in, s.roster_out, s.roster_hours, s.has_break, s.break_mins);
export const actualSide = (s: any): string | null =>
    sideKey(s.actual_segment_type || s.segment_type, s.actual_in, s.actual_out, s.actual_hours, s.actual_has_break ?? s.has_break, s.actual_break_mins);

export function sameSide(existing: any[], incoming: NormalisedSegment[], side: (s: any) => string | null): boolean {
    const a = existing.map(side).filter(Boolean).sort();
    const b = incoming.map(side).filter(Boolean).sort();
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The single write path for one worker-day: validates, checks the fortnight's approval/lock
 * state, and replaces `shift_segments` for that day transactionally. Shared by `POST /records`
 * (admin), `POST /portal/timesheet` (employee self-submit), and any future caller that needs to
 * write a day (leave-request materialization, bulk break-apply) — so lock/approval enforcement
 * and the delete+reinsert transaction are implemented exactly once.
 */
export async function writeDayRecord(params: {
    orgId: string;
    worker: { id: string; location_id: string };
    recordDate: string;
    body: Record<string, unknown>;
    rule: BreakRule;
}): Promise<NormalisedSegment[]> {
    const { orgId, worker, recordDate, body, rule } = params;
    const fortnightStart = getFortnightStartIso(recordDate);
    if (await isTimesheetApproved(orgId, worker.id, fortnightStart)) {
        throw new HttpError(423, 'TIMESHEET_ALREADY_APPROVED', 'This timesheet is approved. Reopen it before changing shifts or hours.');
    }
    const lock = await getPeriodLock(orgId, worker.location_id, fortnightStart);
    const orgRes = await query('SELECT automatically_merge_leave_with_roster FROM organisations WHERE id = $1', [orgId]);
    const mergeLeave = orgRes.rows[0]?.automatically_merge_leave_with_roster === true;

    return withTransaction(async (tx) => {
        const recRes = await tx(
            `INSERT INTO daily_records (id, org_id, employee_id, record_date) VALUES ($1, $2, $3, $4)
             ON CONFLICT (org_id, employee_id, record_date) DO UPDATE SET record_date = EXCLUDED.record_date
             RETURNING id`,
            [crypto.randomUUID(), orgId, worker.id, recordDate]
        );
        const recordId = recRes.rows[0].id;
        const existing = (await tx('SELECT * FROM shift_segments WHERE record_id = $1', [recordId])).rows;

        const day = normaliseDaySegments(mergeDayWrite(rowsToDay(existing), body, mergeLeave), rule);
        if (lock.roster_locked && !sameSide(existing, day.segments, rosterSide)) throw rosterLockedError();
        if (lock.timesheet_locked && !sameSide(existing, day.segments, actualSide)) throw timesheetLockedError();

        await tx('DELETE FROM shift_segments WHERE record_id = $1', [recordId]);
        for (const seg of day.segments) {
            await tx(
                `INSERT INTO shift_segments (id, record_id, segment_type, is_unplanned, roster_in, roster_out, roster_hours,
                                             actual_in, actual_out, actual_hours, actual_segment_type, notes, has_break,
                                             break_mins, actual_has_break, actual_break_mins)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
                [crypto.randomUUID(), recordId, seg.segment_type, seg.is_unplanned, seg.roster_in, seg.roster_out, seg.roster_hours,
                    seg.actual_in, seg.actual_out, seg.actual_hours, seg.actual_segment_type, seg.notes, seg.has_break,
                    seg.break_mins, seg.actual_has_break, seg.actual_break_mins]
            );
        }
        await tx('UPDATE daily_records SET has_actuals = $1 WHERE id = $2', [day.hasActuals, recordId]);
        return day.segments;
    });
}
