/**
 * The homepage product tour: its playback state machine, its script and its example data.
 * Runs with Node's own test runner (`npm test --workspace=frontend`); no browser needed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TOUR_CHAPTERS, TOUR_TOTAL_MS } from '../src/pages/public/tour/chapters.ts';
import {
  initialTourState,
  nextEventDelay,
  overallProgress,
  stepAt,
  tourReducer,
  type TourAction,
  type TourState,
} from '../src/pages/public/tour/timeline.ts';
import {
  DEMO_BRANCH_ADMINS,
  DEMO_BRANCHES,
  DEMO_LEAVE_EDIT,
  DEMO_ORGANISATION,
  DEMO_REPORT,
  DEMO_REPORT_COLUMNS,
  DEMO_SIGN_IN_LINK,
  DEMO_TIMESHEETS,
  DEMO_WEEK,
  DEMO_WORKERS,
} from '../src/pages/public/tour/demoData.ts';

const reduce = (state: TourState, ...actions: TourAction[]) =>
  actions.reduce((s, action) => tourReducer(TOUR_CHAPTERS, s, action), state);

const playing = (chapter = 0, elapsed = 0): TourState => ({ ...initialTourState, chapter, elapsed, status: 'playing' });

describe('tour playback', () => {
  it('autoplays only a tour nobody has touched', () => {
    assert.equal(reduce(initialTourState, { type: 'autoplay' }).status, 'playing');

    const pausedByVisitor = reduce(initialTourState, { type: 'pause', by: 'visitor', elapsed: 0 });
    assert.equal(pausedByVisitor.status, 'paused');
    assert.equal(reduce(pausedByVisitor, { type: 'autoplay' }).status, 'paused');

    const ended: TourState = { ...playing(TOUR_CHAPTERS.length - 1), status: 'ended' };
    assert.equal(reduce(ended, { type: 'autoplay' }).status, 'ended');
  });

  it('resumes by itself after an automatic pause, never after the visitor pauses', () => {
    const autoPaused = reduce(playing(2, 1200), { type: 'pause', by: 'auto', elapsed: 1500 });
    assert.deepEqual([autoPaused.status, autoPaused.pausedBy, autoPaused.elapsed], ['paused', 'auto', 1500]);
    assert.equal(reduce(autoPaused, { type: 'resume' }).status, 'playing');

    const visitorPaused = reduce(playing(2, 1200), { type: 'pause', by: 'visitor', elapsed: 1500 });
    assert.equal(reduce(visitorPaused, { type: 'resume' }).status, 'paused');
    assert.equal(reduce(visitorPaused, { type: 'play' }).status, 'playing');
  });

  it('keeps the chapter position when paused and played again', () => {
    const state = reduce(playing(3, 500), { type: 'pause', by: 'visitor', elapsed: 2300 }, { type: 'play' });
    assert.deepEqual([state.chapter, state.elapsed, state.status], [3, 2300, 'playing']);
  });

  it('moves to the next chapter at the end of one, and ends after the last', () => {
    const first = TOUR_CHAPTERS[0];
    const mid = reduce(playing(0), { type: 'advance', elapsed: first.beats[0] });
    assert.deepEqual([mid.chapter, mid.elapsed], [0, first.beats[0]]);

    const next = reduce(mid, { type: 'advance', elapsed: first.durationMs });
    assert.deepEqual([next.chapter, next.elapsed, next.run, next.from], [1, 0, mid.run + 1, 0]);

    const last = TOUR_CHAPTERS.length - 1;
    const ended = reduce(playing(last), { type: 'advance', elapsed: TOUR_CHAPTERS[last].durationMs });
    assert.deepEqual([ended.chapter, ended.status], [last, 'ended']);
    assert.equal(overallProgress(TOUR_CHAPTERS, ended), 1);
  });

  it('ignores timer reports that arrive after a pause', () => {
    const paused = reduce(playing(1, 900), { type: 'pause', by: 'visitor', elapsed: 1000 });
    assert.equal(reduce(paused, { type: 'advance', elapsed: 99999 }), paused);
  });

  it('replays from the first chapter when played after the end', () => {
    const ended = reduce(playing(TOUR_CHAPTERS.length - 1), { type: 'advance', elapsed: 1e9 });
    const replay = reduce(ended, { type: 'play' });
    assert.deepEqual([replay.chapter, replay.elapsed, replay.status], [0, 0, 'playing']);
    assert.ok(replay.run > ended.run, 'a replay restarts the chapter animation');
  });

  it('jumps to a chapter, clamped, playing or held as the caller asks', () => {
    assert.deepEqual(pick(reduce(initialTourState, { type: 'go', chapter: 4, play: true })), [4, 0, 'playing', null]);
    assert.deepEqual(pick(reduce(playing(2, 800), { type: 'go', chapter: 99, play: false })), [6, 0, 'paused', 'visitor']);
    assert.deepEqual(pick(reduce(playing(2, 800), { type: 'go', chapter: -3, play: true })), [0, 0, 'playing', null]);
    // Going to the chapter already showing restarts it.
    const again = reduce(playing(2, 800), { type: 'go', chapter: 2, play: true });
    assert.deepEqual([again.elapsed, again.run], [0, 1]);
  });

  it('restart always plays from the beginning', () => {
    const state = reduce({ ...playing(5, 3000), status: 'paused', pausedBy: 'visitor' }, { type: 'restart' });
    assert.deepEqual(pick(state), [0, 0, 'playing', null]);
    assert.equal(state.from, 5, 'remembers where it came from, so the view knows the screen changed');
  });

  it('counts beats and schedules the next event', () => {
    const beats = [500, 1300, 2100];
    assert.deepEqual([0, 499, 500, 1299, 2100, 9000].map(t => stepAt(beats, t)), [0, 0, 1, 1, 3, 3]);

    const chapter = { durationMs: 3000, beats };
    assert.equal(nextEventDelay(chapter, 0), 500);
    assert.equal(nextEventDelay(chapter, 500), 800);
    assert.equal(nextEventDelay(chapter, 2500), 500);
    assert.equal(nextEventDelay(chapter, 2500, false), 500);
    assert.equal(nextEventDelay(chapter, 0, false), 3000, 'without beats (reduced motion) it waits for the chapter end');
    assert.equal(nextEventDelay(chapter, 5000), 0);
  });

  it('plays the whole tour in order, beat by beat, in exactly its running time', () => {
    let state = reduce(initialTourState, { type: 'autoplay' });
    let clock = 0;
    const visited: string[] = [];
    let guard = 0;
    while (state.status === 'playing' && guard++ < 1000) {
      const chapter = TOUR_CHAPTERS[state.chapter];
      if (visited.at(-1) !== chapter.id) visited.push(chapter.id);
      const delay = nextEventDelay(chapter, state.elapsed);
      clock += delay;
      state = reduce(state, { type: 'advance', elapsed: state.elapsed + delay });
    }
    assert.equal(state.status, 'ended');
    assert.equal(clock, TOUR_TOTAL_MS);
    assert.deepEqual(visited, TOUR_CHAPTERS.map(c => c.id));
  });
});

describe('tour script', () => {
  it('tells the story in order: organisation to payroll report', () => {
    assert.deepEqual(
      TOUR_CHAPTERS.map(c => c.id),
      ['organisation', 'branches', 'workers', 'roster', 'hours', 'approve', 'report'],
    );
    assert.deepEqual(
      TOUR_CHAPTERS.map(c => c.group),
      ['Set up once', 'Set up once', 'Set up once', 'Every fortnight', 'Every fortnight', 'Every fortnight', 'Every fortnight'],
    );
  });

  it('runs for 30 to 60 seconds', () => {
    assert.ok(TOUR_TOTAL_MS >= 30_000 && TOUR_TOTAL_MS <= 60_000, `${TOUR_TOTAL_MS} ms`);
  });

  it('has ascending beats inside every chapter', () => {
    for (const chapter of TOUR_CHAPTERS) {
      assert.ok(chapter.title && chapter.heading && chapter.caption, chapter.id);
      chapter.beats.forEach((beat, i) => {
        assert.ok(beat > (chapter.beats[i - 1] ?? 0), `${chapter.id} beat ${i} is after the one before`);
        assert.ok(beat < chapter.durationMs, `${chapter.id} beat ${i} is before the chapter ends`);
      });
    }
  });

  it('never claims features SimpleHours does not have', () => {
    const notOffered = /\b(Xero|MYOB|KeyPay|Employment Hero|integrat\w*|clock[- ]?in|GPS|award rates?|penalty rates?|overtime|superannuation|tax|pay rates?|wages?|notif\w*)\b/i;
    for (const chapter of TOUR_CHAPTERS) {
      for (const text of [chapter.title, chapter.heading, chapter.caption]) {
        assert.doesNotMatch(text, notOffered, `${chapter.id}: "${text}"`);
      }
    }
  });
});

describe('tour example data', () => {
  const everything = JSON.stringify({ DEMO_ORGANISATION, DEMO_BRANCHES, DEMO_BRANCH_ADMINS, DEMO_WORKERS, DEMO_TIMESHEETS, DEMO_REPORT, DEMO_SIGN_IN_LINK });

  it('is clearly made up', () => {
    assert.match(DEMO_ORGANISATION, /^Example /);
    for (const person of [...DEMO_WORKERS, ...DEMO_BRANCH_ADMINS]) assert.match(person.email, /^[a-z.]+@example\.com$/, person.name);
    // Only initials for surnames of the people who sign in.
    for (const admin of DEMO_BRANCH_ADMINS) assert.match(admin.name, /^[A-Z][a-z]+ [A-Z]\.$/, admin.name);
  });

  it('never shows a real sign-in link, token or internal id', () => {
    assert.match(DEMO_SIGN_IN_LINK, /\/login\/•+$/);
    assert.doesNotMatch(everything, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'no UUIDs');
    assert.doesNotMatch(everything, /[A-Za-z0-9_-]{24,}/, 'no token-like strings');
    assert.doesNotMatch(everything, /https?:\/\//, 'no URLs');
  });

  it('adds up across chapters', () => {
    assert.equal(DEMO_WEEK.length, 7);
    for (const worker of DEMO_WORKERS) assert.equal(worker.week.length, 7, worker.name);

    const branchNames = DEMO_BRANCHES.map(b => b.name);
    for (const admin of DEMO_BRANCH_ADMINS) for (const branch of admin.branches) assert.ok(branchNames.includes(branch), `${admin.name}: ${branch}`);

    assert.deepEqual(DEMO_TIMESHEETS.map(t => t.name), DEMO_WORKERS.map(w => w.name));
    assert.deepEqual(DEMO_REPORT.map(r => r.name), DEMO_WORKERS.map(w => w.name));
    DEMO_REPORT.forEach((row, i) => {
      assert.equal(row.hours.length, DEMO_REPORT_COLUMNS.length, row.name);
      const total = row.hours.reduce((sum, h) => sum + h, 0);
      assert.equal(total, DEMO_TIMESHEETS[i].worked, `${row.name}: report total matches the timesheet`);
    });

    // The part-day sick leave recorded in "Hours worked" is the sick leave in the report.
    const [start, finish] = DEMO_LEAVE_EDIT.leave.time.split('-').map(t => Number(t.slice(0, 2)) + Number(t.slice(3)) / 60);
    const sickColumn = DEMO_REPORT_COLUMNS.indexOf('Sick Leave');
    assert.equal(DEMO_REPORT[DEMO_LEAVE_EDIT.worker].hours[sickColumn], finish - start);
  });
});

function pick(state: TourState) {
  return [state.chapter, state.elapsed, state.status, state.pausedBy];
}
