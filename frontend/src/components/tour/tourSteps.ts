import type { Permission } from '../../hooks/permissions';
import type { TourSignal } from './tourSignals';

/**
 * One step of the walkthrough. It points at a real element (`target` = its data-tour name), says
 * one or two short things about it, and either waits for the person to do something (`waitFor`)
 * or offers "Next". `route` opens the right page first.
 */
export interface TourStep {
  id: string;
  /** Short heading, e.g. "Create a shift". Shown with "Step 3 of 8". */
  title: string;
  body: string[];
  /** data-tour="…" of the element to highlight. Missing on the page → the card is shown on its own. */
  target?: string;
  route?: string;
  /** The step finishes itself when the app sends this signal. "Next" stays available as "Skip". */
  waitFor?: TourSignal;
  /** Instruction shown while waiting, e.g. "Click any day in an employee’s row". */
  doThis?: string;
  /** Shown instead of `body` when the target isn't on the page (e.g. no workers yet). */
  fallback?: string;
  /** Extra content: a small worked example rendered as lines. */
  example?: Array<{ time: string; kind: string; tone: 'work' | 'leave' }>;
  /** Show the Draft → Approved → Locked guide. */
  statusGuide?: boolean;
  /**
   * Only included for someone who holds at least one of these (in any branch). A step that points at
   * something a person can't see, or asks them to do something they can't, is left out.
   */
  needsAny?: Permission[];
}

/** Whoever can put shifts on a roster can also try the day editor. */
const CAN_EDIT_ROSTER: Permission[] = ['rosters.create', 'rosters.edit'];

export const MANAGER_TOUR: TourStep[] = [
  {
    id: 'workspace',
    title: 'Your workspace',
    target: 'workspace',
    body: [
      'Your organisation, the branch you’re working in, and your role.',
      'You only see the branches your roles cover. Use “Switch” to change branch.',
    ],
  },
  {
    id: 'find-roster',
    needsAny: ['rosters.view'],
    title: 'Find the schedule',
    route: '/schedule',
    target: 'roster-controls',
    body: [
      'Pick the branch, then the fortnight with the arrows or the date button. “Today” jumps back to the current pay period.',
      'Search by name to go straight to someone.',
    ],
  },
  {
    id: 'open-day',
    needsAny: CAN_EDIT_ROSTER,
    title: 'Create a shift',
    route: '/schedule',
    target: 'roster-cell',
    waitFor: 'day-editor-opened',
    doThis: 'Click any day in an employee’s row.',
    body: ['Each row is an employee and each box is a day. Click a day to add or change hours.'],
    fallback: 'No employees in this branch yet. Once one is added, their row appears here, one box per day.',
  },
  {
    id: 'enter-times',
    needsAny: CAN_EDIT_ROSTER,
    title: 'Enter the times',
    target: 'time-line',
    waitFor: 'shift-times-entered',
    doThis: 'Type 9 in the first box and 5p in the second.',
    body: [
      'Start → Finish. “9” becomes 9:00 AM; “5p” or “17” becomes 5:00 PM.',
      'Hours are worked out as you type.',
    ],
    fallback: 'Open a day on the roster, then enter a start and finish time, for example 9:00 AM → 5:00 PM.',
  },
  {
    id: 'break',
    needsAny: CAN_EDIT_ROSTER,
    title: 'Add a break',
    target: 'break-controls',
    body: [
      'Each shift has a break. “Standard” follows your organisation’s rule, for example 30 minutes once a day is 6 hours or longer.',
      '“Apply break to all days” ticks every day of the fortnight. Untick the exceptions, then apply.',
    ],
  },
  {
    id: 'leave',
    needsAny: CAN_EDIT_ROSTER,
    title: 'Add leave',
    target: 'add-line',
    waitFor: 'leave-line-added',
    doThis: 'Click “Add time”, then change its type to Sick leave or Annual leave.',
    body: [
      'Leave is another line on the day, with its own type: Sick, Annual, Time in lieu, Leave without pay or Other.',
      'A full day of leave can be entered as hours only.',
    ],
  },
  {
    id: 'split',
    needsAny: CAN_EDIT_ROSTER,
    title: 'Split days',
    target: 'save-day',
    body: [
      'A day can hold several lines. Work and leave are added up separately, and the break only comes off work.',
      'Save keeps your changes; Cancel leaves the day as it was.',
    ],
    example: [
      { time: '9:00 AM → 1:00 PM', kind: 'Work', tone: 'work' },
      { time: '1:00 PM → 3:00 PM', kind: 'Sick leave', tone: 'leave' },
      { time: '3:00 PM → 5:00 PM', kind: 'Work', tone: 'work' },
    ],
  },
  {
    id: 'timesheets',
    needsAny: ['timesheets.view'],
    title: 'Timesheets',
    route: '/timesheets',
    target: 'timesheet-status',
    statusGuide: true,
    body: ['Worked hours are recorded on the schedule. Here you check each person’s fortnight and approve it.'],
  },
  {
    id: 'finish',
    title: 'You’re ready',
    target: 'daily-nav',
    body: [
      'Your daily work lives here. A number shows when something needs your approval.',
      'Take this tour again any time from Help.',
    ],
  },
];

export const EMPLOYEE_TOUR: TourStep[] = [
  {
    id: 'workspace',
    title: 'Your workspace',
    target: 'workspace',
    body: ['Your workplace and branch. Everything here is about your own shifts and hours.'],
  },
  {
    id: 'schedule',
    title: 'Your schedule',
    route: '/my/schedule',
    target: 'schedule-today',
    body: [
      'Today’s shift is at the top: when you start and finish, and where.',
      'Below it is the rest of your fortnight. Use the arrows to see the next one.',
    ],
  },
  {
    id: 'leave',
    title: 'Asking for leave',
    route: '/my/leave',
    target: 'leave-form',
    body: ['Choose the leave type and dates, then send it. Its status shows here.'],
  },
  {
    id: 'finish',
    title: 'You’re ready',
    target: 'daily-nav',
    body: ['Everything you need is in this menu. Take this tour again any time from Help.'],
  },
];

/** Shown only when employees may record their own hours. Inserted before "Asking for leave". */
export const EMPLOYEE_TIMESHEET_STEP: TourStep = {
  id: 'timesheet',
  title: 'Your hours',
  route: '/my/timesheet',
  target: 'my-timesheet',
  statusGuide: true,
  body: ['Record the hours you actually worked. Your manager approves them at the end of the pay period.'],
};
