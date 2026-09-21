import { query } from './db';
import { parseSmartTime } from './timeParser';
import { badRequest } from './policy';

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
}

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

interface TimedSpan { index: number; start: number; end: number; type: SegmentType }

/** Start/end in minutes from midnight of the record date; an overnight segment ends after 1440. */
function spanOf(index: number, type: SegmentType, start: string, end: string, label: string): TimedSpan {
    const s = toMinutes(start);
    let e = toMinutes(end);
    if (e === s) throw badRequest('EMPTY_SEGMENT', `${label}: start and finish are the same time.`);
    if (e < s) e += 1440;
    if (e - s > MAX_SEGMENT_MINUTES) {
        throw badRequest('BACKWARDS_TIME', `${label}: the finish time is before the start time.`);
    }
    return { index, start: s, end: e, type };
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
 * The organisation's unpaid break is a property of the DAY, not of each segment: it is deducted
 * once when the day's timed segments add up to the threshold — unless the segments already leave
 * a gap at least as long as the break (the break was taken between them). It comes off the
 * longest Normal Work segment, so leave hours are not reduced by a break taken while working; a
 * day with no work time takes it from its longest segment, as a full leave day always has.
 * A single-segment day therefore calculates exactly as before, a split day is no longer
 * under-deducted, and two long segments are no longer deducted twice.
 */
export function computeDayHours(spans: TimedSpan[], rule: BreakRule): Map<number, number> {
    const hours = new Map<number, number>();
    if (spans.length === 0) return hours;

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
        };
    });

    const rosterSpans = drafts.filter(d => d.rosterIn && d.rosterOut).map(d => spanOf(d.index, d.segment_type, d.rosterIn!, d.rosterOut!, `${d.label} (rostered)`));
    const actualSpans = drafts.filter(d => d.actualIn && d.actualOut).map(d => spanOf(d.index, d.actual_segment_type || d.segment_type, d.actualIn!, d.actualOut!, `${d.label} (worked)`));
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
