/**
 * Payroll-hours report: classification, LWIP, break handling, export safety and auditing.
 */
import request from 'supertest';
import app from '../src/index';
import { clearAllRateLimits } from '../src/services/authUtils';
import { classifySegmentHours } from '../src/services/classificationService';
import { connectTestDb, resetTestDb, closeTestDb, sql } from './helpers/testDb';
import { PERIOD, World, bearer, buildWorld } from './helpers/fixtures';

let w: World;
beforeAll(connectTestDb);
afterAll(closeTestDb);
beforeEach(async () => {
    await resetTestDb();
    clearAllRateLimits();
    w = await buildWorld();
});

const save = (workerId: string, date: string, segments: object[]) =>
    request(app).post('/api/records').set(bearer(w.tokens.owner)).send({ employee_id: workerId, record_date: date, segments });

const reportFor = async (name: string, token = w.tokens.owner) => {
    const res = await request(app).get(`/api/reports/payroll?start_date=${PERIOD}`).set(bearer(token));
    return res.body.data.employees.find((e: any) => e.full_name === name);
};

describe('payroll report', () => {
    it('classifies worked hours and every leave type, LWIP included, and the columns add up', async () => {
        await save(w.workers.mel, '2026-03-30', [
            { segment_type: 'Sick', roster_in: '09:00', roster_out: '13:00', actual_in: '09:00', actual_out: '13:00' },
            { segment_type: 'Annual', roster_in: '13:00', roster_out: '15:00', actual_in: '13:00', actual_out: '15:00' },
            { segment_type: 'WORK', roster_in: '15:00', roster_out: '17:00', actual_in: '15:00', actual_out: '17:00' },
        ]);
        await save(w.workers.mel, '2026-04-04', [{ roster_in: '10:00', roster_out: '14:00', actual_in: '10:00', actual_out: '14:00' }]); // Saturday
        await save(w.workers.mel, '2026-03-31', [{ segment_type: 'LWIP', roster_hours: 7.6, actual_hours: 7.6 }]);
        await save(w.workers.mel, '2026-04-01', [{ segment_type: 'TIL', roster_hours: 3, actual_hours: 3 }, { segment_type: 'Other', roster_hours: 1, actual_hours: 1 }]);

        const mel = await reportFor('Mel Worker');
        expect(mel).toMatchObject({
            sick_hours: 4, annual_hours: 2, normal_hours: 1.5, saturday_hours: 4,
            lwip_hours: 7.6, til_hours: 3, other_hours: 1, actual_hours: 23.1, location_name: 'Melbourne',
        });
        const categories = mel.normal_hours + mel.saturday_hours + mel.sunday_hours + mel.public_holiday_hours
            + mel.sick_hours + mel.annual_hours + mel.til_hours + mel.lwip_hours + mel.other_hours;
        expect(Math.round(categories * 100) / 100).toBe(mel.actual_hours);
    });

    it('public holidays are classified as public holiday hours', async () => {
        await sql("INSERT INTO public_holidays (org_id, holiday_date, name) VALUES ($1, '2026-04-06', 'Easter Monday')", [w.abc.id]);
        await save(w.workers.rich, '2026-04-06', [{ roster_in: '09:00', roster_out: '17:00', actual_in: '09:00', actual_out: '17:00' }]);
        expect((await reportFor('Rich Worker')).public_holiday_hours).toBe(7.5);
    });

    it('an overnight shift splits across the two calendar days', async () => {
        await save(w.workers.mel, '2026-04-03', [{ roster_in: '22:00', roster_out: '06:00', actual_in: '22:00', actual_out: '06:00' }]); // Fri → Sat
        const mel = await reportFor('Mel Worker');
        expect([mel.normal_hours, mel.saturday_hours]).toEqual([2, 5.5]);
    });

    it('shows the roster until worked hours exist, and approved/locked status', async () => {
        await save(w.workers.gee, '2026-03-30', [{ roster_in: '09:00', roster_out: '17:00' }]);
        expect((await reportFor('Gee Worker')).normal_hours).toBe(7.5);
        await request(app).post('/api/submissions/approve').set(bearer(w.tokens.owner)).send({ employee_id: w.workers.gee, start_date: PERIOD });
        expect((await reportFor('Gee Worker')).submission_status).toBe('Approved');
    });

    it('classification never re-deducts a break: it spreads the stored net hours', () => {
        const slices = classifySegmentHours({ recordDate: '2026-03-30', startTime: '09:00', endTime: '13:00', netHours: 4, segmentType: 'WORK', holidays: new Map() });
        expect(slices.map(s => s.normalHours)).toEqual([4]);
    });
});

describe('exports', () => {
    it('CSV neutralises spreadsheet formulas, has LWIP and branch columns, and is audited', async () => {
        await sql("UPDATE employees SET full_name = '=HYPERLINK(\"http://evil\")' WHERE id = $1", [w.workers.mel]);
        const res = await request(app).get(`/api/reports/export/csv?start_date=${PERIOD}`).set(bearer(w.tokens.sarah));
        expect(res.status).toBe(200);
        expect(res.text.split('\r\n')[0]).toContain('LWIP (h)');
        expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
        expect(res.text).toContain('Melbourne');
        const audit = await sql("SELECT actor_id FROM audit_logs WHERE action = 'PAYROLL_EXPORTED'");
        expect(audit.rows).toEqual([{ actor_id: w.users.sarah.id }]);
    });

    it('the printable report escapes every interpolated value', async () => {
        await sql("UPDATE employees SET full_name = '<script>alert(1)</script>', department = '<img src=x onerror=alert(2)>' WHERE id = $1", [w.workers.mel]);
        await sql("UPDATE organisations SET name = '<b>ABC</b>' WHERE id = $1", [w.abc.id]);
        const res = await request(app).get(`/api/reports/export/pdf?start_date=${PERIOD}`).set(bearer(w.tokens.owner));
        expect(res.text).not.toMatch(/<script>alert|<img src=x|<b>ABC<\/b>/);
        expect(res.text).toContain('&lt;script&gt;');
    });
});
