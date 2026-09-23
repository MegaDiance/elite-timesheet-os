/**
 * The shared segment model: validation and the day-level break rule (pure functions, no database).
 */
import { HttpError } from '../src/services/policy';
import { mergeDayWrite, mergeLeaveIntoRoster, normaliseDaySegments, rowsToDay, type DayEntry } from '../src/services/segments';

const RULE = { breakMins: 30, thresholdHours: 6 };
const day = (segments: object[], rule = RULE) => normaliseDaySegments(segments, rule).segments;
const hours = (segments: object[], side: 'roster_hours' | 'actual_hours' = 'roster_hours', rule = RULE) =>
    day(segments, rule).map(s => s[side]);

function rejectCode(segments: object[]): string {
    try {
        normaliseDaySegments(segments, RULE);
    } catch (err) {
        if (err instanceof HttpError) return err.code;
        throw err;
    }
    throw new Error('expected the day to be rejected');
}

describe('segment hours', () => {
    it('a simple 9–5 day is unchanged: one 30-minute break → 7.5 h', () => {
        expect(hours([{ roster_in: '9', roster_out: '5pm' }])).toEqual([7.5]);
    });

    it('has_break defaults to true when absent, matching the pre-existing implicit rule', () => {
        const segments = day([{ roster_in: '9', roster_out: '5pm' }]);
        expect(segments[0].has_break).toBe(true);
        expect(segments[0].roster_hours).toBe(7.5);
    });

    it('has_break: false opts one shift out of the break deduction entirely', () => {
        expect(hours([{ roster_in: '9', roster_out: '5pm', has_break: false }])).toEqual([8]);
    });

    it('a has_break: false shift is skipped even when it is the only eligible WORK segment', () => {
        const segments = day([
            { segment_type: 'WORK', roster_in: '09:00', roster_out: '17:00', has_break: false },
            { segment_type: 'Sick', roster_in: '17:00', roster_out: '18:00' },
        ]);
        expect(segments.map(s => [s.segment_type, s.roster_hours])).toEqual([['WORK', 8], ['Sick', 1]]);
    });

    it('with two back-to-back WORK shifts, only the has_break:true one is eligible for the deduction', () => {
        const segments = day([
            { segment_type: 'WORK', roster_in: '06:00', roster_out: '12:00', has_break: false },
            { segment_type: 'WORK', roster_in: '12:00', roster_out: '18:00' },
        ]);
        expect(segments.map(s => [s.segment_type, s.roster_hours])).toEqual([['WORK', 6], ['WORK', 5.5]]);
    });

    it('the complex day 9–1 Sick · 1–3 Annual · 3–5 Work pays 7.5 h, with the break taken from work, not leave', () => {
        const segments = day([
            { segment_type: 'Sick', roster_in: '09:00', roster_out: '13:00' },
            { segment_type: 'Annual', roster_in: '13:00', roster_out: '15:00' },
            { segment_type: 'WORK', roster_in: '15:00', roster_out: '17:00' },
        ]);
        expect(segments.map(s => [s.segment_type, s.roster_hours])).toEqual([['Sick', 4], ['Annual', 2], ['WORK', 1.5]]);
    });

    it('two long segments are not deducted twice', () => {
        expect(hours([{ roster_in: '06:00', roster_out: '12:00' }, { roster_in: '12:00', roster_out: '18:00' }])).toEqual([5.5, 6]);
    });

    it('a split day whose gap is the break is not deducted again', () => {
        expect(hours([{ roster_in: '09:00', roster_out: '13:00' }, { roster_in: '13:30', roster_out: '17:30' }])).toEqual([4, 4]);
    });

    it('a split day under the threshold has no break', () => {
        expect(hours([{ roster_in: '09:00', roster_out: '11:00' }, { roster_in: '11:00', roster_out: '14:00' }])).toEqual([2, 3]);
    });

    it('leave is never reduced by the break: a full day of Annual Leave is 8 h', () => {
        expect(hours([{ segment_type: 'Annual', roster_in: '09:00', roster_out: '17:00' }])).toEqual([8]);
    });

    it('with several leave types and no work, nothing is deducted', () => {
        expect(hours([
            { segment_type: 'Sick', roster_in: '09:00', roster_out: '13:00' },
            { segment_type: 'Annual', roster_in: '13:00', roster_out: '17:00' },
        ])).toEqual([4, 4]);
    });

    it('work shorter than the break is not deducted either', () => {
        expect(hours([
            { segment_type: 'Annual', roster_in: '09:00', roster_out: '16:40' },
            { segment_type: 'WORK', roster_in: '16:40', roster_out: '17:00' },
        ])).toEqual([7.67, 0.33]);
    });

    it('the weekend break setting applies to weekend days', () => {
        expect(hours([{ roster_in: '09:00', roster_out: '17:00' }], 'roster_hours', { breakMins: 0, thresholdHours: 6 })).toEqual([8]);
    });

    it('an overnight segment is allowed', () => {
        expect(hours([{ roster_in: '22:00', roster_out: '06:00' }])).toEqual([7.5]);
    });

    it('rostered and worked sides are calculated independently, to 2 decimal places', () => {
        const [seg] = day([{ roster_in: '09:00', roster_out: '17:00', actual_in: '08:50', actual_out: '17:10' }]);
        expect([seg.roster_hours, seg.actual_hours]).toEqual([7.5, 7.83]);
        expect(seg.actual_segment_type).toBe('WORK');
    });

    it('untimed segments keep their entered hours (e.g. a day of LWIP)', () => {
        const [seg] = day([{ segment_type: 'LWIP', roster_hours: 7.6 }]);
        expect([seg.segment_type, seg.roster_hours]).toEqual(['LWIP', 7.6]);
    });

    it('worked side types default to the rostered type and can differ', () => {
        const [seg] = day([{ segment_type: 'WORK', roster_in: '09:00', roster_out: '17:00', actual_in: '09:00', actual_out: '17:00', actual_segment_type: 'Sick' }]);
        expect(seg.actual_segment_type).toBe('Sick');
    });
});

