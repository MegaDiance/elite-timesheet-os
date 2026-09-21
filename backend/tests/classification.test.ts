import { classifySegmentHours, getWeekdayName, addDaysToIso, timeToMinutes } from '../src/services/classificationService';

describe('shift classification', () => {
    const holidays = new Map([['2026-04-06', 'Easter Monday']]);
    const classify = (recordDate: string, startTime: string, endTime: string, netHours: number, segmentType = 'WORK') =>
        classifySegmentHours({ recordDate, startTime, endTime, netHours, segmentType, holidays });

    it('date helpers work in UTC', () => {
        expect(getWeekdayName('2026-04-04')).toBe('Sat');
        expect(getWeekdayName('2026-04-05')).toBe('Sun');
        expect(addDaysToIso('2026-03-31', 1)).toBe('2026-04-01');
        expect(timeToMinutes('13:30')).toBe(810);
    });

    it('a weekday shift is ordinary hours', () => {
        expect(classify('2026-04-01', '09:00', '17:00', 7.5)).toMatchObject([{ normalHours: 7.5, totalHours: 7.5 }]);
    });

    it('Saturday and Sunday are classified separately', () => {
        expect(classify('2026-04-04', '10:00', '14:00', 4)[0].saturdayHours).toBe(4);
        expect(classify('2026-04-05', '12:00', '16:00', 4)[0].sundayHours).toBe(4);
    });

    it('a public holiday takes precedence over the weekday', () => {
        expect(classify('2026-04-06', '09:00', '15:00', 5.5)[0]).toMatchObject({ publicHolidayHours: 5.5, isPublicHoliday: true, holidayName: 'Easter Monday' });
    });

    it('an overnight shift splits at midnight; the unpaid break comes off the longer slice', () => {
        const [fri, sat] = classify('2026-04-03', '22:00', '06:00', 7.5);
        expect([fri.date, fri.normalHours]).toEqual(['2026-04-03', 2]);
        expect([sat.date, sat.saturdayHours]).toEqual(['2026-04-04', 5.5]);
    });

    it('leave segments are leave hours whatever the day', () => {
        expect(classify('2026-04-04', '09:00', '13:00', 4, 'LWIP')[0]).toMatchObject({ leaveHours: 4, leaveType: 'LWIP', saturdayHours: 0 });
    });

    it('identical start and finish yield nothing', () => {
        expect(classify('2026-04-01', '09:00', '09:00', 0)).toEqual([]);
    });
});
