/**
 * The example organisation shown in the product tour. Every name, time and number here is made
 * up. Email addresses use the reserved example.com domain, and the sign-in link is always
 * shown masked. The people match the other illustrations on the homepage, and the numbers add up
 * across chapters: the default roster gives the timesheet totals, and those give the payroll
 * report.
 *
 * No imports, so the tests can load it straight into Node.
 */

export const DEMO_ORGANISATION = 'Example Bakery Group';

/** A real pay period start: fortnights run from Sunday, and 10 May 2026 is one. */
export const DEMO_PERIOD_START = '2026-05-10';

/** Week 1 of the pay period, Sunday first like the app's roster. */
export const DEMO_WEEK = ['2026-05-10', '2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15', '2026-05-16'];

/** The organisation's break rule (the app's defaults): 30 min on weekdays, none at weekends, from 6 h. */
export const DEMO_BREAK = { weekdayMins: 30, weekendMins: 0, thresholdHours: 6 };

/** Shown instead of a real private sign-in link, which is never displayed. */
export const DEMO_SIGN_IN_LINK = '…/login/••••••••••••••••';

export interface DemoBranch {
  name: string;
  activeWorkers: number;
  timeZone: string;
}

export const DEMO_BRANCHES: DemoBranch[] = [
  { name: 'Richmond', activeWorkers: 4, timeZone: 'Melbourne (AEST/AEDT)' },
  { name: 'Footscray', activeWorkers: 6, timeZone: 'Melbourne (AEST/AEDT)' },
  { name: 'Geelong', activeWorkers: 5, timeZone: 'Melbourne (AEST/AEDT)' },
];

/** Branch Admins: one already set up, one being invited in the tour. */
export const DEMO_BRANCH_ADMINS = [
  { name: 'Daniel M.', email: 'daniel.m@example.com', branches: ['Geelong'] },
  { name: 'Priya S.', email: 'priya.s@example.com', branches: ['Richmond', 'Footscray'] },
];

/** "HH:MM-HH:MM", or null for a day off. */
export type DemoShift = string | null;

export interface DemoWorker {
  name: string;
  email: string;
  department: string;
  contractHours: number;
  /** Default roster for week 1 (the fortnight repeats it), Sunday first. */
  week: DemoShift[];
}

export const DEMO_WORKERS: DemoWorker[] = [
  {
    name: 'Aisha Khan',
    email: 'aisha.khan@example.com',
    department: 'Front of house',
    contractHours: 76,
    week: [null, '09:00-17:00', '09:00-17:00', '09:00-17:00', '09:00-17:00', '09:00-17:00', null],
  },
  {
    name: 'Grace Wilson',
    email: 'grace.wilson@example.com',
    department: 'Kitchen',
    contractHours: 68,
    week: [null, '09:00-17:00', '09:00-17:00', '09:00-17:00', '09:00-17:00', '09:00-17:00', null],
  },
  {
    name: 'Tom Nguyen',
    email: 'tom.nguyen@example.com',
    department: 'Kitchen',
    contractHours: 68,
    week: ['08:00-14:00', null, '12:00-20:00', '12:00-20:00', null, '12:00-20:00', '08:00-14:00'],
  },
  {
    name: 'Liam O’Brien',
    email: 'liam.obrien@example.com',
    department: 'Deliveries',
    contractHours: 76,
    week: ['10:00-16:00', '07:00-15:30', '07:00-15:30', null, '07:00-15:30', '07:00-15:30', null],
  },
];

/** The one day changed by hand after the default rosters are applied (chapter "Roster"): same hours, later start. */
export const DEMO_ROSTER_CHANGE = { worker: 3, day: 1, shift: '07:30-16:00' };

/** The one day whose worked hours are edited to add part-day leave (chapter "Hours worked"). */
export const DEMO_LEAVE_EDIT: { worker: number; day: number; work: string; leave: { type: 'Sick'; time: string } } = {
  worker: 1,
  day: 2,
  work: '09:00-13:00',
  leave: { type: 'Sick', time: '13:00-17:00' },
};

/** The fortnight on the Timesheets screen: every worker's rostered and worked hours. */
export const DEMO_TIMESHEETS = DEMO_WORKERS.map((worker, i) => ({
  name: worker.name,
  contractHours: worker.contractHours,
  rostered: [75, 67.5, 69, 76][i],
  worked: [75, 67.5, 69, 76][i],
}));

/** Columns of the Reports "Hours by category" tab, in the app's order. */
export const DEMO_REPORT_COLUMNS = [
  'Ordinary',
  'Saturday',
  'Sunday',
  'Public holiday',
  'Annual Leave',
  'Sick Leave',
  'TIL',
  'LWIP',
  'Other',
] as const;

/** Hours per column above, per worker, for the fortnight. Each row adds up to that worker's worked hours. */
export const DEMO_REPORT: Array<{ name: string; hours: number[] }> = [
  { name: 'Aisha Khan', hours: [75, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: 'Grace Wilson', hours: [56, 0, 0, 0, 7.5, 4, 0, 0, 0] },
  { name: 'Tom Nguyen', hours: [45, 12, 12, 0, 0, 0, 0, 0, 0] },
  { name: 'Liam O’Brien', hours: [59.5, 0, 12, 0, 0, 0, 4.5, 0, 0] },
];