describe('segment validation', () => {
    it.each([
        ['overlapping rostered times', [{ roster_in: '09:00', roster_out: '13:00' }, { roster_in: '12:00', roster_out: '15:00' }], 'OVERLAP'],
        ['overlapping worked times', [{ actual_in: '09:00', actual_out: '13:00' }, { actual_in: '12:59', actual_out: '15:00' }], 'OVERLAP'],
        ['a finish before the start', [{ roster_in: '17:00', roster_out: '09:00' }], 'BACKWARDS_TIME'],
        ['start equal to finish', [{ roster_in: '09:00', roster_out: '09:00' }], 'EMPTY_SEGMENT'],
        ['an empty segment', [{ segment_type: 'WORK' }], 'EMPTY_SEGMENT'],
        ['a start without a finish', [{ roster_in: '09:00' }], 'INCOMPLETE_SEGMENT'],
        ['an accidental duplicate', [{ segment_type: 'TIL', roster_hours: 2 }, { segment_type: 'TIL', roster_hours: 2 }], 'DUPLICATE_SEGMENT'],
        ['an unknown type', [{ segment_type: 'Holiday', roster_in: '09:00', roster_out: '17:00' }], 'INVALID_TYPE'],
        ['LWOP (the product term is LWIP)', [{ segment_type: 'LWOP', roster_hours: 4 }], 'INVALID_TYPE'],
        ['an invalid time', [{ roster_in: 'soon', roster_out: '17:00' }], 'INVALID_TIME'],
        ['negative hours', [{ roster_hours: -1 }], 'INVALID_DURATION'],
    ])('rejects %s', (_label, segments, code) => {
        expect(rejectCode(segments)).toBe(code);
    });

    it('touching segments (13:00 → 13:00) are not an overlap', () => {
        expect(() => day([{ roster_in: '09:00', roster_out: '13:00' }, { roster_in: '13:00', roster_out: '17:00' }])).not.toThrow();
    });

    it('accepts every product segment type', () => {
        for (const type of ['WORK', 'Sick', 'Annual', 'TIL', 'LWIP', 'Other']) {
            expect(day([{ segment_type: type, roster_hours: 1 }])[0].segment_type).toBe(type);
        }
    });

    it('an empty list clears the day', () => {
        expect(normaliseDaySegments([], RULE)).toEqual({ segments: [], hasActuals: false });
    });
});

describe('mergeLeaveIntoRoster (automatically_merge_leave_with_roster)', () => {
    const e = (type: string, start: string, finish: string): DayEntry => ({ type: type as any, start, finish, hours: 0, has_break: true });
    const shape = (result: DayEntry[]) => result.map(x => [x.type, x.start, x.finish]).sort((a, b) => (a[1] as string).localeCompare(b[1] as string));

    it('leave in the middle of a shift splits it in two', () => {
        const result = mergeLeaveIntoRoster([e('WORK', '09:00', '17:00'), e('Sick', '13:00', '14:00')]);
        expect(shape(result)).toEqual([['WORK', '09:00', '13:00'], ['Sick', '13:00', '14:00'], ['WORK', '14:00', '17:00']].sort((a, b) => a[1].localeCompare(b[1])));
    });

    it('leave at the start leaves one surviving interval after it', () => {
        const result = mergeLeaveIntoRoster([e('WORK', '09:00', '17:00'), e('Sick', '09:00', '11:00')]);
        expect(shape(result)).toEqual([['Sick', '09:00', '11:00'], ['WORK', '11:00', '17:00']]);
    });

    it('leave at the end leaves one surviving interval before it', () => {
        const result = mergeLeaveIntoRoster([e('WORK', '09:00', '17:00'), e('Annual', '15:00', '17:00')]);
        expect(shape(result)).toEqual([['WORK', '09:00', '15:00'], ['Annual', '15:00', '17:00']]);
    });

    it('leave covering the entire shift leaves no surviving WORK interval', () => {
        const result = mergeLeaveIntoRoster([e('WORK', '09:00', '17:00'), e('Annual', '09:00', '17:00')]);
        expect(shape(result)).toEqual([['Annual', '09:00', '17:00']]);
    });

    it('multiple leave periods in one shift produce every surviving sub-interval, sorted chronologically', () => {
        const result = mergeLeaveIntoRoster([e('WORK', '09:00', '17:00'), e('Sick', '10:00', '11:00'), e('Annual', '14:00', '15:00')]);
        expect(shape(result)).toEqual([
            ['WORK', '09:00', '10:00'], ['Sick', '10:00', '11:00'], ['WORK', '11:00', '14:00'], ['Annual', '14:00', '15:00'], ['WORK', '15:00', '17:00'],
        ]);
    });

    it('a WORK shift with no overlapping leave is untouched, and unrelated entries pass through', () => {
        const result = mergeLeaveIntoRoster([e('WORK', '09:00', '12:00'), e('Sick', '14:00', '15:00')]);
        expect(shape(result)).toEqual([['WORK', '09:00', '12:00'], ['Sick', '14:00', '15:00']]);
    });

    it('an hours-only (untimed) leave entry has nothing to overlap and passes through unchanged', () => {
        const untimed: DayEntry = { type: 'Annual' as any, start: null, finish: null, hours: 7.6, has_break: true };
        const result = mergeLeaveIntoRoster([e('WORK', '09:00', '17:00'), untimed]);
        expect(result).toContainEqual(untimed);
        expect(result.find(x => x.type === 'WORK')).toEqual(e('WORK', '09:00', '17:00'));
    });

    it('a shift with no leave overlapping it at all returns the same entries', () => {
        const result = mergeLeaveIntoRoster([e('WORK', '09:00', '17:00')]);
        expect(shape(result)).toEqual([['WORK', '09:00', '17:00']]);
    });
});

