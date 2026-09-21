/**
 * The shared segment model: validation and the day-level break rule (pure functions, no database).
 */
import { HttpError } from '../src/services/policy';
import { normaliseDaySegments } from '../src/services/segments';

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

    it('a full day of leave keeps the break, as before', () => {
        expect(hours([{ segment_type: 'Annual', roster_in: '09:00', roster_out: '17:00' }])).toEqual([7.5]);
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
