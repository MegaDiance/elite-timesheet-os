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
  /** Instruction shown while waiting, e.g. "Click any day in a worker’s row". */
  doThis?: string;
  /** Shown instead of `body` when the target isn't on the page (e.g. no workers yet). */
  fallback?: string;
  /** Extra content: a small worked example rendered as lines. */
  example?: Array<{ time: string; kind: string; tone: 'work' | 'leave' }>;
  /** Show the Draft → Approved → Locked guide. */
  statusGuide?: boolean;
}

export const MANAGER_TOUR: TourStep[] = [
  {
    id: 'workspace',
    title: 'Your workspace',
    target: 'workspace',
    body: [
      'This shows the organisation you’re signed in to, the branch you’re working in, and your role.',
      'You only see branches you’ve been given access to. Use “Switch” to change branch.',
    ],
  },
  {
    id: 'find-roster',
    title: 'Find your roster',
    route: '/roster',
    target: 'roster-controls',
    body: [
      'Pick the branch, then the fortnight with the arrows or the date button. “Today” jumps back to the current pay period.',
      'Type a name in “Find a worker” to go straight to them.',
    ],
  },
  {
    id: 'open-day',
    title: 'Create a shift',
    route: '/roster',
    target: 'roster-cell',
    waitFor: 'day-editor-opened',
    doThis: 'Click any day in a worker’s row.',
    body: ['Each row is a worker and each box is a day. Clicking a day opens it so you can add or change hours.'],
    fallback: 'Add a worker first (Workers → Add worker). Their row appears here, one box per day.',
  },
  {
    id: 'enter-times',
    title: 'Enter the times',
    target: 'time-line',
    waitFor: 'shift-times-entered',
    doThis: 'Type 9 in the first box and 5p in the second.',
    body: [
      'Start → Finish. Quick typing works: “9” becomes 9:00 AM, “5p” or “17” becomes 5:00 PM.',
      'SimpleHours works out the hours for you as you type.',
    ],
    fallback: 'Open a day on the roster, then enter a start and finish time, for example 9:00 AM → 5:00 PM.',
  },
  {
    id: 'break',
    title: 'Add a break',
    target: 'break-controls',
    body: [
      'Each shift has a break. “Standard” follows your organisation’s rule, for example 30 minutes once a day is 6 hours or longer.',
      '“Apply break to all days” ticks every day of the fortnight for you. Untick the days that are different, the exceptions, then apply.',
    ],
  },
  {
    id: 'leave',
    title: 'Add leave',
    target: 'add-line',
    waitFor: 'leave-line-added',
    doThis: 'Click “Add time”, then change its type to Sick leave or Annual leave.',
    body: [
      'Leave is just another line on the day, with its own type: Sick, Annual, Time in lieu, Leave without pay or Other.',
      'A whole day of leave can be entered as hours only, without times.',
    ],
  },
  {
    id: 'split',
    title: 'Split days',
    target: 'save-day',
    body: [
      'One day can hold several lines. SimpleHours adds up work and leave separately, and the break only ever comes off work.',
      'Save to keep your changes, or Cancel to leave the day exactly as it was. The box on the roster then shows what changed.',
    ],
    example: [
      { time: '9:00 AM → 1:00 PM', kind: 'Work', tone: 'work' },
      { time: '1:00 PM → 3:00 PM', kind: 'Sick leave', tone: 'leave' },
      { time: '3:00 PM → 5:00 PM', kind: 'Work', tone: 'work' },
    ],
  },
  {
    id: 'timesheets',
    title: 'Timesheets',
    route: '/timesheets',
    target: 'timesheet-status',
    statusGuide: true,
    body: ['Worked hours are recorded on the roster. Here you check each person’s fortnight and approve it.'],
  },
  {
    id: 'finish',
    title: 'You’re ready',
    route: '/dashboard',
    target: 'daily-nav',
    body: [
      'Your daily work lives here: Today, Roster, Timesheets and Leave requests. A number shows when something is waiting for you.',
      'You can take this tour again any time from Help.',
    ],
  },
];

export const EMPLOYEE_TOUR: TourStep[] = [
  {
    id: 'workspace',
    title: 'Welcome',
    target: 'workspace',
    body: ['This shows your workplace and branch. Everything here is about your own shifts and hours.'],
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
    body: ['Choose the type of leave and the dates, then send it. You’ll see here when it’s approved.'],
  },
  {
    id: 'finish',
    title: 'You’re ready',
    target: 'daily-nav',
    body: ['Everything you need is in this menu. You can take this tour again any time from Help.'],
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