describe('leave/roster auto-merge through the full write pipeline (mergeDayWrite + normaliseDaySegments)', () => {
    const EMPTY_DAY = { roster: [], timesheet: [], note: null };
    const write = (roster: object[]) => mergeDayWrite(EMPTY_DAY, { scope: 'BOTH', roster, timesheet: [] }, true);

    it('leave in the middle: 9–1 WORK, 1–2 leave, 2–5 WORK pays 7 h total, no double break', () => {
        const segments = normaliseDaySegments(
            write([{ type: 'WORK', start: '09:00', finish: '17:00' }, { type: 'Sick', start: '13:00', finish: '14:00' }]),
            RULE
        ).segments;
        const byType = segments.map(s => [s.segment_type, s.roster_in, s.roster_out, s.roster_hours]).sort((a, b) => (a[1] as string).localeCompare(b[1] as string));
        expect(byType).toEqual([['WORK', '09:00', '13:00', 3.5], ['Sick', '13:00', '14:00', 1], ['WORK', '14:00', '17:00', 3]]);
        expect(segments.reduce((sum, s) => sum + s.roster_hours, 0)).toBe(7.5); // 8h - 30min break, taken from the longer WORK piece
    });

    it('leave-vs-leave overlap is still rejected, never silently resolved', () => {
        expect(() => normaliseDaySegments(
            write([{ type: 'WORK', start: '09:00', finish: '17:00' }, { type: 'Sick', start: '10:00', finish: '12:00' }, { type: 'Annual', start: '11:00', finish: '13:00' }]),
            RULE
        )).toThrow(/overlap/i);
    });

    it('when the setting is off, the same input is rejected as OVERLAP instead of merged', () => {
        const rows = mergeDayWrite(EMPTY_DAY, { scope: 'BOTH', roster: [{ type: 'WORK', start: '09:00', finish: '17:00' }, { type: 'Sick', start: '13:00', finish: '14:00' }], timesheet: [] }, false);
        expect(() => normaliseDaySegments(rows, RULE)).toThrow(/overlap/i);
    });

    it('leave covering the whole shift leaves only the leave entry, with its full hours', () => {
        const segments = normaliseDaySegments(write([{ type: 'WORK', start: '09:00', finish: '17:00' }, { type: 'Annual', start: '09:00', finish: '17:00' }]), RULE).segments;
        expect(segments.map(s => [s.segment_type, s.roster_hours])).toEqual([['Annual', 8]]);
    });

    it('a rostered break window that already accounts for the gap is not deducted a second time alongside merged leave', () => {
        // 9-12 WORK, 12-12:30 gap (lunch), 12:30-17 WORK, with a 1-2pm sick leave carved out of the afternoon piece.
        const segments = normaliseDaySegments(
            write([
                { type: 'WORK', start: '09:00', finish: '12:00' },
                { type: 'WORK', start: '12:30', finish: '17:00' },
                { type: 'Sick', start: '13:00', finish: '14:00' },
            ]),
            RULE
        ).segments;
        const total = segments.reduce((sum, s) => sum + s.roster_hours, 0);
        // 09:00-12:00 (3h) + 12:30-13:00 (0.5h, after the leave split) + Sick 13:00-14:00 (1h) + 14:00-17:00 (3h) = 7.5h.
        // The 12:00-12:30 gap already covers the 30 min break, so nothing further is deducted from either WORK piece.
        expect(total).toBe(7.5);
    });
});
