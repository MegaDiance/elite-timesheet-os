/**
 * The script of the homepage product tour: what each chapter says and when its scene moves on.
 * Plain data with no imports, so the static fallback, the transcript and the tests can all use it
 * without loading the animated player.
 *
 * Every sentence here describes something SimpleHours does today. Check the app before adding a
 * claim: it doesn't run payroll, calculate pay or connect to payroll software.
 */

export type TourGroup = 'Set up once' | 'Every fortnight';

export interface TourChapter {
  id: 'organisation' | 'branches' | 'workers' | 'roster' | 'hours' | 'approve' | 'report';
  group: TourGroup;
  /** Short name for the chapter buttons. */
  title: string;
  /** Headline shown with the caption and in the transcript. */
  heading: string;
  /** What the chapter shows, in one or two sentences. Doubles as the caption and the transcript. */
  caption: string;
  durationMs: number;
  /** Times (ms from the start of the chapter) at which the scene moves on one step. Ascending, each before the end. */
  beats: readonly number[];
}

export const TOUR_CHAPTERS: readonly TourChapter[] = [
  {
    id: 'organisation',
    group: 'Set up once',
    title: 'Organisation',
    heading: 'Set up your organisation',
    caption:
      'Name your organisation, add your first branch and choose your unpaid break rule. You get a private sign-in link for your organisation.',
    durationMs: 7000,
    beats: [500, 1300, 2100, 3100, 3700],
  },
  {
    id: 'branches',
    group: 'Set up once',
    title: 'Branches',
    heading: 'Add branches and Branch Admins',
    caption:
      'Add each branch, then invite the Branch Admins who run them. A Branch Admin sees only their own branches. The Organisation Owner sees them all.',
    durationMs: 7500,
    beats: [400, 900, 1400, 2500, 3300, 4100, 4700, 5600],
  },
  {
    id: 'workers',
    group: 'Set up once',
    title: 'Workers',
    heading: 'Add the people you roster',
    caption:
      'Add each worker once, with their branch, department and contracted hours, and give them a default roster for the fortnight.',
    durationMs: 7000,
    beats: [300, 600, 900, 1900, 2400, 3700],
  },
  {
    id: 'roster',
    group: 'Every fortnight',
    title: 'Roster',
    heading: 'Roster the fortnight',
    caption:
      'Apply everyone’s default roster to the new pay period in one step, then change only the days that are different.',
    durationMs: 7000,
    beats: [800, 1300, 4000],
  },
  {
    id: 'hours',
    group: 'Every fortnight',
    title: 'Hours worked',
    heading: 'Record the hours actually worked',
    caption:
      'Worked hours sit beside the roster, so differences stand out. A day can mix Normal Work with leave, and the unpaid break comes off Normal Work only.',
    durationMs: 9000,
    beats: [600, 1100, 2600, 3700, 5300, 5900],
  },
  {
    id: 'approve',
    group: 'Every fortnight',
    title: 'Approve & lock',
    heading: 'Approve, then lock the pay period',
    caption:
      'Check each worker’s fortnight and approve it. Then lock the branch’s timesheets so the hours can’t change. Locking asks for a password.',
    durationMs: 8500,
    beats: [900, 1300, 3000, 3700, 4400, 5300, 5900],
  },
  {
    id: 'report',
    group: 'Every fortnight',
    title: 'Payroll report',
    heading: 'Hand over payroll-ready hours',
    caption:
      'Each worker’s hours, split into ordinary, weekend and public holiday hours and each type of leave. Export CSV, or print or save a PDF, for whoever runs your payroll.',
    durationMs: 7500,
    beats: [400, 3200],
  },
];

export const TOUR_TOTAL_MS = TOUR_CHAPTERS.reduce((sum, chapter) => sum + chapter.durationMs, 0);

/** Whole seconds, rounded, for "About 1 minute"-style labels. */
export const TOUR_TOTAL_SECONDS = Math.round(TOUR_TOTAL_MS / 1000);

/**
 * The stage keeps one height per breakpoint for every chapter, so nothing below it moves while the
 * tour plays, and the placeholder shown while the player loads takes exactly the same space.
 */
export const TOUR_STAGE_HEIGHT = 'h-[28rem] sm:h-[29.5rem] lg:h-[30rem]';

/** Room for the longest caption at each width, so the player keeps its height from chapter to chapter. */
export const TOUR_CAPTION_HEIGHT = 'min-h-[10.25rem] min-[360px]:min-h-[7.5rem] sm:min-h-[5.75rem] lg:min-h-[4.5rem]';
