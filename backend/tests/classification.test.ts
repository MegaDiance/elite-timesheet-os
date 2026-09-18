import { newDb, DataType } from 'pg-mem';
import { setPool } from '../src/services/db';
import { classifyShiftHours, getWeekdayName, addDaysToIso, timeToMinutes } from '../src/services/classificationService';

describe('Shift Classification & Public Holiday Engine Tests', () => {
    const testOrgId = '999e4567-e89b-12d3-a456-000000000001';

    beforeAll(async () => {
        const db = newDb();
        db.public.registerFunction({
            name: 'gen_random_uuid',
            args: [],
            returns: DataType.uuid,
            implementation: () => crypto.randomUUID(),
        });

        db.public.none(`
            CREATE TABLE public_holidays (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL,
                holiday_date TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(org_id, holiday_date)
            );
        `);

        // Seed a public holiday on 2026-04-06 (Easter Monday)
        db.public.none(`
            INSERT INTO public_holidays (org_id, holiday_date, name)
            VALUES ('${testOrgId}', '2026-04-06', 'Easter Monday');
        `);

        const pool = {
            query: (text: string, params: any[]) => {
                let p = params || [];
                let sql = text;
                p.forEach((val, idx) => {
                    const ph = new RegExp('\\$' + (idx + 1), 'g');
                    sql = sql.replace(ph, typeof val === 'string' ? `'${val}'` : val);
                });
                try {
                    const rows = db.public.many(sql);
                    return Promise.resolve({ rows });
                } catch (e: any) {
                    if (e.message?.includes('no result') || e.message?.includes('not found')) {
                        return Promise.resolve({ rows: [] });
                    }
                    try {
                        db.public.none(sql);
                        return Promise.resolve({ rows: [] });
                    } catch (e2: any) {
                        return Promise.reject(e2);
                    }
                }
            }
        };

        setPool(pool as any);
    });

    test('getWeekdayName returns correct day of week in pure UTC', () => {
        expect(getWeekdayName('2026-04-03')).toBe('Fri');
        expect(getWeekdayName('2026-04-04')).toBe('Sat');
        expect(getWeekdayName('2026-04-05')).toBe('Sun');
        expect(getWeekdayName('2026-04-06')).toBe('Mon');
    });

    test('addDaysToIso correctly adds days without timezone offset', () => {
        expect(addDaysToIso('2026-04-03', 1)).toBe('2026-04-04');
        expect(addDaysToIso('2026-04-30', 1)).toBe('2026-05-01');
    });

    test('timeToMinutes converts HH:mm properly', () => {
        expect(timeToMinutes('09:00')).toBe(540);
        expect(timeToMinutes('17:30')).toBe(1050);
        expect(timeToMinutes('00:00')).toBe(0);
    });

    test('classifies a normal weekday shift without crossing midnight', async () => {
        // Wednesday 2026-04-01, 09:00 to 17:00 (8h, 30m break deducted = 7.5h)
        const slices = await classifyShiftHours(testOrgId, '2026-04-01', '09:00', '17:00', 'WORK');
        expect(slices.length).toBe(1);
        expect(slices[0].dayOfWeek).toBe('Wed');
        expect(slices[0].isPublicHoliday).toBe(false);
        expect(slices[0].normalHours).toBe(7.5);
        expect(slices[0].saturdayHours).toBe(0);
        expect(slices[0].sundayHours).toBe(0);
        expect(slices[0].publicHolidayHours).toBe(0);
    });

    test('classifies Saturday and Sunday shifts accurately', async () => {
        // Saturday 2026-04-04, 10:00 to 14:00 (4h, no break deduction since < 6h)
        const sat = await classifyShiftHours(testOrgId, '2026-04-04', '10:00', '14:00', 'WORK');
        expect(sat.length).toBe(1);
        expect(sat[0].dayOfWeek).toBe('Sat');
        expect(sat[0].saturdayHours).toBe(4);
        expect(sat[0].normalHours).toBe(0);

        // Sunday 2026-04-05, 12:00 to 16:00
        const sun = await classifyShiftHours(testOrgId, '2026-04-05', '12:00', '16:00', 'WORK');
        expect(sun.length).toBe(1);
        expect(sun[0].dayOfWeek).toBe('Sun');
        expect(sun[0].sundayHours).toBe(4);
        expect(sun[0].normalHours).toBe(0);
    });

    test('classifies cross-midnight shift (Friday night into Saturday morning)', async () => {
        // Friday 2026-04-03 22:00 to Saturday 2026-04-04 02:00 (4 hours total, 2h Fri, 2h Sat)
        const slices = await classifyShiftHours(testOrgId, '2026-04-03', '22:00', '02:00', 'WORK');
        expect(slices.length).toBe(2);

        // Slice 1: Friday
        expect(slices[0].date).toBe('2026-04-03');
        expect(slices[0].dayOfWeek).toBe('Fri');
        expect(slices[0].normalHours).toBe(2);
        expect(slices[0].saturdayHours).toBe(0);

        // Slice 2: Saturday
        expect(slices[1].date).toBe('2026-04-04');
        expect(slices[1].dayOfWeek).toBe('Sat');
        expect(slices[1].normalHours).toBe(0);
        expect(slices[1].saturdayHours).toBe(2);
    });

    test('classifies public holiday hours on designated holiday dates', async () => {
        // Monday 2026-04-06 is seeded as 'Easter Monday'
        const slices = await classifyShiftHours(testOrgId, '2026-04-06', '09:00', '15:00', 'WORK');
        expect(slices.length).toBe(1);
        expect(slices[0].isPublicHoliday).toBe(true);
        expect(slices[0].holidayName).toBe('Easter Monday');
        expect(slices[0].publicHolidayHours).toBe(5.5); // 6h minus 0.5h break
        expect(slices[0].normalHours).toBe(0);
    });

    test('classifies leave shifts appropriately without award multipliers', async () => {
        const slices = await classifyShiftHours(testOrgId, '2026-04-01', '09:00', '17:00', 'Sick');
        expect(slices.length).toBe(1);
        expect(slices[0].leaveHours).toBe(7.5);
        expect(slices[0].leaveType).toBe('Sick');
        expect(slices[0].normalHours).toBe(0);
    });
});
